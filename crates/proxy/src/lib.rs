use async_trait::async_trait;
use devforge_deploy::{docker, RemoteExecutor};
use devforge_shared::{DevForgeError, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

const TRAEFIK_CONTAINER_NAME: &str = "devforge-traefik";
const TRAEFIK_IMAGE: &str = "traefik:v3.6";
const TRAEFIK_NETWORK: &str = "devforge";

/// Reverse-proxy route (labels / router rules).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyRoute {
    pub id: String,
    pub project_uuid: String,
    pub host: String,
    pub path_prefix: String,
    pub target_port: u16,
    pub https_redirect: bool,
}

#[async_trait]
pub trait ProxyStore: Send + Sync {
    async fn list(&self, project_uuid: &str) -> Result<Vec<ProxyRoute>>;
    async fn upsert(&self, route: ProxyRoute) -> Result<ProxyRoute>;
    async fn delete(&self, project_uuid: &str, id: &str) -> Result<bool>;
}

#[derive(Default, Clone)]
pub struct MemoryProxyStore {
    inner: Arc<RwLock<HashMap<String, Vec<ProxyRoute>>>>,
}

impl MemoryProxyStore {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl ProxyStore for MemoryProxyStore {
    async fn list(&self, project_uuid: &str) -> Result<Vec<ProxyRoute>> {
        Ok(self
            .inner
            .read()
            .await
            .get(project_uuid)
            .cloned()
            .unwrap_or_default())
    }

    async fn upsert(&self, mut route: ProxyRoute) -> Result<ProxyRoute> {
        if route.host.trim().is_empty() {
            return Err(DevForgeError::Message("host requis".into()));
        }
        if route.target_port == 0 {
            return Err(DevForgeError::Message("target_port invalide".into()));
        }
        if route.id.is_empty() {
            route.id = format!("px_{}", &Uuid::new_v4().to_string()[..8]);
        }
        if route.path_prefix.is_empty() {
            route.path_prefix = "/".into();
        }
        let mut guard = self.inner.write().await;
        let list = guard.entry(route.project_uuid.clone()).or_default();
        if let Some(existing) = list.iter_mut().find(|r| r.id == route.id) {
            *existing = route.clone();
        } else {
            list.push(route.clone());
        }
        Ok(route)
    }

    async fn delete(&self, project_uuid: &str, id: &str) -> Result<bool> {
        let mut guard = self.inner.write().await;
        if let Some(list) = guard.get_mut(project_uuid) {
            let before = list.len();
            list.retain(|r| r.id != id);
            return Ok(list.len() != before);
        }
        Ok(false)
    }
}

pub struct ProxyFacade {
    store: Arc<dyn ProxyStore>,
    executor: Option<Arc<dyn RemoteExecutor>>,
    /// server_id used when applying labels (default `default`).
    apply_server_id: String,
    /// Data directory for Traefik (dynamic config, acme.json)
    traefik_data_dir: String,
}

impl ProxyFacade {
    pub fn new(store: Arc<dyn ProxyStore>) -> Self {
        Self {
            store,
            executor: None,
            apply_server_id: "default".into(),
            traefik_data_dir: std::env::var("DEVFORGE_DATA_DIR")
                .unwrap_or_else(|_| "/var/lib/devforge".into()),
        }
    }

    pub fn with_executor(
        mut self,
        executor: Arc<dyn RemoteExecutor>,
        server_id: impl Into<String>,
    ) -> Self {
        self.executor = Some(executor);
        self.apply_server_id = server_id.into();
        self
    }

    pub fn with_data_dir(mut self, data_dir: impl Into<String>) -> Self {
        self.traefik_data_dir = data_dir.into();
        self
    }

    /// Ensure the Traefik reverse proxy container exists and is running.
    /// 
    /// This is the durable fix for production outages where the Traefik container
    /// was silently deleted, leaving apps unreachable despite being healthy.
    /// 
    /// ## Behavior:
    /// - If missing: creates the container with production config
    /// - If stopped: starts it
    /// - If running: returns immediately (no-op)
    /// 
    /// ## Container configuration:
    /// - Image: traefik:v3.6
    /// - Name: devforge-traefik
    /// - Network: devforge (created if missing)
    /// - Ports: 80:80, 443:443 (TCP+UDP)
    /// - Volume: data_dir/proxy for dynamic config & acme.json
    /// - Restart: unless-stopped
    /// - Docker provider: exposedbydefault=false, network=devforge
    /// - File provider: /traefik/dynamic/
    /// - Let's Encrypt: HTTP challenge, acme.json storage
    /// - Labels: devforge.managed=true, devforge.proxy=true
    pub async fn ensure_traefik(&self) -> Result<Value> {
        let executor = self.executor.as_ref().ok_or_else(|| {
            DevForgeError::Message("executor required for ensure_traefik".into())
        })?;

        // Check if Traefik container exists and its status
        let check_cmd = format!(
            r#"docker inspect {} --format '{{{{.State.Status}}}}' 2>/dev/null || echo 'missing'"#,
            TRAEFIK_CONTAINER_NAME
        );
        let check_res = executor.exec(&self.apply_server_id, "", &check_cmd, 30).await?;
        let status = check_res.output.trim();

        match status {
            "running" => {
                return Ok(json!({
                    "ok": true,
                    "status": "already_running",
                    "container": TRAEFIK_CONTAINER_NAME,
                    "message": "Traefik is already running"
                }));
            }
            "exited" | "created" | "paused" => {
                // Container exists but is not running, start it
                let start_cmd = format!("docker start {}", TRAEFIK_CONTAINER_NAME);
                let start_res = executor.exec(&self.apply_server_id, "", &start_cmd, 30).await?;
                if start_res.ok {
                    return Ok(json!({
                        "ok": true,
                        "status": "started",
                        "container": TRAEFIK_CONTAINER_NAME,
                        "previous_state": status,
                        "message": "Traefik container was stopped, now started"
                    }));
                } else {
                    return Err(DevForgeError::Message(format!(
                        "Failed to start Traefik: {}",
                        start_res.output
                    )));
                }
            }
            _ => {
                // Container is missing, create it
            }
        }

        // Ensure devforge network exists
        let network_cmd = format!(
            r#"docker network inspect {} >/dev/null 2>&1 || docker network create {}"#,
            TRAEFIK_NETWORK, TRAEFIK_NETWORK
        );
        executor.exec(&self.apply_server_id, "", &network_cmd, 30).await?;

        // Prepare data directory structure
        let data_dir = format!("{}/proxy", self.traefik_data_dir);
        let dynamic_dir = format!("{}/dynamic", data_dir);
        let acme_file = format!("{}/acme.json", data_dir);
        
        let prep_dirs_cmd = format!(
            r#"mkdir -p {} && touch {} && chmod 600 {}"#,
            dynamic_dir, acme_file, acme_file
        );
        executor.exec(&self.apply_server_id, "", &prep_dirs_cmd, 30).await?;

        // Create Traefik container with full production config
        let create_cmd = format!(
            r#"docker run -d \
  --name {} \
  --restart unless-stopped \
  --network {} \
  -p 80:80 \
  -p 443:443 \
  -p 443:443/udp \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v {}:/traefik \
  --label devforge.managed=true \
  --label devforge.proxy=true \
  --label traefik.enable=true \
  --label traefik.http.routers.api.rule='Host(`traefik.local`)' \
  --label traefik.http.routers.api.service=api@internal \
  --label traefik.http.services.dummy.loadbalancer.server.port=9999 \
  {} \
  --api.dashboard=false \
  --log.level=INFO \
  --accesslog=false \
  --entrypoints.http.address=:80 \
  --entrypoints.https.address=:443 \
  --providers.docker=true \
  --providers.docker.exposedbydefault=false \
  --providers.docker.network={} \
  --providers.file.directory=/traefik/dynamic \
  --providers.file.watch=true \
  --certificatesresolvers.letsencrypt.acme.httpchallenge=true \
  --certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=http \
  --certificatesresolvers.letsencrypt.acme.email=admin@devforge.local \
  --certificatesresolvers.letsencrypt.acme.storage=/traefik/acme.json \
  --ping=true \
  --ping.entrypoint=http"#,
            TRAEFIK_CONTAINER_NAME,
            TRAEFIK_NETWORK,
            data_dir,
            TRAEFIK_IMAGE,
            TRAEFIK_NETWORK
        );

        let create_res = executor.exec(&self.apply_server_id, "", &create_cmd, 60).await?;
        
        if create_res.ok {
            Ok(json!({
                "ok": true,
                "status": "created",
                "container": TRAEFIK_CONTAINER_NAME,
                "image": TRAEFIK_IMAGE,
                "network": TRAEFIK_NETWORK,
                "data_dir": data_dir,
                "message": "Traefik container created and started",
                "container_id": create_res.output.trim()
            }))
        } else {
            Err(DevForgeError::Message(format!(
                "Failed to create Traefik container: {}",
                create_res.output
            )))
        }
    }

    pub async fn list(&self, project_uuid: &str) -> Result<Value> {
        Ok(json!({"ok": true, "routes": self.store.list(project_uuid).await?}))
    }

    pub async fn upsert(&self, route: ProxyRoute) -> Result<Value> {
        Ok(json!({"ok": true, "route": self.store.upsert(route).await?}))
    }

    pub async fn delete(&self, project_uuid: &str, id: &str) -> Result<Value> {
        Ok(json!({"ok": self.store.delete(project_uuid, id).await?}))
    }

    /// Generate Traefik labels and apply via `docker update` when an executor is wired.
    pub async fn sync(&self, project_uuid: &str) -> Result<Value> {
        self.sync_with(project_uuid, None).await
    }

    /// Comme [`sync`], avec ForwardAuth SSO optionnel (adresse oauth2-proxy / TinyAuth).
    /// Applique **tous** les hosts (primary + alias) via recreate conteneur (labels Docker immuables).
    pub async fn sync_with(
        &self,
        project_uuid: &str,
        forward_auth_address: Option<&str>,
    ) -> Result<Value> {
        let routes = self.store.list(project_uuid).await?;
        let mut labels = serde_json::Map::new();
        labels.insert("traefik.enable".into(), json!("true"));
        for route in &routes {
            let piece = docker::traefik_labels(
                project_uuid,
                &route.host,
                &route.path_prefix,
                route.target_port,
                forward_auth_address,
            );
            if let Some(obj) = piece.as_object() {
                for (k, v) in obj {
                    if k == "traefik.enable" {
                        continue;
                    }
                    labels.insert(k.clone(), v.clone());
                }
            }
        }
        let labels_val = Value::Object(labels.clone());
        let container = format!("df-{}", project_uuid.chars().take(12).collect::<String>());

        if routes.is_empty() {
            return Ok(json!({
                "ok": true,
                "project_uuid": project_uuid,
                "synced": 0,
                "container": container,
                "labels": labels_val,
                "note": "aucune route proxy — rien à appliquer"
            }));
        }

        if let Some(exec) = &self.executor {
            let cmd = docker::docker_recreate_with_labels(&container, &labels_val);
            let res = exec
                .exec(&self.apply_server_id, "", &cmd, 120)
                .await?;
            return Ok(json!({
                "ok": res.ok,
                "project_uuid": project_uuid,
                "synced": routes.len(),
                "hosts": routes.iter().map(|r| &r.host).collect::<Vec<_>>(),
                "container": container,
                "labels": labels_val,
                "sso": forward_auth_address.is_some(),
                "command": "docker recreate with labels",
                "output": res.output,
            }));
        }

        Ok(json!({
            "ok": true,
            "project_uuid": project_uuid,
            "synced": routes.len(),
            "hosts": routes.iter().map(|r| &r.host).collect::<Vec<_>>(),
            "labels": labels_val,
            "sso": forward_auth_address.is_some(),
            "note": "executor non branché — labels générés seulement"
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use devforge_deploy::docker::{traefik_labels, traefik_labels_for_routes};
    use serde_json::json;

    #[test]
    fn constants_match_production_config() {
        assert_eq!(TRAEFIK_CONTAINER_NAME, "devforge-traefik");
        assert_eq!(TRAEFIK_IMAGE, "traefik:v3.6");
        assert_eq!(TRAEFIK_NETWORK, "devforge");
    }

    #[test]
    fn traefik_multi_host_keeps_distinct_routers() {
        let a = traefik_labels("fbb6a152-ef01", "starbasefr.jeser.app", "/", 4321, None);
        let b = traefik_labels("fbb6a152-ef01", "starbasefr.com", "/", 4321, None);
        let mut map = serde_json::Map::new();
        for piece in [a, b] {
            if let Some(obj) = piece.as_object() {
                for (k, v) in obj {
                    map.insert(k.clone(), v.clone());
                }
            }
        }
        let rule_jeser = map
            .get("traefik.http.routers.http-df-fbb6a152-starbasefr-jeser-app.rule")
            .and_then(|v| v.as_str());
        let rule_com = map
            .get("traefik.http.routers.http-df-fbb6a152-starbasefr-com.rule")
            .and_then(|v| v.as_str());
        assert_eq!(rule_jeser, Some("Host(`starbasefr.jeser.app`)"));
        assert_eq!(rule_com, Some("Host(`starbasefr.com`)"));
        assert_eq!(
            map.get("traefik.http.services.df-fbb6a152.loadbalancer.server.port"),
            Some(&json!("4321"))
        );
    }

    #[test]
    fn docker_update_labels_recreates_not_label_add() {
        let labels = json!({"traefik.enable": "true"});
        let cmd = docker::docker_update_labels("df-fbb6a152-ef0", &labels);
        assert!(cmd.contains("docker run"));
        assert!(!cmd.contains("--label-add"));
        assert!(cmd.contains("traefik.enable"));
    }

    #[test]
    fn docker_recreate_network_template_has_space_after_comma() {
        let labels = json!({"traefik.enable": "true"});
        let cmd = docker::docker_recreate_with_labels("test-container", &labels);
        assert!(
            cmd.contains("{{range $k, $v := .NetworkSettings.Networks}}"),
            "Network template must have space after comma to avoid Docker template parse error"
        );
        assert!(
            !cmd.contains("{{range $k,$v :="),
            "Network template should not have comma without space"
        );
    }

    #[test]
    fn docker_recreate_preserves_host_labels_with_backticks() {
        let labels = json!({
            "traefik.enable": "true",
            "traefik.http.routers.test.rule": "Host(`starbasefr.jeser.app`)"
        });
        let cmd = docker::docker_recreate_with_labels("df-test", &labels);
        assert!(
            cmd.contains("Host(`starbasefr.jeser.app`)"),
            "Host label with backticks must survive in heredoc"
        );
        assert!(
            cmd.contains("set -- \"$@\" --label"),
            "Must use positional parameters to protect backticks from command substitution"
        );
        assert!(
            !cmd.contains("LABEL_ARGS=") || cmd.contains("set -- "),
            "If using intermediate storage, must switch to positional params before docker run"
        );
    }

    #[test]
    fn docker_recreate_uses_network_when_not_bridge() {
        let labels = json!({"traefik.enable": "true"});
        let cmd = docker::docker_recreate_with_labels("test-app", &labels);
        assert!(
            cmd.contains(r#"[ "$NET" != "bridge" ]"#),
            "Should skip --network flag if bridge (default network)"
        );
        assert!(
            cmd.contains("--network \"$NET\"") || cmd.contains(r#"set -- "$@" --network "$NET""#),
            "Should add --network argument for non-bridge networks"
        );
    }

    #[test]
    fn docker_recreate_with_traefik_host_labels_shell_valid() {
        let labels = traefik_labels(
            "fbb6a152-ef01",
            "starbasefr.jeser.app",
            "/",
            4321,
            None,
        );
        let cmd = docker::docker_recreate_with_labels("df-fbb6a152-ef0", &labels);
        
        let temp_dir = std::env::temp_dir();
        let script_path = temp_dir.join("test_recreate_labels.sh");
        std::fs::write(&script_path, &cmd).expect("failed to write test script");
        
        let output = std::process::Command::new("sh")
            .arg("-n")
            .arg(&script_path)
            .output()
            .expect("failed to run sh -n");
        
        std::fs::remove_file(&script_path).ok();
        
        assert!(
            output.status.success(),
            "Generated shell script has syntax errors:\n{}\n\nScript:\n{}",
            String::from_utf8_lossy(&output.stderr),
            cmd
        );
        
        assert!(cmd.contains("starbasefr.jeser.app"));
        assert!(cmd.contains("4321"));
    }

    #[test]
    fn docker_recreate_multi_host_labels_shell_valid() {
        let labels = traefik_labels_for_routes(
            "fbb6a152-ef01",
            &[
                ("starbasefr.jeser.app", "/", 4321),
                ("starbasefr.com", "/api", 4321),
            ],
            None,
        );
        let cmd = docker::docker_recreate_with_labels("df-fbb6a152-ef0", &labels);
        
        let temp_dir = std::env::temp_dir();
        let script_path = temp_dir.join("test_recreate_multi_labels.sh");
        std::fs::write(&script_path, &cmd).expect("failed to write test script");
        
        let output = std::process::Command::new("sh")
            .arg("-n")
            .arg(&script_path)
            .output()
            .expect("failed to run sh -n");
        
        std::fs::remove_file(&script_path).ok();
        
        assert!(
            output.status.success(),
            "Multi-host script has syntax errors:\n{}\n\nScript:\n{}",
            String::from_utf8_lossy(&output.stderr),
            cmd
        );
        
        assert!(cmd.contains("starbasefr.jeser.app"));
        assert!(cmd.contains("starbasefr.com"));
    }

    #[test]
    fn docker_recreate_with_sso_middleware_shell_valid() {
        let labels = traefik_labels(
            "fbb6a152-ef01",
            "secure.example.com",
            "/",
            8080,
            Some("http://oauth2-proxy:4180/auth"),
        );
        let cmd = docker::docker_recreate_with_labels("df-secure", &labels);
        
        let temp_dir = std::env::temp_dir();
        let script_path = temp_dir.join("test_recreate_sso_labels.sh");
        std::fs::write(&script_path, &cmd).expect("failed to write test script");
        
        let output = std::process::Command::new("sh")
            .arg("-n")
            .arg(&script_path)
            .output()
            .expect("failed to run sh -n");
        
        std::fs::remove_file(&script_path).ok();
        
        assert!(
            output.status.success(),
            "SSO middleware script has syntax errors:\n{}\n\nScript:\n{}",
            String::from_utf8_lossy(&output.stderr),
            cmd
        );
        
        assert!(cmd.contains("forwardauth.address"));
    }
}
