use async_trait::async_trait;
use devforge_shared::{DevForgeError, Result, Tool};
use serde_json::{json, Value};

pub struct HttpSmokeTool;

#[async_trait]
impl Tool for HttpSmokeTool {
    fn name(&self) -> &str {
        "http_smoke"
    }
    fn description(&self) -> &str {
        "Smoke HTTP GET sur une URL publique (status + extrait)."
    }
    fn parameters(&self) -> Value {
        json!({
            "type":"object",
            "properties":{"url":{"type":"string"}},
            "required":["url"]
        })
    }
    async fn execute(&self, arguments: Value) -> Result<Value> {
        let url = arguments.get("url").and_then(|v| v.as_str()).unwrap_or("").trim();
        if url.is_empty() || !(url.starts_with("http://") || url.starts_with("https://")) {
            return Ok(json!({"ok": false, "error": "URL invalide"}));
        }
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .user_agent("DevForge-Agent/2.0")
            .build()
            .map_err(|e| DevForgeError::Message(e.to_string()))?;
        match client.get(url).send().await {
            Ok(r) => {
                let status = r.status().as_u16();
                let body = r.text().await.unwrap_or_default();
                let excerpt: String = body.chars().take(500).collect();
                Ok(json!({
                    "ok": (200..400).contains(&status),
                    "status": status,
                    "url": url,
                    "excerpt": excerpt
                }))
            }
            Err(e) => Ok(json!({"ok": false, "error": e.to_string(), "url": url})),
        }
    }
}
