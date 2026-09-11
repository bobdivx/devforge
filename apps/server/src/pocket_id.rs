//! Client HTTP Pocket ID (API admin via X-API-Key) — provisionnement client OIDC.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const DEFAULT_CLIENT_ID: &str = "devforge";

#[derive(Debug, Clone)]
pub struct ProvisionResult {
    pub client_id: String,
    pub client_secret: Option<String>,
    pub created_client: bool,
    pub created_secret: bool,
}

#[derive(Debug)]
pub struct PocketIdError {
    pub message: String,
    pub status: Option<u16>,
}

impl std::fmt::Display for PocketIdError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl PocketIdError {
    fn msg(s: impl Into<String>) -> Self {
        Self {
            message: s.into(),
            status: None,
        }
    }

    fn http(status: u16, body: &str) -> Self {
        let snippet = body.chars().take(240).collect::<String>();
        Self {
            message: if snippet.is_empty() {
                format!("Pocket ID HTTP {status}")
            } else {
                format!("Pocket ID HTTP {status}: {snippet}")
            },
            status: Some(status),
        }
    }
}

#[derive(Debug, Deserialize)]
struct ClientDto {
    id: String,
}

#[derive(Debug, Deserialize)]
struct SecretCreatedDto {
    secret: Option<String>,
}

#[derive(Debug, Serialize)]
struct ClientUpsertBody<'a> {
    name: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<&'a str>,
    #[serde(rename = "callbackURLs")]
    callback_urls: &'a [String],
    #[serde(rename = "logoutCallbackURLs")]
    logout_callback_urls: &'a [String],
    #[serde(rename = "isPublic")]
    is_public: bool,
    #[serde(rename = "pkceEnabled")]
    pkce_enabled: bool,
    #[serde(rename = "requiresReauthentication")]
    requires_reauthentication: bool,
    #[serde(rename = "launchURL", skip_serializing_if = "Option::is_none")]
    launch_url: Option<&'a str>,
    description: &'a str,
}

fn http() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

fn normalize_base(url: &str) -> String {
    url.trim().trim_end_matches('/').to_string()
}

/// Construit les callbacks wildcard à partir du domaine apps DevForge.
pub fn default_callback_urls(wildcard_domain: &str, instance_url: &str) -> Vec<String> {
    let mut urls = Vec::new();
    let domain = wildcard_domain
        .trim()
        .trim_start_matches('.')
        .to_lowercase();
    if !domain.is_empty() {
        urls.push(format!(
            "https://*.{domain}/api/auth/callback/pocket-id"
        ));
        urls.push(format!("https://*.{domain}/oauth2/callback"));
        urls.push(format!("https://*.{domain}/oauth2/callback/"));
    }
    let origin = instance_url.trim().trim_end_matches('/');
    if !origin.is_empty() {
        urls.push(format!("{origin}/api/auth/callback/pocket-id"));
        urls.push(format!("{origin}/api/auth/callback/pocket-id/"));
    }
    urls
}

async fn request_json(
    method: reqwest::Method,
    url: &str,
    api_key: &str,
    body: Option<Value>,
) -> Result<(u16, Value), PocketIdError> {
    let client = http();
    let mut req = client
        .request(method, url)
        .header("X-API-Key", api_key)
        .header("Accept", "application/json");
    if let Some(b) = body {
        req = req.json(&b);
    }
    let res = req
        .send()
        .await
        .map_err(|e| PocketIdError::msg(format!("Pocket ID injoignable: {e}")))?;
    let status = res.status().as_u16();
    let text = res.text().await.unwrap_or_default();
    if text.trim().is_empty() {
        return Ok((status, Value::Null));
    }
    let val = serde_json::from_str(&text).unwrap_or(Value::String(text.clone()));
    Ok((status, val))
}

async fn get_client(
    base: &str,
    api_key: &str,
    client_id: &str,
) -> Result<Option<ClientDto>, PocketIdError> {
    let url = format!("{base}/api/oidc/clients/{client_id}");
    let (status, val) = request_json(reqwest::Method::GET, &url, api_key, None).await?;
    if status == 404 {
        return Ok(None);
    }
    if !(200..300).contains(&status) {
        return Err(PocketIdError::http(status, &val.to_string()));
    }
    let client: ClientDto = serde_json::from_value(val)
        .map_err(|e| PocketIdError::msg(format!("Réponse client invalide: {e}")))?;
    Ok(Some(client))
}

fn upsert_payload<'a>(
    client_id: &'a str,
    callbacks: &'a [String],
    launch_url: Option<&'a str>,
    include_id: bool,
) -> ClientUpsertBody<'a> {
    ClientUpsertBody {
        name: "DevForge",
        id: if include_id { Some(client_id) } else { None },
        callback_urls: callbacks,
        logout_callback_urls: &[],
        is_public: false,
        pkce_enabled: true,
        requires_reauthentication: false,
        launch_url,
        description: "Client OIDC provisionné par DevForge",
    }
}

async fn create_client(
    base: &str,
    api_key: &str,
    client_id: &str,
    callbacks: &[String],
    launch_url: Option<&str>,
) -> Result<ClientDto, PocketIdError> {
    let url = format!("{base}/api/oidc/clients");
    let body = serde_json::to_value(upsert_payload(client_id, callbacks, launch_url, true))
        .map_err(|e| PocketIdError::msg(e.to_string()))?;
    let (status, val) = request_json(reqwest::Method::POST, &url, api_key, Some(body)).await?;
    if !(200..300).contains(&status) {
        return Err(PocketIdError::http(status, &val.to_string()));
    }
    serde_json::from_value(val)
        .map_err(|e| PocketIdError::msg(format!("Réponse create client invalide: {e}")))
}

async fn update_client(
    base: &str,
    api_key: &str,
    client_id: &str,
    callbacks: &[String],
    launch_url: Option<&str>,
) -> Result<(), PocketIdError> {
    let url = format!("{base}/api/oidc/clients/{client_id}");
    let body = serde_json::to_value(upsert_payload(client_id, callbacks, launch_url, false))
        .map_err(|e| PocketIdError::msg(e.to_string()))?;
    let (status, val) = request_json(reqwest::Method::PUT, &url, api_key, Some(body)).await?;
    if !(200..300).contains(&status) {
        return Err(PocketIdError::http(status, &val.to_string()));
    }
    Ok(())
}

async fn create_secret(base: &str, api_key: &str, client_id: &str) -> Result<String, PocketIdError> {
    // Pocket ID récent : /secrets ; versions plus anciennes : /secret
    for path in [
        format!("{base}/api/oidc/clients/{client_id}/secrets"),
        format!("{base}/api/oidc/clients/{client_id}/secret"),
    ] {
        let (status, val) =
            request_json(reqwest::Method::POST, &path, api_key, Some(json!({}))).await?;
        if status == 404 {
            continue;
        }
        if !(200..300).contains(&status) {
            return Err(PocketIdError::http(status, &val.to_string()));
        }
        if let Some(s) = val.get("secret").and_then(|v| v.as_str()) {
            if !s.is_empty() {
                return Ok(s.to_string());
            }
        }
        let parsed: SecretCreatedDto = serde_json::from_value(val.clone()).unwrap_or(SecretCreatedDto {
            secret: None,
        });
        if let Some(s) = parsed.secret.filter(|s| !s.is_empty()) {
            return Ok(s);
        }
        return Err(PocketIdError::msg(
            "Pocket ID a créé un secret sans le renvoyer",
        ));
    }
    Err(PocketIdError::msg(
        "Endpoint secret client introuvable sur cette version Pocket ID",
    ))
}

/// Crée ou met à jour le client OIDC `devforge` et génère un secret si besoin.
pub async fn provision_oidc_client(
    pocket_id_url: &str,
    api_key: &str,
    client_id: &str,
    callback_urls: &[String],
    launch_url: Option<&str>,
    need_secret: bool,
) -> Result<ProvisionResult, PocketIdError> {
    let base = normalize_base(pocket_id_url);
    if base.is_empty() {
        return Err(PocketIdError::msg("URL Pocket ID manquante"));
    }
    let key = api_key.trim();
    if key.is_empty() {
        return Err(PocketIdError::msg("Token API Pocket ID manquant"));
    }
    let id = if client_id.trim().is_empty() {
        DEFAULT_CLIENT_ID
    } else {
        client_id.trim()
    };

    let existing = get_client(&base, key, id).await?;
    let created_client = if let Some(c) = existing {
        update_client(&base, key, &c.id, callback_urls, launch_url).await?;
        false
    } else {
        let _ = create_client(&base, key, id, callback_urls, launch_url).await?;
        true
    };

    let (client_secret, created_secret) = if need_secret {
        let secret = create_secret(&base, key, id).await?;
        (Some(secret), true)
    } else {
        (None, false)
    };

    Ok(ProvisionResult {
        client_id: id.to_string(),
        client_secret,
        created_client,
        created_secret,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn callbacks_from_wildcard() {
        let urls = default_callback_urls("apps.example.com", "https://forge.example.com");
        assert!(urls.iter().any(|u| u.contains("*.apps.example.com")));
        assert!(urls
            .iter()
            .any(|u| u == "https://forge.example.com/api/auth/callback/pocket-id"));
    }
}
