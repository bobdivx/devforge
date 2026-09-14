//! OAuth 2.1 + PKCE pour serveurs MCP distants (RFC 8252, RFC 7636)

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use devforge_shared::{DevForgeError, Result};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Document de découverte OAuth 2.0 (RFC 8414 / RFC 9728 MCP)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthDiscoveryDocument {
    pub issuer: Option<String>,
    pub authorization_endpoint: Option<String>,
    pub token_endpoint: Option<String>,
    pub revocation_endpoint: Option<String>,
    pub registration_endpoint: Option<String>,
    pub scopes_supported: Option<Vec<String>>,
    pub response_types_supported: Option<Vec<String>>,
    pub grant_types_supported: Option<Vec<String>>,
    pub code_challenge_methods_supported: Option<Vec<String>>,
    #[serde(default)]
    pub client_id_metadata_document_supported: bool,
    pub token_endpoint_auth_methods_supported: Option<Vec<String>>,
}

/// OAuth Protected Resource Metadata (RFC 9728 MCP)
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ProtectedResourceMetadata {
    pub resource: Option<String>,
    pub authorization_servers: Option<Vec<String>>,
}

/// Réponse OAuth token exchange
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: String,
    #[serde(default)]
    pub expires_in: Option<i64>,
    #[serde(default)]
    pub token_type: String,
    #[serde(default)]
    pub scope: String,
}

/// PKCE code verifier (43-128 chars unreserved)
pub fn generate_code_verifier() -> String {
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..32).map(|_| rng.gen()).collect();
    URL_SAFE_NO_PAD.encode(&bytes)
}

/// PKCE code challenge = BASE64URL(SHA256(verifier))
pub fn code_challenge(verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let hash = hasher.finalize();
    URL_SAFE_NO_PAD.encode(&hash)
}

/// State aléatoire anti-CSRF
pub fn generate_state() -> String {
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..24).map(|_| rng.gen()).collect();
    URL_SAFE_NO_PAD.encode(&bytes)
}

/// Découverte OAuth depuis un endpoint MCP distant (RFC 9728 + protected resource)
/// Essaie :
/// 1. WWW-Authenticate challenge sur tools/list 401 → resource_metadata
/// 2. Protected Resource Metadata → authorization_servers
/// 3. /.well-known/oauth-authorization-server fallback
pub async fn discover_oauth(
    base_url: &str,
    mcp_url: &str,
) -> Result<OAuthDiscoveryDocument> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| DevForgeError::Message(format!("Reqwest build: {e}")))?;

    // 1. Tenter protected resource metadata (MCP tools/list sans auth → 401 + WWW-Authenticate)
    if !mcp_url.is_empty() {
        let res = client
            .post(mcp_url)
            .header("Accept", "application/json")
            .header("Content-Type", "application/json")
            .json(&serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/list",
                "params": {}
            }))
            .send()
            .await
            .ok();

        if let Some(r) = res {
            if r.status() == reqwest::StatusCode::UNAUTHORIZED {
                if let Some(www_auth) = r.headers().get("www-authenticate") {
                    if let Ok(hdr) = www_auth.to_str() {
                        // Parse resource_metadata="..." (Turso pattern)
                        if let Some(resource_meta_url) = extract_resource_metadata(hdr) {
                            // GET Protected Resource Metadata
                            if let Ok(prm) = fetch_protected_resource_metadata(&client, &resource_meta_url).await {
                                // Utiliser le premier authorization_server
                                if let Some(servers) = prm.authorization_servers {
                                    if let Some(as_url) = servers.first() {
                                        let well_known = format!("{}/.well-known/oauth-authorization-server", as_url.trim_end_matches('/'));
                                        if let Ok(doc) = fetch_as_metadata(&client, &well_known).await {
                                            return Ok(doc);
                                        }
                                    }
                                }
                            }
                        }
                        
                        // Fallback: as_uri= (legacy)
                        if let Some(url) = extract_as_uri(hdr) {
                            if let Ok(doc) = fetch_as_metadata(&client, &url).await {
                                return Ok(doc);
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. Fallback : /.well-known/oauth-authorization-server
    let base = base_url.trim_end_matches('/');
    let well_known = format!("{}/.well-known/oauth-authorization-server", base);
    fetch_as_metadata(&client, &well_known).await
}

fn extract_resource_metadata(www_authenticate: &str) -> Option<String> {
    // Format Turso : Bearer resource_metadata="https://mcp.turso.ai/.well-known/oauth-protected-resource/mcp"
    // Peut aussi avoir : Bearer realm="...", resource_metadata="..."
    let trimmed = www_authenticate.trim();
    
    // Chercher resource_metadata= dans toute la chaîne
    if let Some(start_idx) = trimmed.find("resource_metadata=") {
        let after_key = &trimmed[start_idx + "resource_metadata=".len()..];
        let value = after_key.trim_start_matches('"');
        
        // Trouver la fin : soit " soit espace soit virgule soit fin
        let end_idx = value
            .find('"')
            .or_else(|| value.find(' '))
            .or_else(|| value.find(','))
            .unwrap_or(value.len());
        
        let url = &value[..end_idx];
        if !url.is_empty() {
            return Some(url.to_string());
        }
    }
    None
}

fn extract_as_uri(www_authenticate: &str) -> Option<String> {
    // Format legacy : Bearer realm="...", as_uri="https://..."
    for part in www_authenticate.split(',') {
        let part = part.trim();
        if let Some(val) = part.strip_prefix("as_uri=") {
            let url = val.trim_matches('"').trim();
            if !url.is_empty() {
                return Some(url.to_string());
            }
        }
    }
    None
}

async fn fetch_protected_resource_metadata(
    client: &reqwest::Client,
    url: &str,
) -> Result<ProtectedResourceMetadata> {
    let res = client
        .get(url)
        .send()
        .await
        .map_err(|e| DevForgeError::Message(format!("Protected Resource Metadata GET {url}: {e}")))?;

    if !res.status().is_success() {
        return Err(DevForgeError::Message(format!(
            "Protected Resource Metadata {} → HTTP {}",
            url,
            res.status()
        )));
    }

    let prm: ProtectedResourceMetadata = res
        .json()
        .await
        .map_err(|e| DevForgeError::Message(format!("Protected Resource Metadata parse: {e}")))?;

    Ok(prm)
}

async fn fetch_as_metadata(
    client: &reqwest::Client,
    url: &str,
) -> Result<OAuthDiscoveryDocument> {
    let res = client
        .get(url)
        .send()
        .await
        .map_err(|e| DevForgeError::Message(format!("OAuth discovery GET {url}: {e}")))?;

    if !res.status().is_success() {
        return Err(DevForgeError::Message(format!(
            "OAuth discovery {} → HTTP {}",
            url,
            res.status()
        )));
    }

    let doc: OAuthDiscoveryDocument = res
        .json()
        .await
        .map_err(|e| DevForgeError::Message(format!("OAuth discovery parse: {e}")))?;

    Ok(doc)
}

/// Construit l'URL d'autorisation OAuth + PKCE
pub fn build_authorization_url(
    doc: &OAuthDiscoveryDocument,
    client_id: &str,
    redirect_uri: &str,
    state: &str,
    code_challenge: &str,
    scopes: &[&str],
) -> Result<String> {
    let auth_url = doc
        .authorization_endpoint
        .as_deref()
        .ok_or_else(|| DevForgeError::Message("authorization_endpoint manquant".into()))?;

    let mut params = vec![
        ("response_type", "code"),
        ("client_id", client_id),
        ("redirect_uri", redirect_uri),
        ("state", state),
        ("code_challenge", code_challenge),
        ("code_challenge_method", "S256"),
    ];

    let scope_str = scopes.join(" ");
    if !scope_str.is_empty() {
        params.push(("scope", &scope_str));
    }

    let query = params
        .into_iter()
        .map(|(k, v)| format!("{}={}", k, urlencoding::encode(v)))
        .collect::<Vec<_>>()
        .join("&");

    Ok(format!("{}?{}", auth_url, query))
}

/// Échange code → access_token (RFC 6749 + PKCE RFC 7636)
pub async fn exchange_code(
    token_endpoint: &str,
    client_id: &str,
    redirect_uri: &str,
    code: &str,
    code_verifier: &str,
) -> Result<TokenResponse> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| DevForgeError::Message(format!("Reqwest build: {e}")))?;

    let params = [
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", redirect_uri),
        ("client_id", client_id),
        ("code_verifier", code_verifier),
    ];

    let res = client
        .post(token_endpoint)
        .form(&params)
        .send()
        .await
        .map_err(|e| DevForgeError::Message(format!("Token exchange POST: {e}")))?;

    let status = res.status();
    let text = res.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(DevForgeError::Message(format!(
            "Token exchange → HTTP {status}: {}",
            text.chars().take(300).collect::<String>()
        )));
    }

    let token: TokenResponse = serde_json::from_str(&text)
        .map_err(|e| DevForgeError::Message(format!("Token parse: {e}")))?;

    Ok(token)
}

/// Refresh token (RFC 6749 Section 6)
pub async fn refresh_access_token(
    token_endpoint: &str,
    client_id: &str,
    refresh_token: &str,
) -> Result<TokenResponse> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| DevForgeError::Message(format!("Reqwest build: {e}")))?;

    let params = [
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
        ("client_id", client_id),
    ];

    let res = client
        .post(token_endpoint)
        .form(&params)
        .send()
        .await
        .map_err(|e| DevForgeError::Message(format!("Refresh token POST: {e}")))?;

    let status = res.status();
    let text = res.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(DevForgeError::Message(format!(
            "Refresh token → HTTP {status}: {}",
            text.chars().take(300).collect::<String>()
        )));
    }

    let token: TokenResponse = serde_json::from_str(&text)
        .map_err(|e| DevForgeError::Message(format!("Token parse: {e}")))?;

    Ok(token)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_flow() {
        let verifier = generate_code_verifier();
        assert!(verifier.len() >= 32);
        let challenge = code_challenge(&verifier);
        assert!(challenge.len() >= 32);
        assert_ne!(verifier, challenge);
    }

    #[test]
    fn state_generation() {
        let s1 = generate_state();
        let s2 = generate_state();
        assert!(s1.len() >= 20);
        assert_ne!(s1, s2);
    }

    #[test]
    fn extract_resource_metadata_from_www_authenticate() {
        let header = r#"Bearer resource_metadata="https://mcp.turso.ai/.well-known/oauth-protected-resource/mcp""#;
        let uri = super::extract_resource_metadata(header);
        assert_eq!(
            uri,
            Some("https://mcp.turso.ai/.well-known/oauth-protected-resource/mcp".into())
        );
    }

    #[test]
    fn extract_as_uri_from_www_authenticate() {
        let header = r#"Bearer realm="mcp", as_uri="https://auth.example.com/.well-known/oauth-authorization-server""#;
        let uri = super::extract_as_uri(header);
        assert_eq!(
            uri,
            Some("https://auth.example.com/.well-known/oauth-authorization-server".into())
        );
    }

    #[test]
    fn build_auth_url() {
        let doc = OAuthDiscoveryDocument {
            issuer: Some("https://auth.example.com".into()),
            authorization_endpoint: Some("https://auth.example.com/authorize".into()),
            token_endpoint: Some("https://auth.example.com/token".into()),
            revocation_endpoint: None,
            registration_endpoint: None,
            scopes_supported: None,
            response_types_supported: None,
            grant_types_supported: None,
            code_challenge_methods_supported: None,
            client_id_metadata_document_supported: false,
            token_endpoint_auth_methods_supported: None,
        };
        let url = build_authorization_url(
            &doc,
            "devforge-client",
            "https://app.example.com/api/v1/mcp/oauth/callback",
            "state123",
            "challenge456",
            &["read", "write"],
        )
        .unwrap();
        assert!(url.contains("response_type=code"));
        assert!(url.contains("client_id=devforge-client"));
        assert!(url.contains("code_challenge=challenge456"));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains("scope=read%20write"));
    }
}
