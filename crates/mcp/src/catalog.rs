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
    pub category: String,
    pub docs_url: Option<String>,
    pub default_url: Option<String>,
    pub fields: Vec<CatalogField>,
    /// e.g. "database" — enables resource linking UI
    pub resource_kind: Option<String>,
    pub popular: bool,
    /// Guide affiché dans le modal de config (étapes jeton, scopes, pièges).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub setup_notes: Option<String>,
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

/// Catalogue MCP / intégrations utiles pour DevForge.
pub fn catalog() -> Vec<CatalogPreset> {
    vec![
        CatalogPreset {
            id: "turso".into(),
            name: "Turso".into(),
            description:
                "Bases libSQL edge. Liste tes DBs et relie-les à un projet (env DATABASE_URL)."
                    .into(),
            category: "database".into(),
            docs_url: Some("https://docs.turso.tech/integrations/mcp".into()),
            // Hosted MCP Turso (OAuth). L’ancien host mcp.turso.tech ne résout plus.
            // Le token Platform sert surtout à lier des DBs via l’API Turso (resources).
            default_url: Some("https://mcp.turso.ai/mcp".into()),
            fields: vec![
                field(
                    "api_token",
                    "Platform API Token",
                    true,
                    true,
                    Some("eyJ…"),
                    Some(
                        "Turso → Account → API Tokens. Sert à lister/lier les DBs. Les tools MCP hébergés exigent OAuth (pas le token Platform).",
                    ),
                ),
                field(
                    "org",
                    "Organization slug",
                    false,
                    true,
                    Some("mon-org"),
                    Some("Slug affiché dans le dashboard Turso"),
                ),
            ],
            resource_kind: Some("database".into()),
            popular: true,
        setup_notes: None,
        },
        CatalogPreset {
            id: "cloudflare".into(),
            name: "Cloudflare".into(),
            description:
                "DNS, Tunnel, Workers, R2 — MCP officiel. Pour publier les apps DevForge : jeton à droits minimaux (Tunnel + DNS)."
                    .into(),
            category: "infrastructure".into(),
            docs_url: Some(
                "https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/"
                    .into(),
            ),
            default_url: Some("https://mcp.cloudflare.com/mcp".into()),
            fields: vec![
                field(
                    "api_token",
                    "API Token",
                    true,
                    true,
                    Some("cfat_…"),
                    Some(
                        "Profil → API Tokens → Create Token (Custom). Pas un jeton « compte entier ». Copie-le une seule fois.",
                    ),
                ),
                field(
                    "account_id",
                    "Account ID",
                    false,
                    false,
                    Some("32 hex chars"),
                    Some(
                        "Dashboard Cloudflare → barre latérale droite / overview du compte. Affiché aussi après création du jeton.",
                    ),
                ),
                field(
                    "url",
                    "URL MCP",
                    false,
                    false,
                    Some("https://mcp.cloudflare.com/mcp"),
                    Some("Laisser la valeur par défaut sauf MCP self-host."),
                ),
            ],
            resource_kind: None,
            popular: true,
            setup_notes: Some(
                "Créer le jeton (droits minimaux)\n\
• Cloudflare → My Profile → API Tokens → Create Token → Custom token\n\
• Account → Cloudflare Tunnel → Edit\n\
• Account → Account Settings → Read (optionnel)\n\
• Zone → DNS → Edit\n\
• Zone → Zone → Read\n\
• Zone Resources : seulement tes zones apps (ex. jeser.app), pas « All zones »\n\
• Client IP Filtering : laisser vide (sinon le NAS / MCP hébergé sera bloqué)\n\
• Ne colle jamais le jeton dans un chat / ticket / commit\n\
\n\
Dans ce formulaire\n\
• API Token = Bearer cfat_… (secret)\n\
• Account ID = id du compte (pas secret)\n\
• Les clés S3/R2 affichées à la création du jeton ne sont PAS nécessaires ici"
                    .into(),
            ),
        },
        CatalogPreset {
            id: "vercel".into(),
            name: "Vercel".into(),
            description: "Déploiements, projets et domaines — MCP officiel Vercel (OAuth)."
                .into(),
            category: "infrastructure".into(),
            docs_url: Some("https://vercel.com/docs/agent-resources/vercel-mcp".into()),
            default_url: Some("https://mcp.vercel.com".into()),
            fields: vec![
                field(
                    "api_token",
                    "Access Token (optionnel)",
                    true,
                    false,
                    Some("…"),
                    Some("Le MCP hébergé utilise surtout OAuth ; un token API peut ne pas suffire pour tools/list."),
                ),
                field(
                    "team_id",
                    "Team ID (optionnel)",
                    false,
                    false,
                    Some("team_…"),
                    None,
                ),
                field(
                    "url",
                    "URL MCP",
                    false,
                    false,
                    Some("https://mcp.vercel.com"),
                    Some("Pas de suffixe /mcp — endpoint officiel Vercel"),
                ),
            ],
            resource_kind: None,
            popular: true,
        setup_notes: None,
        },
        CatalogPreset {
            id: "supabase".into(),
            name: "Supabase".into(),
            description: "Postgres, Auth et Storage — MCP officiel Supabase.".into(),
            category: "database".into(),
            docs_url: Some("https://supabase.com/docs/guides/getting-started/mcp".into()),
            default_url: Some("https://mcp.supabase.com/mcp".into()),
            fields: vec![
                field(
                    "access_token",
                    "Personal Access Token",
                    true,
                    true,
                    Some("sbp_…"),
                    Some("Supabase → Account → Access Tokens. OAuth possible via le dashboard MCP."),
                ),
                field(
                    "project_ref",
                    "Project ref (optionnel)",
                    false,
                    false,
                    Some("abcdefghijklmnop"),
                    None,
                ),
                field(
                    "url",
                    "URL MCP",
                    false,
                    false,
                    Some("https://mcp.supabase.com/mcp"),
                    Some("Endpoint hébergé Supabase"),
                ),
            ],
            resource_kind: Some("database".into()),
            popular: true,
        setup_notes: None,
        },
        CatalogPreset {
            id: "neon".into(),
            name: "Neon".into(),
            description: "Postgres serverless — MCP officiel Neon (OAuth / API key).".into(),
            category: "database".into(),
            docs_url: Some("https://neon.tech/docs/ai/neon-mcp-server".into()),
            default_url: Some("https://mcp.neon.tech/mcp".into()),
            fields: vec![
                field(
                    "api_key",
                    "API Key",
                    true,
                    true,
                    Some("napi_…"),
                    Some("Neon Console → Account → API Keys (Bearer). OAuth aussi supporté."),
                ),
                field(
                    "url",
                    "URL MCP",
                    false,
                    false,
                    Some("https://mcp.neon.tech/mcp"),
                    Some("Streamable HTTP ; fallback SSE : https://mcp.neon.tech/sse"),
                ),
            ],
            resource_kind: Some("database".into()),
            popular: true,
        setup_notes: None,
        },
        CatalogPreset {
            id: "upstash".into(),
            name: "Upstash".into(),
            description: "Redis / QStash Upstash.".into(),
            category: "database".into(),
            docs_url: Some("https://upstash.com/docs".into()),
            default_url: None,
            fields: vec![
                field(
                    "api_key",
                    "API Key",
                    true,
                    true,
                    Some("…"),
                    Some("Upstash Console → Account → API Keys"),
                ),
                field(
                    "email",
                    "Account email",
                    false,
                    true,
                    Some("you@example.com"),
                    None,
                ),
                field(
                    "url",
                    "URL MCP (optionnel)",
                    false,
                    false,
                    Some("http://127.0.0.1:3900/mcp"),
                    None,
                ),
            ],
            resource_kind: None,
            popular: false,
        setup_notes: None,
        },
        CatalogPreset {
            id: "slack".into(),
            name: "Slack".into(),
            description: "Notifications, canaux et tools Slack via MCP.".into(),
            category: "messaging".into(),
            docs_url: Some("https://api.slack.com/apps".into()),
            default_url: None,
            fields: vec![
                field(
                    "bot_token",
                    "Bot User OAuth Token",
                    true,
                    true,
                    Some("xoxb-…"),
                    Some("Slack App → OAuth & Permissions"),
                ),
                field(
                    "url",
                    "URL MCP (optionnel)",
                    false,
                    false,
                    Some("http://127.0.0.1:3100/mcp"),
                    Some("Si tu exposes un serveur MCP Slack local ou distant"),
                ),
            ],
            resource_kind: None,
            popular: true,
        setup_notes: None,
        },
        CatalogPreset {
            id: "linear".into(),
            name: "Linear".into(),
            description: "Issues et projets — MCP officiel Linear (OAuth / API key).".into(),
            category: "productivity".into(),
            docs_url: Some("https://linear.app/docs/mcp".into()),
            default_url: Some("https://mcp.linear.app/mcp".into()),
            fields: vec![
                field(
                    "api_key",
                    "API Key",
                    true,
                    true,
                    Some("lin_api_…"),
                    Some("Linear → Settings → API. Le MCP hébergé peut exiger OAuth."),
                ),
                field(
                    "url",
                    "URL MCP",
                    false,
                    false,
                    Some("https://mcp.linear.app/mcp"),
                    Some("Endpoint hébergé Linear"),
                ),
            ],
            resource_kind: None,
            popular: true,
        setup_notes: None,
        },
        CatalogPreset {
            id: "sentry".into(),
            name: "Sentry".into(),
            description: "Erreurs et releases — MCP officiel Sentry (OAuth).".into(),
            category: "observability".into(),
            docs_url: Some("https://docs.sentry.io/product/sentry-mcp/".into()),
            default_url: Some("https://mcp.sentry.dev/mcp".into()),
            fields: vec![
                field(
                    "auth_token",
                    "Auth Token (optionnel)",
                    true,
                    false,
                    Some("sntrys_…"),
                    Some("Le MCP hébergé utilise surtout OAuth."),
                ),
                field("org", "Organization slug", false, true, Some("mon-org"), None),
                field(
                    "url",
                    "URL MCP",
                    false,
                    false,
                    Some("https://mcp.sentry.dev/mcp"),
                    Some("Endpoint hébergé Sentry"),
                ),
            ],
            resource_kind: None,
            popular: true,
        setup_notes: None,
        },
        CatalogPreset {
            id: "resend".into(),
            name: "Resend".into(),
            description: "Envoi d’emails transactionnels.".into(),
            category: "messaging".into(),
            docs_url: Some("https://resend.com/docs".into()),
            default_url: None,
            fields: vec![
                field(
                    "api_key",
                    "API Key",
                    true,
                    true,
                    Some("re_…"),
                    Some("Resend → API Keys"),
                ),
                field(
                    "url",
                    "URL MCP (optionnel)",
                    false,
                    false,
                    Some("http://127.0.0.1:4000/mcp"),
                    None,
                ),
            ],
            resource_kind: None,
            popular: false,
        setup_notes: None,
        },
        CatalogPreset {
            id: "posthog".into(),
            name: "PostHog".into(),
            description: "Product analytics — MCP officiel PostHog.".into(),
            category: "observability".into(),
            docs_url: Some("https://posthog.com/docs/model-context-protocol".into()),
            default_url: Some("https://mcp.posthog.com/mcp".into()),
            fields: vec![
                field(
                    "api_key",
                    "Personal API Key",
                    true,
                    true,
                    Some("phx_…"),
                    Some("PostHog → Settings → Personal API Keys"),
                ),
                field(
                    "host",
                    "Host",
                    false,
                    false,
                    Some("https://eu.posthog.com"),
                    Some("US ou EU selon ton projet"),
                ),
                field(
                    "url",
                    "URL MCP",
                    false,
                    false,
                    Some("https://mcp.posthog.com/mcp"),
                    Some("Endpoint hébergé PostHog"),
                ),
            ],
            resource_kind: None,
            popular: false,
        setup_notes: None,
        },
        CatalogPreset {
            id: "discord".into(),
            name: "Discord".into(),
            description: "Bots et notifications Discord.".into(),
            category: "messaging".into(),
            docs_url: Some("https://discord.com/developers/docs".into()),
            default_url: None,
            fields: vec![
                field(
                    "bot_token",
                    "Bot Token",
                    true,
                    true,
                    Some("…"),
                    Some("Discord Developer Portal → Bot"),
                ),
                field(
                    "url",
                    "URL MCP (optionnel)",
                    false,
                    false,
                    Some("http://127.0.0.1:4200/mcp"),
                    None,
                ),
            ],
            resource_kind: None,
            popular: false,
        setup_notes: None,
        },
        CatalogPreset {
            id: "railway".into(),
            name: "Railway".into(),
            description: "Projets et services Railway.".into(),
            category: "infrastructure".into(),
            docs_url: Some("https://docs.railway.app".into()),
            default_url: None,
            fields: vec![
                field(
                    "api_token",
                    "API Token",
                    true,
                    true,
                    Some("…"),
                    Some("Railway → Account → Tokens"),
                ),
                field(
                    "url",
                    "URL MCP (optionnel)",
                    false,
                    false,
                    Some("http://127.0.0.1:4300/mcp"),
                    None,
                ),
            ],
            resource_kind: None,
            popular: false,
        setup_notes: None,
        },
        CatalogPreset {
            id: "notion".into(),
            name: "Notion".into(),
            description: "Pages et bases — MCP officiel Notion (OAuth).".into(),
            category: "productivity".into(),
            docs_url: Some("https://developers.notion.com/docs/mcp".into()),
            default_url: Some("https://mcp.notion.com/mcp".into()),
            fields: vec![
                field(
                    "integration_token",
                    "Integration Token (optionnel)",
                    true,
                    false,
                    Some("ntn_…"),
                    Some("Le MCP hébergé utilise surtout OAuth."),
                ),
                field(
                    "url",
                    "URL MCP",
                    false,
                    false,
                    Some("https://mcp.notion.com/mcp"),
                    Some("Endpoint hébergé Notion"),
                ),
            ],
            resource_kind: None,
            popular: false,
        setup_notes: None,
        },
        CatalogPreset {
            id: "stripe".into(),
            name: "Stripe".into(),
            description: "Paiements — MCP officiel Stripe (OAuth / secret key).".into(),
            category: "payments".into(),
            docs_url: Some("https://docs.stripe.com/mcp".into()),
            default_url: Some("https://mcp.stripe.com".into()),
            fields: vec![
                field(
                    "secret_key",
                    "Secret Key (optionnel)",
                    true,
                    false,
                    Some("sk_live_… / sk_test_…"),
                    Some("Voir docs.stripe.com/mcp — OAuth recommandé pour le MCP hébergé."),
                ),
                field(
                    "url",
                    "URL MCP",
                    false,
                    false,
                    Some("https://mcp.stripe.com"),
                    Some("Pas de suffixe /mcp"),
                ),
            ],
            resource_kind: None,
            popular: true,
        setup_notes: None,
        },
        CatalogPreset {
            id: "github".into(),
            name: "GitHub MCP".into(),
            description: "Tools GitHub hébergés (Copilot MCP) ou self-host.".into(),
            category: "devops".into(),
            docs_url: Some("https://github.com/github/github-mcp-server".into()),
            default_url: Some("https://api.githubcopilot.com/mcp/".into()),
            fields: vec![
                field(
                    "token",
                    "Personal Access Token",
                    true,
                    true,
                    Some("ghp_… / github_pat_…"),
                    Some("Bearer requis. Le MCP Copilot hébergé attend un token GitHub valide."),
                ),
                field(
                    "url",
                    "URL MCP",
                    false,
                    false,
                    Some("https://api.githubcopilot.com/mcp/"),
                    Some("Hébergé GitHub ; ou ton github-mcp-server self-host"),
                ),
            ],
            resource_kind: None,
            popular: false,
        setup_notes: None,
        },
        CatalogPreset {
            id: "custom".into(),
            name: "MCP custom".into(),
            description: "Brancher n’importe quel serveur MCP HTTP.".into(),
            category: "other".into(),
            docs_url: None,
            default_url: None,
            fields: vec![
                field("name", "Nom", false, true, Some("Mon MCP"), None),
                field(
                    "url",
                    "URL",
                    false,
                    true,
                    Some("http://127.0.0.1:9000/mcp"),
                    None,
                ),
                field(
                    "auth_header",
                    "Authorization (optionnel)",
                    true,
                    false,
                    Some("Bearer …"),
                    None,
                ),
            ],
            resource_kind: None,
            popular: false,
        setup_notes: None,
        },
    ]
}

pub fn catalog_as_json() -> Value {
    json!({ "data": catalog() })
}

pub fn find_preset(id: &str) -> Option<CatalogPreset> {
    catalog().into_iter().find(|p| p.id == id)
}
