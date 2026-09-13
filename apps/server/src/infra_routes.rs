//! Project infra routes: ports, domains, proxy, wireguard, deploy lifecycle, github versions.

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::state::{AppState, Project};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/projects/{uuid}/ports", get(list_ports).post(upsert_port))
        .route(
            "/api/v1/projects/{uuid}/ports/{id}",
            axum::routing::delete(delete_port),
        )
        .route(
            "/api/v1/projects/{uuid}/domains",
            get(list_domains).post(attach_domain),
        )
        .route(
            "/api/v1/projects/{uuid}/domains/{id}",
            axum::routing::delete(detach_domain),
        )
        .route(
            "/api/v1/projects/{uuid}/domains/{id}/primary",
            post(set_primary_domain),
        )
        .route(
            "/api/v1/projects/{uuid}/domains/primary",
            post(set_primary_domain_fqdn),
        )
        .route(
            "/api/v1/projects/{uuid}/proxy/routes",
            get(list_proxy).post(upsert_proxy),
        )
        .route(
            "/api/v1/projects/{uuid}/proxy/sync",
            post(sync_proxy),
        )
        .route(
            "/api/v1/projects/{uuid}/lifecycle/{action}",
            post(lifecycle),
        )
        .route("/api/v1/projects/{uuid}/status", get(project_status))
        .route(
            "/api/v1/projects/{uuid}/agents",
            get(list_agents).post(create_agent),
        )
        .route(
            "/api/v1/projects/{uuid}/agents/{agent_uuid}",
            axum::routing::patch(rename_agent),
        )
        .route(
            "/api/v1/projects/{uuid}/agents/{agent_uuid}/messages",
            get(list_agent_messages).delete(clear_agent_messages),
        )
        .route("/api/v1/wireguard/networks", get(list_wg).post(create_wg))
        .route(
            "/api/v1/wireguard/networks/{id}/peers",
            post(add_wg_peer),
        )
        .route(
            "/api/v1/wireguard/networks/{id}/apply",
            post(apply_wg),
        )
        .route("/api/v1/storage/buckets", get(list_buckets))
        .route(
            "/api/v1/storage/buckets/{bucket}/objects",
            get(list_objects).post(put_object),
        )
        .route(
            "/api/v1/projects/{uuid}/backups",
            get(list_backups).post(create_backup),
        )
        .route(
            "/api/v1/projects/{uuid}/backups/{id}/restore-preview",
            post(restore_preview),
        )
        .route("/api/v1/github/status", get(gh_status))
        .route(
            "/api/v1/github/connect",
            post(gh_connect).delete(gh_disconnect),
        )
        .route("/api/v1/github/repos", get(gh_repos))
        .route("/api/v1/github/detect", post(gh_detect))
        .route(
            "/api/v1/github/{owner}/{repo}/branches",
            get(gh_branches),
        )
        .route(
            "/api/v1/projects/{uuid}/detect",
            post(project_detect),
        )
        .route(
            "/api/v1/github/{owner}/{repo}/tags",
            get(gh_tags),
        )
        .route(
            "/api/v1/github/{owner}/{repo}/commits",
            get(gh_commits),
        )
        .route(
            "/api/v1/github/{owner}/{repo}/releases",
            get(gh_releases),
        )
        .route("/api/v1/webhooks/github", post(github_webhook))
}

#[allow(dead_code)]
async fn fetch_project(state: &AppState, uuid: &str) -> Result<Project, (axum::http::StatusCode, Json<Value>)> {
    sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE uuid = ?")
        .bind(uuid)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"ok": false, "error": e.to_string()})),
            )
        })?
        .ok_or_else(|| {
            (
                axum::http::StatusCode::NOT_FOUND,
                Json(json!({"ok": false, "error": "project not found"})),
            )
        })
}

async fn auth_project(
    state: &AppState,
    headers: &HeaderMap,
    uuid: &str,
) -> Result<Project, (axum::http::StatusCode, Json<Value>)> {
    let (_user, workspace) = crate::auth_routes::current_workspace(state, headers).await?;
    sqlx::query_as::<_, Project>(
        "SELECT * FROM projects WHERE uuid = ? AND workspace_uuid = ?",
    )
    .bind(uuid)
    .bind(&workspace.uuid)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"ok": false, "error": e.to_string()})),
        )
    })?
    .ok_or_else(|| {
        (
            axum::http::StatusCode::NOT_FOUND,
            Json(json!({"ok": false, "error": "project not found"})),
        )
    })
}

async fn require_auth(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<(), (axum::http::StatusCode, Json<Value>)> {
    let _ = crate::auth_routes::current_workspace(state, headers).await?;
    Ok(())
}

fn ctx(p: &Project) -> devforge_shared::ProjectTestContext {
    devforge_shared::ProjectTestContext {
        project_uuid: p.uuid.clone(),
        server_id: p.server_id.clone().unwrap_or_default(),
        workdir: p.workdir.clone().unwrap_or_default(),
        test_command: p.test_command.clone().unwrap_or_default(),
        timeout: None,
    }
}

async fn list_ports(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let _ = auth_project(&state, &headers, &uuid).await?;
    Ok(Json(
        state
            .ports
            .list(&uuid)
            .await
            .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?,
    ))
}

#[derive(Deserialize)]
pub struct UpsertPortBody {
    pub container_port: u16,
    pub public_port: Option<u16>,
    pub protocol: Option<String>,
    pub public: Option<bool>,
}

async fn upsert_port(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Json(body): Json<UpsertPortBody>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let _ = auth_project(&state, &headers, &uuid).await?;
    Ok(Json(
        state
            .ports
            .upsert(
                &uuid,
                body.container_port,
                body.public_port,
                body.protocol.as_deref(),
                body.public.unwrap_or(true),
            )
            .await
            .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?,
    ))
}

async fn delete_port(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((uuid, id)): Path<(String, String)>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let _ = auth_project(&state, &headers, &uuid).await?;
    Ok(Json(
        state
            .ports
            .delete(&uuid, &id)
            .await
            .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?,
    ))
}

async fn list_domains(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let project = auth_project(&state, &headers, &uuid).await?;
    // Rehydrate domaine principal depuis production_url
    if let Some(ref url) = project.production_url {
        if let Some(fqdn) = normalize_fqdn(url) {
            let listed = state.domains.list(&uuid).await.ok();
            let missing = listed
                .as_ref()
                .and_then(|v| v.get("domains").and_then(|d| d.as_array()))
                .map(|arr| {
                    !arr.iter().any(|d| {
                        d.get("fqdn")
                            .and_then(|f| f.as_str())
                            .map(|f| f.eq_ignore_ascii_case(&fqdn))
                            .unwrap_or(false)
                    })
                })
                .unwrap_or(true);
            if missing {
                let _ = state.domains.attach(&uuid, &fqdn, true).await;
            }
            crate::routes::ensure_all_domain_proxy_routes(
                &state,
                &uuid,
                &fqdn,
                project.port.clamp(1, 65535) as u16,
            )
            .await;
        }
    }

    let mut payload = state
        .domains
        .list(&uuid)
        .await
        .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?;

    let primary_fqdn = project
        .production_url
        .as_deref()
        .and_then(normalize_fqdn);
    if let Some(arr) = payload.get_mut("domains").and_then(|d| d.as_array_mut()) {
        for d in arr.iter_mut() {
            let is_primary = d
                .get("fqdn")
                .and_then(|f| f.as_str())
                .zip(primary_fqdn.as_deref())
                .map(|(f, p)| f.eq_ignore_ascii_case(p))
                .unwrap_or(false);
            if let Some(obj) = d.as_object_mut() {
                obj.insert("is_primary".into(), json!(is_primary));
            }
        }
        // Domaine principal en premier
        arr.sort_by_key(|d| {
            !d.get("is_primary")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
        });
    }
    if let Some(obj) = payload.as_object_mut() {
        obj.insert("primary_fqdn".into(), json!(primary_fqdn));
        obj.insert(
            "production_url".into(),
            json!(project.production_url.clone()),
        );
    }
    Ok(Json(payload))
}

fn normalize_fqdn(raw: &str) -> Option<String> {
    let host = raw
        .trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .split('/')
        .next()
        .unwrap_or("")
        .trim()
        .trim_end_matches('.')
        .to_lowercase();
    if host.is_empty() || !host.contains('.') {
        None
    } else {
        Some(host)
    }
}

async fn apply_primary_fqdn(
    state: &AppState,
    project: &Project,
    fqdn_raw: &str,
) -> Result<String, (axum::http::StatusCode, Json<Value>)> {
    let fqdn = normalize_fqdn(fqdn_raw).ok_or_else(|| {
        (
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({"error": "fqdn invalide"})),
        )
    })?;
    let url = format!("https://{fqdn}");
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query("UPDATE projects SET production_url = ?, updated_at = ? WHERE uuid = ?")
        .bind(&url)
        .bind(&now)
        .bind(&project.uuid)
        .execute(&state.pool)
        .await
        .map_err(|e| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": e.to_string()})),
            )
        })?;
    crate::routes::ensure_project_primary_domain(
        state,
        &project.uuid,
        &url,
        project.port.clamp(1, 65535) as u16,
    )
    .await
    .map_err(|e| (e.status, Json(json!({"error": e.message}))))?;
    Ok(fqdn)
}

#[derive(Deserialize)]
pub struct AttachDomainBody {
    pub fqdn: String,
    pub tls: Option<bool>,
    /// Défaut true : un domaine ajouté manuellement devient le principal.
    pub primary: Option<bool>,
}

async fn attach_domain(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Json(body): Json<AttachDomainBody>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let project = auth_project(&state, &headers, &uuid).await?;
    let as_primary = body.primary.unwrap_or(true);
    let mut out = state
        .domains
        .attach(&uuid, &body.fqdn, body.tls.unwrap_or(true))
        .await
        .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?;

    if as_primary {
        let fqdn = apply_primary_fqdn(&state, &project, &body.fqdn).await?;
        if let Some(obj) = out.as_object_mut() {
            obj.insert("primary".into(), json!(true));
            obj.insert("primary_fqdn".into(), json!(fqdn));
        }
    } else if let Some(fqdn) = normalize_fqdn(&body.fqdn) {
        // Alias : sync toutes les routes (primary inchangé + nouvel host)
        let primary = project
            .production_url
            .as_deref()
            .and_then(normalize_fqdn)
            .unwrap_or_else(|| fqdn.clone());
        crate::routes::ensure_all_domain_proxy_routes(
            &state,
            &uuid,
            &primary,
            project.port.clamp(1, 65535) as u16,
        )
        .await;
        crate::sso::sync_project_proxy(&state, &project).await;
    }
    Ok(Json(out))
}

async fn detach_domain(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((uuid, id)): Path<(String, String)>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let project = auth_project(&state, &headers, &uuid).await?;
    let listed = state.domains.list(&uuid).await.ok();
    let detached_fqdn = listed
        .as_ref()
        .and_then(|v| v.get("domains").and_then(|d| d.as_array()))
        .and_then(|arr| {
            arr.iter().find(|d| d.get("id").and_then(|i| i.as_str()) == Some(id.as_str()))
        })
        .and_then(|d| d.get("fqdn").and_then(|f| f.as_str()).map(|s| s.to_string()));

    let out = state
        .domains
        .detach(&uuid, &id)
        .await
        .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?;

    // Si on retire le principal, basculer vers un autre domaine restant (sinon clear).
    let primary = project
        .production_url
        .as_deref()
        .and_then(normalize_fqdn);
    if primary
        .as_ref()
        .zip(detached_fqdn.as_ref())
        .is_some_and(|(p, d)| p.eq_ignore_ascii_case(d))
    {
        let remaining = state
            .domains
            .list(&uuid)
            .await
            .ok()
            .and_then(|v| {
                v.get("domains")
                    .and_then(|d| d.as_array())
                    .and_then(|arr| {
                        arr.iter()
                            .filter_map(|d| d.get("fqdn").and_then(|f| f.as_str()).map(|s| s.to_string()))
                            .next()
                    })
            });
        if let Some(next) = remaining {
            let _ = apply_primary_fqdn(&state, &project, &next).await;
        } else {
            let now = chrono::Utc::now().to_rfc3339();
            let _ = sqlx::query(
                "UPDATE projects SET production_url = NULL, updated_at = ? WHERE uuid = ?",
            )
            .bind(&now)
            .bind(&uuid)
            .execute(&state.pool)
            .await;
            // Plus de domaines : retirer toutes les routes proxy orphelines
            crate::routes::ensure_all_domain_proxy_routes(
                &state,
                &uuid,
                "",
                project.port.clamp(1, 65535) as u16,
            )
            .await;
            crate::sso::sync_project_proxy(&state, &project).await;
        }
    } else if let Some(ref kept_primary) = primary {
        // Alias retiré : resync les routes restantes (primary + autres alias)
        crate::routes::ensure_all_domain_proxy_routes(
            &state,
            &uuid,
            kept_primary,
            project.port.clamp(1, 65535) as u16,
        )
        .await;
        crate::sso::sync_project_proxy(&state, &project).await;
    }
    Ok(Json(out))
}

async fn set_primary_domain(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((uuid, id)): Path<(String, String)>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let project = auth_project(&state, &headers, &uuid).await?;
    let listed = state
        .domains
        .list(&uuid)
        .await
        .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?;
    let fqdn = listed
        .get("domains")
        .and_then(|d| d.as_array())
        .and_then(|arr| {
            arr.iter().find(|d| d.get("id").and_then(|i| i.as_str()) == Some(id.as_str()))
        })
        .and_then(|d| d.get("fqdn").and_then(|f| f.as_str()))
        .ok_or_else(|| {
            (
                axum::http::StatusCode::NOT_FOUND,
                Json(json!({"error": "domaine introuvable"})),
            )
        })?;
    let primary_fqdn = apply_primary_fqdn(&state, &project, fqdn).await?;
    Ok(Json(json!({
        "ok": true,
        "primary_fqdn": primary_fqdn,
        "production_url": format!("https://{primary_fqdn}"),
    })))
}

#[derive(Deserialize)]
pub struct PrimaryFqdnBody {
    pub fqdn: String,
}

async fn set_primary_domain_fqdn(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Json(body): Json<PrimaryFqdnBody>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let project = auth_project(&state, &headers, &uuid).await?;
    let primary_fqdn = apply_primary_fqdn(&state, &project, &body.fqdn).await?;
    Ok(Json(json!({
        "ok": true,
        "primary_fqdn": primary_fqdn,
        "production_url": format!("https://{primary_fqdn}"),
    })))
}

async fn list_proxy(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let _ = auth_project(&state, &headers, &uuid).await?;
    Ok(Json(
        state
            .proxy
            .list(&uuid)
            .await
            .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?,
    ))
}

#[derive(Deserialize)]
pub struct ProxyBody {
    pub host: String,
    pub path_prefix: Option<String>,
    pub target_port: u16,
    pub https_redirect: Option<bool>,
}

async fn upsert_proxy(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Json(body): Json<ProxyBody>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let _ = auth_project(&state, &headers, &uuid).await?;
    Ok(Json(
        state
            .proxy
            .upsert(devforge_proxy::ProxyRoute {
                id: String::new(),
                project_uuid: uuid,
                host: body.host,
                path_prefix: body.path_prefix.unwrap_or_else(|| "/".into()),
                target_port: body.target_port,
                https_redirect: body.https_redirect.unwrap_or(true),
            })
            .await
            .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?,
    ))
}

async fn sync_proxy(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let project = auth_project(&state, &headers, &uuid).await?;
    let settings = crate::sso::load_sso_settings(&state.pool).await;
    let addr = if crate::sso::should_protect_project(&settings, &project) {
        settings.effective_forward_auth_address()
    } else {
        None
    };
    Ok(Json(
        state
            .proxy
            .sync_with(&uuid, addr.as_deref())
            .await
            .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?,
    ))
}

async fn lifecycle(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((uuid, action)): Path<(String, String)>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let project = auth_project(&state, &headers, &uuid).await?;
    let c = ctx(&project);
    let out = match action.as_str() {
        "build" => state.deploy.build(&c, None).await,
        "start" => state.deploy.start(&c).await,
        "stop" => state.deploy.stop(&c).await,
        "restart" => state.deploy.restart(&c).await,
        _ => {
            return Err((
                axum::http::StatusCode::BAD_REQUEST,
                Json(json!({"ok": false, "error": "action must be build|start|stop|restart"})),
            ))
        }
    };
    let ok = out.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
    if ok {
        let next = match action.as_str() {
            "stop" => Some("stopped"),
            "start" | "restart" => Some("live"),
            _ => None,
        };
        if let Some(st) = next {
            let _ = sqlx::query("UPDATE projects SET status = ?, updated_at = ? WHERE uuid = ?")
                .bind(st)
                .bind(chrono::Utc::now().to_rfc3339())
                .bind(&uuid)
                .execute(&state.pool)
                .await;
        }
    }
    Ok(Json(json!({"data": out})))
}

async fn project_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let project = auth_project(&state, &headers, &uuid).await?;
    let status = state.deploy.status(&ctx(&project)).await;
    Ok(Json(json!({"data": status})))
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
struct AgentRow {
    uuid: String,
    project_uuid: String,
    name: String,
    role: String,
    kind: String,
    parent_agent_uuid: Option<String>,
    status: String,
    updated_at: String,
}

async fn list_agents(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let _ = auth_project(&state, &headers, &uuid).await?;
    crate::db::seed_required_agents(&state.pool, &uuid)
        .await
        .map_err(|e| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": e.to_string()})),
            )
        })?;
    let rows = sqlx::query_as::<_, AgentRow>(
        r#"SELECT uuid, project_uuid, name, role, kind, parent_agent_uuid, status, updated_at
           FROM project_agents WHERE project_uuid = ?
           ORDER BY updated_at DESC, name"#,
    )
    .bind(&uuid)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;
    Ok(Json(json!({"data": rows})))
}

#[derive(Deserialize)]
pub struct CreateAgentBody {
    pub name: String,
    pub role: Option<String>,
    pub kind: Option<String>,
    pub parent_agent_uuid: Option<String>,
}

async fn create_agent(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Json(body): Json<CreateAgentBody>,
) -> Result<(axum::http::StatusCode, Json<Value>), (axum::http::StatusCode, Json<Value>)> {
    let _ = auth_project(&state, &headers, &uuid).await?;
    let kind = body.kind.unwrap_or_else(|| "custom".into());
    if kind == "required" {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({"ok": false, "error": "kind=required est rÃ©servÃ© au systÃ¨me"})),
        ));
    }
    if kind == "subagent" && body.parent_agent_uuid.as_ref().map(|s| s.is_empty()).unwrap_or(true)
    {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({"ok": false, "error": "subagent nÃ©cessite parent_agent_uuid"})),
        ));
    }
    let agent_uuid = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let role = body.role.unwrap_or_else(|| "custom".into());
    sqlx::query(
        r#"INSERT INTO project_agents (
            uuid, project_uuid, name, role, kind, parent_agent_uuid, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'idle', ?, ?)"#,
    )
    .bind(&agent_uuid)
    .bind(&uuid)
    .bind(&body.name)
    .bind(&role)
    .bind(&kind)
    .bind(&body.parent_agent_uuid)
    .bind(&now)
    .bind(&now)
    .execute(&state.pool)
    .await
    .map_err(|e| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;
    let row = sqlx::query_as::<_, AgentRow>(
        "SELECT uuid, project_uuid, name, role, kind, parent_agent_uuid, status, updated_at FROM project_agents WHERE uuid = ?",
    )
    .bind(&agent_uuid)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;
    Ok((axum::http::StatusCode::CREATED, Json(json!({"data": row}))))
}

#[derive(Debug, serde::Deserialize)]
pub struct RenameAgentBody {
    pub name: String,
}

async fn rename_agent(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((uuid, agent_uuid)): Path<(String, String)>,
    Json(body): Json<RenameAgentBody>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let _ = auth_project(&state, &headers, &uuid).await?;
    let name = body.name.trim();
    if name.is_empty() {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({"ok": false, "error": "name requis"})),
        ));
    }
    let name = name.chars().take(80).collect::<String>();
    let now = chrono::Utc::now().to_rfc3339();
    let res = sqlx::query(
        "UPDATE project_agents SET name = ?, updated_at = ? WHERE uuid = ? AND project_uuid = ?",
    )
    .bind(&name)
    .bind(&now)
    .bind(&agent_uuid)
    .bind(&uuid)
    .execute(&state.pool)
    .await
    .map_err(|e| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;
    if res.rows_affected() == 0 {
        return Err((
            axum::http::StatusCode::NOT_FOUND,
            Json(json!({"ok": false, "error": "agent introuvable"})),
        ));
    }
    let row = sqlx::query_as::<_, AgentRow>(
        "SELECT uuid, project_uuid, name, role, kind, parent_agent_uuid, status, updated_at FROM project_agents WHERE uuid = ?",
    )
    .bind(&agent_uuid)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;
    Ok(Json(json!({"data": row})))
}

#[derive(sqlx::FromRow, serde::Serialize)]
struct AgentMessageRow {
    uuid: String,
    project_uuid: String,
    agent_uuid: String,
    role: String,
    content: String,
    tool_calls_json: String,
    provider: String,
    created_at: String,
}

async fn list_agent_messages(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((uuid, agent_uuid)): Path<(String, String)>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let _ = auth_project(&state, &headers, &uuid).await?;
    let rows = sqlx::query_as::<_, AgentMessageRow>(
        r#"SELECT uuid, project_uuid, agent_uuid, role, content, tool_calls_json, provider, created_at
           FROM agent_messages WHERE project_uuid = ? AND agent_uuid = ?
           ORDER BY id ASC LIMIT 200"#,
    )
    .bind(&uuid)
    .bind(&agent_uuid)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;
    Ok(Json(json!({"data": rows})))
}

async fn clear_agent_messages(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((uuid, agent_uuid)): Path<(String, String)>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let _ = auth_project(&state, &headers, &uuid).await?;
    sqlx::query("DELETE FROM agent_messages WHERE project_uuid = ? AND agent_uuid = ?")
        .bind(&uuid)
        .bind(&agent_uuid)
        .execute(&state.pool)
        .await
        .map_err(|e| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": e.to_string()})),
            )
        })?;
    Ok(Json(json!({"ok": true})))
}


async fn list_wg(State(state): State<AppState>, headers: HeaderMap) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_auth(&state, &headers).await?;
    Ok(Json(
        state
            .wireguard
            .list()
            .await
            .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?,
    ))
}

#[derive(Deserialize)]
pub struct CreateWgBody {
    pub name: String,
    pub subnet: Option<String>,
    pub listen_port: Option<u16>,
}

async fn create_wg(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateWgBody>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_auth(&state, &headers).await?;
    Ok(Json(
        state
            .wireguard
            .create(&body.name, body.subnet.as_deref(), body.listen_port)
            .await
            .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?,
    ))
}

#[derive(Deserialize)]
pub struct AddPeerBody {
    pub name: String,
    pub public_key: String,
    pub allowed_ips: String,
    pub endpoint: Option<String>,
}

async fn add_wg_peer(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<AddPeerBody>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_auth(&state, &headers).await?;
    Ok(Json(
        state
            .wireguard
            .add_peer(
                &id,
                &body.name,
                &body.public_key,
                &body.allowed_ips,
                body.endpoint,
            )
            .await
            .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?,
    ))
}

async fn apply_wg(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_auth(&state, &headers).await?;
    Ok(Json(
        state
            .wireguard
            .apply(&id)
            .await
            .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?,
    ))
}

async fn list_buckets(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_auth(&state, &headers).await?;
    Ok(Json(
        state
            .storage
            .list_buckets()
            .await
            .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?,
    ))
}

async fn list_objects(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(bucket): Path<String>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_auth(&state, &headers).await?;
    Ok(Json(
        state
            .storage
            .list_objects(&bucket, None)
            .await
            .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?,
    ))
}

#[derive(Deserialize)]
pub struct PutObjectBody {
    pub key: String,
    pub size_bytes: Option<u64>,
    pub content_type: Option<String>,
}

async fn put_object(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(bucket): Path<String>,
    Json(body): Json<PutObjectBody>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_auth(&state, &headers).await?;
    Ok(Json(
        state
            .storage
            .put(
                &bucket,
                &body.key,
                body.size_bytes,
                body.content_type.as_deref(),
            )
            .await
            .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?,
    ))
}

async fn list_backups(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let _ = auth_project(&state, &headers, &uuid).await?;
    Ok(Json(
        state
            .backup
            .list(&uuid)
            .await
            .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?,
    ))
}

#[derive(Deserialize)]
pub struct CreateBackupBody {
    pub kind: Option<String>,
}

async fn create_backup(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Json(body): Json<CreateBackupBody>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let _ = auth_project(&state, &headers, &uuid).await?;
    Ok(Json(
        state
            .backup
            .create(&uuid, body.kind.as_deref())
            .await
            .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?,
    ))
}

async fn restore_preview(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((uuid, id)): Path<(String, String)>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let _ = auth_project(&state, &headers, &uuid).await?;
    Ok(Json(
        state
            .backup
            .restore_preview(&uuid, &id)
            .await
            .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?,
    ))
}

async fn gh_tags(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((owner, repo)): Path<(String, String)>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_auth(&state, &headers).await?;
    let tags = state
        .github
        .list_tags(&owner, &repo)
        .await
        .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(json!({"data": tags})))
}

async fn gh_commits(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((owner, repo)): Path<(String, String)>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_auth(&state, &headers).await?;
    let commits = state
        .github
        .list_commits(&owner, &repo, None)
        .await
        .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(json!({"data": commits})))
}

async fn gh_releases(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((owner, repo)): Path<(String, String)>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_auth(&state, &headers).await?;
    let releases = state
        .github
        .list_releases(&owner, &repo)
        .await
        .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(json!({"data": releases})))
}

async fn gh_status(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let (_user, _ws) = crate::auth_routes::current_workspace(&state, &headers).await?;
    let mode = state.github.mode();
    let connected = mode == "http";
    let mut user = Value::Null;
    if connected {
        if let Ok(u) = state.github.current_user().await {
            user = json!({
                "login": u.login,
                "name": u.name,
                "html_url": u.html_url,
                "avatar_url": u.avatar_url,
            });
        }
    }
    Ok(Json(json!({
        "ok": true,
        "connected": connected,
        "mode": mode,
        "user": user,
        "hint": "Colle un Personal Access Token (classic) avec scopes repo + read:org, ou un fine-grained token avec Contents: Read."
    })))
}

#[derive(Deserialize)]
struct GhConnectBody {
    token: String,
}

async fn gh_connect(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<GhConnectBody>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let (user, _ws) = crate::auth_routes::current_workspace(&state, &headers).await?;
    if user.role != "instance_admin" {
        return Err((
            axum::http::StatusCode::FORBIDDEN,
            Json(json!({"error": "RÃ©servÃ© Ã  lâ€™admin instance"})),
        ));
    }
    state.configure_github(&body.token).await.map_err(|e| {
        (
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({"error": e.to_string()})),
        )
    })?;
    let u = state.github.current_user().await.map_err(|e| {
        (
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({"error": e.to_string()})),
        )
    })?;
    Ok(Json(json!({
        "ok": true,
        "connected": true,
        "mode": state.github.mode(),
        "user": {
            "login": u.login,
            "name": u.name,
            "html_url": u.html_url,
            "avatar_url": u.avatar_url,
        }
    })))
}

async fn gh_disconnect(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let (user, _ws) = crate::auth_routes::current_workspace(&state, &headers).await?;
    if user.role != "instance_admin" {
        return Err((
            axum::http::StatusCode::FORBIDDEN,
            Json(json!({"error": "RÃ©servÃ© Ã  lâ€™admin instance"})),
        ));
    }
    state.configure_github("").await.map_err(|e| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;
    Ok(Json(json!({"ok": true, "connected": false, "mode": "off"})))
}

async fn gh_repos(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let (_user, _ws) = crate::auth_routes::current_workspace(&state, &headers).await?;
    if state.github.mode() != "http" {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({"error": "GitHub non connectÃ© â€” configure un token dans Settings"})),
        ));
    }
    let repos = state.github.list_repos().await.map_err(|e| {
        (
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({"error": e.to_string()})),
        )
    })?;
    Ok(Json(json!({"data": repos})))
}

async fn gh_branches(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((owner, repo)): Path<(String, String)>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let (_user, _ws) = crate::auth_routes::current_workspace(&state, &headers).await?;
    let branches = state
        .github
        .list_branches(&owner, &repo)
        .await
        .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e.to_string()}))))?;
    Ok(Json(json!({"data": branches})))
}

#[derive(Deserialize)]
struct GhDetectBody {
    owner: String,
    repo: String,
    branch: Option<String>,
}

async fn gh_detect(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<GhDetectBody>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let (_user, _ws) = crate::auth_routes::current_workspace(&state, &headers).await?;
    if state.github.mode() != "http" {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({"error": "GitHub non connectÃ©"})),
        ));
    }
    let result = crate::detect_svc::detect_github_repo(
        &state.github,
        body.owner.trim(),
        body.repo.trim(),
        body.branch.as_deref(),
    )
    .await
    .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e}))))?;
    Ok(Json(json!({"ok": true, "detection": result})))
}

#[derive(Deserialize)]
struct ProjectDetectBody {
    /// If true, write detection onto the project row.
    apply: Option<bool>,
    /// Prefer GitHub remote over local workdir.
    from_github: Option<bool>,
}

async fn project_detect(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Json(body): Json<ProjectDetectBody>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let (_user, workspace) = crate::auth_routes::current_workspace(&state, &headers).await?;
    let project = auth_project(&state, &headers, &uuid).await?;
    if project.workspace_uuid != workspace.uuid && !project.workspace_uuid.is_empty() {
        return Err((
            axum::http::StatusCode::FORBIDDEN,
            Json(json!({"error": "Projet hors workspace"})),
        ));
    }

    let mut source = String::new();
    let detection = if body.from_github.unwrap_or(true) {
        if let Some(repo_url) = project.git_repository.as_deref() {
            if let Some((owner, repo)) = parse_github_owner_repo(repo_url) {
                source = format!("github:{owner}/{repo}");
                crate::detect_svc::detect_github_repo(
                    &state.github,
                    &owner,
                    &repo,
                    project.git_branch.as_deref(),
                )
                .await
                .map_err(|e| {
                    (
                        axum::http::StatusCode::BAD_REQUEST,
                        Json(json!({"error": e})),
                    )
                })?
            } else {
                source = "workdir".into();
                crate::detect_svc::detect_workdir(
                    project.workdir.as_deref().unwrap_or(""),
                )
            }
        } else {
            source = "workdir".into();
            crate::detect_svc::detect_workdir(project.workdir.as_deref().unwrap_or(""))
        }
    } else {
        source = "workdir".into();
        crate::detect_svc::detect_workdir(project.workdir.as_deref().unwrap_or(""))
    };

    let mut applied = false;
    if body.apply.unwrap_or(false) {
        let now = crate::state::now_str();
        sqlx::query(
            r#"UPDATE projects SET
                build_pack = ?, port = ?, is_static = ?, publish_directory = ?,
                base_directory = ?, docker_compose_location = ?,
                test_command = COALESCE(?, test_command), updated_at = ?
               WHERE uuid = ?"#,
        )
        .bind(&detection.build_pack)
        .bind(i64::from(detection.port))
        .bind(if detection.is_static { 1i64 } else { 0 })
        .bind(&detection.publish_directory)
        .bind(&detection.base_directory)
        .bind(&detection.docker_compose_location)
        .bind(&detection.test_command)
        .bind(&now)
        .bind(&uuid)
        .execute(&state.pool)
        .await
        .map_err(|e| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": e.to_string()})),
            )
        })?;
        let _ = state
            .ports
            .upsert(&uuid, detection.port, None, Some("tcp"), true)
            .await;
        let project_for_url = auth_project(&state, &headers, &uuid).await?;
        if let Ok(Some(url)) = crate::routes::ensure_production_url(&state, &project_for_url).await {
            let _ = crate::routes::ensure_project_primary_domain(
                &state,
                &uuid,
                &url,
                detection.port,
            )
            .await;
        }
        applied = true;
    }

    let project = auth_project(&state, &headers, &uuid).await?;
    Ok(Json(json!({
        "ok": true,
        "source": source,
        "applied": applied,
        "detection": detection,
        "project": project,
    })))
}

pub(crate) fn parse_github_owner_repo(url: &str) -> Option<(String, String)> {
    let u = url.trim().trim_end_matches(".git");
    if let Some(rest) = u.strip_prefix("https://github.com/") {
        let mut parts = rest.split('/');
        let owner = parts.next()?.to_string();
        let repo = parts.next()?.to_string();
        return Some((owner, repo));
    }
    if let Some(rest) = u.strip_prefix("http://github.com/") {
        let mut parts = rest.split('/');
        let owner = parts.next()?.to_string();
        let repo = parts.next()?.to_string();
        return Some((owner, repo));
    }
    if u.matches('/').count() == 1 {
        let mut parts = u.split('/');
        return Some((parts.next()?.into(), parts.next()?.into()));
    }
    None
}

/// GitHub push webhook â†’ deploy matching project (by repo URL / full_name).
async fn github_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    if let Ok(secret) = std::env::var("DEVFORGE_GITHUB_WEBHOOK_SECRET") {
        if !secret.is_empty() {
            let sig = headers
                .get("x-hub-signature-256")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("");
            if !verify_github_sig(&secret, &body, sig) {
                return Err((
                    axum::http::StatusCode::UNAUTHORIZED,
                    Json(json!({"error": "signature invalide"})),
                ));
            }
        } else if !insecure_webhooks_allowed() {
            return Err((
                axum::http::StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({
                    "error": "DEVFORGE_GITHUB_WEBHOOK_SECRET vide — définis un secret ou DEVFORGE_ALLOW_INSECURE_WEBHOOK=1"
                })),
            ));
        }
    } else if !insecure_webhooks_allowed() {
        return Err((
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "DEVFORGE_GITHUB_WEBHOOK_SECRET requis (ou DEVFORGE_ALLOW_INSECURE_WEBHOOK=1 pour lab)"
            })),
        ));
    }
    let event = headers
        .get("x-github-event")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if event != "push" && event != "ping" {
        return Ok(Json(json!({"ok": true, "ignored": event})));
    }
    if event == "ping" {
        return Ok(Json(json!({"ok": true, "pong": true})));
    }

    let payload: Value = serde_json::from_slice(&body).map_err(|e| {
        (
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({"error": e.to_string()})),
        )
    })?;
    let full_name = payload
        .pointer("/repository/full_name")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let html_url = payload
        .pointer("/repository/html_url")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let branch_ref = payload
        .get("ref")
        .and_then(|v| v.as_str())
        .unwrap_or("refs/heads/main");
    let branch = branch_ref.strip_prefix("refs/heads/").unwrap_or(branch_ref);
    let sha = payload
        .pointer("/head_commit/id")
        .and_then(|v| v.as_str())
        .map(|s| s.chars().take(12).collect::<String>());
    let message = payload
        .pointer("/head_commit/message")
        .and_then(|v| v.as_str())
        .unwrap_or("webhook push")
        .lines()
        .next()
        .unwrap_or("webhook push")
        .to_string();

    if full_name.is_empty() && html_url.is_empty() {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({"error": "repository manquant"})),
        ));
    }

    let projects = sqlx::query_as::<_, Project>(
        r#"SELECT * FROM projects
           WHERE git_repository LIKE ? OR git_repository LIKE ? OR git_repository = ?
           ORDER BY updated_at DESC"#,
    )
    .bind(format!("%{full_name}%"))
    .bind(format!("%{html_url}%"))
    .bind(full_name)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;

    let mut deployed = Vec::new();
    for project in projects {
        let proj_branch = project.git_branch.as_deref().unwrap_or("main");
        if proj_branch != branch {
            continue;
        }
        let dep_uuid = crate::state::new_uuid();
        let now = crate::state::now_str();
        let _ = sqlx::query(
            r#"INSERT INTO deployments (
                uuid, project_id, status, git_sha, git_message, logs, finished_at, created_at, updated_at
            ) VALUES (?, ?, 'running', ?, ?, ?, NULL, ?, ?)"#,
        )
        .bind(&dep_uuid)
        .bind(project.id)
        .bind(sha.as_deref().unwrap_or("pending"))
        .bind(&message)
        .bind("[devforge] webhook pushâ€¦\n")
        .bind(&now)
        .bind(&now)
        .execute(&state.pool)
        .await;

        let token: Option<String> = sqlx::query_as::<_, (String,)>(
            "SELECT github_token FROM instance_settings WHERE id = 1",
        )
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten()
        .map(|(t,)| t)
        .filter(|t| !t.trim().is_empty());

        let env_rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT key, value FROM project_env_vars WHERE project_uuid = ? ORDER BY key",
        )
        .bind(&project.uuid)
        .fetch_all(&state.pool)
        .await
        .unwrap_or_default();
        let env_file = if env_rows.is_empty() {
            None
        } else {
            Some(devforge_env::serialize_docker_env_file(&env_rows))
        };

        let req = devforge_deploy::DeployRequest {
            project_uuid: project.uuid.clone(),
            server_id: project.server_id.clone().unwrap_or_else(|| "default".into()),
            workdir: project.workdir.clone().unwrap_or_default(),
            git_repository: project.git_repository.clone().unwrap_or_default(),
            git_branch: proj_branch.into(),
            build_pack: if project.build_pack.is_empty() {
                "nixpacks".into()
            } else {
                project.build_pack.clone()
            },
            port: project.port.clamp(1, 65535) as u16,
            base_directory: project.base_directory.clone(),
            docker_compose_location: project.docker_compose_location.clone(),
            publish_directory: project.publish_directory.clone(),
            is_static: project.is_static != 0,
            github_token: token,
            env_file,
            proxy_labels: crate::routes::proxy_labels_for_project(&state, &project).await,
        };
        let result = state.deploy.deploy(&req).await;
        let finished = crate::state::now_str();
        let status = if result.ok { "ready" } else { "failed" };
        let _ = sqlx::query(
            r#"UPDATE deployments SET status = ?, git_sha = ?, logs = ?, finished_at = ?, updated_at = ?
               WHERE uuid = ?"#,
        )
        .bind(status)
        .bind(result.git_sha.as_deref().or(sha.as_deref()).unwrap_or("unknown"))
        .bind(&result.logs)
        .bind(&finished)
        .bind(&finished)
        .bind(&dep_uuid)
        .execute(&state.pool)
        .await;
        deployed.push(json!({
            "project": project.uuid,
            "deployment": dep_uuid,
            "ok": result.ok,
        }));
    }

    Ok(Json(json!({"ok": true, "deployed": deployed})))
}

fn verify_github_sig(secret: &str, body: &[u8], signature_header: &str) -> bool {
    use sha2::{Digest, Sha256};
    let Some(hex_sig) = signature_header.strip_prefix("sha256=") else {
        return false;
    };
    let key = secret.as_bytes();
    let mut key_buf = key.to_vec();
    if key_buf.len() > 64 {
        key_buf = Sha256::digest(&key_buf).to_vec();
    }
    key_buf.resize(64, 0);
    let mut ipad = [0u8; 64];
    let mut opad = [0u8; 64];
    for i in 0..64 {
        ipad[i] = key_buf[i] ^ 0x36;
        opad[i] = key_buf[i] ^ 0x5c;
    }
    let mut inner = Sha256::new();
    inner.update(ipad);
    inner.update(body);
    let mid = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(opad);
    outer.update(mid);
    let result = outer.finalize();
    let expected: String = result.iter().map(|b| format!("{b:02x}")).collect();
    expected.eq_ignore_ascii_case(hex_sig)
}

fn insecure_webhooks_allowed() -> bool {
    matches!(
        std::env::var("DEVFORGE_ALLOW_INSECURE_WEBHOOK")
            .unwrap_or_default()
            .to_lowercase()
            .as_str(),
        "1" | "true" | "yes"
    )
}
