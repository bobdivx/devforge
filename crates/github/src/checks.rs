//! Checks API, commit statuses et Deployments GitHub (P4-01 / P4-03).
//!
//! Toutes les fonctions sont « best effort » : l'appelant journalise l'erreur sans jamais
//! faire échouer un déploiement. Aucun token n'apparaît dans les erreurs.

use serde_json::{json, Value};

pub const CHECK_NAME: &str = "DevForge / deploy";
pub const STATUS_CONTEXT: &str = "devforge/deploy";
/// Limite GitHub pour `output.text` / `output.summary` (65 535 caractères).
pub const OUTPUT_MAX: usize = 60_000;

#[derive(Clone)]
pub struct RepoApi {
    http: reqwest::Client,
    api: String,
    token: crate::app_auth::SecretString,
    pub owner: String,
    pub repo: String,
}

impl std::fmt::Debug for RepoApi {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "RepoApi({}/{}, token: ***)", self.owner, self.repo)
    }
}

/// `owner/repo` depuis une URL ou un nom de dépôt GitHub.
pub fn parse_repo(raw: &str) -> Option<(String, String)> {
    let r = raw.trim().trim_end_matches('/').trim_end_matches(".git");
    let path = if let Some(p) = r.strip_prefix("git@github.com:") {
        p
    } else if let Some(i) = r.find("github.com/") {
        &r[i + "github.com/".len()..]
    } else if r.contains("://") {
        return None;
    } else {
        r
    };
    let mut it = path.split('/');
    let (o, n) = (it.next()?, it.next()?);
    if o.is_empty() || n.is_empty() || it.next().is_some() {
        return None;
    }
    let ok = |s: &str| {
        !s.starts_with('.')
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
    };
    (ok(o) && ok(n)).then(|| (o.to_string(), n.to_string()))
}

fn clip(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &s[..end])
}

impl RepoApi {
    pub fn new(api: impl Into<String>, token: &str, owner: &str, repo: &str) -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(15))
                .build()
                .unwrap_or_default(),
            api: api.into().trim_end_matches('/').to_string(),
            token: crate::app_auth::SecretString::new(token),
            owner: owner.into(),
            repo: repo.into(),
        }
    }

    fn url(&self, tail: &str) -> String {
        format!("{}/repos/{}/{}{tail}", self.api, self.owner, self.repo)
    }

    async fn send(&self, req: reqwest::RequestBuilder) -> Result<Value, String> {
        let res = req
            .bearer_auth(self.token.expose())
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .header("User-Agent", "devforge-server/2")
            .send()
            .await
            .map_err(|e| format!("GitHub injoignable : {}", e.without_url()))?;
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(format!("GitHub a répondu {}", status.as_u16()));
        }
        Ok(serde_json::from_str(&body).unwrap_or(Value::Null))
    }

    /// SHA complet de la tête d'une branche.
    pub async fn branch_head(&self, branch: &str) -> Result<String, String> {
        let v = self
            .send(
                self.http
                    .get(self.url(&format!("/commits/{}", urlencode(branch)))),
            )
            .await?;
        v.get("sha")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| "sha absent".into())
    }

    pub async fn create_check_run(
        &self,
        head_sha: &str,
        details_url: Option<&str>,
        external_id: &str,
    ) -> Result<i64, String> {
        let mut body = json!({
            "name": CHECK_NAME, "head_sha": head_sha, "status": "queued",
            "external_id": external_id,
        });
        if let Some(u) = details_url {
            body["details_url"] = json!(u);
        }
        let v = self
            .send(self.http.post(self.url("/check-runs")).json(&body))
            .await?;
        v.get("id")
            .and_then(Value::as_i64)
            .ok_or_else(|| "id absent".into())
    }

    /// `status` : queued | in_progress | completed ; `conclusion` requis si completed.
    pub async fn update_check_run(
        &self,
        id: i64,
        status: &str,
        conclusion: Option<&str>,
        output: Option<(&str, &str, &str)>,
    ) -> Result<(), String> {
        let mut body = json!({ "status": status });
        if let Some(c) = conclusion {
            body["conclusion"] = json!(c);
        }
        if let Some((title, summary, text)) = output {
            body["output"] = json!({
                "title": clip(title, 200),
                "summary": clip(summary, OUTPUT_MAX),
                "text": clip(text, OUTPUT_MAX),
            });
        }
        self.send(
            self.http
                .patch(self.url(&format!("/check-runs/{id}")))
                .json(&body),
        )
        .await
        .map(|_| ())
    }

    /// Statut de commit (`pending|success|failure|error`), repli pour les projets en PAT.
    pub async fn create_status(
        &self,
        sha: &str,
        state: &str,
        description: &str,
        target_url: Option<&str>,
    ) -> Result<(), String> {
        let mut body = json!({
            "state": state, "context": STATUS_CONTEXT,
            "description": clip(description, 139),
        });
        if let Some(u) = target_url {
            body["target_url"] = json!(u);
        }
        self.send(
            self.http
                .post(self.url(&format!("/statuses/{sha}")))
                .json(&body),
        )
        .await
        .map(|_| ())
    }

    pub async fn create_deployment(&self, sha: &str, environment: &str) -> Result<i64, String> {
        let body = json!({
            "ref": sha, "environment": environment, "auto_merge": false,
            "required_contexts": [], "description": "DevForge",
            "production_environment": environment == "Production",
            "transient_environment": environment != "Production",
        });
        let v = self
            .send(self.http.post(self.url("/deployments")).json(&body))
            .await?;
        v.get("id")
            .and_then(Value::as_i64)
            .ok_or_else(|| "id absent".into())
    }

    /// `state` : in_progress | success | failure | error | inactive.
    pub async fn create_deployment_status(
        &self,
        deployment_id: i64,
        state: &str,
        log_url: Option<&str>,
        environment_url: Option<&str>,
    ) -> Result<(), String> {
        let mut body = json!({ "state": state, "auto_inactive": state == "success" });
        if let Some(u) = log_url {
            body["log_url"] = json!(u);
        }
        if let Some(u) = environment_url {
            body["environment_url"] = json!(u);
        }
        self.send(
            self.http
                .post(self.url(&format!("/deployments/{deployment_id}/statuses")))
                .json(&body),
        )
        .await
        .map(|_| ())
    }

    /// Commentaires d'une issue/PR (une page, `per_page` ≤ 100).
    pub async fn list_issue_comments(&self, number: i64, page: u32) -> Result<Vec<Value>, String> {
        let v = self
            .send(self.http.get(self.url(&format!(
                "/issues/{number}/comments?per_page=100&page={page}"
            ))))
            .await?;
        Ok(v.as_array().cloned().unwrap_or_default())
    }

    pub async fn create_issue_comment(&self, number: i64, body: &str) -> Result<i64, String> {
        let v = self
            .send(
                self.http
                    .post(self.url(&format!("/issues/{number}/comments")))
                    .json(&json!({ "body": clip(body, OUTPUT_MAX) })),
            )
            .await?;
        v.get("id")
            .and_then(Value::as_i64)
            .ok_or_else(|| "id absent".into())
    }

    pub async fn update_issue_comment(&self, comment_id: i64, body: &str) -> Result<(), String> {
        self.send(
            self.http
                .patch(self.url(&format!("/issues/comments/{comment_id}")))
                .json(&json!({ "body": clip(body, OUTPUT_MAX) })),
        )
        .await
        .map(|_| ())
    }

    /// État d'une PR : `open` | `closed`.
    pub async fn pull_state(&self, number: i64) -> Result<String, String> {
        let v = self
            .send(self.http.get(self.url(&format!("/pulls/{number}"))))
            .await?;
        v.get("state")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| "state absent".into())
    }

    /// Check Run terminé directement (ex. `neutral` pour une PR de fork).
    pub async fn completed_check_run(
        &self,
        name: &str,
        head_sha: &str,
        conclusion: &str,
        title: &str,
        summary: &str,
    ) -> Result<i64, String> {
        let body = json!({
            "name": name, "head_sha": head_sha, "status": "completed",
            "conclusion": conclusion,
            "output": { "title": clip(title, 200), "summary": clip(summary, OUTPUT_MAX) },
        });
        let v = self
            .send(self.http.post(self.url("/check-runs")).json(&body))
            .await?;
        v.get("id")
            .and_then(Value::as_i64)
            .ok_or_else(|| "id absent".into())
    }
}

fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_repo_variants() {
        let r = |s| parse_repo(s).map(|(a, b)| format!("{a}/{b}"));
        assert_eq!(
            r("https://github.com/bobdivx/devforge"),
            Some("bobdivx/devforge".into())
        );
        assert_eq!(
            r("https://github.com/bobdivx/devforge.git"),
            Some("bobdivx/devforge".into())
        );
        assert_eq!(
            r("git@github.com:bobdivx/devforge.git"),
            Some("bobdivx/devforge".into())
        );
        assert_eq!(r("bobdivx/devforge"), Some("bobdivx/devforge".into()));
        assert_eq!(r("https://gitlab.com/a/b"), None);
        assert_eq!(r("a/b/c"), None);
        assert_eq!(r("../x"), None);
    }

    #[test]
    fn clip_is_char_safe() {
        assert_eq!(clip("éé", 3), "é…");
        assert_eq!(clip("abc", 5), "abc");
    }
}
