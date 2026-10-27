//! GitHub App : JWT RS256 et tokens d'installation mis en cache (P2-01 / P2-02).
//!
//! Aucun token ni clé n'est journalisé : `SecretString` affiche `***` en Debug/Display.

use std::collections::HashMap;
use std::fmt;
use std::sync::Arc;

use serde::Serialize;
use serde_json::{json, Value};
use tokio::sync::Mutex;

/// Marge de renouvellement : un token qui expire dans moins de 5 min est renouvelé.
pub const RENEW_MARGIN_SECS: i64 = 300;

#[derive(Clone, PartialEq, Eq, Default)]
pub struct SecretString(String);

impl SecretString {
    pub fn new(s: impl Into<String>) -> Self {
        Self(s.into())
    }
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for SecretString {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("***")
    }
}
impl fmt::Display for SecretString {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("***")
    }
}

#[derive(Clone)]
pub struct AppCredentials {
    pub app_id: i64,
    pub private_key: SecretString,
}

impl fmt::Debug for AppCredentials {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "AppCredentials {{ app_id: {}, private_key: *** }}",
            self.app_id
        )
    }
}

#[derive(Serialize)]
struct Claims {
    iat: i64,
    exp: i64,
    iss: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TokenError {
    /// 401 : JWT refusé (clé/app invalide ou horloge).
    Unauthorized,
    /// 403 avec installation suspendue.
    Suspended,
    /// 404 : installation inconnue (supprimée).
    NotFound,
    Other(String),
}

impl fmt::Display for TokenError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            TokenError::Unauthorized => f.write_str("GitHub App : authentification refusée (401)"),
            TokenError::Suspended => f.write_str("GitHub App : installation suspendue (403)"),
            TokenError::NotFound => f.write_str("GitHub App : installation introuvable (404)"),
            TokenError::Other(m) => write!(f, "GitHub App : {m}"),
        }
    }
}

impl std::error::Error for TokenError {}

impl AppCredentials {
    pub fn new(app_id: i64, private_key_pem: impl Into<String>) -> Self {
        Self {
            app_id,
            private_key: SecretString::new(private_key_pem),
        }
    }

    /// JWT d'app : RS256, `iat = now − 60`, `exp = now + 540`, `iss = app_id`.
    pub fn app_jwt(&self) -> Result<SecretString, TokenError> {
        self.app_jwt_at(chrono::Utc::now().timestamp())
    }

    pub fn app_jwt_at(&self, now: i64) -> Result<SecretString, TokenError> {
        let key = jsonwebtoken::EncodingKey::from_rsa_pem(self.private_key.expose().as_bytes())
            .map_err(|_| TokenError::Other("clé privée invalide".into()))?;
        let claims = Claims {
            iat: now - 60,
            exp: now + 540,
            iss: self.app_id.to_string(),
        };
        jsonwebtoken::encode(
            &jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256),
            &claims,
            &key,
        )
        .map(SecretString)
        .map_err(|_| TokenError::Other("signature JWT impossible".into()))
    }
}

#[derive(Clone, Debug)]
pub struct InstallationToken {
    pub token: SecretString,
    /// Expiration (secondes Unix).
    pub expires_at: i64,
}

impl InstallationToken {
    pub fn fresh_at(&self, now: i64) -> bool {
        self.expires_at - now > RENEW_MARGIN_SECS
    }
}

/// Portée restreinte (tokens transmis aux runners) : dépôts et permissions.
#[derive(Clone, Debug, Default)]
pub struct TokenScope {
    pub repository_ids: Vec<i64>,
    pub permissions: Option<Value>,
}

pub fn default_api_base() -> String {
    std::env::var("DEVFORGE_GITHUB_API_URL")
        .ok()
        .map(|s| s.trim().trim_end_matches('/').to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "https://api.github.com".into())
}

/// `POST /app/installations/{id}/access_tokens`.
pub async fn fetch_installation_token(
    http: &reqwest::Client,
    api: &str,
    jwt: &SecretString,
    installation_id: i64,
    scope: Option<&TokenScope>,
) -> Result<InstallationToken, TokenError> {
    let mut body = json!({});
    if let Some(s) = scope {
        if !s.repository_ids.is_empty() {
            body["repository_ids"] = json!(s.repository_ids);
        }
        if let Some(p) = &s.permissions {
            body["permissions"] = p.clone();
        }
    }
    let res = http
        .post(format!(
            "{api}/app/installations/{installation_id}/access_tokens"
        ))
        .bearer_auth(jwt.expose())
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header("User-Agent", "devforge-server/2")
        .json(&body)
        .send()
        .await
        .map_err(|e| TokenError::Other(format!("GitHub injoignable : {}", e.without_url())))?;
    let status = res.status().as_u16();
    let text = res.text().await.unwrap_or_default();
    classify_token_response(status, &text)?;
    let v: Value =
        serde_json::from_str(&text).map_err(|_| TokenError::Other("réponse inattendue".into()))?;
    let token = v
        .get("token")
        .and_then(Value::as_str)
        .filter(|t| !t.is_empty())
        .ok_or_else(|| TokenError::Other("token absent".into()))?;
    let expires_at = v
        .get("expires_at")
        .and_then(Value::as_str)
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.timestamp())
        // Défaut GitHub : 1 h.
        .unwrap_or_else(|| chrono::Utc::now().timestamp() + 3600);
    Ok(InstallationToken {
        token: SecretString::new(token),
        expires_at,
    })
}

type Slot = Arc<Mutex<Option<InstallationToken>>>;

/// Cache des tokens d'installation, single-flight par installation.
pub struct InstallationTokenCache {
    http: reqwest::Client,
    api: String,
    slots: Mutex<HashMap<i64, Slot>>,
}

impl fmt::Debug for InstallationTokenCache {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("InstallationTokenCache(***)")
    }
}

impl Default for InstallationTokenCache {
    fn default() -> Self {
        Self::new(default_api_base())
    }
}

impl InstallationTokenCache {
    pub fn new(api: impl Into<String>) -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(20))
                .build()
                .unwrap_or_default(),
            api: api.into(),
            slots: Mutex::new(HashMap::new()),
        }
    }

    pub fn api(&self) -> &str {
        &self.api
    }

    async fn slot(&self, id: i64) -> Slot {
        self.slots.lock().await.entry(id).or_default().clone()
    }

    /// Token valide encore > 5 min, sinon renouvelé. 401 ⇒ 1 seul nouvel essai (nouveau JWT).
    pub async fn get(
        &self,
        creds: &AppCredentials,
        installation_id: i64,
    ) -> Result<SecretString, TokenError> {
        let slot = self.slot(installation_id).await;
        let mut guard = slot.lock().await;
        let now = chrono::Utc::now().timestamp();
        if let Some(t) = guard.as_ref().filter(|t| t.fresh_at(now)) {
            return Ok(t.token.clone());
        }
        let tok = match self.fetch(creds, installation_id, None).await {
            Err(TokenError::Unauthorized) => self.fetch(creds, installation_id, None).await,
            r => r,
        };
        match tok {
            Ok(t) => {
                let out = t.token.clone();
                *guard = Some(t);
                Ok(out)
            }
            Err(e) => {
                *guard = None;
                Err(e)
            }
        }
    }

    /// Token à portée restreinte, jamais mis en cache (runners, TTL GitHub ≤ 1 h).
    pub async fn scoped(
        &self,
        creds: &AppCredentials,
        installation_id: i64,
        scope: &TokenScope,
    ) -> Result<InstallationToken, TokenError> {
        match self.fetch(creds, installation_id, Some(scope)).await {
            Err(TokenError::Unauthorized) => self.fetch(creds, installation_id, Some(scope)).await,
            r => r,
        }
    }

    async fn fetch(
        &self,
        creds: &AppCredentials,
        id: i64,
        scope: Option<&TokenScope>,
    ) -> Result<InstallationToken, TokenError> {
        let jwt = creds.app_jwt()?;
        fetch_installation_token(&self.http, &self.api, &jwt, id, scope).await
    }

    /// À appeler sur un 401 d'un appel API utilisant le token.
    pub async fn invalidate(&self, installation_id: i64) {
        let slot = self.slot(installation_id).await;
        *slot.lock().await = None;
    }

    /// Pour les tests / l'observabilité : expiration en cache.
    pub async fn cached_expiry(&self, installation_id: i64) -> Option<i64> {
        let slot = self.slot(installation_id).await;
        let g = slot.lock().await;
        g.as_ref().map(|t| t.expires_at)
    }

    #[doc(hidden)]
    pub async fn seed(&self, installation_id: i64, token: InstallationToken) {
        let slot = self.slot(installation_id).await;
        *slot.lock().await = Some(token);
    }
}

/// Statut HTTP de `POST /app/installations/{id}/access_tokens` → erreur typée.
/// Hors cas connus, conserve le code HTTP et le champ `message` de GitHub (tronqué,
/// jetons masqués) : c'est lui qui explique un refus du jeton limité au dépôt
/// (ex. 422 « repository not accessible », 403 « permissions not granted »).
pub fn classify_token_response(status: u16, body: &str) -> Result<(), TokenError> {
    match status {
        200 | 201 => Ok(()),
        401 => Err(TokenError::Unauthorized),
        403 if body.to_lowercase().contains("suspended") => Err(TokenError::Suspended),
        404 => Err(TokenError::NotFound),
        s => {
            let msg = serde_json::from_str::<Value>(body)
                .ok()
                .and_then(|v| v.get("message").and_then(Value::as_str).map(str::to_string))
                .map(|m| {
                    let m = redact_tokens(m.trim());
                    let short: String = m.chars().take(160).collect();
                    if short.len() < m.len() {
                        format!("{short}…")
                    } else {
                        short
                    }
                })
                .filter(|m| !m.is_empty());
            Err(TokenError::Other(match msg {
                Some(m) => format!("HTTP {s} : {m}"),
                None => format!("HTTP {s}"),
            }))
        }
    }
}

/// Masque les jetons dans un texte de log (`x-access-token:<tok>@`, `ghs_…`, `ghp_…`, `github_pat_…`).
pub fn redact_tokens(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    const MARK: &str = "x-access-token:";
    while let Some(i) = rest.find(MARK) {
        out.push_str(&rest[..i + MARK.len()]);
        let after = &rest[i + MARK.len()..];
        let end = after
            .find(|c: char| c == '@' || c.is_whitespace() || c == '\'' || c == '"')
            .unwrap_or(after.len());
        out.push_str("***");
        rest = &after[end..];
    }
    out.push_str(rest);
    redact_prefixed(&out)
}

fn redact_prefixed(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < s.len() {
        let tail = &s[i..];
        let hit = ["github_pat_", "ghs_", "ghp_", "gho_", "ghu_", "ghr_"]
            .iter()
            .find(|p| tail.starts_with(**p))
            .filter(|_| i == 0 || !(bytes[i - 1] as char).is_ascii_alphanumeric());
        if let Some(p) = hit {
            let body = &tail[p.len()..];
            let n = body
                .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
                .unwrap_or(body.len());
            if n >= 8 {
                out.push_str(p);
                out.push_str("***");
                i += p.len() + n;
                continue;
            }
        }
        let ch = tail.chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

#[cfg(test)]
#[path = "app_auth_tests.rs"]
mod tests;
