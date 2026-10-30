//! Modèles d'agents (playbooks) : une commande, une description, 3 étapes fixes, une règle.
//! Un bouton lance le modèle sur le coordinateur du projet (run ordinaire, mêmes baux SQL).
//! `GET /agent/runs/{run}/live` : carte de progression (étapes, workers, compteurs) et journal
//! « montre-moi ton travail » calculés depuis les événements du run et de ses workers.

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::routes::ApiError;
use crate::state::{now_str, AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/playbooks", get(list_playbooks))
        .route(
            "/api/v1/projects/{project_uuid}/playbooks/{playbook_id}/run",
            post(run_playbook),
        )
        .route("/api/v1/agent/runs/{run_uuid}/live", get(run_live))
}

pub async fn migrate(pool: &sqlx::PgPool) -> Result<(), sqlx::Error> {
    sqlx::query("ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS playbook TEXT NULL")
        .execute(pool)
        .await?;
    Ok(())
}

pub const MISSING_RULE: &str = "Un résultat manquant ne compte jamais comme un succès.";
pub const EVIDENCE_RULE: &str = devforge_agent::decision::EVIDENCE_RULE;

#[derive(Debug, Clone, Serialize)]
pub struct Playbook {
    pub id: &'static str,
    pub slash: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub steps: [&'static str; 3],
    pub rule: &'static str,
    /// Icône / teinte côté interface.
    pub visual: &'static str,
    /// Champ facultatif (une ligne) : libellé et exemple. Vide = aucun champ.
    pub goal_label: &'static str,
    pub goal_placeholder: &'static str,
    /// Étapes 2-3 suivies par les workers délégués (essaim).
    pub uses_workers: bool,
    #[serde(skip)]
    pub instructions: &'static str,
}

pub const PLAYBOOKS: &[Playbook] = &[
    Playbook {
        id: "deploy-verify",
        slash: "/deploy-verify",
        name: "Déployer & vérifier",
        description: "Met l'app en ligne, suit le build jusqu'au bout et vérifie l'adresse publique.",
        steps: [
            "Lancer la mise en ligne",
            "Suivre le build jusqu'au bout",
            "Vérifier l'adresse publique",
        ],
        rule: MISSING_RULE,
        visual: "rocket",
        goal_label: "",
        goal_placeholder: "",
        uses_workers: false,
        instructions: "1) trigger_deploy (si un accord est demandé, attends-le). 2) Suis la mise en ligne avec list_deployments / get_deployment_logs jusqu'à un statut final. 3) http_smoke sur l'adresse publique du projet. Si une étape n'a pas de résultat vérifié, elle est en échec.",
    },
    Playbook {
        id: "investigate-deploy",
        slash: "/figure-it-out",
        name: "Enquêter sur un échec de mise en ligne",
        description: "Lit les logs du dernier échec, trouve la cause avec une preuve et propose le correctif.",
        steps: [
            "Lire les logs du dernier échec",
            "Formuler la cause avec une preuve",
            "Proposer ou appliquer le correctif",
        ],
        rule: EVIDENCE_RULE,
        visual: "search",
        goal_label: "",
        goal_placeholder: "",
        uses_workers: false,
        instructions: "1) list_deployments puis get_deployment_logs du dernier échec (et get_container_logs si l'app tourne). 2) Cause en une phrase, preuve = chemin du fichier fautif ou lien du log. 3) Corrige en local (write_project_file, run_workdir_command pour le build) ou propose le correctif ; ne remets pas en ligne sans accord.",
    },
    Playbook {
        id: "watch-page",
        slash: "/watch-page",
        name: "Surveiller une page",
        description: "Vérifie une page publique et planifie un contrôle récurrent qui t'alerte si elle casse.",
        steps: [
            "Lire la page publique",
            "Vérifier le contenu attendu",
            "Planifier le contrôle récurrent",
        ],
        rule: MISSING_RULE,
        visual: "eye",
        goal_label: "Page à surveiller (facultatif)",
        goal_placeholder: "https://… (par défaut : l'adresse publique de l'app)",
        uses_workers: false,
        instructions: "1) http_smoke sur la page (adresse publique du projet si aucune n'est donnée). 2) Vérifie le statut HTTP et un contenu attendu (titre, texte clé). 3) create_routine : contrôle récurrent de cette page qui alerte en cas d'échec. Adresse interne : refuse.",
    },
    Playbook {
        id: "swarm",
        slash: "/swarm",
        name: "Essaim d'agents parallèles",
        description: "Découpe un objectif en tâches indépendantes et lance un worker par tâche, en parallèle.",
        steps: [
            "Découper en tâches indépendantes",
            "Lancer un worker par tâche",
            "Rassembler les résultats",
        ],
        rule: MISSING_RULE,
        visual: "swarm",
        goal_label: "Objectif (facultatif)",
        goal_placeholder: "Ex. : audit accessibilité, perfs et sécurité du site",
        uses_workers: true,
        instructions: "1) Découpe l'objectif en 2 à 4 tâches indépendantes (pas de fichier partagé). 2) Un delegate_task par tâche, consignes précises et critère de fin vérifiable. 3) Les résultats des workers arrivent en cartes dans le fil : ne les annonce jamais réussis avant leur fin.",
    },
    Playbook {
        id: "reflect",
        slash: "/reflect",
        name: "Retour d'expérience",
        description: "Relit les dernières mises en ligne et retient les leçons utiles en mémoire.",
        steps: [
            "Relire les dernières mises en ligne",
            "Dégager les leçons",
            "Les retenir en mémoire",
        ],
        rule: EVIDENCE_RULE,
        visual: "brain",
        goal_label: "",
        goal_placeholder: "",
        uses_workers: false,
        instructions: "1) list_deployments (5 dernières) et get_deployment_logs des échecs. 2) Au plus 3 leçons, chacune avec sa preuve (lien ou chemin). 3) memory_write pour chaque leçon (portée projet).",
    },
];

pub fn find(id: &str) -> Option<&'static Playbook> {
    PLAYBOOKS.iter().find(|p| p.id == id)
}

/// Objectif d'une ligne : espaces normalisés, borné, sans balise de rôle.
pub fn clean_goal(raw: Option<&str>) -> String {
    let one: String = raw
        .unwrap_or("")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    one.chars().take(300).collect()
}

/// Message envoyé au coordinateur : la commande, les 3 étapes, la règle, le journal.
pub fn prompt(p: &Playbook, goal: &str) -> String {
    let mut s = format!("{} — {}\n", p.slash, p.name);
    if !goal.is_empty() {
        s.push_str(&format!("Objectif : {goal}\n"));
    }
    s.push_str("Étapes (dans l'ordre) :\n");
    for (i, step) in p.steps.iter().enumerate() {
        s.push_str(&format!("{}. {step}\n", i + 1));
    }
    s.push_str(&format!("Règle : {}\n", p.rule));
    s.push_str(&format!("Comment : {}\n", p.instructions));
    s.push_str(
        "Journal : à la fin de chaque étape, appelle record_decision (step = 1, 2 ou 3 ; evidence = un lien ou un chemin ; outcome = ok, failed ou skipped). Une étape sans décision notée est affichée comme manquante.",
    );
    s
}

pub fn catalog_json() -> Value {
    json!(PLAYBOOKS)
}

async fn list_playbooks(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    crate::routes::require_auth(&state, &headers).await?;
    Ok(Json(json!({"data": catalog_json()})))
}

#[derive(Deserialize, Default)]
struct RunBody {
    #[serde(default)]
    goal: Option<String>,
}

async fn run_playbook(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((project_uuid, playbook_id)): Path<(String, String)>,
    body: Option<Json<RunBody>>,
) -> Result<Json<Value>, ApiError> {
    crate::routes::auth_project(&state, &headers, &project_uuid).await?;
    let p = find(&playbook_id).ok_or_else(|| ApiError::not_found("playbook"))?;
    let goal = clean_goal(body.as_ref().and_then(|b| b.goal.as_deref()));
    let agent = crate::db::ensure_coordinator_agent(&state.pool, &project_uuid)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::message("Aucun agent coordinateur pour ce projet."))?;
    let busy: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM agent_runs WHERE agent_uuid = $1 AND status IN ('pending','queued','running')",
    )
    .bind(&agent)
    .fetch_one(&state.pool)
    .await
    .map_err(ApiError::from)?;
    if busy > 0 {
        return Err(ApiError {
            status: StatusCode::CONFLICT,
            message: "L'agent est déjà occupé : attends la fin de son tour en cours.".into(),
        });
    }
    let run_uuid =
        crate::agent_runs::record_user_turn(&state.pool, &project_uuid, &agent, &prompt(p, &goal))
            .await
            .map_err(ApiError::message)?;
    let title = format!("{} · {}", p.slash, p.name);
    sqlx::query("UPDATE agent_runs SET title = $1, playbook = $2, updated_at = $3 WHERE uuid = $4")
        .bind(&title)
        .bind(p.id)
        .bind(now_str())
        .bind(&run_uuid)
        .execute(&state.pool)
        .await
        .map_err(ApiError::from)?;
    crate::run_routes::start_run_now(
        state.clone(),
        project_uuid.clone(),
        agent.clone(),
        run_uuid.clone(),
    );
    Ok(Json(json!({"data": {
        "run_uuid": run_uuid,
        "agent_uuid": agent,
        "playbook": p.id,
        "title": title,
    }})))
}

/* ---------------- Carte live + journal (calcul pur, testé) ---------------- */

#[derive(Debug, Clone, Default)]
pub struct RunLite {
    pub uuid: String,
    pub status: String,
    pub title: Option<String>,
    pub error: Option<String>,
    pub summary: Option<String>,
    pub agent_name: Option<String>,
    pub live: bool,
}

#[derive(Debug, Clone)]
pub struct EventLite {
    pub run_uuid: String,
    pub ty: String,
    pub payload: Value,
}

#[derive(Debug, Clone, Default)]
pub struct ReceiptLite {
    pub uuid: String,
    pub action_label: String,
    pub target: String,
    pub status: String,
    pub detail: Option<String>,
    pub approved_by_label: Option<String>,
    pub created_at: String,
}

fn is_ok_status(s: &str) -> bool {
    s == "completed"
}

fn is_failed_status(s: &str) -> bool {
    matches!(s, "failed" | "cancelled")
}

fn is_terminal(s: &str) -> bool {
    is_ok_status(s) || is_failed_status(s)
}

fn one_line(s: &str, max: usize) -> String {
    let t: String = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if t.chars().count() > max {
        format!("{}…", t.chars().take(max).collect::<String>())
    } else {
        t
    }
}

/// Décisions notées (`record_decision` réussi) dans les événements, dans l'ordre.
pub fn decisions_from_events(
    events: &[EventLite],
    names: &dyn Fn(&str) -> Option<String>,
) -> Vec<Value> {
    events
        .iter()
        .filter(|e| e.ty == "tool_done")
        .filter(|e| e.payload.get("name").and_then(Value::as_str) == Some("record_decision"))
        .filter_map(|e| {
            let r = e.payload.get("result")?;
            if r.get("ok").and_then(Value::as_bool) != Some(true) {
                return None;
            }
            let d = r.get("decision")?;
            let s = |k: &str| d.get(k).and_then(Value::as_str).unwrap_or("").to_string();
            let evidence = s("evidence");
            if !devforge_agent::decision::is_evidence(&evidence) {
                return None;
            }
            Some(json!({
                "source": "agent",
                "run_uuid": e.run_uuid,
                "agent_name": names(&e.run_uuid),
                "what": s("what"),
                "why": s("why"),
                "evidence": evidence,
                "outcome": s("outcome"),
                "step": d.get("step").and_then(Value::as_i64),
            }))
        })
        .collect()
}

/// Accords donnés pendant le run : réutilise les reçus (preuve = page des reçus).
pub fn decisions_from_receipts(receipts: &[ReceiptLite]) -> Vec<Value> {
    receipts
        .iter()
        .map(|r| {
            let outcome = match r.status.as_str() {
                "done" => "ok",
                "failed" | "refused" | "expired" => "failed",
                "executing" | "pending" | "approved" => "running",
                _ => "unknown",
            };
            let what = if r.target.is_empty() {
                r.action_label.clone()
            } else {
                format!("{} · {}", r.action_label, r.target)
            };
            let why = match &r.approved_by_label {
                Some(by) if !by.is_empty() => format!("Accord donné par {by}"),
                _ => "Action soumise à accord".to_string(),
            };
            json!({
                "source": "receipt",
                "what": one_line(&what, 120),
                "why": why,
                "evidence": format!("/app/receipts#{}", r.uuid),
                "outcome": outcome,
                "step": Value::Null,
                "detail": r.detail.as_deref().map(|d| one_line(d, 200)),
                "at": r.created_at,
            })
        })
        .collect()
}

/// État d'une étape : `pending` | `running` | `ok` | `failed` | `skipped` | `missing`.
/// Un run terminé sans décision pour une étape → `missing` (jamais `ok`).
pub fn step_states(
    run: &RunLite,
    playbook: Option<&Playbook>,
    decisions: &[Value],
    workers: &[RunLite],
) -> Vec<Value> {
    let Some(p) = playbook else {
        return Vec::new();
    };
    let terminal = is_terminal(&run.status) && !workers.iter().any(|w| !is_terminal(&w.status));
    let mut out: Vec<(String, &'static str)> = Vec::new();
    let mut current_assigned = false;
    for (i, label) in p.steps.iter().enumerate() {
        let n = (i + 1) as i64;
        let mine: Vec<&str> = decisions
            .iter()
            .filter(|d| d.get("step").and_then(Value::as_i64) == Some(n))
            .filter_map(|d| d.get("outcome").and_then(Value::as_str))
            .collect();
        let mut state: &'static str = if mine.contains(&"failed") {
            "failed"
        } else if mine.contains(&"ok") {
            "ok"
        } else if mine.contains(&"skipped") {
            "skipped"
        } else {
            ""
        };
        // Essaim : les étapes 2-3 suivent les workers réels.
        if p.uses_workers && state.is_empty() && !workers.is_empty() {
            let any_failed = workers.iter().any(|w| is_failed_status(&w.status));
            let all_done = workers.iter().all(|w| is_terminal(&w.status));
            state = match n {
                1 | 2 => "ok",
                _ if all_done && any_failed => "failed",
                _ if all_done => "ok",
                _ => "running",
            };
        }
        if state.is_empty() {
            state = if terminal {
                if is_failed_status(&run.status) && !current_assigned {
                    current_assigned = true;
                    "failed"
                } else {
                    "missing"
                }
            } else if !current_assigned {
                current_assigned = true;
                "running"
            } else {
                "pending"
            };
        }
        out.push((label.to_string(), state));
    }
    out.into_iter()
        .enumerate()
        .map(|(i, (label, state))| json!({"n": i + 1, "label": label, "state": state}))
        .collect()
}

/// Libellé courant : outil en cours, sinon jalon en cours, sinon état du run.
pub fn status_text(
    run: &RunLite,
    events: &[EventLite],
    workers: &[RunLite],
    steps: &[Value],
) -> String {
    let live_workers = workers.iter().filter(|w| !is_terminal(&w.status)).count();
    if !is_terminal(&run.status) {
        let mut open: Vec<(String, String)> = Vec::new();
        let mut milestone: Option<String> = None;
        for e in events.iter().filter(|e| e.run_uuid == run.uuid) {
            let id = e
                .payload
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            match e.ty.as_str() {
                "tool_start" => {
                    let label = e.payload.get("label").and_then(Value::as_str).unwrap_or("");
                    let name = e
                        .payload
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("outil");
                    open.push((
                        id,
                        if label.is_empty() {
                            name.to_string()
                        } else {
                            label.to_string()
                        },
                    ));
                }
                "tool_done" => open.retain(|(i, _)| i != &id),
                "milestone" => {
                    let st = e
                        .payload
                        .get("status")
                        .and_then(Value::as_str)
                        .unwrap_or("running");
                    let label = e.payload.get("label").and_then(Value::as_str).unwrap_or("");
                    milestone = (st == "running" && !label.is_empty()).then(|| label.to_string());
                }
                _ => {}
            }
        }
        if let Some((_, l)) = open.last() {
            return format!("{}…", one_line(l, 80).trim_end_matches('…'));
        }
        if let Some(m) = milestone {
            return format!("{}…", one_line(&m, 80));
        }
        if run.status == "paused" {
            return "En pause".into();
        }
        if matches!(run.status.as_str(), "pending" | "queued") {
            return "En file d'attente…".into();
        }
        return "Réflexion…".into();
    }
    if live_workers > 0 {
        return format!(
            "{live_workers} worker{} en cours…",
            if live_workers > 1 { "s" } else { "" }
        );
    }
    let missing = steps
        .iter()
        .filter(|s| s.get("state").and_then(Value::as_str) == Some("missing"))
        .count();
    match run.status.as_str() {
        "completed" if missing > 0 => format!(
            "Terminé — {missing} étape{} sans résultat",
            if missing > 1 { "s" } else { "" }
        ),
        "completed" => "Terminé".into(),
        "cancelled" => "Arrêté".into(),
        _ => match &run.error {
            Some(e) if !e.is_empty() => format!("Échec : {}", one_line(e, 100)),
            _ => "Échec".into(),
        },
    }
}

/// Verdict global : `running` | `ok` | `failed` | `incomplete`.
pub fn verdict(run: &RunLite, steps: &[Value], workers: &[RunLite]) -> &'static str {
    if !is_terminal(&run.status) || workers.iter().any(|w| !is_terminal(&w.status)) {
        return "running";
    }
    let st = |s: &str| {
        steps
            .iter()
            .any(|x| x.get("state").and_then(Value::as_str) == Some(s))
    };
    if is_failed_status(&run.status)
        || st("failed")
        || workers.iter().any(|w| is_failed_status(&w.status))
    {
        "failed"
    } else if st("missing") {
        "incomplete"
    } else {
        "ok"
    }
}

pub fn compute_live(
    run: &RunLite,
    playbook: Option<&Playbook>,
    events: &[EventLite],
    workers: &[RunLite],
    receipts: &[ReceiptLite],
) -> Value {
    let names = |uuid: &str| -> Option<String> {
        if uuid == run.uuid {
            run.agent_name.clone()
        } else {
            workers
                .iter()
                .find(|w| w.uuid == uuid)
                .and_then(|w| w.agent_name.clone())
        }
    };
    let mut decisions = decisions_from_events(events, &names);
    decisions.extend(decisions_from_receipts(receipts));
    let steps = step_states(run, playbook, &decisions, workers);
    let tools_ok = events
        .iter()
        .filter(|e| {
            e.ty == "tool_done" && e.payload.get("ok").and_then(Value::as_bool) == Some(true)
        })
        .count();
    let tools_failed = events
        .iter()
        .filter(|e| {
            e.ty == "tool_done" && e.payload.get("ok").and_then(Value::as_bool) == Some(false)
        })
        .count();
    let workers_done = workers.iter().filter(|w| is_ok_status(&w.status)).count();
    let workers_failed = workers
        .iter()
        .filter(|w| is_failed_status(&w.status))
        .count();
    let workers_json: Vec<Value> = workers
        .iter()
        .map(|w| {
            json!({
                "run_uuid": w.uuid,
                "title": w.title,
                "agent_name": w.agent_name,
                "status": w.status,
                "live": w.live,
                "summary": w.summary.as_deref().map(|s| one_line(s, 160)),
                "error": w.error.as_deref().map(|s| one_line(s, 160)),
            })
        })
        .collect();
    let text = status_text(run, events, workers, &steps);
    let v = verdict(run, &steps, workers);
    let decisions_n = decisions.len();
    json!({
        "run_uuid": run.uuid,
        "status": run.status,
        "live": v == "running",
        "verdict": v,
        "status_text": text,
        "title": run.title,
        "error": run.error.as_deref().map(|e| one_line(e, 300)),
        "playbook": playbook.map(|p| json!({
            "id": p.id, "slash": p.slash, "name": p.name, "rule": p.rule, "visual": p.visual,
        })),
        "steps": steps,
        "workers": workers_json,
        "counters": {
            "tools_ok": tools_ok,
            "tools_failed": tools_failed,
            "workers_total": workers.len(),
            "workers_done": workers_done,
            "workers_failed": workers_failed,
            "decisions": decisions_n,
        },
        "decisions": decisions,
    })
}

#[derive(sqlx::FromRow)]
struct RunRowLite {
    uuid: String,
    project_uuid: String,
    status: String,
    title: Option<String>,
    error: Option<String>,
    summary: Option<String>,
    agent_name: Option<String>,
    playbook: Option<String>,
    parent_run_uuid: Option<String>,
}

impl RunRowLite {
    fn lite(&self) -> RunLite {
        RunLite {
            uuid: self.uuid.clone(),
            status: self.status.clone(),
            title: self.title.clone(),
            error: self.error.clone(),
            summary: self.summary.clone(),
            agent_name: self.agent_name.clone(),
            live: crate::run_events::is_live(&self.uuid),
        }
    }
}

const RUN_SELECT: &str = r#"SELECT r.uuid, r.project_uuid, r.status, r.title, r.error, r.summary,
       a.name AS agent_name, r.playbook, r.parent_run_uuid
  FROM agent_runs r LEFT JOIN project_agents a ON a.uuid = r.agent_uuid"#;

pub async fn live_json(
    pool: &sqlx::PgPool,
    run_uuid: &str,
) -> Result<Option<(String, Value)>, sqlx::Error> {
    let run: Option<RunRowLite> = sqlx::query_as(&format!("{RUN_SELECT} WHERE r.uuid = $1"))
        .bind(run_uuid)
        .fetch_optional(pool)
        .await?;
    let Some(run) = run else {
        return Ok(None);
    };
    let _ = &run.parent_run_uuid;
    let workers: Vec<RunRowLite> = sqlx::query_as(&format!(
        "{RUN_SELECT} WHERE r.parent_run_uuid = $1 ORDER BY r.created_at ASC LIMIT 20"
    ))
    .bind(run_uuid)
    .fetch_all(pool)
    .await?;
    let mut ids: Vec<String> = vec![run.uuid.clone()];
    ids.extend(workers.iter().map(|w| w.uuid.clone()));
    let events: Vec<(String, String, String)> = sqlx::query_as(
        r#"SELECT run_uuid, type, payload::text FROM agent_run_events
           WHERE run_uuid = ANY($1) AND type IN ('tool_start','tool_done','milestone')
           ORDER BY run_uuid, seq ASC LIMIT 4000"#,
    )
    .bind(&ids)
    .fetch_all(pool)
    .await?;
    let events: Vec<EventLite> = events
        .into_iter()
        .map(|(run_uuid, ty, p)| EventLite {
            run_uuid,
            ty,
            payload: serde_json::from_str(&p).unwrap_or(Value::Null),
        })
        .collect();
    let receipts: Vec<(
        String,
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        String,
    )> = sqlx::query_as(
        r#"SELECT uuid, action_label, target, status, detail, approved_by_label, created_at::text
               FROM approval_receipts WHERE run_uuid = ANY($1) ORDER BY created_at ASC LIMIT 50"#,
    )
    .bind(&ids)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    let receipts: Vec<ReceiptLite> = receipts
        .into_iter()
        .map(
            |(uuid, action_label, target, status, detail, approved_by_label, created_at)| {
                ReceiptLite {
                    uuid,
                    action_label,
                    target,
                    status,
                    detail,
                    approved_by_label,
                    created_at,
                }
            },
        )
        .collect();
    let lite = run.lite();
    let worker_lites: Vec<RunLite> = workers.iter().map(RunRowLite::lite).collect();
    let pb = run.playbook.as_deref().and_then(find);
    let mut v = compute_live(&lite, pb, &events, &worker_lites, &receipts);
    v["project_uuid"] = json!(run.project_uuid);
    v["agent_name"] = json!(run.agent_name);
    Ok(Some((run.project_uuid, v)))
}

async fn run_live(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(run_uuid): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let project: Option<String> =
        sqlx::query_scalar("SELECT project_uuid FROM agent_runs WHERE uuid = $1")
            .bind(&run_uuid)
            .fetch_optional(&state.pool)
            .await
            .map_err(ApiError::from)?;
    let project = project.ok_or_else(|| ApiError::not_found("run"))?;
    crate::routes::auth_project(&state, &headers, &project).await?;
    let (_, v) = live_json(&state.pool, &run_uuid)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found("run"))?;
    Ok(Json(json!({"data": v})))
}
