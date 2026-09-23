//! Groupes d'apps : plusieurs projets, un rôle, réseau Docker partagé.

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, patch, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use sqlx::FromRow;

use crate::routes::{slugify, ApiError};
use crate::state::{new_uuid, now_str, AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/groups", get(list_groups).post(create_group))
        .route(
            "/api/v1/groups/{uuid}",
            get(get_group).patch(update_group).delete(delete_group),
        )
        .route("/api/v1/groups/{uuid}/members", post(add_member))
        .route(
            "/api/v1/groups/{uuid}/members/{project_uuid}",
            patch(update_member).delete(remove_member),
        )
}

#[derive(Debug, Clone, FromRow)]
struct GroupRow {
    uuid: String,
    #[allow(dead_code)]
    workspace_uuid: String,
    name: String,
    slug: String,
    domain_apex: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone)]
pub struct GroupMembership {
    pub group_uuid: String,
    pub group_name: String,
    pub group_slug: String,
    pub role: String,
}

#[derive(Debug, Clone, FromRow)]
struct MemberView {
    role: String,
    uuid: String,
    name: String,
    status: String,
    server_id: Option<String>,
    port: i64,
    production_url: Option<String>,
    gpu_nvidia: i64,
    gpu_dri: i64,
}

#[derive(Debug, Clone, FromRow)]
struct LinkRow {
    slug: String,
    own_role: String,
    role: String,
    port: i64,
    production_url: Option<String>,
}

pub fn write_group_fields(obj: &mut Map<String, Value>, membership: Option<&GroupMembership>) {
    match membership {
        Some(m) => {
            obj.insert("group_uuid".into(), json!(m.group_uuid));
            obj.insert("group_name".into(), json!(m.group_name));
            obj.insert("group_slug".into(), json!(m.group_slug));
            obj.insert("role".into(), json!(m.role));
        }
        None => {
            obj.insert("group_uuid".into(), Value::Null);
            obj.insert("group_name".into(), Value::Null);
            obj.insert("group_slug".into(), Value::Null);
            obj.insert("role".into(), Value::Null);
        }
    }
}

pub async fn membership(pool: &sqlx::PgPool, project_uuid: &str) -> Option<GroupMembership> {
    let row: Option<(String, String, String, String)> = sqlx::query_as(
        r#"SELECT g.uuid, g.name, g.slug, m.role
           FROM app_group_members m
           JOIN app_groups g ON g.uuid = m.group_uuid
           WHERE m.project_uuid = $1"#,
    )
    .bind(project_uuid)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    row.map(
        |(group_uuid, group_name, group_slug, role)| GroupMembership {
            group_uuid,
            group_name,
            group_slug,
            role,
        },
    )
}

/// Réseau `dfg-{slug}`, alias = rôle, variables `DF_*` calculées (non stockées).
pub async fn prepare_deploy_link(
    pool: &sqlx::PgPool,
    project_uuid: &str,
    env_file: Option<String>,
) -> (Option<String>, Option<String>, Option<String>) {
    let rows: Vec<LinkRow> = sqlx::query_as(
        r#"SELECT g.slug AS slug, self.role AS own_role, m.role AS role, p.port AS port,
                  p.production_url AS production_url
           FROM app_group_members self
           JOIN app_groups g ON g.uuid = self.group_uuid
           JOIN app_group_members m ON m.group_uuid = self.group_uuid
           JOIN projects p ON p.uuid = m.project_uuid
           WHERE self.project_uuid = $1
           ORDER BY m.role"#,
    )
    .bind(project_uuid)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    let Some(first) = rows.first() else {
        return (env_file, None, None);
    };
    let members: Vec<(String, i64, Option<String>)> = rows
        .iter()
        .map(|r| (r.role.clone(), r.port, r.production_url.clone()))
        .collect();
    let lines = group_env_lines(&first.slug, &first.own_role, &members);
    let env = apply_group_env(env_file.as_deref(), &lines);
    let network = group_network_name(&first.slug);
    (env, Some(network), Some(first.own_role.clone()))
}

pub async fn ensure_same_node(
    pool: &sqlx::PgPool,
    project_uuid: &str,
    new_server_id: Option<&str>,
) -> Result<(), ApiError> {
    let rows: Vec<(Option<String>,)> = sqlx::query_as(
        r#"SELECT p.server_id
           FROM app_group_members self
           JOIN app_group_members m
             ON m.group_uuid = self.group_uuid AND m.project_uuid <> self.project_uuid
           JOIN projects p ON p.uuid = m.project_uuid
           WHERE self.project_uuid = $1"#,
    )
    .bind(project_uuid)
    .fetch_all(pool)
    .await
    .map_err(ApiError::from)?;
    let want = normalize_server(new_server_id);
    if rows
        .iter()
        .any(|(id,)| normalize_server(id.as_deref()) != want)
    {
        return Err(ApiError::message(
            "Les apps d'un groupe doivent rester sur le même nœud (réseau Docker local).",
        ));
    }
    Ok(())
}

pub fn group_network_name(slug: &str) -> String {
    let slug = slug.trim();
    let slug: String = slug.chars().take(48).collect();
    format!("dfg-{slug}")
}

pub fn role_env_token(role: &str) -> String {
    role.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_uppercase()
            } else {
                '_'
            }
        })
        .collect::<String>()
        .split('_')
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("_")
}

pub fn group_env_lines(
    group_slug: &str,
    own_role: &str,
    members: &[(String, i64, Option<String>)],
) -> Vec<(String, String)> {
    let mut lines = vec![
        ("DF_GROUP".into(), group_slug.to_string()),
        ("DF_ROLE".into(), own_role.to_string()),
    ];
    for (role, port, public) in members {
        let token = role_env_token(role);
        if token.is_empty() {
            continue;
        }
        let port = if *port <= 0 { 3000 } else { *port };
        lines.push((format!("DF_{token}_URL"), format!("http://{role}:{port}")));
        if let Some(url) = public.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            lines.push((format!("DF_{token}_PUBLIC_URL"), url.to_string()));
        }
    }
    lines
}

pub fn apply_group_env(existing: Option<&str>, lines: &[(String, String)]) -> Option<String> {
    if lines.is_empty() {
        return existing
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
    }
    let keys: std::collections::HashSet<&str> = lines.iter().map(|(k, _)| k.as_str()).collect();
    let mut kept = String::new();
    if let Some(body) = existing {
        for line in body.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            if let Some((key, _)) = trimmed.split_once('=') {
                if keys.contains(key.trim()) {
                    continue;
                }
            }
            kept.push_str(trimmed);
            kept.push('\n');
        }
    }
    kept.push_str(&devforge_env::serialize_docker_env_file(lines));
    if !kept.ends_with('\n') {
        kept.push('\n');
    }
    Some(kept)
}

fn normalize_server(id: Option<&str>) -> String {
    match id.map(str::trim).filter(|s| !s.is_empty()) {
        Some(s) => s.to_string(),
        None => "default".into(),
    }
}

fn normalize_role(raw: &str) -> Result<String, ApiError> {
    let role = slugify(raw);
    if role.is_empty() || role.len() > 32 {
        return Err(ApiError::message(
            "Rôle invalide : lettres, chiffres et tirets, 32 caractères maximum.",
        ));
    }
    Ok(role)
}

async fn workspace_uuid(state: &AppState, headers: &HeaderMap) -> Result<String, ApiError> {
    let (_user, workspace) = crate::auth_routes::current_workspace(state, headers)
        .await
        .map_err(ApiError::from_auth)?;
    Ok(workspace.uuid)
}

async fn load_group(state: &AppState, workspace: &str, uuid: &str) -> Result<GroupRow, ApiError> {
    sqlx::query_as::<_, GroupRow>(
        "SELECT uuid, workspace_uuid, name, slug, domain_apex, created_at, updated_at FROM app_groups WHERE uuid = $1 AND workspace_uuid = $2",
    )
    .bind(uuid)
    .bind(workspace)
    .fetch_optional(&state.pool)
    .await
    .map_err(ApiError::from)?
    .ok_or_else(|| ApiError::not_found("group"))
}

async fn load_members(state: &AppState, group_uuid: &str) -> Result<Vec<MemberView>, ApiError> {
    sqlx::query_as::<_, MemberView>(
        r#"SELECT m.role AS role, p.uuid AS uuid, p.name AS name, p.status AS status,
                  p.server_id AS server_id, p.port AS port, p.production_url AS production_url,
                  p.gpu_nvidia AS gpu_nvidia, p.gpu_dri AS gpu_dri
           FROM app_group_members m
           JOIN projects p ON p.uuid = m.project_uuid
           WHERE m.group_uuid = $1
           ORDER BY m.role"#,
    )
    .bind(group_uuid)
    .fetch_all(&state.pool)
    .await
    .map_err(ApiError::from)
}

fn group_json(group: &GroupRow, members: &[MemberView]) -> Value {
    json!({
        "uuid": group.uuid,
        "name": group.name,
        "slug": group.slug,
        "domain_apex": group.domain_apex,
        "network": group_network_name(&group.slug),
        "created_at": group.created_at,
        "updated_at": group.updated_at,
        "members": members.iter().map(member_json).collect::<Vec<_>>(),
    })
}

fn member_json(m: &MemberView) -> Value {
    json!({
        "project_uuid": m.uuid,
        "name": m.name,
        "role": m.role,
        "status": m.status,
        "server_id": m.server_id,
        "port": m.port,
        "production_url": m.production_url,
        "gpu_nvidia": m.gpu_nvidia != 0,
        "gpu_dri": m.gpu_dri != 0,
        "internal_url": format!("http://{}:{}", m.role, if m.port <= 0 { 3000 } else { m.port }),
    })
}

async fn list_groups(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let workspace = workspace_uuid(&state, &headers).await?;
    let groups = sqlx::query_as::<_, GroupRow>(
        "SELECT uuid, workspace_uuid, name, slug, domain_apex, created_at, updated_at FROM app_groups WHERE workspace_uuid = $1 ORDER BY name",
    )
    .bind(&workspace)
    .fetch_all(&state.pool)
    .await
    .map_err(ApiError::from)?;
    let mut out = Vec::with_capacity(groups.len());
    for group in &groups {
        let members = load_members(&state, &group.uuid).await?;
        out.push(group_json(group, &members));
    }
    Ok(Json(json!({ "data": out })))
}

#[derive(Deserialize)]
struct CreateGroup {
    name: String,
}

async fn create_group(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateGroup>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let workspace = workspace_uuid(&state, &headers).await?;
    let name = body.name.trim();
    if name.is_empty() {
        return Err(ApiError::message("Nom de groupe requis."));
    }
    let uuid = new_uuid();
    let base = slugify(name);
    let base = if base.is_empty() {
        format!("groupe-{}", &uuid.replace('-', "")[..4])
    } else {
        base
    };
    let slug = unique_slug(&state, &workspace, &base).await?;
    let now = now_str();
    sqlx::query(
        r#"INSERT INTO app_groups (uuid, workspace_uuid, name, slug, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6)"#,
    )
    .bind(&uuid)
    .bind(&workspace)
    .bind(name)
    .bind(&slug)
    .bind(&now)
    .bind(&now)
    .execute(&state.pool)
    .await
    .map_err(ApiError::from)?;
    let group = load_group(&state, &workspace, &uuid).await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({ "data": group_json(&group, &[]) })),
    ))
}

async fn unique_slug(state: &AppState, workspace: &str, base: &str) -> Result<String, ApiError> {
    let mut candidate = base.to_string();
    let mut n = 2i32;
    loop {
        let exists: Option<(String,)> =
            sqlx::query_as("SELECT slug FROM app_groups WHERE workspace_uuid = $1 AND slug = $2")
                .bind(workspace)
                .bind(&candidate)
                .fetch_optional(&state.pool)
                .await
                .map_err(ApiError::from)?;
        if exists.is_none() {
            return Ok(candidate);
        }
        candidate = format!("{base}-{n}");
        n += 1;
        if n > 50 {
            return Err(ApiError::message(
                "Impossible de choisir un slug de groupe.",
            ));
        }
    }
}

async fn get_group(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let workspace = workspace_uuid(&state, &headers).await?;
    let group = load_group(&state, &workspace, &uuid).await?;
    let members = load_members(&state, &group.uuid).await?;
    Ok(Json(json!({ "data": group_json(&group, &members) })))
}

#[derive(Deserialize)]
struct PatchGroup {
    name: Option<String>,
    domain_apex: Option<String>,
}

async fn retarget_inherited_members(
    state: &AppState,
    group_uuid: &str,
    old_apex: &str,
    new_apex: &str,
) -> Result<(), ApiError> {
    let primary = crate::domain_catalog::primary_apex(&state.pool).await;
    let rows = sqlx::query_as::<_, (String, String, Option<String>, i64)>(
        r#"SELECT p.uuid, p.slug, p.production_url, p.port
           FROM projects p
           JOIN app_group_members m ON m.project_uuid = p.uuid
           WHERE m.group_uuid = $1 AND trim(p.domain_apex) = ''"#,
    )
    .bind(group_uuid)
    .fetch_all(&state.pool)
    .await
    .map_err(ApiError::from)?;
    let now = now_str();
    for (uuid, slug, url, port) in rows {
        let current = url.unwrap_or_default();
        let inherited = current.trim().is_empty()
            || (!old_apex.is_empty() && crate::domain_catalog::host_under_apex(&current, old_apex))
            || (old_apex.is_empty()
                && !primary.is_empty()
                && crate::domain_catalog::host_under_apex(&current, &primary));
        if !inherited {
            continue;
        }
        let next = crate::domain_catalog::url_for_zone(&current, &slug, new_apex);
        if next == current {
            continue;
        }
        sqlx::query("UPDATE projects SET production_url = $1, updated_at = $2 WHERE uuid = $3")
            .bind(&next)
            .bind(&now)
            .bind(&uuid)
            .execute(&state.pool)
            .await
            .map_err(ApiError::from)?;
        let _ =
            crate::routes::ensure_project_primary_domain(state, &uuid, &next, port.max(1) as u16)
                .await;
    }
    Ok(())
}

async fn update_group(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Json(body): Json<PatchGroup>,
) -> Result<Json<Value>, ApiError> {
    let workspace = workspace_uuid(&state, &headers).await?;
    let group = load_group(&state, &workspace, &uuid).await?;
    let name = body
        .name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(group.name.as_str())
        .to_string();
    let domain_apex = match &body.domain_apex {
        Some(raw) if raw.trim().is_empty() => String::new(),
        Some(raw) => {
            let apex = crate::domain_catalog::normalize_apex(raw).map_err(ApiError::message)?;
            if !crate::domain_catalog::contains(&state.pool, &apex).await {
                return Err(ApiError::message(
                    "ajoute d'abord ce domaine dans les domaines de l'instance",
                ));
            }
            apex
        }
        None => group.domain_apex.clone(),
    };
    let now = now_str();
    sqlx::query(
        "UPDATE app_groups SET name = $1, domain_apex = $2, updated_at = $3 WHERE uuid = $4",
    )
    .bind(&name)
    .bind(&domain_apex)
    .bind(&now)
    .bind(&uuid)
    .execute(&state.pool)
    .await
    .map_err(ApiError::from)?;
    if body.domain_apex.is_some() && domain_apex != group.domain_apex && !domain_apex.is_empty() {
        retarget_inherited_members(&state, &uuid, &group.domain_apex, &domain_apex).await?;
    }
    let group = load_group(&state, &workspace, &uuid).await?;
    let members = load_members(&state, &group.uuid).await?;
    Ok(Json(json!({ "data": group_json(&group, &members) })))
}

async fn delete_group(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let workspace = workspace_uuid(&state, &headers).await?;
    let res = sqlx::query("DELETE FROM app_groups WHERE uuid = $1 AND workspace_uuid = $2")
        .bind(&uuid)
        .bind(&workspace)
        .execute(&state.pool)
        .await
        .map_err(ApiError::from)?;
    if res.rows_affected() == 0 {
        return Err(ApiError::not_found("group"));
    }
    Ok(Json(json!({ "ok": true, "deleted": uuid })))
}

#[derive(Deserialize)]
struct MemberBody {
    project_uuid: String,
    role: String,
}

async fn add_member(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Json(body): Json<MemberBody>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let workspace = workspace_uuid(&state, &headers).await?;
    let group = load_group(&state, &workspace, &uuid).await?;
    let role = normalize_role(&body.role)?;
    let (_user, _ws, project) =
        crate::routes::auth_project(&state, &headers, body.project_uuid.trim()).await?;
    if let Some(existing) = membership(&state.pool, &project.uuid).await {
        if existing.group_uuid != group.uuid {
            return Err(ApiError::message(
                "Ce projet appartient déjà à un autre groupe.",
            ));
        }
        return Err(ApiError::message("Ce projet est déjà dans le groupe."));
    }
    ensure_member_node(&state, &group.uuid, project.server_id.as_deref()).await?;
    ensure_role_free(&state, &group.uuid, &role, None).await?;
    sqlx::query(
        "INSERT INTO app_group_members (group_uuid, project_uuid, role) VALUES ($1, $2, $3)",
    )
    .bind(&group.uuid)
    .bind(&project.uuid)
    .bind(&role)
    .execute(&state.pool)
    .await
    .map_err(ApiError::from)?;
    let members = load_members(&state, &group.uuid).await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({ "data": group_json(&group, &members) })),
    ))
}

#[derive(Deserialize)]
struct PatchMember {
    role: String,
}

async fn update_member(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((uuid, project_uuid)): Path<(String, String)>,
    Json(body): Json<PatchMember>,
) -> Result<Json<Value>, ApiError> {
    let workspace = workspace_uuid(&state, &headers).await?;
    let group = load_group(&state, &workspace, &uuid).await?;
    let _ = crate::routes::auth_project(&state, &headers, &project_uuid).await?;
    let role = normalize_role(&body.role)?;
    ensure_role_free(&state, &group.uuid, &role, Some(&project_uuid)).await?;
    let res = sqlx::query(
        "UPDATE app_group_members SET role = $1 WHERE group_uuid = $2 AND project_uuid = $3",
    )
    .bind(&role)
    .bind(&group.uuid)
    .bind(&project_uuid)
    .execute(&state.pool)
    .await
    .map_err(ApiError::from)?;
    if res.rows_affected() == 0 {
        return Err(ApiError::not_found("member"));
    }
    let members = load_members(&state, &group.uuid).await?;
    Ok(Json(json!({ "data": group_json(&group, &members) })))
}

async fn remove_member(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((uuid, project_uuid)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    let workspace = workspace_uuid(&state, &headers).await?;
    let group = load_group(&state, &workspace, &uuid).await?;
    let res =
        sqlx::query("DELETE FROM app_group_members WHERE group_uuid = $1 AND project_uuid = $2")
            .bind(&group.uuid)
            .bind(&project_uuid)
            .execute(&state.pool)
            .await
            .map_err(ApiError::from)?;
    if res.rows_affected() == 0 {
        return Err(ApiError::not_found("member"));
    }
    let members = load_members(&state, &group.uuid).await?;
    Ok(Json(json!({ "data": group_json(&group, &members) })))
}

async fn ensure_role_free(
    state: &AppState,
    group_uuid: &str,
    role: &str,
    except_project: Option<&str>,
) -> Result<(), ApiError> {
    let taken: Option<(String,)> = sqlx::query_as(
        "SELECT project_uuid FROM app_group_members WHERE group_uuid = $1 AND role = $2",
    )
    .bind(group_uuid)
    .bind(role)
    .fetch_optional(&state.pool)
    .await
    .map_err(ApiError::from)?;
    if let Some((owner,)) = taken {
        if except_project != Some(owner.as_str()) {
            return Err(ApiError::message(format!(
                "Le rôle « {role} » est déjà utilisé dans ce groupe."
            )));
        }
    }
    Ok(())
}

async fn ensure_member_node(
    state: &AppState,
    group_uuid: &str,
    candidate: Option<&str>,
) -> Result<(), ApiError> {
    let rows: Vec<(Option<String>,)> = sqlx::query_as(
        r#"SELECT p.server_id
           FROM app_group_members m
           JOIN projects p ON p.uuid = m.project_uuid
           WHERE m.group_uuid = $1"#,
    )
    .bind(group_uuid)
    .fetch_all(&state.pool)
    .await
    .map_err(ApiError::from)?;
    let want = normalize_server(candidate);
    if rows
        .iter()
        .any(|(id,)| normalize_server(id.as_deref()) != want)
    {
        return Err(ApiError::message(
            "Cette app est sur un autre nœud que le groupe. Aligne le nœud avant de la relier.",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_lines_use_role_alias_and_public_url() {
        let lines = group_env_lines(
            "popcorn",
            "client",
            &[
                ("web".into(), 3000, Some("https://popcorn.example".into())),
                ("client".into(), 4321, None),
                ("server".into(), 8080, None),
            ],
        );
        let map: std::collections::HashMap<_, _> = lines.into_iter().collect();
        assert_eq!(map.get("DF_GROUP").map(String::as_str), Some("popcorn"));
        assert_eq!(map.get("DF_ROLE").map(String::as_str), Some("client"));
        assert_eq!(
            map.get("DF_SERVER_URL").map(String::as_str),
            Some("http://server:8080")
        );
        assert_eq!(
            map.get("DF_WEB_PUBLIC_URL").map(String::as_str),
            Some("https://popcorn.example")
        );
        assert!(map.get("DF_CLIENT_PUBLIC_URL").is_none());
    }

    #[test]
    fn apply_env_overrides_managed_keys_only() {
        let lines = group_env_lines("popcorn", "server", &[("server".into(), 8080, None)]);
        let merged = apply_group_env(Some("FOO=bar\nDF_SERVER_URL=http://old\n"), &lines).unwrap();
        assert!(merged.contains("FOO=bar"));
        assert!(merged.contains("DF_SERVER_URL=http://server:8080"));
        assert!(!merged.contains("http://old"));
    }

    #[test]
    fn hyphenated_role_becomes_env_token() {
        assert_eq!(role_env_token("hls-reader"), "HLS_READER");
        assert_eq!(group_network_name("popcorn"), "dfg-popcorn");
    }
}
