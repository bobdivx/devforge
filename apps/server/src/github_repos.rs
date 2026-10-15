//! P6 — Sélecteur de dépôts GitHub App et liaison d'un projet à un dépôt de l'installation.
//!
//! - `GET /api/v1/github-app/repositories?q=&installation_id=&refresh=1` : cache
//!   `github_installation_repos` ; `refresh=1` relit `GET /installation/repositories`.
//! - `GET|PUT /api/v1/projects/{uuid}/github-link` : état de liaison (dont « accès perdu »)
//!   et liaison (installation + dépôt ⇒ URL, branche par défaut si vide).

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::PgPool;

use crate::routes::{auth_project, ApiError};
use crate::state::{now_str, AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/github-app/repositories", get(repositories))
        .route(
            "/api/v1/projects/{uuid}/github-link",
            get(get_link).put(put_link),
        )
}

#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub struct RepoRow {
    pub installation_id: i64,
    pub repo_id: i64,
    pub full_name: String,
    pub private: bool,
    pub default_branch: Option<String>,
}

/// Filtre insensible à la casse sur `owner/nom`, tri alphabétique.
pub fn filter_repos(mut rows: Vec<RepoRow>, q: &str) -> Vec<RepoRow> {
    let q = q.trim().to_ascii_lowercase();
    if !q.is_empty() {
        rows.retain(|r| r.full_name.to_ascii_lowercase().contains(&q));
    }
    rows.sort_by(|a, b| {
        a.full_name
            .to_ascii_lowercase()
            .cmp(&b.full_name.to_ascii_lowercase())
    });
    rows
}

/// Lien « Configurer l'accès aux dépôts » (compte perso ou organisation).
pub fn configure_url(web: &str, installation_id: i64, account_type: &str, login: &str) -> String {
    if account_type.eq_ignore_ascii_case("Organization") {
        format!("{web}/organizations/{login}/settings/installations/{installation_id}")
    } else {
        format!("{web}/settings/installations/{installation_id}")
    }
}

/// Remplace le cache d'une installation par la liste fraîche de GitHub.
pub async fn replace_cache(
    pool: &PgPool,
    installation_id: i64,
    repos: &[devforge_github::repos::InstallationRepo],
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM github_installation_repos WHERE installation_id = $1")
        .bind(installation_id)
        .execute(&mut *tx)
        .await?;
    for r in repos {
        sqlx::query(
            "INSERT INTO github_installation_repos (installation_id, repo_id, full_name, private, default_branch) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
        )
        .bind(installation_id)
        .bind(r.id)
        .bind(&r.full_name)
        .bind(r.private)
        .bind(&r.default_branch)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await
}

#[derive(Deserialize)]
struct RepoQuery {
    q: Option<String>,
    installation_id: Option<i64>,
    refresh: Option<String>,
}

async fn require_user(state: &AppState, headers: &HeaderMap) -> Result<(), ApiError> {
    match crate::auth_routes::user_from_bearer_or_cookie(state, headers).await {
        Ok(Some(_)) => Ok(()),
        _ => Err(ApiError {
            status: StatusCode::UNAUTHORIZED,
            message: "connexion requise".into(),
        }),
    }
}

async fn repositories(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<RepoQuery>,
) -> Result<Json<Value>, ApiError> {
    require_user(&state, &headers).await?;
    let insts: Vec<(i64, String, String, bool)> = sqlx::query_as(
        "SELECT installation_id, account_login, account_type, suspended_at IS NOT NULL FROM github_installations ORDER BY created_at",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(ApiError::from)?;
    let wanted: Vec<i64> = insts
        .iter()
        .filter(|i| q.installation_id.is_none_or(|w| w == i.0))
        .map(|i| i.0)
        .collect();
    let mut refresh_error = None;
    if matches!(q.refresh.as_deref(), Some("1") | Some("true")) {
        for id in &wanted {
            let auth = crate::github_auth::GithubAuth::Installation {
                id: *id,
                repo_id: None,
            };
            let token = crate::github_auth::token(&state, &auth, "").await;
            if token.is_empty() {
                refresh_error = Some("token d’installation indisponible".to_string());
                continue;
            }
            match devforge_github::repos::list_installation_repos(
                &crate::github_app_routes::api_base(),
                &token,
            )
            .await
            {
                Ok(list) => {
                    replace_cache(&state.pool, *id, &list)
                        .await
                        .map_err(ApiError::from)?;
                }
                Err(e) => refresh_error = Some(e),
            }
        }
    }
    let rows: Vec<RepoRow> = sqlx::query_as(
        "SELECT installation_id, repo_id, full_name, private, default_branch FROM github_installation_repos WHERE installation_id = ANY($1)",
    )
    .bind(&wanted)
    .fetch_all(&state.pool)
    .await
    .map_err(ApiError::from)?;
    let rows = filter_repos(rows, q.q.as_deref().unwrap_or(""));
    let web = crate::github_app_routes::web_base();
    Ok(Json(json!({
        "ok": true,
        "installations": insts.iter().filter(|i| wanted.contains(&i.0)).map(|(id, login, ty, susp)| json!({
            "installation_id": id, "account_login": login, "account_type": ty, "suspended": susp,
            "configure_url": configure_url(&web, *id, ty, login),
        })).collect::<Vec<_>>(),
        "repositories": rows.iter().map(|r| json!({
            "installation_id": r.installation_id, "repo_id": r.repo_id, "full_name": r.full_name,
            "private": r.private, "default_branch": r.default_branch,
            "html_url": format!("{web}/{}", r.full_name),
        })).collect::<Vec<_>>(),
        "refresh_error": refresh_error,
    })))
}

/// `(installation, dépôt)` du projet ; `lost` = lié mais le dépôt n'est plus accessible.
pub async fn link_state(pool: &PgPool, project_uuid: &str) -> Value {
    let link: Option<(Option<i64>, Option<i64>)> = sqlx::query_as(
        "SELECT github_installation_id, github_repo_id FROM projects WHERE uuid = $1",
    )
    .bind(project_uuid)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    let Some((Some(inst), repo)) = link else {
        return json!({"linked": false, "lost": false});
    };
    let present: bool = match repo {
        Some(r) => sqlx::query_as::<_, (i64,)>(
            "SELECT 1::BIGINT FROM github_installation_repos gr JOIN github_installations gi USING (installation_id) WHERE gr.installation_id = $1 AND gr.repo_id = $2 AND gi.suspended_at IS NULL",
        )
        .bind(inst)
        .bind(r)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .is_some(),
        None => false,
    };
    json!({"linked": true, "installation_id": inst, "repo_id": repo, "lost": !present})
}

async fn get_link(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (_u, _w, project) = auth_project(&state, &headers, &uuid).await?;
    let mut v = link_state(&state.pool, &project.uuid).await;
    v["ok"] = json!(true);
    Ok(Json(v))
}

#[derive(Deserialize)]
struct LinkBody {
    installation_id: i64,
    repo_id: i64,
    branch: Option<String>,
}

async fn put_link(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Json(b): Json<LinkBody>,
) -> Result<Json<Value>, ApiError> {
    let (_u, _w, project) = auth_project(&state, &headers, &uuid).await?;
    let row: Option<RepoRow> = sqlx::query_as(
        "SELECT installation_id, repo_id, full_name, private, default_branch FROM github_installation_repos WHERE installation_id = $1 AND repo_id = $2",
    )
    .bind(b.installation_id)
    .bind(b.repo_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(ApiError::from)?;
    let row = row.ok_or_else(|| {
        ApiError::message("Dépôt non accessible à l’app GitHub : ajoute-le à l’installation.")
    })?;
    let branch = b
        .branch
        .clone()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| project.git_branch.clone().filter(|s| !s.trim().is_empty()))
        .or(row.default_branch.clone())
        .unwrap_or_else(|| "main".into());
    let url = format!("{}/{}", crate::github_app_routes::web_base(), row.full_name);
    sqlx::query(
        "UPDATE projects SET github_installation_id = $1, github_repo_id = $2, git_repository = $3, git_branch = $4, updated_at = $5 WHERE uuid = $6",
    )
    .bind(row.installation_id)
    .bind(row.repo_id)
    .bind(&url)
    .bind(&branch)
    .bind(now_str())
    .bind(&project.uuid)
    .execute(&state.pool)
    .await
    .map_err(ApiError::from)?;
    Ok(Json(json!({
        "ok": true, "git_repository": url, "git_branch": branch,
        "installation_id": row.installation_id, "repo_id": row.repo_id,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(name: &str) -> RepoRow {
        RepoRow {
            installation_id: 1,
            repo_id: name.len() as i64,
            full_name: name.into(),
            private: false,
            default_branch: Some("main".into()),
        }
    }

    #[test]
    fn filter_is_case_insensitive_and_sorted() {
        let out = filter_repos(
            vec![r("bobdivx/Zeta"), r("bobdivx/alpha"), r("x/other")],
            "BOBDIVX",
        );
        let names: Vec<_> = out.iter().map(|r| r.full_name.as_str()).collect();
        assert_eq!(names, vec!["bobdivx/alpha", "bobdivx/Zeta"]);
        assert_eq!(filter_repos(vec![r("a/b")], "zzz").len(), 0);
    }

    #[test]
    fn configure_url_user_vs_org() {
        assert_eq!(
            configure_url("https://github.com", 7, "User", "bobdivx"),
            "https://github.com/settings/installations/7"
        );
        assert_eq!(
            configure_url("https://github.com", 7, "Organization", "acme"),
            "https://github.com/organizations/acme/settings/installations/7"
        );
    }
}
