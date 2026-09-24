use async_trait::async_trait;
use devforge_deploy::docker::dev_container_name;
use devforge_shared::{Result, Tool};
use serde_json::{json, Value};
use sqlx::PgPool;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::time::Duration;

/// Tool pour démarrer un serveur de développement local (preview workdir).
pub struct StartLocalPreviewTool {
    pub pool: Arc<PgPool>,
}

/// Arrête le serveur de dev atelier (process local, pas de conteneur df-dev-*).
pub struct StopLocalPreviewTool {
    pub pool: Arc<PgPool>,
}

/// État du serveur de dev atelier (port, pid, URL).
pub struct LocalPreviewStatusTool {
    pub pool: Arc<PgPool>,
}

/// Plage dédiée aux ateliers. Un port stable par projet, puis le suivant s’il est pris.
const PREVIEW_PORT_BASE: u16 = 21000;
const PREVIEW_PORT_SPAN: u16 = 10000;

struct PreviewContext {
    uuid: String,
    workdir: String,
    /// Port du `npm run dev` pour cet atelier (plage 21000–30999), pas le port production.
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

        let mut ctx = resolve_preview_context(self.pool.as_ref(), &arguments).await?;
        let workdir_path = Path::new(&ctx.workdir);

        let mut command = if let Some(cmd) = custom_command {
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

        let owned = read_preview_pid(workdir_path).is_some_and(pid_is_alive);
        if !force && owned && port_is_open(ctx.port).await {
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

        let _ = stop_owned_preview(workdir_path, ctx.port);
        ctx.port = allocate_preview_port(ctx.port).await;
        let _ = write_saved_preview_port(workdir_path, ctx.port);
        if custom_command.is_none() {
            command = detect_dev_command(workdir_path, ctx.port)?;
        }

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
    pool: &PgPool,
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
        "SELECT uuid, workdir, port, name FROM projects WHERE uuid = $1",
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
        let _ = sqlx::query("UPDATE projects SET workdir = $1, updated_at = to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') WHERE uuid = $2")
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
    // Chaque atelier a un port à lui dans 21000–30999, mémorisé après le premier démarrage.
    let port = read_saved_preview_port(workdir_path).unwrap_or_else(|| stable_preview_port(&uuid));

    Ok(PreviewContext {
        uuid,
        workdir,
        port,
        production_port,
        preview_url,
    })
}

async fn resolve_dev_url(pool: &PgPool, project_uuid: &str) -> Result<Option<String>> {
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
    std::fs::write(&path, &yaml).map_err(|e| e.to_string())?;
    // Compat Traefik déjà créé avec l’ancien resolve ZimaOS (…/devforge/data/proxy).
    // Sans ce double-write, le file provider ne voit aucun routeur → HTTP 404 public.
    for legacy in legacy_dev_preview_dynamic_files(project_uuid) {
        if legacy == path {
            continue;
        }
        if let Some(parent) = legacy.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&legacy, &yaml);
    }
    Ok(upstream)
}

fn remove_dev_traefik_dynamic(project_uuid: &str) {
    let path = dev_preview_dynamic_file(project_uuid);
    let _ = std::fs::remove_file(path);
    for legacy in legacy_dev_preview_dynamic_files(project_uuid) {
        let _ = std::fs::remove_file(legacy);
    }
}

/// Ancien chemin Traefik (bug resolve : Source se terminant par `/devforge` → `…/data/proxy`).
fn legacy_dev_preview_dynamic_files(project_uuid: &str) -> Vec<PathBuf> {
    let base = std::env::var("DEVFORGE_DATA_DIR").unwrap_or_else(|_| "/var/lib/devforge".into());
    let short: String = project_uuid.chars().take(8).collect();
    let name = format!("dev-{short}.yaml");
    let root = PathBuf::from(base.trim_end_matches(['/', '\\']));
    vec![root.join("data").join("proxy").join("dynamic").join(name)]
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
    let paths = [
        preview_err_path(workdir),
        preview_out_path(workdir),
        workdir.join(".astro/dev.log"),
    ];
    for path in paths {
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
    // `astro dev --port ${PORT:-3000}` — le port réel vient de l’env, le défaut est dans le script.
    let fallback = regex::Regex::new(r"\$\{PORT:-(\d{2,5})\}").ok()?;
    if let Some(cap) = fallback.captures(cmd) {
        if let Ok(p) = cap[1].parse::<u16>() {
            if p >= 1024 {
                return Some(p);
            }
        }
    }
    None
}

/// Le script laisse le port venir de l’environnement (`--port ${PORT:-3000}`).
/// On peut alors choisir un port libre sans doubler les flags CLI.
fn script_honors_port_env(script: &str) -> bool {
    script.contains("${PORT") || script.contains("$PORT")
}

/// Port stable par projet, dans [21000, 30999].
fn stable_preview_port(uuid: &str) -> u16 {
    let mut hash: u32 = 2_166_136_261;
    for b in uuid.as_bytes() {
        hash ^= *b as u32;
        hash = hash.wrapping_mul(1_677_7619);
    }
    PREVIEW_PORT_BASE + (hash % u32::from(PREVIEW_PORT_SPAN)) as u16
}

fn next_preview_port(port: u16) -> u16 {
    let last = PREVIEW_PORT_BASE + PREVIEW_PORT_SPAN - 1;
    if port < PREVIEW_PORT_BASE || port >= last {
        PREVIEW_PORT_BASE
    } else {
        port + 1
    }
}

/// Premier port libre à partir de `preferred` (lui-même, puis les suivants).
fn pick_preview_port(preferred: u16, is_taken: impl Fn(u16) -> bool) -> u16 {
    let mut port = if (PREVIEW_PORT_BASE..PREVIEW_PORT_BASE + PREVIEW_PORT_SPAN).contains(&preferred)
    {
        preferred
    } else {
        PREVIEW_PORT_BASE
    };
    for _ in 0..PREVIEW_PORT_SPAN {
        if !is_taken(port) {
            return port;
        }
        port = next_preview_port(port);
    }
    preferred
}

async fn allocate_preview_port(preferred: u16) -> u16 {
    let mut port = if (PREVIEW_PORT_BASE..PREVIEW_PORT_BASE + PREVIEW_PORT_SPAN).contains(&preferred)
    {
        preferred
    } else {
        PREVIEW_PORT_BASE
    };
    // 64 essais : un refus TCP local est immédiat. Au-delà, on garde le dernier vu.
    for _ in 0..64 {
        if !port_is_open(port).await {
            return port;
        }
        port = next_preview_port(port);
    }
    port
}

fn preview_port_file(workdir: &Path) -> PathBuf {
    workdir.join(".devforge-preview.port")
}

fn read_saved_preview_port(workdir: &Path) -> Option<u16> {
    let port = std::fs::read_to_string(preview_port_file(workdir))
        .ok()
        .and_then(|t| t.trim().parse().ok())?;
    if (PREVIEW_PORT_BASE..PREVIEW_PORT_BASE + PREVIEW_PORT_SPAN).contains(&port) {
        Some(port)
    } else {
        None
    }
}

fn write_saved_preview_port(workdir: &Path, port: u16) -> std::io::Result<()> {
    std::fs::write(preview_port_file(workdir), port.to_string())
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

    if is_next {
        return Ok(format!("npx next dev -H 0.0.0.0 -p {port}"));
    }
    let dev_script = pkg
        .get("scripts")
        .and_then(|s| s.get("dev"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if has_dev && script_honors_port_env(dev_script) {
        // PORT est injecté dans l’environnement : le script prend le port libre de l’atelier.
        return Ok("npm run dev".into());
    }
    if is_astro {
        // Un seul `--host` / `--port`. Doubler ces flags fait quitter Astro avant d’écouter.
        // `--force` remplace un `.astro/dev.json` laissé par un serveur détaché : sans ça,
        // Astro 7 quitte tout de suite (« already running ») avant d’écouter.
        return Ok(format!("npx astro dev --host --port {port} --force"));
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

async fn load_project_env_vars(pool: &PgPool, project_uuid: &str) -> Vec<(String, String)> {
    sqlx::query_as(
        "SELECT key, value FROM project_env_vars WHERE project_uuid = $1 ORDER BY key",
    )
    .bind(project_uuid)
    .fetch_all(pool)
    .await
    .unwrap_or_default()
}

/// Env du process atelier : PATH OS + variables DevForge + overlay preview (PORT/NODE_ENV).
/// `bind_host` pose `HOST=0.0.0.0`. À laisser à false pour Astro : cette valeur fait
/// écrire une URL réseau seule, et le lock file d’Astro 7 quitte alors avec `Invalid URL`
/// avant que le port ne reste ouvert.
fn preview_process_env(
    project_env: &[(String, String)],
    port: u16,
    allowed_hosts: &str,
    bind_host: bool,
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
    if bind_host {
        out.push(("HOST".into(), "0.0.0.0".into()));
    }
    out.push(("PORT".into(), port.to_string()));
    out.push(("BROWSER".into(), "none".into()));
    out.push(("NODE_ENV".into(), "development".into()));
    // Astro 7 détache `astro dev` dès qu’`am-i-vibing` voit un agent, puis le parent quitte.
    // `0` est l’opt-out documenté : le serveur reste au premier plan (pid + logs).
    out.push(("ASTRO_DEV_BACKGROUND".into(), "0".into()));
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
    for (k, v) in preview_process_env(project_env, 0, "", false) {
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

/// Arrête le process de cet atelier. `fuser` ne tue le port que si le pid nous appartient,
/// pour ne pas couper l’atelier d’un autre projet.
fn stop_owned_preview(workdir: &Path, port: u16) -> std::result::Result<(), String> {
    let alive = read_preview_pid(workdir).is_some_and(pid_is_alive);
    if alive {
        return stop_preview(workdir, port);
    }
    let _ = std::fs::remove_file(preview_pid_path(workdir));
    Ok(())
}

fn stop_preview(workdir: &Path, port: u16) -> std::result::Result<(), String> {
    let mut pids = Vec::new();
    if let Some(pid) = read_preview_pid(workdir) {
        pids.push(pid);
    }
    if let Some(pid) = astro_lock_pid(workdir) {
        pids.push(pid);
    }
    #[cfg(target_os = "linux")]
    pids.extend(pids_listening_on(port));
    pids.sort_unstable();
    pids.dedup();

    for pid in &pids {
        signal_pid(*pid, terminate_signal());
    }
    std::thread::sleep(Duration::from_millis(300));
    for pid in &pids {
        if pid_is_alive(*pid) {
            signal_pid(*pid, kill_signal());
        }
    }

    let _ = std::fs::remove_file(preview_pid_path(workdir));
    if astro_lock_pid(workdir).is_none_or(|pid| !pid_is_alive(pid)) {
        let _ = std::fs::remove_file(workdir.join(".astro/dev.json"));
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

fn terminate_signal() -> i32 {
    #[cfg(unix)]
    {
        libc::SIGTERM
    }
    #[cfg(not(unix))]
    {
        15
    }
}

fn kill_signal() -> i32 {
    #[cfg(unix)]
    {
        libc::SIGKILL
    }
    #[cfg(not(unix))]
    {
        9
    }
}

/// `kill(2)` direct. L’image runtime slim n’a pas le binaire `kill` (paquet procps).
fn signal_pid(pid: u32, sig: i32) -> bool {
    if pid == 0 {
        return false;
    }
    #[cfg(unix)]
    {
        // SAFETY: kill(2) sur un pid d’atelier que nous avons lancé.
        unsafe { libc::kill(pid as i32, sig) == 0 }
    }
    #[cfg(not(unix))]
    {
        let _ = (pid, sig);
        Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
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
    let astro = workdir_is_astro(workdir);
    let env = preview_process_env(project_env, port, &allowed_hosts, !astro);
    clear_dead_astro_lock(workdir);

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
    // Récolte le shell à la fin. Sans ça, un process terminé reste zombie et /proc le voit encore vivant.
    let _ = std::thread::Builder::new()
        .name("preview-reap".into())
        .spawn(move || {
            let mut child = child;
            let _ = child.wait();
        });
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
    if pid == 0 {
        return false;
    }
    #[cfg(target_os = "linux")]
    {
        // `/proc` existe dans l’image slim ; le binaire `kill` (procps) non.
        // Un zombie (State: Z) a déjà quitté : le traiter comme mort.
        let Ok(status) = std::fs::read_to_string(format!("/proc/{pid}/status")) else {
            return false;
        };
        for line in status.lines() {
            if let Some(rest) = line.strip_prefix("State:") {
                return !rest.trim().starts_with('Z');
            }
        }
        true
    }
    #[cfg(all(windows, not(target_os = "linux")))]
    {
        Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/NH"])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).contains(&pid.to_string()))
            .unwrap_or(true)
    }
    #[cfg(all(unix, not(target_os = "linux")))]
    {
        // SAFETY: kill(pid, 0) ne signale pas, il teste l’existence.
        unsafe { libc::kill(pid as i32, 0) == 0 }
    }
}

fn workdir_is_astro(workdir: &Path) -> bool {
    read_package_json(workdir).is_some_and(|pkg| dep_has(&pkg, "astro"))
}

fn astro_lock_value(workdir: &Path) -> Option<Value> {
    let raw = std::fs::read_to_string(workdir.join(".astro/dev.json")).ok()?;
    serde_json::from_str(&raw).ok()
}

fn astro_lock_pid(workdir: &Path) -> Option<u32> {
    let pid = astro_lock_value(workdir)?.get("pid")?.as_u64()?;
    u32::try_from(pid).ok().filter(|p| *p > 0)
}

fn astro_lock_port(workdir: &Path) -> Option<u16> {
    let port = astro_lock_value(workdir)?.get("port")?.as_u64()?;
    u16::try_from(port).ok().filter(|p| *p >= 1024)
}

fn clear_dead_astro_lock(workdir: &Path) {
    let Some(pid) = astro_lock_pid(workdir) else {
        return;
    };
    if !pid_is_alive(pid) {
        let _ = std::fs::remove_file(workdir.join(".astro/dev.json"));
    }
}

/// Inode d’un socket en écoute sur `port`, d’après une ligne de `/proc/net/tcp`.
fn listen_inode(line: &str, port: u16) -> Option<u64> {
    let mut cols = line.split_whitespace();
    let _sl = cols.next()?;
    let local = cols.next()?;
    let _rem = cols.next()?;
    let state = cols.next()?;
    if !state.eq_ignore_ascii_case("0A") {
        return None;
    }
    let suffix = format!(":{port:04X}");
    if !local.to_ascii_uppercase().ends_with(&suffix) {
        return None;
    }
    // sl local rem st tx:rx tr:tm retrnsmt uid timeout inode
    let inode = cols.nth(5)?;
    inode.parse().ok()
}

#[cfg(target_os = "linux")]
fn pids_listening_on(port: u16) -> Vec<u32> {
    let mut inodes = Vec::new();
    for name in ["tcp", "tcp6"] {
        let Ok(txt) = std::fs::read_to_string(format!("/proc/net/{name}")) else {
            continue;
        };
        for line in txt.lines().skip(1) {
            if let Some(inode) = listen_inode(line, port) {
                inodes.push(inode);
            }
        }
    }
    if inodes.is_empty() {
        return Vec::new();
    }
    let mut pids = Vec::new();
    let Ok(proc) = std::fs::read_dir("/proc") else {
        return pids;
    };
    for ent in proc.flatten() {
        let Ok(pid) = ent.file_name().to_string_lossy().parse::<u32>() else {
            continue;
        };
        let Ok(fds) = std::fs::read_dir(ent.path().join("fd")) else {
            continue;
        };
        for fd in fds.flatten() {
            let Ok(target) = std::fs::read_link(fd.path()) else {
                continue;
            };
            let text = target.to_string_lossy();
            let Some(rest) = text.strip_prefix("socket:[") else {
                continue;
            };
            let Some(num) = rest.strip_suffix(']') else {
                continue;
            };
            if let Ok(inode) = num.parse::<u64>() {
                if inodes.contains(&inode) {
                    pids.push(pid);
                    break;
                }
            }
        }
    }
    pids
}

async fn wait_for_preview(port: u16, pid: u32, workdir: &Path, timeout: Duration) -> PreviewWait {
    let start = std::time::Instant::now();
    while start.elapsed() < timeout {
        if let Some(ready) = preview_ready(port, workdir).await {
            return PreviewWait::Ready { port: ready };
        }
        if !pid_is_alive(pid) {
            if let Some(ready) = adopt_detached_preview(workdir, port).await {
                return PreviewWait::Ready { port: ready };
            }
            return PreviewWait::ProcessExited;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    if let Some(ready) = preview_ready(port, workdir).await {
        return PreviewWait::Ready { port: ready };
    }
    PreviewWait::Timeout
}

async fn preview_ready(port: u16, workdir: &Path) -> Option<u16> {
    if port_is_open(port).await {
        return Some(port);
    }
    let logs = read_preview_logs(workdir, 80);
    if let Some(actual) = parse_listening_port_from_logs(&logs) {
        if actual != port && port_is_open(actual).await {
            return Some(actual);
        }
    }
    if let Some(locked) = astro_lock_port(workdir) {
        if locked != port && port_is_open(locked).await {
            if let Some(child) = astro_lock_pid(workdir) {
                if pid_is_alive(child) {
                    let _ = std::fs::write(preview_pid_path(workdir), child.to_string());
                }
            }
            return Some(locked);
        }
    }
    None
}

/// Le parent `npx`/`sh` peut quitter pendant qu’Astro 7 laisse un enfant en arrière-plan.
async fn adopt_detached_preview(workdir: &Path, port: u16) -> Option<u16> {
    for _ in 0..8 {
        if let Some(ready) = preview_ready(port, workdir).await {
            return Some(ready);
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    preview_ready(port, workdir).await
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
        assert_eq!(
            parse_port_flag("astro dev --host --port ${PORT:-3000}"),
            Some(3000)
        );
    }

    #[test]
    fn astro_template_is_not_double_flagged() {
        let dir = std::env::temp_dir().join("df-preview-astro-port-env");
        write_pkg(
            &dir,
            r#"{"scripts":{"dev":"astro dev --host --port ${PORT:-3000}"},"dependencies":{"astro":"^4.16.0"}}"#,
        );
        assert_eq!(resolve_preview_port(&dir, 80), 3000);
        let cmd = detect_dev_command(&dir, 3000).unwrap();
        assert_eq!(cmd, "npm run dev");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn plain_astro_dev_uses_boolean_host() {
        let dir = std::env::temp_dir().join("df-preview-astro-plain");
        write_pkg(
            &dir,
            r#"{"scripts":{"dev":"astro dev"},"dependencies":{"astro":"^5.0.0"}}"#,
        );
        let cmd = detect_dev_command(&dir, 4321).unwrap();
        assert_eq!(cmd, "npx astro dev --host --port 4321 --force");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn preview_ports_are_stable_and_skip_taken() {
        let a = stable_preview_port("1b0e4a2f-d66a-40d8-8da0-2d960a8ff631");
        let b = stable_preview_port("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
        assert_ne!(a, b);
        assert!(a >= PREVIEW_PORT_BASE && a < PREVIEW_PORT_BASE + PREVIEW_PORT_SPAN);
        assert_eq!(stable_preview_port("1b0e4a2f-d66a-40d8-8da0-2d960a8ff631"), a);
        assert_eq!(pick_preview_port(a, |p| p == a), next_preview_port(a));
        assert_eq!(pick_preview_port(a, |_| false), a);
        assert_eq!(pick_preview_port(80, |_| false), PREVIEW_PORT_BASE);
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
        let env = preview_process_env(&vars, 5173, "dev.example.com", true);
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
                .find(|(k, _)| k == "HOST")
                .map(|(_, v)| v.as_str()),
            Some("0.0.0.0")
        );
        assert_eq!(
            env.iter()
                .find(|(k, _)| k == "ASTRO_DEV_BACKGROUND")
                .map(|(_, v)| v.as_str()),
            Some("0")
        );
        assert_eq!(
            env.iter()
                .find(|(k, _)| k == "FOO")
                .map(|(_, v)| v.as_str()),
            Some("bar")
        );
        assert!(env.iter().any(|(k, v)| k == "__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS"
            && v == "dev.example.com"));
        let astro_env = preview_process_env(&vars, 4321, "", false);
        assert!(astro_env.iter().all(|(k, _)| k != "HOST"));
    }

    #[test]
    fn listen_inode_matches_proc_net_tcp_listen_rows() {
        let line = "0: 00000000:5EE7 00000000:0000 0A 00000000:00000000 00:00000000 00000000 0 0 4242 1";
        assert_eq!(listen_inode(line, 24295), Some(4242));
        assert_eq!(listen_inode(line, 4321), None);
        let established = "0: 00000000:5EE7 0100007F:C3B2 01 00000000:00000000 00:00000000 00000000 0 0 99 1";
        assert_eq!(listen_inode(established, 24295), None);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn pid_liveness_reads_proc_status() {
        assert!(pid_is_alive(std::process::id()));
        assert!(!pid_is_alive(0));
        let mut child = Command::new("true").spawn().unwrap();
        let dead = child.id();
        let _ = child.wait();
        assert!(!pid_is_alive(dead));
    }

    #[test]
    fn legacy_preview_dynamic_path_matches_zimaos_bug() {
        let dir = std::env::temp_dir().join("df-preview-legacy-path");
        let _ = std::fs::create_dir_all(&dir);
        // SAFETY: test isolé — restaure ensuite
        std::env::set_var("DEVFORGE_DATA_DIR", &dir);
        let uuid = "bba0bc75-a521-4618-bc92-ed595c6a601e";
        let legacy = legacy_dev_preview_dynamic_files(uuid);
        assert_eq!(legacy.len(), 1);
        assert!(legacy[0].ends_with("data/proxy/dynamic/dev-bba0bc75.yaml"));
        let canon = dev_preview_dynamic_file(uuid);
        assert!(canon.ends_with("proxy/dynamic/dev-bba0bc75.yaml"));
        assert_ne!(legacy[0], canon);
        std::env::remove_var("DEVFORGE_DATA_DIR");
        let _ = std::fs::remove_dir_all(&dir);
    }

}
