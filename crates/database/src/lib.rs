mod pg_instance;
mod sqlite_to_pg;

pub use pg_instance::{
    apply_sql_shell, drop_shell, dump_shell, ensure_published_shell, promote_standby_shell,
    provision_shell, standby_shell, wait_shell, PgInstance,
};
pub use sqlite_to_pg::{plan_sqlite_file, resolve_sqlite_source, MigrationPlan};

use serde_json::{json, Value};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use uuid::Uuid;

/// Provisioning SQLite applicatif : un fichier par base, ouvert réellement.
pub struct DatabaseFacade {
    root: PathBuf,
}

impl DatabaseFacade {
    pub fn new() -> Self {
        Self {
            root: default_root(),
        }
    }

    pub fn with_root(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub async fn provision(&self, name: &str, engine: Option<&str>) -> Value {
        let name = name.trim();
        if name.is_empty() {
            return json!({ "ok": false, "error": "name requis" });
        }
        let engine = engine.unwrap_or("sqlite").trim();
        if engine != "sqlite" {
            return json!({
                "ok": false,
                "error": format!("Moteur « {engine} » : un fichier local reste en SQLite. Une instance PostgreSQL se crée sur le projet (onglet Database)."),
                "engine": engine
            });
        }
        let uuid = Uuid::new_v4().to_string();
        let file = self.root.join(format!("{}.db", slugify(name)));
        match provision_sqlite_file(&file).await {
            Ok(url) => {
                let meta = json!({
                    "ok": true,
                    "uuid": uuid,
                    "name": name,
                    "engine": "sqlite",
                    "path": file.display().to_string(),
                    "url": url
                });
                if let Err(e) = write_meta(&self.root, &uuid, &meta) {
                    return json!({ "ok": false, "error": format!("catalogue : {e}") });
                }
                meta
            }
            Err(e) => json!({ "ok": false, "error": e, "name": name }),
        }
    }

    pub fn status(&self, database_uuid: &str) -> Value {
        let path = self.root.join(format!("{database_uuid}.json"));
        match std::fs::read_to_string(&path) {
            Ok(raw) => serde_json::from_str(&raw).unwrap_or_else(
                |_| json!({ "ok": false, "uuid": database_uuid, "error": "catalogue illisible" }),
            ),
            Err(_) => json!({
                "ok": false,
                "uuid": database_uuid,
                "error": "Base introuvable"
            }),
        }
    }
}

impl Default for DatabaseFacade {
    fn default() -> Self {
        Self::new()
    }
}

/// Crée (ou rouvre) un fichier SQLite et pose un marqueur DevForge.
pub async fn provision_sqlite_file(path: &Path) -> Result<String, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("répertoire {} : {e}", parent.display()))?;
    }
    let opts = SqliteConnectOptions::from_str(&format!("sqlite:{}", path.display()))
        .map_err(|e| e.to_string())?
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await
        .map_err(|e| format!("ouverture SQLite {} : {e}", path.display()))?;
    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS _devforge_db (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )"#,
    )
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;
    sqlx::query("INSERT OR IGNORE INTO _devforge_db (key, value) VALUES ('engine', 'sqlite')")
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    pool.close().await;
    Ok(sqlite_url(path))
}

pub fn sqlite_url(path: &Path) -> String {
    let s = path.to_string_lossy().replace('\\', "/");
    format!("sqlite:{s}?mode=rwc")
}

fn default_root() -> PathBuf {
    if let Ok(dir) = std::env::var("DEVFORGE_DATABASES_DIR") {
        return PathBuf::from(dir);
    }
    if let Ok(dir) = std::env::var("DEVFORGE_DATA_DIR") {
        return PathBuf::from(dir).join("databases");
    }
    PathBuf::from("data/databases")
}

fn slugify(name: &str) -> String {
    let mut out = String::new();
    for c in name.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if c == '-' || c == '_' || c.is_whitespace() {
            if !out.ends_with('-') {
                out.push('-');
            }
        }
    }
    let out = out.trim_matches('-').to_string();
    if out.is_empty() {
        "db".into()
    } else {
        out
    }
}

fn write_meta(root: &Path, uuid: &str, meta: &Value) -> Result<(), String> {
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let path = root.join(format!("{uuid}.json"));
    std::fs::write(
        &path,
        serde_json::to_vec_pretty(meta).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

/// Base Postgres jetable pour les tests. Le conteneur `devforge-pg-test` écoute sur 54329.
pub async fn ephemeral_pg() -> sqlx::PgPool {
    let admin_url = std::env::var("DEVFORGE_TEST_PG").unwrap_or_else(|_| {
        "postgres://devforge:devforge@127.0.0.1:54329/postgres?sslmode=disable".into()
    });
    let admin = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(&admin_url)
        .await
        .expect("Postgres de test injoignable sur 127.0.0.1:54329 (conteneur devforge-pg-test)");
    let name = format!("t_{}", &Uuid::new_v4().simple().to_string()[..16]);
    sqlx::query(&format!("CREATE DATABASE {name}"))
        .execute(&admin)
        .await
        .expect("CREATE DATABASE");
    admin.close().await;
    let url = swap_db_name(&admin_url, &name);
    sqlx::postgres::PgPoolOptions::new()
        .max_connections(5)
        .connect(&url)
        .await
        .expect("connexion à la base de test")
}

fn swap_db_name(url: &str, name: &str) -> String {
    let (base, query) = match url.split_once('?') {
        Some((b, q)) => (b, q),
        None => (url, ""),
    };
    let prefix = base.rsplit_once('/').map(|(p, _)| p).unwrap_or(base);
    if query.is_empty() {
        format!("{prefix}/{name}")
    } else {
        format!("{prefix}/{name}?{query}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn provision_creates_a_reopenable_sqlite_file() {
        let dir = std::env::temp_dir().join(format!("df-db-{}", Uuid::new_v4()));
        let facade = DatabaseFacade::with_root(&dir);
        let created = facade.provision("App Démo", Some("sqlite")).await;
        assert_eq!(created["ok"], json!(true), "{created}");
        let path = created["path"].as_str().unwrap();
        assert!(Path::new(path).is_file(), "{path}");
        let uuid = created["uuid"].as_str().unwrap();
        let status = facade.status(uuid);
        assert_eq!(status["ok"], json!(true));
        let again = provision_sqlite_file(Path::new(path)).await.unwrap();
        assert!(again.starts_with("sqlite:"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn postgres_is_refused() {
        let facade = DatabaseFacade::with_root(std::env::temp_dir());
        let created = facade.provision("x", Some("postgres")).await;
        assert_eq!(created["ok"], json!(false));
    }
}
