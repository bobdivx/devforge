//! Origine des fichiers d'un brouillon : quel run d'agent (et pour quoi) les a écrits.
//!
//! À la fin de chaque run, les fichiers du brouillon modifiés pendant le run (mtime ≥ début du run,
//! ou écrits via `write_project_file`) sont attribués à ce run dans `draft_origins`. Un fichier sans
//! trace est une modif manuelle (ou d'un outil externe) ; un lockfile sans trace est une resynchro.

use std::collections::HashMap;

use serde::Serialize;
use serde_json::Value;
use sqlx::PgPool;

use crate::draft::{self, DraftFile};
use crate::state::{AppState, Project};

/// `repair` (Rustine / auto-réparation) · `feature` (Braise, spec) · `routine` (agent réveillé) ·
/// `sync` (lockfile sans auteur) · `manual` (aucun run connu).
#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct Origin {
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_uuid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_uuid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_name: Option<String>,
    /// Déploiement en échec que le run devait réparer.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deployment_uuid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recorded_at: Option<String>,
}

pub async fn migrate(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS draft_origins (
            project_uuid TEXT NOT NULL,
            path TEXT NOT NULL,
            run_uuid TEXT NOT NULL,
            agent_uuid TEXT NOT NULL DEFAULT '',
            agent_name TEXT NOT NULL DEFAULT '',
            kind TEXT NOT NULL,
            deployment_uuid TEXT,
            recorded_at TEXT NOT NULL,
            PRIMARY KEY (project_uuid, path)
        );
        "#,
    )
    .execute(pool)
    .await?;
    Ok(())
}

fn token_after(content: &str, marker: &str) -> Option<String> {
    let i = content.find(marker)? + marker.len();
    let tok: String = content[i..]
        .trim_start()
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    (!tok.is_empty()).then_some(tok)
}

/// Nature d'un run d'après son message déclencheur (+ déploiement visé pour une réparation).
pub fn classify(content: &str) -> (&'static str, Option<String>) {
    let c = content.trim_start();
    if c.starts_with(crate::correction::REDO_PREFIX) {
        return ("repair", None);
    }
    if c.contains("AUTO-RÉPARATION") {
        return ("repair", token_after(c, "Le déploiement "));
    }
    if c.contains("COORD-WAKE:DEPLOY-FAIL:") {
        return ("repair", token_after(c, "COORD-WAKE:DEPLOY-FAIL:"));
    }
    if c.contains("échec de déploiement") && c.contains("Déploiement :") {
        return ("repair", token_after(c, "Déploiement :"));
    }
    if c.starts_with(crate::agent_runs::PREVIEW_REPAIR_PREFIX) {
        return ("repair", None);
    }
    if c.contains("SDD-IMPLEMENT:") || c.contains("SDD-SPECIFY") {
        return ("feature", None);
    }
    if c.starts_with("COORD-WAKE:") || c.starts_with("CRON:") || c.starts_with("EVENT:") {
        return ("routine", None);
    }
    ("feature", None)
}

/// Chemins passés à `write_project_file` (local) avec succès.
fn written_paths(tools_json: &str) -> Vec<String> {
    let calls: Vec<Value> = serde_json::from_str(tools_json).unwrap_or_default();
    calls
        .iter()
        .filter(|c| c.get("name").and_then(|v| v.as_str()) == Some("write_project_file"))
        .filter(|c| {
            c.get("result")
                .and_then(|r| r.get("ok"))
                .and_then(|v| v.as_bool())
                != Some(false)
        })
        .filter_map(|c| {
            c.get("arguments")?
                .get("path")?
                .as_str()
                .map(|p| p.trim_start_matches("./").to_string())
        })
        .collect()
}

/// Fichiers du brouillon à attribuer au run (modifiés depuis son début ou écrits par lui).
pub fn touched_by_run(
    workdir: &std::path::Path,
    files: &[DraftFile],
    since: chrono::DateTime<chrono::Utc>,
    written: &[String],
) -> Vec<String> {
    let since = since - chrono::Duration::seconds(5);
    files
        .iter()
        .filter(|f| {
            written.iter().any(|p| p == &f.path)
                || std::fs::metadata(workdir.join(&f.path))
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .map(|t| chrono::DateTime::<chrono::Utc>::from(t) >= since)
                    .unwrap_or(false)
        })
        .map(|f| f.path.clone())
        .collect()
}

/// Appelé en fin de run : attribue les fichiers touchés. Best effort, jamais bloquant pour le run.
pub async fn record_run(
    state: &AppState,
    run: &crate::agent_runs::RunRow,
    tools_json: &str,
    reply: &str,
) {
    let Ok(Some(project)) = sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE uuid = $1")
        .bind(&run.project_uuid)
        .fetch_optional(&state.pool)
        .await
    else {
        return;
    };
    let Some(wd) = crate::draft_routes::workdir_of(&project) else {
        return;
    };
    let branch = crate::draft_routes::branch_of(&project);
    let started: Option<(String,)> =
        sqlx::query_as("SELECT created_at FROM agent_runs WHERE uuid = $1")
            .bind(&run.uuid)
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten();
    let Some(since) = started
        .and_then(|(t,)| chrono::DateTime::parse_from_rfc3339(&t).ok())
        .map(|t| t.with_timezone(&chrono::Utc))
    else {
        return;
    };
    let agent_name: String =
        sqlx::query_as::<_, (String,)>("SELECT name FROM project_agents WHERE uuid = $1")
            .bind(&run.agent_uuid)
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten()
            .map(|(n,)| n)
            .unwrap_or_default();
    let written = written_paths(tools_json);
    let touched = tokio::task::spawn_blocking(move || {
        if !wd.is_dir() {
            return Vec::new();
        }
        let st = draft::status(&wd, &branch, None);
        touched_by_run(&wd, &st.files, since, &written)
    })
    .await
    .unwrap_or_default();
    if touched.is_empty() {
        return;
    }
    let (kind, dep) = classify(&run.content);
    let now = crate::state::now_str();
    for path in touched.iter() {
        let _ = sqlx::query(
            r#"INSERT INTO draft_origins (project_uuid, path, run_uuid, agent_uuid, agent_name, kind, deployment_uuid, recorded_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               ON CONFLICT (project_uuid, path) DO UPDATE SET run_uuid = EXCLUDED.run_uuid, agent_uuid = EXCLUDED.agent_uuid,
                 agent_name = EXCLUDED.agent_name, kind = EXCLUDED.kind, deployment_uuid = EXCLUDED.deployment_uuid,
                 recorded_at = EXCLUDED.recorded_at"#,
        )
        .bind(&run.project_uuid)
        .bind(&path)
        .bind(&run.uuid)
        .bind(&run.agent_uuid)
        .bind(&agent_name)
        .bind(kind)
        .bind(&dep)
        .bind(&now)
        .execute(&state.pool)
        .await;
    }
    crate::correction::note_proposed(state, &run.project_uuid, kind, &agent_name, reply, &touched)
        .await;
}

pub async fn load(pool: &PgPool, project_uuid: &str) -> HashMap<String, Origin> {
    let rows: Vec<(String, String, String, String, String, Option<String>, String)> = sqlx::query_as(
        "SELECT path, run_uuid, agent_uuid, agent_name, kind, deployment_uuid, recorded_at FROM draft_origins WHERE project_uuid = $1",
    )
    .bind(project_uuid)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    rows.into_iter()
        .map(|(path, run, agent, name, kind, dep, at)| {
            let opt = |s: String| (!s.is_empty()).then_some(s);
            (
                path,
                Origin {
                    kind,
                    run_uuid: opt(run),
                    agent_uuid: opt(agent),
                    agent_name: opt(name),
                    deployment_uuid: dep,
                    recorded_at: Some(at),
                },
            )
        })
        .collect()
}

/// Oublie l'origine (brouillon validé / supprimé, fichier annulé).
pub async fn forget(pool: &PgPool, project_uuid: &str, path: Option<&str>) {
    let q = match path {
        Some(p) => sqlx::query("DELETE FROM draft_origins WHERE project_uuid = $1 AND path = $2")
            .bind(project_uuid)
            .bind(p.to_string()),
        None => sqlx::query("DELETE FROM draft_origins WHERE project_uuid = $1").bind(project_uuid),
    };
    let _ = q.execute(pool).await;
}

/// Origine de chaque fichier (manuelle / resynchro par défaut).
pub fn per_file(files: &[DraftFile], known: &HashMap<String, Origin>) -> Vec<Origin> {
    files
        .iter()
        .map(|f| match known.get(&f.path) {
            Some(o) => o.clone(),
            None if draft::is_lockfile(&f.path) => Origin {
                kind: "sync".into(),
                ..Default::default()
            },
            None => Origin {
                kind: "manual".into(),
                ..Default::default()
            },
        })
        .collect()
}

/// Origine principale du brouillon : réparation > fonctionnalité > routine > manuelle > resynchro.
pub fn summary(origins: &[Origin]) -> Option<Origin> {
    const ORDER: [&str; 5] = ["repair", "feature", "routine", "manual", "sync"];
    ORDER.iter().find_map(|k| {
        // Le run le plus récent de ce type (lien « Voir la discussion »).
        origins
            .iter()
            .filter(|o| o.kind == *k)
            .max_by(|a, b| a.recorded_at.cmp(&b.recorded_at))
            .cloned()
    })
}

/// Types présents, dans l'ordre d'affichage.
pub fn kinds(origins: &[Origin]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for k in ["repair", "feature", "routine", "manual", "sync"] {
        if origins.iter().any(|o| o.kind == k) {
            out.push(k.into());
        }
    }
    out
}

/// Si une mise en ligne (production) a réussi après le déploiement en échec visé : sa date.
pub async fn repair_obsolete_since(pool: &PgPool, origins: &[Origin]) -> Option<String> {
    let deps: Vec<&str> = origins
        .iter()
        .filter(|o| o.kind == "repair")
        .filter_map(|o| o.deployment_uuid.as_deref())
        .collect();
    if deps.is_empty() || origins.iter().any(|o| o.kind == "feature") {
        return None;
    }
    let mut latest: Option<String> = None;
    for dep in deps {
        let row: Option<(String,)> = sqlx::query_as(
            r#"SELECT COALESCE(d2.finished_at, d2.created_at) FROM deployments d1
               JOIN deployments d2 ON d2.project_id = d1.project_id
               WHERE d1.uuid = $1 AND d2.status IN ('success', 'deployed', 'ok')
                 AND d2.created_at > d1.created_at AND COALESCE(d2.environment, 'production') <> 'dev'
               ORDER BY d2.created_at ASC LIMIT 1"#,
        )
        .bind(dep)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();
        match row {
            // Chaque déploiement visé doit être réparé depuis ; sinon le correctif peut encore servir.
            None => return None,
            Some((at,)) => {
                if latest.as_deref().map_or(true, |l| at.as_str() > l) {
                    latest = Some(at);
                }
            }
        }
    }
    latest
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_runs() {
        assert_eq!(
            classify("AUTO-RÉPARATION DÉPLOIEMENT\n\nLe déploiement dep-123 a échoué."),
            ("repair", Some("dep-123".into()))
        );
        assert_eq!(
            classify("COORD-WAKE:DEPLOY-FAIL:abc-9\n\nÉvénement"),
            ("repair", Some("abc-9".into()))
        );
        assert_eq!(
            classify("Événement projet : échec de déploiement.\nDéploiement : d-7\nDiagnostic"),
            ("repair", Some("d-7".into()))
        );
        assert_eq!(
            classify("[réparation preview] l'aperçu ne démarre pas").0,
            "repair"
        );
        assert_eq!(classify("SDD-IMPLEMENT:dark-mode\nfais-le").0, "feature");
        assert_eq!(classify("Ajoute un bouton contact").0, "feature");
        assert_eq!(classify("COORD-WAKE:HEALTH:x").0, "routine");
    }

    #[test]
    fn per_file_defaults_and_summary() {
        let f = |p: &str| DraftFile {
            path: p.into(),
            status: "modified".into(),
            old_path: None,
        };
        let files = vec![f("package-lock.json"), f("src/a.ts"), f("src/b.ts")];
        let mut known = HashMap::new();
        known.insert(
            "src/b.ts".to_string(),
            Origin {
                kind: "repair".into(),
                run_uuid: Some("r1".into()),
                recorded_at: Some("2026-10-11T00:00:00Z".into()),
                ..Default::default()
            },
        );
        let o = per_file(&files, &known);
        assert_eq!(
            o.iter().map(|x| x.kind.as_str()).collect::<Vec<_>>(),
            vec!["sync", "manual", "repair"]
        );
        assert_eq!(summary(&o).unwrap().run_uuid.as_deref(), Some("r1"));
        assert_eq!(kinds(&o), vec!["repair", "manual", "sync"]);
    }

    #[test]
    fn written_paths_ignores_failures() {
        let j = r#"[{"name":"write_project_file","arguments":{"path":"./a.ts"},"result":{"ok":true}},
                    {"name":"write_project_file","arguments":{"path":"b.ts"},"result":{"ok":false}},
                    {"name":"run_workdir_command","arguments":{"command":"npm i"}}]"#;
        assert_eq!(written_paths(j), vec!["a.ts".to_string()]);
    }
}
