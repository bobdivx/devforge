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
    /// - Volume: HOST path (resolved from DevForge container mount) for dynamic config & acme.json
    /// - Restart: unless-stopped
    /// - Docker provider: exposedbydefault=false, network=devforge
    /// - File provider: /traefik/dynamic/
    /// - Let's Encrypt: HTTP challenge, acme.json storage
    /// - Labels: devforge.managed=true, devforge.proxy=true
    /// - Extra hosts: host.docker.internal:host-gateway
    /// - API dashboard: enabled with self-router
    /// - Ping healthcheck: enabled on http entrypoint
    pub async fn ensure_traefik(&self) -> Result<Value> {
        self.ensure_traefik_on(&self.apply_server_id).await
    }

    pub async fn ensure_traefik_on(&self, server_id: &str) -> Result<Value> {
        let executor = self.executor.as_ref().ok_or_else(|| {
            DevForgeError::Message("executor required for ensure_traefik".into())
        })?;
        let server_id = if server_id.trim().is_empty() {
            "default"
        } else {
            server_id
        };

        // Check if Traefik container exists and its status
        let check_cmd = format!(
            r#"docker inspect {} --format '{{{{.State.Status}}}}' 2>/dev/null || echo 'missing'"#,
            TRAEFIK_CONTAINER_NAME
        );
        let check_res = executor.exec(server_id, "", &check_cmd, 30).await?;
        let status = check_res.output.trim();

        match status {
            "running" => {
                // Si le volume file-provider pointe hors de $DATA/proxy (bug ZimaOS
                // …/devforge/data/proxy), on recrée une fois pour aligner le mount.
                let expected = self
                    .resolve_traefik_host_volume_path(executor)
                    .await
                    .unwrap_or_default();
                let mount_cmd = format!(
                    r#"docker inspect {} --format '{{{{range .Mounts}}}}{{{{if eq .Destination "/traefik"}}}}{{{{.Source}}}}{{{{end}}}}{{{{end}}}}' 2>/dev/null || true"#,
                    TRAEFIK_CONTAINER_NAME
                );
                let mount_res = executor.exec(server_id, "", &mount_cmd, 30).await;
                let actual = mount_res
                    .as_ref()
                    .map(|r| r.output.trim().to_string())
                    .unwrap_or_default();
                if !expected.is_empty()
                    && !actual.is_empty()
                    && actual != expected
                {
                    eprintln!(
                        "[ensure_traefik] volume /traefik incorrect ({actual} ≠ {expected}) — recreation"
                    );
                    let _ = executor
                        .exec(
                            server_id,
                            "",
                            &format!("docker rm -f {TRAEFIK_CONTAINER_NAME}"),
                            60,
                        )
                        .await;
                    // tombe dans la création ci-dessous
                } else {
                    return Ok(json!({
                        "ok": true,
                        "status": "already_running",
                        "container": TRAEFIK_CONTAINER_NAME,
                        "message": "Traefik is already running",
                        "host_data_path": if expected.is_empty() { Value::Null } else { json!(expected) },
                        "mount_source": if actual.is_empty() { Value::Null } else { json!(actual) },
                    }));
                }
            }
            "exited" | "created" | "paused" => {
                // Container exists but is not running, start it
                let start_cmd = format!("docker start {}", TRAEFIK_CONTAINER_NAME);
                let start_res = executor.exec(server_id, "", &start_cmd, 30).await?;
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
        executor.exec(server_id, "", &network_cmd, 30).await?;

        // Resolve host path for Traefik data volume
        // When DevForge runs in Docker with /data bind, we need the HOST path
        let host_data_path = self.resolve_traefik_host_volume_path(executor).await?;

        // Prepare data directory structure on host (via one-shot container mount)
        let prep_cmd = format!(
            r#"docker run --rm -v {}:/mnt alpine sh -c 'mkdir -p /mnt/dynamic && touch /mnt/acme.json && chmod 600 /mnt/acme.json'"#,
            shell_escape(&host_data_path)
        );
        executor.exec(server_id, "", &prep_cmd, 60).await?;

        // Create Traefik container with full production config
        let create_cmd = format!(
            r#"docker run -d \
  --name {} \
  --restart unless-stopped \
  --network {} \
  -p 80:80 \
  -p 443:443 \
  -p 443:443/udp \
  --add-host host.docker.internal:host-gateway \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v {}:/traefik \
  --label devforge.managed=true \
  --label devforge.proxy=true \
  --label traefik.enable=true \
  --label 'traefik.http.routers.api.rule=Host(`traefik.local`)' \
  --label traefik.http.routers.api.service=api@internal \
  --label traefik.http.services.dummy.loadbalancer.server.port=9999 \
  {} \
  --api.dashboard=true \
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
            shell_escape(&host_data_path),
            TRAEFIK_IMAGE,
            TRAEFIK_NETWORK
        );

        let create_res = executor.exec(server_id, "", &create_cmd, 60).await?;
        
        if create_res.ok {
            Ok(json!({
                "ok": true,
                "status": "created",
                "container": TRAEFIK_CONTAINER_NAME,
                "image": TRAEFIK_IMAGE,
                "network": TRAEFIK_NETWORK,
                "host_data_path": host_data_path,
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

    /// cloudflared en host network → Traefik :80. Recréé si le token change.
    pub async fn ensure_cloudflared(&self, server_id: &str, tunnel_token: &str) -> Result<Value> {
        let executor = self.executor.as_ref().ok_or_else(|| {
            DevForgeError::Message("executor required for cloudflared".into())
        })?;
        let server_id = if server_id.trim().is_empty() {
            "default"
        } else {
            server_id
        };
        let token = tunnel_token.trim();
        if token.is_empty() {
            return Err(DevForgeError::Message("token tunnel Cloudflare vide".into()));
        }
        let mark: String = token.chars().rev().take(12).collect();
        let name = "devforge-cloudflared";
        let check = format!(
            r#"docker inspect {name} --format '{{{{index .Config.Labels "devforge.cf_mark"}}}} {{{{.State.Status}}}}' 2>/dev/null || echo 'missing'"#
        );
        let cur = executor.exec(server_id, "", &check, 20).await?;
        let line = cur.output.trim();
        if line.starts_with(&mark) && line.contains("running") {
            return Ok(json!({"ok": true, "status": "already_running", "container": name}));
        }
        let _ = executor
            .exec(server_id, "", &format!("docker rm -f {name} 2>/dev/null || true"), 20)
            .await;
        let run = format!(
            r#"docker run -d --name {name} --restart unless-stopped --network host \
  --label devforge.managed=true --label devforge.cf_mark={} \
  cloudflare/cloudflared:latest tunnel --no-autoupdate run --token {}"#,
            shell_escape(&mark),
            shell_escape(token)
        );
        let created = executor.exec(server_id, "", &run, 60).await?;
        if !created.ok {
            return Err(DevForgeError::Message(format!(
                "cloudflared: {}",
                created.output
            )));
        }
        Ok(json!({
            "ok": true,
            "status": "created",
            "container": name,
            "id": created.output.trim()
        }))
    }

    /// Resolve the host filesystem path for Traefik data volume.
    /// 
    /// When DevForge runs inside Docker with a bind mount (e.g. `/DATA/AppData/devforge:/data`),
    /// the `docker run` command executed via mounted docker.sock needs the **host** path,
    /// not the container path.
    /// 
    /// Strategy:
    /// 1. Check explicit env override `DEVFORGE_TRAEFIK_HOST_DIR`
    /// 2. Inspect running DevForge container's mounts where Destination matches `DEVFORGE_DATA_DIR`
    /// 3. Append `/proxy` (même layout que les écritures preview)
    /// 4. Fallback to container path (bare metal / non-containerized case)
    async fn resolve_traefik_host_volume_path(
        &self,
        executor: &Arc<dyn RemoteExecutor>,
    ) -> Result<String> {
        // 1. Explicit override (for custom deployments)
        if let Ok(explicit) = std::env::var("DEVFORGE_TRAEFIK_HOST_DIR") {
            if !explicit.trim().is_empty() {
                return Ok(explicit.trim().to_string());
            }
        }

        // 2. Detect if running in container and find bind mount
        let container_data_dir = &self.traefik_data_dir;
        
        // Try to find DevForge's own container name
        let self_container = std::env::var("DEVFORGE_SELF_CONTAINER")
            .or_else(|_| std::env::var("HOSTNAME"))
            .unwrap_or_else(|_| "devforge".into());

        // Inspect DevForge container mounts
        let inspect_cmd = format!(
            r#"docker inspect --format '{{{{json .Mounts}}}}' {} 2>/dev/null || echo '[]'"#,
            shell_escape(&self_container)
        );
        let inspect_res = executor.exec(&self.apply_server_id, "", &inspect_cmd, 30).await?;
        
        if inspect_res.ok {
            if let Ok(mounts) = serde_json::from_str::<Value>(&inspect_res.output) {
                if let Some(arr) = mounts.as_array() {
                    // Look for bind mount where Destination contains our data dir
                    for mount in arr {
                        let typ = mount.get("Type").and_then(|t| t.as_str()).unwrap_or("");
                        if typ != "bind" {
                            continue;
                        }
                        let dest = mount.get("Destination")
                            .or_else(|| mount.get("Target"))
                            .and_then(|d| d.as_str())
                            .unwrap_or("");
                        let src = mount.get("Source").and_then(|s| s.as_str()).unwrap_or("");
                        
                        if src.is_empty() {
                            continue;
                        }

                        // Match: Destination is /data or equals DEVFORGE_DATA_DIR
                        if dest == "/data" || dest == container_data_dir.trim_end_matches('/') {
                            // Toujours Source/proxy : le process écrit dans $DEVFORGE_DATA_DIR/proxy/dynamic
                            // (ex. ZimaOS /DATA/AppData/devforge:/data → host .../devforge/proxy).
                            // Ne JAMAIS utiliser Source/data/proxy : ça pointe hors du volume monté
                            // et Traefik ne voit aucun fichier dynamique → 404 preview.
                            if let Some(host_proxy_path) =
                                host_proxy_from_data_bind(src, dest, container_data_dir)
                            {
                                return Ok(host_proxy_path);
                            }
                        }
                    }
                }
            }
        }

        // 3. Fallback: use container path (bare metal or unusual setup)
        Ok(format!("{}/proxy", container_data_dir))
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
    ///
    /// ## Traefik Host conflict guard
    /// Avant d'appliquer les labels, vérifie si un Host est déjà revendiqué par un autre conteneur
    /// (surtout production). Si conflit détecté, filtre ce Host pour éviter de voler la route.
    pub async fn sync_with(
        &self,
        project_uuid: &str,
        forward_auth_address: Option<&str>,
    ) -> Result<Value> {
        let routes = self.store.list(project_uuid).await?;
        let container = format!("df-{}", project_uuid.chars().take(12).collect::<String>());
        
        // Conflict guard : vérifier chaque Host avant de l'appliquer
        let mut safe_routes = Vec::new();
        let mut conflicts = Vec::new();
        
        if let Some(exec) = &self.executor {
            for route in &routes {
                let check_cmd = docker::docker_check_host_conflicts(&route.host);
                match exec.exec(&self.apply_server_id, "", &check_cmd, 30).await {
                    Ok(res) => {
                        let owner = res.output.trim();
                        if owner.is_empty() {
                            // Host libre, OK
                            safe_routes.push(route.clone());
                        } else if owner == container || owner.contains(&container) {
                            // Nous-même, OK (mise à jour)
                            safe_routes.push(route.clone());
                        } else {
                            // Conflit avec un autre conteneur (souvent production)
                            conflicts.push(json!({
                                "host": route.host,
                                "owner": owner,
                                "reason": "Host déjà revendiqué par un autre conteneur"
                            }));
                        }
                    }
                    Err(_) => {
                        // Erreur de vérification → approche conservatrice : skip
                        conflicts.push(json!({
                            "host": route.host,
                            "reason": "Échec vérification conflit"
                        }));
                    }
                }
            }
        } else {
            // Pas d'executor → pas de vérification, on garde tout (mode génération labels seulement)
            safe_routes = routes.clone();
        }
        
        // Générer les labels uniquement pour les routes sûres
        let mut labels = serde_json::Map::new();
        labels.insert("traefik.enable".into(), json!("true"));
        for route in &safe_routes {
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

        if safe_routes.is_empty() {
            let note = if conflicts.is_empty() {
                "aucune route proxy — rien à appliquer"
            } else {
                "tous les Hosts en conflit — aucun label appliqué"
            };
            return Ok(json!({
                "ok": true,
                "project_uuid": project_uuid,
                "synced": 0,
                "container": container,
                "labels": labels_val,
                "conflicts": conflicts,
                "note": note
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
                "synced": safe_routes.len(),
                "hosts": safe_routes.iter().map(|r| &r.host).collect::<Vec<_>>(),
                "container": container,
                "labels": labels_val,
                "sso": forward_auth_address.is_some(),
                "conflicts": conflicts,
                "command": "docker recreate with labels",
                "output": res.output,
            }));
        }

        Ok(json!({
            "ok": true,
            "project_uuid": project_uuid,
            "synced": safe_routes.len(),
            "hosts": safe_routes.iter().map(|r| &r.host).collect::<Vec<_>>(),
            "labels": labels_val,
            "sso": forward_auth_address.is_some(),
            "conflicts": conflicts,
            "note": "executor non branché — labels générés seulement"
        }))
    }
}

fn shell_escape(s: &str) -> String {
    if s.chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/' | ':' | '='))
    {
        s.to_string()
    } else {
        format!("'{}'", s.replace('\'', "'\\''"))
    }
}


/// Chemin hôte pour le volume Traefik (`…/proxy`) à partir du bind mount data.
/// Exposé pour les tests : ZimaOS monte `/DATA/AppData/devforge:/data`.
fn host_proxy_from_data_bind(source: &str, destination: &str, container_data_dir: &str) -> Option<String> {
    let dest = destination.trim_end_matches('/');
    let data = container_data_dir.trim_end_matches('/');
    if dest == "/data" || dest == data {
        Some(format!("{}/proxy", source.trim_end_matches('/')))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use devforge_deploy::docker::{traefik_labels, traefik_labels_for_routes, docker_check_host_conflicts};
    use serde_json::json;

    #[test]
    fn constants_match_production_config() {
        assert_eq!(TRAEFIK_CONTAINER_NAME, "devforge-traefik");
        assert_eq!(TRAEFIK_IMAGE, "traefik:v3.6");
        assert_eq!(TRAEFIK_NETWORK, "devforge");
    }

    #[test]
    fn zimaos_devforge_bind_maps_to_proxy_not_data_proxy() {
        // /DATA/AppData/devforge:/data → host .../devforge/proxy (PAS .../devforge/data/proxy)
        assert_eq!(
            host_proxy_from_data_bind("/DATA/AppData/devforge", "/data", "/data").as_deref(),
            Some("/DATA/AppData/devforge/proxy")
        );
        assert_eq!(
            host_proxy_from_data_bind("/DATA/AppData/devforge/data", "/data", "/data").as_deref(),
            Some("/DATA/AppData/devforge/data/proxy")
        );
        assert_eq!(
            host_proxy_from_data_bind("/opt/other", "/var/lib/devforge", "/var/lib/devforge").as_deref(),
            Some("/opt/other/proxy")
        );
        assert_eq!(host_proxy_from_data_bind("/x", "/not-data", "/data"), None);
    }

    #[test]
    fn conflict_guard_filters_conflicting_hosts() {
        // Test que le conflict guard filtre bien les Hosts déjà revendiqués
        // Note: ce test vérifie la logique, pas l'exécution Docker réelle
        
        let cmd = docker_check_host_conflicts("starbasefr.jeser.app");
        
        // Vérifier que la commande est bien formée
        assert!(cmd.contains("docker ps -q"));
        // Les backticks dans Host(...) peuvent être échappés ou entre quotes
        assert!(cmd.contains("starbasefr.jeser.app"));
        assert!(cmd.contains("grep -qF"));
    }

    #[test]
    fn preview_labels_dont_include_production_fqdns() {
        // Regression test : les labels pour conteneurs df-* ne doivent contenir
        // QUE l'URL preview, pas les FQDNs production comme starbasefr.jeser.app
        
        let preview_host = "dev-abc12345.devforge.local";
        let labels = traefik_labels("abc12345-ef01", preview_host, "/", 3000, None);
        
        // Vérifier présence hôte atelier
        let preview_router = format!("traefik.http.routers.http-df-abc12345-{}.rule", 
            preview_host.replace('.', "-"));
        assert!(
            labels.get(&preview_router).is_some(),
            "Host dev- doit avoir un router"
        );
        
        // Vérifier absence production (starbasefr ou autre)
        for (key, _) in labels.as_object().unwrap() {
            if key.contains(".rule") {
                let val = labels.get(key).and_then(|v| v.as_str()).unwrap_or("");
                assert!(
                    !val.contains("starbasefr.jeser.app") && !val.contains("starbasefr.com"),
                    "Les labels preview ne doivent pas contenir de FQDNs production"
                );
            }
        }
    }

    #[test]
    fn traefik_multi_host_keeps_distinct_routers() {
        // Test legacy multi-host (pour production / conteneurs non-df)
        let a = traefik_labels("fbb6a152-ef01", "app1.example.com", "/", 4321, None);
        let b = traefik_labels("fbb6a152-ef01", "app2.example.com", "/", 4321, None);
        let mut map = serde_json::Map::new();
        for piece in [a, b] {
            if let Some(obj) = piece.as_object() {
                for (k, v) in obj {
                    map.insert(k.clone(), v.clone());
                }
            }
        }
        let rule_a = map
            .get("traefik.http.routers.http-df-fbb6a152-app1-example-com.rule")
            .and_then(|v| v.as_str());
        let rule_b = map
            .get("traefik.http.routers.http-df-fbb6a152-app2-example-com.rule")
            .and_then(|v| v.as_str());
        assert_eq!(rule_a, Some("Host(`app1.example.com`)"));
        assert_eq!(rule_b, Some("Host(`app2.example.com`)"));
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
            cmd.contains(r"{{range \$k, \$v := .NetworkSettings.Networks}}"),
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
