//! Contrôle de changement avant tout réveil automatique d'agent (P1-10).
//!
//! Un run LLM complet coûte cher ; la plupart des passages planifiés (routines P5-05, agents
//! cron, réveils santé) observent exactement le même état qu'au passage précédent. Avant de
//! lancer, on calcule une empreinte de l'état observé (dernier déploiement + statut, HEAD et
//! brouillon du workdir, résultat http_smoke, configuration de la routine…) et on la compare à
//! la dernière empreinte enregistrée pour ce réveil :
//! - inchangée → pas de run, une ligne « ignoré » (les ignorés consécutifs sont regroupés) ;
//! - changée (ou jamais vue) → run, ligne « lancé » puis « terminé » / « échec ».
//! Un run en échec n'est pas relancé sur le même état : il sera retenté au prochain changement.
//!
//! Voisins : P1-07 (`wake_causes`, dédup des réveils d'échec par cause) et la garde
//! auto-deploy (`auto_deploy_guard`, jamais deux fois le même SHA en échec) écrivent aussi
//! dans ce journal, pour que l'historique des réveils soit complet au même endroit.

use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use sqlx::PgPool;

use crate::state::{AppState, Project};

pub const LAUNCHED: &str = "launched";
pub const SKIPPED: &str = "skipped";
pub const DONE: &str = "done";
pub const FAILED: &str = "failed";

pub async fn migrate(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS agent_wake_state (
            project_uuid TEXT NOT NULL,
            wake_key     TEXT NOT NULL,
            state_hash   TEXT NOT NULL,
            outcome      TEXT NOT NULL,
            updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (project_uuid, wake_key)
        );
        "#,
    )
    .execute(pool)
    .await?;
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS agent_wake_log (
            id           BIGSERIAL PRIMARY KEY,
            project_uuid TEXT NOT NULL,
            source       TEXT NOT NULL,
            wake_key     TEXT NOT NULL,
            label        TEXT NOT NULL DEFAULT '',
            outcome      TEXT NOT NULL,
            cause        TEXT NOT NULL DEFAULT '',
            state_hash   TEXT NOT NULL DEFAULT '',
            run_uuid     TEXT NULL,
            repeat       INT NOT NULL DEFAULT 1,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        "#,
    )
    .execute(pool)
    .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS agent_wake_log_project ON agent_wake_log (project_uuid, last_at DESC)")
        .execute(pool)
        .await?;
    Ok(())
}

/* ---------------- Empreinte & décision (pur) ---------------- */

fn canonical(v: &Value) -> Value {
    match v {
        Value::Object(m) => {
            let mut keys: Vec<&String> = m.keys().collect();
            keys.sort();
            let mut out = Map::new();
            for k in keys {
                out.insert(k.clone(), canonical(&m[k]));
            }
            Value::Object(out)
        }
        Value::Array(a) => Value::Array(a.iter().map(canonical).collect()),
        other => other.clone(),
    }
}

/// `sha256(JSON canonique)[:16]` : indépendant de l'ordre des clés.
pub fn fingerprint(observed: &Value) -> String {
    let mut h = Sha256::new();
    h.update(canonical(observed).to_string().as_bytes());
    h.finalize()
        .iter()
        .take(8)
        .map(|b| format!("{b:02x}"))
        .collect()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    Launch { cause: String },
    Skip { cause: String },
}

/// `prev` : (empreinte, issue) du dernier passage pour ce réveil.
pub fn decide(prev: Option<(&str, &str)>, hash: &str) -> Decision {
    match prev {
        None => Decision::Launch {
            cause: "premier passage".into(),
        },
        Some((h, _)) if h != hash => Decision::Launch {
            cause: "état changé".into(),
        },
        Some((_, FAILED)) => Decision::Skip {
            cause: "même état que l'échec précédent — nouvel essai au prochain changement".into(),
        },
        Some((_, LAUNCHED)) => Decision::Skip {
            cause: "run déjà lancé sur cet état".into(),
        },
        Some(_) => Decision::Skip {
            cause: "état inchangé".into(),
        },
    }
}

/// Run déclenché sans personne devant l'écran (réveil, cron, routine, auto-réparation) :
/// les actions distantes s'arrêtent à une demande de validation, même avec un accord récent.
pub fn is_unattended(content: &str) -> bool {
    let c = content.trim_start();
    c.starts_with("COORD-WAKE:")
        || c.starts_with("AGENT-WAKE:CRON")
        || c.starts_with("ROUTINE:")
        || c.starts_with("CRON:")
        || c.starts_with("EVENT:")
        || c.contains("AUTO-RÉPARATION")
}

/* ---------------- Journal ---------------- */

#[derive(Debug, Clone)]
pub struct Gate {
    pub decision: Decision,
    pub hash: String,
    /// Ligne « lancé » à compléter par `finish` (None si ignoré).
    pub log_id: Option<i64>,
}

impl Gate {
    pub fn launch(&self) -> bool {
        matches!(self.decision, Decision::Launch { .. })
    }
}

/// Compare l'état observé au dernier passage, journalise, et dit s'il faut lancer.
pub async fn check(
    pool: &PgPool,
    project_uuid: &str,
    source: &str,
    key: &str,
    label: &str,
    observed: &Value,
) -> Gate {
    let hash = fingerprint(observed);
    let prev: Option<(String, String)> =
        sqlx::query_as("SELECT state_hash, outcome FROM agent_wake_state WHERE project_uuid = $1 AND wake_key = $2")
            .bind(project_uuid)
            .bind(key)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();
    let decision = decide(prev.as_ref().map(|(h, o)| (h.as_str(), o.as_str())), &hash);
    let log_id = match &decision {
        Decision::Skip { cause } => {
            record(
                pool,
                project_uuid,
                source,
                key,
                label,
                SKIPPED,
                cause,
                &hash,
                None,
            )
            .await;
            None
        }
        Decision::Launch { cause } => {
            set_state(pool, project_uuid, key, &hash, LAUNCHED).await;
            record(
                pool,
                project_uuid,
                source,
                key,
                label,
                LAUNCHED,
                cause,
                &hash,
                None,
            )
            .await
        }
    };
    Gate {
        decision,
        hash,
        log_id,
    }
}

/// Fin d'un run lancé par `check` : issue retenue pour la prochaine décision.
pub async fn finish(
    pool: &PgPool,
    project_uuid: &str,
    key: &str,
    gate: &Gate,
    ok: bool,
    cause: &str,
    run_uuid: Option<&str>,
) {
    let outcome = if ok { DONE } else { FAILED };
    set_state(pool, project_uuid, key, &gate.hash, outcome).await;
    if let Some(id) = gate.log_id {
        let _ = sqlx::query(
            "UPDATE agent_wake_log SET outcome = $1, cause = CASE WHEN $2 = '' THEN cause ELSE $2 END, run_uuid = COALESCE($3, run_uuid), last_at = now() WHERE id = $4",
        )
        .bind(outcome)
        .bind(cause.chars().take(240).collect::<String>())
        .bind(run_uuid)
        .bind(id)
        .execute(pool)
        .await;
    }
}

async fn set_state(pool: &PgPool, project_uuid: &str, key: &str, hash: &str, outcome: &str) {
    let _ = sqlx::query(
        r#"INSERT INTO agent_wake_state (project_uuid, wake_key, state_hash, outcome, updated_at)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (project_uuid, wake_key) DO UPDATE SET state_hash = excluded.state_hash, outcome = excluded.outcome, updated_at = now()"#,
    )
    .bind(project_uuid)
    .bind(key)
    .bind(hash)
    .bind(outcome)
    .execute(pool)
    .await;
}

/// Ajoute une ligne au journal. Des « ignoré » consécutifs identiques (même réveil, même
/// empreinte, même cause) sont regroupés : compteur `repeat` + `last_at`.
#[allow(clippy::too_many_arguments)]
pub async fn record(
    pool: &PgPool,
    project_uuid: &str,
    source: &str,
    key: &str,
    label: &str,
    outcome: &str,
    cause: &str,
    hash: &str,
    run_uuid: Option<&str>,
) -> Option<i64> {
    let cause: String = cause.chars().take(240).collect();
    if outcome == SKIPPED {
        let last: Option<(i64, String, String, String)> = sqlx::query_as(
            "SELECT id, outcome, state_hash, cause FROM agent_wake_log WHERE project_uuid = $1 AND wake_key = $2 ORDER BY id DESC LIMIT 1",
        )
        .bind(project_uuid)
        .bind(key)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();
        if let Some((id, o, h, c)) = last {
            if o == SKIPPED && h == hash && c == cause {
                let _ = sqlx::query(
                    "UPDATE agent_wake_log SET repeat = repeat + 1, last_at = now() WHERE id = $1",
                )
                .bind(id)
                .execute(pool)
                .await;
                return Some(id);
            }
        }
    }
    sqlx::query_as::<_, (i64,)>(
        r#"INSERT INTO agent_wake_log (project_uuid, source, wake_key, label, outcome, cause, state_hash, run_uuid)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id"#,
    )
    .bind(project_uuid)
    .bind(source)
    .bind(key)
    .bind(label.chars().take(120).collect::<String>())
    .bind(outcome)
    .bind(&cause)
    .bind(hash)
    .bind(run_uuid)
    .fetch_one(pool)
    .await
    .ok()
    .map(|(id,)| id)
}

/// Après `wake_project_agent` : relie la ligne « lancé » au run créé (fin suivie par
/// `finish_by_run`), ou la clôt tout de suite si le réveil n'a pas pu partir.
pub async fn after_wake(
    pool: &PgPool,
    project_uuid: &str,
    key: &str,
    agent_uuid: &str,
    gate: &Gate,
    res: &Result<(), String>,
) {
    if let Err(e) = res {
        finish(
            pool,
            project_uuid,
            key,
            gate,
            false,
            &format!("réveil impossible : {e}"),
            None,
        )
        .await;
        return;
    }
    // Le run peut déjà être terminé (tour court ou attendu par l'appelant) : on prend le run
    // de l'agent créé depuis le réveil, quel que soit son statut, sinon le dernier en cours.
    let since = gate.log_id.map(|id| id).unwrap_or(0);
    let run: Option<(String, String)> = sqlx::query_as(
        r#"SELECT r.uuid, r.status FROM agent_runs r
           WHERE r.project_uuid = $1 AND r.agent_uuid = $2
             AND (r.status IN ('pending', 'queued', 'running')
                  OR r.created_at >= COALESCE((SELECT to_char(l.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') FROM agent_wake_log l WHERE l.id = $3), ''))
           ORDER BY r.created_at DESC LIMIT 1"#,
    )
    .bind(project_uuid)
    .bind(agent_uuid)
    .bind(since)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    match (run, gate.log_id) {
        (Some((run_uuid, status)), Some(id)) => {
            let _ = sqlx::query("UPDATE agent_wake_log SET run_uuid = $1 WHERE id = $2")
                .bind(&run_uuid)
                .bind(id)
                .execute(pool)
                .await;
            if !matches!(status.as_str(), "pending" | "queued" | "running") {
                finish_by_run(pool, &run_uuid).await;
            }
        }
        // Réveil dédupliqué par marqueur ou agent désactivé : rien ne tourne.
        _ => {
            finish(
                pool,
                project_uuid,
                key,
                gate,
                true,
                "aucun run (réveil déjà envoyé ou agent désactivé)",
                None,
            )
            .await
        }
    }
}

/// Fin d'un run d'agent : si un réveil journalisé l'attendait, on retient son issue.
pub async fn finish_by_run(pool: &PgPool, run_uuid: &str) {
    let row: Option<(i64, String, String, String)> = sqlx::query_as(
        "SELECT id, project_uuid, wake_key, state_hash FROM agent_wake_log WHERE run_uuid = $1 AND outcome = 'launched' ORDER BY id DESC LIMIT 1",
    )
    .bind(run_uuid)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    let Some((id, project_uuid, key, hash)) = row else {
        return;
    };
    let run: Option<(String, Option<String>)> =
        sqlx::query_as("SELECT status, error FROM agent_runs WHERE uuid = $1")
            .bind(run_uuid)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();
    let (status, error) = run.unwrap_or_else(|| ("failed".into(), Some("run introuvable".into())));
    let ok = status == "completed" || status == "success" || status == "done";
    let cause = if ok {
        String::new()
    } else {
        error
            .filter(|e| !e.trim().is_empty())
            .unwrap_or_else(|| format!("run {status}"))
    };
    let gate = Gate {
        decision: Decision::Launch {
            cause: String::new(),
        },
        hash,
        log_id: Some(id),
    };
    finish(pool, &project_uuid, &key, &gate, ok, &cause, Some(run_uuid)).await;
}

/* ---------------- État observé ---------------- */

async fn latest_deploy(pool: &PgPool, project_id: i64) -> Value {
    let row: Option<(String, String, Option<String>)> = sqlx::query_as(
        r#"SELECT uuid, status, git_sha FROM deployments
           WHERE project_id = $1 AND COALESCE(environment, 'production') = 'production'
           ORDER BY created_at DESC LIMIT 1"#,
    )
    .bind(project_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    match row {
        Some((uuid, status, sha)) => json!({ "uuid": uuid, "status": status, "sha": sha }),
        None => Value::Null,
    }
}

/// HEAD et nombre de fichiers modifiés du workdir (local, quelques ms).
async fn draft_state(project: &Project) -> Value {
    let configured = project.workdir.as_deref().unwrap_or("").trim().to_string();
    if configured.is_empty() {
        return Value::Null;
    }
    let wd = devforge_deploy::resolve_project_workdir(&configured, &project.uuid);
    tokio::task::spawn_blocking(move || {
        let git = |args: &[&str]| {
            std::process::Command::new("git")
                .arg("-C")
                .arg(&wd)
                .args(args)
                .output()
                .ok()
                .filter(|o| o.status.success())
                .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        };
        let head = git(&["rev-parse", "HEAD"]).map(|s| s.trim().to_string());
        let dirty = git(&["status", "--porcelain"]).map(|s| s.lines().count());
        json!({ "head": head, "dirty": dirty })
    })
    .await
    .unwrap_or(Value::Null)
}

async fn smoke_state(project: &Project) -> Value {
    let Some(url) = project
        .production_url
        .as_deref()
        .map(str::trim)
        .filter(|u| u.starts_with("http://") || u.starts_with("https://"))
    else {
        return Value::Null;
    };
    let r = devforge_agent::smoke_url(url, None).await;
    // Seuls le status et l'accessibilité comptent (pas la durée, qui varie à chaque essai).
    json!({ "status": r.get("status").cloned().unwrap_or(Value::Null), "ok": r.get("ok").cloned().unwrap_or(Value::Null) })
}

/// État observé d'un projet ; `extra` = ce qui est propre au réveil (consigne, statut…).
pub async fn observe(state: &AppState, project: &Project, with_smoke: bool, extra: Value) -> Value {
    let smoke = if with_smoke {
        smoke_state(project).await
    } else {
        Value::Null
    };
    json!({
        "deploy": latest_deploy(&state.pool, project.id).await,
        "project_status": project.status,
        "draft": draft_state(project).await,
        "smoke": smoke,
        "extra": extra,
    })
}

pub async fn project_by_uuid(state: &AppState, uuid: &str) -> Option<Project> {
    sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE uuid = $1")
        .bind(uuid)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten()
}

/* ---------------- API ---------------- */

pub fn router() -> axum::Router<AppState> {
    axum::Router::new().route(
        "/api/v1/projects/{uuid}/wake-log",
        axum::routing::get(list_log),
    )
}

#[derive(serde::Deserialize)]
struct LogQuery {
    limit: Option<i64>,
}

async fn list_log(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: axum::http::HeaderMap,
    axum::extract::Path(uuid): axum::extract::Path<String>,
    axum::extract::Query(q): axum::extract::Query<LogQuery>,
) -> Result<axum::Json<Value>, crate::routes::ApiError> {
    let _ = crate::routes::auth_project(&state, &headers, &uuid).await?;
    Ok(axum::Json(
        json!({ "data": list(&state.pool, &uuid, q.limit.unwrap_or(30)).await }),
    ))
}

pub async fn list(pool: &PgPool, project_uuid: &str, limit: i64) -> Vec<Value> {
    #[allow(clippy::type_complexity)]
    let rows: Vec<(i64, String, String, String, String, String, String, Option<String>, i32, chrono::DateTime<chrono::Utc>, chrono::DateTime<chrono::Utc>)> =
        sqlx::query_as(
            r#"SELECT id, source, wake_key, label, outcome, cause, state_hash, run_uuid, repeat, created_at, last_at
               FROM agent_wake_log WHERE project_uuid = $1 ORDER BY last_at DESC, id DESC LIMIT $2"#,
        )
        .bind(project_uuid)
        .bind(limit.clamp(1, 200))
        .fetch_all(pool)
        .await
        .unwrap_or_default();
    rows.into_iter()
        .map(
            |(id, source, key, label, outcome, cause, hash, run, repeat, created, last)| {
                json!({
                    "id": id, "source": source, "key": key, "label": label, "outcome": outcome,
                    "cause": cause, "state_hash": hash, "run_uuid": run, "repeat": repeat,
                    "created_at": created.to_rfc3339(), "last_at": last.to_rfc3339(),
                })
            },
        )
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fingerprint_ignores_key_order_and_detects_changes() {
        let a =
            json!({"deploy": {"status": "success", "sha": "abc1234"}, "smoke": {"status": 200}});
        let b =
            json!({"smoke": {"status": 200}, "deploy": {"sha": "abc1234", "status": "success"}});
        assert_eq!(fingerprint(&a), fingerprint(&b));
        let c = json!({"deploy": {"status": "failed", "sha": "abc1234"}, "smoke": {"status": 200}});
        assert_ne!(fingerprint(&a), fingerprint(&c));
        assert_eq!(fingerprint(&a).len(), 16);
    }

    #[test]
    fn decision_table() {
        assert!(matches!(decide(None, "h1"), Decision::Launch { .. }));
        assert!(matches!(
            decide(Some(("h0", DONE)), "h1"),
            Decision::Launch { .. }
        ));
        assert!(matches!(
            decide(Some(("h0", FAILED)), "h1"),
            Decision::Launch { .. }
        ));
        assert!(matches!(
            decide(Some(("h1", DONE)), "h1"),
            Decision::Skip { .. }
        ));
        assert!(matches!(
            decide(Some(("h1", LAUNCHED)), "h1"),
            Decision::Skip { .. }
        ));
        match decide(Some(("h1", FAILED)), "h1") {
            Decision::Skip { cause } => assert!(cause.contains("prochain changement")),
            d => panic!("{d:?}"),
        }
    }

    #[test]
    fn unattended_triggers() {
        assert!(is_unattended("COORD-WAKE:DEPLOY-FAIL:abc\n\nÉvénement"));
        assert!(is_unattended("AGENT-WAKE:CRON:x:2026-10-13T01:00"));
        assert!(is_unattended("ROUTINE:12 « Smoke »"));
        assert!(is_unattended("AUTO-RÉPARATION DÉPLOIEMENT\n…"));
        assert!(!is_unattended("AGENT-WAKE:MANUAL\n\nLancement manuel"));
        assert!(!is_unattended("pousse le correctif"));
    }

    /// Rejeu : N passages identiques → 1 run + N-1 ignorés (regroupés) ; un changement → run ;
    /// un run en échec est journalisé, pas relancé sur le même état, retenté au changement.
    #[tokio::test]
    async fn replay_on_postgres() {
        let pool = devforge_database::ephemeral_pg().await;
        migrate(&pool).await.unwrap();
        let (p, key) = ("proj-r", "routine:42");
        let s1 = json!({"deploy": {"uuid": "d1", "status": "success", "sha": "aaa1111"}, "smoke": {"status": 200}});
        let n = 12;
        let mut runs = 0;
        for _ in 0..n {
            let g = check(&pool, p, "routine", key, "Smoke accueil", &s1).await;
            if g.launch() {
                runs += 1;
                finish(&pool, p, key, &g, true, "OK : 200", Some("run-1")).await;
            }
        }
        assert_eq!(runs, 1);
        let (skipped,): (i64,) = sqlx::query_as("SELECT COALESCE(SUM(repeat), 0) FROM agent_wake_log WHERE project_uuid = $1 AND outcome = 'skipped'")
            .bind(p).fetch_one(&pool).await.unwrap();
        assert_eq!(skipped, (n - 1) as i64);
        let log = list(&pool, p, 50).await;
        assert_eq!(
            log.len(),
            2,
            "1 lancé (terminé) + 1 ligne d'ignorés regroupés : {log:?}"
        );
        assert_eq!(log[1]["outcome"], "done");
        assert_eq!(log[0]["repeat"], (n - 1) as i64);

        // Changement d'état (nouveau déploiement) → run, qui échoue.
        let s2 = json!({"deploy": {"uuid": "d2", "status": "failed", "sha": "bbb2222"}, "smoke": {"status": 502}});
        let g = check(&pool, p, "routine", key, "Smoke accueil", &s2).await;
        assert!(g.launch());
        finish(&pool, p, key, &g, false, "ÉCHEC : 502", Some("run-2")).await;
        // Même état : pas de nouvel essai, l'échec reste visible.
        for _ in 0..3 {
            assert!(!check(&pool, p, "routine", key, "Smoke accueil", &s2)
                .await
                .launch());
        }
        let log = list(&pool, p, 50).await;
        assert!(log
            .iter()
            .any(|r| r["outcome"] == "failed" && r["cause"] == "ÉCHEC : 502"));
        assert!(log[0]["cause"]
            .as_str()
            .unwrap()
            .contains("prochain changement"));
        // Le site revient : nouvel état → nouvel essai.
        let s3 = json!({"deploy": {"uuid": "d2", "status": "failed", "sha": "bbb2222"}, "smoke": {"status": 200}});
        assert!(check(&pool, p, "routine", key, "Smoke accueil", &s3)
            .await
            .launch());
        // Les réveils d'un autre projet / d'une autre clé sont indépendants.
        assert!(check(&pool, "autre", "routine", key, "x", &s1)
            .await
            .launch());
        assert!(check(&pool, p, "health", "health:unhealthy", "x", &s1)
            .await
            .launch());
    }
}
