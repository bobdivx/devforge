//! API admin : worker Cursor Self-Hosted (My Machines).
//!
//! `POST /api/v1/cursor-worker/install` fait tout en un clic : enregistre la clé
//! (si fournie), choisit le nœud (leader par défaut), installe le CLI Cursor
//! s'il manque, démarre le worker sur tous les checkouts Git et vérifie qu'il
//! tient. Le reste des réglages est optionnel (« Avancé »).

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::Json,
    routing::{get, post},
    Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::cursor_worker::{self, ScriptBase, WorkerSettings};
use crate::state::AppState;
use devforge_cluster::{NodeRole, NodeStatus};

type ApiErr = (StatusCode, Json<Value>);

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/cursor-worker/status", get(status))
        .route("/api/v1/cursor-worker/install", post(install))
        .route("/api/v1/cursor-worker/start", post(start))
        .route("/api/v1/cursor-worker/stop", post(stop))
        .route("/api/v1/cursor-worker/restart", post(restart))
        .route(
            "/api/v1/cursor-worker/settings",
            get(get_settings).patch(patch_settings),
        )
}

async fn require_admin(state: &AppState, headers: &HeaderMap) -> Result<(), ApiErr> {
    let (user, _) = crate::auth_routes::current_workspace(state, headers).await?;
    if user.role != "instance_admin" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({"error": "Réservé à l'administrateur d'instance"})),
        ));
    }
    Ok(())
}

fn map_err(e: String) -> ApiErr {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({"ok": false, "error": e})),
    )
}

// ───────────────────────── Nœuds ─────────────────────────

/// Nœud candidat pour héberger le worker.
#[derive(Debug, Clone)]
pub struct WorkerNode {
    /// Id stocké dans les réglages (`''` = leader).
    pub id: String,
    /// Id passé à l'executor.
    pub exec_id: String,
    pub name: String,
    pub leader: bool,
    pub online: bool,
}

impl WorkerNode {
    fn to_json(&self) -> Value {
        json!({
            "id": self.id,
            "name": self.name,
            "leader": self.leader,
            "online": self.online,
        })
    }
}

/// Leader en premier (choix par défaut), puis workers.
async fn worker_nodes(state: &AppState) -> Vec<WorkerNode> {
    let nodes = state.cluster.list_nodes().await.unwrap_or_default();
    build_worker_nodes(
        nodes
            .into_iter()
            .map(|n| {
                (
                    n.id,
                    n.name,
                    n.role == NodeRole::Leader,
                    n.status == NodeStatus::Online && !n.drained,
                )
            })
            .collect(),
    )
}

/// Pure : (id, nom, leader, en ligne) → liste ordonnée, leader garanti.
pub fn build_worker_nodes(raw: Vec<(String, String, bool, bool)>) -> Vec<WorkerNode> {
    let mut leader: Option<WorkerNode> = None;
    let mut others = Vec::new();
    for (id, name, is_leader, online) in raw {
        if is_leader {
            if leader.is_none() {
                leader = Some(WorkerNode {
                    id: String::new(),
                    exec_id: "default".into(),
                    name: if name.trim().is_empty() {
                        "Ce serveur".into()
                    } else {
                        name
                    },
                    leader: true,
                    online: true,
                });
            }
        } else {
            others.push(WorkerNode {
                exec_id: id.clone(),
                id,
                name,
                leader: false,
                online,
            });
        }
    }
    others.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    let mut out = vec![leader.unwrap_or_else(|| WorkerNode {
        id: String::new(),
        exec_id: "default".into(),
        name: "Ce serveur".into(),
        leader: true,
        online: true,
    })];
    out.extend(others);
    out
}

/// Nœud ciblé par `node_id` (leader si vide / inconnu-sans-erreur).
pub fn pick_node<'a>(nodes: &'a [WorkerNode], node_id: &str) -> Option<&'a WorkerNode> {
    if cursor_worker::is_leader_target(node_id) {
        return nodes.iter().find(|n| n.leader);
    }
    nodes
        .iter()
        .find(|n| n.id == node_id.trim() || (n.leader && n.exec_id == node_id.trim()))
}

async fn exec_on(
    state: &AppState,
    node: &WorkerNode,
    script: &str,
    timeout: u64,
) -> Result<String, String> {
    if !node.online {
        return Err(format!("Nœud {} hors ligne", node.name));
    }
    let r = state
        .deploy
        .exec(&node.exec_id, "", script, timeout)
        .await
        .map_err(|e| e.to_string())?;
    if !r.ok {
        let rep = cursor_worker::parse_script_output(&r.output);
        let detail = if rep.logs.is_empty() {
            r.output
        } else {
            rep.logs
        };
        return Err(format!(
            "Échec sur {} (code {}) : {}",
            node.name,
            r.exit_code,
            cursor_worker::tail_lines(&detail, 15)
        ));
    }
    Ok(r.output)
}

/// Chemins candidats (projets + extra) pour un nœud distant : l'existence
/// de `.git` est vérifiée sur place par le script.
async fn remote_candidates(state: &AppState, settings: &WorkerSettings) -> Vec<String> {
    let mut out: Vec<String> = cursor_worker::list_project_workdirs(&state.pool)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|d| d.path)
        .collect();
    for extra in cursor_worker::parse_extra_dirs(&settings.extra_dirs) {
        if !out.contains(&extra) {
            out.push(extra);
        }
    }
    out
}

// ───────────────────────── Statut ─────────────────────────

async fn status(State(state): State<AppState>, headers: HeaderMap) -> Result<Json<Value>, ApiErr> {
    require_admin(&state, &headers).await?;
    let settings = cursor_worker::load_settings(&state.pool).await;
    let nodes = worker_nodes(&state).await;
    let node = pick_node(&nodes, &settings.node_id).cloned();
    let nodes_json: Vec<Value> = nodes.iter().map(WorkerNode::to_json).collect();

    let Some(node) = node else {
        return Ok(Json(json!({
            "ok": true,
            "running": false,
            "name": cursor_worker::resolve_worker_name(&settings),
            "cli_installed": false,
            "api_key_set": cursor_worker::effective_api_key(&settings).is_some(),
            "enabled": settings.enabled,
            "node": { "id": settings.node_id, "name": settings.node_id, "leader": false, "online": false },
            "node_missing": true,
            "nodes": nodes_json,
            "settings": settings_json(&settings),
            "workdirs": [],
            "eligible_count": 0,
            "logs_tail": "",
            "hint": "Le nœud choisi n'existe plus : réinstalle le worker sur un autre nœud.",
        })));
    };

    if node.leader {
        let mut v = cursor_worker::status_json(&state.pool, &node.name)
            .await
            .map_err(map_err)?;
        v["node"] = node.to_json();
        v["nodes"] = json!(nodes_json);
        return Ok(Json(v));
    }

    // Nœud distant : sonde via l'executor.
    let key = cursor_worker::effective_api_key(&settings);
    let name = cursor_worker::resolve_worker_name_for_node(&settings, &node.name);
    let probe = exec_on(
        &state,
        &node,
        &cursor_worker::status_script(&ScriptBase::NodeDataDir),
        20,
    )
    .await;
    let (rep, err) = match probe {
        Ok(out) => (cursor_worker::parse_script_output(&out), None),
        Err(e) => (Default::default(), Some(e)),
    };
    let cli = rep.agent.is_some();
    let key_invalid = key.is_some() && cursor_worker::logs_show_invalid_key(&rep.logs);
    Ok(Json(json!({
        "ok": true,
        "running": rep.running,
        "ready": rep.ready,
        "pid": rep.pid,
        "name": name,
        "cli_installed": cli,
        "cli_managed": rep.agent.as_deref().is_some_and(|p| p.contains("/cursor-worker/home/")),
        "cli_path": rep.agent,
        "cli_version": rep.version,
        "api_key_set": key.is_some(),
        "api_key_source": key.as_ref().map(|(_, s)| *s),
        "api_key_masked": key.as_ref().map(|(k, _)| cursor_worker::mask_key(k)),
        "enabled": settings.enabled,
        "settings": settings_json(&settings),
        "node": node.to_json(),
        "nodes": nodes_json,
        "node_error": err,
        "workdirs": [],
        "eligible_count": Value::Null,
        "env_key_present": cursor_worker::env_key_present(),
        "key_invalid": key_invalid,
        "logs_tail": rep.logs,
        "hint": if key_invalid {
            cursor_worker::INVALID_KEY_HINT
        } else {
            cursor_worker::status_hint(cli, key.is_some(), rep.running, rep.ready)
        },
    })))
}

fn settings_json(s: &WorkerSettings) -> Value {
    json!({
        "name": s.name,
        "binary": s.binary,
        "extra_dirs": s.extra_dirs,
        "enabled": s.enabled,
        "node_id": s.node_id,
    })
}

// ───────────────────────── Installation 1 clic ─────────────────────────

#[derive(Deserialize, Default)]
struct InstallBody {
    /// Clé API personnelle Cursor (seulement si aucune n'est enregistrée).
    #[serde(default)]
    api_key: Option<String>,
    /// Nœud cible (`''` = leader, défaut).
    #[serde(default)]
    node_id: Option<String>,
}

fn step(id: &str, label: &str, ok: bool, detail: impl Into<String>) -> Value {
    json!({ "id": id, "label": label, "ok": ok, "detail": detail.into() })
}

async fn save_columns(
    state: &AppState,
    enabled: bool,
    api_key_sealed: &str,
    node_id: &str,
) -> Result<(), ApiErr> {
    sqlx::query(
        r#"UPDATE instance_settings SET
            cursor_worker_enabled = $1,
            cursor_worker_api_key = $2,
            cursor_worker_node = $3,
            updated_at = $4
           WHERE id = 1"#,
    )
    .bind(if enabled { 1i64 } else { 0 })
    .bind(api_key_sealed)
    .bind(node_id)
    .bind(chrono::Utc::now().to_rfc3339())
    .execute(&state.pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;
    Ok(())
}

async fn install(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Option<Json<InstallBody>>,
) -> Result<Json<Value>, ApiErr> {
    require_admin(&state, &headers).await?;
    let body = body.map(|Json(b)| b).unwrap_or_default();
    let mut settings = cursor_worker::load_settings(&state.pool).await;

    // 1. Clé : seule donnée vraiment requise.
    if let Some(k) = body.api_key.as_deref().filter(|k| !k.trim().is_empty()) {
        let k = cursor_worker::validate_api_key(k).map_err(map_err)?;
        settings.api_key_sealed = crate::secret_box::seal_compat(&k);
    }
    // Une clé déjà stockée mais d'un autre fournisseur ne doit pas repartir.
    if let Some((stored, _)) = cursor_worker::effective_api_key(&settings) {
        if let Some(provider) = cursor_worker::foreign_key_provider(&stored) {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "ok": false,
                    "code": "api_key_invalid",
                    "error": format!(
                        "La clé enregistrée est une clé {provider}, pas une clé Cursor. Colle une clé Cursor (cursor.com/dashboard → API Keys)."
                    ),
                })),
            ));
        }
    }
    let Some((api_key, _)) = cursor_worker::effective_api_key(&settings) else {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "ok": false,
                "code": "api_key_required",
                "error": "Clé API Cursor requise (Cursor → Dashboard → API Keys, clé personnelle).",
            })),
        ));
    };

    // 2. Nœud : leader par défaut.
    let nodes = worker_nodes(&state).await;
    let wanted = body
        .node_id
        .clone()
        .unwrap_or_else(|| settings.node_id.clone());
    let node = pick_node(&nodes, &wanted)
        .or_else(|| pick_node(&nodes, ""))
        .cloned()
        .ok_or_else(|| map_err("Aucun nœud disponible".into()))?;
    if !node.online {
        return Err(map_err(format!("Nœud {} hors ligne", node.name)));
    }
    let previous_node = settings.node_id.clone();
    settings.node_id = node.id.clone();
    settings.enabled = true;
    save_columns(&state, true, &settings.api_key_sealed, &settings.node_id).await?;

    let name = cursor_worker::resolve_worker_name_for_node(&settings, &node.name);
    let mut steps = vec![step(
        "settings",
        "Réglages",
        true,
        format!("Nœud {}, nom « {name} », démarrage auto activé", node.name),
    )];

    // Ancien nœud différent : on y arrête le worker (best effort).
    if let Some(old) = pick_node(&nodes, &previous_node) {
        if old.exec_id != node.exec_id {
            let _ = stop_on(&state, old).await;
        }
    }

    let result = if node.leader {
        install_leader(&state, &settings, &name, &mut steps).await
    } else {
        install_remote(&state, &settings, &node, &name, &api_key, &mut steps).await
    };
    let ok = result.is_ok();
    let key_invalid = match &result {
        Err(e) => cursor_worker::logs_show_invalid_key(e),
        Ok(()) => false,
    };
    if let Err(e) = result {
        tracing::warn!(node = %node.name, error = %cursor_worker::tail_lines(&e, 3), "cursor-worker install");
    }
    Ok(Json(json!({
        "ok": ok,
        "key_invalid": key_invalid,
        "node": node.to_json(),
        "name": name,
        "steps": steps,
        "message": if ok {
            format!("Worker « {name} » installé et démarré sur {}", node.name)
        } else if key_invalid {
            cursor_worker::INVALID_KEY_HINT.to_string()
        } else {
            "Installation interrompue — voir le détail des étapes.".to_string()
        },
    })))
}

async fn install_leader(
    state: &AppState,
    settings: &WorkerSettings,
    name: &str,
    steps: &mut Vec<Value>,
) -> Result<(), String> {
    // CLI
    let bin = match cursor_worker::resolve_agent_binary(settings) {
        Some(b) => {
            steps.push(step(
                "cli",
                "CLI Cursor",
                true,
                format!("Déjà présent ({})", b.display()),
            ));
            b
        }
        None => match cursor_worker::install_cli_local().await {
            Ok(_) => match cursor_worker::resolve_agent_binary(settings) {
                Some(b) => {
                    let v = cursor_worker::agent_version(&b).unwrap_or_default();
                    steps.push(step("cli", "CLI Cursor", true, format!("Installé {v}")));
                    b
                }
                None => {
                    let e = "CLI installé mais introuvable (chemin binaire avancé ?)".to_string();
                    steps.push(step("cli", "CLI Cursor", false, e.clone()));
                    return Err(e);
                }
            },
            Err(e) => {
                steps.push(step("cli", "CLI Cursor", false, e.clone()));
                return Err(e);
            }
        },
    };

    // Démarrage (relance si déjà actif, pour prendre la clé / les repos à jour).
    let dirs = cursor_worker::list_project_workdirs(&state.pool)
        .await
        .unwrap_or_default();
    let paths = cursor_worker::eligible_paths(&dirs, &settings.extra_dirs);
    let s2 = settings.clone();
    let n2 = name.to_string();
    let b2 = bin.clone();
    let started =
        tokio::task::spawn_blocking(move || cursor_worker::restart_named(&s2, &b2, &n2, &paths))
            .await
            .map_err(|e| e.to_string())
            .and_then(|r| r);
    match started {
        Ok(v) => {
            let count = v.get("workdirs_count").and_then(Value::as_u64).unwrap_or(0);
            steps.push(step(
                "start",
                "Démarrage",
                true,
                format!(
                    "pid {} · {count} dossier(s)",
                    v.get("pid").cloned().unwrap_or(Value::Null)
                ),
            ));
        }
        Err(e) => {
            steps.push(step(
                "start",
                "Démarrage",
                false,
                cursor_worker::tail_lines(&e, 15),
            ));
            return Err(e);
        }
    }

    // Vérification : process vivant + sonde /readyz (jusqu'à ~12 s).
    let mut ready = false;
    for _ in 0..6 {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        if !cursor_worker::is_running() {
            break;
        }
        if cursor_worker::probe_ready_local().await {
            ready = true;
            break;
        }
    }
    verify_step(
        steps,
        cursor_worker::is_running(),
        ready,
        &cursor_worker::read_logs_tail(15),
    )
}

fn verify_step(
    steps: &mut Vec<Value>,
    running: bool,
    ready: bool,
    logs: &str,
) -> Result<(), String> {
    if !running {
        let e = format!(
            "Le worker s'est arrêté. Vérifie la clé API (personnelle) et l'accès sortant à Cursor.\n{}",
            cursor_worker::tail_lines(logs, 15)
        );
        steps.push(step("verify", "Vérification", false, e.clone()));
        return Err(e);
    }
    steps.push(step(
        "verify",
        "Vérification",
        true,
        if ready {
            "Connecté à Cursor"
        } else {
            "Process actif, connexion à Cursor en cours"
        },
    ));
    Ok(())
}

async fn install_remote(
    state: &AppState,
    settings: &WorkerSettings,
    node: &WorkerNode,
    name: &str,
    api_key: &str,
    steps: &mut Vec<Value>,
) -> Result<(), String> {
    let base = ScriptBase::NodeDataDir;
    match exec_on(state, node, &cursor_worker::install_script(&base), 300).await {
        Ok(out) => {
            let rep = cursor_worker::parse_script_output(&out);
            steps.push(step(
                "cli",
                "CLI Cursor",
                true,
                rep.version.unwrap_or_else(|| "OK".into()),
            ));
        }
        Err(e) => {
            steps.push(step("cli", "CLI Cursor", false, e.clone()));
            return Err(e);
        }
    }
    let candidates = remote_candidates(state, settings).await;
    let script = cursor_worker::start_script(&base, name, &candidates, api_key);
    match exec_on(state, node, &script, 60).await {
        Ok(out) => {
            let rep = cursor_worker::parse_script_output(&out);
            steps.push(step(
                "start",
                "Démarrage",
                rep.running,
                format!(
                    "pid {} · {} dépôt(s)",
                    rep.pid.map(|p| p.to_string()).unwrap_or_else(|| "?".into()),
                    rep.dirs.len()
                ),
            ));
        }
        Err(e) => {
            steps.push(step("start", "Démarrage", false, e.clone()));
            return Err(e);
        }
    }
    let mut last = cursor_worker::ScriptReport::default();
    for _ in 0..4 {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        match exec_on(state, node, &cursor_worker::status_script(&base), 20).await {
            Ok(out) => last = cursor_worker::parse_script_output(&out),
            Err(_) => continue,
        }
        if !last.running || last.ready == Some(true) {
            break;
        }
    }
    verify_step(steps, last.running, last.ready == Some(true), &last.logs)
}

// ───────────────────────── Start / stop / restart ─────────────────────────

async fn target(state: &AppState) -> Result<(WorkerSettings, WorkerNode), ApiErr> {
    let settings = cursor_worker::load_settings(&state.pool).await;
    let nodes = worker_nodes(state).await;
    let node = pick_node(&nodes, &settings.node_id)
        .cloned()
        .ok_or_else(|| map_err("Le nœud du worker n'existe plus : réinstalle-le.".into()))?;
    Ok((settings, node))
}

async fn start_on(
    state: &AppState,
    settings: &WorkerSettings,
    node: &WorkerNode,
) -> Result<Value, String> {
    let name = cursor_worker::resolve_worker_name_for_node(settings, &node.name);
    if node.leader {
        let bin = cursor_worker::resolve_agent_binary(settings).ok_or_else(|| {
            "CLI Cursor absent : utilise « Installer le worker Cursor ».".to_string()
        })?;
        let dirs = cursor_worker::list_project_workdirs(&state.pool).await?;
        let paths = cursor_worker::eligible_paths(&dirs, &settings.extra_dirs);
        let s2 = settings.clone();
        return tokio::task::spawn_blocking(move || {
            cursor_worker::restart_named(&s2, &bin, &name, &paths)
        })
        .await
        .map_err(|e| e.to_string())?;
    }
    let (key, _) = cursor_worker::effective_api_key(settings)
        .ok_or_else(|| "Clé API Cursor manquante.".to_string())?;
    let candidates = remote_candidates(state, settings).await;
    let out = exec_on(
        state,
        node,
        &cursor_worker::start_script(&ScriptBase::NodeDataDir, &name, &candidates, &key),
        60,
    )
    .await?;
    let rep = cursor_worker::parse_script_output(&out);
    Ok(json!({
        "ok": true,
        "running": rep.running,
        "pid": rep.pid,
        "name": name,
        "workdirs_count": rep.dirs.len(),
        "message": format!("Worker « {name} » démarré sur {}", node.name),
    }))
}

async fn stop_on(state: &AppState, node: &WorkerNode) -> Result<Value, String> {
    if node.leader {
        return cursor_worker::stop();
    }
    exec_on(
        state,
        node,
        &cursor_worker::stop_script(&ScriptBase::NodeDataDir),
        30,
    )
    .await?;
    Ok(json!({
        "ok": true,
        "running": false,
        "message": format!("Worker arrêté sur {}", node.name),
    }))
}

async fn start(State(state): State<AppState>, headers: HeaderMap) -> Result<Json<Value>, ApiErr> {
    require_admin(&state, &headers).await?;
    let (settings, node) = target(&state).await?;
    start_on(&state, &settings, &node)
        .await
        .map(Json)
        .map_err(map_err)
}

async fn restart(State(state): State<AppState>, headers: HeaderMap) -> Result<Json<Value>, ApiErr> {
    require_admin(&state, &headers).await?;
    let (settings, node) = target(&state).await?;
    start_on(&state, &settings, &node)
        .await
        .map(Json)
        .map_err(map_err)
}

async fn stop(State(state): State<AppState>, headers: HeaderMap) -> Result<Json<Value>, ApiErr> {
    require_admin(&state, &headers).await?;
    let (_, node) = target(&state).await?;
    stop_on(&state, &node).await.map(Json).map_err(map_err)
}

/// Boot du leader : auto-start sur un nœud distant (le leader est géré par
/// [`cursor_worker::spawn_autostart`]).
pub fn spawn_autostart(state: AppState) {
    tokio::spawn(async move {
        let leader_name = worker_nodes(&state)
            .await
            .into_iter()
            .find(|n| n.leader)
            .map(|n| n.name)
            .unwrap_or_default();
        cursor_worker::spawn_autostart(state.pool.clone(), leader_name);

        tokio::time::sleep(std::time::Duration::from_secs(45)).await;
        let Ok((settings, node)) = target(&state).await else {
            return;
        };
        if !settings.enabled || node.leader || !node.online {
            return;
        }
        let running = exec_on(
            &state,
            &node,
            &cursor_worker::status_script(&ScriptBase::NodeDataDir),
            20,
        )
        .await
        .map(|o| cursor_worker::parse_script_output(&o).running)
        .unwrap_or(true);
        if running {
            return;
        }
        match start_on(&state, &settings, &node).await {
            Ok(_) => tracing::info!(node = %node.name, "cursor-worker autostart distant ok"),
            Err(e) => {
                tracing::warn!(node = %node.name, error = %cursor_worker::tail_lines(&e, 3), "cursor-worker autostart distant")
            }
        }
    });
}

// ───────────────────────── Réglages (Avancé) ─────────────────────────

async fn get_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiErr> {
    require_admin(&state, &headers).await?;
    let s = cursor_worker::load_settings(&state.pool).await;
    Ok(Json(settings_response(&s)))
}

fn settings_response(s: &WorkerSettings) -> Value {
    let key = cursor_worker::effective_api_key(s);
    json!({
        "ok": true,
        "enabled": s.enabled,
        "name": s.name,
        "binary": s.binary,
        "extra_dirs": s.extra_dirs,
        "node_id": s.node_id,
        "resolved_name": cursor_worker::resolve_worker_name(s),
        "api_key_set": key.is_some(),
        "api_key_source": key.as_ref().map(|(_, src)| *src),
        "api_key_masked": key.as_ref().map(|(k, _)| cursor_worker::mask_key(k)),
        "env_key_present": cursor_worker::env_key_present(),
    })
}

#[derive(Deserialize)]
struct PatchBody {
    #[serde(default)]
    enabled: Option<bool>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    binary: Option<String>,
    #[serde(default)]
    extra_dirs: Option<String>,
    #[serde(default)]
    node_id: Option<String>,
    /// Nouvelle clé API (clair). Chaîne vide = effacer. Absent = ne pas toucher.
    #[serde(default)]
    api_key: Option<String>,
}

async fn patch_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<PatchBody>,
) -> Result<Json<Value>, ApiErr> {
    require_admin(&state, &headers).await?;
    if body.enabled.is_none()
        && body.name.is_none()
        && body.binary.is_none()
        && body.extra_dirs.is_none()
        && body.node_id.is_none()
        && body.api_key.is_none()
    {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Rien à modifier"})),
        ));
    }

    let now = chrono::Utc::now().to_rfc3339();
    let current = cursor_worker::load_settings(&state.pool).await;

    let enabled = body.enabled.unwrap_or(current.enabled);
    let name = body
        .name
        .map(|s| s.trim().to_string())
        .unwrap_or(current.name);
    let binary = body
        .binary
        .map(|s| s.trim().to_string())
        .unwrap_or(current.binary);
    let extra_dirs = body.extra_dirs.unwrap_or(current.extra_dirs);
    let node_id = body
        .node_id
        .map(|s| s.trim().to_string())
        .unwrap_or(current.node_id);

    let key_changed = body.api_key.is_some();
    let api_key_sealed = match body.api_key {
        None => current.api_key_sealed,
        Some(k) => {
            if k.trim().is_empty() {
                String::new()
            } else {
                let k = cursor_worker::validate_api_key(&k).map_err(map_err)?;
                crate::secret_box::seal_compat(&k)
            }
        }
    };

    sqlx::query(
        r#"UPDATE instance_settings SET
            cursor_worker_enabled = $1,
            cursor_worker_name = $2,
            cursor_worker_api_key = $3,
            cursor_worker_binary = $4,
            cursor_worker_extra_dirs = $5,
            cursor_worker_node = $6,
            updated_at = $7
           WHERE id = 1"#,
    )
    .bind(if enabled { 1i64 } else { 0 })
    .bind(&name)
    .bind(&api_key_sealed)
    .bind(&binary)
    .bind(&extra_dirs)
    .bind(&node_id)
    .bind(&now)
    .execute(&state.pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;

    if key_changed && cursor_worker::is_leader_target(&node_id) {
        // L'erreur « clé invalide » de l'ancienne clé ne doit plus s'afficher.
        cursor_worker::clear_logs_if_stopped();
    }

    let s = WorkerSettings {
        enabled,
        name,
        api_key_sealed,
        binary,
        extra_dirs,
        node_id,
    };
    Ok(Json(settings_response(&s)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leader_first_and_default() {
        let nodes = build_worker_nodes(vec![
            ("n2".into(), "demeter".into(), false, true),
            ("lead".into(), "ZimaCube".into(), true, true),
            ("n3".into(), "alpha".into(), false, false),
        ]);
        assert!(nodes[0].leader);
        assert_eq!(nodes[0].id, "");
        assert_eq!(nodes[0].exec_id, "default");
        assert_eq!(nodes[0].name, "ZimaCube");
        assert_eq!(nodes[1].name, "alpha");
        assert_eq!(nodes[2].name, "demeter");
        assert_eq!(pick_node(&nodes, "").unwrap().name, "ZimaCube");
        assert_eq!(pick_node(&nodes, "default").unwrap().name, "ZimaCube");
        assert_eq!(pick_node(&nodes, "n2").unwrap().exec_id, "n2");
        assert!(pick_node(&nodes, "ghost").is_none());
    }

    #[test]
    fn no_cluster_still_has_leader() {
        let nodes = build_worker_nodes(vec![]);
        assert_eq!(nodes.len(), 1);
        assert!(nodes[0].leader && nodes[0].online);
        assert_eq!(nodes[0].name, "Ce serveur");
    }

    #[test]
    fn verify_step_reports_failure_with_logs() {
        let mut steps = Vec::new();
        let r = verify_step(&mut steps, false, false, "unauthorized: bad key");
        assert!(r.is_err());
        assert_eq!(steps[0]["ok"], false);
        assert!(steps[0]["detail"]
            .as_str()
            .unwrap()
            .contains("unauthorized"));
        let mut steps = Vec::new();
        assert!(verify_step(&mut steps, true, true, "").is_ok());
        assert_eq!(steps[0]["detail"], "Connecté à Cursor");
    }
}
