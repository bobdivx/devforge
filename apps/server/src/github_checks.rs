//! P4 — Retour d'état vers GitHub pour chaque déploiement : Check Run « DevForge / deploy »
//! (projets liés à l'installation), statut de commit `devforge/deploy` en repli (PAT),
//! et GitHub Deployment (« View deployment » dans la PR).
//!
//! Actif uniquement en mode GitHub App (`DEVFORGE_GITHUB_APP=1` ou app enregistrée) :
//! sans ce mode, aucun appel n'est fait (comportement inchangé). Les appels GitHub sont
//! « best effort » : un échec est journalisé et retenté une fois, jamais propagé.

use std::sync::Arc;
use std::time::Duration;

use devforge_github::checks::RepoApi;
use tokio::sync::Notify;

use crate::github_auth::GithubAuth;
use crate::state::{AppState, Project};

pub const RETRY_DELAY: Duration = Duration::from_secs(20);
const LOG_TAIL_LINES: usize = 50;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// Checks API (exige un token d'installation GitHub App).
    Checks,
    /// Statuts de commit (projets encore en PAT).
    Statuses,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Ids {
    pub head_sha: String,
    pub check_run_id: Option<i64>,
    pub deployment_id: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Final {
    Success {
        summary: String,
    },
    Failure {
        title: String,
        summary: String,
        text: String,
    },
    Cancelled,
}

#[derive(Debug, Clone)]
pub struct Reporter {
    pub api: RepoApi,
    pub mode: Mode,
    pub details_url: Option<String>,
    pub environment_url: Option<String>,
    pub environment: String,
    pub retry_delay: Duration,
}

async fn attempt<T, F, Fut>(what: &str, delay: Duration, f: F) -> Option<T>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<T, String>>,
{
    match f().await {
        Ok(v) => Some(v),
        Err(e) => {
            tracing::warn!("GitHub {what} : {e} — nouvel essai différé");
            tokio::time::sleep(delay).await;
            match f().await {
                Ok(v) => Some(v),
                Err(e) => {
                    tracing::warn!("GitHub {what} : {e} — abandon (déploiement non affecté)");
                    None
                }
            }
        }
    }
}

impl Reporter {
    /// Enfilé : Check Run `queued` (ou statut `pending`) + GitHub Deployment.
    pub async fn queued(&self, head_sha: &str, deployment_uuid: &str) -> Ids {
        let d = self.retry_delay;
        let details = self.details_url.as_deref();
        let check_run_id = match self.mode {
            Mode::Checks => {
                attempt("check run", d, || {
                    self.api
                        .create_check_run(head_sha, details, deployment_uuid)
                })
                .await
            }
            Mode::Statuses => {
                attempt("statut", d, || {
                    self.api.create_status(
                        head_sha,
                        "pending",
                        "Déploiement en file d’attente",
                        details,
                    )
                })
                .await;
                None
            }
        };
        let deployment_id = attempt("deployment", d, || {
            self.api.create_deployment(head_sha, &self.environment)
        })
        .await;
        Ids {
            head_sha: head_sha.to_string(),
            check_run_id,
            deployment_id,
        }
    }

    /// Build démarré.
    pub async fn in_progress(&self, ids: &Ids) {
        let d = self.retry_delay;
        let details = self.details_url.as_deref();
        match (self.mode, ids.check_run_id) {
            (Mode::Checks, Some(id)) => {
                attempt("check run", d, || {
                    self.api.update_check_run(id, "in_progress", None, None)
                })
                .await;
            }
            (Mode::Statuses, _) => {
                attempt("statut", d, || {
                    self.api.create_status(
                        &ids.head_sha,
                        "pending",
                        "Déploiement en cours",
                        details,
                    )
                })
                .await;
            }
            _ => {}
        }
        if let Some(dep) = ids.deployment_id {
            attempt("deployment status", d, || {
                self.api
                    .create_deployment_status(dep, "in_progress", details, None)
            })
            .await;
        }
    }

    pub async fn finish(&self, ids: &Ids, fin: &Final) {
        let d = self.retry_delay;
        let details = self.details_url.as_deref();
        let (conclusion, status_state, dep_state, desc) = match fin {
            Final::Success { .. } => ("success", "success", "success", "Déploiement réussi"),
            Final::Failure { .. } => ("failure", "failure", "failure", "Échec du déploiement"),
            Final::Cancelled => ("cancelled", "error", "inactive", "Déploiement annulé"),
        };
        match (self.mode, ids.check_run_id) {
            (Mode::Checks, Some(id)) => {
                let (title, summary, text) = match fin {
                    Final::Success { summary } => (
                        "Déploiement réussi".to_string(),
                        summary.clone(),
                        String::new(),
                    ),
                    Final::Failure {
                        title,
                        summary,
                        text,
                    } => (title.clone(), summary.clone(), text.clone()),
                    Final::Cancelled => (
                        "Déploiement annulé".into(),
                        "Remplacé ou annulé dans DevForge.".into(),
                        String::new(),
                    ),
                };
                attempt("check run", d, || {
                    self.api.update_check_run(
                        id,
                        "completed",
                        Some(conclusion),
                        Some((&title, &summary, &text)),
                    )
                })
                .await;
            }
            (Mode::Statuses, _) => {
                let desc = match fin {
                    Final::Failure { title, .. } => title.as_str(),
                    _ => desc,
                };
                attempt("statut", d, || {
                    self.api
                        .create_status(&ids.head_sha, status_state, desc, details)
                })
                .await;
            }
            _ => {}
        }
        if let Some(dep) = ids.deployment_id {
            let env_url = matches!(fin, Final::Success { .. })
                .then_some(self.environment_url.as_deref())
                .flatten();
            attempt("deployment status", d, || {
                self.api
                    .create_deployment_status(dep, dep_state, details, env_url)
            })
            .await;
        }
    }
}

/// Masque les valeurs d'env du projet et les jetons GitHub dans un texte.
pub fn mask_secrets(text: &str, secrets: &[String]) -> String {
    let mut out = text.to_string();
    let mut s: Vec<&String> = secrets.iter().filter(|v| v.trim().len() >= 4).collect();
    s.sort_by_key(|v| std::cmp::Reverse(v.len()));
    for v in s {
        out = out.replace(v.as_str(), "***");
    }
    devforge_github::app_auth::redact_tokens(&out)
}

pub fn log_tail(logs: &str, n: usize) -> String {
    let lines: Vec<&str> = logs.lines().collect();
    lines[lines.len().saturating_sub(n)..].join("\n")
}

/// Contenu Check Run d'un échec : titre lisible (`error_parser`) + 50 dernières lignes masquées.
pub fn failure_output(logs: &str, secrets: &[String]) -> Final {
    let parsed = devforge_deploy::error_parser::parse_deploy_error_fr(logs);
    let title = parsed
        .as_ref()
        .map(|e| e.summary.clone())
        .unwrap_or_else(|| "Échec du déploiement".into());
    let summary = parsed
        .as_ref()
        .and_then(|e| e.hint.clone())
        .unwrap_or_else(|| "Voir les logs complets dans DevForge.".into());
    let text = format!(
        "```\n{}\n```",
        mask_secrets(&log_tail(logs, LOG_TAIL_LINES), secrets)
    );
    Final::Failure {
        title: mask_secrets(&title, secrets),
        summary: mask_secrets(&summary, secrets),
        text,
    }
}

async fn env_values(state: &AppState, project_uuid: &str) -> Vec<String> {
    sqlx::query_as::<_, (String,)>("SELECT value FROM project_env_vars WHERE project_uuid = $1")
        .bind(project_uuid)
        .fetch_all(&state.pool)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|(v,)| v)
        .collect()
}

async fn instance_url(state: &AppState) -> String {
    sqlx::query_as::<_, (String,)>("SELECT instance_url FROM instance_settings WHERE id = 1")
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten()
        .map(|(u,)| u.trim().trim_end_matches('/').to_string())
        .unwrap_or_default()
}

async fn instance_pat(state: &AppState) -> String {
    sqlx::query_as::<_, (String,)>("SELECT github_token FROM instance_settings WHERE id = 1")
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten()
        .map(|(t,)| crate::secret_box::open_compat(&t))
        .unwrap_or_default()
}

/// Reporter pour un projet, ou `None` (mode App inactif, dépôt non GitHub, pas de token).
pub async fn resolve(
    state: &AppState,
    project: &Project,
    deployment_uuid: &str,
) -> Option<Reporter> {
    if !crate::github_auth::app_enabled(&state.pool).await {
        return None;
    }
    let (owner, repo) = devforge_github::checks::parse_repo(project.git_repository.as_deref()?)?;
    let pat = instance_pat(state).await;
    let auth = crate::github_auth::for_project(&state.pool, &project.uuid, pat.clone()).await;
    let mode = match auth {
        GithubAuth::Installation { .. } => Mode::Checks,
        GithubAuth::Pat(_) => Mode::Statuses,
    };
    let token = crate::github_auth::token(state, &auth, &pat).await;
    if token.trim().is_empty() {
        return None;
    }
    // Repli PAT après échec du token d'installation : statuts uniquement.
    let mode = if mode == Mode::Checks && token == pat {
        Mode::Statuses
    } else {
        mode
    };
    let base = instance_url(state).await;
    let details_url = (!base.is_empty()).then(|| {
        format!(
            "{base}/app/projects/view?uuid={}&tab=deployments&deployment={deployment_uuid}",
            project.uuid
        )
    });
    Some(Reporter {
        api: RepoApi::new(
            devforge_github::app_auth::default_api_base(),
            &token,
            &owner,
            &repo,
        ),
        mode,
        details_url,
        environment_url: project
            .production_url
            .clone()
            .filter(|u| u.starts_with("http")),
        environment: "Production".into(),
        retry_delay: RETRY_DELAY,
    })
}

async fn save_ids(state: &AppState, deployment_uuid: &str, ids: &Ids) {
    let _ = sqlx::query(
        "UPDATE deployments SET check_run_id = $1, github_deployment_id = $2, github_head_sha = $3 WHERE uuid = $4",
    )
    .bind(ids.check_run_id)
    .bind(ids.deployment_id)
    .bind(&ids.head_sha)
    .bind(deployment_uuid)
    .execute(&state.pool)
    .await;
}

/// Cycle de vie GitHub d'un déploiement, piloté par `run_real_deploy`.
pub struct Lifecycle {
    started: Arc<Notify>,
    task: tokio::task::JoinHandle<Option<(Reporter, Ids)>>,
}

impl Lifecycle {
    /// Signal « build démarré » (appelé dans le slot du nœud).
    pub fn started_signal(&self) -> Arc<Notify> {
        self.started.clone()
    }
}

/// Démarre le suivi (tâche détachée : aucun appel GitHub ne retarde le déploiement).
pub fn begin(
    state: &AppState,
    project: &Project,
    deployment_uuid: &str,
    pin_sha: Option<&str>,
) -> Lifecycle {
    let started = Arc::new(Notify::new());
    let (state, project, dep, pin) = (
        state.clone(),
        project.clone(),
        deployment_uuid.to_string(),
        pin_sha.map(str::to_string),
    );
    let sig = started.clone();
    let task = tokio::spawn(async move {
        let reporter = resolve(&state, &project, &dep).await?;
        let branch = project
            .git_branch
            .clone()
            .filter(|b| !b.trim().is_empty())
            .unwrap_or_else(|| "main".into());
        let head_sha = match pin {
            Some(s) if s.len() == 40 => s,
            _ => match reporter.api.branch_head(&branch).await {
                Ok(s) => s,
                Err(e) => {
                    tracing::warn!(project = %project.uuid, "GitHub : tête de branche introuvable : {e}");
                    return None;
                }
            },
        };
        let ids = reporter.queued(&head_sha, &dep).await;
        save_ids(&state, &dep, &ids).await;
        sig.notified().await;
        reporter.in_progress(&ids).await;
        Some((reporter, ids))
    });
    Lifecycle { started, task }
}

/// Clôture (tâche détachée).
pub fn end(
    state: &AppState,
    project: &Project,
    lc: Lifecycle,
    ok: bool,
    cancelled: bool,
    logs: String,
) {
    let (state, project_uuid) = (state.clone(), project.uuid.clone());
    lc.started.notify_one();
    tokio::spawn(async move {
        let Ok(Some((reporter, ids))) = lc.task.await else {
            return;
        };
        let fin = if cancelled {
            Final::Cancelled
        } else if ok {
            Final::Success {
                summary: match &reporter.environment_url {
                    Some(u) => format!("Déployé sur {u}"),
                    None => "Déployé.".into(),
                },
            }
        } else {
            failure_output(&logs, &env_values(&state, &project_uuid).await)
        };
        reporter.finish(&ids, &fin).await;
    });
}

#[cfg(test)]
#[path = "github_checks_tests.rs"]
mod tests;
