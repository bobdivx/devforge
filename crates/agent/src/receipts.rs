//! P2 : reçus d'approbation (« approval receipts »).
//!
//! Idée reprise d'OpenMuse (MIT), pas le code : chaque action risque validée par un humain
//! laisse un reçu « qui / quoi / quand / version / issue ».
//!
//! - L'action est identifiée par un hash SHA-256 (projet + action + cible + version).
//! - Une validation vaut 30 min et ne sert qu'une fois (`approved` → `executing`, claim SQL atomique).
//! - Issue : `done`, `failed`, ou `unknown` quand DevForge redémarre au milieu de l'action.
//! - Une action d'agent déjà faite avant une reprise de run n'est pas rejouée (idempotence par run).
//!
//! Statuts : `pending` (l'agent attend une validation), `approved`, `executing`, `done`, `failed`,
//! `unknown`, `expired`.

use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::PgPool;

/// Durée de validité d'une validation non encore utilisée.
pub const APPROVAL_TTL_MINUTES: i64 = 30;

pub const UNKNOWN_AFTER_RESTART: &str =
    "DevForge a redémarré pendant l'action : issue inconnue. Vérifie le résultat avant de relancer.";

/// Outils dont l'issue réelle est celle du déploiement lancé.
pub const LAUNCHES_DEPLOY: &[&str] = &["trigger_deploy", "publish_to_github"];

/// Statuts terminaux (le reçu ne bouge plus, sauf `unknown` qui peut être éclairci plus tard).
pub const FINAL: &[&str] = &["done", "failed", "expired"];

pub async fn migrate(pool: &PgPool) -> Result<(), sqlx::Error> {
    for sql in [
        r#"CREATE TABLE IF NOT EXISTS approval_receipts (
            uuid              TEXT PRIMARY KEY,
            workspace_uuid    TEXT NULL,
            project_uuid      TEXT NULL,
            project_name      TEXT NULL,
            action            TEXT NOT NULL,
            action_label      TEXT NOT NULL,
            target            TEXT NOT NULL DEFAULT '',
            version           TEXT NULL,
            action_hash       TEXT NOT NULL,
            status            TEXT NOT NULL,
            source            TEXT NOT NULL DEFAULT 'web',
            approved_by       TEXT NULL,
            approved_by_label TEXT NULL,
            approved_at       TIMESTAMPTZ NULL,
            expires_at        TIMESTAMPTZ NULL,
            consumed_at       TIMESTAMPTZ NULL,
            finished_at       TIMESTAMPTZ NULL,
            detail            TEXT NULL,
            run_uuid          TEXT NULL,
            tool_name         TEXT NULL,
            deployment_uuid   TEXT NULL,
            created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
        )"#,
        "ALTER TABLE approval_receipts ADD COLUMN IF NOT EXISTS deployment_uuid TEXT NULL",
        "ALTER TABLE approval_receipts ADD COLUMN IF NOT EXISTS tool_name TEXT NULL",
        "CREATE INDEX IF NOT EXISTS idx_receipts_ws_created ON approval_receipts (workspace_uuid, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_receipts_project ON approval_receipts (project_uuid, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_receipts_status ON approval_receipts (status)",
        "CREATE INDEX IF NOT EXISTS idx_receipts_run_hash ON approval_receipts (run_uuid, action_hash)",
        "CREATE INDEX IF NOT EXISTS idx_receipts_deployment ON approval_receipts (deployment_uuid)",
        // Qui a donné l'accord de publication (reçus des actions d'agent).
        "CREATE TABLE IF NOT EXISTS project_publish_grants (project_uuid TEXT PRIMARY KEY, granted_at TEXT NOT NULL, expires_at TEXT NOT NULL)",
        "ALTER TABLE project_publish_grants ADD COLUMN IF NOT EXISTS granted_by TEXT NULL",
        "ALTER TABLE project_publish_grants ADD COLUMN IF NOT EXISTS granted_by_label TEXT NULL",
    ] {
        sqlx::query(sql).execute(pool).await?;
    }
    Ok(())
}

/// Hash stable d'une action : même projet, même action, même cible, même version → même hash.
pub fn action_hash(project_uuid: &str, action: &str, target: &str, version: &str) -> String {
    let mut h = Sha256::new();
    for part in [project_uuid, action, target, version] {
        h.update(part.trim().as_bytes());
        h.update([0x1f]);
    }
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// JSON canonique (clés triées) : deux appels d'outil identiques donnent le même hash.
pub fn canonical_json(v: &Value) -> String {
    match v {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let inner: Vec<String> = keys
                .into_iter()
                .map(|k| format!("{}:{}", json!(k), canonical_json(&map[k])))
                .collect();
            format!("{{{}}}", inner.join(","))
        }
        Value::Array(a) => format!(
            "[{}]",
            a.iter().map(canonical_json).collect::<Vec<_>>().join(",")
        ),
        other => other.to_string(),
    }
}

/// Hash d'un appel d'outil d'agent (outil + arguments canoniques, hors champs volatils).
pub fn tool_hash(project_uuid: &str, tool: &str, args: &Value) -> String {
    let mut a = args.clone();
    if let Some(o) = a.as_object_mut() {
        for k in ["project_uuid", "run_uuid", "agent_uuid"] {
            o.remove(k);
        }
    }
    action_hash(project_uuid, "agent_tool", tool, &canonical_json(&a))
}

/// Nouvelle action validée par un humain dans l'UI (déployer, reconstruire, arrêter…).
#[derive(Debug, Clone, Default)]
pub struct NewReceipt {
    pub workspace_uuid: Option<String>,
    pub project_uuid: Option<String>,
    pub project_name: Option<String>,
    pub action: String,
    pub action_label: String,
    pub target: String,
    pub version: Option<String>,
    pub source: String,
    pub approved_by: Option<String>,
    pub approved_by_label: Option<String>,
    pub approved_at: Option<DateTime<Utc>>,
    pub run_uuid: Option<String>,
    pub tool_name: Option<String>,
    pub deployment_uuid: Option<String>,
    pub detail: Option<String>,
    /// Hash imposé (outil d'agent) ; sinon calculé.
    pub action_hash: Option<String>,
}

impl NewReceipt {
    pub fn hash(&self) -> String {
        self.action_hash.clone().unwrap_or_else(|| {
            action_hash(
                self.project_uuid.as_deref().unwrap_or(""),
                &self.action,
                &self.target,
                self.version.as_deref().unwrap_or(""),
            )
        })
    }
}

fn new_uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

async fn insert(pool: &PgPool, r: &NewReceipt, status: &str) -> Result<String, sqlx::Error> {
    let uuid = new_uuid();
    let now = Utc::now();
    let approved_at = r
        .approved_at
        .or(if status == "pending" { None } else { Some(now) });
    let expires_at = approved_at
        .unwrap_or(now)
        .checked_add_signed(Duration::minutes(APPROVAL_TTL_MINUTES));
    let consumed_at = if status == "executing" {
        Some(now)
    } else {
        None
    };
    sqlx::query(
        r#"INSERT INTO approval_receipts (
            uuid, workspace_uuid, project_uuid, project_name, action, action_label, target, version,
            action_hash, status, source, approved_by, approved_by_label, approved_at, expires_at,
            consumed_at, detail, run_uuid, tool_name, deployment_uuid, created_at, updated_at)
           VALUES ($1,
             COALESCE($2, (SELECT workspace_uuid FROM projects WHERE uuid = $3 LIMIT 1)),
             $3,
             COALESCE($4, (SELECT name FROM projects WHERE uuid = $3 LIMIT 1)),
             $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $21)"#,
    )
    .bind(&uuid)
    .bind(&r.workspace_uuid)
    .bind(&r.project_uuid)
    .bind(&r.project_name)
    .bind(&r.action)
    .bind(&r.action_label)
    .bind(&r.target)
    .bind(&r.version)
    .bind(r.hash())
    .bind(status)
    .bind(if r.source.is_empty() {
        "web"
    } else {
        r.source.as_str()
    })
    .bind(&r.approved_by)
    .bind(&r.approved_by_label)
    .bind(approved_at)
    .bind(expires_at)
    .bind(consumed_at)
    .bind(&r.detail)
    .bind(&r.run_uuid)
    .bind(&r.tool_name)
    .bind(&r.deployment_uuid)
    .bind(now)
    .execute(pool)
    .await?;
    Ok(uuid)
}

/// Action confirmée et lancée tout de suite (la validation est consommée à la création).
pub async fn begin(pool: &PgPool, r: &NewReceipt) -> Result<String, sqlx::Error> {
    insert(pool, r, "executing").await
}

/// Reçu d'une décision sans exécution derrière (ex. accord de publication donné).
pub async fn record_done(pool: &PgPool, r: &NewReceipt) -> Result<String, sqlx::Error> {
    let uuid = insert(pool, r, "executing").await?;
    finish(pool, &uuid, "done", r.detail.as_deref()).await?;
    Ok(uuid)
}

/// Proposition en attente de validation (agent bloqué). Idempotente : une proposition vivante
/// pour le même hash est réutilisée.
pub async fn propose(pool: &PgPool, r: &NewReceipt) -> Result<String, sqlx::Error> {
    let hash = r.hash();
    let existing: Option<(String,)> = sqlx::query_as(
        r#"SELECT uuid FROM approval_receipts
           WHERE project_uuid IS NOT DISTINCT FROM $1 AND action_hash = $2
             AND status IN ('pending', 'approved') AND expires_at > now()
           ORDER BY created_at DESC LIMIT 1"#,
    )
    .bind(&r.project_uuid)
    .bind(&hash)
    .fetch_optional(pool)
    .await?;
    if let Some((uuid,)) = existing {
        return Ok(uuid);
    }
    insert(pool, r, "pending").await
}

/// L'humain valide : les propositions vivantes du projet passent `approved` (30 min).
pub async fn approve_pending(
    pool: &PgPool,
    project_uuid: &str,
    user_uuid: Option<&str>,
    user_label: Option<&str>,
) -> Result<u64, sqlx::Error> {
    let r = sqlx::query(
        r#"UPDATE approval_receipts
           SET status = 'approved', approved_by = $2, approved_by_label = $3,
               approved_at = now(), expires_at = now() + make_interval(mins => $4::int),
               updated_at = now()
           WHERE project_uuid = $1 AND status = 'pending' AND expires_at > now()"#,
    )
    .bind(project_uuid)
    .bind(user_uuid)
    .bind(user_label)
    .bind(APPROVAL_TTL_MINUTES as i32)
    .execute(pool)
    .await?;
    Ok(r.rows_affected())
}

/// Usage unique : `approved` (non expiré, même hash) → `executing`. Un seul gagnant.
pub async fn consume(
    pool: &PgPool,
    project_uuid: &str,
    hash: &str,
    run_uuid: Option<&str>,
) -> Result<Option<String>, sqlx::Error> {
    let row: Option<(String,)> = sqlx::query_as(
        r#"UPDATE approval_receipts
           SET status = 'executing', consumed_at = now(), updated_at = now(),
               run_uuid = COALESCE($3, run_uuid)
           WHERE uuid = (
               SELECT uuid FROM approval_receipts
               WHERE project_uuid = $1 AND action_hash = $2 AND status = 'approved'
                 AND expires_at > now()
               ORDER BY approved_at DESC
               LIMIT 1
               FOR UPDATE SKIP LOCKED)
             AND status = 'approved'
           RETURNING uuid"#,
    )
    .bind(project_uuid)
    .bind(hash)
    .bind(run_uuid)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(u,)| u))
}

/// Issue de l'action. N'écrit que sur un reçu en cours (ou `unknown`, que l'on peut éclaircir).
pub async fn finish(
    pool: &PgPool,
    uuid: &str,
    status: &str,
    detail: Option<&str>,
) -> Result<bool, sqlx::Error> {
    let r = sqlx::query(
        r#"UPDATE approval_receipts
           SET status = $2, detail = COALESCE($3, detail), finished_at = now(), updated_at = now()
           WHERE uuid = $1 AND status IN ('executing', 'unknown')"#,
    )
    .bind(uuid)
    .bind(status)
    .bind(detail.map(|d| truncate(d, 500)))
    .execute(pool)
    .await?;
    Ok(r.rows_affected() == 1)
}

/// Rattache un déploiement : son issue finale deviendra celle du reçu.
pub async fn link_deployment(
    pool: &PgPool,
    uuid: &str,
    deployment_uuid: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE approval_receipts SET deployment_uuid = $2, updated_at = now() WHERE uuid = $1",
    )
    .bind(uuid)
    .bind(deployment_uuid)
    .execute(pool)
    .await?;
    Ok(())
}

/// Au démarrage : toute action restée `executing` a été coupée → `unknown` (jamais rejouée).
pub async fn mark_interrupted(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let r = sqlx::query(
        r#"UPDATE approval_receipts
           SET status = 'unknown', detail = $1, updated_at = now()
           WHERE status = 'executing'"#,
    )
    .bind(UNKNOWN_AFTER_RESTART)
    .execute(pool)
    .await?;
    Ok(r.rows_affected())
}

/// Validations jamais utilisées au-delà de 30 min → `expired`.
pub async fn expire_stale(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let r = sqlx::query(
        r#"UPDATE approval_receipts SET status = 'expired', updated_at = now(),
               detail = COALESCE(detail, 'Validation non utilisée sous 30 min.')
           WHERE status IN ('pending', 'approved') AND expires_at <= now()"#,
    )
    .execute(pool)
    .await?;
    Ok(r.rows_affected())
}

/// Ce qu'un run a déjà fait avant ce tour (reprise après redémarrage, pause ou relance).
#[derive(Debug, Clone, PartialEq)]
pub enum Prior {
    /// Rien d'enregistré : on exécute.
    None,
    /// Déjà exécuté avec succès : on ne rejoue pas.
    Done { uuid: String },
    /// Coupé en route (issue inconnue) : on ne rejoue pas sans nouvelle validation.
    Unknown { uuid: String },
}

pub async fn prior_in_run(
    pool: &PgPool,
    run_uuid: &str,
    hash: &str,
    turn_started: DateTime<Utc>,
) -> Result<Prior, sqlx::Error> {
    let row: Option<(String, String, DateTime<Utc>, Option<String>)> = sqlx::query_as(
        r#"SELECT r.uuid, r.status, r.created_at, g.granted_at
           FROM approval_receipts r
           LEFT JOIN project_publish_grants g ON g.project_uuid = r.project_uuid
           WHERE r.run_uuid = $1 AND r.action_hash = $2 AND r.created_at < $3
             AND r.status IN ('done', 'executing', 'unknown')
           ORDER BY r.created_at DESC LIMIT 1"#,
    )
    .bind(run_uuid)
    .bind(hash)
    .bind(turn_started)
    .fetch_optional(pool)
    .await?;
    let Some((uuid, status, created_at, granted_at)) = row else {
        return Ok(Prior::None);
    };
    if status == "done" {
        return Ok(Prior::Done { uuid });
    }
    // Une nouvelle validation humaine après la coupure autorise à relancer.
    let revalidated = granted_at
        .and_then(|g| DateTime::parse_from_rfc3339(g.trim()).ok())
        .map(|g| g.with_timezone(&Utc) > created_at)
        .unwrap_or(false);
    if revalidated {
        Ok(Prior::None)
    } else {
        Ok(Prior::Unknown { uuid })
    }
}

/// Qui a donné l'accord de publication en cours pour ce projet.
pub async fn grant_approver(
    pool: &PgPool,
    project_uuid: &str,
) -> Option<(Option<String>, Option<String>, Option<DateTime<Utc>>)> {
    let row: Option<(Option<String>, Option<String>, String)> = sqlx::query_as(
        "SELECT granted_by, granted_by_label, granted_at FROM project_publish_grants WHERE project_uuid = $1",
    )
    .bind(project_uuid)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    row.map(|(by, label, at)| {
        let at = DateTime::parse_from_rfc3339(at.trim())
            .ok()
            .map(|d| d.with_timezone(&Utc));
        (by, label, at)
    })
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(max).collect();
        out.push('…');
        out
    }
}

/// Résultat renvoyé au modèle quand l'action a déjà été faite avant la reprise.
pub fn already_done_result(tool: &str, receipt: &str) -> Value {
    json!({
        "ok": true,
        "skipped": true,
        "code": "already_executed",
        "receipt": receipt,
        "message_fr": format!("« {tool} » a déjà été exécuté avant l'interruption (reçu {}) : je ne le rejoue pas.", short(receipt)),
    })
}

/// Résultat renvoyé au modèle quand l'action a été coupée en route.
pub fn outcome_unknown_result(tool: &str, receipt: &str) -> Value {
    json!({
        "ok": false,
        "code": "outcome_unknown",
        "receipt": receipt,
        "needs_user_action": true,
        "kind": "publish_approval",
        "error": format!("« {tool} » a été coupé par un redémarrage : issue inconnue. Vérifie le résultat (list_deployments, GitHub) avant de relancer ; une nouvelle validation est requise pour rejouer."),
        "message_fr": "Une action a été coupée par un redémarrage. Je vérifie avant de la relancer ; valide à nouveau si elle doit être rejouée.",
    })
}

fn short(uuid: &str) -> &str {
    uuid.get(..8).unwrap_or(uuid)
}

/// Issue lisible d'un résultat d'outil.
pub fn tool_outcome(result: &Value) -> (&'static str, Option<String>) {
    let ok = result.get("ok").and_then(|v| v.as_bool()).unwrap_or(true);
    if result.get("cancelled").and_then(|v| v.as_bool()) == Some(true) {
        return (
            "unknown",
            Some("Arrêté pendant l'action : issue inconnue.".into()),
        );
    }
    let detail = result
        .get("error")
        .or_else(|| result.get("message"))
        .or_else(|| result.get("message_fr"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    (if ok { "done" } else { "failed" }, detail)
}

/// Uuid du déploiement lancé par un outil (`trigger_deploy`, `publish_to_github`…).
pub fn deployment_of(result: &Value) -> Option<String> {
    for path in [
        &["deployment_uuid"][..],
        &["data", "uuid"][..],
        &["deployment", "uuid"][..],
        &["deploy", "uuid"][..],
    ] {
        let mut cur = result;
        let mut found = true;
        for k in path {
            match cur.get(*k) {
                Some(v) => cur = v,
                None => {
                    found = false;
                    break;
                }
            }
        }
        if found {
            if let Some(s) = cur.as_str().filter(|s| !s.trim().is_empty()) {
                return Some(s.to_string());
            }
        }
    }
    None
}

/// Reçu sérialisé pour l'API.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Receipt {
    pub uuid: String,
    pub workspace_uuid: Option<String>,
    pub project_uuid: Option<String>,
    pub project_name: Option<String>,
    pub action: String,
    pub action_label: String,
    pub target: String,
    pub version: Option<String>,
    pub action_hash: String,
    pub status: String,
    pub source: String,
    pub approved_by: Option<String>,
    pub approved_by_label: Option<String>,
    pub approved_at: Option<DateTime<Utc>>,
    pub expires_at: Option<DateTime<Utc>>,
    pub consumed_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
    pub detail: Option<String>,
    pub run_uuid: Option<String>,
    pub tool_name: Option<String>,
    pub deployment_uuid: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub async fn get(pool: &PgPool, uuid: &str) -> Result<Option<Receipt>, sqlx::Error> {
    sqlx::query_as::<_, Receipt>("SELECT * FROM approval_receipts WHERE uuid = $1")
        .bind(uuid)
        .fetch_optional(pool)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_is_stable_and_specific() {
        let a = action_hash("p", "deploy", "site", "main");
        assert_eq!(a, action_hash("p", "deploy", "site", "main"));
        assert_eq!(a.len(), 64);
        assert_ne!(a, action_hash("p", "deploy", "site", "dev"));
        assert_ne!(a, action_hash("p", "stop", "site", "main"));
        // Séparateur : « ab|c » ≠ « a|bc ».
        assert_ne!(
            action_hash("p", "ab", "c", ""),
            action_hash("p", "a", "bc", "")
        );
    }

    #[test]
    fn tool_hash_ignores_key_order_and_context_ids() {
        let a = tool_hash(
            "p",
            "trigger_deploy",
            &json!({"git_sha": "abc", "message": "x", "project_uuid": "p"}),
        );
        let b = tool_hash(
            "p",
            "trigger_deploy",
            &json!({"message": "x", "git_sha": "abc"}),
        );
        assert_eq!(a, b);
        assert_ne!(
            a,
            tool_hash(
                "p",
                "trigger_deploy",
                &json!({"git_sha": "def", "message": "x"})
            )
        );
    }

    #[test]
    fn outcome_and_deployment_extraction() {
        assert_eq!(tool_outcome(&json!({"ok": true})).0, "done");
        assert_eq!(
            tool_outcome(&json!({"ok": false, "error": "boom"})),
            ("failed", Some("boom".into()))
        );
        assert_eq!(
            tool_outcome(&json!({"ok": false, "cancelled": true})).0,
            "unknown"
        );
        assert_eq!(
            deployment_of(&json!({"data": {"uuid": "d1"}})),
            Some("d1".into())
        );
        assert_eq!(
            deployment_of(&json!({"deployment_uuid": "d2"})),
            Some("d2".into())
        );
        assert_eq!(deployment_of(&json!({"ok": true})), None);
    }

    async fn pg() -> PgPool {
        let pool = devforge_database::ephemeral_pg().await;
        sqlx::query(
            "CREATE TABLE projects (uuid TEXT PRIMARY KEY, name TEXT, workspace_uuid TEXT)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO projects VALUES ('p1', 'Site vitrine', 'ws1')")
            .execute(&pool)
            .await
            .unwrap();
        migrate(&pool).await.unwrap();
        // Idempotente : une 2e passe ne casse rien.
        migrate(&pool).await.unwrap();
        pool
    }

    fn agent_deploy(run: &str) -> NewReceipt {
        NewReceipt {
            project_uuid: Some("p1".into()),
            action: "agent_tool".into(),
            action_label: "Agent : déployer".into(),
            target: "dev".into(),
            source: "agent".into(),
            run_uuid: Some(run.into()),
            tool_name: Some("trigger_deploy".into()),
            action_hash: Some(tool_hash(
                "p1",
                "trigger_deploy",
                &json!({"git_sha": "abc"}),
            )),
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn begin_fills_project_and_finishes_once() {
        let pool = pg().await;
        let r = NewReceipt {
            project_uuid: Some("p1".into()),
            action: "stop".into(),
            action_label: "Arrêter".into(),
            target: "Site vitrine".into(),
            version: Some("main".into()),
            approved_by: Some("u1".into()),
            approved_by_label: Some("Mathieu".into()),
            ..Default::default()
        };
        let uuid = begin(&pool, &r).await.unwrap();
        let got = get(&pool, &uuid).await.unwrap().unwrap();
        assert_eq!(got.status, "executing");
        assert_eq!(got.workspace_uuid.as_deref(), Some("ws1"));
        assert_eq!(got.project_name.as_deref(), Some("Site vitrine"));
        assert_eq!(got.source, "web");
        assert!(got.consumed_at.is_some());
        let ttl = got.expires_at.unwrap() - got.approved_at.unwrap();
        assert_eq!(ttl.num_minutes(), APPROVAL_TTL_MINUTES);
        assert_eq!(
            got.action_hash,
            action_hash("p1", "stop", "Site vitrine", "main")
        );

        assert!(finish(&pool, &uuid, "done", None).await.unwrap());
        // Une issue finale ne se réécrit pas.
        assert!(!finish(&pool, &uuid, "failed", Some("x")).await.unwrap());
        assert_eq!(get(&pool, &uuid).await.unwrap().unwrap().status, "done");
    }

    #[tokio::test]
    async fn approval_is_single_use() {
        let pool = pg().await;
        let r = agent_deploy("run1");
        let p = propose(&pool, &r).await.unwrap();
        // Proposition idempotente pour le même hash.
        assert_eq!(propose(&pool, &r).await.unwrap(), p);
        // Pas encore validée : rien à consommer.
        assert!(consume(&pool, "p1", &r.hash(), None)
            .await
            .unwrap()
            .is_none());
        assert_eq!(
            approve_pending(&pool, "p1", Some("u1"), Some("Mathieu"))
                .await
                .unwrap(),
            1
        );
        let first = consume(&pool, "p1", &r.hash(), Some("run1")).await.unwrap();
        assert_eq!(first.as_deref(), Some(p.as_str()));
        // Deuxième usage refusé.
        assert!(consume(&pool, "p1", &r.hash(), Some("run1"))
            .await
            .unwrap()
            .is_none());
        // Un autre hash ne consomme pas la validation d'une action différente.
        let other = tool_hash("p1", "trigger_deploy", &json!({"git_sha": "zzz"}));
        assert!(consume(&pool, "p1", &other, None).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn approval_expires_after_ttl() {
        let pool = pg().await;
        let r = agent_deploy("run1");
        let p = propose(&pool, &r).await.unwrap();
        approve_pending(&pool, "p1", Some("u1"), None)
            .await
            .unwrap();
        sqlx::query(
            "UPDATE approval_receipts SET expires_at = now() - interval '1 minute' WHERE uuid = $1",
        )
        .bind(&p)
        .execute(&pool)
        .await
        .unwrap();
        assert!(consume(&pool, "p1", &r.hash(), None)
            .await
            .unwrap()
            .is_none());
        assert_eq!(expire_stale(&pool).await.unwrap(), 1);
        assert_eq!(get(&pool, &p).await.unwrap().unwrap().status, "expired");
    }

    #[tokio::test]
    async fn restart_marks_unknown_and_blocks_replay() {
        let pool = pg().await;
        let r = agent_deploy("run1");
        let uuid = begin(&pool, &r).await.unwrap();
        assert_eq!(mark_interrupted(&pool).await.unwrap(), 1);
        let got = get(&pool, &uuid).await.unwrap().unwrap();
        assert_eq!(got.status, "unknown");
        assert_eq!(got.detail.as_deref(), Some(UNKNOWN_AFTER_RESTART));

        let later = Utc::now() + Duration::seconds(1);
        assert_eq!(
            prior_in_run(&pool, "run1", &r.hash(), later).await.unwrap(),
            Prior::Unknown { uuid: uuid.clone() }
        );
        // Autre run : pas concerné.
        assert_eq!(
            prior_in_run(&pool, "run2", &r.hash(), later).await.unwrap(),
            Prior::None
        );
        // Nouvelle validation humaine après la coupure : on peut relancer.
        sqlx::query("INSERT INTO project_publish_grants (project_uuid, granted_at, expires_at) VALUES ('p1', $1, $2)")
            .bind((Utc::now() + Duration::seconds(5)).to_rfc3339())
            .bind((Utc::now() + Duration::minutes(15)).to_rfc3339())
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            prior_in_run(&pool, "run1", &r.hash(), later).await.unwrap(),
            Prior::None
        );
        // L'issue inconnue reste éclaircissable.
        assert!(finish(&pool, &uuid, "done", None).await.unwrap());
        assert_eq!(
            prior_in_run(&pool, "run1", &r.hash(), later).await.unwrap(),
            Prior::Done { uuid }
        );
    }

    #[tokio::test]
    async fn same_turn_actions_are_not_seen_as_prior() {
        let pool = pg().await;
        let turn = Utc::now() - Duration::seconds(1);
        let r = agent_deploy("run1");
        let uuid = begin(&pool, &r).await.unwrap();
        finish(&pool, &uuid, "done", None).await.unwrap();
        // Créé pendant ce tour : l'agent peut redemander volontairement la même action.
        assert_eq!(
            prior_in_run(&pool, "run1", &r.hash(), turn).await.unwrap(),
            Prior::None
        );
    }
}
