//! Auto-deploy poller + GitHub webhook ensure.
//!
//! Le toggle `auto_deploy` filtrait déjà les webhooks push, mais sans webhook
//! GitHub configuré sur le repo rien ne se déclenchait. Ce module :
//! 1. Poll périodiquement les projets `auto_deploy=1` en retard vs GitHub
//! 2. Assure (si possible) un webhook push vers `/api/v1/webhooks/github`

use crate::infra_routes::parse_github_owner_repo;
use crate::state::{new_uuid, now_str, AppState, Project};

fn poll_interval_secs() -> u64 {
    std::env::var("DEVFORGE_AUTO_DEPLOY_POLL_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(90)
        .clamp(30, 3600)
}

fn webhook_secret() -> Option<String> {
    std::env::var("DEVFORGE_GITHUB_WEBHOOK_SECRET")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

async fn instance_public_url(state: &AppState) -> Option<String> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT instance_url FROM instance_settings WHERE id = 1")
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten();
    row.map(|(u,)| u.trim().trim_end_matches('/').to_string())
        .filter(|u| !u.is_empty() && (u.starts_with("http://") || u.starts_with("https://")))
}

pub fn webhook_callback_url(instance_url: &str) -> String {
    format!(
        "{}/api/v1/webhooks/github",
        instance_url.trim_end_matches('/')
    )
}

/// Tente de créer/assurer le webhook GitHub push pour un projet.
pub async fn ensure_project_webhook(state: &AppState, project: &Project) -> Option<String> {
    if project.auto_deploy == 0 {
        return None;
    }
    let repo_url = project.git_repository.as_deref()?.trim();
    if repo_url.is_empty() {
        return None;
    }
    let (owner, repo) = parse_github_owner_repo(repo_url)?;
    let instance_url = instance_public_url(state).await?;
    let callback = webhook_callback_url(&instance_url);
    let secret = webhook_secret();

    match state
        .github
        .ensure_push_webhook(&owner, &repo, &callback, secret.as_deref())
        .await
    {
        Ok((hook, created)) => {
            if created {
                tracing::info!(
                    project = %project.name,
                    repo = %format!("{owner}/{repo}"),
                    hook_id = hook.id,
                    "Webhook GitHub push créé pour auto-deploy"
                );
                Some(format!("created:{hook_id}", hook_id = hook.id))
            } else {
                tracing::debug!(
                    project = %project.name,
                    hook_id = hook.id,
                    "Webhook GitHub push déjà présent"
                );
                Some(format!("exists:{hook_id}", hook_id = hook.id))
            }
        }
        Err(e) => {
            // PAT sans scope hooks, ou droits insuffisants — le poller reste le filet.
            tracing::warn!(
                project = %project.name,
                repo = %format!("{owner}/{repo}"),
                error = %e,
                "Impossible d'assurer le webhook GitHub (polling auto-deploy actif)"
            );
            None
        }
    }
}


async fn latest_success_sha(state: &AppState, project_id: i64) -> Option<String> {
    let row: Option<(Option<String>,)> = sqlx::query_as(
        "SELECT git_sha FROM deployments WHERE project_id = $1 AND status IN ('success', 'ready') ORDER BY created_at DESC LIMIT 1",
    )
    .bind(project_id)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();
    row.and_then(|(sha,)| sha.filter(|s| !s.is_empty() && s != "pending" && s != "unknown"))
}

async fn project_is_behind(state: &AppState, project: &Project) -> Option<(u64, String)> {
    let repo_url = project.git_repository.as_deref()?.trim();
    if repo_url.is_empty() {
        return None;
    }
    let (owner, repo) = parse_github_owner_repo(repo_url)?;
    let branch = project
        .git_branch
        .as_deref()
        .filter(|b| !b.is_empty())
        .unwrap_or("main");
    let dep_sha = latest_success_sha(state, project.id).await?;

    match crate::routes::project_github(state, &project.workspace_uuid)
        .await
        .compare(&owner, &repo, &dep_sha, branch)
        .await
    {
        Ok(c) if c.ahead_by > 0 => {
            let tip = c
                .commits
                .last()
                .map(|c| {
                    c.message
                        .lines()
                        .next()
                        .unwrap_or("Auto-deploy")
                        .to_string()
                })
                .unwrap_or_else(|| "Auto-deploy (poll)".into());
            Some((c.ahead_by, tip))
        }
        Ok(_) => None,
        Err(e) => {
            tracing::debug!(
                project = %project.name,
                error = %e,
                "auto-deploy compare échoué"
            );
            None
        }
    }
}

pub(crate) async fn deploy_project(state: &AppState, project: &Project, message: &str) {
    let dep_uuid = new_uuid();
    let now = now_str();

    if let Err(e) = sqlx::query(
        r#"INSERT INTO deployments (
            uuid, project_id, status, git_sha, git_message, logs, finished_at, created_at, updated_at
        ) VALUES ($1, $2, 'queued', $3, $4, $5, NULL, $6, $7)"#,
    )
    .bind(&dep_uuid)
    .bind(project.id)
    .bind("pending")
    .bind(message)
    .bind(format!("[devforge] {message}\n"))
    .bind(&now)
    .bind(&now)
    .execute(&state.pool)
    .await
    {
        tracing::error!(error = %e, project = %project.uuid, "auto-deploy: insert deployment failed");
        return;
    }

    let _ = sqlx::query("UPDATE projects SET status = 'deploying', updated_at = $1 WHERE id = $2")
        .bind(&now)
        .bind(project.id)
        .execute(&state.pool)
        .await;

    tracing::info!(
        project = %project.name,
        uuid = %project.uuid,
        message = %message,
        "Auto-deploy poll: déploiement démarré"
    );

    let outcome = crate::routes::run_real_deploy(state, project, &dep_uuid).await;
    let finished = now_str();
    if outcome.cancelled {
        tracing::info!(
            project = %project.name,
            uuid = %dep_uuid,
            "Auto-deploy poll: annulé (supersede)"
        );
        return;
    }
    let result = &outcome.result;
    let status = if result.ok { "success" } else { "failed" };
    let sha = result.git_sha.as_deref().unwrap_or("unknown");

    let wrote = crate::deploy_queue::finalize_if_active(
        &state.pool,
        &dep_uuid,
        status,
        sha,
        &result.logs,
        None,
        None,
        None,
    )
    .await;
    if !wrote {
        return;
    }

    let project_status = if result.ok { "live" } else { "failed" };
    let _ = sqlx::query("UPDATE projects SET status = $1, updated_at = $2 WHERE id = $3")
        .bind(project_status)
        .bind(&finished)
        .bind(project.id)
        .execute(&state.pool)
        .await;

    if result.ok {
        if let Err(e) = state.proxy.ensure_traefik().await {
            tracing::error!(error = %e, project = %project.uuid, "auto-deploy: ensure Traefik failed");
        }
    } else {
        let state_clone = state.clone();
        let project_uuid = project.uuid.clone();
        let dep = dep_uuid.clone();
        tokio::spawn(async move {
            let _ = crate::routes::wake_coordinator_deploy_fail(
                &state_clone,
                &project_uuid,
                &dep,
                "Échec du déploiement (auto-deploy)",
                "",
            )
            .await;
        });
    }

    tracing::info!(
        project = %project.name,
        ok = result.ok,
        sha = %sha,
        "Auto-deploy poll: terminé"
    );
}

async fn tick(state: &AppState, ensure_webhooks: bool) {
    let projects = sqlx::query_as::<_, Project>(
        r#"SELECT * FROM projects
           WHERE auto_deploy != 0
             AND git_repository IS NOT NULL
             AND TRIM(git_repository) != ''
           ORDER BY updated_at DESC"#,
    )
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();

    for project in projects {
        if ensure_webhooks {
            let _ = ensure_project_webhook(state, &project).await;
        }

        // Un deploy en cours sera annulé (supersede) par run_real_deploy.
        let Some((behind_by, tip_msg)) = project_is_behind(state, &project).await else {
            continue;
        };

        let message = format!(
            "Auto-deploy ({behind_by} commit{}) — {tip_msg}",
            if behind_by > 1 { "s" } else { "" }
        );
        deploy_project(state, &project, &message).await;
    }
}

pub async fn run_loop(state: AppState) {
    let secs = poll_interval_secs();
    tracing::info!(
        interval_secs = secs,
        "Auto-deploy poller démarré (filet si webhook GitHub absent)"
    );
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(secs));
    // Premier tick après un court délai (laisser le serveur démarrer)
    tokio::time::sleep(std::time::Duration::from_secs(15)).await;
    let mut tick_n: u64 = 0;
    // Assurer les webhooks ~toutes les heures (évite rate-limit GitHub)
    let webhook_every = (3600 / secs).max(1);
    loop {
        interval.tick().await;
        tick_n = tick_n.wrapping_add(1);
        let ensure_webhooks = tick_n == 1 || tick_n % webhook_every == 0;
        if let Err(e) = tokio::time::timeout(
            std::time::Duration::from_secs(secs.saturating_mul(2).max(120)),
            tick(&state, ensure_webhooks),
        )
        .await
        {
            tracing::warn!(error = %e, "Auto-deploy poll tick timeout");
        }
    }
}
