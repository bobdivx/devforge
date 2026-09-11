use crate::{
    map_http_err, parse_json_array, require_ok, GitBranch, GitCommit, GitHubClient, GitRelease,
    GitRepo, GitTag, GitUser, PullRequest, RegistrationToken, RepoRunner, WorkflowJob, WorkflowRun,
};
use async_trait::async_trait;
use devforge_shared::Result;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, USER_AGENT};

/// Authenticated GitHub REST client (`DEVFORGE_GITHUB_TOKEN` or `GITHUB_TOKEN`).
pub struct HttpGitHubClient {
    http: reqwest::Client,
    base: String,
}

impl HttpGitHubClient {
    pub fn from_env() -> Option<Self> {
        let token = std::env::var("DEVFORGE_GITHUB_TOKEN")
            .or_else(|_| std::env::var("GITHUB_TOKEN"))
            .ok()?;
        if token.trim().is_empty() {
            return None;
        }
        Some(Self::new(token))
    }

    pub fn new(token: impl Into<String>) -> Self {
        let token = token.into().trim().to_string();
        let mut headers = HeaderMap::new();
        headers.insert(USER_AGENT, HeaderValue::from_static("devforge-server/2"));
        if let Ok(auth) = HeaderValue::from_str(&format!("Bearer {token}")) {
            headers.insert(AUTHORIZATION, auth);
        }
        headers.insert(
            "Accept",
            HeaderValue::from_static("application/vnd.github+json"),
        );
        headers.insert(
            "X-GitHub-Api-Version",
            HeaderValue::from_static("2022-11-28"),
        );
        let http = reqwest::Client::builder()
            .default_headers(headers)
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self {
            http,
            base: "https://api.github.com".into(),
        }
    }

    async fn get(&self, path: &str) -> Result<serde_json::Value> {
        let url = format!("{}{path}", self.base);
        let res = self.http.get(&url).send().await.map_err(map_http_err)?;
        let status = res.status();
        let body = res.text().await.map_err(map_http_err)?;
        require_ok(status, &body)?;
        parse_json_array(&body)
    }

    async fn post_empty(&self, path: &str) -> Result<serde_json::Value> {
        let url = format!("{}{path}", self.base);
        let res = self
            .http
            .post(&url)
            .header("Content-Length", "0")
            .send()
            .await
            .map_err(map_http_err)?;
        let status = res.status();
        let body = res.text().await.map_err(map_http_err)?;
        require_ok(status, &body)?;
        parse_json_array(&body)
    }
}

#[async_trait]
impl GitHubClient for HttpGitHubClient {
    async fn current_user(&self) -> Result<GitUser> {
        let data = self.get("/user").await?;
        Ok(GitUser {
            login: data
                .get("login")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            name: data
                .get("name")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            html_url: data
                .get("html_url")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            avatar_url: data
                .get("avatar_url")
                .and_then(|v| v.as_str())
                .map(str::to_string),
        })
    }

    async fn list_repos(&self) -> Result<Vec<GitRepo>> {
        let mut out = Vec::new();
        let mut page = 1u32;
        loop {
            let data = self
                .get(&format!(
                    "/user/repos?per_page=100&page={page}&sort=updated&affiliation=owner,collaborator,organization_member"
                ))
                .await?;
            let arr = data.as_array().cloned().unwrap_or_default();
            if arr.is_empty() {
                break;
            }
            for r in arr {
                let owner = r
                    .get("owner")
                    .and_then(|o| o.get("login"))
                    .and_then(|l| l.as_str())
                    .unwrap_or("")
                    .to_string();
                let name = r
                    .get("name")
                    .and_then(|n| n.as_str())
                    .unwrap_or("")
                    .to_string();
                let full_name = r
                    .get("full_name")
                    .and_then(|n| n.as_str())
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("{owner}/{name}"));
                out.push(GitRepo {
                    full_name,
                    name,
                    owner,
                    private: r.get("private").and_then(|p| p.as_bool()).unwrap_or(false),
                    default_branch: r
                        .get("default_branch")
                        .and_then(|b| b.as_str())
                        .unwrap_or("main")
                        .to_string(),
                    html_url: r
                        .get("html_url")
                        .and_then(|u| u.as_str())
                        .unwrap_or("")
                        .to_string(),
                    description: r
                        .get("description")
                        .and_then(|d| d.as_str())
                        .map(str::to_string),
                });
            }
            if out.len() >= 300 || page >= 3 {
                break;
            }
            page += 1;
        }
        Ok(out)
    }

    async fn list_branches(&self, owner: &str, repo: &str) -> Result<Vec<GitBranch>> {
        let data = self
            .get(&format!("/repos/{owner}/{repo}/branches?per_page=100"))
            .await?;
        let arr = data.as_array().cloned().unwrap_or_default();
        Ok(arr
            .into_iter()
            .filter_map(|b| {
                Some(GitBranch {
                    name: b.get("name")?.as_str()?.to_string(),
                    protected: b.get("protected").and_then(|p| p.as_bool()).unwrap_or(false),
                    commit_sha: b
                        .get("commit")?
                        .get("sha")?
                        .as_str()?
                        .chars()
                        .take(12)
                        .collect(),
                })
            })
            .collect())
    }

    async fn list_pull_requests(
        &self,
        owner: &str,
        repo: &str,
        state: &str,
    ) -> Result<Vec<PullRequest>> {
        let data = self
            .get(&format!(
                "/repos/{owner}/{repo}/pulls?state={state}&per_page=30"
            ))
            .await?;
        let arr = data.as_array().cloned().unwrap_or_default();
        Ok(arr
            .into_iter()
            .filter_map(|p| {
                Some(PullRequest {
                    number: p.get("number")?.as_u64()?,
                    title: p.get("title")?.as_str()?.to_string(),
                    state: p.get("state")?.as_str()?.to_string(),
                    url: p
                        .get("html_url")
                        .and_then(|u| u.as_str())
                        .unwrap_or("")
                        .to_string(),
                })
            })
            .collect())
    }

    async fn list_workflow_runs(
        &self,
        owner: &str,
        repo: &str,
        branch: Option<&str>,
    ) -> Result<Vec<WorkflowRun>> {
        let mut path = format!("/repos/{owner}/{repo}/actions/runs?per_page=20");
        if let Some(b) = branch {
            path.push_str(&format!("&branch={b}"));
        }
        let data = self.get(&path).await?;
        let arr = data
            .get("workflow_runs")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        Ok(arr
            .into_iter()
            .filter_map(|r| {
                Some(WorkflowRun {
                    id: r.get("id")?.as_u64()?,
                    name: r
                        .get("name")
                        .and_then(|n| n.as_str())
                        .unwrap_or("workflow")
                        .to_string(),
                    status: r.get("status")?.as_str()?.to_string(),
                    conclusion: r
                        .get("conclusion")
                        .and_then(|c| c.as_str())
                        .map(str::to_string),
                    html_url: r
                        .get("html_url")
                        .and_then(|u| u.as_str())
                        .unwrap_or("")
                        .to_string(),
                    branch: r
                        .get("head_branch")
                        .and_then(|b| b.as_str())
                        .map(str::to_string),
                })
            })
            .collect())
    }

    async fn list_tags(&self, owner: &str, repo: &str) -> Result<Vec<GitTag>> {
        let data = self
            .get(&format!("/repos/{owner}/{repo}/tags?per_page=30"))
            .await?;
        let arr = data.as_array().cloned().unwrap_or_default();
        Ok(arr
            .into_iter()
            .filter_map(|t| {
                Some(GitTag {
                    name: t.get("name")?.as_str()?.to_string(),
                    commit_sha: t
                        .get("commit")?
                        .get("sha")?
                        .as_str()?
                        .chars()
                        .take(12)
                        .collect(),
                    zipball_url: t
                        .get("zipball_url")
                        .and_then(|u| u.as_str())
                        .unwrap_or("")
                        .to_string(),
                })
            })
            .collect())
    }

    async fn list_commits(
        &self,
        owner: &str,
        repo: &str,
        branch: Option<&str>,
    ) -> Result<Vec<GitCommit>> {
        let mut path = format!("/repos/{owner}/{repo}/commits?per_page=30");
        if let Some(b) = branch {
            path.push_str(&format!("&sha={b}"));
        }
        let data = self.get(&path).await?;
        let arr = data.as_array().cloned().unwrap_or_default();
        Ok(arr
            .into_iter()
            .filter_map(|c| {
                let sha = c.get("sha")?.as_str()?;
                let commit = c.get("commit")?;
                Some(GitCommit {
                    sha: sha.chars().take(12).collect(),
                    message: commit
                        .get("message")
                        .and_then(|m| m.as_str())
                        .unwrap_or("")
                        .lines()
                        .next()
                        .unwrap_or("")
                        .to_string(),
                    author: commit
                        .get("author")
                        .and_then(|a| a.get("name"))
                        .and_then(|n| n.as_str())
                        .unwrap_or("unknown")
                        .to_string(),
                    html_url: c
                        .get("html_url")
                        .and_then(|u| u.as_str())
                        .unwrap_or("")
                        .to_string(),
                })
            })
            .collect())
    }

    async fn compare(
        &self,
        owner: &str,
        repo: &str,
        base: &str,
        head: &str,
    ) -> Result<crate::GitCompare> {
        let data = self
            .get(&format!(
                "/repos/{owner}/{repo}/compare/{base}...{head}"
            ))
            .await?;
        let commits = data.get("commits").and_then(|c| c.as_array());
        let tip = commits
            .and_then(|a| a.last())
            .and_then(|c| c.get("sha"))
            .and_then(|s| s.as_str())
            .unwrap_or(head);
        Ok(crate::GitCompare {
            status: data
                .get("status")
                .and_then(|s| s.as_str())
                .unwrap_or("unknown")
                .to_string(),
            ahead_by: data.get("ahead_by").and_then(|v| v.as_u64()).unwrap_or(0),
            behind_by: data.get("behind_by").and_then(|v| v.as_u64()).unwrap_or(0),
            base_sha: data
                .pointer("/base_commit/sha")
                .and_then(|s| s.as_str())
                .unwrap_or(base)
                .chars()
                .take(12)
                .collect(),
            head_sha: tip.chars().take(12).collect(),
        })
    }

    async fn list_releases(&self, owner: &str, repo: &str) -> Result<Vec<GitRelease>> {
        let data = self
            .get(&format!("/repos/{owner}/{repo}/releases?per_page=20"))
            .await?;
        let arr = data.as_array().cloned().unwrap_or_default();
        Ok(arr
            .into_iter()
            .filter_map(|r| {
                Some(GitRelease {
                    tag: r.get("tag_name")?.as_str()?.to_string(),
                    name: r
                        .get("name")
                        .and_then(|n| n.as_str())
                        .unwrap_or("")
                        .to_string(),
                    draft: r.get("draft").and_then(|d| d.as_bool()).unwrap_or(false),
                    prerelease: r
                        .get("prerelease")
                        .and_then(|d| d.as_bool())
                        .unwrap_or(false),
                    html_url: r
                        .get("html_url")
                        .and_then(|u| u.as_str())
                        .unwrap_or("")
                        .to_string(),
                })
            })
            .collect())
    }

    async fn list_dir(
        &self,
        owner: &str,
        repo: &str,
        path: &str,
        r#ref: Option<&str>,
    ) -> Result<Vec<(String, bool)>> {
        let path = path.trim().trim_start_matches('/');
        let mut url = if path.is_empty() {
            format!("/repos/{owner}/{repo}/contents")
        } else {
            format!("/repos/{owner}/{repo}/contents/{path}")
        };
        if let Some(r) = r#ref {
            url.push_str(&format!("?ref={r}"));
        }
        let data = self.get(&url).await?;
        let arr = data.as_array().cloned().unwrap_or_default();
        Ok(arr
            .into_iter()
            .filter_map(|e| {
                let name = e.get("name")?.as_str()?.to_string();
                let ty = e.get("type")?.as_str()?;
                Some((name, ty == "file"))
            })
            .collect())
    }

    async fn read_file(
        &self,
        owner: &str,
        repo: &str,
        path: &str,
        r#ref: Option<&str>,
    ) -> Result<Option<String>> {
        let path = path.trim().trim_start_matches('/');
        let mut url = format!("/repos/{owner}/{repo}/contents/{path}");
        if let Some(r) = r#ref {
            url.push_str(&format!("?ref={r}"));
        }
        let data = self.get(&url).await?;
        if data.get("type").and_then(|t| t.as_str()) != Some("file") {
            return Ok(None);
        }
        let encoding = data.get("encoding").and_then(|e| e.as_str()).unwrap_or("");
        let content = data.get("content").and_then(|c| c.as_str()).unwrap_or("");
        if encoding == "base64" {
            let cleaned: String = content.chars().filter(|c| !c.is_whitespace()).collect();
            Ok(String::from_utf8(decode_base64_simple(&cleaned)).ok())
        } else if content.is_empty() {
            Ok(None)
        } else {
            Ok(Some(content.to_string()))
        }
    }

    async fn create_registration_token(
        &self,
        owner: &str,
        repo: &str,
    ) -> Result<RegistrationToken> {
        let data = self
            .post_empty(&format!(
                "/repos/{owner}/{repo}/actions/runners/registration-token"
            ))
            .await?;
        let token = data
            .get("token")
            .and_then(|t| t.as_str())
            .ok_or_else(|| {
                devforge_shared::DevForgeError::Message(
                    "registration-token: champ token manquant".into(),
                )
            })?
            .to_string();
        Ok(RegistrationToken {
            token,
            expires_at: data
                .get("expires_at")
                .and_then(|e| e.as_str())
                .map(str::to_string),
        })
    }

    async fn list_repo_runners(&self, owner: &str, repo: &str) -> Result<Vec<RepoRunner>> {
        let data = self
            .get(&format!("/repos/{owner}/{repo}/actions/runners?per_page=100"))
            .await?;
        let arr = data
            .get("runners")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        Ok(arr
            .into_iter()
            .filter_map(|r| {
                let labels = r
                    .get("labels")
                    .and_then(|l| l.as_array())
                    .map(|a| {
                        a.iter()
                            .filter_map(|x| x.get("name")?.as_str().map(str::to_string))
                            .collect()
                    })
                    .unwrap_or_default();
                Some(RepoRunner {
                    id: r.get("id")?.as_u64()?,
                    name: r.get("name")?.as_str()?.to_string(),
                    status: r
                        .get("status")
                        .and_then(|s| s.as_str())
                        .unwrap_or("offline")
                        .to_string(),
                    busy: r.get("busy").and_then(|b| b.as_bool()).unwrap_or(false),
                    labels,
                })
            })
            .collect())
    }

    async fn list_workflow_jobs(
        &self,
        owner: &str,
        repo: &str,
        run_id: u64,
    ) -> Result<Vec<WorkflowJob>> {
        let data = self
            .get(&format!(
                "/repos/{owner}/{repo}/actions/runs/{run_id}/jobs?per_page=100"
            ))
            .await?;
        let arr = data
            .get("jobs")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        Ok(arr
            .into_iter()
            .filter_map(|j| {
                Some(WorkflowJob {
                    id: j.get("id")?.as_u64()?,
                    name: j
                        .get("name")
                        .and_then(|n| n.as_str())
                        .unwrap_or("job")
                        .to_string(),
                    status: j.get("status")?.as_str()?.to_string(),
                    conclusion: j
                        .get("conclusion")
                        .and_then(|c| c.as_str())
                        .map(str::to_string),
                    runner_name: j
                        .get("runner_name")
                        .and_then(|n| n.as_str())
                        .map(str::to_string),
                    html_url: j
                        .get("html_url")
                        .and_then(|u| u.as_str())
                        .map(str::to_string),
                })
            })
            .collect())
    }
}

fn decode_base64_simple(input: &str) -> Vec<u8> {
    fn val(c: u8) -> Option<u8> {
        match c {
            b'A'..=b'Z' => Some(c - b'A'),
            b'a'..=b'z' => Some(c - b'a' + 26),
            b'0'..=b'9' => Some(c - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let chars: Vec<u8> = input.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
    let mut out = Vec::new();
    let mut buf: u32 = 0;
    let mut bits: i32 = 0;
    for c in chars {
        if c == b'=' {
            break;
        }
        let Some(v) = val(c) else { continue };
        buf = (buf << 6) | u32::from(v);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((buf >> bits) & 0xff) as u8);
        }
    }
    out
}
