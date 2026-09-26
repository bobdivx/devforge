mod actions_routes;
mod agent_runs;
mod auth_routes;
mod auto_deploy;
mod backup_routes;
mod cluster_routes;
mod cluster_store;
mod control_pg;
mod cron_routes;
mod db;
mod deploy_queue;
mod detect_svc;
mod dns;
mod dns_failover;
mod domain_catalog;
mod git_routes;
mod group_routes;
mod infra_routes;
mod infra_sqlite;
mod llm_routes;
mod mcp_oauth;
mod mcp_routes;
mod paths;
mod platform_sso;
#[cfg(test)]
mod platform_sso_tests;
mod pocket_id;
mod project_oidc;
mod project_oidc_routes;
mod project_pg;
mod project_pg_routes;
mod routes;
mod runner_routes;
mod runner_store;
mod security;
mod sso;
mod sso_routes;
mod state;
mod token_routes;
mod update_routes;
mod user_prefs;
mod worker;

use axum::{middleware, routing::get, Json, Router};
use serde_json::{json, Value};
use state::AppState;
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

async fn api_root() -> Json<Value> {
    Json(json!({"name":"DevForge Server","docs":"/api/v1/health"}))
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "devforge_server=debug,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();
    paths::apply_install_layout();

    let database_url =
        std::env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite:devforge.db?mode=rwc".into());
    let state = AppState::new(&database_url).await?;
    worker::apply_promote_flag(&state).await;
    worker::apply_reclaim_flag(&state).await;
    worker::release_orphan_fence(&state).await;

    if let Err(e) = worker::consume_pending_join(&state).await {
        tracing::error!(error = %e, "échec join cluster (fichier pending)");
    }
    worker::maybe_start_heartbeat(&state).await;

    let local_role = state.cluster.local().await.ok();
    if local_role
        .as_ref()
        .map(worker::is_worker_role)
        .unwrap_or(false)
    {
        tracing::info!("mode worker — pas d’UI produit");
        {
            // Rétrogradé pendant une bascule DNS : remettre les cibles d'origine.
            let st = state.clone();
            tokio::spawn(async move { crate::dns_failover::restore(&st).await });
        }
        if let Err(e) = state.proxy.ensure_traefik().await {
            tracing::error!(error = %e, "Traefik worker — les domaines de ce nœud peuvent être injoignables");
        } else {
            tracing::info!("Traefik worker ready");
        }
        {
            let proxy = state.proxy.clone();
            tokio::spawn(async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_secs(120));
                interval.tick().await;
                loop {
                    interval.tick().await;
                    if let Err(e) = proxy.ensure_traefik().await {
                        tracing::error!(error = %e, "Traefik worker watchdog");
                    }
                }
            });
        }
        let mut app = worker::worker_router(state.clone())
            .layer(security::cors_layer())
            .layer(TraceLayer::new_for_http());
        app = worker::with_static_fallback(app);
        let host = std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".into());
        let port: u16 = std::env::var("PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(8000);
        let addr: SocketAddr = format!("{host}:{port}")
            .parse()
            .unwrap_or_else(|_| SocketAddr::from(([0, 0, 0, 0], port)));
        tracing::info!("DevForge worker listening on http://{addr}");
        let listener = tokio::net::TcpListener::bind(addr).await?;
        paths::maybe_open_browser(&format!("http://127.0.0.1:{port}"));
        axum::serve(listener, app).await?;
        return Ok(());
    }

    worker::maybe_reclaim_preferred(&state).await;
    worker::spawn_fence_watch(state.clone());
    cluster_routes::spawn_snapshot_loop(state.clone());
    cluster_routes::spawn_evacuate_watch(state.clone());
    project_pg::spawn_standby_loop(state.clone());

    // Ensure Traefik reverse proxy is running (durable fix for outage 2026-09-11).
    // If the container was deleted/stopped, recreate/start it before accepting requests.
    if let Err(e) = state.proxy.ensure_traefik().await {
        tracing::error!(error = %e, "Failed to ensure Traefik container — proxy may be unavailable");
    } else {
        tracing::info!("Traefik reverse proxy ready");
    }

    // Watchdog: periodic health check for Traefik (fix for 2026-09-14 outage).
    // Every 2 minutes (reduced from 5), ensure Traefik exists and is running.
    // More frequent checks catch disappearances faster after deploys or network changes.
    {
        let proxy = state.proxy.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(120));
            interval.tick().await; // Skip first tick (already checked above)
            loop {
                interval.tick().await;
                if let Err(e) = proxy.ensure_traefik().await {
                    tracing::error!(error = %e, "Traefik watchdog: failed to ensure proxy");
                } else {
                    tracing::debug!("Traefik watchdog: proxy verified");
                }
            }
        });
    }

    crate::dns::spawn_dns_loop(state.clone());
    crate::dns_failover::spawn_loop(state.clone());
    routes::resume_deploy_queue(state.clone());
    routes::resume_agent_runs(state.clone());

    // Background sync for GitHub runners (Docker + Actions status → SQLite snapshot).
    {
        let worker = state.runners.sync_worker();
        tokio::spawn(async move {
            worker.run_loop().await;
        });
        // Auto-réparation des runners dont l’inscription GitHub n’est plus valable.
        let st = state.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(180)).await;
            loop {
                let n = st.runners.self_heal_once().await;
                if n > 0 {
                    tracing::info!(count = n, "runners recréés automatiquement");
                }
                tokio::time::sleep(std::time::Duration::from_secs(120)).await;
            }
        });
    }

    // Background scheduler for automatic instance backups (local + S3).
    {
        let scheduler = Arc::new(devforge_backup::BackupScheduler::new(
            state.pool.clone(),
            state.storage.clone(),
            state.db_path.clone(),
        ));
        tokio::spawn(async move {
            scheduler
                .run_loop(|| crate::control_pg::dump_snapshot())
                .await;
        });
    }

    // Background scheduler for project cron jobs.
    {
        let scheduler = state.cron_scheduler.clone();
        tokio::spawn(async move {
            scheduler.run_loop().await;
        });
    }

    // Agents autonomes déclenchés par cron (project_agents.trigger_type=cron).
    {
        let state_agents = state.clone();
        tokio::spawn(async move {
            routes::agent_cron_loop(state_agents).await;
        });
    }

    // Déploiements orphelins (aucune tâche vivante) → échec, toutes les 5 min.
    {
        let state_reap = state.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(300));
            loop {
                interval.tick().await;
                let n = deploy_queue::reap_orphans(
                    &state_reap.deploy_queue,
                    &state_reap.pool,
                    chrono::Duration::minutes(30),
                )
                .await;
                if n > 0 {
                    tracing::info!(count = n, "Déploiements orphelins nettoyés");
                }
            }
        });
    }

    // Auto-deploy poller: filet si webhook GitHub non configuré sur le repo.
    {
        let state_ad = state.clone();
        tokio::spawn(async move {
            auto_deploy::run_loop(state_ad).await;
        });
    }

    update_routes::spawn_auto_update(state.clone());

    // Advertise agent tools on the local MCP server surface.
    state
        .mcp
        .server
        .set_tools(state.registry.definitions())
        .await;

    let mut app = Router::new()
        .merge(auth_routes::router())
        .merge(token_routes::router())
        .merge(platform_sso::router())
        .merge(routes::router())
        .merge(infra_routes::router())
        .merge(backup_routes::router())
        .merge(sso_routes::router())
        .merge(project_oidc_routes::router())
        .merge(project_pg_routes::router())
        .merge(llm_routes::router())
        .merge(mcp_routes::router())
        .merge(mcp_oauth::router())
        .merge(runner_routes::router())
        .merge(actions_routes::router())
        .merge(git_routes::router())
        .merge(group_routes::router())
        .merge(domain_catalog::router())
        .merge(update_routes::router())
        .merge(cron_routes::router())
        .merge(cluster_routes::router())
        .merge(worker::exec_route())
        .layer(middleware::from_fn_with_state(
            state.clone(),
            token_routes::enforce_api_token_write,
        ))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            cluster_routes::replicate_writes,
        ))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            worker::fence_stale_leader,
        ))
        .layer(security::cors_layer())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    // Front Astro : `web/` à côté du programme, share/devforge (Flatpak), ou DEVFORGE_STATIC_DIR.
    let mut serving_web = false;
    if let Some(root) = paths::web_dir() {
        let index = root.join("index.html");
        tracing::info!(path = %root.display(), "serving static web assets");
        serving_web = true;
        if index.is_file() {
            app =
                app.fallback_service(ServeDir::new(&root).not_found_service(ServeFile::new(index)));
        } else {
            app = app.fallback_service(ServeDir::new(&root));
        }
    }
    if !serving_web {
        app = app.route("/", get(api_root));
    }

    let host = std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".into());
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8000);
    let addr: SocketAddr = format!("{host}:{port}")
        .parse()
        .unwrap_or_else(|_| SocketAddr::from(([0, 0, 0, 0], port)));
    tracing::info!("DevForge server listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    let public = format!("http://127.0.0.1:{port}");
    paths::maybe_open_browser(&public);
    axum::serve(listener, app).await?;
    Ok(())
}
