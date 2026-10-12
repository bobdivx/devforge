//! Dédup des réveils d'agents par CAUSE (P1-07).
//!
//! Avant : un marqueur par uuid de déploiement → chaque nouvel échec identique relançait
//! une réparation (boucle « fix: resynchroniser package-lock.json »). Maintenant la cause
//! (type + diagnostic normalisé) est comptée : 1re fois réparation normale, 2e fois escalade
//! (on ne refait pas le correctif, on demande la validation), ensuite silence pendant 6 h.

use chrono::{DateTime, Duration, Utc};
use regex::Regex;
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use std::sync::OnceLock;

pub const KIND_DEPLOY_FAIL: &str = "deploy_fail";
pub const SILENCE_WINDOW_HOURS: i64 = 6;

pub async fn migrate(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS agent_wake_causes (
            project_uuid  TEXT NOT NULL,
            cause_hash    TEXT NOT NULL,
            kind          TEXT NOT NULL,
            summary       TEXT NOT NULL,
            first_seen    TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_seen     TIMESTAMPTZ NOT NULL DEFAULT now(),
            occurrences   INT NOT NULL DEFAULT 1,
            last_action   TEXT NULL,
            last_wake_at  TIMESTAMPTZ NULL,
            last_dep_uuid TEXT NULL,
            PRIMARY KEY (project_uuid, cause_hash)
        );
        "#,
    )
    .execute(pool)
    .await?;
    Ok(())
}

fn normalizers() -> &'static [(Regex, &'static str)] {
    static RE: OnceLock<Vec<(Regex, &'static str)>> = OnceLock::new();
    RE.get_or_init(|| {
        vec![
            (
                Regex::new(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
                    .unwrap(),
                "<uuid>",
            ),
            (Regex::new(r"\b[0-9a-f]{7,40}\b").unwrap(), "<sha>"),
            (
                Regex::new(r"(/tmp|/var/folders|/private/var)/[^\s:'\x22]+").unwrap(),
                "<tmp>",
            ),
            (
                Regex::new(r"\d{4}-\d{2}-\d{2}[t ][\d:.]+z?").unwrap(),
                "<ts>",
            ),
            (Regex::new(r"\d+").unwrap(), "<n>"),
            (Regex::new(r"\s+").unwrap(), " "),
        ]
    })
}

/// Diagnostic normalisé : minuscules, sans uuid / sha / nombres / chemins temporaires.
pub fn normalize_summary(summary: &str) -> String {
    let mut s = summary.to_lowercase();
    for (re, rep) in normalizers() {
        s = re.replace_all(&s, *rep).into_owned();
    }
    s.trim().to_string()
}

/// `sha256(kind + diagnostic normalisé)[:16]`.
pub fn cause_hash(kind: &str, summary: &str) -> String {
    let mut h = Sha256::new();
    h.update(kind.as_bytes());
    h.update(b"\n");
    h.update(normalize_summary(summary).as_bytes());
    let digest = h.finalize();
    digest.iter().take(8).map(|b| format!("{b:02x}")).collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WakeDecision {
    /// Première occurrence : réveil + réparation normale.
    Normal,
    /// Même cause déjà vue : ne pas refaire le correctif, demander la validation / expliquer.
    Escalate,
    /// Déjà escaladée récemment : compteur seulement.
    Silent,
}

pub fn decide_wake(
    occurrences: i64,
    last_action: Option<&str>,
    last_wake_at: Option<DateTime<Utc>>,
    now: DateTime<Utc>,
) -> WakeDecision {
    if occurrences <= 1 || last_action == Some("resolved") {
        return WakeDecision::Normal;
    }
    let recent = last_wake_at
        .map(|t| now - t < Duration::hours(SILENCE_WINDOW_HOURS))
        .unwrap_or(false);
    if occurrences >= 3 && recent {
        return WakeDecision::Silent;
    }
    WakeDecision::Escalate
}

#[derive(Debug, Clone)]
pub struct CauseState {
    pub hash: String,
    pub occurrences: i64,
    pub last_action: Option<String>,
    pub first_seen: DateTime<Utc>,
    pub decision: WakeDecision,
}

/// Enregistre un échec (idempotent par uuid de déploiement) et décide du réveil.
pub async fn register_failure(
    pool: &PgPool,
    project_uuid: &str,
    kind: &str,
    summary: &str,
    dep_uuid: &str,
) -> Result<CauseState, sqlx::Error> {
    let hash = cause_hash(kind, summary);
    // Ancienne valeur de last_wake_at (avant ce réveil) pour la fenêtre de silence.
    let row: (i32, Option<String>, Option<DateTime<Utc>>, DateTime<Utc>) = sqlx::query_as(
        r#"INSERT INTO agent_wake_causes (project_uuid, cause_hash, kind, summary, last_dep_uuid)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (project_uuid, cause_hash) DO UPDATE SET
             occurrences = CASE
               WHEN agent_wake_causes.last_dep_uuid IS NOT DISTINCT FROM excluded.last_dep_uuid
                 THEN agent_wake_causes.occurrences
               WHEN agent_wake_causes.last_action = 'resolved' THEN 1
               ELSE agent_wake_causes.occurrences + 1 END,
             first_seen = CASE
               WHEN agent_wake_causes.last_action = 'resolved'
                    AND agent_wake_causes.last_dep_uuid IS DISTINCT FROM excluded.last_dep_uuid
                 THEN now() ELSE agent_wake_causes.first_seen END,
             last_action = CASE
               WHEN agent_wake_causes.last_action = 'resolved'
                    AND agent_wake_causes.last_dep_uuid IS DISTINCT FROM excluded.last_dep_uuid
                 THEN NULL ELSE agent_wake_causes.last_action END,
             last_seen = now(),
             summary = excluded.summary,
             last_dep_uuid = excluded.last_dep_uuid
           RETURNING occurrences, last_action, last_wake_at, first_seen"#,
    )
    .bind(project_uuid)
    .bind(&hash)
    .bind(kind)
    .bind(summary)
    .bind(dep_uuid)
    .fetch_one(pool)
    .await?;
    let (occurrences, last_action, last_wake_at, first_seen) = row;
    let decision = decide_wake(
        occurrences as i64,
        last_action.as_deref(),
        last_wake_at,
        Utc::now(),
    );
    Ok(CauseState {
        hash,
        occurrences: occurrences as i64,
        last_action,
        first_seen,
        decision,
    })
}

pub async fn mark_woken(pool: &PgPool, project_uuid: &str, hash: &str) {
    let _ = sqlx::query(
        "UPDATE agent_wake_causes SET last_wake_at = now() WHERE project_uuid = $1 AND cause_hash = $2",
    )
    .bind(project_uuid)
    .bind(hash)
    .execute(pool)
    .await;
}

/// Un déploiement réussi résout toutes les causes « deploy_fail » du projet.
pub async fn resolve_deploy_causes(pool: &PgPool, project_uuid: &str) {
    let _ = sqlx::query(
        "UPDATE agent_wake_causes SET last_action = 'resolved' WHERE project_uuid = $1 AND kind = $2",
    )
    .bind(project_uuid)
    .bind(KIND_DEPLOY_FAIL)
    .execute(pool)
    .await;
}

/// `Cause #<hash>` présent dans un message de réveil.
pub fn cause_in_message(content: &str) -> Option<String> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"Cause #([0-9a-f]{16})").unwrap());
    re.captures(content).map(|c| c[1].to_string())
}

/// Action déduite des outils d'un tour de réveil.
pub fn action_from_tools(tools_json: &str) -> Option<&'static str> {
    let calls: Vec<Value> = serde_json::from_str(tools_json).unwrap_or_default();
    let name = |c: &Value| {
        c.get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    };
    let ok = |c: &Value| {
        c.get("result")
            .and_then(|r| r.get("ok"))
            .and_then(|v| v.as_bool())
            != Some(false)
    };
    let pushed = calls.iter().any(|c| {
        matches!(
            name(c).as_str(),
            "create_github_fix" | "sync_workdir_to_github" | "publish_to_github"
        ) && ok(c)
    });
    if pushed {
        return Some("pushed");
    }
    let escalated = calls.iter().any(|c| {
        let r = c.get("result");
        r.and_then(|r| r.get("code")).and_then(|v| v.as_str()) == Some("publish_approval_required")
            || r.and_then(|r| r.get("kind")).and_then(|v| v.as_str()) == Some("publish_approval")
    });
    if escalated {
        return Some("escalated");
    }
    let local = calls.iter().any(|c| {
        matches!(
            name(c).as_str(),
            "write_project_file" | "run_workdir_command"
        ) && ok(c)
    });
    if local {
        return Some("local_fix");
    }
    None
}

/// Fin d'un tour d'agent : si c'était un réveil lié à une cause, retenir ce qui a été fait.
pub async fn record_run_action(
    pool: &PgPool,
    project_uuid: &str,
    user_message: &str,
    tools_json: &str,
) {
    let Some(hash) = cause_in_message(user_message) else {
        return;
    };
    let Some(action) = action_from_tools(tools_json) else {
        return;
    };
    let _ = sqlx::query(
        r#"UPDATE agent_wake_causes SET last_action = $3
           WHERE project_uuid = $1 AND cause_hash = $2 AND COALESCE(last_action, '') <> 'resolved'"#,
    )
    .bind(project_uuid)
    .bind(&hash)
    .bind(action)
    .execute(pool)
    .await;
}

/// Texte du réveil d'escalade (même cause qu'avant).
pub fn escalation_text(state: &CauseState, summary: &str) -> String {
    let first = ago(Utc::now() - state.first_seen);
    let what = match state.last_action.as_deref() {
        Some("local_fix") => "Le correctif local n'a pas été publié.",
        Some("pushed") => {
            "Le correctif a été poussé mais le déploiement échoue toujours : la cause est ailleurs."
        }
        Some("escalated") => "La validation de publication est toujours en attente.",
        _ => "La réparation précédente n'a rien changé.",
    };
    format!(
        "⚠️ Même cause qu'il y a {first} (n={n}). {what}\nDiagnostic : {summary}\nNe refais pas le correctif : vérifie l'état local (git status / diff via run_workdir_command), puis demande UNE fois la validation pour pousser le correctif (bouton « Valider la publication »). Si la cause n'est pas dans le code, explique ce qui bloque.",
        n = state.occurrences
    )
}

/// Durée lisible : « 12 min », « 3 h 05 », « 2 j ».
fn ago(d: Duration) -> String {
    let m = d.num_minutes().max(0);
    if m < 60 {
        format!("{m} min")
    } else if m < 48 * 60 {
        format!("{} h {:02}", m / 60, m % 60)
    } else {
        format!("{} j", m / (24 * 60))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_is_stable_across_uuids_and_numbers() {
        let a = cause_hash(KIND_DEPLOY_FAIL, "package-lock.json désynchronisé (déploiement 3f2a9c1e-1111-2222-3333-444455556666, npm ci exit 1)");
        let b = cause_hash(KIND_DEPLOY_FAIL, "package-lock.json désynchronisé (déploiement 9b8c7d6e-aaaa-bbbb-cccc-ddddeeeeffff, npm ci exit 1)");
        assert_eq!(a, b);
        assert_eq!(a.len(), 16);
        let c = cause_hash(KIND_DEPLOY_FAIL, "Port 3000 déjà utilisé");
        assert_ne!(a, c);
        assert_ne!(
            cause_hash("health", "package-lock.json désynchronisé"),
            cause_hash(KIND_DEPLOY_FAIL, "package-lock.json désynchronisé")
        );
    }

    #[test]
    fn normalize_strips_noise() {
        assert_eq!(
            normalize_summary("Build failed at /tmp/build-123/src after 42 s, commit abcdef1234"),
            "build failed at <tmp> after <n> s, commit <sha>"
        );
    }

    #[test]
    fn decisions_follow_the_plan() {
        let now = Utc::now();
        assert_eq!(decide_wake(1, None, None, now), WakeDecision::Normal);
        assert_eq!(
            decide_wake(2, Some("local_fix"), Some(now - Duration::minutes(30)), now),
            WakeDecision::Escalate
        );
        assert_eq!(
            decide_wake(3, Some("escalated"), Some(now - Duration::hours(1)), now),
            WakeDecision::Silent
        );
        assert_eq!(
            decide_wake(5, Some("escalated"), Some(now - Duration::hours(7)), now),
            WakeDecision::Escalate
        );
        // Une cause résolue qui revient = réveil normal.
        assert_eq!(
            decide_wake(4, Some("resolved"), Some(now), now),
            WakeDecision::Normal
        );
    }

    #[test]
    fn lockfile_loop_scenario() {
        // 3 échecs « lockfile » : 1 réparation, 1 escalade, puis silence.
        let now = Utc::now();
        let d1 = decide_wake(1, None, None, now);
        let d2 = decide_wake(2, Some("local_fix"), Some(now - Duration::minutes(20)), now);
        let d3 = decide_wake(3, Some("escalated"), Some(now - Duration::minutes(5)), now);
        assert_eq!(
            (d1, d2, d3),
            (
                WakeDecision::Normal,
                WakeDecision::Escalate,
                WakeDecision::Silent
            )
        );
    }

    #[test]
    fn actions_from_tools() {
        let local = r#"[{"name":"run_workdir_command","arguments":{"command":"npm install"},"result":{"ok":true}}]"#;
        assert_eq!(action_from_tools(local), Some("local_fix"));
        let blocked = r#"[{"name":"run_workdir_command","result":{"ok":true}},{"name":"sync_workdir_to_github","result":{"ok":false,"code":"publish_approval_required","kind":"publish_approval"}}]"#;
        assert_eq!(action_from_tools(blocked), Some("escalated"));
        let pushed = r#"[{"name":"sync_workdir_to_github","result":{"ok":true}}]"#;
        assert_eq!(action_from_tools(pushed), Some("pushed"));
        assert_eq!(action_from_tools("[]"), None);
    }

    #[test]
    fn cause_marker_roundtrip() {
        let h = cause_hash(KIND_DEPLOY_FAIL, "x");
        assert_eq!(
            cause_in_message(&format!("Événement…\nCause #{h}\n")),
            Some(h)
        );
        assert_eq!(cause_in_message("rien"), None);
    }

    #[test]
    fn escalation_mentions_count_and_validation() {
        let st = CauseState {
            hash: "0123456789abcdef".into(),
            occurrences: 2,
            last_action: Some("local_fix".into()),
            first_seen: Utc::now(),
            decision: WakeDecision::Escalate,
        };
        let t = escalation_text(&st, "package-lock désynchronisé");
        assert!(t.contains("n=2"));
        assert!(t.contains("il y a 0 min"));
        assert!(t.contains("n'a pas été publié"));
        assert!(t.contains("Valider la publication"));
    }

    /// 3 échecs « lockfile » sur la vraie table : réparation, escalade, silence ;
    /// puis succès → résolu → un nouvel échec identique redevient normal.
    #[tokio::test]
    async fn lockfile_loop_on_postgres() {
        let pool = devforge_database::ephemeral_pg().await;
        migrate(&pool).await.unwrap();
        let p = "proj-lock";
        let s = "package-lock.json désynchronisé avec package.json (npm ci)";
        let a = register_failure(&pool, p, KIND_DEPLOY_FAIL, s, "dep-1")
            .await
            .unwrap();
        assert_eq!(a.decision, WakeDecision::Normal);
        mark_woken(&pool, p, &a.hash).await;
        // Même déploiement signalé deux fois (auto-repair + wake) : pas de double comptage.
        let again = register_failure(&pool, p, KIND_DEPLOY_FAIL, s, "dep-1")
            .await
            .unwrap();
        assert_eq!(again.occurrences, 1);
        record_run_action(
            &pool,
            p,
            &format!("AUTO-RÉPARATION\nCause #{}", a.hash),
            r#"[{"name":"run_workdir_command","result":{"ok":true}}]"#,
        )
        .await;
        let b = register_failure(&pool, p, KIND_DEPLOY_FAIL, s, "dep-2")
            .await
            .unwrap();
        assert_eq!(b.occurrences, 2);
        assert_eq!(b.last_action.as_deref(), Some("local_fix"));
        assert_eq!(b.decision, WakeDecision::Escalate);
        mark_woken(&pool, p, &b.hash).await;
        let c = register_failure(&pool, p, KIND_DEPLOY_FAIL, s, "dep-3")
            .await
            .unwrap();
        assert_eq!(c.occurrences, 3);
        assert_eq!(c.decision, WakeDecision::Silent);
        resolve_deploy_causes(&pool, p).await;
        let d = register_failure(&pool, p, KIND_DEPLOY_FAIL, s, "dep-4")
            .await
            .unwrap();
        assert_eq!(d.occurrences, 1);
        assert_eq!(d.decision, WakeDecision::Normal);
    }
}
