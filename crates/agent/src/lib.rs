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
    McpCallTool, McpListRemoteToolsTool, McpListServersTool, ReadGitHubFileTool,
    RunApplicationTestsTool, TriggerDeployTool, UpsertEnvVarTool, WriteProjectFileTool,
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
        deploy,
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
    registry.register(Arc::new(UpsertEnvVarTool { env }));
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
        github,
        mcp,
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
            "Tu es l'agent Deploy : déploiements, logs, smoke HTTP, correction des erreurs de build/déploiement.\n\
             \n\
             WORKFLOW OBLIGATOIRE :\n\
             1. DIAGNOSTIQUER : Utilise get_project, get_deployment_logs, http_smoke pour comprendre le problème\n\
             2. CORRIGER : Si tu identifies la cause (ex: dépendance manquante, config incorrecte) :\n\
                - Utilise mcp_call_tool avec le serveur MCP GitHub (ou devforge si disponible) pour modifier les fichiers nécessaires\n\
                - Crée une branche de correction (create_branch via MCP GitHub)\n\
                - Modifie les fichiers problématiques (create_or_update_file via MCP GitHub)\n\
                - Crée une PR avec description claire du problème et de la solution (create_pull_request via MCP GitHub)\n\
                - Re-teste avec http_smoke ou run_application_tests après déploiement\n\
             3. VÉRIFIER : Confirme que la correction fonctionne avec get_deployment_logs ou http_smoke\n\
             4. RAPPORTER : Résume le problème, la solution appliquée, et le résultat de la vérification\n\
             \n\
             NE te limite JAMAIS à dire « tu devrais modifier X » — APPLIQUE la correction si les tools le permettent.\n\
             Demande à l'utilisateur UNIQUEMENT si :\n\
             - Des secrets/credentials manquent (ex: MCP GitHub non configuré)\n\
             - L'action est destructive et irréversible (ex: supprimer une base de données)\n\
             - Plusieurs solutions techniques équivalentes existent et le choix a un impact produit\n\
             \n\
             SCAFFOLD DEPUIS PROMPT (builder slices 1+2+3) :\n\
             Si tu dois scaffolder un nouveau projet depuis un prompt utilisateur :\n\
             1. CRÉER LE REPO : utilise create_github_repo pour créer le dépôt GitHub et l'attacher au projet\n\
                - Fonctionne avec le token GitHub configuré dans Settings (pas besoin de MCP GitHub)\n\
             2. ÉCRIRE LES FICHIERS : utilise write_project_file (PRÉFÈRE mode='local') pour créer les fichiers initiaux\n\
                - mode='local' (PRÉFÉRÉ) : rapide, écrit dans le workdir local, permet commits/push manuels après\n\
                - mode='github' : pousse directement sur GitHub avec commit automatique (si nécessaire)\n\
                - Les deux modes fonctionnent avec le token GitHub instance (pas besoin de MCP GitHub)\n\
             3. CONFIGURER : ajoute les variables d'environnement nécessaires avec upsert_env_var\n\
             4. DÉPLOYER : utilise trigger_deploy pour lancer le premier déploiement automatique\n\
                - Pré-requis : git_repository configuré (fait par create_github_repo), workdir défini, fichiers écrits\n\
                - Le déploiement synchronise le repo Git, build selon build_pack (nixpacks/dockerfile/static), et démarre le conteneur\n\
                - Vérifie le statut avec get_deployment_logs après déclenchement\n\
             \n\
             Exemple workflow scaffold complet :\n\
             - create_github_repo → write_project_file(mode='local') × N → git commit + push (optionnel) → upsert_env_var (si nécessaire) → trigger_deploy → get_deployment_logs → http_smoke\n\
             \n\
             NOTE IMPORTANTE : create_github_repo et write_project_file fonctionnent maintenant avec le token GitHub instance.\n\
             Le MCP GitHub n'est plus requis pour ces opérations de base."
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
             et propose des PRs pour les problèmes plus complexes. Ne te contente pas de lister les problèmes."
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
             Ne dis JAMAIS « tu devrais mettre à jour package.json » — FAIS-LE via les tools MCP."
        }
        _ => {
            "Tu es un agent DevForge : utilise les tools pour AGIR, pas seulement diagnostiquer.\n\
             \n\
             PRINCIPE GÉNÉRAL :\n\
             - Diagnostique → Propose → Applique → Vérifie → Rapporte\n\
             - Les tools mcp_call_tool + MCP GitHub/devforge permettent de modifier des fichiers, créer des branches/PRs\n\
             - upsert_env_var permet de corriger les variables d'environnement\n\
             - Ne demande confirmation que pour actions destructives/irréversibles ou choix produit ambigus\n\
             - Agis comme un coéquipier autonome, pas comme un assistant passif"
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
}
