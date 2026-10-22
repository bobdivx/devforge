//! Garde de l'auto-deploy (incident devforge-esp du 11/10/2026).
//!
//! Avant : le poller comparait GitHub au dernier SHA déployé AVEC SUCCÈS. Un commit cassé
//! restait donc « en avance » pour toujours et était redéployé à chaque tick (toutes les
//! 90 s), avec à chaque fois un échec, un réveil d'agent et un `reset --hard` du brouillon.
//!
//! Maintenant :
//! - un SHA dont le déploiement a échoué n'est JAMAIS relancé automatiquement : seul un
//!   nouveau commit ou une action manuelle (« Réessayer la mise en ligne ») relance ;
//! - même pour un nouveau commit, backoff exponentiel après des échecs consécutifs
//!   (2 min, 4, 8… plafonné à 60 min) ;
//! - une seule escalade par SHA bloqué (message dans le fil du Coordinateur + événement
//!   de la timeline), comptée par le mécanisme de causes P1-07 (`agent_wake_causes`).

use chrono::{DateTime, Duration, Utc};
use sqlx::PgPool;

use crate::state::{new_uuid, now_str, AppState, Project};

pub const KIND_AUTO_DEPLOY_PAUSED: &str = "auto_deploy_paused";
const BASE_BACKOFF_MIN: i64 = 2;
const MAX_BACKOFF_MIN: i64 = 60;
const HISTORY: i64 = 20;

pub async fn migrate(pool: &PgPool) -> Result<(), sqlx::Error> {
    // SHA visé par un déploiement automatique (git_sha n'est connu qu'en fin de build).
    sqlx::query("ALTER TABLE deployments ADD COLUMN IF NOT EXISTS target_sha TEXT NULL")
        .execute(pool)
        .await?;
    Ok(())
}

#[derive(Debug, Clone)]
pub struct Attempt {
    pub sha: Option<String>,
    pub status: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Gate {
    Go,
    /// Ce SHA a déjà échoué : pas de relance automatique.
    SameShaFailed {
        sha: String,
    },
    /// Échecs consécutifs récents : on attend avant de tenter un nouveau commit.
    Backoff {
        until: DateTime<Utc>,
        failures: u32,
    },
}

fn usable(sha: &str) -> bool {
    let s = sha.trim();
    s.len() >= 7 && s.chars().all(|c| c.is_ascii_hexdigit())
}

/// SHA court (7) ou complet (40) : égaux si l'un est préfixe de l'autre.
pub fn same_sha(a: &str, b: &str) -> bool {
    let (a, b) = (a.trim().to_ascii_lowercase(), b.trim().to_ascii_lowercase());
    usable(&a) && usable(&b) && (a.starts_with(&b) || b.starts_with(&a))
}

pub fn backoff_for(failures: u32) -> Duration {
    if failures == 0 {
        return Duration::zero();
    }
    let exp = (failures - 1).min(10);
    Duration::minutes((BASE_BACKOFF_MIN << exp).min(MAX_BACKOFF_MIN))
}

/// `history` : déploiements de l'environnement, du plus récent au plus ancien.
pub fn decide(tip: &str, history: &[Attempt], now: DateTime<Utc>) -> Gate {
    let mut failures = 0u32;
    let mut last_failure: Option<DateTime<Utc>> = None;
    for a in history {
        match a.status.as_str() {
            "success" | "ready" => break,
            "failed" | "error" => {
                if a.sha.as_deref().is_some_and(|s| same_sha(s, tip)) {
                    return Gate::SameShaFailed {
                        sha: tip.chars().take(7).collect(),
                    };
                }
                failures += 1;
                last_failure.get_or_insert(a.created_at);
            }
            _ => {}
        }
    }
    if let Some(t) = last_failure {
        let until = t + backoff_for(failures);
        if now < until {
            return Gate::Backoff { until, failures };
        }
    }
    Gate::Go
}

pub async fn load_history(pool: &PgPool, project_id: i64, environment: &str) -> Vec<Attempt> {
    let rows: Vec<(Option<String>, Option<String>, String, String)> = sqlx::query_as(
        r#"SELECT target_sha, git_sha, status, created_at FROM deployments
           WHERE project_id = $1 AND COALESCE(environment, 'production') = $2
           ORDER BY created_at DESC LIMIT $3"#,
    )
    .bind(project_id)
    .bind(environment)
    .bind(HISTORY)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    rows.into_iter()
        .map(|(target, git, status, created)| Attempt {
            // Le SHA réellement construit prime ; sinon celui visé.
            sha: git.filter(|s| usable(s)).or(target.filter(|s| usable(s))),
            status,
            created_at: DateTime::parse_from_rfc3339(&created)
                .map(|d| d.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now()),
        })
        .collect()
}

pub async fn gate(state: &AppState, project: &Project, environment: &str, tip: &str) -> Gate {
    let history = load_history(&state.pool, project.id, environment).await;
    let g = decide(tip, &history, Utc::now());
    match &g {
        Gate::Go => {}
        Gate::SameShaFailed { sha } => {
            tracing::info!(project = %project.name, environment, sha = %sha, "auto-deploy: SHA déjà en échec, pas de relance");
            crate::wake_gate::record(
                &state.pool,
                &project.uuid,
                "auto_deploy",
                &format!("auto_deploy:{environment}"),
                "Mise en ligne automatique",
                crate::wake_gate::SKIPPED,
                &format!("commit {sha} déjà en échec : pas de relance automatique"),
                sha,
                None,
            )
            .await;
            escalate_once(&state.pool, &project.uuid, environment, sha).await;
        }
        Gate::Backoff { until, failures } => {
            crate::wake_gate::record(
                &state.pool,
                &project.uuid,
                "auto_deploy",
                &format!("auto_deploy:{environment}"),
                "Mise en ligne automatique",
                crate::wake_gate::SKIPPED,
                &format!(
                    "{failures} échec(s) consécutif(s) : attente jusqu'à {}",
                    until.format("%H:%M UTC")
                ),
                tip,
                None,
            )
            .await;
            tracing::info!(project = %project.name, environment, failures, until = %until, "auto-deploy: backoff après échecs");
        }
    }
    g
}

pub async fn set_target_sha(pool: &PgPool, dep_uuid: &str, sha: &str) {
    let _ = sqlx::query("UPDATE deployments SET target_sha = $1 WHERE uuid = $2")
        .bind(sha)
        .bind(dep_uuid)
        .execute(pool)
        .await;
}

pub fn paused_text(environment: &str, sha: &str) -> String {
    let env = if environment == "dev" {
        "de l'environnement DEV"
    } else {
        "en production"
    };
    format!(
        "⏸️ Mise en ligne automatique {env} en pause : le commit {sha} a échoué et je ne le relance plus tout seul.\n\
         Elle reprendra au prochain commit poussé sur la branche, ou tout de suite avec « Réessayer la mise en ligne ».\n\
         La version actuellement en ligne reste servie."
    )
}

/// Une seule notification par (projet, environnement, SHA) : la cause P1-07 garde le SHA
/// déjà signalé dans `last_dep_uuid`, et compte les SHA bloqués successifs.
pub async fn escalate_once(
    pool: &PgPool,
    project_uuid: &str,
    environment: &str,
    sha: &str,
) -> bool {
    let summary = format!("auto-deploy {environment} en pause sur un commit en échec");
    let hash = crate::wake_causes::cause_hash(KIND_AUTO_DEPLOY_PAUSED, &summary);
    let marker = format!("{environment}:{sha}");
    let seen: Option<(Option<String>,)> = sqlx::query_as(
        "SELECT last_dep_uuid FROM agent_wake_causes WHERE project_uuid = $1 AND cause_hash = $2",
    )
    .bind(project_uuid)
    .bind(&hash)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    if seen.and_then(|(m,)| m).as_deref() == Some(marker.as_str()) {
        return false;
    }
    let cause = crate::wake_causes::register_failure(
        pool,
        project_uuid,
        KIND_AUTO_DEPLOY_PAUSED,
        &summary,
        &marker,
    )
    .await;
    let text = paused_text(environment, sha);
    crate::deploy_queue::record_event(pool, project_uuid, "deploy", "auto_paused", sha, &text)
        .await;
    if let Ok(Some(agent_uuid)) = crate::db::ensure_coordinator_agent(pool, project_uuid).await {
        let _ = sqlx::query(
            r#"INSERT INTO agent_messages (uuid, project_uuid, agent_uuid, role, content, tool_calls_json, provider, created_at)
               VALUES ($1, $2, $3, 'assistant', $4, '[]', 'system', $5)"#,
        )
        .bind(new_uuid())
        .bind(project_uuid)
        .bind(&agent_uuid)
        .bind(&text)
        .bind(now_str())
        .execute(pool)
        .await;
    }
    if let Ok(c) = cause {
        crate::wake_causes::mark_woken(pool, project_uuid, &c.hash).await;
    }
    true
}

/// Le reset du workdir par le déploiement ne doit pas effacer un brouillon en cours :
/// sauvegarde restaurable (même mécanisme que « Supprimer le brouillon »).
///
/// Appelé par tous les déploiements prod (`run_real_deploy_at` : manuel, auto, GitHub).
/// `origin` : libellé de la sauvegarde (`deploy`, `auto-deploy`…).
pub async fn backup_draft_before_reset(state: &AppState, project: &Project, origin: &str) {
    // Même résolution que le déploiement (vide → `<data>/applications/<uuid>`).
    let configured = project.workdir.as_deref().unwrap_or("").trim().to_string();
    let wd = std::path::PathBuf::from(devforge_deploy::resolve_project_workdir(
        &configured,
        &project.uuid,
    ));
    let branch = project
        .git_branch
        .clone()
        .filter(|b| !b.trim().is_empty())
        .unwrap_or_else(|| "main".into());
    let data = std::path::PathBuf::from(
        std::env::var("DEVFORGE_DATA_DIR").unwrap_or_else(|_| "/data".into()),
    );
    let root = crate::draft::backups_root(&data, &project.uuid);
    let reason = origin.to_string();
    let res =
        tokio::task::spawn_blocking(move || backup_dirty_checkout(&wd, &branch, &root, &reason))
            .await;
    match res {
        Ok(Ok(Some((id, n)))) => {
            crate::deploy_queue::record_event(
                &state.pool,
                &project.uuid,
                "draft",
                "backed_up",
                &id,
                &format!("{origin} · {n} fichier(s) du brouillon sauvegardés avant mise à jour"),
            )
            .await;
        }
        Ok(Err(e)) => {
            tracing::warn!(project = %project.uuid, error = %e, "sauvegarde du brouillon avant déploiement impossible");
        }
        _ => {}
    }
}

/// Sauvegarde le brouillon d'un checkout s'il en a un. `Ok(None)` = rien à sauver.
pub fn backup_dirty_checkout(
    workdir: &std::path::Path,
    branch: &str,
    root: &std::path::Path,
    reason: &str,
) -> Result<Option<(String, usize)>, String> {
    let st = crate::draft::status(workdir, branch, None);
    if !st.available || !st.dirty {
        return Ok(None);
    }
    crate::draft::backup(workdir, root, &st.files, reason)
        .map(|b| Some((b.id, st.files.len())))
        .map_err(|e| e.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(min_ago: i64, now: DateTime<Utc>) -> DateTime<Utc> {
        now - Duration::minutes(min_ago)
    }
    fn a(sha: &str, status: &str, min_ago: i64, now: DateTime<Utc>) -> Attempt {
        Attempt {
            sha: Some(sha.into()),
            status: status.into(),
            created_at: at(min_ago, now),
        }
    }
    const TIP: &str = "0c4711b2e5f0a1b2c3d4e5f60718293a4b5c6d7e";

    #[test]
    fn failed_tip_is_never_redeployed_automatically() {
        let now = Utc::now();
        // Scénario devforge-esp : 0c4711b en échec, dernier succès plus ancien.
        let h = vec![
            a("0c4711b", "failed", 1, now),
            a("89ce0fd", "success", 300, now),
        ];
        assert_eq!(
            decide(TIP, &h, now),
            Gate::SameShaFailed {
                sha: "0c4711b".into()
            }
        );
        // Même des heures plus tard : toujours bloqué (pas de backoff qui finit par relancer).
        let h = vec![
            a("0c4711b", "failed", 600, now),
            a("89ce0fd", "success", 900, now),
        ];
        assert_eq!(
            decide(TIP, &h, now),
            Gate::SameShaFailed {
                sha: "0c4711b".into()
            }
        );
    }

    #[test]
    fn new_commit_goes_after_backoff() {
        let now = Utc::now();
        let h = vec![
            a("0c4711b", "failed", 1, now),
            a("89ce0fd", "success", 300, now),
        ];
        let new_tip = "abcdef1234567";
        assert!(matches!(
            decide(new_tip, &h, now),
            Gate::Backoff { failures: 1, .. }
        ));
        let h = vec![
            a("0c4711b", "failed", 3, now),
            a("89ce0fd", "success", 300, now),
        ];
        assert_eq!(decide(new_tip, &h, now), Gate::Go);
    }

    #[test]
    fn backoff_grows_and_is_capped() {
        assert_eq!(backoff_for(0), Duration::zero());
        assert_eq!(backoff_for(1), Duration::minutes(2));
        assert_eq!(backoff_for(2), Duration::minutes(4));
        assert_eq!(backoff_for(4), Duration::minutes(16));
        assert_eq!(backoff_for(9), Duration::minutes(60));
        assert_eq!(backoff_for(40), Duration::minutes(60));
        let now = Utc::now();
        let h: Vec<Attempt> = (0..4)
            .map(|i| a(&format!("aaaaaa{i}"), "failed", 10 + i, now))
            .collect();
        // 4 échecs consécutifs → 16 min depuis le dernier (il y a 10 min) : on attend.
        assert!(matches!(
            decide("bbbbbbb", &h, now),
            Gate::Backoff { failures: 4, .. }
        ));
    }

    #[test]
    fn success_resets_and_unknown_shas_ignored() {
        let now = Utc::now();
        let h = vec![
            a("1111111", "success", 1, now),
            a("0c4711b", "failed", 5, now),
        ];
        assert_eq!(decide(TIP, &h, now), Gate::Go);
        let h = vec![Attempt {
            sha: None,
            status: "failed".into(),
            created_at: at(30, now),
        }];
        assert_eq!(decide(TIP, &h, now), Gate::Go);
        assert!(!same_sha("unknown", "unknown"));
        assert!(!same_sha("pending", TIP));
        assert!(same_sha("0C4711B", TIP));
        // Un déploiement en cours ne compte ni comme échec ni comme succès.
        let h = vec![
            a("0c4711b", "running", 1, now),
            a("2222222", "success", 9, now),
        ];
        assert_eq!(decide(TIP, &h, now), Gate::Go);
    }

    /// Boucle devforge-esp rejouée sur Postgres : 12 ticks sur le même SHA en échec →
    /// aucune relance, UNE seule notification ; un nouveau SHA bloqué compte n=2 (cause P1-07).
    #[tokio::test]
    async fn one_notification_per_stuck_sha_on_postgres() {
        let pool = devforge_database::ephemeral_pg().await;
        crate::wake_causes::migrate(&pool).await.unwrap();
        sqlx::query("CREATE TABLE deployments (id BIGSERIAL PRIMARY KEY, uuid TEXT, project_id BIGINT, status TEXT, git_sha TEXT, created_at TEXT NOT NULL, environment TEXT NOT NULL DEFAULT 'production')")
            .execute(&pool).await.unwrap();
        migrate(&pool).await.unwrap();
        let now = Utc::now();
        for (sha, status, min) in [
            ("0c4711b", "failed", 2),
            ("0c4711b", "failed", 4),
            ("89ce0fd", "success", 300),
        ] {
            sqlx::query("INSERT INTO deployments (uuid, project_id, status, git_sha, created_at) VALUES ($1, 32, $2, $3, $4)")
                .bind(new_uuid()).bind(status).bind(sha).bind((now - Duration::minutes(min)).to_rfc3339())
                .execute(&pool).await.unwrap();
        }
        // Un déploiement dev en échec ne bloque pas la prod (et inversement).
        sqlx::query("INSERT INTO deployments (uuid, project_id, status, git_sha, created_at, environment) VALUES ('d', 32, 'failed', 'abcdef1', $1, 'dev')")
            .bind(now.to_rfc3339()).execute(&pool).await.unwrap();
        let h = load_history(&pool, 32, "production").await;
        assert_eq!(h.len(), 3);
        let mut notified = 0;
        for _ in 0..12 {
            assert_eq!(
                decide(TIP, &h, Utc::now()),
                Gate::SameShaFailed {
                    sha: "0c4711b".into()
                }
            );
            if escalate_once(&pool, "esp", "production", "0c4711b").await {
                notified += 1;
            }
        }
        assert_eq!(notified, 1);
        assert!(escalate_once(&pool, "esp", "production", "f00ba47").await);
        let (n,): (i32,) = sqlx::query_as(
            "SELECT occurrences FROM agent_wake_causes WHERE project_uuid = 'esp' AND kind = $1",
        )
        .bind(KIND_AUTO_DEPLOY_PAUSED)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(n, 2);
        assert!(matches!(
            decide(
                "abcdef1",
                &load_history(&pool, 32, "production").await,
                Utc::now()
            ),
            Gate::Backoff { .. }
        ));
    }

    #[test]
    fn paused_text_is_clear() {
        let t = paused_text("production", "0c4711b");
        assert!(
            t.contains("0c4711b")
                && t.contains("prochain commit")
                && t.contains("Réessayer la mise en ligne")
        );
    }

    /// Déploiement manuel ou automatique : un brouillon présent est sauvegardé
    /// avant le `reset --hard`, un checkout propre ne crée rien.
    #[cfg(unix)]
    #[test]
    fn backup_dirty_checkout_before_reset() {
        let tmp = std::env::temp_dir().join(format!("guard-bk-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        let git = |args: &[&str]| {
            std::process::Command::new("git")
                .arg("-C")
                .arg(&tmp)
                .args(["-c", "user.name=t", "-c", "user.email=t@t"])
                .args(args)
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
        };
        std::fs::write(tmp.join("a.txt"), "v1").unwrap();
        if !(git(&["init", "-q", "-b", "main"])
            && git(&["add", "."])
            && git(&["commit", "-q", "-m", "v1"]))
        {
            return; // git absent
        }
        let root = tmp.join("backups");
        assert_eq!(
            backup_dirty_checkout(&tmp, "main", &root, "deploy").unwrap(),
            None
        );
        std::fs::write(tmp.join("a.txt"), "draft").unwrap();
        let (id, n) = backup_dirty_checkout(&tmp, "main", &root, "deploy")
            .unwrap()
            .expect("brouillon sauvegardé");
        assert_eq!(n, 1);
        assert!(root.join(&id).join("files.tar.gz").exists());
        let manifest = std::fs::read_to_string(root.join(&id).join("manifest.json")).unwrap();
        assert!(manifest.contains("\"deploy\""), "{manifest}");
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
