use crate::models::{HeartbeatPayload, JoinRequest, JoinResponse, PendingJoin};
use devforge_shared::{DevForgeError, Result};
use std::path::{Path, PathBuf};

pub fn data_dir() -> PathBuf {
    std::env::var("DEVFORGE_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/data"))
}

pub fn pending_join_path() -> PathBuf {
    data_dir().join("cluster-pending-join.json")
}

pub async fn load_pending_join() -> Result<Option<PendingJoin>> {
    let path = pending_join_path();
    if !path.is_file() {
        return Ok(None);
    }
    let raw = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| DevForgeError::Message(format!("lecture pending join: {e}")))?;
    let parsed: PendingJoin = serde_json::from_str(&raw)
        .map_err(|e| DevForgeError::Message(format!("pending join JSON: {e}")))?;
    Ok(Some(parsed))
}

pub async fn clear_pending_join() -> Result<()> {
    let path = pending_join_path();
    if path.is_file() {
        let _ = tokio::fs::remove_file(path).await;
    }
    Ok(())
}

pub fn write_pending_join_sync(path: &Path, join: &PendingJoin) -> Result<()> {
    let json = serde_json::to_string_pretty(join)
        .map_err(|e| DevForgeError::Message(e.to_string()))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| DevForgeError::Message(format!("mkdir pending join: {e}")))?;
    }
    std::fs::write(path, json)
        .map_err(|e| DevForgeError::Message(format!("write pending join: {e}")))?;
    Ok(())
}

pub struct LeaderClient {
    http: reqwest::Client,
    api_base: String,
}

impl LeaderClient {
    pub fn new(leader_url: &str) -> Self {
        let base = normalize_api_base(leader_url);
        Self {
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
            api_base: base,
        }
    }

    pub async fn join(&self, req: &JoinRequest) -> Result<JoinResponse> {
        let url = format!("{}/cluster/join", self.api_base);
        let res = self
            .http
            .post(&url)
            .json(req)
            .send()
            .await
            .map_err(|e| DevForgeError::Message(format!("join HTTP: {e}")))?;
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(DevForgeError::Message(parse_error(&text, status.as_u16())));
        }
        serde_json::from_str(&text)
            .map_err(|e| DevForgeError::Message(format!("join JSON: {e} — {text}")))
    }

    pub async fn heartbeat(&self, secret: &str, payload: &HeartbeatPayload) -> Result<()> {
        let url = format!("{}/cluster/heartbeat", self.api_base);
        let res = self
            .http
            .post(&url)
            .bearer_auth(secret)
            .json(payload)
            .send()
            .await
            .map_err(|e| DevForgeError::Message(format!("heartbeat HTTP: {e}")))?;
        if !res.status().is_success() {
            let status = res.status();
            let text = res.text().await.unwrap_or_default();
            return Err(DevForgeError::Message(parse_error(&text, status.as_u16())));
        }
        Ok(())
    }
}

pub fn normalize_api_base(leader_url: &str) -> String {
    let u = leader_url.trim().trim_end_matches('/');
    if u.ends_with("/api/v1") {
        u.into()
    } else {
        format!("{u}/api/v1")
    }
}

fn parse_error(text: &str, status: u16) -> String {
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(text) {
        if let Some(e) = v.get("error").and_then(|x| x.as_str()) {
            return e.into();
        }
    }
    if text.trim().is_empty() {
        format!("HTTP {status}")
    } else {
        text.chars().take(400).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_base_appends_v1() {
        assert_eq!(
            normalize_api_base("http://10.1.0.88:8000"),
            "http://10.1.0.88:8000/api/v1"
        );
        assert_eq!(
            normalize_api_base("http://10.1.0.88:8000/api/v1/"),
            "http://10.1.0.88:8000/api/v1"
        );
    }
}
