//! Cloudflare API : DNS + un tunnel par nœud (catch-all vers Traefik local).

use devforge_shared::{DevForgeError, Result};
use serde::Deserialize;
use serde_json::{json, Value};

const API: &str = "https://api.cloudflare.com/client/v4";

#[derive(Debug, Clone)]
pub struct CloudflareClient {
    pub token: String,
    pub account_id: String,
    pub zone_id: String,
    pub zone: String,
}

#[derive(Deserialize)]
struct CfEnvelope<T> {
    success: bool,
    #[serde(default)]
    errors: Vec<CfError>,
    result: Option<T>,
}

#[derive(Deserialize)]
struct CfError {
    #[serde(default)]
    message: String,
}

#[derive(Deserialize)]
struct CfAccount {
    id: String,
    #[serde(default)]
    name: String,
}

#[derive(Deserialize)]
struct CfZone {
    id: String,
    name: String,
}

#[derive(Deserialize)]
struct CfTunnel {
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    #[allow(dead_code)]
    token: Option<String>,
}

#[derive(Deserialize)]
struct CfDnsRec {
    id: String,
    #[serde(default)]
    content: String,
    #[serde(rename = "type")]
    #[serde(default)]
    kind: String,
}

fn fail(msg: impl Into<String>) -> DevForgeError {
    DevForgeError::Message(msg.into())
}

async fn cf_request<T: for<'de> Deserialize<'de>>(
    token: &str,
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
) -> Result<T> {
    let url = format!("{API}{path}");
    let mut req = reqwest::Client::new()
        .request(method, &url)
        .bearer_auth(token)
        .header("Content-Type", "application/json");
    if let Some(b) = body {
        req = req.json(&b);
    }
    let res = req
        .send()
        .await
        .map_err(|e| fail(format!("Cloudflare HTTP: {e}")))?;
    let status = res.status();
    let text = res.text().await.unwrap_or_default();
    let parsed: CfEnvelope<T> =
        serde_json::from_str(&text).map_err(|_| fail(format!("Cloudflare JSON HTTP {status}: {}", text.chars().take(240).collect::<String>())))?;
    if !status.is_success() || !parsed.success {
        let msg = parsed
            .errors
            .into_iter()
            .map(|e| e.message)
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("; ");
        return Err(fail(format!(
            "Cloudflare: {}",
            if msg.is_empty() {
                format!("HTTP {status}")
            } else {
                msg
            }
        )));
    }
    parsed.result.ok_or_else(|| fail("Cloudflare: réponse vide"))
}

pub async fn ping(token: &str) -> Result<String> {
    let accounts: Vec<CfAccount> = cf_request(
        token,
        reqwest::Method::GET,
        "/accounts?per_page=5",
        None,
    )
    .await?;
    let a = accounts
        .first()
        .ok_or_else(|| fail("Aucun compte Cloudflare pour ce token"))?;
    Ok(if a.name.trim().is_empty() {
        a.id.clone()
    } else {
        a.name.clone()
    })
}

pub async fn connect(token: &str, zone: &str) -> Result<CloudflareClient> {
    let token = token.trim();
    if token.is_empty() {
        return Err(fail("token Cloudflare manquant"));
    }
    let accounts: Vec<CfAccount> = cf_request(
        token,
        reqwest::Method::GET,
        "/accounts?per_page=5",
        None,
    )
    .await?;
    let account_id = accounts
        .first()
        .map(|a| a.id.clone())
        .ok_or_else(|| fail("Aucun compte Cloudflare pour ce token"))?;
    let zone_name = crate::porkbun::normalize_zone(zone);
    if zone_name.is_empty() {
        return Err(fail("domaine Cloudflare manquant"));
    }
    let zones: Vec<CfZone> = cf_request(
        token,
        reqwest::Method::GET,
        &format!("/zones?name={zone_name}&per_page=5"),
        None,
    )
    .await?;
    let z = zones
        .into_iter()
        .find(|z| z.name.eq_ignore_ascii_case(&zone_name))
        .ok_or_else(|| {
            fail(format!(
                "Zone {zone_name} introuvable — le domaine doit être sur ce compte Cloudflare"
            ))
        })?;
    Ok(CloudflareClient {
        token: token.into(),
        account_id,
        zone_id: z.id,
        zone: z.name,
    })
}

impl CloudflareClient {
    pub fn tunnel_hostname(tunnel_id: &str) -> String {
        format!("{}.cfargotunnel.com", tunnel_id.trim())
    }

    pub async fn ensure_tunnel(&self, name: &str) -> Result<(String, String)> {
        let listed: Vec<CfTunnel> = cf_request(
            &self.token,
            reqwest::Method::GET,
            &format!(
                "/accounts/{}/cfd_tunnel?is_deleted=false&per_page=100",
                self.account_id
            ),
            None,
        )
        .await?;
        let id = if let Some(t) = listed.into_iter().find(|t| t.name == name) {
            t.id
        } else {
            let created: CfTunnel = cf_request(
                &self.token,
                reqwest::Method::POST,
                &format!("/accounts/{}/cfd_tunnel", self.account_id),
                Some(json!({
                    "name": name,
                    "config_src": "cloudflare",
                })),
            )
            .await?;
            created.id
        };
        self.set_catch_all_http(&id).await?;
        let token = self.tunnel_token(&id).await?;
        Ok((id, token))
    }

    async fn tunnel_token(&self, tunnel_id: &str) -> Result<String> {
        let raw: Value = cf_request(
            &self.token,
            reqwest::Method::GET,
            &format!(
                "/accounts/{}/cfd_tunnel/{tunnel_id}/token",
                self.account_id
            ),
            None,
        )
        .await?;
        let t = match &raw {
            Value::String(s) => s.clone(),
            Value::Object(o) => o
                .get("token")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            _ => raw.as_str().unwrap_or("").to_string(),
        };
        let t = t.trim().trim_matches('"').to_string();
        if t.is_empty() {
            return Err(fail("token tunnel Cloudflare vide"));
        }
        Ok(t)
    }

    async fn set_catch_all_http(&self, tunnel_id: &str) -> Result<()> {
        let _: Value = cf_request(
            &self.token,
            reqwest::Method::PUT,
            &format!(
                "/accounts/{}/cfd_tunnel/{tunnel_id}/configurations",
                self.account_id
            ),
            Some(json!({
                "config": {
                    "ingress": [
                        { "service": "http://127.0.0.1:80" }
                    ]
                }
            })),
        )
        .await?;
        Ok(())
    }

    pub async fn upsert_cname(&self, fqdn: &str, target: &str) -> Result<()> {
        let fqdn = crate::porkbun::normalize_fqdn(fqdn);
        let target = target.trim().trim_end_matches('.').to_lowercase();
        let existing: Vec<CfDnsRec> = cf_request(
            &self.token,
            reqwest::Method::GET,
            &format!(
                "/zones/{}/dns_records?name={fqdn}&per_page=20",
                self.zone_id
            ),
            None,
        )
        .await
        .unwrap_or_default();
        let body = json!({
            "type": "CNAME",
            "name": fqdn,
            "content": target,
            "ttl": 1,
            "proxied": true,
        });
        if let Some(rec) = existing.iter().find(|r| r.content.trim_end_matches('.') == target) {
            let _ = rec;
            return Ok(());
        }
        if let Some(rec) = existing.first() {
            let _: CfDnsRec = cf_request(
                &self.token,
                reqwest::Method::PUT,
                &format!("/zones/{}/dns_records/{}", self.zone_id, rec.id),
                Some(body),
            )
            .await?;
            return Ok(());
        }
        let _: CfDnsRec = cf_request(
            &self.token,
            reqwest::Method::POST,
            &format!("/zones/{}/dns_records", self.zone_id),
            Some(body),
        )
        .await?;
        Ok(())
    }

    pub async fn delete_name(&self, fqdn: &str) -> Result<()> {
        let fqdn = crate::porkbun::normalize_fqdn(fqdn);
        let existing: Vec<CfDnsRec> = cf_request(
            &self.token,
            reqwest::Method::GET,
            &format!(
                "/zones/{}/dns_records?name={fqdn}&per_page=20",
                self.zone_id
            ),
            None,
        )
        .await
        .unwrap_or_default();
        for rec in existing {
            let _: Value = cf_request(
                &self.token,
                reqwest::Method::DELETE,
                &format!("/zones/{}/dns_records/{}", self.zone_id, rec.id),
                None,
            )
            .await
            .unwrap_or(json!({}));
        }
        Ok(())
    }

    pub async fn lookup_name(&self, fqdn: &str) -> Result<Option<(String, String)>> {
        let fqdn = crate::porkbun::normalize_fqdn(fqdn);
        let existing: Vec<CfDnsRec> = cf_request(
            &self.token,
            reqwest::Method::GET,
            &format!(
                "/zones/{}/dns_records?name={fqdn}&per_page=20",
                self.zone_id
            ),
            None,
        )
        .await
        .unwrap_or_default();
        Ok(existing.into_iter().next().map(|r| {
            let kind = if r.kind.trim().is_empty() {
                "CNAME".into()
            } else {
                r.kind
            };
            (
                kind,
                r.content.trim().trim_end_matches('.').to_string(),
            )
        }))
    }
}

/// `apps.jeser.app` → `jeser.app`
pub fn infer_zone(input: &str) -> String {
    let s = crate::porkbun::normalize_zone(input);
    let parts: Vec<&str> = s.split('.').filter(|p| !p.is_empty()).collect();
    if parts.len() <= 2 {
        s
    } else {
        format!("{}.{}", parts[parts.len() - 2], parts[parts.len() - 1])
    }
}

pub fn parse_porkbun_token(token: &str) -> (String, String) {
    let t = token.trim();
    if let Some((a, b)) = t.split_once(':') {
        return (a.trim().into(), b.trim().into());
    }
    if let Some((a, b)) = t.split_once('|') {
        return (a.trim().into(), b.trim().into());
    }
    (t.into(), String::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zone_from_wildcard() {
        assert_eq!(infer_zone("jeser.app"), "jeser.app");
        assert_eq!(infer_zone("apps.jeser.app"), "jeser.app");
        assert_eq!(infer_zone(".Foo.EXAMPLE.com"), "example.com");
    }

    #[test]
    fn porkbun_token_split() {
        assert_eq!(
            parse_porkbun_token("pk1:sk2"),
            ("pk1".into(), "sk2".into())
        );
        assert_eq!(parse_porkbun_token("only"), ("only".into(), "".into()));
    }
}
