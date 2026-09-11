//! Client HTTP Pocket ID (API admin via X-API-Key) — provisionnement client OIDC.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const DEFAULT_CLIENT_ID: &str = "devforge";

#[derive(Debug, Clone, Default)]
pub struct BrandingUrls {
    /// Logo clair du client OIDC (URL téléchargeable par Pocket ID).
    pub logo_url: Option<String>,
    /// Logo sombre du client OIDC.
    pub dark_logo_url: Option<String>,
    /// Fond d’écran login Pocket ID (application-images/background).
    pub background_url: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ProvisionResult {
    pub client_id: String,
    pub client_secret: Option<String>,
    pub created_client: bool,
    pub created_secret: bool,
    pub logo_set: bool,
    pub background_set: bool,
    pub branding_warnings: Vec<String>,
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
    #[serde(rename = "logoUrl", skip_serializing_if = "Option::is_none")]
    logo_url: Option<&'a str>,
    #[serde(rename = "darkLogoUrl", skip_serializing_if = "Option::is_none")]
    dark_logo_url: Option<&'a str>,
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
    logo_url: Option<&'a str>,
    dark_logo_url: Option<&'a str>,
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
        logo_url,
        dark_logo_url,
    }
}

/// Logo public DevForge à partir de l’URL d’instance (favicon.svg).
pub fn default_logo_url(instance_url: &str) -> Option<String> {
    let origin = instance_url.trim().trim_end_matches('/');
    if origin.is_empty() {
        None
    } else {
        Some(format!("{origin}/favicon.svg"))
    }
}

async fn create_client(
    base: &str,
    api_key: &str,
    client_id: &str,
    callbacks: &[String],
    launch_url: Option<&str>,
    logo_url: Option<&str>,
    dark_logo_url: Option<&str>,
) -> Result<ClientDto, PocketIdError> {
    let url = format!("{base}/api/oidc/clients");
    let body = serde_json::to_value(upsert_payload(
        client_id,
        callbacks,
        launch_url,
        logo_url,
        dark_logo_url,
        true,
    ))
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
    logo_url: Option<&str>,
    dark_logo_url: Option<&str>,
) -> Result<(), PocketIdError> {
    let url = format!("{base}/api/oidc/clients/{client_id}");
    let body = serde_json::to_value(upsert_payload(
        client_id,
        callbacks,
        launch_url,
        logo_url,
        dark_logo_url,
        false,
    ))
    .map_err(|e| PocketIdError::msg(e.to_string()))?;
    let (status, val) = request_json(reqwest::Method::PUT, &url, api_key, Some(body)).await?;
    if !(200..300).contains(&status) {
        return Err(PocketIdError::http(status, &val.to_string()));
    }
    Ok(())
}

fn filename_from_url_and_ctype(url: &str, content_type: &str) -> String {
    let from_url = url
        .rsplit('/')
        .next()
        .unwrap_or("")
        .split('?')
        .next()
        .unwrap_or("")
        .trim();
    if from_url.contains('.') && from_url.len() < 120 {
        return from_url.to_string();
    }
    let ext = if content_type.contains("svg") {
        "svg"
    } else if content_type.contains("webp") {
        "webp"
    } else if content_type.contains("png") {
        "png"
    } else if content_type.contains("jpeg") || content_type.contains("jpg") {
        "jpg"
    } else {
        "bin"
    };
    format!("background.{ext}")
}

/// Télécharge une image puis l’upload en fond Pocket ID (multipart).
async fn upload_background_from_url(
    base: &str,
    api_key: &str,
    image_url: &str,
) -> Result<(), PocketIdError> {
    let url = image_url.trim();
    if url.is_empty() {
        return Err(PocketIdError::msg("URL fond manquante"));
    }
    let client = http();
    let res = client
        .get(url)
        .send()
        .await
        .map_err(|e| PocketIdError::msg(format!("Téléchargement fond KO: {e}")))?;
    if !res.status().is_success() {
        return Err(PocketIdError::msg(format!(
            "Téléchargement fond HTTP {}",
            res.status().as_u16()
        )));
    }
    let ctype = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let bytes = res
        .bytes()
        .await
        .map_err(|e| PocketIdError::msg(format!("Lecture fond KO: {e}")))?;
    if bytes.is_empty() {
        return Err(PocketIdError::msg("Image de fond vide"));
    }
    if bytes.len() > 8 * 1024 * 1024 {
        return Err(PocketIdError::msg("Image de fond trop volumineuse (>8 Mo)"));
    }
    let filename = filename_from_url_and_ctype(url, &ctype);
    let data = bytes.to_vec();
    let part = match reqwest::multipart::Part::bytes(data.clone())
        .file_name(filename.clone())
        .mime_str(&ctype)
    {
        Ok(p) => p,
        Err(_) => reqwest::multipart::Part::bytes(data).file_name(filename),
    };
    let form = reqwest::multipart::Form::new().part("file", part);
    let put_url = format!("{base}/api/application-images/background");
    let put = client
        .put(&put_url)
        .header("X-API-Key", api_key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| PocketIdError::msg(format!("Upload fond Pocket ID KO: {e}")))?;
    let status = put.status().as_u16();
    if !(200..300).contains(&status) {
        let body = put.text().await.unwrap_or_default();
        return Err(PocketIdError::http(status, &body));
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
    branding: &BrandingUrls,
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

    let logo = branding
        .logo_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let dark_logo = branding
        .dark_logo_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .or(logo);

    let existing = get_client(&base, key, id).await?;
    let created_client = if let Some(c) = existing {
        update_client(
            &base,
            key,
            &c.id,
            callback_urls,
            launch_url,
            logo,
            dark_logo,
        )
        .await?;
        false
    } else {
        let _ = create_client(
            &base,
            key,
            id,
            callback_urls,
            launch_url,
            logo,
            dark_logo,
        )
        .await?;
        true
    };

    let logo_set = logo.is_some();
    let mut branding_warnings = Vec::new();

    let (client_secret, created_secret) = if need_secret {
        let secret = create_secret(&base, key, id).await?;
        (Some(secret), true)
    } else {
        (None, false)
    };

    let mut background_set = false;
    if let Some(bg) = branding
        .background_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        match upload_background_from_url(&base, key, bg).await {
            Ok(()) => background_set = true,
            Err(e) => branding_warnings.push(format!("Fond: {e}")),
        }
    }

    Ok(ProvisionResult {
        client_id: id.to_string(),
        client_secret,
        created_client,
        created_secret,
        logo_set,
        background_set,
        branding_warnings,
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

    #[test]
    fn default_logo_from_instance() {
        assert_eq!(
            default_logo_url("https://forge.example.com/"),
            Some("https://forge.example.com/favicon.svg".into())
        );
        assert_eq!(default_logo_url(""), None);
    }
}
