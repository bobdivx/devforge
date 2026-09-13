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
    registry.register(Arc::new(StartLocalPreviewTool { pool }));
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
    pub project_brief: Option<String>,
    pub git_owner: Option<String>,
    pub git_repo: Option<String>,
    pub git_branch: Option<String>,
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
            emit(&progress, AgentEvent::Thinking { round: 0, label: format!("Outil {tool}…") });
            let mut args = force_args.unwrap_or_else(|| json!({}));
            inject_tool_defaults(&mut args, &ctx);
            emit(&progress, AgentEvent::ToolStart { name: tool.to_string(), arguments: args.clone() });
            let result = self.registry.execute(tool, args.clone()).await?;
            let ok = result.get("ok").and_then(|v| v.as_bool()).unwrap_or(true);
            emit(&progress, AgentEvent::ToolDone { name: tool.to_string(), ok, arguments: args.clone(), result: result.clone() });
            return Ok(AgentReply {
                reply: summarize(tool, &result),
                tool_calls: vec![ToolCallRecord { name: tool.to_string(), arguments: args, result }],
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
                if let Some(nudge) = detect_duplicate_calls(&records) {
                    messages.push(ChatMessage::system(nudge));
                }
                if let Some(nudge) = detect_repeated_failures(&records) {
                    return Ok(AgentReply { reply: nudge, tool_calls: records, provider });
                }
            }
            emit(&progress, AgentEvent::Thinking {
                round: round + 1,
                label: if round == 0 { "Analyse de la demande…".into() } else { format!("Réflexion (tour {})…", round + 1) },
            });
            let turn: AssistantTurn = llm.chat(ChatRequest {
                messages: messages.clone(),
                tools: tools.clone(),
                temperature: 0.2,
            }).await?;
            if !turn.content.trim().is_empty() && !turn.tool_calls.is_empty() {
                let snippet: String = turn.content.chars().take(140).collect();
                emit(&progress, AgentEvent::Thinking { round: round + 1, label: snippet });
            }
            if turn.tool_calls.is_empty() {
                let reply = if turn.content.trim().is_empty() { "Terminé.".into() } else { turn.content };
                return Ok(AgentReply { reply, tool_calls: records, provider });
            }
            messages.push(ChatMessage::assistant_tools(turn.content.clone(), turn.tool_calls.clone()));
            for call in turn.tool_calls {
                let mut args = call.arguments.clone();
                inject_tool_defaults(&mut args, &ctx);
                emit(&progress, AgentEvent::ToolStart { name: call.name.clone(), arguments: args.clone() });
                let result = match self.registry.execute(&call.name, args.clone()).await {
                    Ok(v) => v,
                    Err(e) => match e {
                        devforge_shared::DevForgeError::NeedsUserAction { kind, message_fr, settings_href, resume_hint } => {
                            json!({"ok": false, "needs_user_action": true, "kind": kind, "message_fr": message_fr, "settings_href": settings_href, "resume_hint": resume_hint})
                        }
                        _ => json!({ "ok": false, "error": e.to_string() }),
                    },
                };
                let ok = result.get("ok").and_then(|v| v.as_bool()).unwrap_or(true);
                emit(&progress, AgentEvent::ToolDone { name: call.name.clone(), ok, arguments: args.clone(), result: result.clone() });
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
                records.push(ToolCallRecord { name: call.name.clone(), arguments: args, result: result.clone() });
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

fn inject_tool_defaults(args: &mut Value, ctx: &AgentChatContext) {
    let Some(obj) = args.as_object_mut() else { return; };
    if let Some(uuid) = &ctx.project_uuid {
        let provided = obj.get("project_uuid").and_then(|v| v.as_str()).unwrap_or("").trim();
        if provided.is_empty() || provided != uuid {
            obj.insert("project_uuid".into(), json!(uuid));
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

fn is_publish_request(msg: &str) -> bool {
    let t = normalize_user_text(msg);
    const NEEDLES: &[&str] = &["crée une pr", "creer une pr", "crée la pr", "creer la pr", "ouvre une pr", "ouvrir une pr", "open a pr", "pull request", "publie", "publier", "valide et crée", "valider et créer", "valide les changements", "merge ça", "déploie en prod", "deploie en prod", "déploie en production", "create_github_fix"];
    NEEDLES.iter().any(|n| t.contains(n))
}

fn local_first_rules(publish_ok: bool) -> String {
    let gate = if publish_ok {
        "L'utilisateur a VALIDÉ explicitement une publication. Tu PEUX maintenant : create_github_fix, sync_workdir_to_github, publish_to_github, ou trigger_deploy. Travaille toujours depuis les fichiers locaux déjà écrits.".to_string()
    } else {
        "❌ INTERDIT (pas de validation PR) : create_github_fix, create_pull_request, publish_to_github, sync_workdir_to_github, create_github_repo, mcp_call_tool create_pull_request / create_or_update_file / create_branch. « go », « oui », « améliore le site » NE sont PAS une validation de PR. ✅ AUTORISÉ : propose_plan, list_project_files, read_project_file, write_project_file mode=local, start_local_preview, get_project, get_deployment_logs, run_application_tests, http_smoke, list_env_vars.".to_string()
    };
    format!("WORKFLOW OBLIGATOIRE (autonomie locale, PR en dernier) :\n1. PLAN : appelle propose_plan (titre + étapes) AVANT d'écrire des fichiers.\n2. EXÉCUTE EN LOCAL dans le dossier de l'app : list_project_files, read_project_file, write_project_file mode='local'. Ne te contente pas de conseiller.\n3. PREVIEW : après des edits, appelle start_local_preview et dis à l'utilisateur de regarder le panneau Preview du workspace.\n4. RAPPORT : résume les fichiers touchés, puis UNE SEULE question : « Valide pour ouvrir une PR ? »\n{gate}")
}

fn system_prompt(ctx: &AgentChatContext, latest: &str) -> String {
    let role = ctx.agent_role.as_deref().unwrap_or("ops");
    let name = ctx.agent_name.as_deref().unwrap_or("Agent");
    let publish_ok = is_publish_request(latest);
    let execute_nudge = is_execute_nudge(latest);
    let local = local_first_rules(publish_ok);
    let has_template_applied = ctx.history.iter().any(|(hist_role, content)| {
        hist_role == "user" && ((content.contains("Template") && content.contains("déjà appliqué")) || (content.contains("template") && content.contains("already applied")))
    });
    let role_focus = match role {
        "deploy" => {
            let template_nudge = if has_template_applied {
                "Le template est déjà dans le workdir. Ne réécris pas tout. Customisations = write_project_file local + start_local_preview.\n"
            } else {
                "Scaffold / correctifs en LOCAL, preview, puis publish_to_github seulement si demandé.\n"
            };
            format!("Tu es l'agent Deploy : builds, logs, smoke HTTP, preview locale, déploiements.\n{template_nudge}{local}")
        }
        "reviewer" => format!("Tu es l'agent Reviewer : qualité, UX, design, CI — tu AMÉLIORES le site dans le workdir, tu ne te limites pas à lister des risques.\n{local}\nN'ouvre PAS une PR CI/CD à la place d'une vraie amélioration du site. Un workflow GitHub n'est pas une feature utilisateur."),
        "ops" => format!("Tu es l'agent Ops : santé, env, tests, config. Corrige EN LOCAL (workdir), pas via une PR GitHub tant que l'utilisateur n'a pas validé.\n{local}\nSi un test/build casse : lis le fichier local, corrige, relance. Ne dis jamais « tu devrais modifier X » — fais-le dans le dossier de l'app."),
        _ => format!("Tu es un agent DevForge : planifie, agis dans le workdir, preview, puis PR sur validation.\n{local}"),
    };
    let nudge = if execute_nudge && !publish_ok {
        "\nL'utilisateur a confirmé (go/oui). N'analyse PAS à nouveau. N'ouvre PAS de PR. Exécute le plan précédent EN LOCAL tout de suite (fichiers + start_local_preview).\n"
    } else if publish_ok {
        "\nL'utilisateur a demandé une PR / publication. Ouvre-la à partir des fichiers locaux déjà écrits.\n"
    } else { "" };
    let scoped = if ctx.project_brief.is_some() || ctx.project_uuid.is_some() {
        "\nLe projet courant est déjà dans le contexte — ne demande pas l'UUID. Agis."
    } else { "" };
    let mcp_guidance = "\n\nTOOLS LOCAUX (prioritaires) : propose_plan, list_project_files, read_project_file, write_project_file (mode=local), start_local_preview.\nMCP GitHub (create_branch / create_or_update_file / create_pull_request) : UNIQUEMENT après validation PR explicite. Pas besoin de lister les serveurs MCP à chaque tour.";
    format!("Tu es {name} ({role}) sur DevForge. {role_focus}{nudge}{scoped}{mcp_guidance}\nRéponds en français, concret, orienté ACTION. N'invente pas de résultats. Le panneau Preview du workspace est l'endroit où l'utilisateur voit tes changements.")
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

fn summarize(tool: &str, result: &Value) -> String {
    let pretty = serde_json::to_string_pretty(result).unwrap_or_else(|_| "{}".into());
    if result.get("ok").and_then(|v| v.as_bool()) == Some(true) {
        format!("✓ {tool} OK.\n{pretty}")
    } else {
        let err = result.get("error").or_else(|| result.get("reason")).and_then(|v| v.as_str()).unwrap_or("échec");
        format!("✗ {tool} : {err}\n{pretty}")
    }
}
