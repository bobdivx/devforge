pub mod claims;
pub mod coerce;
pub mod events;
pub mod guard;
pub mod roles;
pub mod sdd;
pub mod truncate;
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
    CreateGitHubFixTool, CreateGitHubRepoTool, CreateProjectAgentTool, GetDeploymentLogsTool, GetProjectTool,
    GitHubListPrsTool, GitHubWorkflowRunsTool, HttpSmokeTool, ListAgentMessagesTool,
    ListAgentToolFailuresTool, ListEnvVarsTool, ListProjectAgentsTool, ListProjectFilesTool,
    ListProjectsTool, LocalPreviewStatusTool, McpCallTool, McpListRemoteToolsTool,
    McpListServersTool, MemoryForgetTool, MemorySearchTool, MemoryWriteTool, ProposePlanTool, PublishToGitHubTool, ReadGitHubFileTool,
    ReadProjectFileTool, ReviewProjectSecurityTool, RunApplicationTestsTool, RunWorkdirCommandTool,
    SddLoopTool, StartLocalPreviewTool,
    StopLocalPreviewTool, SyncWorkdirToGitHubTool, TriggerDeployTool, ListDeploymentsTool, CancelDeploymentTool, UpsertEnvVarsTool,
    WriteProjectFileTool,
};

pub use tools::{memory_item_json, post_deploy_verdict, set_worker_launcher, smoke_url, DelegateTaskTool, WorkerLauncher, MAX_ACTIVE_WORKERS};
pub use tokio_util::sync::CancellationToken;
pub mod memory_ctx;

pub struct ToolRegistry {
    tools: HashMap<String, Arc<dyn Tool>>,
    /// Accord de publication (P1-01). Absent = toute action distante est refusée.
    gate: Option<Arc<dyn guard::PublishGate>>,
    /// Mémoire durable (P3) : profil injecté + pré-chargement du journal.
    memory: Option<Arc<dyn devforge_memory::MemoryStore>>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self {
            tools: HashMap::new(),
            gate: None,
            memory: None,
        }
    }

    /// Branche la mémoire : outils `memory_*` + injection dans le prompt.
    pub fn set_memory(&mut self, store: Arc<dyn devforge_memory::MemoryStore>) {
        self.register(Arc::new(MemorySearchTool { store: store.clone() }));
        self.register(Arc::new(MemoryWriteTool { store: store.clone() }));
        self.register(Arc::new(MemoryForgetTool { store: store.clone() }));
        self.memory = Some(store);
    }

    pub fn memory(&self) -> Option<Arc<dyn devforge_memory::MemoryStore>> {
        self.memory.clone()
    }

    pub fn set_publish_gate(&mut self, gate: Arc<dyn guard::PublishGate>) {
        self.gate = Some(gate);
    }

    /// Accord humain en cours pour ce projet (refus si pas de gate ou pas de projet).
    pub async fn publish_allowed(&self, project_uuid: &str) -> bool {
        if project_uuid.trim().is_empty() {
            return false;
        }
        match &self.gate {
            Some(gate) => gate.allowed(project_uuid).await,
            None => false,
        }
    }

    /// Schéma JSON des paramètres d'un outil (coercition des arguments).
    pub fn schema(&self, name: &str) -> Option<Value> {
        self.tools.get(name).map(|t| t.parameters())
    }

    pub fn names(&self) -> Vec<String> {
        let mut n: Vec<String> = self.tools.keys().cloned().collect();
        n.sort();
        n
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
    async fn list_deployments(&self, project_uuid: &str) -> Result<Value>;
    async fn cancel_deployment(&self, deployment_uuid: &str) -> Result<Value>;
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
    pool: Arc<sqlx::PgPool>,
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
    registry.register(Arc::new(ListDeploymentsTool {
        store: store.clone(),
    }));
    registry.register(Arc::new(CancelDeploymentTool {
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
        pool: pool.clone(),
    }));
    registry.register(Arc::new(StopLocalPreviewTool {
        pool: pool.clone(),
    }));
    registry.register(Arc::new(LocalPreviewStatusTool {
        pool: pool.clone(),
    }));
    registry.register(Arc::new(RunWorkdirCommandTool {
        pool: pool.clone(),
    }));
    registry.register(Arc::new(ListProjectAgentsTool {
        pool: pool.clone(),
    }));
    registry.register(Arc::new(ListAgentMessagesTool {
        pool: pool.clone(),
    }));
    registry.register(Arc::new(ListAgentToolFailuresTool { pool: pool.clone() }));
    registry.register(Arc::new(CreateProjectAgentTool { pool: pool.clone() }));
    registry.register(Arc::new(tools::DelegateTaskTool { pool: pool.clone() }));
    registry.register(Arc::new(ReviewProjectSecurityTool { pool: pool.clone() }));
    registry.set_publish_gate(Arc::new(guard::PgPublishGate { pool: pool.clone() }));
    registry.set_memory(Arc::new(devforge_memory::PgMemoryStore::new((*pool).clone())));
    registry.register(Arc::new(SddLoopTool { pool }));
    registry
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallRecord {
    /// Identifiant de l'appel (id du tool call LLM) — clé stable côté UI.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub id: String,
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
    /// Le plan a déjà été exécuté dans ce tour (écritures locales) : pas de « Construire ».
    #[serde(default)]
    pub executed_plan: bool,
}

pub use events::MilestoneStatus;

/// Événements d'un run (SSE `/agent/chat`, P2-01). Champs ajoutés avec `#[serde(default)]` :
/// les anciens clients et anciens flux restent compatibles.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    /// Début du run : id du run et id du message brouillon côté front.
    RunStarted { run_uuid: String, message_uuid: String },
    /// Accusé de réception immédiat (règles, pas de LLM) ; jamais persisté.
    Ack { text: String },
    Thinking {
        round: usize,
        label: String,
        /// Texte de réflexion du modèle (avant / entre tools), style Cursor.
        #[serde(default, skip_serializing_if = "String::is_empty")]
        detail: String,
    },
    /// Morceau du texte du modèle (streaming).
    Delta { text: String, round: usize },
    /// Le texte streamé de ce tour était du raisonnement (le tour finit par des outils) :
    /// le front le déplace de la bulle vers la réflexion.
    DeltaReset { round: usize },
    ToolStart {
        /// Id du tool call (LLM) — relie `tool_start` et `tool_done`, clé stable côté UI.
        #[serde(default)]
        id: String,
        name: String,
        arguments: Value,
        /// Libellé humain (« Lecture de src/app.ts »).
        #[serde(default)]
        label: String,
    },
    ToolDone {
        #[serde(default)]
        id: String,
        name: String,
        ok: bool,
        arguments: Value,
        /// Borné à 16 Ko pour l'UI ; le résultat complet est dans `Reply` et en base.
        result: Value,
        #[serde(default)]
        elapsed_ms: u64,
        /// Une ligne : « ✓ build OK · 12 s ».
        #[serde(default)]
        summary: String,
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
    /// Jalon de progression (« Build », « Preview locale »…).
    Milestone {
        label: String,
        #[serde(default)]
        status: MilestoneStatus,
    },
    Error {
        message: String,
        #[serde(default)]
        retryable: bool,
    },
}

pub type AgentProgressTx = tokio::sync::mpsc::UnboundedSender<AgentEvent>;

/// Après `delegate_task` : une phrase, puis fin du tour (P4-03).
pub const DELEGATED_NUDGE: &str = "Tâche déléguée au worker. Réponds maintenant en une phrase ce que tu as lancé (sans détailler la suite) et arrête-toi : n'appelle plus d'outil.";

fn is_cancelled(c: &Option<CancellationToken>) -> bool {
    c.as_ref().is_some_and(|c| c.is_cancelled())
}

/// Réponse d'un run arrêté par l'utilisateur (P4-05).
pub fn cancelled_reply(records: Vec<ToolCallRecord>, last_step: &str, provider: String) -> AgentReply {
    let reply = if last_step.is_empty() {
        "Arrêté à ta demande, avant toute action.".to_string()
    } else {
        format!("Arrêté à ta demande après « {last_step} ».")
    };
    let executed_plan = executed_plan(&records);
    AgentReply { reply, tool_calls: records, provider, executed_plan }
}

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
    /// `required` | `custom` | `subagent` (filtre des outils par rôle).
    pub agent_kind: Option<String>,
    pub agent_name: Option<String>,
    pub project_brief: Option<String>,
    pub git_owner: Option<String>,
    pub git_repo: Option<String>,
    pub git_branch: Option<String>,
    pub history: Vec<(String, String)>,
    /// Propriétaire de la mémoire (utilisateur courant, ou propriétaire du projet pour un réveil).
    pub user_uuid: Option<String>,
    /// Bloc `MÉMOIRE` déjà calculé (sinon chargé depuis le store au début du run).
    pub memory_profile: Option<String>,
    /// Bloc « Souvenirs possiblement utiles » déjà calculé.
    pub memory_recall: Option<String>,
    /// Run en cours (`agent_runs.uuid`) : parent des workers délégués (P4-03).
    pub run_uuid: Option<String>,
    /// Annulation demandée par l'utilisateur (P4-05) : vérifiée entre chaque appel LLM et outil.
    pub cancel: Option<CancellationToken>,
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
        self.handle_with_provider(message, force_tool, force_args, ctx, progress, None)
            .await
    }

    /// Tour d’agent avec le LLM du compte (évite de partager la chaîne globale).
    pub async fn handle_with_provider(
        &self,
        message: &str,
        force_tool: Option<&str>,
        force_args: Option<Value>,
        ctx: AgentChatContext,
        progress: Option<AgentProgressTx>,
        llm: Option<(Arc<dyn LlmProvider>, String)>,
    ) -> Result<AgentReply> {
        let provider = if let Some((_, mode)) = &llm {
            mode.clone()
        } else {
            self.provider_mode().await
        };
        if let Some(tool) = force_tool.filter(|t| !t.is_empty()) {
            emit(
                &progress,
                AgentEvent::Thinking {
                    round: 0,
                    label: format!("Outil {tool}…"),
                    detail: String::new(),
                },
            );
            let mut args = force_args.unwrap_or_else(|| json!({}));
            inject_tool_defaults(tool, &mut args, &ctx);
            if let Some(schema) = self.registry.schema(tool) {
                coerce::coerce_args(&schema, &mut args);
            }
            let call_id = format!("forced-{tool}");
            let started = std::time::Instant::now();
            emit(&progress, AgentEvent::ToolStart {
                id: call_id.clone(),
                name: tool.to_string(),
                arguments: args.clone(),
                label: events::tool_label(tool, &args),
            });
            let result = if let Some(blocked) = refuse_bare_spec_approval(tool, &args, message) {
                blocked
            } else if let Some(blocked) = refuse_spec_publish(tool, message) {
                blocked
            } else if let Some(blocked) = self.remote_write_refusal(tool, &args, &ctx).await {
                blocked
            } else {
                self.registry.execute(tool, args.clone()).await?
            };
            let ok = result.get("ok").and_then(|v| v.as_bool()).unwrap_or(true);
            let elapsed_ms = started.elapsed().as_millis() as u64;
            emit(&progress, AgentEvent::ToolDone {
                id: call_id.clone(),
                name: tool.to_string(),
                ok,
                arguments: args.clone(),
                result: events::for_ui(tool, &args, &result),
                elapsed_ms,
                summary: events::tool_summary(tool, &args, ok, &result, elapsed_ms),
            });
            return Ok(AgentReply {
                reply: summarize(tool, &result),
                tool_calls: vec![ToolCallRecord { id: call_id, name: tool.to_string(), arguments: args, result }],
                provider,
                executed_plan: false,
            });
        }
        self.run_loop(message, ctx, progress, llm).await
    }

    async fn run_loop(
        &self,
        message: &str,
        ctx: AgentChatContext,
        progress: Option<AgentProgressTx>,
        llm_override: Option<(Arc<dyn LlmProvider>, String)>,
    ) -> Result<AgentReply> {
        let mut milestones = events::MilestoneTracker::default();
        let out = self.run_loop_inner(message, ctx, &progress, llm_override, &mut milestones).await;
        for (label, status) in milestones.finish() {
            emit(&progress, AgentEvent::Milestone { label: label.into(), status });
        }
        out
    }

    async fn run_loop_inner(
        &self,
        message: &str,
        ctx: AgentChatContext,
        progress: &Option<AgentProgressTx>,
        llm_override: Option<(Arc<dyn LlmProvider>, String)>,
        milestones: &mut events::MilestoneTracker,
    ) -> Result<AgentReply> {
        let progress = progress.clone();
        let max_pushes = guard::max_pushes_per_run();
        let mut pushes: usize = 0;
        let mut messages = vec![ChatMessage::system(system_prompt(&ctx, message))];
        if let Some(brief) = &ctx.project_brief {
            messages.push(ChatMessage::system(brief.clone()));
        } else if let Some(uuid) = &ctx.project_uuid {
            messages.push(ChatMessage::system(format!(
                "Contexte projet courant : project_uuid={uuid}. Prefère cet uuid pour les tools."
            )));
        }
        // Mémoire durable (P3-05) : profil toujours injecté juste après le brief, puis souvenirs datés.
        let (memory_profile, memory_recall) = match (&ctx.memory_profile, self.registry.memory()) {
            (Some(p), _) => (Some(p.clone()), ctx.memory_recall.clone()),
            (None, Some(store)) => memory_ctx::load_blocks(store.as_ref(), &ctx, message).await,
            (None, None) => (None, ctx.memory_recall.clone()),
        };
        if let Some(block) = memory_profile {
            messages.push(ChatMessage::system(block));
        }
        if let Some(block) = memory_recall {
            messages.push(ChatMessage::system(block));
        }
        for (role, content) in &ctx.history {
            match role.as_str() {
                "assistant" => messages.push(ChatMessage::assistant(content.clone())),
                _ => messages.push(ChatMessage::user(content.clone())),
            }
        }
        messages.push(ChatMessage::user(message));
        let role = ctx.agent_role.clone().unwrap_or_else(|| "ops".into());
        let kind = ctx.agent_kind.clone();
        let security_review = is_security_review_request(message);
        let tools: Vec<ToolDefinition> = self
            .registry
            .definitions()
            .into_iter()
            .filter(|d| roles::role_allows(&role, kind.as_deref(), &d.name, security_review))
            .collect();
        let budget = truncate::budget_from_env();
        let mut records: Vec<ToolCallRecord> = Vec::new();
        let mut claim_nudged = false;
        let mut post_deploy_nudged = false;
        // P4-05 : annulation ; P4-03 : délégation qui rend la main.
        let cancel = ctx.cancel.clone();
        let mut last_step = String::new();
        let mut delegated: Option<String> = None;
        let mut delegated_refusals = 0usize;
        let (llm, provider) = if let Some(pair) = llm_override {
            pair
        } else {
            let g = self.llm.read().await;
            (g.0.clone(), g.1.clone())
        };
        for round in 0..self.max_rounds {
            if is_cancelled(&cancel) {
                return Ok(cancelled_reply(records, &last_step, provider));
            }
            if round >= 2 {
                if let Some(nudge) = detect_duplicate_calls(&records) {
                    messages.push(ChatMessage::system(nudge));
                }
                if let Some(nudge) = detect_repeated_failures(&records) {
                    let executed_plan = executed_plan(&records);
                    return Ok(AgentReply { reply: nudge, tool_calls: records, provider, executed_plan });
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
                    detail: String::new(),
                },
            );
            let req = ChatRequest {
                messages: messages.clone(),
                tools: tools.clone(),
                temperature: 0.2,
            };
            let round_no = round + 1;
            let streamed = std::sync::atomic::AtomicBool::new(false);
            let llm_call = async {
                match &progress {
                    Some(tx) => {
                        let tx_retry = tx.clone();
                        // Nouvel essai LLM (P1-09) : libellé de l'étape en cours.
                        let notify: devforge_llm::RetryNotifier = Arc::new(move |label: String| {
                            let _ = tx_retry.send(AgentEvent::Thinking { round: round_no, label, detail: String::new() });
                        });
                        let tx_delta = tx.clone();
                        let streamed_ref = &streamed;
                        // P2-02 : chaque morceau de texte part tout de suite vers le front.
                        let sink = move |d: &str| {
                            streamed_ref.store(true, std::sync::atomic::Ordering::SeqCst);
                            let _ = tx_delta.send(AgentEvent::Delta { text: d.to_string(), round: round_no });
                        };
                        devforge_llm::with_retry_notifier(notify, llm.chat_stream(req, &sink)).await
                    }
                    None => llm.chat(req).await,
                }
            };
            let turn: AssistantTurn = match &cancel {
                Some(c) => tokio::select! {
                    biased;
                    _ = c.cancelled() => return Ok(cancelled_reply(records, &last_step, provider)),
                    t = llm_call => t?,
                },
                None => llm_call.await?,
            };
            let streamed = streamed.load(std::sync::atomic::Ordering::SeqCst);
            // Texte d'un tour qui appelle des outils = raisonnement intermédiaire → bloc réflexion.
            let to_reflection = |progress: &Option<AgentProgressTx>, content: &str| {
                if content.trim().is_empty() && !streamed {
                    return;
                }
                if streamed {
                    emit(progress, AgentEvent::DeltaReset { round: round_no });
                }
                let detail = content.trim().to_string();
                if detail.is_empty() {
                    return;
                }
                let label: String = detail.chars().take(120).collect();
                emit(
                    progress,
                    AgentEvent::Thinking {
                        round: round_no,
                        label: if detail.chars().count() > 120 { format!("{label}…") } else { label },
                        // Déjà streamé : le front a le texte (DeltaReset), pas de doublon.
                        detail: if streamed { String::new() } else { detail },
                    },
                );
            };
            if !turn.tool_calls.is_empty() {
                to_reflection(&progress, &turn.content);
            }
            if turn.tool_calls.is_empty() {
                // P1-02 : « j'ai corrigé » sans aucun outil dans ce tour → un rappel, puis transparence.
                if records.is_empty() && claims::unverified_claim(&turn.content) {
                    if !claim_nudged && round + 1 < self.max_rounds {
                        to_reflection(&progress, &turn.content);
                        claim_nudged = true;
                        messages.push(ChatMessage::assistant(turn.content.clone()));
                        messages.push(ChatMessage::system(claims::CLAIM_NUDGE));
                        continue;
                    }
                    if claim_nudged {
                        return Ok(AgentReply {
                            reply: format!("{}{}", claims::UNVERIFIED_PREFIX, turn.content.trim()),
                            tool_calls: records,
                            provider,
                            executed_plan: false,
                        });
                    }
                }
                let reply = if turn.content.trim().is_empty() {
                    "Terminé.".into()
                } else {
                    turn.content
                };
                let executed_plan = executed_plan(&records);
                return Ok(AgentReply {
                    reply,
                    tool_calls: records,
                    provider,
                    executed_plan,
                });
            }
            messages.push(ChatMessage::assistant_tools(turn.content.clone(), turn.tool_calls.clone()));
            for call in turn.tool_calls {
                let mut args = call.arguments.clone();
                inject_tool_defaults(&call.name, &mut args, &ctx);
                if let Some(schema) = self.registry.schema(&call.name) {
                    coerce::coerce_args(&schema, &mut args);
                }
                if is_cancelled(&cancel) {
                    return Ok(cancelled_reply(records, &last_step, provider));
                }
                let refusal = if delegated.is_some() && call.name != "delegate_task" {
                    delegated_refusals += 1;
                    Some(json!({"ok": false, "code": "delegated", "error": tools::DELEGATED_REFUSAL}))
                } else if let Some(blocked) = refuse_bare_spec_approval(&call.name, &args, message) {
                    Some(blocked)
                } else if let Some(blocked) = refuse_spec_publish(&call.name, message) {
                    Some(blocked)
                } else if self.registry.has(&call.name)
                    && !roles::role_allows(&role, kind.as_deref(), &call.name, security_review)
                {
                    Some(roles::role_refusal(&role, &call.name))
                } else if let Some(blocked) = self.remote_write_refusal(&call.name, &args, &ctx).await {
                    Some(blocked)
                } else if guard::is_github_push(&call.name, &args) && pushes >= max_pushes {
                    // Plafond de pushes par run : on s'arrête et on demande à l'utilisateur.
                    Some(guard::push_limit_blocked(&call.name, &args, max_pushes))
                } else {
                    None
                };
                let push_limited = refusal
                    .as_ref()
                    .and_then(|r| r.get("kind"))
                    .and_then(|k| k.as_str())
                    == Some(guard::PUSH_LIMIT_KIND);
                emit(&progress, AgentEvent::ToolStart {
                    id: call.id.clone(),
                    name: call.name.clone(),
                    arguments: args.clone(),
                    label: events::tool_label(&call.name, &args),
                });
                let started = std::time::Instant::now();
                let executed = refusal.is_none();
                if executed {
                    last_step = events::tool_label(&call.name, &args);
                }
                let mut interrupted = false;
                let result = match refusal {
                    Some(blocked) => blocked,
                    None => {
                        for (label, status) in milestones.on_tool_start(&call.name, &args) {
                            emit(&progress, AgentEvent::Milestone { label: label.into(), status });
                        }
                        if guard::is_github_push(&call.name, &args) {
                            pushes += 1;
                        }
                        let exec = self.registry.execute(&call.name, args.clone());
                        let res = match &cancel {
                            // Abandon du futur = arrêt de l'outil (processus enfant tué, P4-05).
                            Some(c) => tokio::select! {
                                biased;
                                _ = c.cancelled() => {
                                    interrupted = true;
                                    Ok(json!({"ok": false, "cancelled": true, "error": "Arrêté à ta demande."}))
                                }
                                r = exec => r,
                            },
                            None => exec.await,
                        };
                        match res {
                            Ok(v) => v,
                            Err(e) => match e {
                                devforge_shared::DevForgeError::NeedsUserAction { kind, message_fr, settings_href, resume_hint } => {
                                    json!({"ok": false, "needs_user_action": true, "kind": kind, "message_fr": message_fr, "settings_href": settings_href, "resume_hint": resume_hint})
                                }
                                _ => json!({ "ok": false, "error": e.to_string() }),
                            },
                        }
                    }
                };
                let elapsed_ms = started.elapsed().as_millis() as u64;
                let ok = result.get("ok").and_then(|v| v.as_bool()).unwrap_or(true);
                emit(&progress, AgentEvent::ToolDone {
                    id: call.id.clone(),
                    name: call.name.clone(),
                    ok,
                    arguments: args.clone(),
                    result: events::for_ui(&call.name, &args, &result),
                    elapsed_ms,
                    summary: events::tool_summary(&call.name, &args, ok, &result, elapsed_ms),
                });
                if executed {
                    for (label, status) in milestones.on_tool_done(&call.name, &args, ok, &result) {
                        emit(&progress, AgentEvent::Milestone { label: label.into(), status });
                    }
                }
                if interrupted {
                    records.push(ToolCallRecord { id: call.id.clone(), name: call.name.clone(), arguments: args, result });
                    return Ok(cancelled_reply(records, &last_step, provider));
                }
                if call.name == "delegate_task" && ok && delegated.is_none() {
                    let title = result.get("title").and_then(|v| v.as_str()).unwrap_or("la tâche").to_string();
                    delegated = Some(title);
                }
                if delegated_refusals >= 2 {
                    let title = delegated.clone().unwrap_or_default();
                    records.push(ToolCallRecord { id: call.id.clone(), name: call.name.clone(), arguments: args, result });
                    let executed_plan = executed_plan(&records);
                    return Ok(AgentReply {
                        reply: format!("J'ai lancé un worker : « {title} ». Je te mets le résultat ici dès qu'il a fini."),
                        tool_calls: records,
                        provider,
                        executed_plan,
                    });
                }
                if push_limited {
                    let reply = result
                        .get("message_fr")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Plafond de pushes atteint.")
                        .to_string();
                    records.push(ToolCallRecord { id: call.id.clone(), name: call.name.clone(), arguments: args, result });
                    let executed_plan = executed_plan(&records);
                    return Ok(AgentReply { reply, tool_calls: records, provider, executed_plan });
                }
                if call.name == "propose_plan" {
                    if let Some(plan) = result.get("plan") {
                        emit(&progress, AgentEvent::Plan {
                            title: plan.get("title").and_then(|v| v.as_str()).unwrap_or("Plan").to_string(),
                            summary: plan.get("summary").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                            steps: plan.get("steps").and_then(|v| v.as_array()).map(|arr| {
                                arr.iter().filter_map(|s| s.as_str().map(|s| s.to_string())).collect()
                            }).unwrap_or_default(),
                        });
                    }
                }
                // P1-04 : le modèle reçoit une version bornée ; `records` garde le résultat complet.
                let content = truncate::for_model(&call.name, &args, &result, budget);
                let deployed = ok && matches!(call.name.as_str(), "trigger_deploy" | "publish_to_github");
                records.push(ToolCallRecord { id: call.id.clone(), name: call.name.clone(), arguments: args, result });
                messages.push(ChatMessage::tool_result(&call.id, &call.name, content));
                // P1-08 : pas de « c'est en ligne » sans vérification.
                if deployed && !post_deploy_nudged {
                    post_deploy_nudged = true;
                    messages.push(ChatMessage::system(POST_DEPLOY_NUDGE));
                }
            }
            if delegated.is_some() && !messages.iter().any(|m| m.content == DELEGATED_NUDGE) {
                messages.push(ChatMessage::system(DELEGATED_NUDGE));
            }
        }
        let executed_plan = executed_plan(&records);
        Ok(AgentReply {
            reply: "Limite de tours agent atteinte — voici les tool calls effectués.".into(),
            tool_calls: records,
            provider,
            executed_plan,
        })
    }

    /// P1-01 : action distante sans accord humain récent → refus sans effet de bord.
    async fn remote_write_refusal(&self, tool: &str, args: &Value, ctx: &AgentChatContext) -> Option<Value> {
        if !guard::is_remote_write(tool, args) {
            return None;
        }
        let project_uuid = args
            .get("project_uuid")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .map(str::to_string)
            .or_else(|| ctx.project_uuid.clone())
            .unwrap_or_default();
        if self.registry.publish_allowed(&project_uuid).await {
            None
        } else {
            Some(guard::remote_write_blocked(tool, args))
        }
    }
}

pub const POST_DEPLOY_NUDGE: &str = "Avant de conclure : attends la fin du déploiement (list_deployments / get_deployment_logs avec l'uuid renvoyé) puis http_smoke sur production_url. Ne dis « en ligne » que si http_smoke renvoie un status 2xx/3xx, et cite ce status.";

/// Écritures locales dans ce tour (le plan a été exécuté).
pub fn executed_plan(records: &[ToolCallRecord]) -> bool {
    records.iter().any(|r| {
        r.name == "write_project_file"
            && !guard::is_remote_write(&r.name, &r.arguments)
            && r.result.get("ok").and_then(|v| v.as_bool()) != Some(false)
    })
}

fn detect_duplicate_calls(records: &[ToolCallRecord]) -> Option<String> {
    if records.len() < 2 { return None; }
    let recent = if records.len() >= 3 { &records[records.len() - 3..] } else { &records[records.len() - 2..] };
    let mut call_counts: HashMap<(String, String), usize> = HashMap::new();
    for record in recent {
        let normalized = normalize_tool_call(&record.name, &record.arguments);
        *call_counts.entry((record.name.clone(), normalized)).or_insert(0) += 1;
    }
    for ((tool_name, _normalized), count) in &call_counts {
        if *count >= 2 {
            if tool_name == "write_project_file" {
                return Some("⚠️ DÉTECTION DE BOUCLE : Tu viens d'appeler write_project_file plusieurs fois avec les mêmes arguments. STOP ! Ne réécris pas le même fichier en boucle. ACTIONS REQUISES : 1. Si tu as des MULTIPLES fichiers à écrire : écris CHAQUE fichier UNE SEULE FOIS 2. Si tous les fichiers sont écrits : utilise sync_workdir_to_github pour tout pousser sur GitHub 3. Puis appelle trigger_deploy pour déployer le projet. Ne perds plus de tours sur des fichiers déjà écrits. Avance dans le workflow scaffold.".into());
            }
            return Some(format!("⚠️ DÉTECTION DE BOUCLE : Tu viens d'appeler '{}' plusieurs fois avec les mêmes arguments. STOP ! Ne répète pas le même tool call en boucle. Soit tu passes à l'étape suivante du workflow, soit tu termines ton tour si la tâche est complète.", tool_name));
        }
    }
    None
}

fn detect_repeated_failures(records: &[ToolCallRecord]) -> Option<String> {
    if records.len() < 2 { return None; }
    let recent = if records.len() >= 4 { &records[records.len() - 4..] } else { records };
    let unknown_count = recent.iter().filter(|r| {
        r.result.get("error").and_then(|e| e.as_str()).map(|s| s.contains("Unknown tool") || s.contains("tool introuvable")).unwrap_or(false)
    }).count();
    if unknown_count >= 2 {
        return Some("❌ ERREUR CRITIQUE : Tu as appelé des tools INEXISTANTS plusieurs fois. TOOLS VALIDES pour scaffold : create_github_repo, write_project_file (mode='local'), sync_workdir_to_github, trigger_deploy, get_project, get_deployment_logs. TOOLS INEXISTANTS : github_create_repo, push_files. Le workflow s'arrête ici.".into());
    }
    let mut error_patterns: HashMap<(String, String, String), usize> = HashMap::new();
    for record in recent {
        if let Some(error) = record.result.get("error").and_then(|e| e.as_str()) {
            let key = (record.name.clone(), normalize_tool_call(&record.name, &record.arguments), error.chars().take(100).collect());
            *error_patterns.entry(key).or_insert(0) += 1;
        }
    }
    for ((tool_name, _args, error_prefix), count) in &error_patterns {
        if *count >= 2 {
            if tool_name == "get_deployment_logs" && (error_prefix.contains("introuvable") || error_prefix.contains("not found")) {
                return Some("❌ ERREUR CRITIQUE : Tu appelles get_deployment_logs avec un deployment_uuid INVALIDE de manière répétée. WORKFLOW CORRECT : 1. create_github_repo 2. write_project_file ou sync_workdir_to_github 3. trigger_deploy 4. ENSUITE get_deployment_logs avec le vrai UUID.".into());
            }
            return Some(format!("❌ ERREUR CRITIQUE : Le tool '{}' échoue de manière répétée avec la même erreur. Erreur : {} Le workflow s'arrête ici.", tool_name, error_prefix.chars().take(200).collect::<String>()));
        }
    }
    None
}

fn normalize_tool_call(tool_name: &str, args: &Value) -> String {
    if tool_name == "write_project_file" {
        let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
        let mode = args.get("mode").and_then(|v| v.as_str()).unwrap_or("local");
        format!("{path}::{mode}")
    } else {
        serde_json::to_string(args).unwrap_or_default()
    }
}

fn refuse_spec_publish(tool: &str, user_message: &str) -> Option<Value> {
    let spec = user_message.contains("SDD-IMPLEMENT:")
        || user_message.contains("SDD-SPECIFY:")
        || user_message.contains("SDD-APPROVED:");
    if !spec {
        return None;
    }
    const BLOCKED: &[&str] = &[
        "create_github_repo",
        "create_github_fix",
        "publish_to_github",
        "sync_workdir_to_github",
        "trigger_deploy",
    ];
    if BLOCKED.contains(&tool) {
        Some(json!({
            "ok": false,
            "error": "Interdit pendant la spec : pas de dépôt, pas de pull request, pas de déploiement."
        }))
    } else {
        None
    }
}

fn refuse_bare_spec_approval(tool: &str, args: &Value, user_message: &str) -> Option<Value> {
    if tool != "sdd_loop" {
        return None;
    }
    let action = args.get("action").and_then(|v| v.as_str()).unwrap_or("").trim();
    if action != "approve" || !is_execute_nudge(user_message) {
        return None;
    }
    Some(json!({
        "ok": false,
        "error": "« oui » et « go » ne valident pas la spec. Il faut une approbation explicite, par exemple « j'approuve la spec »."
    }))
}

fn inject_tool_defaults(tool: &str, args: &mut Value, ctx: &AgentChatContext) {
    let Some(obj) = args.as_object_mut() else { return; };
    if tool.starts_with("memory_") {
        // Identité imposée par le serveur : jamais celle fournie par le modèle.
        for k in tools::MEMORY_IDENTITY_ARGS {
            obj.remove(*k);
        }
        let set = |obj: &mut serde_json::Map<String, Value>, k: &str, v: &Option<String>| {
            if let Some(v) = v.as_deref().filter(|v| !v.is_empty()) {
                obj.insert(k.into(), json!(v));
            }
        };
        set(obj, "user_uuid", &ctx.user_uuid);
        set(obj, "project_uuid", &ctx.project_uuid);
        set(obj, "caller_agent_uuid", &ctx.agent_uuid);
        set(obj, "caller_agent_role", &ctx.agent_role);
        set(obj, "caller_agent_kind", &ctx.agent_kind);
        return;
    }
    if tool == "delegate_task" {
        // Fil, projet et run parent imposés par le serveur.
        for k in ["project_uuid", "caller_agent_uuid", "parent_run_uuid"] {
            obj.remove(k);
        }
        for (k, v) in [("project_uuid", &ctx.project_uuid), ("caller_agent_uuid", &ctx.agent_uuid), ("parent_run_uuid", &ctx.run_uuid)] {
            if let Some(v) = v.as_deref().filter(|v| !v.is_empty()) {
                obj.insert(k.into(), json!(v));
            }
        }
        return;
    }
    if let Some(uuid) = &ctx.project_uuid {
        let provided = obj.get("project_uuid").and_then(|v| v.as_str()).unwrap_or("").trim();
        if provided.is_empty() || provided != uuid {
            obj.insert("project_uuid".into(), json!(uuid));
        }
    }
    if let Some(agent_uuid) = &ctx.agent_uuid {
        let empty = obj
            .get("caller_agent_uuid")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .is_empty();
        if !obj.contains_key("caller_agent_uuid") || empty {
            obj.insert("caller_agent_uuid".into(), json!(agent_uuid));
        }
    }
    if let Some(owner) = &ctx.git_owner {
        let empty = obj.get("owner").and_then(|v| v.as_str()).unwrap_or("").is_empty();
        if !obj.contains_key("owner") || empty {
            obj.insert("owner".into(), json!(owner));
        }
    }
    if let Some(repo) = &ctx.git_repo {
        let empty = obj.get("repo").and_then(|v| v.as_str()).unwrap_or("").is_empty();
        if !obj.contains_key("repo") || empty {
            obj.insert("repo".into(), json!(repo));
        }
    }
    if let Some(branch) = &ctx.git_branch {
        let empty = obj.get("branch").and_then(|v| v.as_str()).unwrap_or("").is_empty();
        if !obj.contains_key("branch") || empty {
            obj.insert("branch".into(), json!(branch));
        }
    }
}

fn normalize_user_text(msg: &str) -> String {
    msg.trim().to_lowercase().trim_end_matches(['.', '!', '?', '…']).trim().to_string()
}

fn is_execute_nudge(msg: &str) -> bool {
    matches!(normalize_user_text(msg).as_str(), "go" | "oui" | "ok" | "yes" | "vas-y" | "vas y" | "fais-le" | "fais le" | "continue" | "lance" | "go go" | "ok go")
}

fn is_security_review_request(msg: &str) -> bool {
    let t = normalize_user_text(msg);
    const NEEDLES: &[&str] = &[
        "revue sécurité",
        "revue securite",
        "audit sécurité",
        "audit securite",
        "review_project_security",
        "en-têtes de sécurité",
        "en-tetes de securite",
        "entêtes de sécurité",
    ];
    NEEDLES.iter().any(|n| t.contains(n))
}

const REMOTE_LOCK: &str = "Les actions distantes (GitHub, déploiement, variables de prod) sont verrouillées côté serveur tant que l'utilisateur n'a pas cliqué « Valider » ; si un outil répond publish_approval_required, arrête-toi et demande une seule fois.";

fn local_first_rules(intent: guard::PublishIntent) -> String {
    let gate = match intent {
        guard::PublishIntent::Explicit => "L'utilisateur demande une publication : travaille depuis les fichiers locaux déjà écrits. Si l'outil répond publish_approval_required, l'interface affiche le bouton de validation : arrête-toi.".to_string(),
        guard::PublishIntent::Negated => "L'utilisateur a demandé de NE PAS publier : reste strictement en local (aucun outil GitHub ni déploiement).".to_string(),
        guard::PublishIntent::None => "Pas de demande de publication : n'appelle pas create_github_fix, sync_workdir_to_github, publish_to_github, create_github_repo, trigger_deploy ni mcp_call_tool en écriture. « go », « oui », « améliore le site » ne valident PAS une publication. N'invente pas un MCP « devforge-workdir » : shell = run_workdir_command (allowlist npm/node/astro…), fichiers = outils natifs.".to_string(),
    };
    format!("WORKFLOW (local d'abord, publication en dernier) :\n- Demande d'ANALYSE (question, « que proposes-tu », « analyse ») : propose_plan, puis arrête-toi et attends la réponse.\n- Demande d'EXÉCUTION (« fais », « corrige », « ajoute », « go ») : exécute directement en local sans redemander : list_project_files, read_project_file, write_project_file mode='local', run_workdir_command (build/test).\n- PREVIEW : après des edits, start_local_preview. Si public_ok=false ou logs_tail montre une erreur, corrige et relance (force=true). Ne dis jamais que la preview marche sans public_ok=true.\n- Si tu as déjà exécuté le plan dans ce tour, ne propose pas de le construire.\n- {REMOTE_LOCK}\n{gate}")
}

fn read_only_rules() -> String {
    format!("Tu n'as pas d'outil d'écriture dans le code : pour modifier l'application, explique ce qu'il faut changer et délègue au Coordinateur.\n{REMOTE_LOCK}")
}

const STYLE: &str = "FORMAT DE RÉPONSE :\n- 1re phrase = le résultat (ce qui marche / ce qui casse / ce qui reste), sans préambule.\n- Puis au plus 3 puces factuelles (fichiers, commande, preuve : status HTTP, public_ok).\n- Une seule question à la fin, seulement si une décision de l'utilisateur est nécessaire.\n- Ne répète pas le plan ni la liste des outils appelés : l'interface les affiche déjà.\n- Chaque affirmation de succès cite sa preuve (sortie d'outil de CE tour).";

const AUTONOMY: &str = "AUTONOMIE :\nAgis sans demander pour tout ce qui est local et réversible (lire, écrire en local, build, tests, preview).\nDemande une seule fois pour ce qui est distant ou destructif (publication, déploiement, suppression, variables prod) : l'interface affiche le bouton de validation.\nEn cas d'échec : une cause → un correctif → re-vérifie. Après 2 échecs identiques, arrête et explique ce qui bloque.";

fn sdd_overlay(role: &str, latest: &str) -> String {
    if latest.contains("SDD-SPECIFY:") {
        return "\nSDD : la spec est dans specs/<slug>/spec.md. ARRÊT. Pas de code, pas de create_project_agent, pas de dépôt, pas de publication, pas de déploiement. Demande une validation explicite de la spec. « oui » et « go » ne suffisent pas.\n".into();
    }
    if latest.contains("SDD-APPROVED:") {
        return "\nSDD : spec validée, plan.md et tasks.md sont écrits. Le worker local est déjà lancé : n'appelle pas create_project_agent. Publication toujours interdite.\n".into();
    }
    if latest.contains("SDD-REJECT:") {
        return "\nSDD : spec rejetée. Pas de code. Attends une nouvelle description.\n".into();
    }
    if latest.contains("SDD-IMPLEMENT:") {
        return "\nSDD : tu es le worker de cette spec. Appelle les outils, n'écris pas leur JSON. Lis la spec, écris les fichiers de la fonctionnalité (pas seulement README), lance la preview locale, puis specs/<slug>/convergence.md. Première ligne CONVERGED: yes seulement si ces fichiers sont écrits, CONVERGED: no s'il reste un écart, CONVERGED: fail si tu es bloqué. Interdit : dépôt, pull request, publication, déploiement.\n".into();
    }
    if latest.contains("SDD-CONVERGED:") || latest.contains("SDD-FAILED:") {
        return "\nSDD : boucle terminée. Résume le résultat. N'ouvre pas de pull request sans une demande explicite et séparée.\n".into();
    }
    if role == "coordinator" {
        "\nSDD : pour une fonctionnalité, sdd_loop action=specify (titre + description). Cela écrit specs/constitution.md une fois et specs/<slug>/spec.md, puis tu t'arrêtes. « oui » et « go » ne valident pas la spec. Après un « j'approuve la spec », sdd_loop action=approve : DevForge crée le worker local et lance l'implémentation. N'appelle pas create_project_agent pour ça. Le worker écrit specs/<slug>/convergence.md. Tu restes en local.\n".into()
    } else {
        String::new()
    }
}

fn system_prompt(ctx: &AgentChatContext, latest: &str) -> String {
    let role = ctx.agent_role.as_deref().unwrap_or("ops");
    let kind = ctx.agent_kind.as_deref();
    let name = ctx.agent_name.as_deref().unwrap_or("Agent");
    let intent = guard::publish_intent(latest);
    let publish_ok = intent == guard::PublishIntent::Explicit;
    let security_review = is_security_review_request(latest);
    let execute_nudge = is_execute_nudge(latest);
    let can_write = roles::role_allows(role, kind, "write_project_file", security_review);
    let local = if security_review {
        "Cette demande est une revue sécurité : n'écris pas de fichiers et n'ouvre pas de PR. Un seul appel à review_project_security, puis le rapport des findings.".to_string()
    } else if can_write {
        local_first_rules(intent)
    } else {
        read_only_rules()
    };
    let has_template_applied = ctx.history.iter().any(|(hist_role, content)| {
        hist_role == "user" && ((content.contains("Template") && content.contains("déjà appliqué")) || (content.contains("template") && content.contains("already applied")))
    });
    let sdd = sdd_overlay(role, latest);
    let role_focus = match role {
        "deploy" => {
            let template_nudge = if has_template_applied {
                "Le template est déjà dans le workdir. Ne réécris pas tout. Customisations = write_project_file local + start_local_preview.\n"
            } else {
                "Scaffold / correctifs en LOCAL, preview, puis publish_to_github seulement si demandé.\n"
            };
            format!("Tu es l'agent Déploiements. Priorité : statut des builds, versions en ligne, logs (get_project, get_deployment_logs, http_smoke). Ne lance un déploiement et ne modifie le code que si on te le demande clairement.\n{template_nudge}Conserve les routes Pocket ID du template (`/api/auth/login`, `/api/auth/callback/pocket-id`) : les comptes Pocket ID s'en servent pour entrer dans l'app.\n{local}")
        }
        "runner" => format!("Tu es l'agent Runners. Tu surveilles les runners GitHub liés au dépôt (en ligne, occupés, en erreur). Rapporte les faits avec get_project et les outils GitHub disponibles. Ne modifie pas le code : le Workspace sert à ça. Si tu ne peux pas lire les runners, dis-le et oriente vers la page Runners.\n{local}"),
        "actions" => format!("Tu es l'agent Actions. Tu surveilles les workflows GitHub Actions du dépôt (succès, échec, en cours). Rapporte le dernier run utile. Ne réécris pas l'application : le Workspace sert à ça.\n{local}"),
        "crons" => format!("Tu es l'agent Crons. Tu surveilles les tâches planifiées du projet (actives, dernière exécution, échecs).\n{local}"),
        "reviewer" => format!("Tu es l'agent Revue : qualité, risques, CI. Tu signales ce qui cloche. Tu n'ouvres pas une PR et tu ne réécris pas le site.\nRevue sécurité : seulement sur demande explicite, appelle review_project_security une fois. C'est une revue statique (secrets masqués, dépendances, motifs, en-têtes du projet). Rapporte les findings de l'outil. N'invente pas de faille et ne décris pas comment l'exploiter.\n{local}"),
        "ops" => format!("Tu es l'agent Ops. Priorité : santé du projet, logs, variables d'environnement, smoke HTTP (get_project, get_deployment_logs, list_env_vars, http_smoke).\n{local}"),
        // Coordinateur = fil permanent du projet. Les tâches lourdes passent par des subagents éphémères.
        "coordinator" => format!(
            "Tu es le Coordinateur — fil permanent de ce projet. Tu accumules le contexte, restes proactif sur les événements (échec deploy, santé dégradée), et orchestres.\nWORKERS : pour une tâche longue ou isolée (refonte d'une page, chantier de plusieurs fichiers, réparation longue), appelle delegate_task (title, instructions avec un critère de fin vérifiable) : le worker travaille en arrière-plan, le résultat revient dans ce fil sous forme de carte. Après delegate_task, réponds en une phrase ce que tu as lancé et arrête-toi. Les petites demandes (une question, une retouche d'un fichier) se font directement. Ne crée PAS un nouveau fil permanent / required par tâche. Tu coordonnes Deploy / Ops / Reviewer sans les remplacer.\n{sdd}{local}"
        ),
        _ => format!("Tu es un agent DevForge : planifie, agis dans le workdir, preview, puis PR sur validation.\n{sdd}{local}"),
    };
    let nudge = if security_review {
        "\nL'utilisateur demande une revue sécurité. Appelle review_project_security maintenant, une seule fois. Résume les findings (gravité, fichier, correctif). N'invente rien. Ne décris pas d'exploit. Ne réécris pas le code.\n"
    } else if execute_nudge && !publish_ok && can_write {
        "\nL'utilisateur a confirmé (go/oui). N'analyse PAS à nouveau. N'ouvre PAS de PR. Si le plan précédent est déjà exécuté (fichiers écrits, preview OK), dis-le en citant le tour précédent ; sinon exécute-le EN LOCAL tout de suite (fichiers + start_local_preview).\n"
    } else if publish_ok && can_write {
        "\nL'utilisateur a demandé une PR / publication. Ouvre-la à partir des fichiers locaux déjà écrits. Si l'outil répond publish_approval_required, arrête-toi : l'interface affiche le bouton « Valider la publication ».\n"
    } else { "" };
    let scoped = if ctx.project_brief.is_some() || ctx.project_uuid.is_some() {
        "\nLe projet courant est déjà dans le contexte — ne demande pas l'UUID. Agis."
    } else { "" };
    let mcp_guidance = mcp_guidance(role, kind, security_review);
    format!("Tu es {name} ({role}) sur DevForge. {role_focus}{nudge}{scoped}{mcp_guidance}\n\n{AUTONOMY}\n\n{STYLE}\nRéponds en français. N'invente pas de résultats. Le panneau Preview du workspace est l'endroit où l'utilisateur voit tes changements.")
}

/// Rappel des outils disponibles — seulement ceux du rôle (P1-05).
fn mcp_guidance(role: &str, kind: Option<&str>, security_review: bool) -> String {
    const LOCAL: &[&str] = &[
        "propose_plan", "sdd_loop", "list_project_files", "read_project_file", "write_project_file", "run_workdir_command",
        "start_local_preview", "local_preview_status", "list_project_agents", "list_agent_messages", "list_agent_tool_failures",
        "create_project_agent", "review_project_security",
    ];
    let local: Vec<String> = LOCAL
        .iter()
        .filter(|t| roles::role_allows(role, kind, t, security_review || **t == "review_project_security"))
        .map(|t| match *t {
            "write_project_file" => "write_project_file (mode=local)".to_string(),
            "review_project_security" => "review_project_security (revue statique, seulement si demandée)".to_string(),
            other => other.to_string(),
        })
        .collect();
    let mut out = String::new();
    if !local.is_empty() {
        out.push_str(&format!("\n\nTOOLS LOCAUX (prioritaires, PAS du MCP) : {}.", local.join(", ")));
    }
    out.push_str("\nIl n’existe PAS de serveur MCP « devforge-workdir » / « workdir » / « atelier » — n’invente pas ce nom, ne bloque PAS en attendant un MCP manquant, et ne demande JAMAIS à l’utilisateur de le configurer.");
    if roles::role_allows(role, kind, "run_workdir_command", false) {
        out.push_str(" Pour npm/build/test : run_workdir_command. Pour la preview : start_local_preview (npm install inclus).");
    }
    if roles::role_allows(role, kind, "mcp_call_tool", false) {
        out.push_str("\nMCP distants (mcp_list_servers / mcp_call_tool) : uniquement GitHub, Turso, Slack… ; les écritures GitHub passent par la validation. Pas besoin de lister les serveurs MCP à chaque tour.");
    }
    out
}

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
    for prefix in ["https://github.com/", "http://github.com/", "https://www.github.com/"] {
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

#[cfg(test)]
mod scaffold_chain_test;

#[cfg(test)]
mod loop_tests;

#[cfg(test)]
mod approval_gate {
    use super::*;

    #[test]
    fn bare_oui_or_go_does_not_approve_spec() {
        let args = json!({"action": "approve", "slug": "compteur"});
        assert!(refuse_bare_spec_approval("sdd_loop", &args, "oui").is_some());
        assert!(refuse_bare_spec_approval("sdd_loop", &args, "go").is_some());
        assert!(refuse_bare_spec_approval("sdd_loop", &args, "OK").is_some());
        assert!(refuse_bare_spec_approval("sdd_loop", &args, "j'approuve la spec").is_none());
        assert!(refuse_bare_spec_approval("sdd_loop", &json!({"action": "specify"}), "oui").is_none());
        assert!(refuse_bare_spec_approval("create_project_agent", &args, "oui").is_none());
    }

    #[test]
    fn spec_implement_does_not_open_a_repo_or_deploy() {
        let msg = "SDD-IMPLEMENT:page:attempt=1\nÉcris la page.";
        assert!(refuse_spec_publish("create_github_repo", msg).is_some());
        assert!(refuse_spec_publish("trigger_deploy", msg).is_some());
        assert!(refuse_spec_publish("publish_to_github", msg).is_some());
        assert!(refuse_spec_publish("write_project_file", msg).is_none());
        assert!(refuse_spec_publish("create_github_repo", "ajoute une page").is_none());
    }
}

fn summarize(tool: &str, result: &Value) -> String {
    let pretty = serde_json::to_string_pretty(result).unwrap_or_else(|_| "{}".into());
    if result.get("ok").and_then(|v| v.as_bool()) == Some(true) {
        format!("✓ {tool} OK.\n{pretty}")
    } else {
        let err = result.get("error").or_else(|| result.get("reason")).and_then(|v| v.as_str()).unwrap_or("échec");
        format!("✗ {tool} : {err}\n{pretty}")
    }
}

#[cfg(test)]
mod event_serde_tests {
    use super::*;

    #[test]
    fn tool_start_serializes_snake_case_with_id() {
        let ev = AgentEvent::ToolStart {
            id: "call_42".into(),
            name: "read_project_file".into(),
            arguments: json!({ "path": "README.md" }),
            label: "Lecture de README.md".into(),
        };
        let v = serde_json::to_value(&ev).unwrap();
        assert_eq!(v["type"], "tool_start");
        assert_eq!(v["id"], "call_42");
        assert_eq!(v["name"], "read_project_file");
        assert_eq!(v["arguments"]["path"], "README.md");
    }

    #[test]
    fn tool_done_serializes_id_and_legacy_payload_still_parses() {
        let ev = AgentEvent::ToolDone {
            id: "call_42".into(),
            name: "http_smoke".into(),
            ok: true,
            arguments: json!({}),
            result: json!({ "ok": true }),
            elapsed_ms: 1200,
            summary: "✓ Smoke HTTP · 1 s".into(),
        };
        let v = serde_json::to_value(&ev).unwrap();
        assert_eq!(v["type"], "tool_done");
        assert_eq!(v["id"], "call_42");
        // Ancien format sans `id` : toujours accepté (id vide).
        let legacy: AgentEvent =
            serde_json::from_value(json!({ "type": "tool_start", "name": "x", "arguments": {} })).unwrap();
        match legacy {
            AgentEvent::ToolStart { id, .. } => assert!(id.is_empty()),
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn tool_call_record_id_is_optional() {
        let rec = ToolCallRecord { id: String::new(), name: "x".into(), arguments: json!({}), result: json!({}) };
        let v = serde_json::to_value(&rec).unwrap();
        assert!(v.get("id").is_none());
        let rec: ToolCallRecord =
            serde_json::from_value(json!({ "name": "x", "arguments": {}, "result": {} })).unwrap();
        assert!(rec.id.is_empty());
    }
}
