//! Tests de la boucle agent : garde de publication, affirmations, rôles, troncature (P1).

use super::*;
use devforge_llm::ScriptedLlmProvider;
use std::sync::atomic::{AtomicUsize, Ordering};

struct Spy {
    name: &'static str,
    calls: Arc<AtomicUsize>,
    result: Value,
}

#[async_trait]
impl Tool for Spy {
    fn name(&self) -> &str {
        self.name
    }
    fn description(&self) -> &str {
        "espion"
    }
    fn parameters(&self) -> Value {
        json!({"type": "object", "properties": {"project_uuid": {"type": "string"}}})
    }
    async fn execute(&self, _arguments: Value) -> Result<Value> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(self.result.clone())
    }
}

fn spy(reg: &mut ToolRegistry, name: &'static str, result: Value) -> Arc<AtomicUsize> {
    let calls = Arc::new(AtomicUsize::new(0));
    reg.register(Arc::new(Spy { name, calls: calls.clone(), result }));
    calls
}

fn ctx(role: &str) -> AgentChatContext {
    AgentChatContext {
        project_uuid: Some("proj-1".into()),
        agent_uuid: Some("agent-1".into()),
        agent_role: Some(role.into()),
        ..Default::default()
    }
}

async fn run(
    reg: ToolRegistry,
    turns: Vec<AssistantTurn>,
    message: &str,
    c: AgentChatContext,
) -> (AgentReply, Arc<ScriptedLlmProvider>) {
    let llm = Arc::new(ScriptedLlmProvider::new(turns));
    let runner = AgentRunner::with_llm(Arc::new(reg), llm.clone(), "scripted");
    let reply = runner.handle_with_context(message, None, None, c).await.unwrap();
    (reply, llm)
}

#[tokio::test]
async fn remote_writes_are_blocked_without_grant() {
    let mut reg = ToolRegistry::new();
    reg.set_publish_gate(Arc::new(guard::StaticGate(false)));
    let fix = spy(&mut reg, "create_github_fix", json!({"ok": true}));
    let sync = spy(&mut reg, "sync_workdir_to_github", json!({"ok": true}));
    let mcp = spy(&mut reg, "mcp_call_tool", json!({"ok": true}));
    let turns = vec![
        ScriptedLlmProvider::tool("c1", "create_github_fix", json!({"title": "x"})),
        ScriptedLlmProvider::tool("c2", "sync_workdir_to_github", json!({})),
        ScriptedLlmProvider::tool("c3", "mcp_call_tool", json!({"server_id": "github", "tool": "create_pull_request"})),
        ScriptedLlmProvider::text("Je suis prêt à publier, valide pour continuer."),
    ];
    let (reply, _) = run(reg, turns, "Validé", ctx("coordinator")).await;
    assert_eq!(fix.load(Ordering::SeqCst), 0);
    assert_eq!(sync.load(Ordering::SeqCst), 0);
    assert_eq!(mcp.load(Ordering::SeqCst), 0);
    assert_eq!(reply.tool_calls.len(), 3);
    for r in &reply.tool_calls {
        assert_eq!(r.result["code"], "publish_approval_required", "{}", r.name);
        assert_eq!(r.result["needs_user_action"], true);
    }
}

#[tokio::test]
async fn registry_without_gate_fails_closed() {
    let mut reg = ToolRegistry::new();
    let deploy = spy(&mut reg, "trigger_deploy", json!({"ok": true}));
    let turns = vec![ScriptedLlmProvider::tool("c1", "trigger_deploy", json!({})), ScriptedLlmProvider::text("Bloqué.")];
    let (reply, _) = run(reg, turns, "déploie en prod", ctx("coordinator")).await;
    assert_eq!(deploy.load(Ordering::SeqCst), 0);
    assert_eq!(reply.tool_calls[0].result["code"], "publish_approval_required");
}

#[tokio::test]
async fn grant_lets_the_agent_publish_and_requires_a_smoke_check() {
    let mut reg = ToolRegistry::new();
    reg.set_publish_gate(Arc::new(guard::StaticGate(true)));
    let deploy = spy(&mut reg, "trigger_deploy", json!({"ok": true, "deployment_uuid": "d1"}));
    let turns = vec![
        ScriptedLlmProvider::tool("c1", "trigger_deploy", json!({})),
        ScriptedLlmProvider::text("Déploiement lancé, vérification en cours."),
    ];
    let (_reply, llm) = run(reg, turns, "Publication validée, continue.", ctx("coordinator")).await;
    assert_eq!(deploy.load(Ordering::SeqCst), 1);
    let last = llm.requests().pop().unwrap();
    assert!(
        last.messages.iter().any(|m| m.content.contains("http_smoke sur production_url")),
        "le rappel post-déploiement doit être injecté"
    );
}

#[tokio::test]
async fn spec_refusal_stays_first_even_with_grant() {
    let mut reg = ToolRegistry::new();
    reg.set_publish_gate(Arc::new(guard::StaticGate(true)));
    let repo = spy(&mut reg, "create_github_repo", json!({"ok": true}));
    let turns = vec![ScriptedLlmProvider::tool("c1", "create_github_repo", json!({})), ScriptedLlmProvider::text("Spec en cours.")];
    let (reply, _) = run(reg, turns, "SDD-IMPLEMENT:page:attempt=1\nÉcris la page.", ctx("custom")).await;
    assert_eq!(repo.load(Ordering::SeqCst), 0);
    assert!(reply.tool_calls[0].result["error"].as_str().unwrap().contains("Interdit pendant la spec"));
}

#[tokio::test]
async fn local_write_is_never_gated() {
    let mut reg = ToolRegistry::new();
    reg.set_publish_gate(Arc::new(guard::StaticGate(false)));
    let write = spy(&mut reg, "write_project_file", json!({"ok": true, "mode": "local"}));
    let turns = vec![
        ScriptedLlmProvider::tool("c1", "write_project_file", json!({"path": "a.txt", "content": "x", "mode": "local"})),
        ScriptedLlmProvider::text("a.txt écrit (preview à lancer)."),
    ];
    let (reply, _) = run(reg, turns, "ne publie pas, corrige juste en local", ctx("coordinator")).await;
    assert_eq!(write.load(Ordering::SeqCst), 1);
    assert!(reply.executed_plan);
}

#[tokio::test]
async fn claim_without_tool_gets_one_nudge() {
    let reg = ToolRegistry::new();
    let turns = vec![
        ScriptedLlmProvider::text("Le plan a été exécuté en local."),
        ScriptedLlmProvider::text("Déjà fait au tour précédent (index.astro écrit, preview OK)."),
    ];
    let (reply, llm) = run(reg, turns, "Go", ctx("coordinator")).await;
    assert!(reply.reply.starts_with("Déjà fait au tour précédent"));
    let reqs = llm.requests();
    assert_eq!(reqs.len(), 2);
    assert!(reqs[1].messages.iter().any(|m| m.content == claims::CLAIM_NUDGE));
}

#[tokio::test]
async fn repeated_claim_is_flagged_unverified() {
    let reg = ToolRegistry::new();
    let turns = vec![
        ScriptedLlmProvider::text("J'ai corrigé le header."),
        ScriptedLlmProvider::text("J'ai corrigé le header, c'est fait."),
    ];
    let (reply, _) = run(reg, turns, "Go", ctx("coordinator")).await;
    assert!(reply.reply.starts_with(claims::UNVERIFIED_PREFIX), "{}", reply.reply);
}

#[tokio::test]
async fn plain_answer_is_not_nudged() {
    let reg = ToolRegistry::new();
    let turns = vec![ScriptedLlmProvider::text("Je vais lire le fichier puis corriger le header.")];
    let (reply, llm) = run(reg, turns, "que proposes-tu ?", ctx("coordinator")).await;
    assert_eq!(llm.requests().len(), 1);
    assert!(reply.reply.starts_with("Je vais"));
}

#[tokio::test]
async fn ops_does_not_see_or_run_write_tools() {
    let mut reg = ToolRegistry::new();
    reg.set_publish_gate(Arc::new(guard::StaticGate(true)));
    let write = spy(&mut reg, "write_project_file", json!({"ok": true}));
    let _smoke = spy(&mut reg, "http_smoke", json!({"ok": true}));
    let turns = vec![
        ScriptedLlmProvider::tool("c1", "write_project_file", json!({"path": "a", "content": "b"})),
        ScriptedLlmProvider::text("Hors de mon rôle."),
    ];
    let (reply, llm) = run(reg, turns, "corrige le header", ctx("ops")).await;
    let first = &llm.requests()[0];
    let names: Vec<&str> = first.tools.iter().map(|t| t.name.as_str()).collect();
    assert!(!names.contains(&"write_project_file"), "{names:?}");
    assert!(names.contains(&"http_smoke"));
    assert_eq!(write.load(Ordering::SeqCst), 0);
    assert_eq!(reply.tool_calls[0].result["code"], "tool_not_available_for_role");
}

#[tokio::test]
async fn tool_results_sent_to_model_are_truncated_but_records_keep_everything() {
    let mut reg = ToolRegistry::new();
    let logs = format!("{}\nERREUR FINALE", "ligne de log\n".repeat(20_000));
    let _l = spy(&mut reg, "get_deployment_logs", json!({"ok": true, "logs": logs.clone()}));
    let turns = vec![
        ScriptedLlmProvider::tool("c1", "get_deployment_logs", json!({})),
        ScriptedLlmProvider::text("Le build casse : ERREUR FINALE."),
    ];
    let (reply, llm) = run(reg, turns, "logs", ctx("coordinator")).await;
    assert_eq!(reply.tool_calls[0].result["logs"].as_str().unwrap().len(), logs.len());
    let second = &llm.requests()[1];
    let tool_msg = second.messages.iter().find(|m| m.role == devforge_llm::Role::Tool).unwrap();
    assert!(tool_msg.content.chars().count() <= truncate::TOOL_RESULT_BUDGET);
    assert!(tool_msg.content.contains("ERREUR FINALE"));
}

#[tokio::test]
async fn string_steps_are_coerced_for_propose_plan() {
    let mut reg = ToolRegistry::new();
    reg.register(Arc::new(tools::ProposePlanTool));
    let steps = "[Lire le fichier package.json, Exécuter npm install, Vérifier le lockfile, Lancer la preview, Demander la validation]";
    let turns = vec![
        ScriptedLlmProvider::tool("c1", "propose_plan", json!({"title": "Lockfile", "steps": steps})),
        ScriptedLlmProvider::text("Plan prêt : 5 étapes."),
    ];
    let (reply, _) = run(reg, turns, "analyse le lockfile", ctx("coordinator")).await;
    let r = &reply.tool_calls[0].result;
    assert_eq!(r["ok"], true, "{r}");
    assert_eq!(r["plan"]["steps"].as_array().unwrap().len(), 5);
}

#[tokio::test]
async fn forced_remote_tool_is_gated_too() {
    let mut reg = ToolRegistry::new();
    reg.set_publish_gate(Arc::new(guard::StaticGate(false)));
    let fix = spy(&mut reg, "create_github_fix", json!({"ok": true}));
    let runner = AgentRunner::with_llm(Arc::new(reg), Arc::new(ScriptedLlmProvider::new(vec![])), "scripted");
    let reply = runner
        .handle_with_context("x", Some("create_github_fix"), Some(json!({})), ctx("coordinator"))
        .await
        .unwrap();
    assert_eq!(fix.load(Ordering::SeqCst), 0);
    assert_eq!(reply.tool_calls[0].result["code"], "publish_approval_required");
}

#[test]
fn prompt_has_format_block_and_respects_negation() {
    let c = ctx("coordinator");
    let p = system_prompt(&c, "ne publie pas, corrige juste en local");
    assert!(p.contains("FORMAT DE RÉPONSE"));
    assert!(p.contains("AUTONOMIE"));
    assert!(p.contains("NE PAS publier"));
    assert!(!p.contains("Tu PEUX maintenant"));
    let p = system_prompt(&c, "Validé");
    assert!(p.contains("demande une publication"));
    assert!(p.contains("verrouillées côté serveur"));
}

#[test]
fn prompt_tools_follow_role() {
    let ops = system_prompt(&ctx("ops"), "état du projet ?");
    assert!(!ops.contains("write_project_file (mode=local)"), "{ops}");
    assert!(ops.contains("délègue au Coordinateur"));
    let coord = system_prompt(&ctx("coordinator"), "état du projet ?");
    assert!(coord.contains("write_project_file (mode=local)"));
    for role in ["coordinator", "deploy", "ops", "reviewer", "runner", "actions", "crons", "custom"] {
        let p = system_prompt(&ctx(role), "bonjour");
        assert!(p.contains("FORMAT DE RÉPONSE"), "{role}");
        assert!(p.chars().count() < 9_000, "{role}: prompt trop long");
    }
}

#[tokio::test]
async fn role_lists_match_the_core_registry() {
    use devforge_deploy::{DeployFacade, StubRemoteExecutor};
    use devforge_env::{EnvFacade, MemoryEnvStore};
    use devforge_github::{GitHubFacade, StubGitHubClient};

    struct NoStore;
    #[async_trait]
    impl ProjectStore for NoStore {
        async fn list_projects(&self) -> Result<Vec<Value>> { Ok(vec![]) }
        async fn get_project(&self, _: &str) -> Result<Option<Value>> { Ok(None) }
        async fn resolve_project(&self, _: &str) -> Result<Option<ProjectTestContext>> { Ok(None) }
        async fn deployment_logs(&self, _: &str) -> Result<Value> { Ok(json!({})) }
        async fn list_deployments(&self, _: &str) -> Result<Value> { Ok(json!({})) }
        async fn cancel_deployment(&self, _: &str) -> Result<Value> { Ok(json!({})) }
        async fn trigger_deploy(&self, _: &str, _: Option<String>, _: &str) -> Result<Value> { Ok(json!({})) }
    }
    let pool = sqlx::postgres::PgPoolOptions::new()
        .connect_lazy("postgres://devforge:devforge@127.0.0.1:1/none")
        .unwrap();
    let reg = build_core_registry(
        Arc::new(DeployFacade::new(Arc::new(StubRemoteExecutor::new()))),
        Arc::new(GitHubFacade::new(Arc::new(StubGitHubClient), "off")),
        Arc::new(NoStore),
        Arc::new(devforge_mcp::McpFacade::stub()),
        Arc::new(EnvFacade::new(Arc::new(MemoryEnvStore::new()))),
        Arc::new(pool),
    );
    let names = reg.names();
    let mut expected: Vec<String> = roles::ALL_TOOLS.iter().map(|s| s.to_string()).collect();
    expected.sort();
    assert_eq!(names, expected);
    assert!(reg.gate.is_some(), "le registre cœur doit avoir un gate de publication");
}
