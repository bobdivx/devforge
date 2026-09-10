mod db;
mod auth_routes;
mod backup_routes;
mod detect_svc;
mod infra_routes;
mod infra_sqlite;
mod llm_routes;
mod mcp_routes;
mod routes;
mod security;
mod state;
mod update_routes;

use axum::{routing::get, Json, Router};
use serde_json::{json, Value};
use state::AppState;
use std::net::SocketAddr;
use std::path::PathBuf;
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

    let database_url =
        std::env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite:devforge.db?mode=rwc".into());
    let state = AppState::new(&database_url).await?;

    // Advertise agent tools on the local MCP server surface.
    state
        .mcp
        .server
        .set_tools(state.registry.definitions())
        .await;

    let mut app = Router::new()
        .merge(auth_routes::router())
        .merge(routes::router())
        .merge(infra_routes::router())
        .merge(backup_routes::router())
        .merge(llm_routes::router())
        .merge(mcp_routes::router())
        .merge(update_routes::router())
        .layer(security::cors_layer())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    // Front Astro : DEVFORGE_STATIC_DIR=/app/web (ne pas enregistrer "/" API sinon le SPA est masqué)
    let mut serving_web = false;
    if let Ok(dir) = std::env::var("DEVFORGE_STATIC_DIR") {
        let root = PathBuf::from(&dir);
        if root.is_dir() {
            let index = root.join("index.html");
            tracing::info!(path = %dir, "serving static web assets");
            serving_web = true;
            if index.is_file() {
                app = app.fallback_service(
                    ServeDir::new(&root).not_found_service(ServeFile::new(index)),
                );
            } else {
                app = app.fallback_service(ServeDir::new(&root));
            }
        } else {
            tracing::warn!(path = %dir, "DEVFORGE_STATIC_DIR introuvable — API seule");
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
    axum::serve(listener, app).await?;
    Ok(())
}
