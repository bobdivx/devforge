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
    GetDeploymentLogsTool, GetProjectTool, GitHubListPrsTool, GitHubWorkflowRunsTool, HttpSmokeTool,
    ListEnvVarsTool, ListProjectsTool, McpCallTool, McpListRemoteToolsTool, McpListServersTool,
    RunApplicationTestsTool, UpsertEnvVarTool,
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
}

pub fn build_core_registry(
    deploy: Arc<DeployFacade>,
    github: Arc<GitHubFacade>,
    store: Arc<dyn ProjectStore>,
    mcp: Arc<McpFacade>,
    env: Arc<EnvFacade>,
) -> ToolRegistry {
    let mut registry = ToolRegistry::new();
    registry.register(Arc::new(ListProjectsTool {
        store: store.clone(),
    }));
    registry.register(Arc::new(GetProjectTool {
        store: store.clone(),
    }));
    registry.register(Arc::new(RunApplicationTestsTool {
        deploy,
        store: store.clone(),
    }));
    registry.register(Arc::new(GetDeploymentLogsTool {
        store: store.clone(),
    }));
    registry.register(Arc::new(GitHubListPrsTool {
        github: github.clone(),
    }));
    registry.register(Arc::new(GitHubWorkflowRunsTool { github }));
    registry.register(Arc::new(HttpSmokeTool));
    registry.register(Arc::new(McpListServersTool { mcp: mcp.clone() }));
    registry.register(Arc::new(McpListRemoteToolsTool { mcp: mcp.clone() }));
    registry.register(Arc::new(McpCallTool { mcp }));
    registry.register(Arc::new(ListEnvVarsTool { env: env.clone() }));
    registry.register(Arc::new(UpsertEnvVarTool { env }));
    registry
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallRecord {
    pub name: String,
    pub arguments: Value,
    pub result: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentReply {
    pub reply: String,
    pub tool_calls: Vec<ToolCallRecord>,
    #[serde(default)]
    pub provider: String,
}

#[derive(Debug, Clone, Default)]
pub struct AgentChatContext {
    pub project_uuid: Option<String>,
    pub agent_uuid: Option<String>,
    pub agent_role: Option<String>,
    pub agent_name: Option<String>,
    /// Snapshot texte du projet (nom, git, status, derniers deploys).
    pub project_brief: Option<String>,
    pub git_owner: Option<String>,
    pub git_repo: Option<String>,
    pub git_branch: Option<String>,
    /// Prior user/assistant turns (not including the new user message).
    pub history: Vec<(String, String)>,
}

pub struct AgentRunner {
    registry: Arc<ToolRegistry>,
    llm: tokio::sync::RwLock<(Arc<dyn LlmProvider>, String)>,
    max_rounds: usize,
}

impl AgentRunner {
    pub fn new(registry: Arc<ToolRegistry>) -> Self {
        let (llm, mode) = provider_from_env();
        Self {
            registry,
            llm: tokio::sync::RwLock::new((llm, mode.to_string())),
            max_rounds: 6,
        }
    }

    pub fn with_llm(registry: Arc<ToolRegistry>, llm: Arc<dyn LlmProvider>, mode: impl Into<String>) -> Self {
        Self {
            registry,
            llm: tokio::sync::RwLock::new((llm, mode.into())),
            max_rounds: 6,
        }
    }

    pub fn stub(registry: Arc<ToolRegistry>) -> Self {
        Self::with_llm(registry, Arc::new(StubLlmProvider), "stub")
    }

    pub async fn set_llm(&self, llm: Arc<dyn LlmProvider>, mode: impl Into<String>) {
        let mut g = self.llm.write().await;
        *g = (llm, mode.into());
    }

    pub async fn provider_mode(&self) -> String {
        self.llm.read().await.1.clone()
    }

    pub async fn handle(
        &self,
        message: &str,
        force_tool: Option<&str>,
        force_args: Option<Value>,
    ) -> Result<AgentReply> {
        self.handle_with_context(message, force_tool, force_args, AgentChatContext::default())
            .await
    }

    pub async fn handle_with_context(
        &self,
        message: &str,
        force_tool: Option<&str>,
        force_args: Option<Value>,
        ctx: AgentChatContext,
    ) -> Result<AgentReply> {
        let provider = self.provider_mode().await;
        if let Some(tool) = force_tool.filter(|t| !t.is_empty()) {
            let mut args = force_args.unwrap_or_else(|| json!({}));
            inject_tool_defaults(&mut args, &ctx);
            let result = self.registry.execute(tool, args.clone()).await?;
            return Ok(AgentReply {
                reply: summarize(tool, &result),
                tool_calls: vec![ToolCallRecord {
                    name: tool.to_string(),
                    arguments: args,
                    result,
                }],
                provider,
            });
        }

        self.run_loop(message, ctx).await
    }

    async fn run_loop(&self, message: &str, ctx: AgentChatContext) -> Result<AgentReply> {
        let mut messages = vec![ChatMessage::system(system_prompt(&ctx))];
        if let Some(brief) = &ctx.project_brief {
            messages.push(ChatMessage::system(brief.clone()));
        } else if let Some(uuid) = &ctx.project_uuid {
            messages.push(ChatMessage::system(format!(
                "Contexte projet courant : project_uuid={uuid}. Prefère cet uuid pour les tools."
            )));
        }
        for (role, content) in &ctx.history {
            match role.as_str() {
                "assistant" => messages.push(ChatMessage::assistant(content.clone())),
                _ => messages.push(ChatMessage::user(content.clone())),
            }
        }
        messages.push(ChatMessage::user(message));

        let tools = self.registry.definitions();
        let mut records = Vec::new();
        let (llm, provider) = {
            let g = self.llm.read().await;
            (g.0.clone(), g.1.clone())
        };

        for _round in 0..self.max_rounds {
            let turn: AssistantTurn = llm
                .chat(ChatRequest {
                    messages: messages.clone(),
                    tools: tools.clone(),
                    temperature: 0.2,
                })
                .await?;

            if turn.tool_calls.is_empty() {
                let reply = if turn.content.trim().is_empty() {
                    "Terminé.".into()
                } else {
                    turn.content
                };
                return Ok(AgentReply {
                    reply,
                    tool_calls: records,
                    provider,
                });
            }

            messages.push(ChatMessage::assistant_tools(
                turn.content.clone(),
                turn.tool_calls.clone(),
            ));

            for call in turn.tool_calls {
                let mut args = call.arguments.clone();
                inject_tool_defaults(&mut args, &ctx);
                let result = match self.registry.execute(&call.name, args.clone()).await {
                    Ok(v) => v,
                    Err(e) => json!({ "ok": false, "error": e.to_string() }),
                };
                records.push(ToolCallRecord {
                    name: call.name.clone(),
                    arguments: args,
                    result: result.clone(),
                });
                let content = serde_json::to_string(&result).unwrap_or_else(|_| "{}".into());
                messages.push(ChatMessage::tool_result(&call.id, &call.name, content));
            }
        }

        Ok(AgentReply {
            reply: "Limite de tours agent atteinte — voici les tool calls effectués.".into(),
            tool_calls: records,
            provider,
        })
    }
}

fn inject_tool_defaults(args: &mut Value, ctx: &AgentChatContext) {
    let Some(obj) = args.as_object_mut() else {
        return;
    };
    if let Some(uuid) = &ctx.project_uuid {
        let empty = obj
            .get("project_uuid")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .is_empty();
        if !obj.contains_key("project_uuid") || empty {
            obj.insert("project_uuid".into(), json!(uuid));
        }
    }
    if let Some(owner) = &ctx.git_owner {
        let empty = obj
            .get("owner")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .is_empty();
        if !obj.contains_key("owner") || empty {
            obj.insert("owner".into(), json!(owner));
        }
    }
    if let Some(repo) = &ctx.git_repo {
        let empty = obj
            .get("repo")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .is_empty();
        if !obj.contains_key("repo") || empty {
            obj.insert("repo".into(), json!(repo));
        }
    }
    if let Some(branch) = &ctx.git_branch {
        let empty = obj
            .get("branch")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .is_empty();
        if !obj.contains_key("branch") || empty {
            obj.insert("branch".into(), json!(branch));
        }
    }
}

fn system_prompt(ctx: &AgentChatContext) -> String {
    let role = ctx.agent_role.as_deref().unwrap_or("ops");
    let name = ctx.agent_name.as_deref().unwrap_or("Agent");
    let focus = match role {
        "deploy" => {
            "Tu es l'agent Deploy : déploiements, logs, smoke HTTP. \
             Utilise get_project / get_deployment_logs avant de conclure."
        }
        "reviewer" => {
            "Tu es l'agent Reviewer : risques, qualité, PRs, CI. \
             Utilise get_project, github_list_prs, github_workflow_runs si utile. \
             Analyse les risques techniques/sécurité/ops du projet courant sans redemander quel projet."
        }
        "ops" => {
            "Tu es l'agent Ops : santé projet, env, MCP, tests. \
             Utilise get_project / list_env_vars / run_application_tests si besoin."
        }
        _ => "Tu es un agent DevForge : utilise les tools pour agir, sois concis.",
    };
    let scoped = if ctx.project_brief.is_some() || ctx.project_uuid.is_some() {
        "\nLe projet courant est déjà fourni dans le contexte système — \
         ne demande PAS de préciser le projet, un UUID, ou « de quoi tu parles ». \
         Réponds directement sur ce projet ; appelle des tools pour approfondir."
    } else {
        ""
    };
    format!(
        "Tu es {name} ({role}) sur DevForge. {focus}{scoped}\n\
         Réponds en français, de façon concrète. Quand un tool est utile, appelle-le. \
         N'invente pas de résultats."
    )
}

/// Parse `owner` / `repo` depuis une URL GitHub (https ou ssh).
pub fn parse_github_repo(git_url: &str) -> Option<(String, String)> {
    let s = git_url.trim().trim_end_matches('/').trim_end_matches(".git");
    if let Some(rest) = s.strip_prefix("git@github.com:") {
        let mut parts = rest.splitn(2, '/');
        let owner = parts.next()?.trim();
        let repo = parts.next()?.trim();
        if !owner.is_empty() && !repo.is_empty() {
            return Some((owner.into(), repo.into()));
        }
    }
    for prefix in [
        "https://github.com/",
        "http://github.com/",
        "https://www.github.com/",
    ] {
        if let Some(rest) = s.strip_prefix(prefix) {
            let mut parts = rest.splitn(2, '/');
            let owner = parts.next()?.trim();
            let repo = parts.next()?.trim().split('/').next().unwrap_or("").trim();
            if !owner.is_empty() && !repo.is_empty() {
                return Some((owner.into(), repo.into()));
            }
        }
    }
    None
}

fn summarize(tool: &str, result: &Value) -> String {
    let pretty = serde_json::to_string_pretty(result).unwrap_or_else(|_| "{}".into());
    if result.get("ok").and_then(|v| v.as_bool()) == Some(true) {
        format!("✓ {tool} OK.\n{pretty}")
    } else {
        let err = result
            .get("error")
            .or_else(|| result.get("reason"))
            .and_then(|v| v.as_str())
            .unwrap_or("échec");
        format!("✗ {tool} : {err}\n{pretty}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use devforge_deploy::{DeployFacade, StubRemoteExecutor};
    use devforge_env::{EnvFacade, MemoryEnvStore};
    use devforge_github::{GitHubFacade, StubGitHubClient};
    use devforge_mcp::McpFacade;

    struct MemStore;

    #[async_trait]
    impl ProjectStore for MemStore {
        async fn list_projects(&self) -> Result<Vec<Value>> {
            Ok(vec![json!({"uuid":"uji97r70f1jaq9m7l9btm61d","name":"Demo","status":"ready"})])
        }
        async fn get_project(&self, uuid: &str) -> Result<Option<Value>> {
            if uuid == "uji97r70f1jaq9m7l9btm61d" {
                Ok(Some(json!({
                    "uuid": uuid,
                    "name": "Demo",
                    "status": "ready",
                    "recent_deployments": []
                })))
            } else {
                Ok(None)
            }
        }
        async fn resolve_project(&self, uuid: &str) -> Result<Option<ProjectTestContext>> {
            if uuid == "uji97r70f1jaq9m7l9btm61d" {
                Ok(Some(ProjectTestContext {
                    project_uuid: uuid.into(),
                    server_id: "server-demo-1".into(),
                    workdir: "/data/devforge/applications/uji97r70f1jaq9m7l9btm61d".into(),
                    test_command: "./vendor/bin/pest --compact".into(),
                    timeout: None,
                }))
            } else {
                Ok(None)
            }
        }
        async fn deployment_logs(&self, _uuid: &str) -> Result<Value> {
            Ok(json!({"ok": true, "logs": "ok"}))
        }
    }

    #[tokio::test]
    async fn stub_tests_message_runs_tool() {
        let deploy = Arc::new(DeployFacade::new(Arc::new(StubRemoteExecutor::new())));
        let github = Arc::new(GitHubFacade::new(Arc::new(StubGitHubClient), "off"));
        let mcp = Arc::new(McpFacade::stub());
        let env = Arc::new(EnvFacade::new(Arc::new(MemoryEnvStore::new())));
        let registry = Arc::new(build_core_registry(
            deploy,
            github,
            Arc::new(MemStore),
            mcp,
            env,
        ));
        let runner = AgentRunner::stub(registry);
        let reply = runner
            .handle("tests uji97r70f1jaq9m7l9btm61d", None, None)
            .await
            .unwrap();
        assert_eq!(reply.tool_calls.len(), 1);
        assert_eq!(reply.tool_calls[0].name, "run_application_tests");
        assert_eq!(reply.tool_calls[0].result["ok"], true);
        assert_eq!(reply.provider, "stub");
    }
}
