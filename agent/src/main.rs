use axum::{
    extract::State,
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use rig::completion::Prompt;
use rig::prelude::*;
use rig::providers::openai;
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::Arc;

#[derive(Clone)]
struct AppState {
    provider: String,
    base_url: Option<String>,
    api_key: Option<String>,
    model: String,
}

#[derive(Serialize)]
struct Health {
    ok: bool,
    service: &'static str,
    provider: String,
    model: String,
    configured: bool,
}

#[derive(Deserialize)]
struct ChatRequest {
    prompt: String,
    preamble: Option<String>,
    model: Option<String>,
}

#[derive(Serialize)]
struct ChatResponse {
    text: String,
    model: String,
}

#[derive(Serialize)]
struct ErrorBody {
    error: String,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let listen = std::env::var("AGENT_LISTEN").unwrap_or_else(|_| "0.0.0.0:8090".to_string());
    let state = Arc::new(AppState {
        provider: std::env::var("AGENT_PROVIDER").unwrap_or_else(|_| "openai".to_string()),
        base_url: env_nonempty("AGENT_BASE_URL"),
        api_key: env_nonempty("AGENT_API_KEY"),
        model: std::env::var("AGENT_MODEL").unwrap_or_else(|_| "gpt-4o-mini".to_string()),
    });

    let app = Router::new()
        .route("/health", get(health))
        .route("/v1/chat", post(chat))
        .with_state(state);

    let addr: SocketAddr = listen.parse().expect("AGENT_LISTEN must be host:port");
    tracing::info!("devforge-agent listening on {addr}");
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("bind AGENT_LISTEN");
    axum::serve(listener, app)
        .await
        .expect("server");
}

fn env_nonempty(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn is_configured(state: &AppState) -> bool {
    match state.provider.as_str() {
        "ollama" => state.base_url.is_some(),
        _ => state.api_key.is_some(),
    }
}

async fn health(State(state): State<Arc<AppState>>) -> Json<Health> {
    Json(Health {
        ok: true,
        service: "devforge-agent",
        provider: state.provider.clone(),
        model: state.model.clone(),
        configured: is_configured(&state),
    })
}

async fn chat(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ChatRequest>,
) -> Result<Json<ChatResponse>, (StatusCode, Json<ErrorBody>)> {
    if !is_configured(&state) {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ErrorBody {
                error: "Agent LLM is not configured (set AGENT_API_KEY and/or AGENT_BASE_URL)"
                    .into(),
            }),
        ));
    }

    if body.prompt.trim().is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorBody {
                error: "prompt is required".into(),
            }),
        ));
    }

    let model = body
        .model
        .as_deref()
        .filter(|m| !m.trim().is_empty())
        .unwrap_or(&state.model)
        .to_string();
    let preamble = body
        .preamble
        .clone()
        .unwrap_or_else(|| "You are the DevForge agent runtime (Rig).".to_string());

    if let Some(key) = &state.api_key {
        std::env::set_var("OPENAI_API_KEY", key);
    } else {
        std::env::set_var("OPENAI_API_KEY", "sk-local-devforge-agent");
    }
    if let Some(url) = &state.base_url {
        std::env::set_var("OPENAI_BASE_URL", url);
    }

    let client = openai::Client::from_env().map_err(|e| {
        (
            StatusCode::BAD_GATEWAY,
            Json(ErrorBody {
                error: format!("llm client: {e}"),
            }),
        )
    })?;

    let agent = client.agent(&model).preamble(&preamble).build();
    let text = agent.prompt(&body.prompt).await.map_err(|e| {
        (
            StatusCode::BAD_GATEWAY,
            Json(ErrorBody {
                error: format!("llm: {e}"),
            }),
        )
    })?;

    Ok(Json(ChatResponse { text, model }))
}
