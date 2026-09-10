use async_trait::async_trait;
use devforge_github::GitHubFacade;
use devforge_shared::{Result, Tool};
use serde_json::{json, Value};
use std::sync::Arc;

pub struct GitHubListPrsTool {
    pub github: Arc<GitHubFacade>,
}

#[async_trait]
impl Tool for GitHubListPrsTool {
    fn name(&self) -> &str {
        "github_list_prs"
    }
    fn description(&self) -> &str {
        "Liste les pull requests d’un dépôt GitHub."
    }
    fn parameters(&self) -> Value {
        json!({
            "type":"object",
            "properties":{
                "owner":{"type":"string"},
                "repo":{"type":"string"},
                "state":{"type":"string"}
            },
            "required":["owner","repo"]
        })
    }
    async fn execute(&self, arguments: Value) -> Result<Value> {
        let owner = arguments.get("owner").and_then(|v| v.as_str()).unwrap_or("").trim();
        let repo = arguments.get("repo").and_then(|v| v.as_str()).unwrap_or("").trim();
        let state = arguments.get("state").and_then(|v| v.as_str()).unwrap_or("open");
        if owner.is_empty() || repo.is_empty() {
            return Ok(json!({"ok": false, "error": "owner et repo requis"}));
        }
        let prs = self.github.list_pull_requests(owner, repo, state).await?;
        Ok(json!({"ok": true, "pull_requests": prs}))
    }
}

pub struct GitHubWorkflowRunsTool {
    pub github: Arc<GitHubFacade>,
}

#[async_trait]
impl Tool for GitHubWorkflowRunsTool {
    fn name(&self) -> &str {
        "github_workflow_runs"
    }
    fn description(&self) -> &str {
        "Liste les runs GitHub Actions d’un dépôt."
    }
    fn parameters(&self) -> Value {
        json!({
            "type":"object",
            "properties":{
                "owner":{"type":"string"},
                "repo":{"type":"string"},
                "branch":{"type":"string"}
            },
            "required":["owner","repo"]
        })
    }
    async fn execute(&self, arguments: Value) -> Result<Value> {
        let owner = arguments.get("owner").and_then(|v| v.as_str()).unwrap_or("").trim();
        let repo = arguments.get("repo").and_then(|v| v.as_str()).unwrap_or("").trim();
        let branch = arguments.get("branch").and_then(|v| v.as_str());
        if owner.is_empty() || repo.is_empty() {
            return Ok(json!({"ok": false, "error": "owner et repo requis"}));
        }
        let runs = self.github.list_workflow_runs(owner, repo, branch).await?;
        Ok(json!({"ok": true, "workflow_runs": runs}))
    }
}
