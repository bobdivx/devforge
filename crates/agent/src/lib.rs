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
    GitHubListPrsTool, GitHubWorkflowRunsTool, HttpSmokeTool, ListEnvVarsTool, ListProjectsTool,
    McpCallTool, McpListRemoteToolsTool, McpListServersTool, PublishToGitHubTool,
    ReadGitHubFileTool, RunApplicationTestsTool, StartLocalPreviewTool, SyncWorkdirToGitHubTool,
    TriggerDeployTool, UpsertEnvVarsTool, WriteProjectFileTool,
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
            max_rounds: 12,
        }
    }

    pub fn with_llm(registry: Arc<ToolRegistry>, llm: Arc<dyn LlmProvider>, mode: impl Into<String>) -> Self {
        Self {
            registry,
            llm: tokio::sync::RwLock::new((llm, mode.into())),
            max_rounds: 12,
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

        for round in 0..self.max_rounds {
            // Détection anti-boucle : si on détecte des duplicatas dans les 2-3 derniers rounds
            if round >= 2 {
                let loop_nudge = detect_duplicate_calls(&records);
                if let Some(nudge) = loop_nudge {
                    messages.push(ChatMessage::system(nudge));
                }
            }
            
            // Détection anti-boucle renforcée : tools inconnus répétés + erreurs répétées
            if round >= 2 {
                if let Some(nudge) = detect_repeated_failures(&records) {
                    // Erreur critique : stop early au lieu de brûler max_rounds
                    return Ok(AgentReply {
                        reply: nudge,
                        tool_calls: records,
                        provider,
                    });
                }
            }
            
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
                    Err(e) => {
                        // Convertir les erreurs NeedsUserAction en JSON structuré
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

/// Détecte si l'agent répète les mêmes tool calls en boucle.
/// Retourne un message de nudge système si des duplicatas sont détectés.
fn detect_duplicate_calls(records: &[ToolCallRecord]) -> Option<String> {
    if records.len() < 2 {
        return None;
    }

    // Prendre les 3 derniers appels
    let recent = if records.len() >= 3 {
        &records[records.len() - 3..]
    } else {
        &records[records.len() - 2..]
    };

    // Compter les occurrences de chaque combinaison (tool_name, normalized_args)
    let mut call_counts: HashMap<(String, String), usize> = HashMap::new();
    
    for record in recent {
        let normalized = normalize_tool_call(&record.name, &record.arguments);
        *call_counts.entry((record.name.clone(), normalized)).or_insert(0) += 1;
    }

    // Si un même appel apparaît 2+ fois dans les 3 derniers rounds
    for ((tool_name, _normalized), count) in &call_counts {
        if *count >= 2 {
            // Cas spécial pour write_project_file : nudge spécifique
            if tool_name == "write_project_file" {
                return Some(
                    "⚠️ DÉTECTION DE BOUCLE : Tu viens d'appeler write_project_file plusieurs fois avec les mêmes arguments. \
                    STOP ! Ne réécris pas le même fichier en boucle. \
                    \n\nACTIONS REQUISES :\n\
                    1. Si tu as des MULTIPLES fichiers à écrire : écris CHAQUE fichier UNE SEULE FOIS\n\
                    2. Si tous les fichiers sont écrits : utilise sync_workdir_to_github pour tout pousser sur GitHub\n\
                    3. Puis appelle trigger_deploy pour déployer le projet\n\
                    \n\
                    Ne perds plus de tours sur des fichiers déjà écrits. Avance dans le workflow scaffold.".into()
                );
            }

            // Nudge générique pour autres tools
            return Some(format!(
                "⚠️ DÉTECTION DE BOUCLE : Tu viens d'appeler '{}' plusieurs fois avec les mêmes arguments. \
                STOP ! Ne répète pas le même tool call en boucle. \
                \n\nSoit tu passes à l'étape suivante du workflow, soit tu termines ton tour si la tâche est complète.",
                tool_name
            ));
        }
    }

    None
}

/// Détecte les échecs répétés (unknown tools, erreurs identiques).
/// Retourne un message d'erreur terminal pour stop early.
fn detect_repeated_failures(records: &[ToolCallRecord]) -> Option<String> {
    if records.len() < 2 {
        return None;
    }

    // Prendre les 4 derniers appels pour détecter les patterns d'échec
    let recent = if records.len() >= 4 {
        &records[records.len() - 4..]
    } else {
        records
    };

    // Compter les unknown tools
    let unknown_count = recent
        .iter()
        .filter(|r| {
            r.result
                .get("error")
                .and_then(|e| e.as_str())
                .map(|s| s.contains("Unknown tool") || s.contains("tool introuvable"))
                .unwrap_or(false)
        })
        .count();

    // Si 2+ unknown tools dans les 4 derniers appels : stop early
    if unknown_count >= 2 {
        return Some(
            "❌ ERREUR CRITIQUE : Tu as appelé des tools INEXISTANTS plusieurs fois.\n\
            \n\
            ✅ TOOLS VALIDES pour scaffold :\n\
            - create_github_repo : créer le dépôt GitHub\n\
            - write_project_file (mode='local') : écrire des fichiers localement\n\
            - sync_workdir_to_github : pousser TOUS les fichiers locaux vers GitHub en un appel\n\
            - trigger_deploy : déployer le projet\n\
            - get_project : consulter l'état du projet\n\
            - get_deployment_logs : consulter les logs de déploiement\n\
            \n\
            ❌ TOOLS INEXISTANTS (ne pas utiliser) :\n\
            - github_create_repo (n'existe pas, utilise create_github_repo)\n\
            - push_files, sync_files, etc. (n'existent pas, utilise sync_workdir_to_github)\n\
            \n\
            Le workflow s'arrête ici. Vérifie les tools disponibles et recommence.".into()
        );
    }

    // Compter les erreurs répétées avec les mêmes arguments
    let mut error_patterns: HashMap<(String, String, String), usize> = HashMap::new();
    
    for record in recent {
        if let Some(error) = record.result.get("error").and_then(|e| e.as_str()) {
            let key = (
                record.name.clone(),
                normalize_tool_call(&record.name, &record.arguments),
                error.chars().take(100).collect(), // Premières 100 chars de l'erreur
            );
            *error_patterns.entry(key).or_insert(0) += 1;
        }
    }

    // Si un même pattern d'erreur apparaît 2+ fois : stop early
    for ((tool_name, _args, error_prefix), count) in &error_patterns {
        if *count >= 2 {
            // Cas spécial pour get_deployment_logs avec deployment_uuid invalide
            if tool_name == "get_deployment_logs" && (error_prefix.contains("introuvable") || error_prefix.contains("not found")) {
                return Some(
                    "❌ ERREUR CRITIQUE : Tu appelles get_deployment_logs avec un deployment_uuid INVALIDE de manière répétée.\n\
                    \n\
                    ⚠️ INTERDIT : get_deployment_logs avec 'abc123', 'unknown', ou tout UUID inventé.\n\
                    \n\
                    ✅ WORKFLOW CORRECT :\n\
                    1. create_github_repo (si pas encore fait)\n\
                    2. write_project_file ou sync_workdir_to_github\n\
                    3. trigger_deploy (retourne un deployment_uuid réel)\n\
                    4. ENSUITE seulement get_deployment_logs avec le vrai UUID\n\
                    \n\
                    Le workflow s'arrête ici. Suis le workflow correct.".into()
                );
            }

            return Some(format!(
                "❌ ERREUR CRITIQUE : Le tool '{}' échoue de manière répétée avec la même erreur.\n\
                \n\
                Erreur : {}\n\
                \n\
                Le workflow s'arrête ici pour éviter de brûler tous les tours. \
                Analyse l'erreur et corrige ton approche avant de continuer.",
                tool_name,
                error_prefix.chars().take(200).collect::<String>()
            ));
        }
    }

    None
}

/// Normalise les arguments d'un tool call pour détecter les duplicatas.
/// Pour write_project_file, on compare (path, mode).
/// Pour les autres tools, on compare la sérialisation JSON complète.
fn normalize_tool_call(tool_name: &str, args: &Value) -> String {
    if tool_name == "write_project_file" {
        let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
        let mode = args.get("mode").and_then(|v| v.as_str()).unwrap_or("local");
        format!("{path}::{mode}")
    } else {
        // Pour les autres tools, utiliser la sérialisation JSON normalisée
        serde_json::to_string(args).unwrap_or_default()
    }
}

/// Injecte automatiquement les valeurs du contexte dans les arguments du tool call.
/// Ceci garantit que l'agent utilise toujours le bon project_uuid, owner, repo, branch
/// même si le LLM hallucine ou omet ces valeurs.
fn inject_tool_defaults(args: &mut Value, ctx: &AgentChatContext) {
    let Some(obj) = args.as_object_mut() else {
        return;
    };
    
    // TOUJOURS forcer le project_uuid du contexte s'il existe,
    // même si le LLM a fourni une valeur (hallucination possible).
    if let Some(uuid) = &ctx.project_uuid {
        let provided = obj
            .get("project_uuid")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        
        // Si le LLM a fourni un UUID différent, on l'écrase avec celui du contexte.
        // Ceci prévient les hallucinations de UUID (issue #1).
        if provided.is_empty() || provided != uuid {
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
    
    // CRITICAL : Détection template déjà appliqué depuis l'historique
    let has_template_applied = ctx.history.iter().any(|(role, content)| {
        role == "user" && (
            content.contains("Template") && content.contains("déjà appliqué") ||
            content.contains("template") && content.contains("already applied")
        )
    });
    
    let focus = match role {
        "deploy" => {
            let template_nudge = if has_template_applied {
                "\n\n🚨 TEMPLATE DÉJÀ APPLIQUÉ — WORKFLOW LOCAL-FIRST 🚨\n\
                Le workdir contient DÉJÀ tous les fichiers du template.\n\
                \n\
                ✅ WORKFLOW OBLIGATOIRE (PREVIEW LOCALE D'ABORD) :\n\
                1. NE RIEN FAIRE si le template est déjà prêt — l'utilisateur teste la preview\n\
                2. Si des customisations sont demandées : write_project_file mode='local'\n\
                3. Attendre que l'utilisateur VALIDE la preview\n\
                4. SEULEMENT après validation : publish_to_github (crée repo + pousse fichiers + optionnel deploy)\n\
                \n\
                ❌ INTERDIT (l'utilisateur n'a PAS encore validé) :\n\
                - create_github_repo (pas avant validation utilisateur)\n\
                - sync_workdir_to_github (pas avant validation)\n\
                - trigger_deploy (pas avant validation)\n\
                \n\
                Le workflow est LOCAL-FIRST. GitHub/deploy arrive APRÈS validation explicite.\n\n"
            } else {
                "\n\n🎯 WORKFLOW LOCAL-FIRST (pas d'auto-publish) :\n\
                1. Scaffold les fichiers en LOCAL (write_project_file mode='local')\n\
                2. Prépare une preview locale testable\n\
                3. Attendre validation utilisateur\n\
                4. SEULEMENT après validation : publish_to_github\n\n"
            };
            
            format!("Tu es l'agent Deploy : déploiements, logs, smoke HTTP, correction des erreurs de build/déploiement.\n\
             {template_nudge}\
             IMPORTANT : DevForge utilise un workflow LOCAL-FIRST.\n\
             - Les projets sont scaffoldés EN LOCAL\n\
             - L'utilisateur teste via PREVIEW LOCALE\n\
             - La publication GitHub + deploy n'arrive QUE sur validation explicite\n\
             \n\
             TOOLS DISPONIBLES :\n\
             - write_project_file (mode='local') : écrire/modifier des fichiers localement\n\
             - start_local_preview : démarrer le serveur dev pour preview\n\
             - publish_to_github : SEULEMENT sur demande utilisateur (crée repo + pousse + optionnel deploy)\n\
             - trigger_deploy : déployer (après publish_to_github)\n\
             - get_project, get_deployment_logs, http_smoke : diagnostics\n\
             \n\
             ❌ INTERDIT sans validation utilisateur :\n\
             - create_github_repo (remplacé par publish_to_github)\n\
             - sync_workdir_to_github (sauf si utilisateur demande explicitement)\n\
             \n\
             Workflow typique :\n\
             1. Template appliqué → fichiers locaux prêts\n\
             2. Utilisateur teste preview → demande éventuellement des ajustements\n\
             3. write_project_file mode='local' pour customisations\n\
             4. Utilisateur clique « Publier » → tool publish_to_github\n\
             5. Optionnellement trigger_deploy si pas fait auto par publish_to_github\n\
             \n\
             NOTE : Ne crée JAMAIS de repo GitHub avant que l'utilisateur ne le demande explicitement.")
        }
        "reviewer" => {
            "Tu es l'agent Reviewer : risques, qualité, PRs, CI, amélioration continue du code.\n\
             \n\
             WORKFLOW OBLIGATOIRE :\n\
             1. ANALYSER : Utilise get_project, github_list_prs, github_workflow_runs pour évaluer l'état\n\
             2. CORRIGER LES RISQUES : Si tu détectes des problèmes (sécurité, qualité, best practices) :\n\
                - Utilise mcp_call_tool avec MCP GitHub pour créer une branche de correction\n\
                - Applique les corrections nécessaires (update_file, create_file via MCP GitHub)\n\
                - Crée une PR avec analyse détaillée des risques corrigés\n\
                - Si CI échoue, analyse github_workflow_runs et corrige les causes (tests, lint, etc.)\n\
             3. DOCUMENTER : Ajoute des commentaires de review sur les PRs existantes si pertinent\n\
             4. RAPPORTER : Résume les risques identifiés, les corrections appliquées, et les risques résiduels\n\
             \n\
             Agis comme un reviewer senior qui corrige directement les problèmes simples (formatting, imports, typos)\n\
             et propose des PRs pour les problèmes plus complexes. Ne te contente pas de lister les problèmes.".into()
        }
        "ops" => {
            "Tu es l'agent Ops : santé projet, env, MCP, tests, infrastructure, correction des problèmes de configuration.\n\
             \n\
             WORKFLOW OBLIGATOIRE :\n\
             1. DIAGNOSTIQUER : Utilise get_project, list_env_vars, run_application_tests, mcp_list_servers pour l'état actuel\n\
             2. CORRIGER : Si des problèmes sont détectés (env manquantes, tests échouent, MCP mal configuré) :\n\
                - Variables env : utilise upsert_env_var pour ajouter/corriger les variables manquantes\n\
                - Tests échouent : analyse les logs, identifie la cause, utilise mcp_call_tool + MCP GitHub pour corriger le code/config\n\
                - Config MCP : guide l'utilisateur pour configurer les serveurs manquants OU corrige via l'API si possible\n\
                - Dépendances : modifie package.json, Cargo.toml, etc. via MCP GitHub puis crée une PR\n\
             3. VÉRIFIER : Re-lance run_application_tests ou vérifie l'état avec get_project après corrections\n\
             4. RAPPORTER : Résume problèmes détectés, actions effectuées, et état final\n\
             \n\
             IMPORTANT : L'incident popcorn-web était « astro vs @astrojs/tailwind » — tu aurais dû :\n\
             1. Lire package.json via MCP GitHub\n\
             2. Identifier la dépendance incorrecte\n\
             3. Créer une branche + corriger package.json via MCP GitHub\n\
             4. Créer une PR avec description du fix\n\
             5. Vérifier que le build passe après merge\n\
             \n\
             Ne dis JAMAIS « tu devrais mettre à jour package.json » — FAIS-LE via les tools MCP.".into()
        }
        _ => {
            "Tu es un agent DevForge : utilise les tools pour AGIR, pas seulement diagnostiquer.\n\
             \n\
             PRINCIPE GÉNÉRAL :\n\
             - Diagnostique → Propose → Applique → Vérifie → Rapporte\n\
             - Les tools mcp_call_tool + MCP GitHub/devforge permettent de modifier des fichiers, créer des branches/PRs\n\
             - upsert_env_var permet de corriger les variables d'environnement\n\
             - Ne demande confirmation que pour actions destructives/irréversibles ou choix produit ambigus\n\
             - Agis comme un coéquipier autonome, pas comme un assistant passif".into()
        }
    };
    let scoped = if ctx.project_brief.is_some() || ctx.project_uuid.is_some() {
        "\nLe projet courant est déjà fourni dans le contexte système — \
         ne demande PAS de préciser le projet, un UUID, ou « de quoi tu parles ». \
         Réponds directement sur ce projet ; appelle des tools pour approfondir."
    } else {
        ""
    };
    let mcp_guidance = "\n\n\
        UTILISATION DES TOOLS MCP :\n\
        - mcp_list_servers : liste les serveurs MCP configurés (Github, devforge, etc.)\n\
        - mcp_list_remote_tools : liste les tools disponibles sur un serveur MCP (ex: server_id=\"Github\")\n\
        - mcp_call_tool : appelle un tool distant (ex: create_branch, update_file, create_pull_request sur MCP GitHub)\n\
        \n\
        Pour corriger du code via GitHub :\n\
        1. mcp_list_servers pour confirmer que \"Github\" est disponible\n\
        2. mcp_list_remote_tools avec server_id=\"Github\" pour voir les tools (create_branch, get_file_contents, create_or_update_file, create_pull_request, etc.)\n\
        3. Lire le fichier actuel : mcp_call_tool avec tool=\"get_file_contents\" et arguments={\"owner\":..., \"repo\":..., \"path\":..., \"ref\":...}\n\
        4. Créer une branche : mcp_call_tool avec tool=\"create_branch\" et arguments={\"owner\":..., \"repo\":..., \"branch\":\"fix/...\", \"from_branch\":\"main\"}\n\
        5. Modifier le fichier : mcp_call_tool avec tool=\"create_or_update_file\" et arguments={\"owner\":..., \"repo\":..., \"path\":..., \"content\":..., \"message\":\"fix: ...\", \"branch\":\"fix/...\"}\n\
        6. Créer une PR : mcp_call_tool avec tool=\"create_pull_request\" et arguments={\"owner\":..., \"repo\":..., \"title\":..., \"body\":..., \"head\":\"fix/...\", \"base\":\"main\"}\n\
        \n\
        Toujours utiliser les valeurs owner/repo du contexte projet si disponibles.";
    format!(
        "Tu es {name} ({role}) sur DevForge. {focus}{scoped}{mcp_guidance}\n\
         Réponds en français, de façon concrète et orientée ACTION. N'invente pas de résultats."
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
        async fn trigger_deploy(
            &self,
            _project_uuid: &str,
            _git_sha: Option<String>,
            _message: &str,
        ) -> Result<Value> {
            Ok(json!({
                "ok": false,
                "error": "trigger_deploy n'est pas implémenté dans le stub de test"
            }))
        }
    }

    #[tokio::test]
    async fn stub_tests_message_runs_tool() {
        let deploy = Arc::new(DeployFacade::new(Arc::new(StubRemoteExecutor::new())));
        let github = Arc::new(GitHubFacade::new(Arc::new(StubGitHubClient), "off"));
        let mcp = Arc::new(McpFacade::stub());
        let env = Arc::new(EnvFacade::new(Arc::new(MemoryEnvStore::new())));
        let pool = Arc::new(
            sqlx::SqlitePool::connect(":memory:")
                .await
                .expect("memory pool"),
        );
        let registry = Arc::new(build_core_registry(
            deploy,
            github,
            Arc::new(MemStore),
            mcp,
            env,
            pool,
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

    #[test]
    fn test_detect_duplicate_calls_no_duplicates() {
        let records = vec![
            ToolCallRecord {
                name: "list_projects".into(),
                arguments: json!({}),
                result: json!({"ok": true}),
            },
            ToolCallRecord {
                name: "get_project".into(),
                arguments: json!({"project_uuid": "abc123"}),
                result: json!({"ok": true}),
            },
        ];
        let nudge = detect_duplicate_calls(&records);
        assert!(nudge.is_none(), "Pas de nudge attendu quand il n'y a pas de duplicatas");
    }

    #[test]
    fn test_detect_duplicate_calls_write_project_file() {
        let records = vec![
            ToolCallRecord {
                name: "write_project_file".into(),
                arguments: json!({"path": "README.md", "mode": "local", "content": "v1"}),
                result: json!({"ok": true}),
            },
            ToolCallRecord {
                name: "write_project_file".into(),
                arguments: json!({"path": "README.md", "mode": "local", "content": "v2"}),
                result: json!({"ok": true}),
            },
            ToolCallRecord {
                name: "write_project_file".into(),
                arguments: json!({"path": "README.md", "mode": "local", "content": "v3"}),
                result: json!({"ok": true}),
            },
        ];
        let nudge = detect_duplicate_calls(&records);
        assert!(nudge.is_some(), "Nudge attendu pour 3 appels identiques write_project_file");
        let msg = nudge.unwrap();
        assert!(msg.contains("DÉTECTION DE BOUCLE"), "Message doit contenir DÉTECTION DE BOUCLE");
        assert!(msg.contains("write_project_file"), "Message doit mentionner write_project_file");
    }

    #[test]
    fn test_detect_duplicate_calls_different_paths() {
        let records = vec![
            ToolCallRecord {
                name: "write_project_file".into(),
                arguments: json!({"path": "README.md", "mode": "local"}),
                result: json!({"ok": true}),
            },
            ToolCallRecord {
                name: "write_project_file".into(),
                arguments: json!({"path": "package.json", "mode": "local"}),
                result: json!({"ok": true}),
            },
        ];
        let nudge = detect_duplicate_calls(&records);
        assert!(nudge.is_none(), "Pas de nudge attendu quand les paths sont différents");
    }

    #[test]
    fn test_detect_repeated_failures_unknown_tools() {
        let records = vec![
            ToolCallRecord {
                name: "github_create_repo".into(),
                arguments: json!({"repo_name": "test"}),
                result: json!({"ok": false, "error": "Unknown tool: github_create_repo"}),
            },
            ToolCallRecord {
                name: "list_projects".into(),
                arguments: json!({}),
                result: json!({"ok": true}),
            },
            ToolCallRecord {
                name: "push_files".into(),
                arguments: json!({}),
                result: json!({"ok": false, "error": "Unknown tool: push_files"}),
            },
        ];
        let msg = detect_repeated_failures(&records);
        assert!(msg.is_some(), "Devrait détecter 2 unknown tools");
        let msg_text = msg.unwrap();
        assert!(msg_text.contains("ERREUR CRITIQUE"), "Message doit contenir ERREUR CRITIQUE");
        assert!(msg_text.contains("INEXISTANTS"), "Message doit mentionner tools inexistants");
        assert!(msg_text.contains("create_github_repo"), "Message doit lister le bon tool");
    }

    #[test]
    fn test_detect_repeated_failures_deployment_logs_invalid() {
        let records = vec![
            ToolCallRecord {
                name: "get_deployment_logs".into(),
                arguments: json!({"deployment_uuid": "abc123"}),
                result: json!({"ok": false, "error": "Déploiement introuvable : abc123"}),
            },
            ToolCallRecord {
                name: "get_project".into(),
                arguments: json!({"project_uuid": "real-uuid"}),
                result: json!({"ok": true}),
            },
            ToolCallRecord {
                name: "get_deployment_logs".into(),
                arguments: json!({"deployment_uuid": "abc123"}),
                result: json!({"ok": false, "error": "Déploiement introuvable : abc123"}),
            },
        ];
        let msg = detect_repeated_failures(&records);
        assert!(msg.is_some(), "Devrait détecter get_deployment_logs avec UUID invalide répété");
        let msg_text = msg.unwrap();
        assert!(msg_text.contains("ERREUR CRITIQUE"), "Message doit contenir ERREUR CRITIQUE");
        assert!(msg_text.contains("deployment_uuid INVALIDE"), "Message doit mentionner UUID invalide");
    }

    #[test]
    fn test_detect_repeated_failures_no_failures() {
        let records = vec![
            ToolCallRecord {
                name: "list_projects".into(),
                arguments: json!({}),
                result: json!({"ok": true}),
            },
            ToolCallRecord {
                name: "get_project".into(),
                arguments: json!({"project_uuid": "abc123"}),
                result: json!({"ok": true}),
            },
        ];
        let msg = detect_repeated_failures(&records);
        assert!(msg.is_none(), "Pas de message si aucun échec");
    }

    #[test]
    fn test_normalize_tool_call_write_project_file() {
        let args1 = json!({"path": "src/index.js", "mode": "local", "content": "console.log('hello')"});
        let args2 = json!({"path": "src/index.js", "mode": "local", "content": "console.log('world')"});
        let args3 = json!({"path": "src/index.js", "mode": "github", "content": "console.log('hello')"});
        
        let norm1 = normalize_tool_call("write_project_file", &args1);
        let norm2 = normalize_tool_call("write_project_file", &args2);
        let norm3 = normalize_tool_call("write_project_file", &args3);
        
        // Même path+mode = même normalisation (le content est ignoré)
        assert_eq!(norm1, norm2, "Même path+mode doit donner même normalisation");
        // Différent mode = différente normalisation
        assert_ne!(norm1, norm3, "Modes différents doivent donner normalisations différentes");
    }
}
