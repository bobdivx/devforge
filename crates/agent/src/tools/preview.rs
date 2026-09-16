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
    port: u16,
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
            let _ = write_dev_traefik_dynamic(&preview_url, &ctx.uuid, ctx.port);
            return Ok(json!({
                "ok": true,
                "command": command,
                "workdir": ctx.workdir,
                "port": ctx.port,
                "pid": read_preview_pid(workdir_path),
                "preview_url": preview_url,
                "local_url": format!("http://127.0.0.1:{}", ctx.port),
                "mode": "process",
                "status": "running",
                "reused": true,
                "message": format!("✓ Serveur atelier déjà actif : {preview_url}"),
                "hint": "Utilise force=true ou le bouton Redémarrer pour relancer après des changements."
            }));
        }

        if let Err(e) = ensure_node_modules(workdir_path).await {
            return Ok(json!({
                "ok": false,
                "error": format!("npm install a échoué : {e}"),
                "workdir": ctx.workdir
            }));
        }

        let _ = stop_preview(workdir_path, ctx.port);

        let pid = match spawn_preview(workdir_path, ctx.port, &command) {
            Ok(pid) => pid,
            Err(e) => {
                return Ok(json!({
                    "ok": false,
                    "error": format!("Impossible de démarrer la preview : {e}"),
                    "command": command,
                    "workdir": ctx.workdir,
                    "port": ctx.port
                }));
            }
        };

        let ready = wait_for_port(ctx.port, Duration::from_secs(45)).await;
        let local_url = format!("http://127.0.0.1:{}", ctx.port);

        if ready {
            if let Err(e) = write_dev_traefik_dynamic(&preview_url, &ctx.uuid, ctx.port) {
                eprintln!("[start_local_preview] traefik dynamic: {e}");
            }
        }

        if !ready {
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
                "pid": pid,
                "preview_url": preview_url,
                "local_url": local_url,
                "mode": "process",
                "status": "starting",
                "logs_tail": tail,
                "hint": "Vérifie .devforge-preview.err dans le workdir, ou change le port du projet."
            }));
        }

        Ok(json!({
            "ok": true,
            "command": command,
            "workdir": ctx.workdir,
            "port": ctx.port,
            "pid": pid,
            "preview_url": preview_url,
            "local_url": local_url,
            "mode": "process",
            "status": "running",
            "reused": false,
            "message": format!("✓ Serveur atelier prêt : {preview_url}"),
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

        Ok(json!({
            "ok": true,
            "status": if running { "running" } else { "stopped" },
            "port": ctx.port,
            "pid": pid,
            "preview_url": ctx.preview_url,
            "local_url": format!("http://127.0.0.1:{}", ctx.port),
            "mode": "process",
            "workdir": ctx.workdir
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

    let Some((uuid, workdir_opt, port_i, name)) = project else {
        return Err(devforge_shared::DevForgeError::NotFound(format!(
            "Projet introuvable : {project_uuid}"
        )));
    };

    let mut workdir_raw = workdir_opt.as_deref().unwrap_or("").trim().to_string();
    if workdir_raw.is_empty() {
        let slug = slugify_name(&name);
        let slug = if slug.is_empty() {
            uuid.chars().take(12).collect::<String>()
        } else {
            slug
        };
        workdir_raw = format!("/data/devforge/applications/{slug}");
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
    let port: u16 = if port_i <= 0 || port_i > 65535 {
        detect_default_port(workdir_path)
    } else {
        port_i as u16
    };

    Ok(PreviewContext {
        uuid,
        workdir,
        port,
        preview_url,
    })
}

fn slugify_name(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("-")
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
    if let Ok(self_container) = std::env::var("DEVFORGE_SELF_CONTAINER") {
        let name = self_container.trim();
        if !name.is_empty() {
            return format!("http://{name}:{port}");
        }
    }
    format!("http://host.docker.internal:{port}")
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
) -> std::result::Result<(), String> {
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
    std::fs::write(&path, yaml).map_err(|e| e.to_string())
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

fn detect_default_port(workdir: &Path) -> u16 {
    let package_json = workdir.join("package.json");
    if let Ok(content) = std::fs::read_to_string(&package_json) {
        if let Ok(pkg) = serde_json::from_str::<Value>(&content) {
            if dep_has(&pkg, "astro") {
                return 4321;
            }
            if dep_has(&pkg, "vite") || dep_has(&pkg, "@vitejs/plugin-react") {
                return 5173;
            }
            if dep_has(&pkg, "next") {
                return 3000;
            }
        }
    }
    5173
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

async fn ensure_node_modules(workdir: &Path) -> std::result::Result<(), String> {
    if workdir.join("node_modules").is_dir() {
        return Ok(());
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
    cmd.current_dir(workdir)
        .env("PUPPETEER_SKIP_DOWNLOAD", "1")
        .env("PUPPETEER_SKIP_CHROMIUM_DOWNLOAD", "1")
        .kill_on_drop(true);

    let output = tokio::time::timeout(Duration::from_secs(180), cmd.output())
        .await
        .map_err(|_| "timeout npm install (180s)".to_string())?
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
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
    Ok(())
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

fn spawn_preview(workdir: &Path, port: u16, command: &str) -> std::result::Result<u32, String> {
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

    cmd.current_dir(workdir)
        .env("HOST", "0.0.0.0")
        .env("PORT", port.to_string())
        .env("BROWSER", "none")
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

async fn wait_for_port(port: u16, timeout: Duration) -> bool {
    let start = std::time::Instant::now();
    while start.elapsed() < timeout {
        if port_is_open(port).await {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    false
}
