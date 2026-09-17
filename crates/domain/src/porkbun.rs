//! Client Porkbun DNS (A / AAAA / CNAME) — le record pointe vers le nœud qui héberge l’app.

use devforge_shared::{DevForgeError, Result};
use serde::Deserialize;
use serde_json::{json, Value};

const API: &str = "https://api.porkbun.com/api/json/v3";
const API_V4: &str = "https://api-ipv4.porkbun.com/api/json/v3";

#[derive(Debug, Clone)]
pub struct PorkbunCreds {
    /// JSON `apikey` — chez Porkbun : API Key (`pk1_…`).
    pub apikey: String,
    /// JSON `secretapikey` — chez Porkbun : Secret Key (`sk1_…`).
    pub secretapikey: String,
    pub zone: String,
}

#[derive(Debug, Deserialize, Default)]
struct PorkbunStatus {
    #[serde(default)]
    status: String,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    records: Vec<PorkbunRecord>,
    #[serde(default, rename = "credentialsValid")]
    credentials_valid: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct PorkbunRecord {
    #[serde(default, deserialize_with = "de_stringy")]
    #[allow(dead_code)]
    id: String,
    #[serde(rename = "type")]
    #[serde(default)]
    #[allow(dead_code)]
    kind: String,
    #[serde(default)]
    content: String,
}

fn de_stringy<'de, D: serde::Deserializer<'de>>(d: D) -> std::result::Result<String, D::Error> {
    Ok(match Value::deserialize(d)? {
        Value::String(s) => s,
        Value::Number(n) => n.to_string(),
        Value::Null => String::new(),
        other => other.to_string(),
    })
}

/// Nettoie le collage et remet API Key / Secret dans le bon sens (`pk1_` / `sk1_`).
pub fn normalize_keys(api_key: &str, secret: &str) -> (String, String) {
    let mut apikey = strip_key(api_key);
    let mut secretapikey = strip_key(secret);
    if looks_secret(&apikey) && looks_public(&secretapikey) {
        std::mem::swap(&mut apikey, &mut secretapikey);
    }
    (apikey, secretapikey)
}

fn strip_key(s: &str) -> String {
    s.trim()
        .trim_start_matches('\u{feff}')
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect()
}

fn looks_public(s: &str) -> bool {
    s.starts_with("pk1_")
}

fn looks_secret(s: &str) -> bool {
    s.starts_with("sk1_")
}

pub fn normalize_zone(zone: &str) -> String {
    zone.trim()
        .trim_start_matches('.')
        .trim_end_matches('.')
        .to_lowercase()
}

pub fn normalize_fqdn(fqdn: &str) -> String {
    fqdn.trim()
        .trim_end_matches('.')
        .to_lowercase()
}

/// Sous-domaine Porkbun (`app`, `*`, `""` pour l’apex).
pub fn split_host(fqdn: &str, zone: &str) -> Result<String> {
    let fqdn = normalize_fqdn(fqdn);
    let zone = normalize_zone(zone);
    if zone.is_empty() || !zone.contains('.') {
        return Err(DevForgeError::Message("zone DNS Porkbun invalide".into()));
    }
    if fqdn == zone {
        return Ok(String::new());
    }
    let suffix = format!(".{zone}");
    fqdn.strip_suffix(&suffix)
        .map(|s| s.to_string())
        .ok_or_else(|| {
            DevForgeError::Message(format!("{fqdn} n’appartient pas à la zone {zone}"))
        })
}

pub fn record_kind(content: &str) -> &'static str {
    match content.trim().parse::<std::net::IpAddr>() {
        Ok(std::net::IpAddr::V4(_)) => "A",
        Ok(std::net::IpAddr::V6(_)) => "AAAA",
        Err(_) => "CNAME",
    }
}

fn auth_body(creds: &PorkbunCreds) -> Value {
    let (apikey, secretapikey) = normalize_keys(&creds.apikey, &creds.secretapikey);
    json!({
        "apikey": apikey,
        "secretapikey": secretapikey,
    })
}

async fn post_once(base: &str, path: &str, body: &Value) -> Result<PorkbunStatus> {
    let url = format!("{base}{path}");
    let res = reqwest::Client::new()
        .post(&url)
        .json(body)
        .send()
        .await
        .map_err(|e| DevForgeError::Message(format!("Porkbun HTTP: {e}")))?;
    let status = res.status();
    let text = res.text().await.unwrap_or_default();
    let parsed: PorkbunStatus = serde_json::from_str(&text).unwrap_or(PorkbunStatus {
        status: String::new(),
        message: Some(text.chars().take(400).collect()),
        records: vec![],
        credentials_valid: None,
    });
    if !status.is_success() || parsed.status != "SUCCESS" {
        let msg = parsed
            .message
            .unwrap_or_else(|| format!("HTTP {status}"));
        return Err(DevForgeError::Message(format!("Porkbun: {msg}")));
    }
    Ok(parsed)
}

async fn post_json(path: &str, body: Value) -> Result<PorkbunStatus> {
    match post_once(API, path, &body).await {
        Ok(s) => Ok(s),
        Err(e) if e.to_string().contains("Porkbun HTTP:") => post_once(API_V4, path, &body).await,
        Err(e) => Err(e),
    }
}

pub async fn ping(creds: &PorkbunCreds) -> Result<()> {
    let parsed = post_json("/ping", auth_body(creds)).await?;
    if parsed.credentials_valid == Some(false) {
        return Err(DevForgeError::Message(
            "Porkbun : clé API ou Secret API invalide".into(),
        ));
    }
    Ok(())
}

/// Vérifie que la zone est bien sur ce compte Porkbun.
pub async fn verify_zone(creds: &PorkbunCreds) -> Result<()> {
    let zone = normalize_zone(&creds.zone);
    if zone.is_empty() || !zone.contains('.') {
        return Err(DevForgeError::Message("zone DNS Porkbun invalide".into()));
    }
    let _ = post_json(&format!("/dns/retrieve/{zone}"), auth_body(creds)).await?;
    Ok(())
}

pub async fn lookup(creds: &PorkbunCreds, fqdn: &str) -> Result<Option<(String, String)>> {
    let zone = normalize_zone(&creds.zone);
    let name = split_host(fqdn, &zone)?;
    for kind in ["A", "AAAA", "CNAME"] {
        let listed = retrieve(creds, &zone, kind, &name).await?;
        if let Some(r) = listed.into_iter().next() {
            return Ok(Some((
                kind.to_string(),
                r.content.trim().trim_end_matches('.').to_string(),
            )));
        }
    }
    Ok(None)
}

pub async fn upsert_record(creds: &PorkbunCreds, fqdn: &str, content: &str) -> Result<()> {
    let zone = normalize_zone(&creds.zone);
    let name = split_host(fqdn, &zone)?;
    let content = content.trim().trim_end_matches('.').to_string();
    if content.is_empty() {
        return Err(DevForgeError::Message("cible DNS vide".into()));
    }
    let want = record_kind(&content);
    for kind in ["A", "AAAA", "CNAME"] {
        let listed = retrieve(creds, &zone, kind, &name).await?;
        if kind == want {
            if listed.iter().any(|r| r.content.trim_end_matches('.') == content) {
                return Ok(());
            }
            if !listed.is_empty() {
                edit(creds, &zone, kind, &name, &content).await?;
                return Ok(());
            }
        } else if !listed.is_empty() {
            let _ = delete(creds, &zone, kind, &name).await;
        }
    }
    create(creds, &zone, want, &name, &content).await
}

pub async fn delete_record(creds: &PorkbunCreds, fqdn: &str) -> Result<()> {
    let zone = normalize_zone(&creds.zone);
    let name = split_host(fqdn, &zone)?;
    for kind in ["A", "AAAA", "CNAME"] {
        let listed = retrieve(creds, &zone, kind, &name).await?;
        if !listed.is_empty() {
            let _ = delete(creds, &zone, kind, &name).await;
        }
    }
    Ok(())
}

async fn retrieve(
    creds: &PorkbunCreds,
    zone: &str,
    kind: &str,
    name: &str,
) -> Result<Vec<PorkbunRecord>> {
    let path = if name.is_empty() {
        format!("/dns/retrieveByNameType/{zone}/{kind}")
    } else {
        format!("/dns/retrieveByNameType/{zone}/{kind}/{name}")
    };
    match post_json(&path, auth_body(creds)).await {
        Ok(s) => Ok(s.records),
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("not found") || msg.contains("No records") {
                Ok(vec![])
            } else {
                Err(e)
            }
        }
    }
}

async fn create(creds: &PorkbunCreds, zone: &str, kind: &str, name: &str, content: &str) -> Result<()> {
    let mut body = auth_body(creds);
    body["type"] = json!(kind);
    body["content"] = json!(content);
    body["ttl"] = json!(600);
    body["name"] = json!(name);
    post_json(&format!("/dns/create/{zone}"), body).await?;
    Ok(())
}

async fn edit(creds: &PorkbunCreds, zone: &str, kind: &str, name: &str, content: &str) -> Result<()> {
    let path = if name.is_empty() {
        format!("/dns/editByNameType/{zone}/{kind}")
    } else {
        format!("/dns/editByNameType/{zone}/{kind}/{name}")
    };
    let mut body = auth_body(creds);
    body["content"] = json!(content);
    body["ttl"] = json!(600);
    post_json(&path, body).await?;
    Ok(())
}

async fn delete(creds: &PorkbunCreds, zone: &str, kind: &str, name: &str) -> Result<()> {
    let path = if name.is_empty() {
        format!("/dns/deleteByNameType/{zone}/{kind}")
    } else {
        format!("/dns/deleteByNameType/{zone}/{kind}/{name}")
    };
    post_json(&path, auth_body(creds)).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_app_and_apex() {
        assert_eq!(split_host("app.jeser.app", "jeser.app").unwrap(), "app");
        assert_eq!(split_host("jeser.app", "jeser.app").unwrap(), "");
        assert_eq!(split_host("*.jeser.app", "jeser.app").unwrap(), "*");
        assert!(split_host("other.com", "jeser.app").is_err());
    }

    #[test]
    fn kinds() {
        assert_eq!(record_kind("10.1.0.58"), "A");
        assert_eq!(record_kind("2001:db8::1"), "AAAA");
        assert_eq!(record_kind("demeter.example.com"), "CNAME");
    }

    #[test]
    fn keys_map_to_official_json_fields() {
        let body = auth_body(&PorkbunCreds {
            apikey: "pk1_public".into(),
            secretapikey: "sk1_secret".into(),
            zone: "jeser.app".into(),
        });
        assert_eq!(body["apikey"], "pk1_public");
        assert_eq!(body["secretapikey"], "sk1_secret");
        assert!(body.get("secret").is_none());
        assert!(body.get("api_key").is_none());
        assert!(body.get("secret_key").is_none());
    }

    #[test]
    fn keys_trim_and_unswap() {
        assert_eq!(
            normalize_keys("  pk1_a \n", "\tsk1_b"),
            ("pk1_a".into(), "sk1_b".into())
        );
        assert_eq!(
            normalize_keys("sk1_secret", "pk1_public"),
            ("pk1_public".into(), "sk1_secret".into())
        );
        assert_eq!(
            normalize_keys("pk1_sb_a", "sk1_sb_b"),
            ("pk1_sb_a".into(), "sk1_sb_b".into())
        );
        assert_eq!(
            normalize_keys("custom", "also-custom"),
            ("custom".into(), "also-custom".into())
        );
    }

    #[test]
    fn record_id_number_or_string() {
        let n: PorkbunRecord =
            serde_json::from_str(r#"{"id":123,"type":"A","content":"1.2.3.4"}"#).unwrap();
        assert_eq!(n.id, "123");
        let s: PorkbunRecord =
            serde_json::from_str(r#"{"id":"456","type":"A","content":"1.2.3.4"}"#).unwrap();
        assert_eq!(s.id, "456");
    }
}
