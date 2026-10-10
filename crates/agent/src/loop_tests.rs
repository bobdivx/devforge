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

// ---------------------------------------------------------------------------
// Plafond de pushes par run + événements P2 (streaming, libellés, jalons).
// ---------------------------------------------------------------------------

#[tokio::test]
async fn push_cap_stops_the_run_and_asks_the_user() {
    let mut reg = ToolRegistry::new();
    reg.set_publish_gate(Arc::new(guard::StaticGate(true)));
    let sync = spy(&mut reg, "sync_workdir_to_github", json!({"ok": true}));
    let mut turns: Vec<AssistantTurn> = (0..6)
        .map(|i| {
            ScriptedLlmProvider::tool(
                &format!("c{i}"),
                "sync_workdir_to_github",
                json!({"commit_message": format!("fix: resynchroniser package-lock.json #{i}")}),
            )
        })
        .collect();
    turns.push(ScriptedLlmProvider::text("Fini."));
    let (reply, llm) = run(reg, turns, "Publication validée, continue.", ctx("coordinator")).await;
    assert_eq!(sync.load(Ordering::SeqCst), guard::MAX_PUSHES_PER_RUN, "3 pushes maximum");
    let last = reply.tool_calls.last().unwrap();
    assert_eq!(last.result["kind"], guard::PUSH_LIMIT_KIND);
    assert_eq!(last.result["needs_user_action"], true);
    assert!(reply.reply.contains("3 fois"), "{}", reply.reply);
    // Le run s'arrête net : plus aucun appel au modèle après le refus.
    assert_eq!(llm.requests().len(), guard::MAX_PUSHES_PER_RUN + 1);
}

#[tokio::test]
async fn non_push_remote_writes_do_not_count_toward_the_cap() {
    let mut reg = ToolRegistry::new();
    reg.set_publish_gate(Arc::new(guard::StaticGate(true)));
    let deploy = spy(&mut reg, "trigger_deploy", json!({"ok": true}));
    let sync = spy(&mut reg, "sync_workdir_to_github", json!({"ok": true}));
    let turns = vec![
        ScriptedLlmProvider::tool("d1", "trigger_deploy", json!({"n": 1})),
        ScriptedLlmProvider::tool("d2", "trigger_deploy", json!({"n": 2})),
        ScriptedLlmProvider::tool("d3", "trigger_deploy", json!({"n": 3})),
        ScriptedLlmProvider::tool("s1", "sync_workdir_to_github", json!({"commit_message": "a"})),
        ScriptedLlmProvider::text("ok"),
    ];
    let (reply, _) = run(reg, turns, "Publication validée, continue.", ctx("coordinator")).await;
    assert_eq!(deploy.load(Ordering::SeqCst), 3);
    assert_eq!(sync.load(Ordering::SeqCst), 1);
    assert_eq!(reply.reply, "ok");
}

async fn run_events(reg: ToolRegistry, turns: Vec<AssistantTurn>, message: &str) -> (AgentReply, Vec<AgentEvent>) {
    let llm = Arc::new(ScriptedLlmProvider::new(turns));
    let runner = AgentRunner::with_llm(Arc::new(reg), llm, "scripted");
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let reply = runner.handle_with_progress(message, None, None, ctx("coordinator"), Some(tx)).await.unwrap();
    let mut events = Vec::new();
    while let Ok(e) = rx.try_recv() {
        events.push(e);
    }
    (reply, events)
}

#[tokio::test]
async fn intermediate_text_is_reset_and_final_text_is_streamed() {
    let mut reg = ToolRegistry::new();
    spy(&mut reg, "read_project_file", json!({"ok": true, "content": "x"}));
    let mut t1 = ScriptedLlmProvider::tool("r1", "read_project_file", json!({"path": "src/app.ts"}));
    t1.content = "Je lis le fichier d'abord.".into();
    let turns = vec![t1, ScriptedLlmProvider::text("Le fichier est correct.")];
    let (reply, events) = run_events(reg, turns, "Où en est app.ts ?").await;
    assert_eq!(reply.reply, "Le fichier est correct.");
    let kinds: Vec<String> = events
        .iter()
        .map(|e| serde_json::to_value(e).unwrap()["type"].as_str().unwrap().to_string())
        .collect();
    let pos = |k: &str| kinds.iter().position(|x| x == k).unwrap_or_else(|| panic!("{k} absent: {kinds:?}"));
    assert!(pos("delta") < pos("delta_reset"));
    assert!(pos("delta_reset") < pos("tool_start"));
    let resets: Vec<usize> = events
        .iter()
        .filter_map(|e| match e {
            AgentEvent::DeltaReset { round } => Some(*round),
            _ => None,
        })
        .collect();
    assert_eq!(resets, vec![1], "seul le tour à outils est remis à zéro");
    let final_text: String = events
        .iter()
        .filter_map(|e| match e {
            AgentEvent::Delta { text, round: 2 } => Some(text.clone()),
            _ => None,
        })
        .collect();
    assert_eq!(final_text, "Le fichier est correct.");
    // Pas de réflexion en double : le texte streamé n'est pas renvoyé en `detail`.
    assert!(events.iter().all(|e| !matches!(e, AgentEvent::Thinking { detail, .. } if detail.contains("Je lis"))));
    let start = events.iter().find_map(|e| match e {
        AgentEvent::ToolStart { label, .. } => Some(label.clone()),
        _ => None,
    });
    assert_eq!(start.as_deref(), Some("Lecture de src/app.ts"));
    let summary = events.iter().find_map(|e| match e {
        AgentEvent::ToolDone { summary, .. } => Some(summary.clone()),
        _ => None,
    });
    assert!(summary.unwrap().starts_with("✓ Lecture de src/app.ts · "));
}

#[tokio::test]
async fn milestones_are_emitted_and_closed() {
    let mut reg = ToolRegistry::new();
    spy(&mut reg, "write_project_file", json!({"ok": true, "mode": "local"}));
    let turns = vec![
        ScriptedLlmProvider::tool("w1", "write_project_file", json!({"path": "a.ts", "content": "x", "mode": "local"})),
        ScriptedLlmProvider::text("Modifié en local."),
    ];
    let (_reply, events) = run_events(reg, turns, "Corrige a.ts").await;
    let ms: Vec<(String, MilestoneStatus)> = events
        .iter()
        .filter_map(|e| match e {
            AgentEvent::Milestone { label, status } => Some((label.clone(), *status)),
            _ => None,
        })
        .collect();
    assert_eq!(
        ms,
        vec![
            (events::MILESTONE_FILES.to_string(), MilestoneStatus::Running),
            (events::MILESTONE_FILES.to_string(), MilestoneStatus::Done),
        ]
    );
}

#[test]
fn every_event_variant_round_trips() {
    let all = vec![
        AgentEvent::RunStarted { run_uuid: "r".into(), message_uuid: "m".into() },
        AgentEvent::Ack { text: "Je regarde.".into() },
        AgentEvent::Thinking { round: 1, label: "Analyse".into(), detail: String::new() },
        AgentEvent::Delta { text: "Bon".into(), round: 1 },
        AgentEvent::DeltaReset { round: 1 },
        AgentEvent::ToolStart { id: "c".into(), name: "x".into(), arguments: json!({}), label: "X".into() },
        AgentEvent::ToolDone {
            id: "c".into(),
            name: "x".into(),
            ok: true,
            arguments: json!({}),
            result: json!({"ok": true}),
            elapsed_ms: 5,
            summary: "✓ X · 5 ms".into(),
        },
        AgentEvent::Plan { title: "P".into(), summary: String::new(), steps: vec!["a".into()] },
        AgentEvent::Reply { content: "ok".into(), provider: "stub".into(), tool_calls: vec![] },
        AgentEvent::Milestone { label: "Build".into(), status: MilestoneStatus::Done },
        AgentEvent::Error { message: "boom".into(), retryable: true },
    ];
    let expected_types = [
        "run_started", "ack", "thinking", "delta", "delta_reset", "tool_start", "tool_done", "plan", "reply",
        "milestone", "error",
    ];
    for (ev, ty) in all.iter().zip(expected_types) {
        let v = serde_json::to_value(ev).unwrap();
        assert_eq!(v["type"], ty);
        let back: AgentEvent = serde_json::from_value(v.clone()).unwrap();
        assert_eq!(serde_json::to_value(&back).unwrap(), v, "{ty}");
    }
    assert_eq!(serde_json::to_value(&all[9]).unwrap()["status"], "done");
    // Anciens flux : milestone sans status, error sans retryable.
    let m: AgentEvent = serde_json::from_value(json!({"type": "milestone", "label": "x"})).unwrap();
    assert!(matches!(m, AgentEvent::Milestone { status: MilestoneStatus::Running, .. }));
    let e: AgentEvent = serde_json::from_value(json!({"type": "error", "message": "x"})).unwrap();
    assert!(matches!(e, AgentEvent::Error { retryable: false, .. }));
}
