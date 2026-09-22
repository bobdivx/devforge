//! Chaîne locale : fichier écrit → base SQLite → déploiement (URL) → smoke HTTP.
//! Le déploiement réel Docker n'est pas lancé ici : le store renvoie l'URL du fichier servi.

use async_trait::async_trait;
use devforge_database::provision_sqlite_file;
use devforge_github::{GitHubFacade, StubGitHubClient};
use devforge_mcp::McpFacade;
use devforge_shared::{ProjectTestContext, Result, Tool};
use serde_json::{json, Value};
use sqlx::sqlite::SqlitePoolOptions;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use crate::tools::{HttpSmokeTool, TriggerDeployTool, WriteProjectFileTool};
use crate::ProjectStore;

struct UrlStore {
    url: String,
}

#[async_trait]
impl ProjectStore for UrlStore {
    async fn list_projects(&self) -> Result<Vec<Value>> {
        Ok(vec![])
    }
    async fn get_project(&self, _uuid: &str) -> Result<Option<Value>> {
        Ok(None)
    }
    async fn resolve_project(&self, _uuid: &str) -> Result<Option<ProjectTestContext>> {
        Ok(None)
    }
    async fn deployment_logs(&self, _uuid: &str) -> Result<Value> {
        Ok(json!({ "ok": true, "logs": "" }))
    }
    async fn trigger_deploy(
        &self,
        project_uuid: &str,
        _git_sha: Option<String>,
        _message: &str,
    ) -> Result<Value> {
        Ok(json!({
            "ok": true,
            "status": "success",
            "project_uuid": project_uuid,
            "deployment_uuid": "dep-chain",
            "url": self.url
        }))
    }
}

async fn serve_once(body: String) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let Ok((mut sock, _)) = listener.accept().await else {
            return;
        };
        let mut buf = [0u8; 2048];
        let _ = sock.read(&mut buf).await;
        let resp = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = sock.write_all(resp.as_bytes()).await;
    });
    format!("http://{addr}/")
}

#[tokio::test]
async fn scaffold_write_sqlite_deploy_and_smoke() {
    let project_uuid = format!(
        "p-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    );
    let workdir = std::env::temp_dir().join(format!("df-chain-{project_uuid}"));
    std::fs::create_dir_all(&workdir).unwrap();

    let pool = SqlitePoolOptions::new()
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::query(
        "CREATE TABLE projects (uuid TEXT PRIMARY KEY, workdir TEXT, git_repository TEXT)",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO projects (uuid, workdir, git_repository) VALUES (?, ?, '')")
        .bind(&project_uuid)
        .bind(workdir.display().to_string())
        .execute(&pool)
        .await
        .unwrap();

    let html = "<h1>devforge</h1>\n";
    let writer = WriteProjectFileTool {
        github: Arc::new(GitHubFacade::new(Arc::new(StubGitHubClient), "off")),
        mcp: Arc::new(McpFacade::stub()),
        pool: Arc::new(pool),
    };
    let written = writer
        .execute(json!({
            "project_uuid": project_uuid,
            "path": "public/index.html",
            "content": html,
            "mode": "local"
        }))
        .await
        .unwrap();
    assert_eq!(written["ok"], json!(true), "{written}");
    let diff = written["unified_diff"].as_str().unwrap_or("");
    assert!(
        diff.contains("+<h1>devforge</h1>"),
        "le chat doit recevoir le diff avant de considérer l'écriture : {diff}"
    );
    assert!(workdir.join("public/index.html").is_file());

    let db_path: PathBuf = workdir.join("data").join("app.db");
    let url = provision_sqlite_file(&db_path).await.unwrap();
    assert!(url.contains("app.db"), "{url}");
    assert!(db_path.is_file());

    let page = std::fs::read_to_string(workdir.join("public/index.html")).unwrap();
    let preview = serve_once(page).await;
    let deployed = TriggerDeployTool {
        store: Arc::new(UrlStore {
            url: preview.clone(),
        }),
    }
    .execute(json!({ "project_uuid": project_uuid, "message": "chain" }))
    .await
    .unwrap();
    assert_eq!(deployed["status"], json!("success"), "{deployed}");
    let live = deployed["url"].as_str().unwrap();

    let smoke = HttpSmokeTool
        .execute(json!({ "url": live }))
        .await
        .unwrap();
    assert_eq!(smoke["ok"], json!(true), "{smoke}");
    assert_eq!(smoke["status"], json!(200));
    assert!(smoke["excerpt"].as_str().unwrap_or("").contains("devforge"));

    let _ = std::fs::remove_dir_all(&workdir);
}
