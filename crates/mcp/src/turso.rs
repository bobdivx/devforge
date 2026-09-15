use devforge_shared::{DevForgeError, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TursoDatabase {
    pub name: String,
    pub db_id: Option<String>,
    pub hostname: String,
    pub regions: Vec<String>,
}

fn http() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(25))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

/// Liste les bases Turso via Platform API (pas de simulation).
pub async fn list_databases(api_token: &str, org: &str) -> Result<Vec<TursoDatabase>> {
    let token = api_token.trim();
    let org = org.trim();
    if token.is_empty() || org.is_empty() {
        return Err(DevForgeError::Message(
            "Turso: Platform API Token (api_token) et organization slug (org) requis pour ce fallback.\n→ Préfère connecter Turso via OAuth (MCP → Turso → Se connecter avec OAuth).\n→ Ou configure api_token + org dans MCP → Turso → Avancé.".into(),
        ));
    }
    let url = format!("https://api.turso.tech/v1/organizations/{org}/databases");
    let res = http()
        .get(&url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| DevForgeError::Message(format!("Turso API: {e}")))?;
    let status = res.status();
    let text = res.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(DevForgeError::Message(format!(
            "Turso list databases HTTP {status}: {}",
            text.chars().take(280).collect::<String>()
        )));
    }
    let v: Value = serde_json::from_str(&text)
        .map_err(|e| DevForgeError::Message(format!("Turso JSON: {e}")))?;
    let arr = v
        .get("databases")
        .and_then(|d| d.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(arr
        .into_iter()
        .filter_map(|d| {
            let name = d
                .get("Name")
                .or_else(|| d.get("name"))
                .and_then(|n| n.as_str())?
                .to_string();
            let hostname = d
                .get("Hostname")
                .or_else(|| d.get("hostname"))
                .and_then(|h| h.as_str())
                .unwrap_or("")
                .to_string();
            if hostname.is_empty() {
                return None;
            }
            let db_id = d
                .get("DbId")
                .or_else(|| d.get("dbId"))
                .or_else(|| d.get("id"))
                .and_then(|i| i.as_str())
                .map(str::to_string);
            let regions = d
                .get("regions")
                .and_then(|r| r.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            Some(TursoDatabase {
                name,
                db_id,
                hostname,
                regions,
            })
        })
        .collect())
}

/// Crée un JWT d’accès DB via Platform API.
pub async fn create_db_token(api_token: &str, org: &str, database: &str) -> Result<String> {
    let url = format!(
        "https://api.turso.tech/v1/organizations/{}/databases/{}/auth/tokens",
        org.trim(),
        database.trim()
    );
    let res = http()
        .post(&url)
        .bearer_auth(api_token.trim())
        .json(&serde_json::json!({}))
        .send()
        .await
        .map_err(|e| DevForgeError::Message(format!("Turso create token: {e}")))?;
    let status = res.status();
    let text = res.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(DevForgeError::Message(format!(
            "Turso auth token HTTP {status}: {}",
            text.chars().take(280).collect::<String>()
        )));
    }
    let v: Value = serde_json::from_str(&text)
        .map_err(|e| DevForgeError::Message(format!("Turso token JSON: {e}")))?;
    v.get("jwt")
        .or_else(|| v.get("token"))
        .and_then(|j| j.as_str())
        .map(str::to_string)
        .ok_or_else(|| DevForgeError::Message("Turso: jwt manquant dans la réponse".into()))
}

pub fn libsql_url(hostname: &str) -> String {
    if hostname.starts_with("libsql://") || hostname.starts_with("https://") {
        hostname.to_string()
    } else {
        format!("libsql://{hostname}")
    }
}
