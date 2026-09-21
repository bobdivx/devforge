use async_trait::async_trait;
use devforge_deploy::docker::dev_container_name;
use devforge_shared::{Result, Tool};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::time::Duration;

/// Tool pour démarrer un serveur de développement local (preview workdir).
pub struct StartLocalPreviewTool {
    pub pool: Arc<SqlitePool>,
}

/// Arrête le serveur de dev atelier (process local, pas de conteneur df-dev-*).
pub struct StopLocalPreviewTool {
    pub pool: Arc<SqlitePool>,
}

/// État du serveur de dev atelier (port, pid, URL).
pub struct LocalPreviewStatusTool {
    pub pool: Arc<SqlitePool>,
}

struct PreviewContext {
    uuid: String,
    workdir: String,
    /// Port du `npm run dev` (Vite 5173, Astro 4321, Next 3000) — pas le port production.
    port: u16,
    /// Port du conteneur production (`projects.port`, souvent 80 pour un static/nginx).
    production_port: u16,
    preview_url: Option<String>,
}

#[async_trait]
impl Tool for StartLocalPreviewTool {
    fn name(&self) -> &str {
        "start_local_preview"
    }

    fn description(&self) -> &str {
        "Démarre (ou relance) le serveur de développement de l’atelier pour le workdir du projet.\n\
         \n\
         Mode atelier : process local (`npm run dev`, pas de conteneur Docker df-dev-*).\n\
         Injecte par défaut les variables d’environnement déjà enregistrées sur le projet DevForge.\n\
         Expose l’app sur https://dev-{8chars}.{wildcard_domain} via Traefik (file provider).\n\
         \n\
         OBLIGATOIRE après des write_project_file locaux, avant de demander une PR.\n\
         \n\
         Paramètres :\n\
         - project_uuid : UUID du projet DevForge\n\
         - command : commande custom (optionnel, auto-détecté selon stack)\n\
         - force : true pour redémarrer même si le port répond déjà"
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_uuid": {
                    "type": "string",
                    "description": "UUID du projet DevForge"
                },
                "command": {
                    "type": "string",
                    "description": "Commande de démarrage custom (optionnel)"
                },
                "force": {
                    "type": "boolean",
                    "description": "Redémarrer même si le serveur semble déjà actif"
                }
            },
            "required": ["project_uuid"]
        })
    }

    async fn execute(&self, arguments: Value) -> Result<Value> {
        let force = arguments
            .get("force")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let custom_command = arguments
            .get("command")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty());

        let ctx = resolve_preview_context(self.pool.as_ref(), &arguments).await?;
        let workdir_path = Path::new(&ctx.workdir);

        let command = if let Some(cmd) = custom_command {
            cmd.to_string()
        } else {
            detect_dev_command(workdir_path, ctx.port)?
        };

        cleanup_legacy_dev_container(&ctx.uuid);

        let Some(preview_url) = ctx.preview_url.clone() else {
            return Ok(json!({
                "ok": false,
                "error": "Domaine wildcard manquant. Configure Settings → Domaine (wildcard) pour exposer https://dev-{uuid}.{domaine}.",
                "hint": "Sans domaine, l’atelier ne peut pas publier une URL publique."
            }));
        };

        if !force && port_is_open(ctx.port).await {
            let upstream = write_dev_traefik_dynamic(&preview_url, &ctx.uuid, ctx.port)
                .unwrap_or_else(|_| dev_preview_upstream_url(ctx.port));
            // Laisse Traefik recharger si le yaml vient d’être réécrit
            tokio::time::sleep(Duration::from_millis(600)).await;
            let (public_ok, public_status, _public_detail) =
                public_preview_health(&preview_url).await;
            let logs_tail = read_preview_logs(workdir_path, 40);
            if public_ok {
                return Ok(json!({
                    "ok": true,
                    "command": command,
                    "workdir": ctx.workdir,
                    "port": ctx.port,
                    "production_port": ctx.production_port,
                    "pid": read_preview_pid(workdir_path),
                    "preview_url": preview_url,
                    "local_url": format!("http://127.0.0.1:{}", ctx.port),
                    "upstream": upstream,
                    "mode": "process",
                    "status": "running",
                    "reused": true,
                    "public_ok": true,
                    "public_status": public_status,
                    "logs_tail": logs_tail,
                    "message": format!("✓ Serveur atelier déjà actif + URL publique OK : {preview_url} (port {})", ctx.port),
                    "hint": "Utilise force=true ou le bouton Redémarrer pour relancer après des changements."
                }));
            }
            // Port local OK mais Traefik 404/502 → pas de reuse : on redémarre (même sans force)
            eprintln!(
                "[start_local_preview] port {} ouvert mais URL publique KO (status={:?}) — redémarrage",
                ctx.port, public_status
            );
        }

        let project_env = load_project_env_vars(self.pool.as_ref(), &ctx.uuid).await;
        // Clone env projet → workdir `.env` (isolation ; purge si vide).
        let _ = devforge_env::materialize_dotenv_file(workdir_path, &project_env);
        let env_keys: Vec<String> = project_env_for_preview(&project_env)
            .into_iter()
            .map(|(k, _)| k)
            .collect();

        let npm_install = match ensure_node_modules(workdir_path, &project_env).await {
            Ok(did) => did,
            Err(e) => {
                return Ok(json!({
                    "ok": false,
                    "error": format!("npm install a échoué : {e}"),
                    "command": command,
                    "workdir": ctx.workdir,
                    "port": ctx.port,
                    "production_port": ctx.production_port,
                    "npm_install": false,
                    "logs_tail": read_preview_logs(workdir_path, 40),
                    "hint": "Premier démarrage : npm i dans le workdir. Vérifie que Node.js/npm est disponible."
                }));
            }
        };

        let _ = stop_preview(workdir_path, ctx.port);

        let pid = match spawn_preview(
            workdir_path,
            ctx.port,
            &command,
            Some(preview_url.as_str()),
            &project_env,
        )
        {
            Ok(pid) => pid,
            Err(e) => {
                return Ok(json!({
                    "ok": false,
                    "error": format!("Impossible de démarrer la preview : {e}"),
                    "command": command,
                    "workdir": ctx.workdir,
                    "port": ctx.port,
                    "production_port": ctx.production_port,
                    "npm_install": npm_install
                }));
            }
        };

        let wait = wait_for_preview(ctx.port, pid, workdir_path, Duration::from_secs(45)).await;
        let bound_port = match wait {
            PreviewWait::Ready { port } => port,
            PreviewWait::ProcessExited => {
                let tail = read_preview_logs(workdir_path, 40);
                return Ok(json!({
                    "ok": false,
                    "error": format!(
                        "Le process de preview s’est arrêté (pid={pid}) avant d’écouter sur le port {}.",
                        ctx.port
                    ),
                    "command": command,
                    "workdir": ctx.workdir,
                    "port": ctx.port,
                    "production_port": ctx.production_port,
                    "pid": pid,
                    "preview_url": preview_url,
                    "local_url": format!("http://127.0.0.1:{}", ctx.port),
                    "mode": "process",
                    "status": "stopped",
                    "logs_tail": tail,
                    "hint": preview_port_hint(ctx.production_port, ctx.port)
                }));
            }
            PreviewWait::Timeout => {
                let tail = read_preview_logs(workdir_path, 40);
                return Ok(json!({
                    "ok": false,
                    "error": format!(
                        "Le serveur a démarré (pid={pid}) mais le port {} ne répond pas après 45s.",
                        ctx.port
                    ),
                    "command": command,
                    "workdir": ctx.workdir,
                    "port": ctx.port,
                    "production_port": ctx.production_port,
                    "pid": pid,
                    "preview_url": preview_url,
                    "local_url": format!("http://127.0.0.1:{}", ctx.port),
                    "mode": "process",
                    "status": "starting",
                    "logs_tail": tail,
                    "hint": preview_port_hint(ctx.production_port, ctx.port)
                }));
            }
        };

        let local_url = format!("http://127.0.0.1:{bound_port}");

        let upstream = match write_dev_traefik_dynamic(&preview_url, &ctx.uuid, bound_port) {
            Ok(u) => u,
            Err(e) => {
                eprintln!("[start_local_preview] traefik dynamic: {e}");
                dev_preview_upstream_url(bound_port)
            }
        };

        // Laisse Traefik recharger le file provider
        tokio::time::sleep(Duration::from_millis(800)).await;
        let (public_ok, public_status, public_detail) =
            public_preview_health(&preview_url).await;
        let logs_tail = read_preview_logs(workdir_path, 60);

        if !public_ok {
            return Ok(json!({
                "ok": false,
                "error": format!(
                    "Process démarré (pid={pid}, port {bound_port}) mais URL publique KO : {public_detail}"
                ),
                "command": command,
                "workdir": ctx.workdir,
                "port": bound_port,
                "requested_port": ctx.port,
                "production_port": ctx.production_port,
                "pid": pid,
                "preview_url": preview_url,
                "local_url": local_url,
                "upstream": upstream,
                "mode": "process",
                "status": "degraded",
                "reused": false,
                "npm_install": npm_install,
                "public_ok": false,
                "public_status": public_status,
                "logs_tail": logs_tail,
                "hint": "Traefik n’atteint pas le process. Upstream attendu = conteneur DevForge (DEVFORGE_SELF_CONTAINER). Évite host.docker.internal si npm tourne dans le conteneur."
            }));
        }

        let mut message = if npm_install {
            format!("✓ Dépendances installées, serveur atelier prêt : {preview_url} (port {bound_port})")
        } else {
            format!("✓ Serveur atelier prêt : {preview_url} (port {bound_port})")
        };
        if !env_keys.is_empty() {
            message.push_str(&format!(
                " · {} variable{} DevForge",
                env_keys.len(),
                if env_keys.len() > 1 { "s" } else { "" }
            ));
        }

        Ok(json!({
            "ok": true,
            "command": command,
            "workdir": ctx.workdir,
            "port": bound_port,
            "requested_port": ctx.port,
            "production_port": ctx.production_port,
            "pid": pid,
            "preview_url": preview_url,
            "local_url": local_url,
            "upstream": upstream,
            "mode": "process",
            "status": "running",
            "reused": false,
            "npm_install": npm_install,
            "env_count": env_keys.len(),
            "env_keys": env_keys,
            "public_ok": true,
            "public_status": public_status,
            "logs_tail": logs_tail,
            "message": message,
            "hint": "Ouvre Preview dans le workspace. Production reste sur le conteneur df-* séparé."
        }))
    }
}

#[async_trait]
impl Tool for StopLocalPreviewTool {
    fn name(&self) -> &str {
        "stop_local_preview"
    }

    fn description(&self) -> &str {
        "Arrête le serveur de dev atelier (process npm run dev). Ne touche pas au déploiement production."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_uuid": { "type": "string" }
            },
            "required": ["project_uuid"]
        })
    }

    async fn execute(&self, arguments: Value) -> Result<Value> {
        let ctx = resolve_preview_context(self.pool.as_ref(), &arguments).await?;
        let workdir_path = Path::new(&ctx.workdir);
        let _ = stop_preview(workdir_path, ctx.port);
        remove_dev_traefik_dynamic(&ctx.uuid);
        cleanup_legacy_dev_container(&ctx.uuid);

        Ok(json!({
            "ok": true,
            "status": "stopped",
            "port": ctx.port,
            "workdir": ctx.workdir,
            "message": "Serveur atelier arrêté."
        }))
    }
}

#[async_trait]
impl Tool for LocalPreviewStatusTool {
    fn name(&self) -> &str {
        "local_preview_status"
    }

    fn description(&self) -> &str {
        "Retourne l’état du serveur de dev atelier (running/stopped, port, pid, URL)."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_uuid": { "type": "string" }
            },
            "required": ["project_uuid"]
        })
    }

    async fn execute(&self, arguments: Value) -> Result<Value> {
        let ctx = resolve_preview_context(self.pool.as_ref(), &arguments).await?;
        let workdir_path = Path::new(&ctx.workdir);
        let running = port_is_open(ctx.port).await;
        let pid = read_preview_pid(workdir_path);
        let logs_tail = read_preview_logs(workdir_path, 40);
        let upstream = if running {
            Some(dev_preview_upstream_url(ctx.port))
        } else {
            None
        };
        let (public_ok, public_status) = if let Some(ref url) = ctx.preview_url {
            if running {
                let (ok, status, _) = public_preview_health(url).await;
                (Some(ok), status)
            } else {
                (Some(false), None)
            }
        } else {
            (None, None)
        };

        Ok(json!({
            "ok": true,
            "status": if running && public_ok.unwrap_or(true) {
                "running"
            } else if running {
                "degraded"
            } else {
                "stopped"
            },
            "port": ctx.port,
            "production_port": ctx.production_port,
            "pid": pid,
            "preview_url": ctx.preview_url,
            "local_url": format!("http://127.0.0.1:{}", ctx.port),
            "upstream": upstream,
            "mode": "process",
            "workdir": ctx.workdir,
            "public_ok": public_ok,
            "public_status": public_status,
            "logs_tail": logs_tail,
        }))
    }
}

async fn resolve_preview_context(
    pool: &SqlitePool,
    arguments: &Value,
) -> Result<PreviewContext> {
    let project_uuid = arguments
        .get("project_uuid")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if project_uuid.is_empty() {
        return Err(devforge_shared::DevForgeError::Message(
            "project_uuid requis".into(),
        ));
    }

    let project: Option<(String, Option<String>, i64, String)> = sqlx::query_as(
        "SELECT uuid, workdir, port, name FROM projects WHERE uuid = ?",
    )
    .bind(project_uuid)
    .fetch_optional(pool)
    .await
    .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;

    let Some((uuid, workdir_opt, port_i, _name)) = project else {
        return Err(devforge_shared::DevForgeError::NotFound(format!(
            "Projet introuvable : {project_uuid}"
        )));
    };

    let mut workdir_raw = workdir_opt.as_deref().unwrap_or("").trim().to_string();
    if workdir_raw.is_empty() {
        workdir_raw = format!("/data/devforge/applications/{uuid}");
        let _ = sqlx::query("UPDATE projects SET workdir = ?, updated_at = datetime('now') WHERE uuid = ?")
            .bind(&workdir_raw)
            .bind(&uuid)
            .execute(pool)
            .await;
    }

    let workdir = devforge_deploy::resolve_project_workdir(&workdir_raw, &uuid);
    let workdir_path = Path::new(&workdir);
    if !workdir_path.exists() {
        std::fs::create_dir_all(workdir_path).map_err(|e| {
            devforge_shared::DevForgeError::Message(format!(
                "Impossible de créer le workdir {workdir} : {e}"
            ))
        })?;
    }

    let preview_url = resolve_dev_url(pool, &uuid).await?;
    let production_port: u16 = if port_i >= 1 && port_i <= 65535 {
        port_i as u16
    } else {
        0
    };
    // `projects.port` = port du conteneur production (80 pour nginx/static).
    // Le serveur de dev (Vite/Astro/Next) écoute ailleurs : on le lit depuis package.json.
    let port = resolve_preview_port(workdir_path, production_port);

    Ok(PreviewContext {
        uuid,
        workdir,
        port,
        production_port,
        preview_url,
    })
}

async fn resolve_dev_url(pool: &SqlitePool, project_uuid: &str) -> Result<Option<String>> {
    let domain: Option<(String,)> =
        sqlx::query_as("SELECT wildcard_domain FROM instance_settings WHERE id = 1")
            .fetch_optional(pool)
            .await
            .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;
    let Some((domain,)) = domain else {
        return Ok(None);
    };
    let domain = domain.trim().trim_start_matches('.').to_lowercase();
    if domain.is_empty() {
        return Ok(None);
    }
    let short: String = project_uuid.chars().take(8).collect();
    Ok(Some(format!("https://dev-{short}.{domain}")))
}

/// Supprime d’anciens conteneurs df-dev-* (mode legacy).
fn cleanup_legacy_dev_container(uuid: &str) {
    if !docker_cli_available() {
        return;
    }
    let name = dev_container_name(uuid);
    let _ = Command::new("docker")
        .args(["rm", "-f", &name])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

fn docker_cli_available() -> bool {
    Command::new("docker")
        .args(["info"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn dev_preview_dynamic_file(project_uuid: &str) -> PathBuf {
    let base = std::env::var("DEVFORGE_DATA_DIR").unwrap_or_else(|_| "/var/lib/devforge".into());
    let short: String = project_uuid.chars().take(8).collect();
    PathBuf::from(base.trim_end_matches(['/', '\\']))
        .join("proxy")
        .join("dynamic")
        .join(format!("dev-{short}.yaml"))
}

fn dev_preview_upstream_url(port: u16) -> String {
    if let Ok(host) = std::env::var("DEVFORGE_DEV_PREVIEW_UPSTREAM_HOST") {
        let host = host.trim();
        if !host.is_empty() {
            let host = host
                .trim_start_matches("http://")
                .trim_start_matches("https://");
            return format!("http://{host}:{port}");
        }
    }
    // Mode explicite : self | host
    let mode = std::env::var("DEVFORGE_DEV_PREVIEW_UPSTREAM_MODE")
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if mode == "host" {
        return format!("http://host.docker.internal:{port}");
    }
    // Défaut : process preview dans le conteneur DevForge → Traefik joint via nom Docker.
    if let Ok(self_container) = std::env::var("DEVFORGE_SELF_CONTAINER") {
        let name = self_container.trim();
        if !name.is_empty() {
            return format!("http://{name}:{port}");
        }
    }
    // Hostname du conteneur (souvent = container_name)
    if Path::new("/.dockerenv").exists() {
        if let Ok(hn) = std::fs::read_to_string("/etc/hostname") {
            let hn = hn.trim();
            if !hn.is_empty() && hn != "localhost" {
                return format!("http://{hn}:{port}");
            }
        }
        // Dernier recours en Docker : IP de l’interface eth0 du conteneur
        if let Some(ip) = container_eth0_ip() {
            return format!("http://{ip}:{port}");
        }
    }
    format!("http://host.docker.internal:{port}")
}

fn container_eth0_ip() -> Option<String> {
    let out = Command::new("hostname")
        .arg("-i")
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout);
    s.split_whitespace()
        .find(|p| p.contains('.') && !p.starts_with("127."))
        .map(|s| s.to_string())
}

/// Healthcheck HTTP sur l’URL publique Traefik (404 = pas ok).
async fn public_preview_health(url: &str) -> (bool, Option<u16>, String) {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .danger_accept_invalid_certs(true)
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent("DevForge-Preview-Health/2.0")
        .build()
    {
        Ok(c) => c,
        Err(e) => return (false, None, e.to_string()),
    };
    match client.get(url).send().await {
        Ok(r) => {
            let status = r.status().as_u16();
            // 404 Traefik / 502 bad gateway = preview publique KO
            let ok = (200..400).contains(&status);
            let msg = if ok {
                format!("HTTP {status}")
            } else {
                format!("HTTP {status} — URL publique inaccessible")
            };
            (ok, Some(status), msg)
        }
        Err(e) => (false, None, e.to_string()),
    }
}

fn host_from_preview_url(preview_url: &str) -> Option<String> {
    preview_url
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .split('/')
        .next()
        .filter(|h| !h.is_empty())
        .map(|s| s.to_string())
}

fn write_dev_traefik_dynamic(
    preview_url: &str,
    project_uuid: &str,
    port: u16,
) -> std::result::Result<String, String> {
    let host = host_from_preview_url(preview_url).ok_or_else(|| "hôte dev- invalide".to_string())?;
    let short: String = project_uuid.chars().take(8).collect();
    let service = format!("dfdev-{short}");
    let upstream = dev_preview_upstream_url(port);

    let yaml = format!(
        r#"http:
  routers:
    {service}-http:
      rule: "Host(`{host}`)"
      entryPoints:
        - http
      middlewares:
        - {service}-redirect
      service: {service}
    {service}-https:
      rule: "Host(`{host}`)"
      entryPoints:
        - https
      service: {service}
      tls:
        certResolver: letsencrypt
  middlewares:
    {service}-redirect:
      redirectScheme:
        scheme: https
        permanent: true
  services:
    {service}:
      loadBalancer:
        servers:
          - url: "{upstream}"
"#
    );

    let path = dev_preview_dynamic_file(project_uuid);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, yaml).map_err(|e| e.to_string())?;
    Ok(upstream)
}

fn remove_dev_traefik_dynamic(project_uuid: &str) {
    let path = dev_preview_dynamic_file(project_uuid);
    let _ = std::fs::remove_file(path);
}

fn preview_pid_path(workdir: &Path) -> PathBuf {
    workdir.join(".devforge-preview.pid")
}

fn preview_out_path(workdir: &Path) -> PathBuf {
    workdir.join(".devforge-preview.out")
}

fn preview_err_path(workdir: &Path) -> PathBuf {
    workdir.join(".devforge-preview.err")
}

fn read_preview_pid(workdir: &Path) -> Option<u32> {
    std::fs::read_to_string(preview_pid_path(workdir))
        .ok()
        .and_then(|t| t.trim().parse().ok())
}

fn read_preview_logs(workdir: &Path, max_lines: usize) -> String {
    let mut chunks = Vec::new();
    for path in [preview_err_path(workdir), preview_out_path(workdir)] {
        if let Ok(txt) = std::fs::read_to_string(path) {
            let lines: Vec<&str> = txt.lines().rev().take(max_lines).collect();
            if !lines.is_empty() {
                chunks.push(lines.into_iter().rev().collect::<Vec<_>>().join("\n"));
            }
        }
    }
    chunks.join("\n---\n")
}

fn preview_port_hint(production_port: u16, preview_port: u16) -> String {
    if production_port > 0 && production_port != preview_port {
        format!(
            "Le port production du projet est {production_port} (conteneur). \
             Le serveur de dev écoute sur {preview_port}. \
             Vérifie .devforge-preview.err dans le workdir."
        )
    } else {
        "Vérifie .devforge-preview.err dans le workdir.".into()
    }
}

/// Port atelier (`npm run dev`) — indépendant du port production (souvent 80).
fn resolve_preview_port(workdir: &Path, stored_production_port: u16) -> u16 {
    if let Some(pkg) = read_package_json(workdir) {
        if let Some(p) = parse_port_from_package_scripts(&pkg) {
            return p;
        }
        return detect_framework_dev_port(&pkg);
    }
    if stored_production_port >= 1024 {
        return stored_production_port;
    }
    3000
}

fn read_package_json(workdir: &Path) -> Option<Value> {
    let content = std::fs::read_to_string(workdir.join("package.json")).ok()?;
    serde_json::from_str(&content).ok()
}

fn parse_port_from_package_scripts(pkg: &Value) -> Option<u16> {
    let scripts = pkg.get("scripts")?.as_object()?;
    for key in ["dev", "start"] {
        if let Some(cmd) = scripts.get(key).and_then(|v| v.as_str()) {
            if let Some(p) = parse_port_flag(cmd) {
                return Some(p);
            }
        }
    }
    None
}

/// `--port 3000`, `--port=3000`, `-p 3000`, `-p3000`, `PORT=3000`.
fn parse_port_flag(cmd: &str) -> Option<u16> {
    let flag = regex::Regex::new(r"(?:--port[= ]+|-p[= ]?)(\d{2,5})").ok()?;
    if let Some(cap) = flag.captures(cmd) {
        if let Ok(p) = cap[1].parse::<u16>() {
            if p >= 1024 {
                return Some(p);
            }
        }
    }
    let env = regex::Regex::new(r"(?:^|[^\w])PORT=(\d{2,5})").ok()?;
    if let Some(cap) = env.captures(cmd) {
        if let Ok(p) = cap[1].parse::<u16>() {
            if p >= 1024 {
                return Some(p);
            }
        }
    }
    None
}

fn detect_framework_dev_port(pkg: &Value) -> u16 {
    if dep_has(pkg, "next")
        || dep_has(pkg, "nuxt")
        || dep_has(pkg, "nuxt3")
        || dep_has(pkg, "@remix-run/react")
        || dep_has(pkg, "@remix-run/node")
        || dep_has(pkg, "@nestjs/core")
        || dep_has(pkg, "express")
        || dep_has(pkg, "fastify")
        || dep_has(pkg, "koa")
    {
        return 3000;
    }
    if dep_has(pkg, "astro") {
        return 4321;
    }
    if dep_has(pkg, "vite")
        || dep_has(pkg, "@vitejs/plugin-react")
        || dep_has(pkg, "react-scripts")
        || dep_has(pkg, "vue")
    {
        return 5173;
    }
    3000
}

fn parse_listening_port_from_logs(logs: &str) -> Option<u16> {
    let re = regex::Regex::new(r"(?i)(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})").ok()?;
    let mut last = None;
    for cap in re.captures_iter(logs) {
        if let Ok(p) = cap[1].parse::<u16>() {
            if p >= 1024 {
                last = Some(p);
            }
        }
    }
    last
}

fn detect_dev_command(workdir: &Path, port: u16) -> Result<String> {
    let package_json = workdir.join("package.json");
    if !package_json.exists() {
        return Err(devforge_shared::DevForgeError::Message(
            "Impossible de détecter la commande de démarrage (pas de package.json). Spécifie 'command'."
                .into(),
        ));
    }

    let content = std::fs::read_to_string(&package_json)
        .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;
    let pkg: Value = serde_json::from_str(&content)
        .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;

    let has_dev = pkg
        .get("scripts")
        .and_then(|s| s.as_object())
        .map(|s| s.contains_key("dev"))
        .unwrap_or(false);
    let has_start = pkg
        .get("scripts")
        .and_then(|s| s.as_object())
        .map(|s| s.contains_key("start"))
        .unwrap_or(false);

    let is_next = dep_has(&pkg, "next");
    let is_astro = dep_has(&pkg, "astro");
    let is_vite = dep_has(&pkg, "vite") || dep_has(&pkg, "@vitejs/plugin-react");

    if is_next {
        return Ok(format!("npx next dev -H 0.0.0.0 -p {port}"));
    }
    if has_dev && (is_astro || is_vite) {
        return Ok(format!("npm run dev -- --host 0.0.0.0 --port {port}"));
    }
    if has_dev {
        return Ok(format!("npm run dev -- --host 0.0.0.0 --port {port}"));
    }
    if has_start {
        return Ok("npm start".into());
    }

    Err(devforge_shared::DevForgeError::Message(
        "Aucun script 'dev' ou 'start' dans package.json. Spécifie le paramètre 'command'.".into(),
    ))
}

fn dep_has(pkg: &Value, name: &str) -> bool {
    pkg.get("dependencies")
        .and_then(|d| d.as_object())
        .map(|d| d.contains_key(name))
        .unwrap_or(false)
        || pkg
            .get("devDependencies")
            .and_then(|d| d.as_object())
            .map(|d| d.contains_key(name))
            .unwrap_or(false)
}

fn npm_stamp_path(workdir: &Path) -> PathBuf {
    workdir.join(".devforge-npm-stamp")
}

fn deps_fingerprint(workdir: &Path) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    for name in ["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"] {
        if let Ok(bytes) = std::fs::read(workdir.join(name)) {
            name.hash(&mut hasher);
            bytes.hash(&mut hasher);
        }
    }
    format!("{:x}", hasher.finish())
}

fn framework_install_marker(pkg: &Value) -> Option<&'static str> {
    if dep_has(pkg, "astro") {
        return Some("astro");
    }
    if dep_has(pkg, "next") {
        return Some("next");
    }
    if dep_has(pkg, "vite") || dep_has(pkg, "@vitejs/plugin-react") {
        return Some("vite");
    }
    None
}

fn node_modules_looks_installed(workdir: &Path) -> bool {
    let nm = workdir.join("node_modules");
    if !nm.is_dir() {
        return false;
    }
    if let Some(pkg) = read_package_json(workdir) {
        if let Some(name) = framework_install_marker(&pkg) {
            return nm.join(name).exists() || nm.join(".bin").join(name).exists();
        }
    }
    nm.join(".bin").is_dir()
        || nm
            .read_dir()
            .map(|mut rd| rd.next().is_some())
            .unwrap_or(false)
}

/// Premier démarrage, node_modules vide/incomplet, ou package.json / lock changé.
fn node_modules_needs_install(workdir: &Path) -> bool {
    if !workdir.join("package.json").is_file() {
        return false;
    }
    if !node_modules_looks_installed(workdir) {
        return true;
    }
    let expected = deps_fingerprint(workdir);
    match std::fs::read_to_string(npm_stamp_path(workdir)) {
        Ok(stamp) => stamp.trim() != expected,
        Err(_) => true,
    }
}

fn npm_cli_available() -> bool {
    let bin = if cfg!(windows) { "npm.cmd" } else { "npm" };
    Command::new(bin)
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn append_preview_log(workdir: &Path, label: &str, stdout: &str, stderr: &str) {
    let mut buf = format!("=== {label} ===\n");
    if !stdout.trim().is_empty() {
        buf.push_str(stdout);
        if !stdout.ends_with('\n') {
            buf.push('\n');
        }
    }
    if !stderr.trim().is_empty() {
        buf.push_str(stderr);
        if !stderr.ends_with('\n') {
            buf.push('\n');
        }
    }
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(preview_out_path(workdir))
        .and_then(|mut f| {
            use std::io::Write;
            f.write_all(buf.as_bytes())
        });
}

/// Variables OS à conserver pour que `npm` / Node fonctionnent.
const PREVIEW_PASSTHROUGH_ENV: &[&str] = &[
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TMPDIR",
    "TMP",
    "TEMP",
    "TERM",
    "npm_config_cache",
    "npm_config_prefix",
    "NPM_CONFIG_CACHE",
    "COREPACK_HOME",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
];

/// Clés projet qui ne doivent pas casser le serveur de dev (PATH, NODE_ENV=production, etc.).
fn is_reserved_preview_env(key: &str) -> bool {
    let k = key.trim();
    if k.is_empty() {
        return true;
    }
    if k.starts_with("LD_") || k.starts_with("DYLD_") {
        return true;
    }
    [
        "PATH",
        "HOME",
        "USER",
        "LOGNAME",
        "SHELL",
        "PWD",
        "OLDPWD",
        "HOSTNAME",
        "TERM",
        "HOST",
        "PORT",
        "BROWSER",
        "NODE_ENV",
        "LD_LIBRARY_PATH",
        "LD_PRELOAD",
        "DYLD_LIBRARY_PATH",
        "__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS",
    ]
    .iter()
    .any(|reserved| reserved.eq_ignore_ascii_case(k))
}

fn project_env_for_preview(vars: &[(String, String)]) -> Vec<(String, String)> {
    vars.iter()
        .filter(|(k, _)| !is_reserved_preview_env(k))
        .cloned()
        .collect()
}

async fn load_project_env_vars(pool: &SqlitePool, project_uuid: &str) -> Vec<(String, String)> {
    sqlx::query_as(
        "SELECT key, value FROM project_env_vars WHERE project_uuid = ? ORDER BY key",
    )
    .bind(project_uuid)
    .fetch_all(pool)
    .await
    .unwrap_or_default()
}

/// Env du process atelier : PATH OS + variables DevForge + overlay preview (HOST/PORT/NODE_ENV).
fn preview_process_env(
    project_env: &[(String, String)],
    port: u16,
    allowed_hosts: &str,
) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for key in PREVIEW_PASSTHROUGH_ENV {
        if let Ok(v) = std::env::var(key) {
            if !v.is_empty() {
                out.push(((*key).to_string(), v));
            }
        }
    }
    out.extend(project_env_for_preview(project_env));
    out.push(("HOST".into(), "0.0.0.0".into()));
    out.push(("PORT".into(), port.to_string()));
    out.push(("BROWSER".into(), "none".into()));
    out.push(("NODE_ENV".into(), "development".into()));
    out.push(("PUPPETEER_SKIP_DOWNLOAD".into(), "1".into()));
    out.push(("PUPPETEER_SKIP_CHROMIUM_DOWNLOAD".into(), "1".into()));
    if !allowed_hosts.is_empty() {
        out.push((
            "__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS".into(),
            allowed_hosts.to_string(),
        ));
    }
    out
}

/// `true` si `npm install` a réellement tourné.
async fn ensure_node_modules(
    workdir: &Path,
    project_env: &[(String, String)],
) -> std::result::Result<bool, String> {
    if !node_modules_needs_install(workdir) {
        return Ok(false);
    }
    if !npm_cli_available() {
        return Err(
            "npm introuvable dans l’environnement DevForge. \
             L’image runtime doit inclure Node.js 22 pour `npm i` au premier démarrage."
                .into(),
        );
    }

    let mut cmd = if cfg!(windows) {
        let mut c = tokio::process::Command::new("npm.cmd");
        c.args(["install", "--no-fund", "--no-audit"]);
        c
    } else {
        let mut c = tokio::process::Command::new("npm");
        c.args(["install", "--no-fund", "--no-audit"]);
        c
    };
    cmd.env_clear();
    for (k, v) in preview_process_env(project_env, 0, "") {
        if k == "PORT" || k == "HOST" || k == "BROWSER" {
            continue;
        }
        cmd.env(k, v);
    }
    cmd.current_dir(workdir).kill_on_drop(true);

    let output = tokio::time::timeout(Duration::from_secs(300), cmd.output())
        .await
        .map_err(|_| "timeout npm install (300s)".to_string())?
        .map_err(|e| e.to_string())?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    append_preview_log(workdir, "npm install", &stdout, &stderr);

    if !output.status.success() {
        return Err(format!(
            "exit={} · {}",
            output.status.code().unwrap_or(-1),
            stderr
                .chars()
                .chain(stdout.chars())
                .take(800)
                .collect::<String>()
        ));
    }

    if !node_modules_looks_installed(workdir) {
        return Err(
            "npm install s’est terminé mais les paquets (astro/vite/…) sont absents de node_modules."
                .into(),
        );
    }

    let _ = std::fs::write(npm_stamp_path(workdir), deps_fingerprint(workdir));
    Ok(true)
}

fn stop_preview(workdir: &Path, port: u16) -> std::result::Result<(), String> {
    let pid_file = preview_pid_path(workdir);
    if let Ok(txt) = std::fs::read_to_string(&pid_file) {
        if let Ok(pid) = txt.trim().parse::<u32>() {
            #[cfg(windows)]
            {
                let _ = Command::new("taskkill")
                    .args(["/PID", &pid.to_string(), "/T", "/F"])
                    .output();
            }
            #[cfg(not(windows))]
            {
                let _ = Command::new("kill")
                    .args(["-TERM", &pid.to_string()])
                    .output();
                std::thread::sleep(Duration::from_millis(300));
                let _ = Command::new("kill")
                    .args(["-9", &pid.to_string()])
                    .output();
            }
        }
        let _ = std::fs::remove_file(&pid_file);
    }

    #[cfg(windows)]
    {
        let _ = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                &format!(
                    "Get-NetTCPConnection -LocalPort {port} -ErrorAction SilentlyContinue | ForEach-Object {{ Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }}"
                ),
            ])
            .output();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("fuser")
            .args([format!("{port}/tcp"), "-k".into()])
            .output();
    }

    std::thread::sleep(Duration::from_millis(400));
    Ok(())
}

fn spawn_preview(
    workdir: &Path,
    port: u16,
    command: &str,
    preview_url: Option<&str>,
    project_env: &[(String, String)],
) -> std::result::Result<u32, String> {
    let out = std::fs::File::create(preview_out_path(workdir)).map_err(|e| e.to_string())?;
    let err = std::fs::File::create(preview_err_path(workdir)).map_err(|e| e.to_string())?;

    let mut cmd = if cfg!(windows) {
        let mut c = Command::new("cmd");
        c.args(["/C", command]);
        c
    } else {
        let mut c = Command::new("sh");
        c.args(["-c", command]);
        c
    };

    // Vite/Astro bloquent les Host inconnus (DNS rebinding). Autoriser le
    // sous-domaine atelier Traefik via l’env officielle Vite.
    let allowed_hosts = vite_allowed_hosts_from_preview_url(preview_url);
    let env = preview_process_env(project_env, port, &allowed_hosts);

    cmd.env_clear();
    for (k, v) in &env {
        cmd.env(k, v);
    }
    cmd.current_dir(workdir)
        .stdin(Stdio::null())
        .stdout(Stdio::from(out))
        .stderr(Stdio::from(err));

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        const DETACHED_PROCESS: u32 = 0x00000008;
        cmd.creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS);
    }

    let child = cmd.spawn().map_err(|e| format!("spawn failed: {e}"))?;
    let pid = child.id();
    std::fs::write(preview_pid_path(workdir), pid.to_string()).map_err(|e| e.to_string())?;
    std::mem::forget(child);
    Ok(pid)
}

/// Construit la liste d’hôtes Vite : host exact + `.wildcard` (tous les sous-domaines).
fn vite_allowed_hosts_from_preview_url(preview_url: Option<&str>) -> String {
    let Some(url) = preview_url else {
        return String::new();
    };
    let Some(host) = host_from_preview_url(url) else {
        return String::new();
    };
    let mut hosts = vec![host.clone()];
    // `dev-xxxx.jeser.app` → aussi `.jeser.app` (tous les sous-domaines atelier)
    if let Some((_, base)) = host.split_once('.') {
        if base.contains('.') {
            hosts.push(format!(".{base}"));
        }
    }
    hosts.join(",")
}

async fn port_is_open(port: u16) -> bool {
    matches!(
        tokio::time::timeout(
            Duration::from_secs(1),
            tokio::net::TcpStream::connect(("127.0.0.1", port)),
        )
        .await,
        Ok(Ok(_))
    )
}

enum PreviewWait {
    Ready { port: u16 },
    ProcessExited,
    Timeout,
}

fn pid_is_alive(pid: u32) -> bool {
    #[cfg(windows)]
    {
        Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/NH"])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).contains(&pid.to_string()))
            .unwrap_or(true)
    }
    #[cfg(not(windows))]
    {
        Command::new("kill")
            .args(["-0", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
}

async fn wait_for_preview(port: u16, pid: u32, workdir: &Path, timeout: Duration) -> PreviewWait {
    let start = std::time::Instant::now();
    while start.elapsed() < timeout {
        if port_is_open(port).await {
            return PreviewWait::Ready { port };
        }
        let logs = read_preview_logs(workdir, 80);
        if let Some(actual) = parse_listening_port_from_logs(&logs) {
            if actual != port && port_is_open(actual).await {
                return PreviewWait::Ready { port: actual };
            }
        }
        if !pid_is_alive(pid) {
            return PreviewWait::ProcessExited;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    let logs = read_preview_logs(workdir, 80);
    if let Some(actual) = parse_listening_port_from_logs(&logs) {
        if port_is_open(actual).await {
            return PreviewWait::Ready { port: actual };
        }
    }
    PreviewWait::Timeout
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn write_pkg(dir: &Path, body: &str) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join("package.json"), body).unwrap();
    }

    #[test]
    fn vite_static_ignores_production_port_80() {
        let dir = std::env::temp_dir().join("df-preview-vite-80");
        write_pkg(
            &dir,
            r#"{"scripts":{"dev":"vite"},"devDependencies":{"vite":"^6.0.0"}}"#,
        );
        assert_eq!(resolve_preview_port(&dir, 80), 5173);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn astro_static_ignores_production_port_80() {
        let dir = std::env::temp_dir().join("df-preview-astro-80");
        write_pkg(
            &dir,
            r#"{"scripts":{"dev":"astro dev"},"dependencies":{"astro":"^5.0.0"}}"#,
        );
        assert_eq!(resolve_preview_port(&dir, 80), 4321);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn script_port_flag_wins() {
        let dir = std::env::temp_dir().join("df-preview-script-port");
        write_pkg(
            &dir,
            r#"{"scripts":{"dev":"vite --port 4000"},"devDependencies":{"vite":"^6.0.0"}}"#,
        );
        assert_eq!(resolve_preview_port(&dir, 80), 4000);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn next_uses_3000_even_if_dockerfile_expose_80() {
        let dir = std::env::temp_dir().join("df-preview-next-80");
        write_pkg(
            &dir,
            r#"{"scripts":{"dev":"next dev"},"dependencies":{"next":"15.0.0"}}"#,
        );
        assert_eq!(resolve_preview_port(&dir, 80), 3000);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn parse_port_flag_variants() {
        assert_eq!(parse_port_flag("vite --port 4000"), Some(4000));
        assert_eq!(parse_port_flag("astro dev --port=4321"), Some(4321));
        assert_eq!(parse_port_flag("next dev -p 3001"), Some(3001));
        assert_eq!(parse_port_flag("PORT=5174 vite"), Some(5174));
        assert_eq!(parse_port_flag("vite --port 80"), None);
        assert_eq!(parse_port_flag("vite"), None);
    }

    #[test]
    fn parse_vite_local_url_from_logs() {
        let logs = "  VITE v6.0.0  ready in 234 ms\n\n  ➜  Local:   http://localhost:5173/\n";
        assert_eq!(parse_listening_port_from_logs(logs), Some(5173));
    }

    #[test]
    fn detect_dev_command_passes_unprivileged_port() {
        let dir = std::env::temp_dir().join("df-preview-cmd");
        write_pkg(
            &dir,
            r#"{"scripts":{"dev":"vite"},"devDependencies":{"vite":"^6.0.0"}}"#,
        );
        let cmd = detect_dev_command(&dir, 5173).unwrap();
        assert!(cmd.contains("--port 5173"), "{cmd}");
        assert!(!cmd.contains("--port 80"), "{cmd}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn framework_ports() {
        assert_eq!(
            detect_framework_dev_port(&json!({"devDependencies":{"vite":"1"}})),
            5173
        );
        assert_eq!(
            detect_framework_dev_port(&json!({"dependencies":{"astro":"1"}})),
            4321
        );
        assert_eq!(
            detect_framework_dev_port(&json!({"dependencies":{"next":"1"}})),
            3000
        );
    }

    #[test]
    fn astro_first_start_needs_npm_install() {
        let dir = std::env::temp_dir().join("df-preview-astro-npm-first");
        let _ = std::fs::remove_dir_all(&dir);
        write_pkg(
            &dir,
            r#"{"scripts":{"dev":"astro dev"},"dependencies":{"astro":"^5.0.0"}}"#,
        );
        assert!(node_modules_needs_install(&dir), "pas de node_modules");
        std::fs::create_dir_all(dir.join("node_modules")).unwrap();
        assert!(
            node_modules_needs_install(&dir),
            "node_modules vide / sans astro"
        );
        std::fs::create_dir_all(dir.join("node_modules/astro")).unwrap();
        assert!(
            node_modules_needs_install(&dir),
            "premier démarrage : pas encore de stamp"
        );
        std::fs::write(npm_stamp_path(&dir), deps_fingerprint(&dir)).unwrap();
        assert!(
            !node_modules_needs_install(&dir),
            "astro installé + stamp à jour"
        );
        std::fs::write(
            dir.join("package.json"),
            r#"{"scripts":{"dev":"astro dev"},"dependencies":{"astro":"^5.1.0"}}"#,
        )
        .unwrap();
        assert!(
            node_modules_needs_install(&dir),
            "package.json changé → réinstall"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_node_modules_is_not_installed() {
        let dir = std::env::temp_dir().join("df-preview-empty-nm");
        let _ = std::fs::remove_dir_all(&dir);
        write_pkg(
            &dir,
            r#"{"scripts":{"dev":"astro dev"},"dependencies":{"astro":"^5.0.0"}}"#,
        );
        std::fs::create_dir_all(dir.join("node_modules")).unwrap();
        assert!(!node_modules_looks_installed(&dir));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn project_env_skips_reserved_keeps_app_keys() {
        let vars = vec![
            ("DATABASE_URL".into(), "libsql://x".into()),
            ("PUBLIC_SITE".into(), "https://example.com".into()),
            ("NODE_ENV".into(), "production".into()),
            ("PORT".into(), "80".into()),
            ("PATH".into(), "/evil".into()),
        ];
        let out = project_env_for_preview(&vars);
        let keys: Vec<&str> = out.iter().map(|(k, _)| k.as_str()).collect();
        assert!(keys.contains(&"DATABASE_URL"));
        assert!(keys.contains(&"PUBLIC_SITE"));
        assert!(!keys.contains(&"NODE_ENV"));
        assert!(!keys.contains(&"PORT"));
        assert!(!keys.contains(&"PATH"));
    }

    #[test]
    fn preview_overlay_forces_dev_and_injects_project_vars() {
        let vars = vec![
            ("NODE_ENV".into(), "production".into()),
            ("FOO".into(), "bar".into()),
        ];
        let env = preview_process_env(&vars, 5173, "dev.example.com");
        assert_eq!(
            env.iter()
                .find(|(k, _)| k == "NODE_ENV")
                .map(|(_, v)| v.as_str()),
            Some("development")
        );
        assert_eq!(
            env.iter()
                .find(|(k, _)| k == "PORT")
                .map(|(_, v)| v.as_str()),
            Some("5173")
        );
        assert_eq!(
            env.iter()
                .find(|(k, _)| k == "FOO")
                .map(|(_, v)| v.as_str()),
            Some("bar")
        );
        assert!(env.iter().any(|(k, v)| k == "__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS"
            && v == "dev.example.com"));
    }
}
