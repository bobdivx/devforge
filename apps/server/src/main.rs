mod cluster_routes;
mod cluster_store;
mod db;
mod paths;
mod worker;
mod actions_routes;
mod auto_deploy;
mod auth_routes;
mod backup_routes;
mod cron_routes;
mod detect_svc;
mod git_routes;
mod infra_routes;
mod infra_sqlite;
mod llm_routes;
mod mcp_routes;
mod platform_sso;
#[cfg(test)]
mod platform_sso_tests;
mod routes;
mod runner_routes;
mod runner_store;
mod security;
mod pocket_id;
mod project_oidc;
mod project_oidc_routes;
mod sso;
mod sso_routes;
mod state;
mod token_routes;
mod update_routes;

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
        .with(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
            "devforge_server=debug,tower_http=info".into()
        }))
        .with(tracing_subscriber::fmt::layer())
        .init();
    paths::apply_install_layout();

    let database_url =
        std::env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite:devforge.db?mode=rwc".into());
    let state = AppState::new(&database_url).await?;
    worker::apply_promote_flag(&state).await;
    worker::apply_reclaim_flag(&state).await;

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
    cluster_routes::spawn_snapshot_loop(state.clone());

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

    // Background sync for GitHub runners (Docker + Actions status → SQLite snapshot).
    {
        let worker = state.runners.sync_worker();
        tokio::spawn(async move {
            worker.run_loop().await;
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
            scheduler.run_loop().await;
        });
    }

    // Background scheduler for project cron jobs.
    {
        let scheduler = state.cron_scheduler.clone();
        tokio::spawn(async move {
            scheduler.run_loop().await;
        });
    }

    // Auto-deploy poller: filet si webhook GitHub non configuré sur le repo.
    {
        let state_ad = state.clone();
        tokio::spawn(async move {
            auto_deploy::run_loop(state_ad).await;
        });
    }

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
        .merge(llm_routes::router())
        .merge(mcp_routes::router())
        .merge(runner_routes::router())
        .merge(actions_routes::router())
        .merge(git_routes::router())
        .merge(update_routes::router())
        .merge(cron_routes::router())
        .merge(cluster_routes::router())
        .merge(worker::exec_route())
        .layer(middleware::from_fn_with_state(
            state.clone(),
            token_routes::enforce_api_token_write,
        ))
        .layer(security::cors_layer())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    // Front Astro : dossier `web/` à côté du binaire, ou DEVFORGE_STATIC_DIR (Docker).
    let mut serving_web = false;
    if let Some(root) = paths::web_dir() {
        let index = root.join("index.html");
        tracing::info!(path = %root.display(), "serving static web assets");
        serving_web = true;
        if index.is_file() {
            app = app.fallback_service(
                ServeDir::new(&root).not_found_service(ServeFile::new(index)),
            );
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
