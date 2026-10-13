//! Résolution de l'authentification GitHub par projet (P2-03) : token d'installation
//! GitHub App si le projet est lié à une installation et que le mode App est actif,
//! sinon PAT (comportement historique, strictement inchangé).
//!
//! Feature flag : `DEVFORGE_GITHUB_APP=1` **ou** présence d'une ligne `github_app`.

use std::fmt;

use devforge_github::app_auth::{TokenError, TokenScope};
use serde_json::json;
use sqlx::PgPool;

use crate::state::AppState;

pub const FLAG_ENV: &str = "DEVFORGE_GITHUB_APP";

pub fn flag_from_env(v: Option<&str>) -> bool {
    matches!(
        v.map(|s| s.trim().to_ascii_lowercase()).as_deref(),
        Some("1" | "true" | "yes" | "on")
    )
}

/// Mode GitHub App actif ?
pub async fn app_enabled(pool: &PgPool) -> bool {
    if flag_from_env(std::env::var(FLAG_ENV).ok().as_deref()) {
        return true;
    }
    sqlx::query_as::<_, (i64,)>("SELECT count(*) FROM github_app")
        .fetch_one(pool)
        .await
        .map(|(n,)| n > 0)
        .unwrap_or(false)
}

#[derive(Clone, PartialEq, Eq)]
pub enum GithubAuth {
    Pat(String),
    Installation { id: i64, repo_id: Option<i64> },
}

impl fmt::Debug for GithubAuth {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GithubAuth::Pat(_) => f.write_str("Pat(***)"),
            GithubAuth::Installation { id, repo_id } => {
                write!(f, "Installation {{ id: {id}, repo_id: {repo_id:?} }}")
            }
        }
    }
}

/// Choix pur : installation si le projet en a une et que le mode App est actif.
pub fn choose(
    enabled: bool,
    installation_id: Option<i64>,
    repo_id: Option<i64>,
    pat: String,
) -> GithubAuth {
    match (enabled, installation_id) {
        (true, Some(id)) => GithubAuth::Installation { id, repo_id },
        _ => GithubAuth::Pat(pat),
    }
}

async fn project_link(pool: &PgPool, project_uuid: &str) -> (Option<i64>, Option<i64>) {
    sqlx::query_as::<_, (Option<i64>, Option<i64>)>(
        "SELECT github_installation_id, github_repo_id FROM projects WHERE uuid = $1",
    )
    .bind(project_uuid)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .unwrap_or((None, None))
}

pub async fn for_project(pool: &PgPool, project_uuid: &str, pat: String) -> GithubAuth {
    let (inst, repo) = project_link(pool, project_uuid).await;
    if inst.is_none() {
        return GithubAuth::Pat(pat);
    }
    choose(app_enabled(pool).await, inst, repo, pat)
}

async fn mark_suspended(pool: &PgPool, id: i64) {
    let _ = sqlx::query(
        "UPDATE github_installations SET suspended_at = COALESCE(suspended_at, now()), updated_at = now() WHERE installation_id = $1",
    )
    .bind(id)
    .execute(pool)
    .await;
}

fn note_error(id: i64, e: &TokenError) {
    tracing::warn!(
        installation_id = id,
        "token d'installation indisponible : {e}"
    );
}

/// Token bearer (cache) ; en cas d'échec de l'installation, repli sur le PAT fourni.
pub async fn token(state: &AppState, auth: &GithubAuth, pat_fallback: &str) -> String {
    match auth {
        GithubAuth::Pat(t) => t.clone(),
        GithubAuth::Installation { id, .. } => {
            let creds = match crate::github_app_routes::load_credentials(&state.pool).await {
                Ok(c) => c,
                Err(e) => {
                    tracing::warn!("GitHub App indisponible : {e}");
                    return pat_fallback.to_string();
                }
            };
            match state.gh_tokens.get(&creds, *id).await {
                Ok(t) => t.expose().to_string(),
                Err(e) => {
                    if e == TokenError::Suspended {
                        mark_suspended(&state.pool, *id).await;
                    }
                    note_error(*id, &e);
                    pat_fallback.to_string()
                }
            }
        }
    }
}

/// Token pour un projet : installation si liée, sinon `pat` (inchangé).
pub async fn project_token(state: &AppState, project_uuid: &str, pat: String) -> String {
    let auth = for_project(&state.pool, project_uuid, pat.clone()).await;
    token(state, &auth, &pat).await
}

/// Token transmis à un clone de déploiement.
pub struct DeployToken {
    pub token: Option<String>,
    /// `true` = token d'installation éphémère : à passer en en-tête, jamais dans `.git/config`.
    pub ephemeral: bool,
}

/// Déploiement : token d'installation restreint au dépôt (`contents:read`, TTL GitHub ≤ 1 h),
/// sinon PAT d'instance (historique).
pub async fn deploy_token(
    state: &AppState,
    project_uuid: &str,
    instance_pat: Option<String>,
) -> DeployToken {
    let legacy = DeployToken {
        token: instance_pat.clone(),
        ephemeral: false,
    };
    let GithubAuth::Installation { id, repo_id } =
        for_project(&state.pool, project_uuid, String::new()).await
    else {
        return legacy;
    };
    let creds = match crate::github_app_routes::load_credentials(&state.pool).await {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("GitHub App indisponible pour le déploiement : {e}");
            return legacy;
        }
    };
    let scope = TokenScope {
        repository_ids: repo_id.into_iter().collect(),
        permissions: Some(json!({ "contents": "read", "metadata": "read" })),
    };
    match state.gh_tokens.scoped(&creds, id, &scope).await {
        Ok(t) => DeployToken {
            token: Some(t.token.expose().to_string()),
            ephemeral: true,
        },
        Err(e) => {
            if e == TokenError::Suspended {
                mark_suspended(&state.pool, id).await;
            }
            note_error(id, &e);
            legacy
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flag_parsing() {
        assert!(flag_from_env(Some("1")));
        assert!(flag_from_env(Some(" TRUE ")));
        assert!(!flag_from_env(Some("0")));
        assert!(!flag_from_env(Some("")));
        assert!(!flag_from_env(None));
    }

    #[test]
    fn resolver_installation_vs_pat() {
        assert_eq!(
            choose(true, Some(5), Some(9), "ghp_x".into()),
            GithubAuth::Installation {
                id: 5,
                repo_id: Some(9)
            }
        );
        assert_eq!(
            choose(true, None, None, "ghp_x".into()),
            GithubAuth::Pat("ghp_x".into())
        );
        // Flag absent : PAT même si le projet est lié (comportement inchangé).
        assert_eq!(
            choose(false, Some(5), None, "ghp_x".into()),
            GithubAuth::Pat("ghp_x".into())
        );
        assert_eq!(
            format!("{:?}", GithubAuth::Pat("ghp_secret".into())),
            "Pat(***)"
        );
    }

    #[tokio::test]
    async fn for_project_reads_link_and_flag() {
        let pool = devforge_database::ephemeral_pg().await;
        crate::db::migrate(&pool).await.unwrap();
        sqlx::query("INSERT INTO projects (uuid, name, slug, created_at, updated_at, github_installation_id, github_repo_id) VALUES ('p-app','A','a','x','x', 77, 9), ('p-pat','B','b','x','x', NULL, NULL)")
            .execute(&pool).await.unwrap();
        assert_eq!(
            for_project(&pool, "p-pat", "ghp".into()).await,
            GithubAuth::Pat("ghp".into())
        );
        if !flag_from_env(std::env::var(FLAG_ENV).ok().as_deref()) {
            // Sans app enregistrée ni flag : PAT.
            assert_eq!(
                for_project(&pool, "p-app", "ghp".into()).await,
                GithubAuth::Pat("ghp".into())
            );
        }
        sqlx::query("INSERT INTO github_app (id, app_id, slug, client_id, client_secret_enc, webhook_secret_enc, private_key_enc, html_url, owner_login) VALUES (1, 1, 's', 'c', 'v1:a:b', 'v1:a:b', 'v1:a:b', 'h', 'o')")
            .execute(&pool).await.unwrap();
        assert_eq!(
            for_project(&pool, "p-app", "ghp".into()).await,
            GithubAuth::Installation {
                id: 77,
                repo_id: Some(9)
            }
        );
    }
}
