use async_trait::async_trait;
use devforge_deploy::docker::{
    dev_container_name, docker_run_dev_preview_args, traefik_dev_labels,
};
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

#[async_trait]
impl Tool for StartLocalPreviewTool {
    fn name(&self) -> &str {
        "start_local_preview"
    }

    fn description(&self) -> &str {
        "Démarre (ou relance) le serveur de développement de l’atelier pour le workdir du projet.\n\
         \n\
         OBLIGATOIRE après des write_project_file locaux, avant de demander une PR.\n\
         L'utilisateur voit le résultat via le bouton Preview du workspace.\n\
         \n\
         Expose l’app sur https://dev-{8chars}.{wildcard_domain} (Settings → Domaine).\n\
         Sur PaaS Docker : conteneur df-dev-* + labels Traefik.\n\
         \n\
         Paramètres :\n\
         - project_uuid : UUID du projet DevForge (contexte par défaut)\n\
         - command : commande de démarrage (défaut: auto-détecté selon stack)"
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_uuid": {
                    "type": "string",
                    "description": "UUID du projet DevForge (injecté automatiquement si dans le contexte)"
                },
                "command": {
                    "type": "string",
                    "description": "Commande de démarrage custom (optionnel, auto-détecté si omis)"
                }
            },
            "required": ["project_uuid"]
        })
    }

    async fn execute(&self, arguments: Value) -> Result<Value> {
        let project_uuid = arguments
            .get("project_uuid")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let custom_command = arguments
            .get("command")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty());

        if project_uuid.is_empty() {
            return Ok(json!({
                "ok": false,
                "error": "project_uuid requis (devrait être injecté automatiquement)"
            }));
        }

        let project: Option<(String, Option<String>, i64, String)> = sqlx::query_as(
            "SELECT uuid, workdir, port, name FROM projects WHERE uuid = ?",
        )
        .bind(project_uuid)
        .fetch_optional(self.pool.as_ref())
        .await
        .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;

        let Some((uuid, workdir_opt, port_i, name)) = project else {
            return Ok(json!({
                "ok": false,
                "error": format!("Projet introuvable : {project_uuid}")
            }));
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
                .execute(self.pool.as_ref())
                .await;
        }

        let workdir = devforge_deploy::resolve_project_workdir(&workdir_raw, &uuid);
        let workdir_path = Path::new(&workdir);
        if !workdir_path.exists() {
            if let Err(e) = std::fs::create_dir_all(workdir_path) {
                return Ok(json!({
                    "ok": false,
                    "error": format!("Impossible de créer le workdir {workdir} : {e}")
                }));
            }
        }

        let Some(preview_url) = resolve_dev_url(self.pool.as_ref(), &uuid).await? else {
            return Ok(json!({
                "ok": false,
                "error": "Domaine wildcard manquant. Configure Settings → Domaine (wildcard) pour exposer https://dev-{uuid}.{domaine}.",
                "hint": "Sans domaine, l’atelier ne peut pas publier une URL publique."
            }));
        };

        let port: u16 = if port_i <= 0 || port_i > 65535 {
            detect_default_port(workdir_path)
        } else {
            port_i as u16
        };

        let command = if let Some(cmd) = custom_command {
            cmd.to_string()
        } else {
            match detect_dev_command(workdir_path, port) {
                Ok(c) => c,
                Err(e) => {
                    return Ok(json!({
                        "ok": false,
                        "error": e.to_string()
                    }));
                }
            }
        };

        // 1) PaaS : conteneur df-dev-* + Traefik (Host dev-…)
        if docker_cli_available() {
            match start_docker_dev_preview(&uuid, &workdir, port, &command, &preview_url).await {
                Ok(v) => return Ok(v),
                Err(e) => {
                    // Fallback process local si Docker échoue (ex. pas de réseau Traefik)
                    eprintln!("[start_local_preview] docker path failed: {e} — fallback local");
                }
            }
        }

        // 2) Fallback : process local (dev machine / Docker indisponible)
        if port_is_open(port).await {
            return Ok(json!({
                "ok": true,
                "command": command,
                "workdir": workdir,
                "port": port,
                "pid": read_preview_pid(workdir_path),
                "preview_url": preview_url,
                "local_url": format!("http://127.0.0.1:{port}"),
                "mode": "local",
                "status": "ready",
                "reused": true,
                "message": format!("✓ Preview déjà active : {preview_url}"),
                "hint": "Ouvre Preview dans le workspace. Si l’iframe échoue hors PaaS, le process écoute aussi en local."
            }));
        }

        if let Err(e) = ensure_node_modules(workdir_path).await {
            return Ok(json!({
                "ok": false,
                "error": format!("npm install a échoué : {e}"),
                "workdir": workdir
            }));
        }

        let _ = stop_preview(workdir_path, port);

        let pid = match spawn_preview(workdir_path, port, &command) {
            Ok(pid) => pid,
            Err(e) => {
                return Ok(json!({
                    "ok": false,
                    "error": format!("Impossible de démarrer la preview : {e}"),
                    "command": command,
                    "workdir": workdir,
                    "port": port
                }));
            }
        };

        let ready = wait_for_port(port, Duration::from_secs(45)).await;
        let local_url = format!("http://127.0.0.1:{port}");

        if !ready {
            let tail = read_preview_logs(workdir_path, 40);
            return Ok(json!({
                "ok": false,
                "error": format!(
                    "Le serveur a démarré (pid={pid}) mais le port {port} ne répond pas après 45s."
                ),
                "command": command,
                "workdir": workdir,
                "port": port,
                "pid": pid,
                "preview_url": preview_url,
                "local_url": local_url,
                "mode": "local",
                "status": "starting",
                "logs_tail": tail,
                "hint": "Vérifie .devforge-preview.err dans le workdir, ou change le port du projet."
            }));
        }

        Ok(json!({
            "ok": true,
            "command": command,
            "workdir": workdir,
            "port": port,
            "pid": pid,
            "preview_url": preview_url,
            "local_url": local_url,
            "mode": "local",
            "status": "ready",
            "reused": false,
            "message": format!("✓ Preview prête : {preview_url}"),
            "hint": "Ouvre Preview dans le workspace. Sur PaaS Docker, préfère le mode conteneur (df-dev-*)."
        }))
    }
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

fn docker_cli_available() -> bool {
    Command::new("docker")
        .args(["info"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn host_workdir_for_bind(container_workdir: &str) -> String {
    if let Ok(host_root) = std::env::var("DEVFORGE_HOST_DATA_DIR") {
        let root = host_root.trim().trim_end_matches(['/', '\\']);
        if let Some(rest) = container_workdir.strip_prefix("/data") {
            return format!("{root}{rest}");
        }
    }
    // ZimaOS / compose par défaut : /data → /DATA/AppData/devforge
    if let Some(rest) = container_workdir.strip_prefix("/data") {
        return format!("/DATA/AppData/devforge{rest}");
    }
    container_workdir.to_string()
}

fn docker_network() -> Option<String> {
    std::env::var("DEVFORGE_DOCKER_NETWORK")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

async fn start_docker_dev_preview(
    uuid: &str,
    workdir: &str,
    port: u16,
    command: &str,
    preview_url: &str,
) -> std::result::Result<Value, String> {
    let name = dev_container_name(uuid);
    let host = preview_url
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .split('/')
        .next()
        .unwrap_or("")
        .to_string();
    if host.is_empty() {
        return Err("hôte dev- invalide".into());
    }

    let labels = traefik_dev_labels(uuid, &host, port);
    let host_workdir = host_workdir_for_bind(workdir);
    let network = docker_network();

    if docker_container_running(&name) && docker_port_ready_inside(&name, port) {
        return Ok(json!({
            "ok": true,
            "command": command,
            "workdir": workdir,
            "port": port,
            "container": name,
            "preview_url": preview_url,
            "mode": "docker",
            "status": "ready",
            "reused": true,
            "message": format!("✓ Preview Docker déjà active : {preview_url}"),
            "hint": "Ouvre Preview dans le workspace."
        }));
    }

    let _ = Command::new("docker")
        .args(["rm", "-f", &name])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    let shell_cmd = format!(
        "if [ ! -d node_modules ]; then npm install --no-fund --no-audit; fi && {command}"
    );
    let image = std::env::var("DEVFORGE_DEV_PREVIEW_IMAGE")
        .unwrap_or_else(|_| "node:22-bookworm-slim".into());

    let args = docker_run_dev_preview_args(
        &name,
        &host_workdir,
        network.as_deref(),
        &labels,
        port,
        &shell_cmd,
        &image,
    );

    let output = Command::new("docker")
        .args(&args)
        .output()
        .map_err(|e| format!("docker run spawn: {e}"))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        let out = String::from_utf8_lossy(&output.stdout);
        return Err(format!(
            "docker run failed: {} {}",
            err.chars().take(400).collect::<String>(),
            out.chars().take(200).collect::<String>()
        ));
    }

    let ready = wait_for_docker_ready(&name, port, Duration::from_secs(120)).await;
    if !ready {
        let logs = docker_logs_tail(&name, 50);
        let _ = Command::new("docker").args(["rm", "-f", &name]).status();
        return Err(format!(
            "conteneur {name} : port {port} pas prêt après 120s. logs: {logs}"
        ));
    }

    Ok(json!({
        "ok": true,
        "command": command,
        "workdir": workdir,
        "host_workdir": host_workdir,
        "port": port,
        "container": name,
        "preview_url": preview_url,
        "mode": "docker",
        "status": "ready",
        "reused": false,
        "network": network,
        "message": format!("✓ Preview prête : {preview_url}"),
        "hint": "Ouvre Preview dans le workspace (sous-domaine dev- via Traefik)."
    }))
}

fn docker_container_running(name: &str) -> bool {
    let output = Command::new("docker")
        .args([
            "inspect",
            "-f",
            "{{.State.Running}}",
            name,
        ])
        .output();
    matches!(output, Ok(o) if o.status.success() && String::from_utf8_lossy(&o.stdout).trim() == "true")
}

fn docker_port_ready_inside(name: &str, port: u16) -> bool {
    let script = format!(
        "require('net').connect({port},'127.0.0.1',()=>process.exit(0)).on('error',()=>process.exit(1))"
    );
    Command::new("docker")
        .args(["exec", name, "node", "-e", &script])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

async fn wait_for_docker_ready(name: &str, port: u16, timeout: Duration) -> bool {
    let start = std::time::Instant::now();
    while start.elapsed() < timeout {
        if docker_container_running(name) && docker_port_ready_inside(name, port) {
            return true;
        }
        if !docker_container_running(name) && start.elapsed() > Duration::from_secs(5) {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(1000)).await;
    }
    false
}

fn docker_logs_tail(name: &str, lines: usize) -> String {
    Command::new("docker")
        .args(["logs", "--tail", &lines.to_string(), name])
        .output()
        .map(|o| {
            let mut s = String::from_utf8_lossy(&o.stdout).to_string();
            s.push_str(&String::from_utf8_lossy(&o.stderr));
            s.chars().take(2000).collect()
        })
        .unwrap_or_default()
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
                chunks.push(
                    lines
                        .into_iter()
                        .rev()
                        .collect::<Vec<_>>()
                        .join("\n"),
                );
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
            "Impossible de détecter la commande de démarrage (pas de package.json). Spécifie 'command'.".into(),
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
            stderr.chars().chain(stdout.chars()).take(800).collect::<String>()
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
