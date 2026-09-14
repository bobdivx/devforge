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
    /// Logo pour les emails (PNG/JPEG uniquement).
    pub email_logo_url: Option<String>,
    /// Image de profil par défaut.
    pub default_profile_picture_url: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ProvisionResult {
    pub client_id: String,
    pub client_secret: Option<String>,
    pub created_client: bool,
    pub created_secret: bool,
    pub logo_set: bool,
    pub logo_light_uploaded: bool,
    pub logo_dark_uploaded: bool,
    pub favicon_uploaded: bool,
    pub background_uploaded: bool,
    pub email_logo_uploaded: bool,
    pub profile_picture_uploaded: bool,
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
        urls.push(format!("{origin}/api/v1/auth/sso/callback"));
        urls.push(format!("{origin}/api/v1/auth/sso/callback/"));
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
    client_name: &'a str,
    client_description: &'a str,
    callbacks: &'a [String],
    launch_url: Option<&'a str>,
    logo_url: Option<&'a str>,
    dark_logo_url: Option<&'a str>,
    include_id: bool,
) -> ClientUpsertBody<'a> {
    ClientUpsertBody {
        name: client_name,
        id: if include_id { Some(client_id) } else { None },
        callback_urls: callbacks,
        logout_callback_urls: &[],
        is_public: false,
        pkce_enabled: true,
        requires_reauthentication: false,
        launch_url,
        description: client_description,
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
    client_name: &str,
    client_description: &str,
    callbacks: &[String],
    launch_url: Option<&str>,
    logo_url: Option<&str>,
    dark_logo_url: Option<&str>,
) -> Result<ClientDto, PocketIdError> {
    let url = format!("{base}/api/oidc/clients");
    let body = serde_json::to_value(upsert_payload(
        client_id,
        client_name,
        client_description,
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
    client_name: &str,
    client_description: &str,
    callbacks: &[String],
    launch_url: Option<&str>,
    logo_url: Option<&str>,
    dark_logo_url: Option<&str>,
) -> Result<(), PocketIdError> {
    let url = format!("{base}/api/oidc/clients/{client_id}");
    let body = serde_json::to_value(upsert_payload(
        client_id,
        client_name,
        client_description,
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
    upload_application_image_from_url(base, api_key, image_url, "background").await
}

/// Télécharge une image puis l'upload vers Pocket ID (multipart).
async fn upload_application_image_from_url(
    base: &str,
    api_key: &str,
    image_url: &str,
    image_type: &str,
    query_params: Option<&[(&str, &str)]>,
) -> Result<(), PocketIdError> {
    let url = image_url.trim();
    if url.is_empty() {
        return Err(PocketIdError::msg(format!("URL {image_type} manquante")));
    }
    let client = http();
    let res = client
        .get(url)
        .send()
        .await
        .map_err(|e| PocketIdError::msg(format!("Téléchargement {image_type} KO: {e}")))?;
    if !res.status().is_success() {
        return Err(PocketIdError::msg(format!(
            "Téléchargement {image_type} HTTP {}",
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
        .map_err(|e| PocketIdError::msg(format!("Lecture {image_type} KO: {e}")))?;
    if bytes.is_empty() {
        return Err(PocketIdError::msg(format!("Image {image_type} vide")));
    }
    if bytes.len() > 8 * 1024 * 1024 {
        return Err(PocketIdError::msg(format!(
            "Image {image_type} trop volumineuse (>8 Mo)"
        )));
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
    let mut put_url = format!("{base}/api/application-images/{image_type}");
    if let Some(params) = query_params {
        let query_str = params
            .iter()
            .map(|(k, v)| format!("{}={}", k, v))
            .collect::<Vec<_>>()
            .join("&");
        if !query_str.is_empty() {
            put_url = format!("{put_url}?{query_str}");
        }
    }
    let put = client
        .put(&put_url)
        .header("X-API-Key", api_key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| PocketIdError::msg(format!("Upload {image_type} Pocket ID KO: {e}")))?;
    let status = put.status().as_u16();
    if !(200..300).contains(&status) {
        let body = put.text().await.unwrap_or_default();
        return Err(PocketIdError::http(status, &body));
    }
    Ok(())
}

/// Télécharge une image puis l'upload en logo light Pocket ID (multipart).
async fn upload_logo_light_from_url(
    base: &str,
    api_key: &str,
    image_url: &str,
) -> Result<(), PocketIdError> {
    upload_application_image_from_url(base, api_key, image_url, "logo", Some(&[("light", "true")])).await
}

/// Télécharge une image puis l'upload en logo dark Pocket ID (multipart).
async fn upload_logo_dark_from_url(
    base: &str,
    api_key: &str,
    image_url: &str,
) -> Result<(), PocketIdError> {
    upload_application_image_from_url(base, api_key, image_url, "logo", Some(&[("light", "false")])).await
}

/// Télécharge une image puis l'upload en favicon Pocket ID (multipart).
async fn upload_favicon_from_url(
    base: &str,
    api_key: &str,
    image_url: &str,
) -> Result<(), PocketIdError> {
    upload_application_image_from_url(base, api_key, image_url, "favicon", None).await
}

/// Télécharge une image puis l'upload en logo email Pocket ID (PNG/JPEG uniquement).
async fn upload_email_logo_from_url(
    base: &str,
    api_key: &str,
    image_url: &str,
) -> Result<(), PocketIdError> {
    upload_application_image_from_url(base, api_key, image_url, "email", None).await
}

/// Télécharge une image puis l'upload en image de profil par défaut Pocket ID.
async fn upload_default_profile_picture_from_url(
    base: &str,
    api_key: &str,
    image_url: &str,
) -> Result<(), PocketIdError> {
    upload_application_image_from_url(base, api_key, image_url, "default-profile-picture", None).await
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

/// Crée ou met à jour un client OIDC et génère un secret si besoin.
pub async fn provision_oidc_client(
    pocket_id_url: &str,
    api_key: &str,
    client_id: &str,
    client_name: &str,
    client_description: &str,
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
            client_name,
            client_description,
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
            client_name,
            client_description,
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

    let mut logo_light_uploaded = false;
    if let Some(lg) = logo {
        match upload_logo_light_from_url(&base, key, lg).await {
            Ok(()) => logo_light_uploaded = true,
            Err(e) => branding_warnings.push(format!("Logo light: {e}")),
        }
    }

    let mut logo_dark_uploaded = false;
    if let Some(dark_lg) = branding
        .dark_logo_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        match upload_logo_dark_from_url(&base, key, dark_lg).await {
            Ok(()) => logo_dark_uploaded = true,
            Err(e) => branding_warnings.push(format!("Logo dark: {e}")),
        }
    }

    let mut favicon_uploaded = false;
    if let Some(fav) = logo {
        match upload_favicon_from_url(&base, key, fav).await {
            Ok(()) => favicon_uploaded = true,
            Err(e) => branding_warnings.push(format!("Favicon: {e}")),
        }
    }

    let mut background_uploaded = false;
    if let Some(bg) = branding
        .background_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        match upload_background_from_url(&base, key, bg).await {
            Ok(()) => background_uploaded = true,
            Err(e) => branding_warnings.push(format!("Fond: {e}")),
        }
    }

    let mut email_logo_uploaded = false;
    if let Some(email_lg) = branding
        .email_logo_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        match upload_email_logo_from_url(&base, key, email_lg).await {
            Ok(()) => email_logo_uploaded = true,
            Err(e) => branding_warnings.push(format!("Logo email: {e}")),
        }
    }

    let mut profile_picture_uploaded = false;
    if let Some(profile_pic) = branding
        .default_profile_picture_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        match upload_default_profile_picture_from_url(&base, key, profile_pic).await {
            Ok(()) => profile_picture_uploaded = true,
            Err(e) => branding_warnings.push(format!("Photo de profil: {e}")),
        }
    }

    Ok(ProvisionResult {
        client_id: id.to_string(),
        client_secret,
        created_client,
        created_secret,
        logo_set,
        logo_light_uploaded,
        logo_dark_uploaded,
        favicon_uploaded,
        background_uploaded,
        email_logo_uploaded,
        profile_picture_uploaded,
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
        assert!(urls
            .iter()
            .any(|u| u == "https://forge.example.com/api/v1/auth/sso/callback"));
        assert!(urls
            .iter()
            .any(|u| u == "https://forge.example.com/api/v1/auth/sso/callback/"));
    }

    #[test]
    fn default_logo_from_instance() {
        assert_eq!(
            default_logo_url("https://forge.example.com/"),
            Some("https://forge.example.com/favicon.svg".into())
        );
        assert_eq!(default_logo_url(""), None);
    }

    #[test]
    fn provision_result_includes_upload_flags() {
        let result = ProvisionResult {
            client_id: "test".into(),
            client_secret: None,
            created_client: false,
            created_secret: false,
            logo_set: true,
            logo_light_uploaded: true,
            logo_dark_uploaded: true,
            favicon_uploaded: true,
            background_uploaded: true,
            email_logo_uploaded: true,
            profile_picture_uploaded: true,
            branding_warnings: vec![],
        };
        assert!(result.logo_light_uploaded);
        assert!(result.logo_dark_uploaded);
        assert!(result.favicon_uploaded);
        assert!(result.background_uploaded);
        assert!(result.email_logo_uploaded);
        assert!(result.profile_picture_uploaded);
        assert_eq!(result.branding_warnings.len(), 0);
    }

    #[test]
    fn filename_extraction_from_url() {
        let fname = filename_from_url_and_ctype(
            "https://example.com/logo.png",
            "image/png"
        );
        assert_eq!(fname, "logo.png");

        let fname2 = filename_from_url_and_ctype(
            "https://example.com/path/image",
            "image/svg+xml"
        );
        assert_eq!(fname2, "background.svg");
    }

    #[test]
    fn application_image_endpoint_construction() {
        let base = "https://id.example.com";
        
        let logo_light_url = format!("{}/api/application-images/logo?light=true", base);
        assert_eq!(logo_light_url, "https://id.example.com/api/application-images/logo?light=true");
        
        let logo_dark_url = format!("{}/api/application-images/logo?light=false", base);
        assert_eq!(logo_dark_url, "https://id.example.com/api/application-images/logo?light=false");
        
        let email_url = format!("{}/api/application-images/email", base);
        assert_eq!(email_url, "https://id.example.com/api/application-images/email");
        
        let profile_url = format!("{}/api/application-images/default-profile-picture", base);
        assert_eq!(profile_url, "https://id.example.com/api/application-images/default-profile-picture");
    }
}
