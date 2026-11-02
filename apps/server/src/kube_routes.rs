//! API du backend Kubernetes (phase 1) : déployer une image déjà construite.
//!
//! Actif seulement avec `DEVFORGE_RUNTIME=kubernetes` (sauf `render`, qui ne touche pas
//! au cluster). Réservé à l'administrateur d'instance. Le backend Docker reste le défaut.

use std::sync::{Arc, OnceLock};
use std::time::Duration;

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::Json,
    routing::{get, post},
    Router,
};
use devforge_kube::{
    runtime::ImageRuntime, spec::AppRef, AppSpec, KubeDefaults, KubeError, KubeRuntime,
};
use devforge_shared::runtime_backend::RuntimeBackend;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::state::AppState;

type ApiError = (StatusCode, Json<Value>);

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/kube/info", get(info))
        .route("/api/v1/kube/render", post(render))
        .route("/api/v1/kube/apps", get(list).post(deploy))
        .route("/api/v1/kube/apps/{name}", get(status).delete(remove))
        .route("/api/v1/kube/apps/{name}/logs", get(logs))
        .route("/api/v1/kube/apps/{name}/stop", post(stop))
        .route("/api/v1/kube/apps/{name}/start", post(start))
        .route("/api/v1/kube/apps/{name}/restart", post(restart))
}

static RUNTIME: OnceLock<Result<Arc<KubeRuntime>, String>> = OnceLock::new();

fn runtime() -> Result<Arc<KubeRuntime>, ApiError> {
    if !RuntimeBackend::from_env().is_kubernetes() {
        return Err((
            StatusCode::CONFLICT,
            Json(json!({
                "error": "Backend Kubernetes inactif (DEVFORGE_RUNTIME=docker). Voir le wiki : Kubernetes.",
                "runtime": "docker",
            })),
        ));
    }
    RUNTIME
        .get_or_init(|| {
            KubeRuntime::from_env()
                .map(Arc::new)
                .map_err(|e| e.to_string())
        })
        .clone()
        .map_err(|e| (StatusCode::SERVICE_UNAVAILABLE, Json(json!({ "error": e }))))
}

fn kube_err(e: KubeError) -> ApiError {
    let code = StatusCode::from_u16(e.http_status()).unwrap_or(StatusCode::BAD_GATEWAY);
    (code, Json(json!({ "error": e.to_string() })))
}

async fn require_admin(state: &AppState, headers: &HeaderMap) -> Result<(), ApiError> {
    let (user, _) = crate::auth_routes::current_workspace(state, headers).await?;
    if user.role != "instance_admin" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({"error": "Réservé à l'administrateur d'instance"})),
        ));
    }
    Ok(())
}

async fn info(State(state): State<AppState>, headers: HeaderMap) -> Result<Json<Value>, ApiError> {
    require_admin(&state, &headers).await?;
    let backend = RuntimeBackend::from_env();
    if !backend.is_kubernetes() {
        return Ok(Json(
            json!({ "runtime": backend.as_str(), "enabled": false }),
        ));
    }
    let rt = runtime()?;
    let d = rt.defaults();
    let version = rt.client().version().await;
    Ok(Json(json!({
        "runtime": backend.as_str(),
        "enabled": true,
        "namespace": d.namespace,
        "namespace_mode": d.namespace_mode,
        "namespace_prefix": d.namespace_prefix,
        "pod_security": d.pod_security,
        "ingress_class": d.ingress_class,
        "image_pull_secret": d.image_pull_secret,
        "cluster_issuer": d.cluster_issuer,
        "reachable": version.is_ok(),
        "server_version": version.as_ref().ok(),
        "error": version.err().map(|e| e.to_string()),
        "build_in_cluster": false,
    })))
}

/// Aperçu des manifests (Secret masqué). Fonctionne aussi en mode Docker.
async fn render(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(mut spec): Json<AppSpec>,
) -> Result<Json<Value>, ApiError> {
    require_admin(&state, &headers).await?;
    spec.normalize()
        .map_err(|e| (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))))?;
    let defaults = KubeDefaults::from_env();
    let rendered = devforge_kube::render(&spec, &defaults);
    Ok(Json(json!({ "data": rendered.redacted() })))
}

/// `?project=<slug>` : app d'un projet (namespace `<préfixe><projet>` en mode per-project).
#[derive(Deserialize, Default)]
struct ProjectQuery {
    project: Option<String>,
}

fn app_ref(name: String, q: &ProjectQuery) -> AppRef {
    AppRef::new(name, q.project.as_deref())
}

async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<ProjectQuery>,
) -> Result<Json<Value>, ApiError> {
    require_admin(&state, &headers).await?;
    let rt = runtime()?;
    let project = q
        .project
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty());
    let apps = rt.list(project).await.map_err(kube_err)?;
    Ok(Json(json!({
        "data": apps,
        "namespace_mode": rt.defaults().namespace_mode,
        "namespace": rt.defaults().namespace_for(project),
    })))
}

#[derive(Deserialize, Default)]
struct DeployQuery {
    /// Attendre la fin du rollout.
    #[serde(default)]
    wait: bool,
    /// Secondes (défaut 120, max 600).
    timeout: Option<u64>,
}

async fn deploy(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<DeployQuery>,
    Json(spec): Json<AppSpec>,
) -> Result<Json<Value>, ApiError> {
    require_admin(&state, &headers).await?;
    let rt = runtime()?;
    let mut spec = spec;
    spec.normalize()
        .map_err(|e| (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))))?;
    let mut outcome = rt.deploy(&spec).await.map_err(kube_err)?;
    if q.wait {
        let secs = q.timeout.unwrap_or(120).clamp(5, 600);
        outcome.status = rt
            .wait_rollout(&spec.app_ref(), Duration::from_secs(secs))
            .await
            .map_err(kube_err)?;
    }
    Ok(Json(json!({ "ok": true, "data": outcome })))
}

async fn status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(name): Path<String>,
    Query(pq): Query<ProjectQuery>,
) -> Result<Json<Value>, ApiError> {
    require_admin(&state, &headers).await?;
    let st = runtime()?
        .status(&app_ref(name, &pq))
        .await
        .map_err(kube_err)?;
    Ok(Json(json!({ "data": st })))
}

#[derive(Deserialize, Default)]
struct LogsQuery {
    tail: Option<u32>,
    project: Option<String>,
}

async fn logs(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(name): Path<String>,
    Query(q): Query<LogsQuery>,
) -> Result<Json<Value>, ApiError> {
    require_admin(&state, &headers).await?;
    let out = runtime()?
        .logs(
            &AppRef::new(name, q.project.as_deref()),
            q.tail.unwrap_or(200),
        )
        .await
        .map_err(kube_err)?;
    Ok(Json(json!({ "data": out })))
}

async fn stop(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(name): Path<String>,
    Query(pq): Query<ProjectQuery>,
) -> Result<Json<Value>, ApiError> {
    require_admin(&state, &headers).await?;
    let st = runtime()?
        .stop(&app_ref(name, &pq))
        .await
        .map_err(kube_err)?;
    Ok(Json(json!({ "ok": true, "data": st })))
}

async fn start(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(name): Path<String>,
    Query(pq): Query<ProjectQuery>,
) -> Result<Json<Value>, ApiError> {
    require_admin(&state, &headers).await?;
    let st = runtime()?
        .start(&app_ref(name, &pq))
        .await
        .map_err(kube_err)?;
    Ok(Json(json!({ "ok": true, "data": st })))
}

async fn restart(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(name): Path<String>,
    Query(pq): Query<ProjectQuery>,
) -> Result<Json<Value>, ApiError> {
    require_admin(&state, &headers).await?;
    let st = runtime()?
        .restart(&app_ref(name, &pq))
        .await
        .map_err(kube_err)?;
    Ok(Json(json!({ "ok": true, "data": st })))
}

async fn remove(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(name): Path<String>,
    Query(pq): Query<ProjectQuery>,
) -> Result<Json<Value>, ApiError> {
    require_admin(&state, &headers).await?;
    let removed = runtime()?
        .remove(&app_ref(name, &pq))
        .await
        .map_err(kube_err)?;
    Ok(Json(json!({ "ok": true, "removed": removed })))
}
