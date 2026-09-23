//! Postgres du control plane.
//!
//! Le nœud qui écrit lance `devforge-pg` sur le réseau Docker `devforge` (port interne 5432).
//! Depuis un conteneur DevForge, l'accès est `devforge-pg:5432`.
//! Chaque worker garde une réplique physique `devforge-pg-ha` : à l'élection elle est promue, sans
//! rejouer un dump. Un `DATABASE_URL` déjà en `postgres://` reste la base du
//! processus ; le dump de secours passe alors par `pg_dump`.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::OnceLock;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use devforge_database::plan_sqlite_file;

pub const CONTAINER: &str = "devforge-pg";
pub const VOLUME: &str = "devforge-pg";
pub const STANDBY_CONTAINER: &str = "devforge-pg-ha";
pub const STANDBY_VOLUME: &str = "devforge-pg-ha";
pub const STANDBY_PORT: u16 = 5434;
pub const INCOMING_VOLUME: &str = "devforge-pg-incoming";
pub const SNAPSHOT_HEADER: &str = "-- DevForge postgres snapshot\n";
const IMAGE: &str = "postgres:16-alpine";
const REPL_USER: &str = "replicator";

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Creds {
    user: String,
    password: String,
    database: String,
    port: u16,
    #[serde(default)]
    replication_password: String,
}

struct Meta {
    url: String,
    container: Option<String>,
    user: String,
    database: String,
    replication_password: String,
    port: u16,
    public_bind: bool,
}

static META: OnceLock<Meta> = OnceLock::new();
static MODE: AtomicU8 = AtomicU8::new(0);

#[derive(Clone, Debug)]
pub struct ReplAdvert {
    pub host: String,
    pub port: u16,
    pub password: String,
}

pub fn snapshot_is_postgres(bytes: &[u8]) -> bool {
    bytes.starts_with(SNAPSHOT_HEADER.as_bytes())
}

/// Hôte joignable d'une URL `http://hôte:port`.
pub fn advertise_host(url: &str) -> Option<String> {
    let u = url.trim().trim_end_matches('/');
    let rest = u
        .strip_prefix("https://")
        .or_else(|| u.strip_prefix("http://"))
        .unwrap_or(u);
    let hostport = rest.split('/').next().unwrap_or("");
    if hostport.starts_with('[') {
        return None;
    }
    let host = hostport.split(':').next().unwrap_or("").trim();
    if host.is_empty()
        || host.len() > 253
        || !host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
    {
        return None;
    }
    Some(host.to_string())
}

pub fn replication_advertisement(advertise_url: &str) -> Option<ReplAdvert> {
    let meta = META.get()?;
    if meta.container.is_none() || !meta.public_bind || meta.replication_password.is_empty() {
        return None;
    }
    let host = advertise_host(advertise_url)?;
    if devforge_cluster::is_loopback_advertise_url(&format!("http://{host}")) {
        return None;
    }
    Some(ReplAdvert {
        host,
        port: meta.port,
        password: meta.replication_password.clone(),
    })
}

/// Démarre Postgres si besoin et renvoie une URL `postgres://`.
pub async fn ensure(legacy_url: &str) -> Result<String, String> {
    if is_postgres_url(legacy_url) {
        let _ = META.set(Meta {
            url: legacy_url.to_string(),
            container: None,
            user: String::new(),
            database: String::new(),
            replication_password: String::new(),
            port: 0,
            public_bind: false,
        });
        return Ok(legacy_url.to_string());
    }
    let creds = load_or_create_creds(legacy_url)?;
    let public = wants_public_primary();
    start_container(&creds, public).await?;
    let url = connection_url(&creds).await?;
    let _ = META.set(Meta {
        url: url.clone(),
        container: Some(CONTAINER.into()),
        user: creds.user.clone(),
        database: creds.database.clone(),
        replication_password: creds.replication_password.clone(),
        port: creds.port,
        public_bind: public,
    });
    Ok(url)
}

pub async fn import_legacy_sqlite(pool: &sqlx::PgPool, sqlite_file: &Path) -> Result<(), String> {
    if !sqlite_file.is_file() {
        return Ok(());
    }
    let header = std::fs::read(sqlite_file).map_err(|e| e.to_string())?;
    if !header.starts_with(b"SQLite format 3\0") {
        return Ok(());
    }
    let exists: (Option<String>,) = sqlx::query_as("SELECT to_regclass('public.projects')::text")
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?;
    if exists.0.is_some() {
        return Ok(());
    }
    let plan = plan_sqlite_file(sqlite_file).await?;
    if plan.tables == 0 {
        return Ok(());
    }
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    for stmt in devforge_database::split_statements(&plan.sql) {
        if let Err(e) = sqlx::raw_sql(&stmt).execute(&mut *conn).await {
            let preview: String = stmt.chars().take(180).collect();
            return Err(format!("import SQLite : {e} — {preview}"));
        }
    }
    tracing::info!(
        file = %sqlite_file.display(),
        tables = plan.tables,
        rows = plan.rows,
        "control plane importé depuis SQLite"
    );
    Ok(())
}

pub async fn replace_from_sqlite(pool: &sqlx::PgPool, sqlite_file: &Path) -> Result<(), String> {
    sqlx::query("DROP SCHEMA IF EXISTS public CASCADE")
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("CREATE SCHEMA public")
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    import_legacy_sqlite(pool, sqlite_file).await
}

/// État visible par l'admin. Jamais de mot de passe.
pub async fn admin_status() -> serde_json::Value {
    let Some(meta) = META.get() else {
        return serde_json::json!({
            "ready": false,
            "engine": "postgres",
        });
    };
    let durability = match MODE.load(Ordering::Acquire) {
        1 => "remote_apply",
        2 => "local",
        _ => "inconnu",
    };
    if meta.container.is_none() {
        return serde_json::json!({
            "ready": true,
            "engine": "postgres",
            "placement": "externe",
            "host": url_host(&meta.url),
            "database": meta.database,
            "user": meta.user,
            "port": meta.port,
            "public": false,
            "replicas_streaming": 0,
            "durability": durability,
        });
    }
    let streaming = psql(
        CONTAINER,
        &meta.user,
        &meta.database,
        "SELECT count(*)::text FROM pg_stat_replication WHERE state = 'streaming'",
    )
    .await
    .ok()
    .and_then(|s| {
        s.trim()
            .lines()
            .next()
            .unwrap_or("")
            .trim()
            .parse::<i64>()
            .ok()
    })
    .unwrap_or(0);
    serde_json::json!({
        "ready": true,
        "engine": "postgres",
        "placement": "conteneur",
        "container": CONTAINER,
        "standby_container": STANDBY_CONTAINER,
        "database": meta.database,
        "user": meta.user,
        "port": meta.port,
        "public": meta.public_bind,
        "replicas_streaming": streaming,
        "durability": durability,
    })
}

fn url_host(url: &str) -> String {
    url.split('@')
        .nth(1)
        .unwrap_or("")
        .split('/')
        .next()
        .unwrap_or("")
        .to_string()
}

pub async fn dump_snapshot() -> Result<Vec<u8>, String> {
    let meta = META.get().ok_or("postgres control plane non initialisé")?;
    let sql = if let Some(container) = &meta.container {
        docker_dump(container, &meta.user, &meta.database).await?
    } else if !meta.url.is_empty() {
        dump_url(&meta.url).await?
    } else {
        return Err("pg_dump indisponible".into());
    };
    let mut bytes = SNAPSHOT_HEADER.as_bytes().to_vec();
    bytes.extend(sql);
    Ok(bytes)
}

pub async fn restore_snapshot(bytes: &[u8]) -> Result<(), String> {
    let sql = bytes
        .strip_prefix(SNAPSHOT_HEADER.as_bytes())
        .ok_or("snapshot postgres invalide")?;
    let meta = META.get().ok_or("postgres control plane non initialisé")?;
    if let Some(container) = &meta.container {
        let _ = psql(
            container,
            &meta.user,
            &meta.database,
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()",
        )
        .await;
        psql_bytes(container, &meta.user, &meta.database, sql)
            .await
            .map(|_| ())
    } else if !meta.url.is_empty() {
        psql_url(&meta.url, sql).await
    } else {
        Err("restauration snapshot : postgres absent".into())
    }
}

/// Attend qu'une réplique ait rejoué le WAL courant.
pub async fn wait_replica(timeout: Duration) -> bool {
    let Some(meta) = META.get() else {
        return false;
    };
    let Some(container) = &meta.container else {
        return false;
    };
    let sql = "SELECT CASE WHEN EXISTS (\
        SELECT 1 FROM pg_stat_replication \
        WHERE state = 'streaming' AND pg_wal_lsn_diff(replay_lsn, pg_current_wal_lsn()) >= 0\
    ) THEN '1' ELSE '0' END";
    let start = std::time::Instant::now();
    while start.elapsed() < timeout {
        if let Ok(out) = psql(container, &meta.user, &meta.database, sql).await {
            if out.trim() == "1" {
                return true;
            }
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    false
}

/// Commit synchrone dès qu'une réplique streame, local sinon (un nœud seul n'attend pas).
pub async fn tune_durability() {
    let Some(meta) = META
        .get()
        .filter(|m| m.container.is_some() && m.public_bind)
    else {
        return;
    };
    let Some(container) = &meta.container else {
        return;
    };
    let Ok(n) = psql(
        container,
        &meta.user,
        &meta.database,
        "SELECT count(*)::text FROM pg_stat_replication WHERE state = 'streaming'",
    )
    .await
    else {
        return;
    };
    let streaming = n.trim().parse::<i64>().unwrap_or(0) > 0;
    let next = if streaming { 1 } else { 2 };
    if MODE.swap(next, Ordering::AcqRel) == next {
        return;
    }
    let sql = if streaming {
        "ALTER SYSTEM SET synchronous_standby_names = 'ANY 1 (*)'; \
         ALTER SYSTEM SET synchronous_commit = 'remote_apply'; \
         SELECT pg_reload_conf()"
    } else {
        "ALTER SYSTEM SET synchronous_standby_names = ''; \
         ALTER SYSTEM SET synchronous_commit = 'on'; \
         SELECT pg_reload_conf()"
    };
    if let Err(e) = psql(container, &meta.user, &meta.database, sql).await {
        MODE.store(0, Ordering::Release);
        tracing::warn!(error = %e, "réglage durabilité postgres");
    }
}

pub async fn standby_streaming() -> bool {
    match psql(
        STANDBY_CONTAINER,
        "devforge",
        "devforge",
        "SELECT CASE WHEN pg_is_in_recovery() AND EXISTS (SELECT 1 FROM pg_stat_wal_receiver WHERE status = 'streaming') THEN '1' ELSE '0' END",
    )
    .await
    {
        Ok(out) => out.trim() == "1",
        Err(_) => false,
    }
}

/// Réplique physique du primaire. Reconstruit le volume si l'amont a changé.
pub async fn ensure_standby(host: &str, port: u16, password: &str) -> Result<(), String> {
    ensure_host(host)?;
    if !hex_token(password) {
        return Err("mot de passe de réplication invalide".into());
    }
    let want = format!("{host}:{port}");
    let current = std::fs::read_to_string(upstream_path()).unwrap_or_default();
    if current.trim() == want && standby_streaming().await {
        return Ok(());
    }
    tracing::info!(upstream = %want, "reconstruction de la réplique control plane");
    let _ = docker(&["rm", "-f", STANDBY_CONTAINER]).await;
    let _ = docker(&["volume", "rm", STANDBY_VOLUME]).await;
    basebackup_into(STANDBY_VOLUME, host, port, password, true).await?;
    let _ = docker_sh(&[
        "run",
        "--rm",
        "-v",
        &format!("{STANDBY_VOLUME}:/var/lib/postgresql/data"),
        IMAGE,
        "sh",
        "-c",
        "echo \"hot_standby_feedback = on\" >> /var/lib/postgresql/data/postgresql.auto.conf",
    ])
    .await;
    let bind = format!("127.0.0.1:{STANDBY_PORT}:5432");
    let run = docker(&[
        "run",
        "-d",
        "--name",
        STANDBY_CONTAINER,
        "--restart",
        "unless-stopped",
        "--network",
        "devforge",
        "-p",
        &bind,
        "-v",
        &format!("{STANDBY_VOLUME}:/var/lib/postgresql/data"),
        IMAGE,
    ])
    .await?;
    if !run.status.success() {
        return Err(format!(
            "démarrage réplique : {}",
            String::from_utf8_lossy(&run.stderr)
        ));
    }
    if let Some(parent) = upstream_path().parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(upstream_path(), want).map_err(|e| e.to_string())?;
    Ok(())
}

/// Promeut la réplique locale et l'installe comme base du processus.
pub async fn takeover_from_standby() -> Result<(), String> {
    promote_container(STANDBY_CONTAINER, "devforge", "devforge").await?;
    let _ = docker(&["stop", CONTAINER]).await;
    let _ = docker(&["rm", CONTAINER]).await;
    let _ = docker(&["stop", STANDBY_CONTAINER]).await;
    replace_volume(STANDBY_VOLUME, VOLUME).await?;
    let _ = docker(&["rm", STANDBY_CONTAINER]).await;
    tracing::warn!("réplique promue, elle devient le control plane local");
    Ok(())
}

pub async fn quiesce_for_clone() -> Result<(), String> {
    let meta = META.get().ok_or("postgres non initialisé")?;
    let Some(container) = &meta.container else {
        return Ok(());
    };
    psql(
        container,
        &meta.user,
        &meta.database,
        "ALTER SYSTEM SET default_transaction_read_only = on; SELECT pg_reload_conf(); CHECKPOINT",
    )
    .await?;
    Ok(())
}

pub async fn resume_after_clone() -> Result<(), String> {
    let Some(meta) = META.get() else {
        return Ok(());
    };
    let Some(container) = &meta.container else {
        return Ok(());
    };
    psql(
        container,
        &meta.user,
        &meta.database,
        "ALTER SYSTEM RESET default_transaction_read_only; SELECT pg_reload_conf()",
    )
    .await?;
    Ok(())
}

pub async fn stage_clone_from(host: &str, port: u16, password: &str) -> Result<(), String> {
    basebackup_into(INCOMING_VOLUME, host, port, password, false).await
}

pub fn arm_staged_clone() -> Result<(), String> {
    let path = reclaim_volume_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, "1").map_err(|e| e.to_string())
}

pub async fn adopt_staged_clone_if_armed() -> Result<(), String> {
    let path = reclaim_volume_path();
    if !path.is_file() {
        return Ok(());
    }
    tracing::warn!("reprise du control plane depuis la copie de l'intérim");
    let _ = docker(&["stop", CONTAINER]).await;
    replace_volume(INCOMING_VOLUME, VOLUME).await?;
    let _ = docker(&["volume", "rm", INCOMING_VOLUME]).await;
    let _ = std::fs::remove_file(path);
    Ok(())
}

pub async fn basebackup_into(
    volume: &str,
    host: &str,
    port: u16,
    password: &str,
    as_standby: bool,
) -> Result<(), String> {
    ensure_host(host)?;
    if !hex_token(password) {
        return Err("mot de passe de réplication invalide".into());
    }
    ensure_volume_token(volume)?;
    let _ = docker(&["volume", "rm", volume]).await;
    let created = docker(&["volume", "create", volume]).await?;
    if !created.status.success() {
        return Err(String::from_utf8_lossy(&created.stderr).to_string());
    }
    let mount = format!("{volume}:/var/lib/postgresql/data");
    let prep = docker(&[
        "run",
        "--rm",
        "--user",
        "root",
        "-v",
        &mount,
        IMAGE,
        "sh",
        "-c",
        "rm -rf /var/lib/postgresql/data/* /var/lib/postgresql/data/.[!.]*; chown postgres:postgres /var/lib/postgresql/data",
    ])
    .await?;
    if !prep.status.success() {
        return Err(format!(
            "préparation volume : {}",
            String::from_utf8_lossy(&prep.stderr)
        ));
    }
    let port_s = port.to_string();
    let mut args: Vec<String> = [
        "run",
        "--rm",
        "--user",
        "postgres",
        "--network",
        "host",
        "-e",
        &format!("PGPASSWORD={password}"),
        "-v",
        &mount,
        IMAGE,
        "pg_basebackup",
        "-h",
        host,
        "-p",
        &port_s,
        "-U",
        REPL_USER,
        "-D",
        "/var/lib/postgresql/data",
        "-Fp",
        "-Xs",
    ]
    .into_iter()
    .map(str::to_string)
    .collect();
    if as_standby {
        args.push("-R".into());
    }
    args.push("-c".into());
    args.push("fast".into());
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let backup = docker(&arg_refs).await?;
    if !backup.status.success() {
        return Err(format!(
            "pg_basebackup : {}",
            String::from_utf8_lossy(&backup.stderr)
        ));
    }
    Ok(())
}

pub async fn promote_container(container: &str, user: &str, database: &str) -> Result<(), String> {
    ensure_volume_token(container)?;
    let promote = docker(&[
        "exec",
        "-u",
        "postgres",
        container,
        "pg_ctl",
        "promote",
        "-D",
        "/var/lib/postgresql/data",
    ])
    .await?;
    if !promote.status.success() {
        return Err(format!(
            "pg_ctl promote : {}",
            String::from_utf8_lossy(&promote.stderr)
        ));
    }
    for _ in 0..30 {
        if let Ok(out) = psql(
            container,
            user,
            database,
            "SELECT CASE WHEN pg_is_in_recovery() THEN 't' ELSE 'f' END",
        )
        .await
        {
            if out.trim() == "f" {
                return Ok(());
            }
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    Err("promotion postgres trop lente".into())
}

fn wants_public_primary() -> bool {
    if devforge_cluster::promote_flag_path().is_file() {
        return true;
    }
    let path = devforge_cluster::failover_identity_path();
    if let Ok(raw) = std::fs::read_to_string(path) {
        if let Ok(local) = serde_json::from_str::<devforge_cluster::LocalClusterState>(&raw) {
            if local.role == devforge_cluster::NodeRole::Worker && !local.acting_leader {
                return false;
            }
        }
    }
    true
}

fn is_postgres_url(url: &str) -> bool {
    let u = url.trim().to_ascii_lowercase();
    u.starts_with("postgres://") || u.starts_with("postgresql://")
}

fn creds_path(legacy_url: &str) -> PathBuf {
    let sqlite = devforge_backup::sqlite_path_from_url(legacy_url);
    let dir = sqlite
        .parent()
        .map(Path::to_path_buf)
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| PathBuf::from("data"));
    dir.join("control-pg.json")
}

fn load_or_create_creds(legacy_url: &str) -> Result<Creds, String> {
    let path = creds_path(legacy_url);
    if let Ok(raw) = std::fs::read_to_string(&path) {
        if let Ok(mut creds) = serde_json::from_str::<Creds>(&raw) {
            if creds.replication_password.is_empty() {
                creds.replication_password = new_secret();
                save_creds(&path, &creds)?;
            }
            return Ok(creds);
        }
    }
    let creds = Creds {
        user: "devforge".into(),
        password: new_secret(),
        database: "devforge".into(),
        port: 5433,
        replication_password: new_secret(),
    };
    save_creds(&path, &creds)?;
    Ok(creds)
}

fn save_creds(path: &Path, creds: &Creds) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(
        path,
        serde_json::to_vec_pretty(creds).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

fn new_secret() -> String {
    let raw = uuid::Uuid::new_v4().simple().to_string();
    raw[..24].to_string()
}

fn in_docker() -> bool {
    Path::new("/.dockerenv").exists()
}

fn self_container_id() -> Option<String> {
    if let Ok(name) = std::env::var("DEVFORGE_SELF_CONTAINER") {
        let name = name.trim();
        if !name.is_empty() {
            return Some(name.to_string());
        }
    }
    let id = std::fs::read_to_string("/etc/hostname").unwrap_or_default();
    let id = id.trim();
    if id.is_empty() {
        None
    } else {
        Some(id.to_string())
    }
}

/// Les outils lancés dans `devforge-pg` parlent au port interne 5432.
fn container_listen_port(_container: &str) -> Option<u16> {
    None
}

async fn tcp_open(host: &str, port: u16) -> bool {
    let addr = format!("{host}:{port}");
    tokio::time::timeout(
        Duration::from_secs(2),
        tokio::net::TcpStream::connect(&addr),
    )
    .await
    .ok()
    .and_then(|r| r.ok())
    .is_some()
}

async fn connection_url(creds: &Creds) -> Result<String, String> {
    // Dans Docker, 127.0.0.1 est le conteneur DevForge, pas Postgres.
    // On joint le conteneur par le DNS du réseau `devforge`.
    let (host, port) = if in_docker() {
        if tcp_open(CONTAINER, 5432).await {
            (CONTAINER.to_string(), 5432u16)
        } else if tcp_open("127.0.0.1", creds.port).await {
            ("127.0.0.1".into(), creds.port)
        } else if tcp_open("127.0.0.1", 5432).await {
            ("127.0.0.1".into(), 5432)
        } else {
            return Err(format!(
                "Postgres injoignable sur {CONTAINER}:5432 (réseau Docker devforge). \
                 Vérifie que le conteneur DevForge est relié à ce réseau."
            ));
        }
    } else if tcp_open("127.0.0.1", creds.port).await {
        ("127.0.0.1".into(), creds.port)
    } else {
        return Err(format!("Postgres injoignable sur 127.0.0.1:{}", creds.port));
    };
    tracing::info!(%host, port, "control plane postgres joignable");
    Ok(format!(
        "postgres://{}:{}@{}:{}/{}?sslmode=disable",
        creds.user, creds.password, host, port, creds.database
    ))
}

async fn start_container(creds: &Creds, public: bool) -> Result<(), String> {
    let _ = docker(&["network", "create", "devforge"]).await;
    let want_ip = if public { "0.0.0.0" } else { "127.0.0.1" };
    if container_needs_recreate(want_ip, creds.port, public).await {
        let _ = docker(&["stop", CONTAINER]).await;
        let _ = docker(&["rm", CONTAINER]).await;
    }
    let inspect = docker(&["inspect", "-f", "{{.State.Running}}", CONTAINER]).await;
    let exists = inspect
        .as_ref()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if exists {
        let running = inspect
            .as_ref()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim() == "true")
            .unwrap_or(false);
        if !running {
            let start = docker(&["start", CONTAINER]).await?;
            if !start.status.success() {
                return Err(String::from_utf8_lossy(&start.stderr).to_string());
            }
        }
    } else {
        let vol = format!("{VOLUME}:/var/lib/postgresql/data");
        let user = format!("POSTGRES_USER={}", creds.user);
        let password = format!("POSTGRES_PASSWORD={}", creds.password);
        let db = format!("POSTGRES_DB={}", creds.database);
        let listen = if public {
            "listen_addresses=0.0.0.0"
        } else {
            "listen_addresses=127.0.0.1"
        };
        // Dans Docker, le compose publie déjà 5433 sur le conteneur DevForge.
        // Postgres reste sur le réseau `devforge`, port interne 5432, sans second -p.
        let run = if in_docker() {
            docker(&[
                "run",
                "-d",
                "--name",
                CONTAINER,
                "--restart",
                "unless-stopped",
                "--network",
                "devforge",
                "--network-alias",
                CONTAINER,
                "-v",
                &vol,
                "-e",
                &user,
                "-e",
                &password,
                "-e",
                &db,
                IMAGE,
                "postgres",
                "-c",
                listen,
                "-c",
                "wal_level=replica",
                "-c",
                "hot_standby=on",
                "-c",
                "max_wal_senders=10",
                "-c",
                "max_replication_slots=10",
                "-c",
                "wal_keep_size=256MB",
                "-c",
                "wal_log_hints=on",
                "-c",
                "synchronous_commit=on",
                "-c",
                "synchronous_standby_names=",
            ])
            .await?
        } else {
            let bind = format!("{want_ip}:{}:5432", creds.port);
            docker(&[
                "run",
                "-d",
                "--name",
                CONTAINER,
                "--restart",
                "unless-stopped",
                "--network",
                "devforge",
                "--network-alias",
                CONTAINER,
                "-p",
                &bind,
                "-v",
                &vol,
                "-e",
                &user,
                "-e",
                &password,
                "-e",
                &db,
                IMAGE,
                "postgres",
                "-c",
                listen,
                "-c",
                "wal_level=replica",
                "-c",
                "hot_standby=on",
                "-c",
                "max_wal_senders=10",
                "-c",
                "max_replication_slots=10",
                "-c",
                "wal_keep_size=256MB",
                "-c",
                "wal_log_hints=on",
                "-c",
                "synchronous_commit=on",
                "-c",
                "synchronous_standby_names=",
            ])
            .await?
        };
        if !run.status.success() {
            return Err(format!(
                "démarrage postgres : {}",
                String::from_utf8_lossy(&run.stderr)
            ));
        }
    }
    if let Some(id) = self_container_id() {
        let joined = docker(&["network", "connect", "devforge", &id]).await;
        if let Ok(out) = joined {
            if !out.status.success() {
                let err = String::from_utf8_lossy(&out.stderr);
                if !err.contains("already exists") {
                    tracing::warn!(error = %err.trim(), "rattachement au réseau devforge");
                }
            }
        }
    }
    let mut last = String::new();
    for _ in 0..40 {
        let ready = docker(&[
            "exec",
            CONTAINER,
            "pg_isready",
            "-h",
            "127.0.0.1",
            "-p",
            "5432",
            "-U",
            &creds.user,
            "-d",
            &creds.database,
        ])
        .await?;
        if ready.status.success() {
            configure_primary(creds).await?;
            return Ok(());
        }
        let err = String::from_utf8_lossy(&ready.stderr);
        let out = String::from_utf8_lossy(&ready.stdout);
        last = format!("{} {}", err.trim(), out.trim()).trim().to_string();
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    let logs = docker(&["logs", "--tail", "30", CONTAINER]).await.ok();
    let tail = logs
        .map(|o| {
            let mut text = String::from_utf8_lossy(&o.stderr).to_string();
            text.push_str(&String::from_utf8_lossy(&o.stdout));
            text.trim().to_string()
        })
        .unwrap_or_default();
    Err(format!("postgres devforge-pg pas prêt: {last} {tail}"))
}

async fn container_needs_recreate(want_ip: &str, port: u16, public: bool) -> bool {
    let fmt = "{{.HostConfig.NetworkMode}}|{{json .HostConfig.PortBindings}}|{{json .Config.Cmd}}";
    let Ok(out) = docker(&["inspect", "-f", fmt, CONTAINER]).await else {
        return false;
    };
    if !out.status.success() {
        return false;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut parts = text.trim().splitn(3, '|');
    let network = parts.next().unwrap_or("");
    let bindings = parts.next().unwrap_or("");
    let cmd = parts.next().unwrap_or("");
    if network.starts_with("container:") || cmd.contains("port=") {
        return true;
    }
    let listen = if public {
        "listen_addresses=0.0.0.0"
    } else {
        "listen_addresses=127.0.0.1"
    };
    if !cmd.contains("wal_keep_size") || !cmd.contains(listen) {
        return true;
    }
    if in_docker() {
        return network != "devforge";
    }
    let port_s = port.to_string();
    let bind_ok = bindings.contains(&port_s)
        && (bindings.contains(want_ip)
            || (want_ip == "0.0.0.0" && bindings.contains("\"HostIp\":\"\"")));
    !bind_ok
}

async fn configure_primary(creds: &Creds) -> Result<(), String> {
    if !hex_token(&creds.replication_password) {
        return Err("mot de passe de réplication invalide".into());
    }
    let sql = format!(
        "DO $$ BEGIN \
           IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '{REPL_USER}') THEN \
             CREATE ROLE {REPL_USER} WITH REPLICATION LOGIN PASSWORD '{pw}'; \
           ELSE \
             ALTER ROLE {REPL_USER} WITH LOGIN REPLICATION PASSWORD '{pw}'; \
           END IF; \
         END $$; \
         ALTER SYSTEM RESET default_transaction_read_only; \
         ALTER SYSTEM SET synchronous_standby_names = ''; \
         ALTER SYSTEM SET synchronous_commit = 'on'; \
         SELECT pg_reload_conf()",
        pw = creds.replication_password
    );
    psql(CONTAINER, &creds.user, &creds.database, &sql).await?;
    let hba = docker(&[
        "exec",
        CONTAINER,
        "sh",
        "-c",
        "grep -q 'host replication replicator all scram-sha-256' /var/lib/postgresql/data/pg_hba.conf || echo 'host replication replicator all scram-sha-256' >> /var/lib/postgresql/data/pg_hba.conf",
    ])
    .await?;
    if !hba.status.success() {
        return Err(format!("pg_hba : {}", String::from_utf8_lossy(&hba.stderr)));
    }
    psql(
        CONTAINER,
        &creds.user,
        &creds.database,
        "SELECT pg_reload_conf()",
    )
    .await?;
    Ok(())
}

async fn replace_volume(from: &str, to: &str) -> Result<(), String> {
    ensure_volume_token(from)?;
    ensure_volume_token(to)?;
    let created = docker(&["volume", "create", to]).await?;
    if !created.status.success() {
        return Err(String::from_utf8_lossy(&created.stderr).to_string());
    }
    let from_m = format!("{from}:/from:ro");
    let to_m = format!("{to}:/to");
    let copy = docker(&[
        "run",
        "--rm",
        "-v",
        &from_m,
        "-v",
        &to_m,
        IMAGE,
        "sh",
        "-c",
        "rm -rf /to/* /to/.[!.]*; cp -a /from/. /to/",
    ])
    .await?;
    if !copy.status.success() {
        return Err(format!(
            "copie volume : {}",
            String::from_utf8_lossy(&copy.stderr)
        ));
    }
    Ok(())
}

async fn docker_dump(container: &str, user: &str, database: &str) -> Result<Vec<u8>, String> {
    let port_env = container_listen_port(container).map(|p| format!("PGPORT={p}"));
    let mut args = vec!["exec"];
    if let Some(env) = port_env.as_deref() {
        args.extend(["-e", env]);
    }
    args.extend([
        container,
        "pg_dump",
        "-U",
        user,
        "--no-owner",
        "--no-acl",
        "--clean",
        "--if-exists",
        database,
    ]);
    let out = docker(&args).await?;
    if !out.status.success() {
        return Err(format!(
            "pg_dump : {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    Ok(out.stdout)
}

async fn dump_url(url: &str) -> Result<Vec<u8>, String> {
    if let Ok(out) = Command::new("pg_dump")
        .args([
            "--no-owner",
            "--no-acl",
            "--clean",
            "--if-exists",
            "--dbname",
            url,
        ])
        .output()
        .await
    {
        if out.status.success() && !out.stdout.is_empty() {
            return Ok(out.stdout);
        }
    }
    let out = docker(&[
        "run",
        "--rm",
        "--network",
        "host",
        IMAGE,
        "pg_dump",
        "--no-owner",
        "--no-acl",
        "--clean",
        "--if-exists",
        "--dbname",
        url,
    ])
    .await?;
    if !out.status.success() {
        return Err(format!(
            "pg_dump : {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    Ok(out.stdout)
}

async fn psql(container: &str, user: &str, database: &str, sql: &str) -> Result<String, String> {
    let bytes = psql_bytes(container, user, database, sql.as_bytes()).await?;
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

async fn psql_bytes(
    container: &str,
    user: &str,
    database: &str,
    sql: &[u8],
) -> Result<Vec<u8>, String> {
    let port_env = container_listen_port(container).map(|p| format!("PGPORT={p}"));
    let mut cmd = Command::new("docker");
    cmd.arg("exec").arg("-i");
    if let Some(env) = port_env.as_deref() {
        cmd.arg("-e").arg(env);
    }
    let mut child = cmd
        .args([
            container,
            "psql",
            "-v",
            "ON_ERROR_STOP=1",
            "-U",
            user,
            "-d",
            database,
            "-tA",
        ])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("docker exec psql : {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(sql)
            .await
            .map_err(|e| format!("envoi SQL : {e}"))?;
    }
    let out = child
        .wait_with_output()
        .await
        .map_err(|e| format!("psql : {e}"))?;
    if !out.status.success() {
        return Err(format!("psql : {}", String::from_utf8_lossy(&out.stderr)));
    }
    Ok(out.stdout)
}

async fn psql_url(url: &str, sql: &[u8]) -> Result<(), String> {
    let mut child = Command::new("docker")
        .args([
            "run",
            "--rm",
            "-i",
            "--network",
            "host",
            IMAGE,
            "psql",
            "--dbname",
            url,
            "-v",
            "ON_ERROR_STOP=1",
        ])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("psql : {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(sql)
            .await
            .map_err(|e| format!("envoi SQL : {e}"))?;
    }
    let out = child
        .wait_with_output()
        .await
        .map_err(|e| format!("psql : {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "restauration : {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    Ok(())
}

async fn docker(args: &[&str]) -> Result<std::process::Output, String> {
    Command::new("docker")
        .args(args)
        .output()
        .await
        .map_err(|e| format!("docker : {e}"))
}

async fn docker_sh(args: &[&str]) -> Result<std::process::Output, String> {
    docker(args).await
}

fn upstream_path() -> PathBuf {
    devforge_cluster::data_dir().join("standby-upstream")
}

fn reclaim_volume_path() -> PathBuf {
    devforge_cluster::data_dir().join("cluster-reclaim-volume")
}

fn ensure_host(host: &str) -> Result<(), String> {
    if advertise_host(&format!("http://{host}")) == Some(host.to_string()) {
        Ok(())
    } else {
        Err("hôte postgres invalide".into())
    }
}

fn hex_token(value: &str) -> bool {
    !value.is_empty() && value.len() <= 64 && value.chars().all(|c| c.is_ascii_hexdigit())
}

fn ensure_volume_token(value: &str) -> Result<(), String> {
    let ok = !value.is_empty()
        && value.len() <= 63
        && value
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_');
    if ok {
        Ok(())
    } else {
        Err("nom de volume invalide".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn advertise_host_keeps_the_hostname() {
        assert_eq!(
            advertise_host("https://forge.example:8443/app").as_deref(),
            Some("forge.example")
        );
        assert_eq!(
            advertise_host("http://10.1.0.8:8000").as_deref(),
            Some("10.1.0.8")
        );
        assert!(advertise_host("http://[::1]:8000").is_none());
        assert!(advertise_host("http://bad host").is_none());
    }
}
