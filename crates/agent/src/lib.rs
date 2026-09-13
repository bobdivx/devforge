mod tools;

use async_trait::async_trait;
use devforge_deploy::DeployFacade;
use devforge_env::EnvFacade;
use devforge_github::GitHubFacade;
use devforge_llm::{
    provider_from_env, AssistantTurn, ChatMessage, ChatRequest, LlmProvider, StubLlmProvider,
};
use devforge_mcp::McpFacade;
use devforge_shared::{DevForgeError, ProjectTestContext, Result, Tool, ToolDefinition};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use tools::{
    CreateGitHubFixTool, CreateGitHubRepoTool, GetDeploymentLogsTool, GetProjectTool,
    GitHubListPrsTool, GitHubWorkflowRunsTool, HttpSmokeTool, ListEnvVarsTool, ListProjectFilesTool,
    ListProjectsTool, McpCallTool, McpListRemoteToolsTool, McpListServersTool, ProposePlanTool,
    PublishToGitHubTool, ReadGitHubFileTool, ReadProjectFileTool, RunApplicationTestsTool,
    StartLocalPreviewTool, SyncWorkdirToGitHubTool, TriggerDeployTool, UpsertEnvVarsTool,
    WriteProjectFileTool,
};

pub struct ToolRegistry {
    tools: HashMap<String, Arc<dyn Tool>>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self {
            tools: HashMap::new(),
        }
    }

    pub fn register(&mut self, tool: Arc<dyn Tool>) {
        self.tools.insert(tool.name().to_string(), tool);
    }

    pub fn definitions(&self) -> Vec<ToolDefinition> {
        let mut defs: Vec<_> = self.tools.values().map(|t| t.definition()).collect();
        defs.sort_by(|a, b| a.name.cmp(&b.name));
        defs
    }

    pub async fn execute(&self, name: &str, arguments: Value) -> Result<Value> {
        let tool = self
            .tools
            .get(name)
            .ok_or_else(|| DevForgeError::NotFound(format!("Unknown tool: {name}")))?;
        tool.execute(arguments).await
    }

    pub fn has(&self, name: &str) -> bool {
        self.tools.contains_key(name)
    }
}

impl Default for ToolRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
pub trait ProjectStore: Send + Sync {
    async fn list_projects(&self) -> Result<Vec<Value>>;
    async fn get_project(&self, uuid: &str) -> Result<Option<Value>>;
    async fn resolve_project(&self, uuid: &str) -> Result<Option<ProjectTestContext>>;
    async fn deployment_logs(&self, uuid: &str) -> Result<Value>;
    async fn trigger_deploy(
        &self,
        project_uuid: &str,
        git_sha: Option<String>,
        message: &str,
    ) -> Result<Value>;
}

pub fn build_core_registry(
    deploy: Arc<DeployFacade>,
    github: Arc<GitHubFacade>,
    store: Arc<dyn ProjectStore>,
    mcp: Arc<McpFacade>,
    env: Arc<EnvFacade>,
    pool: Arc<sqlx::SqlitePool>,
) -> ToolRegistry {
    let mut registry = ToolRegistry::new();
    registry.register(Arc::new(ListProjectsTool {
        store: store.clone(),
    }));
    registry.register(Arc::new(GetProjectTool {
        store: store.clone(),
    }));
    registry.register(Arc::new(RunApplicationTestsTool {
        deploy: deploy.clone(),
        store: store.clone(),
    }));
    registry.register(Arc::new(GetDeploymentLogsTool {
        store: store.clone(),
    }));
    registry.register(Arc::new(TriggerDeployTool {
        store: store.clone(),
    }));
    registry.register(Arc::new(GitHubListPrsTool {
        github: github.clone(),
    }));
    registry.register(Arc::new(GitHubWorkflowRunsTool {
        github: github.clone(),
    }));
    registry.register(Arc::new(HttpSmokeTool));
    registry.register(Arc::new(McpListServersTool { mcp: mcp.clone() }));
    registry.register(Arc::new(McpListRemoteToolsTool { mcp: mcp.clone() }));
    registry.register(Arc::new(McpCallTool { mcp: mcp.clone() }));
    registry.register(Arc::new(ListEnvVarsTool { env: env.clone() }));
    registry.register(Arc::new(UpsertEnvVarsTool { env }));
    registry.register(Arc::new(CreateGitHubFixTool { mcp: mcp.clone() }));
    registry.register(Arc::new(ReadGitHubFileTool { mcp: mcp.clone() }));
    registry.register(Arc::new(CreateGitHubRepoTool {
        github: github.clone(),
        mcp: mcp.clone(),
        pool: pool.clone(),
    }));
    registry.register(Arc::new(WriteProjectFileTool {
        github: github.clone(),
        mcp,
        pool: pool.clone(),
    }));
    registry.register(Arc::new(ReadProjectFileTool {
        pool: pool.clone(),
    }));
    registry.register(Arc::new(ListProjectFilesTool {
        pool: pool.clone(),
    }));
    registry.register(Arc::new(ProposePlanTool));
    registry.register(Arc::new(SyncWorkdirToGitHubTool {
        github: github.clone(),
        pool: pool.clone(),
    }));
    registry.register(Arc::new(PublishToGitHubTool {
        github: github.clone(),
        deploy,
        pool: pool.clone(),
    }));
    registry.register(Arc::new(StartLocalPreviewTool {
        pool,
    }));
    registry
}
