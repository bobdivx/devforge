use crate::models::{
    FailoverStatus, HeartbeatAck, HeartbeatPayload, JoinRequest, JoinResponse, PendingJoin,
    QuiesceAck,
};
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

pub fn roster_path() -> PathBuf {
    data_dir().join("cluster-roster.json")
}

pub fn snapshot_path() -> PathBuf {
    data_dir().join("cluster-snapshot.db")
}

/// Dump Postgres courant, ou ancien fichier SQLite encore en transit.
pub fn snapshot_acceptable(bytes: &[u8]) -> bool {
    bytes.len() >= 100
        && (bytes.starts_with(b"-- DevForge postgres snapshot\n")
            || bytes.starts_with(b"SQLite format 3\0"))
}

pub fn failover_identity_path() -> PathBuf {
    data_dir().join("cluster-identity.json")
}

pub fn promote_flag_path() -> PathBuf {
    data_dir().join("cluster-promote.flag")
}

pub fn reclaim_flag_path() -> PathBuf {
    data_dir().join("cluster-reclaim.json")
}

pub fn restart_current_process() -> ! {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        if let Ok(exe) = std::env::current_exe() {
            let args: Vec<_> = std::env::args_os().skip(1).collect();
            let err = std::process::Command::new(exe).args(args).exec();
            tracing::error!(error = %err, "échec exec redémarrage");
        }
    }
    std::process::exit(0);
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
    origin: String,
}

impl LeaderClient {
    pub fn new(leader_url: &str) -> Self {
        let origin = leader_url.trim().trim_end_matches('/').to_string();
        let base = normalize_api_base(leader_url);
        Self {
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
            api_base: base,
            origin,
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

    pub async fn heartbeat(&self, secret: &str, payload: &HeartbeatPayload) -> Result<HeartbeatAck> {
        let url = format!("{}/cluster/heartbeat", self.api_base);
        let res = self
            .http
            .post(&url)
            .bearer_auth(secret)
            .json(payload)
            .send()
            .await
            .map_err(|e| DevForgeError::Message(format!("heartbeat HTTP: {e}")))?;
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(DevForgeError::Message(parse_error(&text, status.as_u16())));
        }
        Ok(serde_json::from_str(&text).unwrap_or(HeartbeatAck {
            ok: true,
            ..Default::default()
        }))
    }

    pub async fn ping_health(&self) -> bool {
        let url = format!("{}/api/v1/health", self.origin);
        self.http
            .get(&url)
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false)
    }

    pub async fn fetch_snapshot(&self, secret: &str) -> Result<Vec<u8>> {
        let url = format!("{}/internal/cluster-snapshot", self.origin);
        let res = self
            .http
            .get(&url)
            .bearer_auth(secret)
            .timeout(std::time::Duration::from_secs(120))
            .send()
            .await
            .map_err(|e| DevForgeError::Message(format!("snapshot HTTP: {e}")))?;
        if !res.status().is_success() {
            let status = res.status();
            let text = res.text().await.unwrap_or_default();
            return Err(DevForgeError::Message(parse_error(&text, status.as_u16())));
        }
        let bytes = res
            .bytes()
            .await
            .map_err(|e| DevForgeError::Message(format!("snapshot body: {e}")))?;
        if !snapshot_acceptable(&bytes) {
            return Err(DevForgeError::Message("snapshot invalide".into()));
        }
        Ok(bytes.to_vec())
    }

    pub async fn push_snapshot(&self, secret: &str, generation: i64, bytes: &[u8]) -> Result<()> {
        let url = format!("{}/internal/cluster-snapshot", self.origin);
        let res = self
            .http
            .post(&url)
            .bearer_auth(secret)
            .header("x-devforge-generation", generation.to_string())
            .header("content-type", "application/octet-stream")
            .body(bytes.to_vec())
            .timeout(std::time::Duration::from_secs(20))
            .send()
            .await
            .map_err(|e| DevForgeError::Message(format!("push snapshot: {e}")))?;
        if !res.status().is_success() {
            let status = res.status();
            let text = res.text().await.unwrap_or_default();
            return Err(DevForgeError::Message(parse_error(&text, status.as_u16())));
        }
        Ok(())
    }

    pub async fn failover_status(&self, failover_secret: &str) -> Result<FailoverStatus> {
        let url = format!("{}/internal/failover/status", self.origin);
        let res = self
            .http
            .get(&url)
            .bearer_auth(failover_secret)
            .timeout(std::time::Duration::from_secs(8))
            .send()
            .await
            .map_err(|e| DevForgeError::Message(format!("failover status: {e}")))?;
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(DevForgeError::Message(parse_error(&text, status.as_u16())));
        }
        serde_json::from_str(&text)
            .map_err(|e| DevForgeError::Message(format!("failover JSON: {e}")))
    }

    pub async fn failover_quiesce(&self, failover_secret: &str) -> Result<QuiesceAck> {
        let url = format!("{}/internal/failover/quiesce", self.origin);
        let res = self
            .http
            .post(&url)
            .bearer_auth(failover_secret)
            .json(&serde_json::json!({}))
            .timeout(std::time::Duration::from_secs(20))
            .send()
            .await
            .map_err(|e| DevForgeError::Message(format!("failover quiesce: {e}")))?;
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(DevForgeError::Message(parse_error(&text, status.as_u16())));
        }
        serde_json::from_str(&text)
            .map_err(|e| DevForgeError::Message(format!("quiesce JSON: {e}")))
    }

    pub async fn failover_resume(&self, failover_secret: &str) -> Result<()> {
        let url = format!("{}/internal/failover/resume", self.origin);
        let res = self
            .http
            .post(&url)
            .bearer_auth(failover_secret)
            .json(&serde_json::json!({}))
            .timeout(std::time::Duration::from_secs(15))
            .send()
            .await
            .map_err(|e| DevForgeError::Message(format!("failover resume: {e}")))?;
        if !res.status().is_success() {
            let status = res.status();
            let text = res.text().await.unwrap_or_default();
            return Err(DevForgeError::Message(parse_error(&text, status.as_u16())));
        }
        Ok(())
    }

    pub async fn failover_demote(&self, failover_secret: &str, preferred_url: &str) -> Result<()> {
        let url = format!("{}/internal/failover/demote", self.origin);
        let res = self
            .http
            .post(&url)
            .bearer_auth(failover_secret)
            .json(&serde_json::json!({ "preferred_leader_url": preferred_url }))
            .send()
            .await
            .map_err(|e| DevForgeError::Message(format!("failover demote: {e}")))?;
        if !res.status().is_success() {
            let status = res.status();
            let text = res.text().await.unwrap_or_default();
            return Err(DevForgeError::Message(parse_error(&text, status.as_u16())));
        }
        Ok(())
    }

    pub async fn node_update_start(
        &self,
        secret: &str,
        target_version: Option<&str>,
    ) -> Result<serde_json::Value> {
        let url = format!("{}/internal/update/start", self.origin);
        let mut req = self
            .http
            .post(&url)
            .bearer_auth(secret)
            .timeout(std::time::Duration::from_secs(45));
        if let Some(v) = target_version.filter(|s| !s.trim().is_empty()) {
            req = req.json(&serde_json::json!({ "target_version": v }));
        } else {
            req = req.json(&serde_json::json!({}));
        }
        let res = req
            .send()
            .await
            .map_err(|e| DevForgeError::Message(format!("update start: {e}")))?;
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(DevForgeError::Message(parse_error(&text, status.as_u16())));
        }
        serde_json::from_str(&text).map_err(|e| DevForgeError::Message(format!("update JSON: {e}")))
    }

    pub async fn node_update_status(&self, secret: &str) -> Result<serde_json::Value> {
        let url = format!("{}/internal/update/status", self.origin);
        let res = self
            .http
            .get(&url)
            .bearer_auth(secret)
            .timeout(std::time::Duration::from_secs(8))
            .send()
            .await
            .map_err(|e| DevForgeError::Message(format!("update status: {e}")))?;
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(DevForgeError::Message(parse_error(&text, status.as_u16())));
        }
        serde_json::from_str(&text).map_err(|e| DevForgeError::Message(format!("update JSON: {e}")))
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

    #[test]
    fn snapshot_accepts_postgres_and_legacy_sqlite() {
        let mut pg = b"-- DevForge postgres snapshot\n".to_vec();
        pg.extend(std::iter::repeat(b'x').take(80));
        assert!(snapshot_acceptable(&pg));
        let mut sqlite = b"SQLite format 3\0".to_vec();
        sqlite.extend(std::iter::repeat(b'y').take(90));
        assert!(snapshot_acceptable(&sqlite));
        assert!(!snapshot_acceptable(b"-- DevForge postgres snapshot\nshort"));
    }
}
