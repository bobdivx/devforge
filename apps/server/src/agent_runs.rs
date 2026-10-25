//! Tours d'agent persistés. Un redémarrage reprend les runs `pending` et les runs `running`
//! dont le bail SQL a expiré (`lease_owner` / `lease_until`, renouvelé pendant l'exécution).
//! Idée reprise d'OpenMuse (MIT) : bail + heartbeat + reprise des seuls baux expirés + plafond d'essais.

use serde_json::Value;
use sqlx::PgPool;

/// Marqueur du tour automatique quand la preview publique est rouge.
pub const PREVIEW_REPAIR_PREFIX: &str = "[réparation preview]";

use crate::state::{new_uuid, now_str};

#[derive(Debug, Clone)]
pub struct RunRow {
    pub uuid: String,
    pub project_uuid: String,
    pub agent_uuid: String,
    pub message_uuid: String,
    pub content: String,
}

/// Métadonnées d'un message utilisateur enrichi (P5) : réponse structurée, images, citation.
#[derive(Debug, Clone)]
pub struct UserTurnExtras {
    pub tool_calls_json: String,
    pub attachments_json: String,
    pub reply_to_uuid: Option<String>,
}

impl Default for UserTurnExtras {
    fn default() -> Self {
        Self {
            tool_calls_json: "[]".into(),
            attachments_json: "[]".into(),
            reply_to_uuid: None,
        }
    }
}

pub async fn record_user_turn(
    pool: &PgPool,
    project_uuid: &str,
    agent_uuid: &str,
    content: &str,
) -> Result<String, String> {
    record_user_turn_with(
        pool,
        project_uuid,
        agent_uuid,
        content,
        &UserTurnExtras::default(),
    )
    .await
}

pub async fn record_user_turn_with(
    pool: &PgPool,
    project_uuid: &str,
    agent_uuid: &str,
    content: &str,
    extras: &UserTurnExtras,
) -> Result<String, String> {
    let message_uuid = new_uuid();
    let now = now_str();
    sqlx::query(
        r#"INSERT INTO agent_messages (
            uuid, project_uuid, agent_uuid, role, content, tool_calls_json, provider, created_at,
            attachments_json, reply_to_uuid
        ) VALUES ($1, $2, $3, 'user', $4, $6, '', $5, $7, $8)"#,
    )
    .bind(&message_uuid)
    .bind(project_uuid)
    .bind(agent_uuid)
    .bind(content)
    .bind(&now)
    .bind(&extras.tool_calls_json)
    .bind(&extras.attachments_json)
    .bind(&extras.reply_to_uuid)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    let _ = sqlx::query(
        "UPDATE project_agents SET status = 'working', updated_at = $1 WHERE uuid = $2",
    )
    .bind(&now)
    .bind(agent_uuid)
    .execute(pool)
    .await;
    enqueue(pool, project_uuid, agent_uuid, &message_uuid).await
}

/// Idempotent sur `message_uuid` : le message utilisateur existe déjà.
pub async fn enqueue(
    pool: &PgPool,
    project_uuid: &str,
    agent_uuid: &str,
    message_uuid: &str,
) -> Result<String, String> {
    if let Some((uuid,)) =
        sqlx::query_as::<_, (String,)>("SELECT uuid FROM agent_runs WHERE message_uuid = $1")
            .bind(message_uuid)
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?
    {
        return Ok(uuid);
    }
    let uuid = new_uuid();
    let now = now_str();
    sqlx::query(
        r#"INSERT INTO agent_runs (
            uuid, project_uuid, agent_uuid, message_uuid, status, error, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, 'pending', NULL, $5, $6)"#,
    )
    .bind(&uuid)
    .bind(project_uuid)
    .bind(agent_uuid)
    .bind(message_uuid)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(uuid)
}

/// Durée d'un bail : renouvelé toutes les 30 s par le run, repris par un autre si non renouvelé.
pub const LEASE_SECS: i64 = 90;
/// Au-delà, un run coupé n'est plus relancé automatiquement (évite une boucle de crash).
pub const MAX_ATTEMPTS: i32 = 3;
/// Statuts qu'une fin de run peut encore écraser (une pause, une annulation ou une reprise gagnent).
const OPEN_STATUSES: &str = "('pending','queued','running')";

/// Identifiant de ce processus (propriétaire des baux qu'il prend).
pub fn instance_id() -> &'static str {
    static ID: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
        let host = std::env::var("HOSTNAME").unwrap_or_else(|_| "devforge".into());
        format!("{host}:{}", &new_uuid()[..8])
    });
    &ID
}

pub async fn try_claim(pool: &PgPool, run_uuid: &str) -> Result<bool, sqlx::Error> {
    try_claim_as(pool, run_uuid, instance_id()).await
}

/// Prend le bail d'un run `pending` : un seul gagnant, essai compté.
pub async fn try_claim_as(pool: &PgPool, run_uuid: &str, owner: &str) -> Result<bool, sqlx::Error> {
    let now = now_str();
    let res = sqlx::query(
        r#"UPDATE agent_runs SET status = 'running', updated_at = $1, error = NULL,
               lease_owner = $3, lease_until = now() + make_interval(secs => $4),
               attempts = attempts + 1
           WHERE uuid = $2 AND status = 'pending'"#,
    )
    .bind(&now)
    .bind(run_uuid)
    .bind(owner)
    .bind(LEASE_SECS as f64)
    .execute(pool)
    .await?;
    Ok(res.rows_affected() == 1)
}

/// Heartbeat : prolonge le bail. `false` = bail perdu (pause, annulation, reprise ailleurs) → arrêter.
pub async fn renew_lease(pool: &PgPool, run_uuid: &str, owner: &str) -> Result<bool, sqlx::Error> {
    let res = sqlx::query(
        r#"UPDATE agent_runs SET lease_until = now() + make_interval(secs => $3)
           WHERE uuid = $1 AND status = 'running' AND lease_owner = $2"#,
    )
    .bind(run_uuid)
    .bind(owner)
    .bind(LEASE_SECS as f64)
    .execute(pool)
    .await?;
    Ok(res.rows_affected() == 1)
}

/// Résultat d'une passe de reprise.
#[derive(Debug, Default, PartialEq)]
pub struct Recovery {
    /// Runs remis en `pending` (bail expiré).
    pub requeued: Vec<String>,
    /// Runs passés en `failed` : coupés trop souvent.
    pub failed: Vec<String>,
}

/// Reprise idempotente des runs `running` dont le bail a expiré. Un run vivant (bail renouvelé)
/// n'est jamais touché. `include_unleased` (au démarrage seulement) : les runs `running` sans bail
/// (anciens runs, routines) appartenaient forcément à un processus arrêté.
pub async fn recover_expired(
    pool: &PgPool,
    include_unleased: bool,
) -> Result<Recovery, sqlx::Error> {
    let now = now_str();
    let expired = if include_unleased {
        "status = 'running' AND (lease_until IS NULL OR lease_until < now())"
    } else {
        "status = 'running' AND lease_owner IS NOT NULL AND lease_until < now()"
    };
    // Coupé trop souvent, ou sans message à rejouer (routine) : échec explicite, pas de boucle.
    let failed: Vec<(String, String)> = sqlx::query_as(&format!(
        r#"UPDATE agent_runs r SET status = 'failed', updated_at = $1, lease_owner = NULL, lease_until = NULL,
               error = CASE WHEN r.attempts >= $2
                   THEN 'Interrompu ' || r.attempts || ' fois (redémarrages). Relance-le quand tu veux.'
                   ELSE 'Interrompu par un redémarrage de DevForge.' END
           WHERE {expired}
             AND (r.attempts >= $2 OR NOT EXISTS (SELECT 1 FROM agent_messages m WHERE m.uuid = r.message_uuid))
           RETURNING r.uuid, r.agent_uuid"#
    ))
    .bind(&now)
    .bind(MAX_ATTEMPTS)
    .fetch_all(pool)
    .await?;
    for (_, agent) in &failed {
        let _ = sqlx::query(
            "UPDATE project_agents SET status = 'idle', updated_at = $1 WHERE uuid = $2",
        )
        .bind(&now)
        .bind(agent)
        .execute(pool)
        .await;
    }
    let requeued: Vec<(String,)> = sqlx::query_as(&format!(
        r#"UPDATE agent_runs SET status = 'pending', updated_at = $1, lease_owner = NULL, lease_until = NULL
           WHERE {expired}
           RETURNING uuid"#
    ))
    .bind(&now)
    .fetch_all(pool)
    .await?;
    Ok(Recovery {
        requeued: requeued.into_iter().map(|r| r.0).collect(),
        failed: failed.into_iter().map(|r| r.0).collect(),
    })
}

/// Contrôle utilisateur d'un run (`pause` | `resume` | `retry`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Control {
    Pause,
    Resume,
    Retry,
}

/// Issue d'un contrôle.
#[derive(Debug, PartialEq)]
pub enum ControlOutcome {
    /// Nouveau statut ; `restart` = le run doit être relancé (`pending`).
    Changed { status: &'static str, restart: bool },
    /// Rien à faire (déjà dans l'état voulu).
    Unchanged(String),
    /// Refusé : message pour l'utilisateur.
    Refused(&'static str),
}

/// Applique pause / reprise / relance avec des règles strictes. Transition atomique sur le statut lu.
/// Reprendre un run dont la réponse (partielle) est déjà enregistrée ajoute un message de reprise
/// au fil et rattache le run à ce message : même carte, même run, l'agent repart de l'historique.
pub async fn control(
    pool: &PgPool,
    run_uuid: &str,
    action: Control,
) -> Result<ControlOutcome, sqlx::Error> {
    let row: Option<(String, String, String, String, Option<String>)> = sqlx::query_as(
        "SELECT status, project_uuid, agent_uuid, message_uuid, title FROM agent_runs WHERE uuid = $1",
    )
    .bind(run_uuid)
    .fetch_optional(pool)
    .await?;
    let Some((status, project, agent, message, title)) = row else {
        return Ok(ControlOutcome::Refused("Run introuvable"));
    };
    let now = now_str();
    match action {
        Control::Pause => {
            if status == "paused" {
                return Ok(ControlOutcome::Unchanged(status));
            }
            if !matches!(status.as_str(), "pending" | "queued" | "running") {
                return Ok(ControlOutcome::Refused("Ce run est déjà terminé"));
            }
            let res = sqlx::query(
                r#"UPDATE agent_runs SET status = 'paused', updated_at = $1, lease_owner = NULL, lease_until = NULL,
                       cancel_requested = (status = 'running')
                   WHERE uuid = $2 AND status = $3"#,
            )
            .bind(&now)
            .bind(run_uuid)
            .bind(&status)
            .execute(pool)
            .await?;
            if res.rows_affected() == 0 {
                return Ok(ControlOutcome::Refused("Le run a changé, réessaie"));
            }
            let _ = sqlx::query(
                "UPDATE project_agents SET status = 'idle', updated_at = $1 WHERE uuid = $2",
            )
            .bind(&now)
            .bind(&agent)
            .execute(pool)
            .await;
            Ok(ControlOutcome::Changed {
                status: "paused",
                restart: false,
            })
        }
        Control::Resume | Control::Retry => {
            let expected = if action == Control::Resume {
                "paused"
            } else {
                "failed"
            };
            if action == Control::Retry && status == "paused" {
                return Ok(ControlOutcome::Refused("Ce run est en pause : reprends-le"));
            }
            if matches!(status.as_str(), "pending" | "queued" | "running") {
                return Ok(ControlOutcome::Unchanged(status));
            }
            if status != expected {
                return Ok(ControlOutcome::Refused(if action == Control::Resume {
                    "Seul un run en pause peut reprendre"
                } else {
                    "Seul un run en échec peut être relancé"
                }));
            }
            let replayable: Option<(i64,)> =
                sqlx::query_as("SELECT id FROM agent_messages WHERE uuid = $1")
                    .bind(&message)
                    .fetch_optional(pool)
                    .await?;
            if replayable.is_none() {
                return Ok(ControlOutcome::Refused(
                    "Ce run ne peut pas être rejoué : relance la routine",
                ));
            }
            let mut next_message = message.clone();
            if assistant_already_replied(pool, &agent, &message).await? {
                let label = title
                    .as_deref()
                    .filter(|t| !t.trim().is_empty())
                    .unwrap_or("la tâche");
                let content = if action == Control::Resume {
                    format!("Reprends {label} là où tu t'étais arrêté.")
                } else {
                    format!("Relance {label} : reprends depuis le début si besoin.")
                };
                next_message = new_uuid();
                sqlx::query(
                    r#"INSERT INTO agent_messages (uuid, project_uuid, agent_uuid, role, content, tool_calls_json, provider, created_at)
                       VALUES ($1, $2, $3, 'user', $4, '[]', '', $5)"#,
                )
                .bind(&next_message)
                .bind(&project)
                .bind(&agent)
                .bind(&content)
                .bind(&now)
                .execute(pool)
                .await?;
            }
            let res = sqlx::query(
                r#"UPDATE agent_runs SET status = 'pending', updated_at = $1, error = NULL, cancel_requested = FALSE,
                       message_uuid = $3, lease_owner = NULL, lease_until = NULL,
                       attempts = CASE WHEN $4 THEN 0 ELSE attempts END
                   WHERE uuid = $2 AND status = $5"#,
            )
            .bind(&now)
            .bind(run_uuid)
            .bind(&next_message)
            .bind(action == Control::Retry)
            .bind(expected)
            .execute(pool)
            .await?;
            if res.rows_affected() == 0 {
                return Ok(ControlOutcome::Refused("Le run a changé, réessaie"));
            }
            Ok(ControlOutcome::Changed {
                status: "pending",
                restart: true,
            })
        }
    }
}

pub async fn list_pending(pool: &PgPool) -> Result<Vec<RunRow>, sqlx::Error> {
    let rows = sqlx::query_as::<_, (String, String, String, String, String)>(
        r#"SELECT r.uuid, r.project_uuid, r.agent_uuid, r.message_uuid, m.content
           FROM agent_runs r
           JOIN agent_messages m ON m.uuid = r.message_uuid
           WHERE r.status = 'pending'
           ORDER BY r.created_at ASC
           LIMIT 20"#,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(
            |(uuid, project_uuid, agent_uuid, message_uuid, content)| RunRow {
                uuid,
                project_uuid,
                agent_uuid,
                message_uuid,
                content,
            },
        )
        .collect())
}

pub async fn assistant_already_replied(
    pool: &PgPool,
    agent_uuid: &str,
    message_uuid: &str,
) -> Result<bool, sqlx::Error> {
    let row: (i64,) = sqlx::query_as(
        r#"SELECT COUNT(*) FROM agent_messages
           WHERE agent_uuid = $1 AND role = 'assistant'
             AND id > COALESCE((SELECT id FROM agent_messages WHERE uuid = $2), 0)"#,
    )
    .bind(agent_uuid)
    .bind(message_uuid)
    .fetch_one(pool)
    .await?;
    Ok(row.0 > 0)
}

pub async fn save_assistant_and_finish(
    pool: &PgPool,
    run_uuid: &str,
    project_uuid: &str,
    agent_uuid: &str,
    reply: &str,
    tools_json: &str,
    provider: &str,
) -> Result<(), sqlx::Error> {
    save_assistant_and_finish_as(
        pool,
        run_uuid,
        project_uuid,
        agent_uuid,
        reply,
        tools_json,
        provider,
        "completed",
    )
    .await
}

/// Fin de tour avec un statut explicite (`completed` | `cancelled`, P4-05).
#[allow(clippy::too_many_arguments)]
pub async fn save_assistant_and_finish_as(
    pool: &PgPool,
    run_uuid: &str,
    project_uuid: &str,
    agent_uuid: &str,
    reply: &str,
    tools_json: &str,
    provider: &str,
    status: &str,
) -> Result<(), sqlx::Error> {
    let now = now_str();
    sqlx::query(
        r#"INSERT INTO agent_messages (
            uuid, project_uuid, agent_uuid, role, content, tool_calls_json, provider, created_at
        ) VALUES ($1, $2, $3, 'assistant', $4, $5, $6, $7)"#,
    )
    .bind(new_uuid())
    .bind(project_uuid)
    .bind(agent_uuid)
    .bind(reply)
    .bind(tools_json)
    .bind(provider)
    .bind(&now)
    .execute(pool)
    .await?;
    crate::deploy_queue::record_tool_trace(pool, project_uuid, tools_json).await;
    finish(pool, run_uuid, status, None).await?;
    let _ = sqlx::query("UPDATE agent_runs SET summary = $1 WHERE uuid = $2")
        .bind(summary_line(reply))
        .bind(run_uuid)
        .execute(pool)
        .await;
    let _ =
        sqlx::query("UPDATE project_agents SET status = 'idle', updated_at = $1 WHERE uuid = $2")
            .bind(&now)
            .bind(agent_uuid)
            .execute(pool)
            .await;
    Ok(())
}

pub async fn fail_run(pool: &PgPool, run_uuid: &str, agent_uuid: &str, error: &str) {
    let now = now_str();
    let _ = finish(pool, run_uuid, "failed", Some(error)).await;
    let _ =
        sqlx::query("UPDATE project_agents SET status = 'idle', updated_at = $1 WHERE uuid = $2")
            .bind(&now)
            .bind(agent_uuid)
            .execute(pool)
            .await;
}

/// Première ligne utile d'une réponse, bornée (résumé de carte de job).
pub fn summary_line(reply: &str) -> String {
    let line = reply
        .lines()
        .map(|l| {
            l.trim()
                .trim_start_matches(['#', '*', '-', '>', ' '])
                .trim()
        })
        .find(|l| !l.is_empty())
        .unwrap_or("");
    clip(line, 160)
}

/// Run d'un message système (réveil, worker) avec son type et son titre (P4-01).
pub async fn enqueue_with(
    pool: &PgPool,
    project_uuid: &str,
    agent_uuid: &str,
    message_uuid: &str,
    kind: &str,
    title: Option<&str>,
) -> Result<String, String> {
    let uuid = enqueue(pool, project_uuid, agent_uuid, message_uuid).await?;
    let _ =
        sqlx::query("UPDATE agent_runs SET kind = $1, title = COALESCE(title, $2) WHERE uuid = $3")
            .bind(kind)
            .bind(title.map(|t| clip(t, 80)))
            .bind(&uuid)
            .execute(pool)
            .await;
    Ok(uuid)
}

/// Titre lisible d'un réveil : marqueur ou première ligne.
pub fn wake_title(marker: &str, content: &str) -> String {
    let m = marker.trim().trim_matches(['[', ']']).trim();
    if !m.is_empty() {
        return clip(m, 80);
    }
    clip(
        content
            .lines()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("Réveil")
            .trim(),
        80,
    )
}

/// Prochain worker en file d'attente du projet, passé en `pending` (P4-03).
pub async fn promote_queued(pool: &PgPool, project_uuid: &str) -> Option<(String, String)> {
    let active: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM agent_runs WHERE project_uuid = $1 AND kind = 'worker' AND status IN ('pending','running')",
    )
    .bind(project_uuid)
    .fetch_one(pool)
    .await
    .ok()?;
    if active >= devforge_agent::MAX_ACTIVE_WORKERS {
        return None;
    }
    sqlx::query_as::<_, (String, String)>(
        r#"UPDATE agent_runs SET status = 'pending', updated_at = $2
           WHERE uuid = (SELECT uuid FROM agent_runs WHERE project_uuid = $1 AND kind = 'worker' AND status = 'queued'
                         ORDER BY created_at ASC LIMIT 1)
             AND status = 'queued'
           RETURNING uuid, agent_uuid"#,
    )
    .bind(project_uuid)
    .bind(now_str())
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
}

/// Derniers messages, avec un extrait des outils sur les réponses assistant.
pub async fn recent_history(pool: &PgPool, agent_uuid: &str) -> Vec<(String, String)> {
    let Ok(rows) = sqlx::query_as::<_, (String, String, String)>(
        r#"SELECT role, content, COALESCE(tool_calls_json, '[]')
           FROM agent_messages WHERE agent_uuid = $1 ORDER BY id DESC LIMIT 20"#,
    )
    .bind(agent_uuid)
    .fetch_all(pool)
    .await
    else {
        return Vec::new();
    };
    let mut hist = rows;
    hist.reverse();
    hist.into_iter()
        .map(|(role, content, tools)| {
            let content = if role == "assistant" {
                let tools = devforge_shared::redact::redact_json_str(&tools);
                assistant_content_with_tools(&content, &tools)
            } else {
                content
            };
            (role, content)
        })
        .collect()
}

/// Ajoute au texte assistant les fichiers touchés, l'erreur et les logs utiles.
pub fn assistant_content_with_tools(content: &str, tools_json: &str) -> String {
    let excerpt = tool_excerpt(tools_json);
    if excerpt.is_empty() {
        content.to_string()
    } else {
        format!("{content}\n\n[outils]\n{excerpt}")
    }
}

/// Marqueur du tour qui force les outils après une auto-réparation narrée.
pub const DEPLOY_REPAIR_FOLLOWUP: &str = "[réparation déploiement]";

/// Si l'auto-réparation a été racontée sans `npm install` ou sans redéploiement, un tour de plus.
pub fn deploy_repair_followup(user_message: &str, tools_json: &str) -> Option<String> {
    let lower = user_message.to_lowercase();
    let repair = lower.contains("auto-réparation") || lower.contains("auto-reparation");
    if !repair {
        return None;
    }
    if user_message.contains("Pousse uniquement package-lock.json") {
        return None;
    }
    let calls: Vec<Value> = serde_json::from_str(tools_json).unwrap_or_default();
    // Publication verrouillée : l'agent attend la validation, pas de relance automatique.
    let awaiting_approval = calls.iter().any(|call| {
        call.get("result")
            .and_then(|r| r.get("code"))
            .and_then(|v| v.as_str())
            == Some("publish_approval_required")
    });
    if awaiting_approval {
        return None;
    }
    let ran_install = calls.iter().any(|call| {
        call.get("name").and_then(|v| v.as_str()) == Some("run_workdir_command")
            && call
                .get("arguments")
                .and_then(|a| a.get("command"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .contains("npm install")
            && call
                .get("result")
                .and_then(|r| r.get("ok"))
                .and_then(|v| v.as_bool())
                == Some(true)
    });
    let deployed = calls
        .iter()
        .any(|call| call.get("name").and_then(|v| v.as_str()) == Some("trigger_deploy"));
    if !ran_install {
        if user_message.contains("Appelle maintenant l'outil run_workdir_command") {
            return None;
        }
        return Some(format!(
            "{DEPLOY_REPAIR_FOLLOWUP}\nAUTO-RÉPARATION\nTu as décrit la correction sans l'exécuter. Appelle maintenant l'outil run_workdir_command avec command=\"npm install\". N'écris pas package-lock.json à la main. N'invente aucune variable d'environnement."
        ));
    }
    if !deployed {
        return Some(
            "Pousse uniquement package-lock.json avec sync_workdir_to_github (paths: [\"package-lock.json\"], commit_message: \"fix: resynchroniser package-lock.json\"), puis appelle trigger_deploy. Ne synchronise pas le reste du dépôt. AUTO-RÉPARATION".into(),
        );
    }
    None
}

/// Un seul correctif auto par demande. Rien si l'utilisateur doit agir (domaine, secret).
pub fn preview_repair_prompt(user_message: &str, tools_json: &str) -> Option<String> {
    if user_message.trim_start().starts_with(PREVIEW_REPAIR_PREFIX) {
        return None;
    }
    let calls: Vec<Value> = serde_json::from_str(tools_json).ok()?;
    let last = calls
        .iter()
        .rev()
        .find(|call| call.get("name").and_then(|v| v.as_str()) == Some("start_local_preview"))?;
    let result = last.get("result")?;
    if result.get("needs_user_action").and_then(|v| v.as_bool()) == Some(true) {
        return None;
    }
    let public_ok = result.get("public_ok").and_then(|v| v.as_bool());
    let ok = result.get("ok").and_then(|v| v.as_bool()).unwrap_or(true);
    if public_ok == Some(true) || (public_ok.is_none() && ok) {
        return None;
    }
    let err = result.get("error").and_then(|v| v.as_str()).unwrap_or("");
    let lower = err.to_lowercase();
    if lower.contains("wildcard") || lower.contains("domaine") {
        return None;
    }
    let logs = result
        .get("logs_tail")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    Some(format!(
        "{PREVIEW_REPAIR_PREFIX}\nLa preview n’est pas joignable. Corrige les fichiers en local puis relance start_local_preview avec force=true.\nErreur : {}\nLogs : {}",
        clip(err, 400),
        clip(logs, 800),
    ))
}

fn tool_excerpt(tools_json: &str) -> String {
    let Ok(calls) = serde_json::from_str::<Vec<Value>>(tools_json) else {
        return String::new();
    };
    let start = calls.len().saturating_sub(6);
    let mut lines = Vec::new();
    for call in calls.iter().skip(start) {
        let name = call.get("name").and_then(|v| v.as_str()).unwrap_or("tool");
        let args = call.get("arguments");
        let result = call.get("result");
        let path = args
            .and_then(|a| a.get("path"))
            .and_then(|v| v.as_str())
            .or_else(|| result.and_then(|r| r.get("path")).and_then(|v| v.as_str()))
            .unwrap_or("");
        let command = args
            .and_then(|a| a.get("command"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let ok = result.and_then(|r| r.get("ok")).and_then(|v| v.as_bool());
        let public_ok = result
            .and_then(|r| r.get("public_ok"))
            .and_then(|v| v.as_bool());
        let err = result
            .and_then(|r| r.get("error"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let mut line = format!("- {name}");
        if !path.is_empty() {
            line.push_str(&format!(" path={path}"));
        }
        if !command.is_empty() {
            line.push_str(&format!(" cmd={}", clip(command, 80)));
        }
        if let Some(ok) = ok {
            line.push_str(&format!(" ok={ok}"));
        }
        if let Some(public_ok) = public_ok {
            line.push_str(&format!(" public_ok={public_ok}"));
        }
        if !err.is_empty() {
            line.push_str(&format!(" error={}", clip(err, 180)));
        }
        let failed = ok == Some(false) || public_ok == Some(false);
        if failed {
            let logs = result
                .and_then(|r| r.get("logs_tail"))
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .or_else(|| {
                    result
                        .and_then(|r| r.get("stderr"))
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                });
            if let Some(logs) = logs {
                line.push_str(&format!("\n  logs: {}", clip(logs, 400)));
            }
        }
        lines.push(line);
    }
    clip(&lines.join("\n"), 2400)
}

fn clip(s: &str, max: usize) -> String {
    let count = s.chars().count();
    if count <= max {
        s.to_string()
    } else {
        let t: String = s.chars().take(max).collect();
        format!("{t}…")
    }
}

pub async fn finish(
    pool: &PgPool,
    run_uuid: &str,
    status: &str,
    error: Option<&str>,
) -> Result<(), sqlx::Error> {
    let now = now_str();
    // Fencing : une pause, une annulation ou une reprise déjà enregistrée n'est pas écrasée.
    sqlx::query(&format!(
        "UPDATE agent_runs SET status = $1, error = $2, updated_at = $3, lease_owner = NULL, lease_until = NULL \
         WHERE uuid = $4 AND status IN {OPEN_STATUSES}"
    ))
    .bind(status)
    .bind(error)
    .bind(&now)
    .bind(run_uuid)
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn pool() -> PgPool {
        let pool = devforge_database::ephemeral_pg().await;
        sqlx::query(
            r#"CREATE TABLE agent_messages (
                id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                uuid TEXT NOT NULL UNIQUE,
                project_uuid TEXT NOT NULL,
                agent_uuid TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                tool_calls_json TEXT NOT NULL DEFAULT '[]',
                provider TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                attachments_json TEXT NOT NULL DEFAULT '[]',
                reply_to_uuid TEXT NULL
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            r#"CREATE TABLE agent_runs (
                uuid TEXT PRIMARY KEY,
                project_uuid TEXT NOT NULL,
                agent_uuid TEXT NOT NULL,
                message_uuid TEXT NOT NULL UNIQUE,
                status TEXT NOT NULL,
                error TEXT,
                title TEXT,
                cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
                lease_owner TEXT,
                lease_until TIMESTAMPTZ,
                attempts INT NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            r#"CREATE TABLE project_agents (
                uuid TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO project_agents (uuid, status, updated_at) VALUES ('agent-1', 'idle', 't')",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    async fn status_of(pool: &PgPool, run: &str) -> (String, i32, Option<String>) {
        sqlx::query_as("SELECT status, attempts, lease_owner FROM agent_runs WHERE uuid = $1")
            .bind(run)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    async fn expire(pool: &PgPool, run: &str) {
        sqlx::query(
            "UPDATE agent_runs SET lease_until = now() - interval '1 second' WHERE uuid = $1",
        )
        .bind(run)
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn interrupted_run_is_pending_again_and_claim_is_once() {
        let pool = pool().await;
        let run = record_user_turn(&pool, "proj", "agent-1", "scaffold ce projet")
            .await
            .unwrap();
        assert!(try_claim(&pool, &run).await.unwrap());
        assert!(!try_claim(&pool, &run).await.unwrap());
        let (status, attempts, owner) = status_of(&pool, &run).await;
        assert_eq!((status.as_str(), attempts), ("running", 1));
        assert_eq!(owner.as_deref(), Some(instance_id()));
        // Au démarrage, un run « running » d'un processus arrêté est repris.
        sqlx::query("UPDATE agent_runs SET lease_owner = NULL, lease_until = NULL")
            .execute(&pool)
            .await
            .unwrap();
        let rec = recover_expired(&pool, true).await.unwrap();
        assert_eq!(rec.requeued, vec![run.clone()]);
        let pending = list_pending(&pool).await.unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].content, "scaffold ce projet");
        assert!(try_claim(&pool, &run).await.unwrap());
    }

    #[tokio::test]
    async fn live_lease_is_untouched_and_expired_lease_is_requeued() {
        let pool = pool().await;
        let run = record_user_turn(&pool, "proj", "agent-1", "go")
            .await
            .unwrap();
        assert!(try_claim_as(&pool, &run, "a").await.unwrap());
        assert!(recover_expired(&pool, false)
            .await
            .unwrap()
            .requeued
            .is_empty());
        assert!(recover_expired(&pool, true)
            .await
            .unwrap()
            .requeued
            .is_empty());
        assert!(renew_lease(&pool, &run, "a").await.unwrap());
        assert!(!renew_lease(&pool, &run, "b").await.unwrap());
        expire(&pool, &run).await;
        let rec = recover_expired(&pool, false).await.unwrap();
        assert_eq!(rec.requeued, vec![run.clone()]);
        // L'ancien propriétaire a perdu le bail : plus de renouvellement.
        assert!(!renew_lease(&pool, &run, "a").await.unwrap());
        assert!(try_claim_as(&pool, &run, "b").await.unwrap());
        assert_eq!(status_of(&pool, &run).await.1, 2);
    }

    #[tokio::test]
    async fn too_many_interruptions_or_no_message_fail_instead_of_looping() {
        let pool = pool().await;
        let run = record_user_turn(&pool, "proj", "agent-1", "go")
            .await
            .unwrap();
        for _ in 0..MAX_ATTEMPTS {
            assert!(try_claim_as(&pool, &run, "a").await.unwrap());
            expire(&pool, &run).await;
            recover_expired(&pool, false).await.unwrap();
        }
        assert_eq!(status_of(&pool, &run).await.0, "failed");
        // Routine : run « running » sans message à rejouer → échec au démarrage.
        sqlx::query(
            "INSERT INTO agent_runs (uuid, project_uuid, agent_uuid, message_uuid, status, created_at, updated_at) \
             VALUES ('r2', 'proj', 'agent-1', 'routine-x', 'running', 't', 't')",
        )
        .execute(&pool)
        .await
        .unwrap();
        assert!(recover_expired(&pool, false)
            .await
            .unwrap()
            .failed
            .is_empty());
        let rec = recover_expired(&pool, true).await.unwrap();
        assert_eq!(rec.failed, vec!["r2".to_string()]);
        assert_eq!(
            control(&pool, "r2", Control::Retry).await.unwrap(),
            ControlOutcome::Refused("Ce run ne peut pas être rejoué : relance la routine")
        );
    }

    #[tokio::test]
    async fn pause_resume_retry_rules_and_fenced_finish() {
        let pool = pool().await;
        let run = record_user_turn(&pool, "proj", "agent-1", "go")
            .await
            .unwrap();
        assert!(try_claim(&pool, &run).await.unwrap());
        assert_eq!(
            control(&pool, &run, Control::Pause).await.unwrap(),
            ControlOutcome::Changed {
                status: "paused",
                restart: false
            }
        );
        // Le tour annulé se termine après la pause : le statut reste « paused ».
        finish(&pool, &run, "cancelled", None).await.unwrap();
        assert_eq!(status_of(&pool, &run).await.0, "paused");
        assert!(matches!(
            control(&pool, &run, Control::Retry).await.unwrap(),
            ControlOutcome::Refused(_)
        ));
        assert_eq!(
            control(&pool, &run, Control::Resume).await.unwrap(),
            ControlOutcome::Changed {
                status: "pending",
                restart: true
            }
        );
        assert!(matches!(
            control(&pool, &run, Control::Resume).await.unwrap(),
            ControlOutcome::Unchanged(_)
        ));
        assert!(try_claim(&pool, &run).await.unwrap());
        finish(&pool, &run, "failed", Some("boom")).await.unwrap();
        assert!(matches!(
            control(&pool, &run, Control::Pause).await.unwrap(),
            ControlOutcome::Refused(_)
        ));
        assert_eq!(
            control(&pool, &run, Control::Retry).await.unwrap(),
            ControlOutcome::Changed {
                status: "pending",
                restart: true
            }
        );
        assert_eq!(status_of(&pool, &run).await.1, 0);
    }

    #[tokio::test]
    async fn enqueue_is_idempotent_per_message() {
        let pool = pool().await;
        let run = record_user_turn(&pool, "proj", "agent-1", "hello")
            .await
            .unwrap();
        let msg: (String,) = sqlx::query_as("SELECT message_uuid FROM agent_runs WHERE uuid = $1")
            .bind(&run)
            .fetch_one(&pool)
            .await
            .unwrap();
        let again = enqueue(&pool, "proj", "agent-1", &msg.0).await.unwrap();
        assert_eq!(run, again);
    }

    #[test]
    fn history_keeps_failed_command_and_file() {
        let tools = r#"[{"name":"write_project_file","arguments":{"path":"src/pages/index.astro"},"result":{"ok":true}},{"name":"run_workdir_command","arguments":{"command":"npm run build"},"result":{"ok":false,"error":"exit 1","stderr":"Cannot find module"}}]"#;
        let text = assistant_content_with_tools("J'ai modifié la page.", tools);
        assert!(text.contains("src/pages/index.astro"));
        assert!(text.contains("npm run build"));
        assert!(text.contains("Cannot find module"));
    }

    #[test]
    fn preview_repair_runs_once_and_skips_a_green_preview() {
        let red = r#"[{"name":"start_local_preview","arguments":{},"result":{"ok":false,"public_ok":false,"error":"URL publique KO","logs_tail":"Error: astro"}}]"#;
        let prompt = preview_repair_prompt("améliore la page", red).unwrap();
        assert!(prompt.starts_with(PREVIEW_REPAIR_PREFIX));
        assert!(prompt.contains("astro"));
        assert!(preview_repair_prompt(&prompt, red).is_none());
        let green = r#"[{"name":"start_local_preview","arguments":{},"result":{"ok":true,"public_ok":true}}]"#;
        assert!(preview_repair_prompt("go", green).is_none());
        let domain = r#"[{"name":"start_local_preview","arguments":{},"result":{"ok":false,"error":"Domaine wildcard manquant"}}]"#;
        assert!(preview_repair_prompt("go", domain).is_none());
    }

    #[test]
    fn deploy_repair_followup_forces_npm_then_stops() {
        let narrated = deploy_repair_followup(
            "AUTO-RÉPARATION DÉPLOIEMENT\npackage-lock désynchronisé",
            "[]",
        )
        .unwrap();
        assert!(narrated.contains("run_workdir_command"));
        assert!(deploy_repair_followup(&narrated, "[]").is_none());
        let installed = r#"[{"name":"run_workdir_command","arguments":{"command":"npm install"},"result":{"ok":true}}]"#;
        let next =
            deploy_repair_followup("AUTO-RÉPARATION DÉPLOIEMENT\npackage-lock", installed).unwrap();
        assert!(next.contains("package-lock.json"));
        assert!(deploy_repair_followup(&next, installed).is_none());
        let done = r#"[{"name":"run_workdir_command","arguments":{"command":"npm install"},"result":{"ok":true}},{"name":"trigger_deploy","arguments":{},"result":{"ok":true}}]"#;
        assert!(deploy_repair_followup("AUTO-RÉPARATION", done).is_none());
        let blocked = r#"[{"name":"run_workdir_command","arguments":{"command":"npm install"},"result":{"ok":true}},{"name":"sync_workdir_to_github","arguments":{},"result":{"ok":false,"code":"publish_approval_required"}}]"#;
        assert!(
            deploy_repair_followup("AUTO-RÉPARATION DÉPLOIEMENT\npackage-lock", blocked).is_none(),
            "en attente de validation : pas de relance"
        );
    }
}
