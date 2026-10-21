//! « Corrections » : vue simple des changements proposés par les agents (ex-brouillon).
//!
//! Étapes : Problème détecté → Correction proposée → Testée → En ligne (+ échec / abandon).
//! Aucune notion Git côté interface : « Appliquer » rattrape GitHub tout seul (rebase), envoie,
//! puis lance la mise en ligne. Un SHA déjà en échec n'est jamais relancé automatiquement.
//! Les corrections dépassées sont archivées automatiquement (sauvegarde 7 jours restaurable).

use std::time::Duration;

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::PgPool;

use crate::draft;
use crate::draft_origin::Origin;
use crate::routes::ApiError;
use crate::state::{new_uuid, now_str, AppState, Project};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/projects/{uuid}/corrections", get(get_corrections))
        .route("/api/v1/projects/{uuid}/corrections/apply", post(apply))
        .route("/api/v1/projects/{uuid}/corrections/reject", post(reject))
        .route("/api/v1/projects/{uuid}/corrections/redo", post(redo))
}

pub async fn migrate(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS corrections (
            uuid TEXT PRIMARY KEY,
            project_uuid TEXT NOT NULL,
            state TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'repair',
            persona TEXT NOT NULL DEFAULT '',
            summary TEXT NOT NULL DEFAULT '',
            files TEXT NOT NULL DEFAULT '[]',
            sha TEXT,
            deployment_uuid TEXT,
            backup_id TEXT,
            note TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        "#,
    )
    .execute(pool)
    .await?;
    for col in [
        "attempts INTEGER NOT NULL DEFAULT 0",
        "broke TEXT NOT NULL DEFAULT ''",
        "changed TEXT NOT NULL DEFAULT ''",
        "test_ok BOOLEAN NULL",
        "test_text TEXT NOT NULL DEFAULT ''",
    ] {
        sqlx::query(&format!(
            "ALTER TABLE corrections ADD COLUMN IF NOT EXISTS {col}"
        ))
        .execute(pool)
        .await?;
    }
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS corrections_project ON corrections (project_uuid, updated_at)",
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// États ouverts (la correction est encore dans le dossier de travail).
const MAX_ATTEMPTS: i32 = 3;

/// Personnage affiché pour une origine.
pub fn persona_for(kind: &str, agent_name: Option<&str>) -> String {
    match kind {
        "repair" => "Rustine".into(),
        "feature" => "Braise".into(),
        "routine" => "Phare".into(),
        "manual" => "toi".into(),
        "sync" => "DevForge".into(),
        _ => agent_name.unwrap_or("DevForge").to_string(),
    }
}

/// Première phrase lisible d'une réponse d'agent (≤ 160 caractères).
pub fn one_sentence(reply: &str) -> String {
    let flat = crate::mobile_routes::excerpt(reply, 400);
    let mut out = String::new();
    for (i, c) in flat.char_indices() {
        out.push(c);
        if matches!(c, '.' | '!' | '?')
            && flat[i + c.len_utf8()..].starts_with(' ')
            && out.chars().count() > 20
        {
            break;
        }
    }
    let out = out.trim().to_string();
    if out.chars().count() > 160 {
        format!("{}…", out.chars().take(159).collect::<String>().trim_end())
    } else {
        out
    }
}

/// Phrase par défaut quand l'agent n'a rien résumé.
pub fn default_summary(files: &[String]) -> String {
    match files.len() {
        0 => "Petite correction.".into(),
        1 => format!("Modifie {}.", short(&files[0])),
        n => format!(
            "Modifie {} et {} autre{}.",
            short(&files[0]),
            n - 1,
            if n > 2 { "s" } else { "" }
        ),
    }
}

fn short(p: &str) -> &str {
    p.rsplit('/').next().unwrap_or(p)
}

#[derive(Debug, Clone, sqlx::FromRow)]
struct Row {
    uuid: String,
    state: String,
    kind: String,
    persona: String,
    summary: String,
    files: String,
    sha: Option<String>,
    deployment_uuid: Option<String>,
    backup_id: Option<String>,
    note: String,
    created_at: String,
    updated_at: String,
    attempts: i32,
    broke: String,
    changed: String,
    test_ok: Option<bool>,
    test_text: String,
}

async fn open_row(pool: &PgPool, project_uuid: &str) -> Option<Row> {
    sqlx::query_as::<_, Row>(
        "SELECT uuid, state, kind, persona, summary, files, sha, deployment_uuid, backup_id, note, created_at, updated_at, attempts, broke, changed, test_ok, test_text
         FROM corrections WHERE project_uuid = $1 AND state IN ('testing', 'proposed', 'conflict') ORDER BY updated_at DESC LIMIT 1",
    )
    .bind(project_uuid)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
}

async fn set_state(pool: &PgPool, uuid: &str, state: &str, note: &str) {
    let _ = sqlx::query(
        "UPDATE corrections SET state = $1, note = $2, updated_at = $3 WHERE uuid = $4",
    )
    .bind(state)
    .bind(note)
    .bind(now_str())
    .bind(uuid)
    .execute(pool)
    .await;
}

/// Rapport structuré écrit par l'agent en fin de réponse :
/// `Cassé : …` / `Changé : …` (variantes « Ce qui a cassé », « Ce que j'ai changé »).
pub fn parse_report(reply: &str) -> (String, String) {
    let mut broke = String::new();
    let mut changed = String::new();
    for line in reply.lines() {
        let l = line
            .trim()
            .trim_start_matches(['-', '*', '•', ' '])
            .replace("**", "");
        let low = l.to_lowercase();
        let take = |l: &str| {
            l.splitn(2, ':')
                .nth(1)
                .unwrap_or("")
                .trim()
                .chars()
                .take(240)
                .collect::<String>()
        };
        if broke.is_empty() && (low.starts_with("cassé") || low.starts_with("ce qui a cassé")) {
            broke = take(&l);
        } else if changed.is_empty()
            && (low.starts_with("changé")
                || low.starts_with("ce que j'ai changé")
                || low.starts_with("ce que j’ai changé"))
        {
            changed = take(&l);
        }
    }
    (broke, changed)
}

/// Ce que l'utilisateur doit faire, selon l'étape.
pub fn todo_for(stage: &str) -> &'static str {
    match stage {
        "testing" => "Rien pour l’instant : Rustine vérifie sa correction.",
        "proposed" => "Appuie sur Appliquer pour la mettre en ligne, ou Rejeter.",
        "conflict" => "Demande à Rustine de refaire la correction.",
        "deploying" => "Rien : la mise en ligne est en cours.",
        "live" => "Rien : c’est en ligne.",
        "failed" => "Ouvre la discussion avec Rustine pour décider de la suite.",
        _ => "Rien.",
    }
}

/// Fin de run d'agent ayant touché des fichiers : la correction est créée ou complétée.
/// Une réparation passe d'abord par « testing » : l'utilisateur n'est prévenu qu'après un test réussi.
pub async fn note_proposed(
    state: &AppState,
    project_uuid: &str,
    kind: &str,
    agent_name: &str,
    reply: &str,
    files: &[String],
) {
    let pool = &state.pool;
    let now = now_str();
    let (mut broke, mut changed) = parse_report(reply);
    let mut summary = if changed.is_empty() {
        one_sentence(reply)
    } else {
        changed.clone()
    };
    if summary.chars().count() < 8 {
        summary = default_summary(files);
    }
    if changed.is_empty() {
        changed = summary.clone();
    }
    let persona = persona_for(kind, Some(agent_name));
    let next = if kind == "repair" {
        "testing"
    } else {
        "proposed"
    };
    let id = if let Some(r) = open_row(pool, project_uuid).await {
        let mut all: Vec<String> = serde_json::from_str(&r.files).unwrap_or_default();
        for f in files {
            if !all.contains(f) {
                all.push(f.clone());
            }
        }
        if broke.is_empty() {
            broke = r.broke.clone();
        }
        let _ = sqlx::query(
            "UPDATE corrections SET state = $1, kind = $2, persona = $3, summary = $4, files = $5, note = '', broke = $6, changed = $7,
             test_ok = NULL, test_text = '', updated_at = $8 WHERE uuid = $9",
        )
        .bind(next)
        .bind(kind)
        .bind(&persona)
        .bind(&summary)
        .bind(json!(all).to_string())
        .bind(&broke)
        .bind(&changed)
        .bind(&now)
        .bind(&r.uuid)
        .execute(pool)
        .await;
        r.uuid
    } else {
        let id = new_uuid();
        let _ = sqlx::query(
            "INSERT INTO corrections (uuid, project_uuid, state, kind, persona, summary, files, broke, changed, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)",
        )
        .bind(&id)
        .bind(project_uuid)
        .bind(next)
        .bind(kind)
        .bind(&persona)
        .bind(&summary)
        .bind(json!(files).to_string())
        .bind(&broke)
        .bind(&changed)
        .bind(&now)
        .execute(pool)
        .await;
        id
    };
    if next == "testing" {
        let st = state.clone();
        let p = project_uuid.to_string();
        spawn_verify(st, p, id);
    }
}

fn spawn_verify(st: AppState, p: String, id: String) {
    let fut: std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> =
        Box::pin(async move { verify(&st, &p, &id).await });
    tokio::spawn(fut);
}

/// Vérifie la correction (tests/build déclarés + démarrage de l'aperçu qui doit répondre).
/// Réussite → « proposée » (notifiée). Échec → Rustine réessaie (3 fois max), puis échec clair.
pub async fn verify(state: &AppState, project_uuid: &str, id: &str) {
    let tests = tokio::time::timeout(
        Duration::from_secs(900),
        state.registry.execute(
            "run_application_tests",
            json!({ "project_uuid": project_uuid }),
        ),
    )
    .await;
    let (tests_ok, tests_txt, tests_err) = match tests {
        Ok(Ok(v)) => {
            let ok = v.get("ok").and_then(|b| b.as_bool()).unwrap_or(false);
            let err = v
                .get("error")
                .and_then(|e| e.as_str())
                .unwrap_or("")
                .to_string();
            let none =
                !ok && (err.contains("test_command") || err.to_lowercase().contains("aucun"));
            if none {
                (true, String::new(), String::new())
            } else if ok {
                (true, "les tests passent".to_string(), String::new())
            } else {
                let logs = v
                    .get("output")
                    .or_else(|| v.get("logs"))
                    .and_then(|l| l.as_str())
                    .unwrap_or("");
                (
                    false,
                    "les tests échouent".to_string(),
                    format!("{err}\n{}", tail(logs, 1500)),
                )
            }
        }
        Ok(Err(e)) => (
            false,
            "les tests n’ont pas pu tourner".to_string(),
            e.to_string(),
        ),
        Err(_) => (
            false,
            "les tests ont dépassé le temps".to_string(),
            "timeout".into(),
        ),
    };
    let (smoke_ok, smoke_err) = if tests_ok {
        let r = tokio::time::timeout(
            Duration::from_secs(600),
            state.registry.execute(
                "start_local_preview",
                json!({ "project_uuid": project_uuid, "force": true }),
            ),
        )
        .await;
        match r {
            Ok(Ok(v)) => {
                let ok = v
                    .get("public_ok")
                    .and_then(|b| b.as_bool())
                    .or_else(|| v.get("ok").and_then(|b| b.as_bool()))
                    .unwrap_or(false);
                let err = v
                    .get("error")
                    .and_then(|e| e.as_str())
                    .unwrap_or("")
                    .to_string();
                let logs = v.get("logs_tail").and_then(|l| l.as_str()).unwrap_or("");
                (ok, format!("{err}\n{}", tail(logs, 1500)))
            }
            Ok(Err(e)) => (false, e.to_string()),
            Err(_) => (false, "timeout".into()),
        }
    } else {
        (false, String::new())
    };
    let passed = tests_ok && smoke_ok;
    let what = if tests_txt.is_empty() {
        "build de l’app et démarrage de l’aperçu".to_string()
    } else {
        format!("{tests_txt}, build et démarrage de l’aperçu")
    };
    let test_text = if passed {
        format!("Réussi : {what}, l’app répond.")
    } else if !tests_ok {
        format!("Échoué : {tests_txt}.")
    } else {
        "Échoué : l’app ne démarre pas ou ne répond pas.".to_string()
    };
    let attempts: i32 = sqlx::query_as::<_, (i32,)>("UPDATE corrections SET attempts = attempts + 1, test_ok = $1, test_text = $2, updated_at = $3 WHERE uuid = $4 RETURNING attempts")
        .bind(passed)
        .bind(&test_text)
        .bind(now_str())
        .bind(id)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten()
        .map(|(a,)| a)
        .unwrap_or(MAX_ATTEMPTS);
    if passed {
        set_state(&state.pool, id, "proposed", "").await;
        return;
    }
    let reason = if tests_ok { smoke_err } else { tests_err };
    if attempts >= MAX_ATTEMPTS {
        set_state(
            &state.pool,
            id,
            "failed",
            &format!("Rustine n’a pas réussi à corriger après {attempts} essais. Le test échoue toujours."),
        )
        .await;
        return;
    }
    // Nouvel essai : on garde les fichiers, Rustine repart du résultat du test.
    let agent: Option<(String,)> = sqlx::query_as(
        "SELECT agent_uuid FROM draft_origins WHERE project_uuid = $1 AND kind = 'repair' AND agent_uuid <> '' ORDER BY recorded_at DESC LIMIT 1",
    )
    .bind(project_uuid)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();
    let Some((agent_uuid,)) = agent else {
        set_state(
            &state.pool,
            id,
            "failed",
            "Le test de la correction échoue.",
        )
        .await;
        return;
    };
    let prompt = format!(
        "{REDO_PREFIX}\nAUTO-RÉPARATION\nTa correction ne passe pas le test (essai {attempts}/{MAX_ATTEMPTS}).\n{test_text}\nDétail :\n```\n{}\n```\nCorrige en local (sans publier, sans sync_workdir_to_github ni trigger_deploy), relance le build, puis termine par le rapport :\nCassé : …\nChangé : …",
        tail(&crate::draft::redact(&reason), 2500)
    );
    if crate::agent_runs::record_user_turn(&state.pool, project_uuid, &agent_uuid, &prompt)
        .await
        .is_ok()
    {
        let (st, p) = (state.clone(), project_uuid.to_string());
        let fut: std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> =
            Box::pin(async move {
                let _ = crate::routes::trigger_agent_turn(&st, &p, &agent_uuid).await;
            });
        tokio::spawn(fut);
    }
}

fn tail(s: &str, max: usize) -> String {
    let n = s.chars().count();
    if n <= max {
        s.trim().to_string()
    } else {
        s.chars()
            .skip(n - max)
            .collect::<String>()
            .trim()
            .to_string()
    }
}

/// Agent de réparation (Rustine) de l'app, créé au besoin. Pas de déclencheur d'événement :
/// seul le serveur le réveille, avec son propre prompt.
pub async fn ensure_repair_agent(pool: &PgPool, project_uuid: &str) -> Result<String, String> {
    if let Ok(Some((u,))) = sqlx::query_as::<_, (String,)>(
        "SELECT uuid FROM project_agents WHERE project_uuid = $1 AND role = 'repair' ORDER BY created_at LIMIT 1",
    )
    .bind(project_uuid)
    .fetch_optional(pool)
    .await
    {
        return Ok(u);
    }
    let uuid = new_uuid();
    let now = now_str();
    sqlx::query(
        r#"INSERT INTO project_agents (
            uuid, project_uuid, name, role, kind, parent_agent_uuid, status,
            enabled, trigger_type, trigger_config, instructions, last_run_at, next_run_at, created_at, updated_at
        ) VALUES ($1, $2, 'Rustine', 'repair', 'required', NULL, 'idle', 1, '', '{}', '', '', '', $3, $3)"#,
    )
    .bind(&uuid)
    .bind(project_uuid)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(uuid)
}

/// Durée maximale pendant laquelle une réparation « en test » retarde un nouveau commit.
pub const REPAIR_TESTING_HOLD_MIN: i64 = 30;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RepairGate {
    /// Rustine teste activement sa correction : on reporte (au prochain tick).
    Wait,
    /// Réparation prête / en conflit / test bloqué : le nouveau commit passe devant,
    /// le brouillon est sauvegardé puis la réparation est archivée.
    Supersede,
}

/// Décision pure : seule une réparation en cours de test récente retient un nouveau commit.
/// Avant (incident du 14/10/2026), une réparation « prête » jamais appliquée bloquait
/// silencieusement tout auto-deploy du projet, indéfiniment.
pub fn repair_gate(
    state: &str,
    updated_at: &str,
    now: chrono::DateTime<chrono::Utc>,
) -> RepairGate {
    if state != "testing" {
        return RepairGate::Supersede;
    }
    match chrono::DateTime::parse_from_rfc3339(updated_at) {
        Ok(t) if (now - t.with_timezone(&chrono::Utc)).num_minutes() < REPAIR_TESTING_HOLD_MIN => {
            RepairGate::Wait
        }
        _ => RepairGate::Supersede,
    }
}

/// Avant un déploiement d'un nouveau commit : `true` = reporter. Sinon les réparations
/// ouvertes sont archivées (le brouillon est sauvegardé par l'appelant avant le reset).
pub async fn gate_deploy_on_repair(pool: &PgPool, project_uuid: &str) -> bool {
    let rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT uuid, state, updated_at FROM corrections WHERE project_uuid = $1 AND kind = 'repair' AND state IN ('testing', 'proposed', 'conflict')",
    )
    .bind(project_uuid)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    let now = chrono::Utc::now();
    if rows
        .iter()
        .any(|(_, st, up)| repair_gate(st, up, now) == RepairGate::Wait)
    {
        return true;
    }
    for (uuid, _, _) in rows {
        let _ = sqlx::query("UPDATE corrections SET state = 'archived', note = 'Remplacée : un nouveau commit a été mis en ligne (brouillon sauvegardé).', updated_at = $1 WHERE uuid = $2")
            .bind(now_str())
            .bind(&uuid)
            .execute(pool)
            .await;
    }
    false
}

#[cfg(test)]
mod repair_gate_tests {
    use super::*;

    #[test]
    fn proposed_or_conflict_never_blocks() {
        let now = chrono::Utc::now();
        let t = now.to_rfc3339();
        assert_eq!(repair_gate("proposed", &t, now), RepairGate::Supersede);
        assert_eq!(repair_gate("conflict", &t, now), RepairGate::Supersede);
    }

    #[test]
    fn testing_blocks_only_while_recent() {
        let now = chrono::Utc::now();
        let recent = (now - chrono::Duration::minutes(5)).to_rfc3339();
        let stale = (now - chrono::Duration::minutes(REPAIR_TESTING_HOLD_MIN + 1)).to_rfc3339();
        assert_eq!(repair_gate("testing", &recent, now), RepairGate::Wait);
        assert_eq!(repair_gate("testing", &stale, now), RepairGate::Supersede);
        assert_eq!(
            repair_gate("testing", "garbage", now),
            RepairGate::Supersede
        );
    }
}

/// Échec dû à la plateforme (délais Docker, conteneur jamais prêt sans erreur de l'app).
pub fn platform_failure(summary: &str, logs: &str) -> Option<&'static str> {
    let s = format!("{summary}\n{logs}").to_lowercase();
    if s.contains("docker_update_labels") || (s.contains("update labels") && s.contains("timeout"))
    {
        return Some("La plateforme DevForge n’a pas réussi à mettre à jour le conteneur à temps (délai Docker).");
    }
    if s.contains("wait_container_ready")
        || s.contains("conteneur pas prêt")
        || s.contains("container not ready")
    {
        let app_error = [
            "error:",
            "exception",
            "panic",
            "cannot find module",
            "syntaxerror",
            "typeerror",
            "referenceerror",
        ]
        .iter()
        .any(|k| s.contains(k));
        // Bind localhost (Astro/Next sans HOST=0.0.0.0) : corrigeable côté app / env, pas « plateforme ».
        // Log monoligne « listening on http://localhost » = host localhost ; le format multi-ligne
        // Astro avec 0.0.0.0 contient aussi « network: ».
        let localhost_bind = s.contains("listening on http://localhost")
            && !s.contains("network:");
        if localhost_bind {
            return None;
        }
        if !app_error {
            return Some("Le conteneur n’a pas répondu à temps, sans erreur de l’app : problème probable de la plateforme DevForge.");
        }
    }
    None
}

/// Échec de plateforme : une ligne claire dans Corrections, sans agent.
pub async fn note_platform_failure(pool: &PgPool, project_uuid: &str, dep_uuid: &str, text: &str) {
    let now = now_str();
    let _ = sqlx::query(
        "INSERT INTO corrections (uuid, project_uuid, state, kind, persona, summary, files, deployment_uuid, note, broke, changed, test_text, created_at, updated_at)
         VALUES ($1, $2, 'failed', 'platform', 'DevForge', 'Problème de la plateforme, pas de ton app.', '[]', $3, $4, $4, 'Rien dans ton app.', '', $5, $5)",
    )
    .bind(new_uuid())
    .bind(project_uuid)
    .bind(dep_uuid)
    .bind(text)
    .bind(&now)
    .execute(pool)
    .await;
}

/// Étapes affichées (stepper).
pub fn steps(stage: &str, problem: bool, tested: bool) -> Value {
    let order = ["detected", "proposed", "tested", "live"];
    let reached = match stage {
        "live" => 4,
        "deploying" => 3,
        "failed" => 3,
        "testing" => 2,
        _ => {
            if tested {
                3
            } else {
                2
            }
        }
    };
    let labels = [
        "Problème détecté",
        "Correction proposée",
        "Testée",
        "En ligne",
    ];
    let mut out = Vec::new();
    for (i, k) in order.iter().enumerate() {
        if i == 0 && !problem {
            continue;
        }
        let state = if i < reached {
            "done"
        } else if i == reached {
            match stage {
                "failed" | "conflict" => "failed",
                "deploying" | "testing" => "active",
                "rejected" | "archived" => "skipped",
                _ => "todo",
            }
        } else {
            "todo"
        };
        out.push(json!({ "key": k, "label": labels[i], "state": state }));
    }
    json!(out)
}

/// Phrase de statut, sans jargon.
pub fn stage_label(stage: &str) -> &'static str {
    match stage {
        "testing" => "Test en cours",
        "proposed" => "Prête",
        "conflict" => "À refaire",
        "deploying" => "Mise en ligne…",
        "live" => "En ligne",
        "failed" => "Échec",
        "rejected" => "Rejetée",
        "archived" => "Archivée",
        _ => "",
    }
}

fn data_dir() -> std::path::PathBuf {
    std::path::PathBuf::from(std::env::var("DEVFORGE_DATA_DIR").unwrap_or_else(|_| "/data".into()))
}

async fn project_ctx(
    state: &AppState,
    headers: &HeaderMap,
    uuid: &str,
) -> Result<
    (
        crate::auth_routes::UserRow,
        Project,
        std::path::PathBuf,
        String,
    ),
    ApiError,
> {
    let (user, _ws, project) = crate::routes::auth_project(state, headers, uuid).await?;
    let wd = crate::draft_routes::workdir_of(&project)
        .ok_or_else(|| ApiError::message("Cette app n'a pas de dossier de travail."))?;
    let br = crate::draft_routes::branch_of(&project);
    Ok((user, project, wd, br))
}

async fn remote(state: &AppState, user_uuid: &str, project: &Project) -> Option<String> {
    let repo = project
        .git_repository
        .as_deref()
        .filter(|s| !s.trim().is_empty())?;
    let mut token = crate::user_prefs::github_token(&state.pool, user_uuid).await;
    if token.trim().is_empty() {
        token = state.github.instance_token().unwrap_or_default();
    }
    let token = crate::github_auth::project_token(state, &project.uuid, token).await;
    Some(draft::token_url(repo, Some(&token)))
}

/// Met à jour les corrections en cours de mise en ligne d'après les déploiements.
async fn refresh_deploying(pool: &PgPool, project: &Project) {
    let rows: Vec<(String, Option<String>)> = sqlx::query_as(
        "SELECT uuid, sha FROM corrections WHERE project_uuid = $1 AND state = 'deploying'",
    )
    .bind(&project.uuid)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    for (uuid, sha) in rows {
        let Some(sha) = sha else { continue };
        let short: String = sha.chars().take(7).collect();
        let dep: Option<(String, String)> = sqlx::query_as(
            "SELECT uuid, status FROM deployments WHERE project_id = $1 AND (target_sha = $2 OR git_sha LIKE $3)
             ORDER BY created_at DESC LIMIT 1",
        )
        .bind(project.id)
        .bind(&sha)
        .bind(format!("{short}%"))
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();
        if let Some((dep_uuid, status)) = dep {
            let next = match status.as_str() {
                "success" | "deployed" | "ok" => Some(("live", "")),
                "failed" | "error" => Some((
                    "failed",
                    "La mise en ligne a échoué. Rustine peut regarder.",
                )),
                "cancelled" => Some(("failed", "Mise en ligne annulée.")),
                _ => None,
            };
            if let Some((st, note)) = next {
                let _ = sqlx::query("UPDATE corrections SET state = $1, note = $2, deployment_uuid = $3, updated_at = $4 WHERE uuid = $5")
                    .bind(st)
                    .bind(note)
                    .bind(&dep_uuid)
                    .bind(now_str())
                    .bind(&uuid)
                    .execute(pool)
                    .await;
            }
        }
    }
}

/// Archivage automatique : correction déjà sur GitHub, réparation dépassée, ou seulement des lockfiles.
/// Le contenu est sauvegardé 7 jours puis retiré du dossier de travail.
pub async fn auto_sort(state: &AppState, project: &Project) -> Option<String> {
    let wd = crate::draft_routes::workdir_of(project)?;
    let br = crate::draft_routes::branch_of(project);
    let (wd2, br2) = (wd.clone(), br.clone());
    let (st, insight) = tokio::task::spawn_blocking(move || {
        let st = draft::status(&wd2, &br2, None);
        let insight = st.dirty.then(|| draft::remote_insight(&wd2, &br2, &st));
        (st, insight)
    })
    .await
    .ok()?;
    if !st.available || !st.dirty {
        // Rien en local : une correction « ouverte » n'a plus d'objet.
        if let Some(r) = open_row(&state.pool, &project.uuid).await {
            set_state(
                &state.pool,
                &r.uuid,
                "archived",
                "Plus rien à appliquer : déjà intégrée ou retirée.",
            )
            .await;
        }
        return None;
    }
    let known = crate::draft_origin::load(&state.pool, &project.uuid).await;
    let origins: Vec<Origin> = crate::draft_origin::per_file(&st.files, &known);
    let obsolete = crate::draft_origin::repair_obsolete_since(&state.pool, &origins).await;
    let age = st
        .updated_at
        .as_deref()
        .and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok())
        .map(|t| {
            (chrono::Utc::now() - t.with_timezone(&chrono::Utc))
                .num_days()
                .max(0)
        });
    let advice = draft::advise(&draft::AdviceInput {
        count: st.files.len(),
        insight: insight.as_ref(),
        age_days: age,
        lockfile_only: st.files.iter().all(|f| draft::is_lockfile(&f.path)),
        repair_obsolete_since: obsolete,
    });
    if advice.level != "delete" {
        return None;
    }
    let root = draft::backups_root(&data_dir(), &project.uuid);
    let files = st.files.clone();
    let n = files.len();
    let res = tokio::task::spawn_blocking(move || {
        let b = draft::backup(&wd, &root, &files, "auto-archive")?;
        draft::discard(&wd, &br, None)?;
        Ok::<_, draft::DraftError>(b)
    })
    .await
    .ok()?;
    let b = res.ok()?;
    crate::draft_origin::forget(&state.pool, &project.uuid, None).await;
    let note = format!("Archivée automatiquement : {}", advice.reason);
    match open_row(&state.pool, &project.uuid).await {
        Some(r) => {
            let _ = sqlx::query("UPDATE corrections SET state = 'archived', backup_id = $1, note = $2, updated_at = $3 WHERE uuid = $4")
                .bind(&b.id)
                .bind(&note)
                .bind(now_str())
                .bind(&r.uuid)
                .execute(&state.pool)
                .await;
        }
        None => {
            let paths: Vec<String> = st.files.iter().map(|f| f.path.clone()).collect();
            let kind = crate::draft_origin::summary(&origins)
                .map(|o| o.kind)
                .unwrap_or_else(|| "manual".into());
            let now = now_str();
            let _ = sqlx::query(
                "INSERT INTO corrections (uuid, project_uuid, state, kind, persona, summary, files, backup_id, note, created_at, updated_at)
                 VALUES ($1, $2, 'archived', $3, $4, $5, $6, $7, $8, $9, $9)",
            )
            .bind(new_uuid())
            .bind(&project.uuid)
            .bind(&kind)
            .bind(persona_for(&kind, None))
            .bind(default_summary(&paths))
            .bind(json!(paths).to_string())
            .bind(&b.id)
            .bind(&note)
            .bind(&now)
            .execute(&state.pool)
            .await;
        }
    }
    crate::deploy_queue::record_event(
        &state.pool,
        &project.uuid,
        "draft",
        "archived",
        &b.id,
        &format!("{n} fichier(s) archivés automatiquement, sauvegarde 7 jours"),
    )
    .await;
    Some(b.id)
}

/// Boucle de tri automatique (toutes les 10 min, sans réseau).
pub async fn run_loop(state: AppState) {
    tokio::time::sleep(Duration::from_secs(120)).await;
    loop {
        let projects = sqlx::query_as::<_, Project>("SELECT * FROM projects")
            .fetch_all(&state.pool)
            .await
            .unwrap_or_default();
        for p in &projects {
            refresh_deploying(&state.pool, p).await;
            if crate::draft_routes::workdir_of(p)
                .map(|w| w.is_dir())
                .unwrap_or(false)
            {
                auto_sort(&state, p).await;
            }
        }
        tokio::time::sleep(Duration::from_secs(600)).await;
    }
}

fn report_json(r: &Row) -> Value {
    let files: Vec<String> = serde_json::from_str(&r.files).unwrap_or_default();
    json!({
        "broke": r.broke,
        "changed": if r.changed.is_empty() { r.summary.clone() } else { r.changed.clone() },
        "files": files,
        "test_ok": r.test_ok,
        "test": if r.test_text.is_empty() { if r.state == "testing" { "En cours…".to_string() } else { "Pas encore testée.".to_string() } } else { r.test_text.clone() },
        "todo": todo_for(&r.state),
    })
}

fn row_json(r: &Row) -> Value {
    let files: Vec<String> = serde_json::from_str(&r.files).unwrap_or_default();
    let problem = r.kind == "repair";
    json!({
        "id": r.uuid,
        "stage": r.state,
        "status_label": stage_label(&r.state),
        "persona": r.persona,
        "summary": r.summary,
        "files": files,
        "note": r.note,
        "sha": r.sha.as_deref().map(|s| s.chars().take(7).collect::<String>()),
        "deployment_uuid": r.deployment_uuid,
        "backup_id": r.backup_id,
        "steps": steps(&r.state, problem, r.test_ok.unwrap_or(false)),
        "report": report_json(r),
        "created_at": r.created_at,
        "updated_at": r.updated_at,
    })
}

async fn get_corrections(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (_u, project, wd, br) = project_ctx(&state, &headers, &uuid).await?;
    refresh_deploying(&state.pool, &project).await;
    auto_sort(&state, &project).await;
    let (wd2, br2) = (wd.clone(), br.clone());
    let st = tokio::task::spawn_blocking(move || draft::status(&wd2, &br2, None))
        .await
        .map_err(|e| ApiError::message(e.to_string()))?;
    let mut current = Value::Null;
    if st.available && st.dirty {
        let known = crate::draft_origin::load(&state.pool, &uuid).await;
        let origins = crate::draft_origin::per_file(&st.files, &known);
        let main = crate::draft_origin::summary(&origins).unwrap_or_default();
        let paths: Vec<String> = st.files.iter().map(|f| f.path.clone()).collect();
        let row = open_row(&state.pool, &uuid).await;
        let preview = tokio::time::timeout(
            Duration::from_secs(3),
            state
                .registry
                .execute("local_preview_status", json!({ "project_uuid": uuid })),
        )
        .await;
        let tested = row.as_ref().and_then(|r| r.test_ok).unwrap_or(false)
            || matches!(preview, Ok(Ok(ref v)) if matches!(v.get("status").and_then(|s| s.as_str()), Some("running")));
        let problem = main.kind == "repair" && main.deployment_uuid.is_some();
        let stage = row
            .as_ref()
            .map(|r| r.state.clone())
            .unwrap_or_else(|| "proposed".into());
        let persona = row
            .as_ref()
            .map(|r| r.persona.clone())
            .filter(|p| !p.is_empty())
            .unwrap_or_else(|| persona_for(&main.kind, main.agent_name.as_deref()));
        let summary = row
            .as_ref()
            .map(|r| r.summary.clone())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| default_summary(&paths));
        current = json!({
            "id": row.as_ref().map(|r| r.uuid.clone()).unwrap_or_else(|| "local".into()),
            "stage": stage,
            "status_label": stage_label(&stage),
            "persona": persona,
            "summary": summary,
            "files": paths,
            "message": draft::suggested_message(&st.files),
            "note": row.as_ref().map(|r| r.note.clone()).unwrap_or_default(),
            "tested": tested,
            "report": match row.as_ref() {
                Some(r) => report_json(r),
                None => json!({ "broke": "", "changed": default_summary(&paths), "files": paths, "test_ok": null,
                    "test": "Pas encore testée.", "todo": todo_for("proposed") }),
            },
            "steps": steps(&stage, problem, tested),
            "run_uuid": main.run_uuid,
            "agent_uuid": main.agent_uuid,
            "updated_at": st.updated_at,
        });
    }
    let history: Vec<Row> = sqlx::query_as::<_, Row>(
        "SELECT uuid, state, kind, persona, summary, files, sha, deployment_uuid, backup_id, note, created_at, updated_at, attempts, broke, changed, test_ok, test_text
         FROM corrections WHERE project_uuid = $1 AND state NOT IN ('testing', 'proposed', 'conflict') ORDER BY updated_at DESC LIMIT 8",
    )
    .bind(&uuid)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();
    let root = draft::backups_root(&data_dir(), &uuid);
    let backups = tokio::task::spawn_blocking(move || draft::list_backups(&root))
        .await
        .unwrap_or_default();
    let restorable: Vec<String> = backups.iter().map(|b| b.id.clone()).collect();
    let history: Vec<Value> = history
        .iter()
        .map(|r| {
            let mut v = row_json(r);
            v["restorable"] = json!(r
                .backup_id
                .as_ref()
                .map(|b| restorable.contains(b))
                .unwrap_or(false));
            v
        })
        .collect();
    Ok(Json(
        json!({ "ok": true, "current": current, "history": history }),
    ))
}

#[derive(Deserialize, Default)]
struct ConfirmBody {
    confirm: Option<bool>,
}

async fn ensure_row(
    state: &AppState,
    project_uuid: &str,
    files: &[String],
    kind: &str,
    persona: &str,
) -> String {
    if let Some(r) = open_row(&state.pool, project_uuid).await {
        return r.uuid;
    }
    let id = new_uuid();
    let now = now_str();
    let _ = sqlx::query(
        "INSERT INTO corrections (uuid, project_uuid, state, kind, persona, summary, files, created_at, updated_at)
         VALUES ($1, $2, 'proposed', $3, $4, $5, $6, $7, $7)",
    )
    .bind(&id)
    .bind(project_uuid)
    .bind(kind)
    .bind(persona)
    .bind(default_summary(files))
    .bind(json!(files).to_string())
    .bind(&now)
    .execute(&state.pool)
    .await;
    id
}

async fn current_files(wd: &std::path::Path, br: &str) -> Vec<String> {
    let (wd, br) = (wd.to_path_buf(), br.to_string());
    tokio::task::spawn_blocking(move || {
        draft::status(&wd, &br, None)
            .files
            .into_iter()
            .map(|f| f.path)
            .collect()
    })
    .await
    .unwrap_or_default()
}

async fn origin_main(state: &AppState, uuid: &str, wd: &std::path::Path, br: &str) -> Origin {
    let (wd, br) = (wd.to_path_buf(), br.to_string());
    let files = tokio::task::spawn_blocking(move || draft::status(&wd, &br, None).files)
        .await
        .unwrap_or_default();
    let known = crate::draft_origin::load(&state.pool, uuid).await;
    crate::draft_origin::summary(&crate::draft_origin::per_file(&files, &known)).unwrap_or_default()
}

async fn apply(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Json(body): Json<ConfirmBody>,
) -> Result<Json<Value>, ApiError> {
    if !body.confirm.unwrap_or(false) {
        return Err(ApiError::message(
            "Confirmation requise pour appliquer la correction.",
        ));
    }
    let (user, project, wd, br) = project_ctx(&state, &headers, &uuid).await?;
    let Some(url) = remote(&state, &user.uuid, &project).await else {
        return Err(ApiError::message(
            "Cette app n'est pas reliée à un dépôt GitHub.",
        ));
    };
    let files = current_files(&wd, &br).await;
    let main = origin_main(&state, &uuid, &wd, &br).await;
    let id = ensure_row(
        &state,
        &uuid,
        &files,
        &main.kind,
        &persona_for(&main.kind, main.agent_name.as_deref()),
    )
    .await;
    let summary: String =
        sqlx::query_as::<_, (String,)>("SELECT summary FROM corrections WHERE uuid = $1")
            .bind(&id)
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten()
            .map(|(s,)| s)
            .unwrap_or_default();
    let message = {
        let (wd2, br2) = (wd.clone(), br.clone());
        let suggested = tokio::task::spawn_blocking(move || {
            draft::suggested_message(&draft::status(&wd2, &br2, None).files)
        })
        .await
        .unwrap_or_default();
        if summary.trim().is_empty() {
            suggested
        } else {
            format!(
                "fix: {}",
                summary
                    .trim_end_matches('.')
                    .chars()
                    .take(70)
                    .collect::<String>()
            )
        }
    };
    let name = if user.name.trim().is_empty() {
        "DevForge".to_string()
    } else {
        user.name.clone()
    };
    let email = if user.email.trim().is_empty() {
        "devforge@localhost".to_string()
    } else {
        user.email.clone()
    };
    let (wd2, br2, msg2) = (wd.clone(), br.clone(), message.clone());
    let res =
        tokio::task::spawn_blocking(move || draft::apply(&wd2, &br2, &url, &msg2, (&name, &email)))
            .await
            .map_err(|e| ApiError::message(e.to_string()))?
            .map_err(|e| ApiError::message(draft::redact(&e.0)))?;
    let pushed = match res {
        draft::Applied::Conflict(reason) => {
            set_state(&state.pool, &id, "conflict", &reason).await;
            crate::deploy_queue::record_event(
                &state.pool,
                &uuid,
                "draft",
                "conflict",
                &id,
                &reason,
            )
            .await;
            return Ok(Json(
                json!({ "ok": false, "conflict": true, "message": reason, "can_redo": true }),
            ));
        }
        draft::Applied::Pushed(v) => v,
    };
    crate::draft_origin::forget(&state.pool, &uuid, None).await;
    let _ = sqlx::query("UPDATE corrections SET sha = $1, updated_at = $2 WHERE uuid = $3")
        .bind(&pushed.sha)
        .bind(now_str())
        .bind(&id)
        .execute(&state.pool)
        .await;
    crate::deploy_queue::record_event(
        &state.pool,
        &uuid,
        "draft",
        "validated",
        &pushed.sha,
        &format!("correction appliquée ({} fichier(s))", pushed.files),
    )
    .await;
    // Jamais de relance automatique d'un SHA déjà en échec.
    let history =
        crate::auto_deploy_guard::load_history(&state.pool, project.id, "production").await;
    let already_failed = history.iter().any(|a| {
        matches!(a.status.as_str(), "failed" | "error")
            && a.sha
                .as_deref()
                .map(|s| crate::auto_deploy_guard::same_sha(s, &pushed.sha))
                .unwrap_or(false)
    });
    if already_failed {
        set_state(
            &state.pool,
            &id,
            "failed",
            "Cette version a déjà échoué en ligne : pas de nouvelle tentative automatique.",
        )
        .await;
        return Ok(Json(
            json!({ "ok": true, "deployed": false, "stage": "failed" }),
        ));
    }
    set_state(&state.pool, &id, "deploying", "").await;
    let st2 = state.clone();
    let sha = pushed.sha.clone();
    let id2 = id.clone();
    let deploy_msg = message.clone();
    tokio::spawn(async move {
        crate::auto_deploy::deploy_project(&st2, &project, &deploy_msg, Some(&sha)).await;
        refresh_deploying(&st2.pool, &project).await;
        let _ = id2;
    });
    Ok(Json(
        json!({ "ok": true, "deployed": true, "stage": "deploying", "id": id }),
    ))
}

async fn discard_with_backup(
    wd: &std::path::Path,
    br: &str,
    project_uuid: &str,
    reason: &'static str,
) -> Result<String, ApiError> {
    let root = draft::backups_root(&data_dir(), project_uuid);
    let (wd, br) = (wd.to_path_buf(), br.to_string());
    tokio::task::spawn_blocking(move || {
        let st = draft::status(&wd, &br, None);
        if !st.dirty {
            return Err(draft::DraftError("Aucune correction en attente.".into()));
        }
        let b = draft::backup(&wd, &root, &st.files, reason)?;
        draft::discard(&wd, &br, None)?;
        Ok(b.id)
    })
    .await
    .map_err(|e| ApiError::message(e.to_string()))?
    .map_err(|e| ApiError::message(draft::redact(&e.0)))
}

async fn reject(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Json(body): Json<ConfirmBody>,
) -> Result<Json<Value>, ApiError> {
    if !body.confirm.unwrap_or(false) {
        return Err(ApiError::message(
            "Confirmation requise pour rejeter la correction.",
        ));
    }
    let (_user, _project, wd, br) = project_ctx(&state, &headers, &uuid).await?;
    let files = current_files(&wd, &br).await;
    let main = origin_main(&state, &uuid, &wd, &br).await;
    let id = ensure_row(
        &state,
        &uuid,
        &files,
        &main.kind,
        &persona_for(&main.kind, main.agent_name.as_deref()),
    )
    .await;
    let backup = discard_with_backup(&wd, &br, &uuid, "reject").await?;
    crate::draft_origin::forget(&state.pool, &uuid, None).await;
    let _ = sqlx::query("UPDATE corrections SET state = 'rejected', backup_id = $1, note = 'Rejetée. Récupérable pendant 7 jours.', updated_at = $2 WHERE uuid = $3")
        .bind(&backup)
        .bind(now_str())
        .bind(&id)
        .execute(&state.pool)
        .await;
    crate::deploy_queue::record_event(
        &state.pool,
        &uuid,
        "draft",
        "discarded",
        &backup,
        "correction rejetée, sauvegarde 7 jours",
    )
    .await;
    Ok(Json(json!({ "ok": true, "backup_id": backup })))
}

pub const REDO_PREFIX: &str = "CORRECTION-REDO";

async fn redo(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Json(body): Json<ConfirmBody>,
) -> Result<Json<Value>, ApiError> {
    if !body.confirm.unwrap_or(false) {
        return Err(ApiError::message("Confirmation requise."));
    }
    let (_user, _project, wd, br) = project_ctx(&state, &headers, &uuid).await?;
    let main = origin_main(&state, &uuid, &wd, &br).await;
    let row = open_row(&state.pool, &uuid).await;
    let summary = row.as_ref().map(|r| r.summary.clone()).unwrap_or_default();
    let backup = discard_with_backup(&wd, &br, &uuid, "redo").await.ok();
    crate::draft_origin::forget(&state.pool, &uuid, None).await;
    if let Some(r) = &row {
        let _ = sqlx::query("UPDATE corrections SET state = 'archived', backup_id = $1, note = 'Remplacée : Rustine refait la correction.', updated_at = $2 WHERE uuid = $3")
            .bind(&backup)
            .bind(now_str())
            .bind(&r.uuid)
            .execute(&state.pool)
            .await;
    }
    let agent: Option<(String,)> = match main.agent_uuid.clone() {
        Some(a) => Some((a,)),
        None => sqlx::query_as("SELECT uuid FROM project_agents WHERE project_uuid = $1 AND role = 'coordinator' ORDER BY created_at LIMIT 1")
            .bind(&uuid)
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten(),
    };
    let Some((agent_uuid,)) = agent else {
        return Err(ApiError::message(
            "Aucun agent disponible pour refaire la correction.",
        ));
    };
    let prompt = format!(
        "{REDO_PREFIX}\nAUTO-RÉPARATION\nLa correction précédente ne s'appliquait plus sur le code à jour (conflit). Elle a été mise de côté (sauvegarde 7 jours).\nRefais la même correction à partir du code actuel, en local, sans publier.\nRésumé de la correction : {summary}"
    );
    crate::agent_runs::record_user_turn(&state.pool, &uuid, &agent_uuid, &prompt)
        .await
        .map_err(ApiError::message)?;
    let st = state.clone();
    let (p, a) = (uuid.clone(), agent_uuid.clone());
    tokio::spawn(async move {
        if let Err(e) = crate::routes::trigger_agent_turn(&st, &p, &a).await {
            tracing::warn!(error = %e, "correction redo");
        }
    });
    Ok(Json(json!({ "ok": true, "agent_uuid": agent_uuid })))
}

/// Événements de la boîte de réception mobile (proposée, en ligne, échec).
pub async fn inbox_events(
    pool: &PgPool,
    projects: &[Project],
    since: &str,
) -> Vec<crate::mobile_routes::InboxEvent> {
    let mut out = Vec::new();
    for p in projects {
        let rows: Vec<(String, String, String, String, String, String)> = sqlx::query_as(
            "SELECT uuid, state, persona, summary, note, updated_at FROM corrections
             WHERE project_uuid = $1 AND updated_at > $2 AND (state IN ('live', 'failed', 'conflict') OR (state = 'proposed' AND kind = 'repair' AND test_ok = TRUE))
             ORDER BY updated_at DESC LIMIT 5",
        )
        .bind(&p.uuid)
        .bind(since)
        .fetch_all(pool)
        .await
        .unwrap_or_default();
        for (id, st, persona, summary, note, at) in rows {
            let (kind, title, body) = match st.as_str() {
                "proposed" => (
                    "correction_proposed",
                    format!("Correction prête · {}", p.name),
                    format!("{persona} : {summary} Testée. Appuie sur Appliquer."),
                ),
                "live" => (
                    "correction_live",
                    format!("Correction en ligne · {}", p.name),
                    summary.clone(),
                ),
                _ => (
                    "correction_failed",
                    format!("Correction en échec · {}", p.name),
                    if note.is_empty() {
                        summary.clone()
                    } else {
                        note.clone()
                    },
                ),
            };
            out.push(crate::mobile_routes::InboxEvent {
                id: format!("correction:{id}:{st}"),
                kind,
                project_uuid: p.uuid.clone(),
                project_name: p.name.clone(),
                title,
                body,
                created_at: at,
            });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sentence_and_summary() {
        assert_eq!(
            one_sentence("J'ai corrigé le port du serveur. Ensuite j'ai relancé."),
            "J'ai corrigé le port du serveur."
        );
        assert_eq!(default_summary(&["src/a/b.rs".into()]), "Modifie b.rs.");
        assert_eq!(
            default_summary(&["a.rs".into(), "b.rs".into(), "c.rs".into()]),
            "Modifie a.rs et 2 autres."
        );
    }

    #[test]
    fn platform_detection() {
        assert!(platform_failure("docker_update_labels timeout", "").is_some());
        assert!(platform_failure("wait_container_ready 90s", "listening").is_some());
        assert!(platform_failure("wait_container_ready", "Error: Cannot find module x").is_none());
        assert!(platform_failure("npm ci failed", "").is_none());
        // Bind localhost = problème app/env, pas plateforme (laisse Rustine / Coordinateur agir).
        assert!(platform_failure(
            "wait_container_ready timeout",
            "Server listening on http://localhost:4321\ncode=000"
        )
        .is_none());
    }

    #[test]
    fn steps_states() {
        let s = steps("proposed", true, false);
        assert_eq!(s.as_array().unwrap().len(), 4);
        assert_eq!(s[1]["state"], "done");
        assert_eq!(s[2]["state"], "todo");
        let s = steps("failed", false, true);
        assert_eq!(s.as_array().unwrap().len(), 3);
        assert_eq!(s[2]["state"], "failed");
        let s = steps("live", true, true);
        assert!(s.as_array().unwrap().iter().all(|x| x["state"] == "done"));
        assert_eq!(persona_for("repair", None), "Rustine");
        assert!(stage_label("proposed").len() > 0);
    }
}
