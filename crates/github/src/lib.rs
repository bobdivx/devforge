use async_trait::async_trait;
use devforge_shared::{DevForgeError, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::{Arc, RwLock};

pub mod http;

pub use http::HttpGitHubClient;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PullRequest {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowRun {
    pub id: u64,
    pub name: String,
    pub status: String,
    pub conclusion: Option<String>,
    pub html_url: String,
    pub branch: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitTag {
    pub name: String,
    pub commit_sha: String,
    pub zipball_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitCommit {
    pub sha: String,
    pub message: String,
    pub author: String,
    pub html_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitRelease {
    pub tag: String,
    pub name: String,
    pub draft: bool,
    pub prerelease: bool,
    pub html_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitUser {
    pub login: String,
    pub name: Option<String>,
    pub html_url: String,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitRepo {
    pub full_name: String,
    pub name: String,
    pub owner: String,
    pub private: bool,
    pub default_branch: String,
    pub html_url: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitBranch {
    pub name: String,
    pub protected: bool,
    pub commit_sha: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitCompare {
    pub status: String,
    pub ahead_by: u64,
    pub behind_by: u64,
    pub base_sha: String,
    pub head_sha: String,
}

#[async_trait]
pub trait GitHubClient: Send + Sync {
    async fn current_user(&self) -> Result<GitUser>;

    async fn list_repos(&self) -> Result<Vec<GitRepo>>;

    async fn list_branches(&self, owner: &str, repo: &str) -> Result<Vec<GitBranch>>;

    async fn list_pull_requests(
        &self,
        owner: &str,
        repo: &str,
        state: &str,
    ) -> Result<Vec<PullRequest>>;

    async fn list_workflow_runs(
        &self,
        owner: &str,
        repo: &str,
        branch: Option<&str>,
    ) -> Result<Vec<WorkflowRun>>;

    async fn list_tags(&self, owner: &str, repo: &str) -> Result<Vec<GitTag>>;
    async fn list_commits(
        &self,
        owner: &str,
        repo: &str,
        branch: Option<&str>,
    ) -> Result<Vec<GitCommit>>;
    async fn list_releases(&self, owner: &str, repo: &str) -> Result<Vec<GitRelease>>;

    /// Compare `base`…`head` (sha or branch ref). `behind_by` = commits sur head absents de base.
    async fn compare(
        &self,
        owner: &str,
        repo: &str,
        base: &str,
        head: &str,
    ) -> Result<GitCompare>;

    /// List root (or path) directory entries: (name, is_file).
    async fn list_dir(
        &self,
        owner: &str,
        repo: &str,
        path: &str,
        r#ref: Option<&str>,
    ) -> Result<Vec<(String, bool)>>;

    /// Read a text file from the repo (UTF-8). Returns None if binary/missing.
    async fn read_file(
        &self,
        owner: &str,
        repo: &str,
        path: &str,
        r#ref: Option<&str>,
    ) -> Result<Option<String>>;
}

pub struct StubGitHubClient;

#[async_trait]
impl GitHubClient for StubGitHubClient {
    async fn current_user(&self) -> Result<GitUser> {
        Err(DevForgeError::Message(
            "GitHub non configuré — connecte un token dans Settings".into(),
        ))
    }

    async fn list_repos(&self) -> Result<Vec<GitRepo>> {
        Err(DevForgeError::Message(
            "GitHub non configuré — connecte un token dans Settings".into(),
        ))
    }

    async fn list_branches(&self, _owner: &str, _repo: &str) -> Result<Vec<GitBranch>> {
        Err(DevForgeError::Message(
            "GitHub non configuré — connecte un token dans Settings".into(),
        ))
    }

    async fn list_pull_requests(
        &self,
        _owner: &str,
        _repo: &str,
        _state: &str,
    ) -> Result<Vec<PullRequest>> {
        Err(DevForgeError::Message(
            "GitHub non configuré — connecte un token dans Settings".into(),
        ))
    }

    async fn list_workflow_runs(
        &self,
        _owner: &str,
        _repo: &str,
        _branch: Option<&str>,
    ) -> Result<Vec<WorkflowRun>> {
        Err(DevForgeError::Message(
            "GitHub non configuré — connecte un token dans Settings".into(),
        ))
    }

    async fn list_tags(&self, _owner: &str, _repo: &str) -> Result<Vec<GitTag>> {
        Err(DevForgeError::Message(
            "GitHub non configuré — connecte un token dans Settings".into(),
        ))
    }

    async fn list_commits(
        &self,
        _owner: &str,
        _repo: &str,
        _branch: Option<&str>,
    ) -> Result<Vec<GitCommit>> {
        Err(DevForgeError::Message(
            "GitHub non configuré — connecte un token dans Settings".into(),
        ))
    }

    async fn list_releases(&self, _owner: &str, _repo: &str) -> Result<Vec<GitRelease>> {
        Err(DevForgeError::Message(
            "GitHub non configuré — connecte un token dans Settings".into(),
        ))
    }

    async fn compare(
        &self,
        _owner: &str,
        _repo: &str,
        _base: &str,
        _head: &str,
    ) -> Result<GitCompare> {
        Err(DevForgeError::Message(
            "GitHub non configuré — connecte un token dans Settings".into(),
        ))
    }

    async fn list_dir(
        &self,
        _owner: &str,
        _repo: &str,
        _path: &str,
        _ref: Option<&str>,
    ) -> Result<Vec<(String, bool)>> {
        Err(DevForgeError::Message(
            "GitHub non configuré — connecte un token dans Settings".into(),
        ))
    }

    async fn read_file(
        &self,
        _owner: &str,
        _repo: &str,
        _path: &str,
        _ref: Option<&str>,
    ) -> Result<Option<String>> {
        Err(DevForgeError::Message(
            "GitHub non configuré — connecte un token dans Settings".into(),
        ))
    }
}

pub fn client_from_env() -> (Arc<dyn GitHubClient>, &'static str) {
    match HttpGitHubClient::from_env() {
        Some(c) => (Arc::new(c), "http"),
        None => (Arc::new(StubGitHubClient), "off"),
    }
}

pub fn client_from_token(token: &str) -> (Arc<dyn GitHubClient>, &'static str) {
    let t = token.trim();
    if t.is_empty() {
        return (Arc::new(StubGitHubClient), "off");
    }
    (Arc::new(HttpGitHubClient::new(t)), "http")
}

/// Hot-swappable facade — token sauvé en DB peut recharger le client sans restart.
pub struct GitHubFacade {
    client: RwLock<Arc<dyn GitHubClient>>,
    mode: RwLock<String>,
}

impl GitHubFacade {
    pub fn new(client: Arc<dyn GitHubClient>, mode: impl Into<String>) -> Self {
        Self {
            client: RwLock::new(client),
            mode: RwLock::new(mode.into()),
        }
    }

    pub fn mode(&self) -> String {
        self.mode.read().map(|m| m.clone()).unwrap_or_else(|_| "off".into())
    }

    pub fn set_client(&self, client: Arc<dyn GitHubClient>, mode: impl Into<String>) {
        if let Ok(mut c) = self.client.write() {
            *c = client;
        }
        if let Ok(mut m) = self.mode.write() {
            *m = mode.into();
        }
    }

    fn client(&self) -> Arc<dyn GitHubClient> {
        self.client
            .read()
            .map(|c| c.clone())
            .unwrap_or_else(|_| Arc::new(StubGitHubClient) as Arc<dyn GitHubClient>)
    }

    pub async fn current_user(&self) -> Result<GitUser> {
        self.client().current_user().await
    }

    pub async fn list_repos(&self) -> Result<Vec<GitRepo>> {
        self.client().list_repos().await
    }

    pub async fn list_branches(&self, owner: &str, repo: &str) -> Result<Vec<GitBranch>> {
        self.client().list_branches(owner, repo).await
    }

    pub async fn list_pull_requests(
        &self,
        owner: &str,
        repo: &str,
        state: &str,
    ) -> Result<Vec<PullRequest>> {
        self.client().list_pull_requests(owner, repo, state).await
    }

    pub async fn list_workflow_runs(
        &self,
        owner: &str,
        repo: &str,
        branch: Option<&str>,
    ) -> Result<Vec<WorkflowRun>> {
        self.client().list_workflow_runs(owner, repo, branch).await
    }

    pub async fn list_tags(&self, owner: &str, repo: &str) -> Result<Vec<GitTag>> {
        self.client().list_tags(owner, repo).await
    }

    pub async fn list_commits(
        &self,
        owner: &str,
        repo: &str,
        branch: Option<&str>,
    ) -> Result<Vec<GitCommit>> {
        self.client().list_commits(owner, repo, branch).await
    }

    pub async fn list_releases(&self, owner: &str, repo: &str) -> Result<Vec<GitRelease>> {
        self.client().list_releases(owner, repo).await
    }

    pub async fn compare(
        &self,
        owner: &str,
        repo: &str,
        base: &str,
        head: &str,
    ) -> Result<GitCompare> {
        self.client().compare(owner, repo, base, head).await
    }

    pub async fn list_dir(
        &self,
        owner: &str,
        repo: &str,
        path: &str,
        r#ref: Option<&str>,
    ) -> Result<Vec<(String, bool)>> {
        self.client().list_dir(owner, repo, path, r#ref).await
    }

    pub async fn read_file(
        &self,
        owner: &str,
        repo: &str,
        path: &str,
        r#ref: Option<&str>,
    ) -> Result<Option<String>> {
        self.client().read_file(owner, repo, path, r#ref).await
    }
}

/// Shared helper for HTTP error mapping (used by http module).
pub(crate) fn map_http_err(e: reqwest::Error) -> DevForgeError {
    DevForgeError::Message(format!("GitHub HTTP: {e}"))
}

pub(crate) fn require_ok(status: reqwest::StatusCode, body: &str) -> Result<()> {
    if status.is_success() {
        Ok(())
    } else {
        Err(DevForgeError::Message(format!(
            "GitHub API {}: {}",
            status.as_u16(),
            body.chars().take(400).collect::<String>()
        )))
    }
}

pub(crate) fn parse_json_array(body: &str) -> Result<Value> {
    serde_json::from_str(body).map_err(|e| DevForgeError::Message(format!("JSON GitHub: {e}")))
}
