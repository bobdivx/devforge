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
    // High-level GitHub ops tools
    registry.register(Arc::new(CreateGitHubFixTool { mcp: mcp.clone() }));
    registry.register(Arc::new(ReadGitHubFileTool { mcp: mcp.clone() }));
    // Builder slice 2 tools
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

/// Événements émis pendant un tour d'agent (SSE / UI « en train de réfléchir »).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    Thinking { round: usize, label: String },
    ToolStart { name: String, arguments: Value },
    ToolDone {
        name: String,
        ok: bool,
        arguments: Value,
        result: Value,
    },
    Plan {
        title: String,
        summary: String,
        steps: Vec<String>,
    },
    Reply {
        content: String,
        provider: String,
        tool_calls: Vec<ToolCallRecord>,
    },
    Error { message: String },
}

pub type AgentProgressTx = tokio::sync::mpsc::UnboundedSender<AgentEvent>;

fn emit(progress: &Option<AgentProgressTx>, event: AgentEvent) {
    if let Some(tx) = progress {
        let _ = tx.send(event);
    }
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
            max_rounds: 16,
        }
    }

    pub fn with_llm(registry: Arc<ToolRegistry>, llm: Arc<dyn LlmProvider>, mode: impl Into<String>) -> Self {
        Self {
            registry,
            llm: tokio::sync::RwLock::new((llm, mode.into())),
            max_rounds: 16,
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
        self.handle_with_progress(message, force_tool, force_args, ctx, None)
            .await
    }

    pub async fn handle_with_progress(
        &self,
        message: &str,
        force_tool: Option<&str>,
        force_args: Option<Value>,
        ctx: AgentChatContext,
        progress: Option<AgentProgressTx>,
    ) -> Result<AgentReply> {
        let provider = self.provider_mode().await;
        if let Some(tool) = force_tool.filter(|t| !t.is_empty()) {
            emit(
                &progress,
                AgentEvent::Thinking {
                    round: 0,
                    label: format!("Outil {tool}…"),
                },
            );
            let mut args = force_args.unwrap_or_else(|| json!({}));
            inject_tool_defaults(&mut args, &ctx);
            emit(
                &progress,
                AgentEvent::ToolStart {
                    name: tool.to_string(),
                    arguments: args.clone(),
                },
            );
            let result = self.registry.execute(tool, args.clone()).await?;
            let ok = result.get("ok").and_then(|v| v.as_bool()).unwrap_or(true);
            emit(
                &progress,
                AgentEvent::ToolDone {
                    name: tool.to_string(),
                    ok,
                    arguments: args.clone(),
                    result: result.clone(),
                },
            );
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

        self.run_loop(message, ctx, progress).await
    }

    async fn run_loop(
        &self,
        message: &str,
        ctx: AgentChatContext,
        progress: Option<AgentProgressTx>,
    ) -> Result<AgentReply> {
        let mut messages = vec![ChatMessage::system(system_prompt(&ctx, message))];
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

        for round in 0..self.max_rounds {
            if round >= 2 {
                let loop_nudge = detect_duplicate_calls(&records);
                if let Some(nudge) = loop_nudge {
                    messages.push(ChatMessage::system(nudge));
                }
            }
            
            if round >= 2 {
                if let Some(nudge) = detect_repeated_failures(&records) {
                    return Ok(AgentReply {
                        reply: nudge,
                        tool_calls: records,
                        provider,
                    });
                }
            }
            
            emit(
                &progress,
                AgentEvent::Thinking {
                    round: round + 1,
                    label: if round == 0 {
                        "Analyse de la demande…".into()
                    } else {
                        format!("Réflexion (tour {})…", round + 1)
                    },
                },
            );

            let turn: AssistantTurn = llm
                .chat(ChatRequest {
                    messages: messages.clone(),
                    tools: tools.clone(),
                    temperature: 0.2,
                })
                .await?;

            if !turn.content.trim().is_empty() && !turn.tool_calls.is_empty() {
                let snippet: String = turn.content.chars().take(140).collect();
                emit(
                    &progress,
                    AgentEvent::Thinking {
                        round: round + 1,
                        label: snippet,
                    },
                );
            }

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
                emit(
                    &progress,
                    AgentEvent::ToolStart {
                        name: call.name.clone(),
                        arguments: args.clone(),
                    },
                );
                let result = match self.registry.execute(&call.name, args.clone()).await {
                    Ok(v) => v,
                    Err(e) => {
                        match e {
                            devforge_shared::DevForgeError::NeedsUserAction {
                                kind,
                                message_fr,
                                settings_href,
                                resume_hint,
                            } => {
                                json!({
                                    "ok": false,
                                    "needs_user_action": true,
                                    "kind": kind,
                                    "message_fr": message_fr,
                                    "settings_href": settings_href,
                                    "resume_hint": resume_hint,
                                })
                            }
                            _ => json!({ "ok": false, "error": e.to_string() }),
                        }
                    }
                };
                let ok = result.get("ok").and_then(|v| v.as_bool()).unwrap_or(true);
                emit(
                    &progress,
                    AgentEvent::ToolDone {
                        name: call.name.clone(),
                        ok,
                        arguments: args.clone(),
                        result: result.clone(),
                    },
                );
                if call.name == "propose_plan" {
                    if let Some(plan) = result.get("plan") {
                        emit(
                            &progress,
                            AgentEvent::Plan {
                                title: plan
                                    .get("title")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("Plan")
                                    .to_string(),
                                summary: plan
                                    .get("summary")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string(),
                                steps: plan
                                    .get("steps")
                                    .and_then(|v| v.as_array())
                                    .map(|arr| {
                                        arr.iter()
                                            .filter_map(|s| s.as_str().map(|s| s.to_string()))
                                            .collect()
                                    })
                                    .unwrap_or_default(),
                            },
                        );
                    }
                }
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
