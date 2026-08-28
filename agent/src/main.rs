use axum::{
    extract::State,
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use rig::completion::message::Message;
use rig::completion::Prompt;
use rig::prelude::*;
use rig::providers::openai;
use rmcp::model::{ClientInfo, Implementation};
use rmcp::transport::streamable_http_client::StreamableHttpClientTransportConfig;
use rmcp::transport::StreamableHttpClientTransport;
use rmcp::ServiceExt;
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::Arc;

const DUMMY_OPENAI_KEY: &str = "sk-local-devforge-agent";

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
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct ChatRequest {
    #[serde(default)]
    prompt: String,
    preamble: Option<String>,
    model: Option<String>,
    provider: Option<String>,
    base_url: Option<String>,
    api_key: Option<String>,
    #[serde(default)]
    messages: Vec<ChatMessage>,
    mcp_url: Option<String>,
    mcp_token: Option<String>,
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
        provider: std::env::var("AGENT_PROVIDER").unwrap_or_default(),
        base_url: env_nonempty("AGENT_BASE_URL"),
        api_key: env_nonempty("AGENT_API_KEY"),
        model: std::env::var("AGENT_MODEL").unwrap_or_default(),
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

fn pick_owned(request: Option<&str>, fallback: Option<&str>) -> Option<String> {
    if let Some(value) = request.map(str::trim).filter(|value| !value.is_empty()) {
        return Some(value.to_string());
    }

    fallback
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn is_openai_compat(provider: &str) -> bool {
    matches!(
        provider,
        "ollama" | "openai-compat" | "openai" | "openrouter" | "gemini"
    )
}

fn request_usable(provider: &str, base_url: Option<&str>, api_key: Option<&str>) -> bool {
    let has_key = api_key.map(|key| !key.is_empty()).unwrap_or(false);
    let has_url = base_url.map(|url| !url.is_empty()).unwrap_or(false);

    (is_openai_compat(provider) && has_url) || has_key
}

fn openai_compat_base_url(provider: &str, url: &str) -> String {
    let trimmed = url.trim().trim_end_matches('/');
    if matches!(provider, "ollama" | "openai-compat") && !trimmed.ends_with("/v1") {
        format!("{trimmed}/v1")
    } else {
        trimmed.to_string()
    }
}

fn err(status: StatusCode, message: impl Into<String>) -> (StatusCode, Json<ErrorBody>) {
    (
        status,
        Json(ErrorBody {
            error: message.into(),
        }),
    )
}

fn last_user_prompt(messages: &[ChatMessage]) -> Option<String> {
    messages
        .iter()
        .rev()
        .find(|message| message.role == "user" && !message.content.trim().is_empty())
        .map(|message| message.content.clone())
}

fn history_messages(messages: &[ChatMessage], prompt: &str) -> Vec<Message> {
    let mut history = Vec::new();
    for message in messages {
        let content = message.content.trim();
        if content.is_empty() || message.role == "system" {
            continue;
        }
        if message.role == "user" && content == prompt.trim() {
            continue;
        }
        history.push(if message.role == "assistant" {
            Message::assistant(content)
        } else {
            Message::user(content)
        });
    }
    history
}

async fn health(State(state): State<Arc<AppState>>) -> Json<Health> {
    Json(Health {
        ok: true,
        service: "devforge-agent",
        provider: state.provider.clone(),
        model: state.model.clone(),
        configured: true,
    })
}

async fn chat(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ChatRequest>,
) -> Result<Json<ChatResponse>, (StatusCode, Json<ErrorBody>)> {
    let prompt = if !body.prompt.trim().is_empty() {
        body.prompt.clone()
    } else {
        last_user_prompt(&body.messages).unwrap_or_default()
    };
    if prompt.trim().is_empty() {
        return Err(err(
            StatusCode::BAD_REQUEST,
            "prompt is required (or send messages with a user turn)",
        ));
    }

    let provider = pick_owned(body.provider.as_deref(), Some(state.provider.as_str()))
        .unwrap_or_default();
    let base_url = pick_owned(body.base_url.as_deref(), state.base_url.as_deref());
    let api_key = pick_owned(body.api_key.as_deref(), state.api_key.as_deref());
    let model = pick_owned(body.model.as_deref(), Some(state.model.as_str()));

    if !request_usable(&provider, base_url.as_deref(), api_key.as_deref()) {
        return Err(err(
            StatusCode::BAD_REQUEST,
            "LLM is not configured: send provider+base_url (Ollama / OpenAI-compat) or api_key from DevForge providers",
        ));
    }

    let Some(model) = model else {
        return Err(err(StatusCode::BAD_REQUEST, "model is required"));
    };

    let key = api_key.unwrap_or_else(|| DUMMY_OPENAI_KEY.to_string());
    let url = base_url
        .as_deref()
        .map(|value| openai_compat_base_url(&provider, value));

    let mut builder = openai::Client::builder().api_key(&key);
    if let Some(ref url) = url {
        builder = builder.base_url(url);
    }

    // rig 0.42 openai::Client defaults to the Responses API (/responses).
    // Gemini OpenAI-compat, Ollama, and OpenRouter only implement Chat Completions.
    let client = builder
        .build()
        .map_err(|e| err(StatusCode::BAD_GATEWAY, format!("llm client: {e}")))?
        .completions_api();
    let preamble = body.preamble.clone().unwrap_or_else(|| {
        "You are the DevForge agent runtime (Rig). Use tools when they help.".to_string()
    });
    let history = history_messages(&body.messages, &prompt);

    let mcp_url = body
        .mcp_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let mcp_token = body
        .mcp_token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let text = if let (Some(mcp_url), Some(mcp_token)) = (mcp_url, mcp_token) {
        tracing::info!("connecting MCP at {mcp_url}");
        let config =
            StreamableHttpClientTransportConfig::with_uri(mcp_url.to_string()).auth_header(mcp_token);
        let transport = StreamableHttpClientTransport::from_config(config);
        let mut client_info = ClientInfo::default();
        client_info.client_info =
            Implementation::new("devforge-agent", env!("CARGO_PKG_VERSION"));
        let mcp = client_info
            .serve(transport)
            .await
            .map_err(|e| err(StatusCode::BAD_GATEWAY, format!("mcp connect: {e}")))?;
        let tools = mcp
            .list_tools(Default::default())
            .await
            .map_err(|e| err(StatusCode::BAD_GATEWAY, format!("mcp list_tools: {e}")))?
            .tools;
        let agent = client
            .agent(&model)
            .preamble(&preamble)
            .default_max_turns(40)
            .rmcp_tools(tools, mcp.peer().to_owned())
            .build();
        agent
            .prompt(prompt.as_str())
            .history(history)
            .max_turns(40)
            .await
            .map_err(|e| err(StatusCode::BAD_GATEWAY, format!("llm: {e}")))?
    } else {
        let agent = client.agent(&model).preamble(&preamble).build();
        agent
            .prompt(prompt.as_str())
            .history(history)
            .await
            .map_err(|e| err(StatusCode::BAD_GATEWAY, format!("llm: {e}")))?
    };

    Ok(Json(ChatResponse { text, model }))
}
