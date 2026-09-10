use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogField {
    pub key: String,
    pub label: String,
    pub placeholder: Option<String>,
    pub secret: bool,
    pub required: bool,
    pub help: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogPreset {
    pub id: String,
    pub name: String,
    pub description: String,
    /// `local` | `cloud`
    pub category: String,
    pub docs_url: Option<String>,
    pub default_url: Option<String>,
    /// Driver technique : ollama | openai | openrouter | gemini | anthropic
    pub provider: String,
    pub fields: Vec<CatalogField>,
    pub popular: bool,
    pub icon_domain: Option<String>,
}

fn field(
    key: &str,
    label: &str,
    secret: bool,
    required: bool,
    placeholder: Option<&str>,
    help: Option<&str>,
) -> CatalogField {
    CatalogField {
        key: key.into(),
        label: label.into(),
        placeholder: placeholder.map(str::to_string),
        secret,
        required,
        help: help.map(str::to_string),
    }
}

/// Catalogue LLM — UX simple type MCP (cartes + modal config).
pub fn catalog() -> Vec<CatalogPreset> {
    vec![
        CatalogPreset {
            id: "ollama".into(),
            name: "Ollama".into(),
            description: "Modèles locaux sur ta machine ou ton NAS. Pas de clé API.".into(),
            category: "local".into(),
            docs_url: Some("https://ollama.com".into()),
            default_url: Some("http://127.0.0.1:11434".into()),
            provider: "ollama".into(),
            fields: vec![
                field(
                    "base_url",
                    "URL Ollama",
                    false,
                    true,
                    Some("http://127.0.0.1:11434"),
                    Some("Ou IP LAN (ex. http://10.1.0.88:11434)"),
                ),
                field(
                    "model",
                    "Modèle",
                    false,
                    false,
                    Some("auto"),
                    Some("Laisse vide / auto, ou choisis après « Charger »"),
                ),
            ],
            popular: true,
            icon_domain: Some("ollama.com".into()),
        },
        CatalogPreset {
            id: "openai".into(),
            name: "ChatGPT / OpenAI".into(),
            description: "GPT-4o, o-series… Clé API OpenAI.".into(),
            category: "cloud".into(),
            docs_url: Some("https://platform.openai.com/api-keys".into()),
            default_url: Some("https://api.openai.com/v1".into()),
            provider: "openai".into(),
            fields: vec![
                field(
                    "api_key",
                    "Clé API",
                    true,
                    true,
                    Some("sk-…"),
                    Some("platform.openai.com → API keys"),
                ),
                field(
                    "base_url",
                    "URL (optionnel)",
                    false,
                    false,
                    Some("https://api.openai.com/v1"),
                    Some("Proxy / Azure / LiteLLM compatible OpenAI"),
                ),
                field(
                    "model",
                    "Modèle",
                    false,
                    false,
                    Some("gpt-4o-mini"),
                    Some("Ou « auto » — charge la liste après la clé"),
                ),
            ],
            popular: true,
            icon_domain: Some("openai.com".into()),
        },
        CatalogPreset {
            id: "gemini".into(),
            name: "Gemini".into(),
            description: "Google Gemini via l’API compatible OpenAI.".into(),
            category: "cloud".into(),
            docs_url: Some("https://aistudio.google.com/apikey".into()),
            default_url: Some(
                "https://generativelanguage.googleapis.com/v1beta/openai".into(),
            ),
            provider: "gemini".into(),
            fields: vec![
                field(
                    "api_key",
                    "Clé API Google",
                    true,
                    true,
                    Some("AIza…"),
                    Some("Google AI Studio → Get API key"),
                ),
                field(
                    "model",
                    "Modèle",
                    false,
                    false,
                    Some("gemini-2.5-flash"),
                    None,
                ),
            ],
            popular: true,
            icon_domain: Some("google.com".into()),
        },
        CatalogPreset {
            id: "openrouter".into(),
            name: "OpenRouter".into(),
            description: "Un seul endpoint pour GPT, Claude, Gemini, Llama…".into(),
            category: "cloud".into(),
            docs_url: Some("https://openrouter.ai/keys".into()),
            default_url: Some("https://openrouter.ai/api/v1".into()),
            provider: "openrouter".into(),
            fields: vec![
                field(
                    "api_key",
                    "Clé API",
                    true,
                    true,
                    Some("sk-or-…"),
                    Some("openrouter.ai → Keys"),
                ),
                field(
                    "model",
                    "Modèle",
                    false,
                    false,
                    Some("openai/gpt-4o-mini"),
                    Some("Ex. anthropic/claude-sonnet-4, google/gemini-2.5-flash"),
                ),
            ],
            popular: true,
            icon_domain: Some("openrouter.ai".into()),
        },
        CatalogPreset {
            id: "anthropic".into(),
            name: "Claude (Anthropic)".into(),
            description: "Claude via proxy OpenAI-compat (OpenRouter / LiteLLM). Ou utilise la carte OpenRouter.".into(),
            category: "cloud".into(),
            docs_url: Some("https://console.anthropic.com/".into()),
            default_url: Some("https://api.anthropic.com/v1".into()),
            provider: "anthropic".into(),
            fields: vec![
                field(
                    "api_key",
                    "Clé API",
                    true,
                    true,
                    Some("sk-ant-…"),
                    Some("Ou utilise OpenRouter avec un modèle anthropic/…"),
                ),
                field(
                    "base_url",
                    "URL proxy OpenAI-compat (optionnel)",
                    false,
                    false,
                    Some("https://openrouter.ai/api/v1"),
                    Some("Si tu pointes OpenRouter / LiteLLM, mets la clé OR ici"),
                ),
                field(
                    "model",
                    "Modèle",
                    false,
                    false,
                    Some("anthropic/claude-sonnet-4"),
                    None,
                ),
            ],
            popular: false,
            icon_domain: Some("anthropic.com".into()),
        },
        CatalogPreset {
            id: "custom".into(),
            name: "Endpoint custom".into(),
            description: "LiteLLM, vLLM, LM Studio, Azure… tout endpoint /v1 compatible OpenAI.".into(),
            category: "local".into(),
            docs_url: None,
            default_url: Some("http://127.0.0.1:4000/v1".into()),
            provider: "openai".into(),
            fields: vec![
                field(
                    "base_url",
                    "URL de l’API",
                    false,
                    true,
                    Some("http://10.1.0.88:11436/v1"),
                    None,
                ),
                field(
                    "api_key",
                    "Clé (si requise)",
                    true,
                    false,
                    Some("sk-…"),
                    None,
                ),
                field(
                    "model",
                    "Modèle",
                    false,
                    false,
                    Some("auto"),
                    None,
                ),
            ],
            popular: false,
            icon_domain: None,
        },
    ]
}

pub fn find_preset(id: &str) -> Option<CatalogPreset> {
    catalog().into_iter().find(|p| p.id == id)
}

pub fn catalog_as_json() -> Value {
    json!({ "data": catalog() })
}
