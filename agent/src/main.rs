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
use std::time::Duration;

const DUMMY_OPENAI_KEY: &str = "sk-local-devforge-agent";
const MCP_CONNECT_TIMEOUT: Duration = Duration::from_secs(12);

fn llm_timeout() -> Duration {
    let secs = std::env::var("LLM_TIMEOUT_SECS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(300);
    Duration::from_secs(secs)
}

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

fn url_host(url: Option<&str>) -> String {
    let Some(raw) = url.map(str::trim).filter(|value| !value.is_empty()) else {
        return "unknown".to_string();
    };
    let rest = raw.split("://").nth(1).unwrap_or(raw);
    let hostport = rest.split('/').next().unwrap_or(rest);
    let hostport = hostport.split('@').next_back().unwrap_or(hostport);
    if hostport.is_empty() {
        "unknown".to_string()
    } else {
        hostport.to_string()
    }
}

fn sanitize_error(raw: &str) -> String {
    let mut value = raw.replace('\n', " ");
    if let Some(idx) = value.find("Bearer ") {
        value = format!("{}Bearer [redacted]", &value[..idx]);
    }
    for needle in ["sk-", "AIza", "api_key=", "api-key="] {
        if let Some(idx) = value.find(needle) {
            value = format!("{}[redacted]", &value[..idx]);
            break;
        }
    }
    value.chars().take(400).collect()
}


fn parse_text_tool_call(text: &str) -> Option<(String, serde_json::Value)> {
    let trimmed = text.trim();
    let candidate = trimmed.strip_prefix("{}").map(str::trim).unwrap_or(trimmed);
    if let Some(parsed) = decode_tool_object(candidate) {
        return Some(parsed);
    }
    let start = candidate.find(r#"{"name""#)?;
    let slice = &candidate[start..];
    decode_tool_object(slice)
}

fn decode_tool_object(raw: &str) -> Option<(String, serde_json::Value)> {
    let value: serde_json::Value = serde_json::from_str(raw).ok()?;
    let name = value.get("name")?.as_str()?.trim().to_string();
    if name.is_empty() {
        return None;
    }
    let arguments = value
        .get("arguments")
        .cloned()
        .or_else(|| value.get("parameters").cloned())
        .unwrap_or_else(|| serde_json::json!({}));
    Some((name, arguments))
}

fn is_empty_completion(raw: &str) -> bool {
    let lower = raw.to_lowercase();
    (lower.contains("no message or tool call") && lower.contains("empty"))
        || lower.contains("no content provided")
        || lower.contains("response contained no message")
}

fn err(status: StatusCode, message: impl Into<String>) -> (StatusCode, Json<ErrorBody>) {
    (
        status,
        Json(ErrorBody {
            error: message.into(),
        }),
    )
}

fn llm_gateway_error(raw: &str, host: &str) -> (StatusCode, Json<ErrorBody>) {
    let sanitized = sanitize_error(raw);
    let lower = sanitized.to_lowercase();
    let hint = if lower.contains("502")
        || lower.contains("bad gateway")
        || lower.contains("cloudflare")
        || lower.contains("error code: 502")
    {
        " Cloudflare/tunnels often break Ollama /v1/chat/completions — use a LAN IP (e.g. http://10.1.0.58:11434) or Docker DNS (host.docker.internal)."
    } else if lower.contains("timed out")
        || lower.contains("timeout")
        || lower.contains("error sending request")
        || lower.contains("connection")
        || lower.contains("connect")
        || lower.contains("dns")
    {
        " Check that the sidecar can reach this host (LAN IP or host.docker.internal, not a public HTTPS tunnel)."
    } else if is_empty_completion(&sanitized) {
        " Le modèle a renvoyé une réponse vide (petit modèle local + trop d'outils MCP). Réessayez avec Demeter (RTX 3090) ou un modèle plus gros."
    } else {
        ""
    };
    err(
        StatusCode::BAD_GATEWAY,
        format!("LLM error from {host}: {sanitized}.{hint}"),
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
    let host = url_host(url.as_deref());

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
        let mcp_host = url_host(Some(mcp_url));
        let config =
            StreamableHttpClientTransportConfig::with_uri(mcp_url.to_string()).auth_header(mcp_token);
        let transport = StreamableHttpClientTransport::from_config(config);
        let mut client_info = ClientInfo::default();
        client_info.client_info =
            Implementation::new("devforge-agent", env!("CARGO_PKG_VERSION"));
        let mcp = match tokio::time::timeout(MCP_CONNECT_TIMEOUT, client_info.serve(transport)).await
        {
            Err(_) => {
                return Err(err(
                    StatusCode::BAD_GATEWAY,
                    format!(
                        "MCP connect timeout after {}s to {mcp_host}",
                        MCP_CONNECT_TIMEOUT.as_secs()
                    ),
                ));
            }
            Ok(Err(e)) => {
                return Err(err(
                    StatusCode::BAD_GATEWAY,
                    format!(
                        "mcp connect to {mcp_host}: {}",
                        sanitize_error(&e.to_string())
                    ),
                ));
            }
            Ok(Ok(mcp)) => mcp,
        };
        let tools = match tokio::time::timeout(
            MCP_CONNECT_TIMEOUT,
            mcp.list_tools(Default::default()),
        )
        .await
        {
            Err(_) => {
                return Err(err(
                    StatusCode::BAD_GATEWAY,
                    format!(
                        "MCP list_tools timeout after {}s at {mcp_host}",
                        MCP_CONNECT_TIMEOUT.as_secs()
                    ),
                ));
            }
            Ok(Err(e)) => {
                return Err(err(
                    StatusCode::BAD_GATEWAY,
                    format!(
                        "mcp list_tools at {mcp_host}: {}",
                        sanitize_error(&e.to_string())
                    ),
                ));
            }
            Ok(Ok(list)) => list.tools,
        };
        let agent = client
            .agent(&model)
            .preamble(&preamble)
            .default_max_turns(40)
            .rmcp_tools(tools, mcp.peer().to_owned())
            .build();
        let timeout_duration = llm_timeout();
        match tokio::time::timeout(
            timeout_duration,
            agent
                .prompt(prompt.as_str())
                .history(history_messages(&body.messages, &prompt))
                .max_turns(40),
        )
        .await
        {
            Err(_) => {
                return Err(err(
                    StatusCode::BAD_GATEWAY,
                    format!(
                        "LLM timeout after {}s contacting {host}",
                        timeout_duration.as_secs()
                    ),
                ));
            }
            Ok(Ok(text)) => text,
            Ok(Err(e)) => {
                let raw = e.to_string();
                if !is_empty_completion(&raw) {
                    return Err(llm_gateway_error(&raw, &host));
                }
                tracing::warn!(
                    "empty completion with MCP tools on {host}, retrying without tools"
                );
                let plain = client.agent(&model).preamble(&preamble).build();
                match tokio::time::timeout(
                    timeout_duration,
                    plain
                        .prompt(prompt.as_str())
                        .history(history_messages(&body.messages, &prompt)),
                )
                .await
                {
                    Err(_) => {
                        return Err(err(
                            StatusCode::BAD_GATEWAY,
                            format!(
                                "LLM timeout after {}s contacting {host}",
                                timeout_duration.as_secs()
                            ),
                        ));
                    }
                    Ok(Err(e2)) => return Err(llm_gateway_error(&e2.to_string(), &host)),
                    Ok(Ok(text)) => text,
                }
            }
        }
    } else {
        let timeout_duration = llm_timeout();
        let agent = client.agent(&model).preamble(&preamble).build();
        match tokio::time::timeout(timeout_duration, agent.prompt(prompt.as_str()).history(history)).await
        {
            Err(_) => {
                return Err(err(
                    StatusCode::BAD_GATEWAY,
                    format!(
                        "LLM timeout after {}s contacting {host}",
                        timeout_duration.as_secs()
                    ),
                ));
            }
            Ok(Err(e)) => return Err(llm_gateway_error(&e.to_string(), &host)),
            Ok(Ok(text)) => text,
        }
    };

    Ok(Json(ChatResponse { text, model }))
}

#[cfg(test)]
mod tests {
    use super::{is_empty_completion, parse_text_tool_call};

    #[test]
    fn parses_qwen_prefixed_text_tool_call() {
        let parsed = parse_text_tool_call(r#"{}{"name": "list_github_apps","arguments": {}}"#)
            .expect("tool call");
        assert_eq!(parsed.0, "list_github_apps");
        assert_eq!(parsed.1, serde_json::json!({}));
        assert!(parse_text_tool_call("Voici les apps GitHub.").is_none());
    }

    #[test]
    fn detects_rig_empty_tool_response() {
        assert!(is_empty_completion(
            "CompletionError: ResponseError: Response contained no message or tool call (empty)."
        ));
        assert!(is_empty_completion("No content provided"));
        assert!(!is_empty_completion("LLM timeout after 60s contacting 10.1.0.58:11434"));
        assert!(!is_empty_completion("model is required"));
    }
}
