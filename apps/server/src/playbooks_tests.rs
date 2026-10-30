//! Modèles d'agents : catalogue, carte live (étapes, workers, compteurs), journal.

use serde_json::{json, Value};

use crate::playbooks::*;

fn run(status: &str) -> RunLite {
    RunLite {
        uuid: "r1".into(),
        status: status.into(),
        title: Some("/deploy-verify · Déployer & vérifier".into()),
        agent_name: Some("Braise".into()),
        ..Default::default()
    }
}

fn ev(run: &str, ty: &str, payload: Value) -> EventLite {
    EventLite {
        run_uuid: run.into(),
        ty: ty.into(),
        payload,
    }
}

fn decision(run: &str, step: i64, outcome: &str, evidence: &str) -> EventLite {
    ev(
        run,
        "tool_done",
        json!({
            "type": "tool_done", "id": format!("d{step}"), "name": "record_decision", "ok": true,
            "arguments": {},
            "result": {"ok": true, "decision": {
                "what": format!("étape {step}"), "why": "parce que", "evidence": evidence,
                "outcome": outcome, "step": step,
            }},
        }),
    )
}

fn states(v: &Value) -> Vec<String> {
    v["steps"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["state"].as_str().unwrap().to_string())
        .collect()
}

#[test]
fn catalog_has_three_fixed_steps_a_rule_and_unique_commands() {
    assert!(PLAYBOOKS.len() >= 5);
    let mut ids = std::collections::HashSet::new();
    let mut slashes = std::collections::HashSet::new();
    for p in PLAYBOOKS {
        assert!(ids.insert(p.id), "id en double {}", p.id);
        assert!(slashes.insert(p.slash), "commande en double {}", p.slash);
        assert!(p.slash.starts_with('/'));
        assert!(p.steps.iter().all(|s| !s.is_empty()));
        assert!(!p.rule.is_empty() && !p.description.is_empty());
    }
    // Arène : non livrée (pas de choix de modèle par worker) — documentée comme limite.
    assert!(find("arena").is_none());
    for id in ["deploy-verify", "investigate-deploy", "watch-page", "swarm"] {
        assert!(find(id).is_some(), "{id}");
    }
    // Les consignes internes ne sortent pas dans l'API.
    let cat = catalog_json();
    assert!(cat[0].get("instructions").is_none());
    assert_eq!(cat[0]["steps"].as_array().unwrap().len(), 3);
}

#[test]
fn prompt_carries_steps_rule_and_journal_instruction() {
    let p = find("swarm").unwrap();
    let s = prompt(p, &clean_goal(Some("  audit\n perfs  ")));
    assert!(s.starts_with("/swarm"));
    assert!(s.contains("Objectif : audit perfs"));
    assert!(s.contains("1. Découper en tâches indépendantes"));
    assert!(s.contains("3. Rassembler les résultats"));
    assert!(s.contains(MISSING_RULE));
    assert!(s.contains("record_decision"));
    assert_eq!(clean_goal(Some(&"x".repeat(900))).len(), 300);
    assert_eq!(clean_goal(None), "");
}

#[test]
fn a_missing_result_never_counts_as_success() {
    let p = find("deploy-verify");
    // Run terminé sans aucune décision notée : 3 étapes manquantes, verdict incomplet.
    let v = compute_live(&run("completed"), p, &[], &[], &[]);
    assert_eq!(states(&v), vec!["missing", "missing", "missing"]);
    assert_eq!(v["verdict"], "incomplete");
    assert_eq!(v["live"], false);
    assert!(v["status_text"]
        .as_str()
        .unwrap()
        .contains("3 étapes sans résultat"));

    // Deux étapes prouvées, la troisième absente → toujours incomplet.
    let evs = vec![
        decision("r1", 1, "ok", "/app/deployments"),
        decision("r1", 2, "ok", "https://example.com/build/42"),
    ];
    let v = compute_live(&run("completed"), p, &evs, &[], &[]);
    assert_eq!(states(&v), vec!["ok", "ok", "missing"]);
    assert_eq!(v["verdict"], "incomplete");

    let mut all = evs.clone();
    all.push(decision("r1", 3, "ok", "https://example.com"));
    let v = compute_live(&run("completed"), p, &all, &[], &[]);
    assert_eq!(v["verdict"], "ok");
    assert_eq!(v["counters"]["decisions"], 3);
}

#[test]
fn running_run_shows_current_step_and_tool_label() {
    let p = find("deploy-verify");
    let evs = vec![
        decision("r1", 1, "ok", "/app/deployments"),
        ev(
            "r1",
            "tool_start",
            json!({"id": "t2", "name": "get_deployment_logs", "label": "Lecture des logs de build"}),
        ),
    ];
    let v = compute_live(&run("running"), p, &evs, &[], &[]);
    assert_eq!(states(&v), vec!["ok", "running", "pending"]);
    assert_eq!(v["status_text"], "Lecture des logs de build…");
    assert_eq!(v["live"], true);

    // Outil terminé, jalon en cours → le jalon devient le libellé.
    let mut evs2 = evs.clone();
    evs2.push(ev(
        "r1",
        "tool_done",
        json!({"id": "t2", "name": "get_deployment_logs", "ok": false, "result": {}}),
    ));
    evs2.push(ev(
        "r1",
        "milestone",
        json!({"label": "Vérification", "status": "running"}),
    ));
    let v = compute_live(&run("running"), p, &evs2, &[], &[]);
    assert_eq!(v["status_text"], "Vérification…");
    assert_eq!(v["counters"]["tools_failed"], 1);
}

#[test]
fn failed_run_marks_current_step_failed() {
    let mut r = run("failed");
    r.error = Some("build cassé\nnpm ERR".into());
    let v = compute_live(
        &r,
        find("deploy-verify"),
        &[decision("r1", 1, "ok", "/app/x")],
        &[],
        &[],
    );
    assert_eq!(states(&v), vec!["ok", "failed", "missing"]);
    assert_eq!(v["verdict"], "failed");
    assert_eq!(v["status_text"], "Échec : build cassé npm ERR");
}

#[test]
fn journal_keeps_only_link_or_path_evidence_and_reuses_receipts() {
    let bad = ev(
        "r1",
        "tool_done",
        json!({"name": "record_decision", "ok": true, "result": {"ok": true, "decision": {
            "what": "x", "why": "y", "evidence": "j'ai tout vérifié à la main", "outcome": "ok", "step": 1}}}),
    );
    let refused = ev(
        "r1",
        "tool_done",
        json!({"name": "record_decision", "ok": true, "result": {"ok": false, "error": "…"}}),
    );
    let receipt = ReceiptLite {
        uuid: "rc1".into(),
        action_label: "Mise en ligne".into(),
        target: "web".into(),
        status: "done".into(),
        approved_by_label: Some("Mathieu".into()),
        created_at: "2026-10-30".into(),
        ..Default::default()
    };
    let v = compute_live(
        &run("running"),
        find("deploy-verify"),
        &[bad, refused],
        &[],
        &[receipt],
    );
    let d = v["decisions"].as_array().unwrap();
    assert_eq!(d.len(), 1);
    assert_eq!(d[0]["source"], "receipt");
    assert_eq!(d[0]["evidence"], "/app/receipts#rc1");
    assert_eq!(d[0]["outcome"], "ok");
    assert_eq!(d[0]["what"], "Mise en ligne · web");
}

#[test]
fn swarm_tracks_real_workers() {
    let p = find("swarm");
    let w = |id: &str, st: &str| RunLite {
        uuid: id.into(),
        status: st.into(),
        title: Some(format!("tâche {id}")),
        ..Default::default()
    };
    // Coordinateur fini (il s'arrête après délégation), 1 worker sur 2 en cours.
    let workers = vec![w("w1", "completed"), w("w2", "running")];
    let v = compute_live(&run("completed"), p, &[], &workers, &[]);
    assert_eq!(states(&v), vec!["ok", "ok", "running"]);
    assert_eq!(v["verdict"], "running");
    assert_eq!(v["status_text"], "1 worker en cours…");
    assert_eq!(v["counters"]["workers_total"], 2);
    assert_eq!(v["counters"]["workers_done"], 1);

    let workers = vec![w("w1", "completed"), w("w2", "failed")];
    let v = compute_live(&run("completed"), p, &[], &workers, &[]);
    assert_eq!(states(&v), vec!["ok", "ok", "failed"]);
    assert_eq!(v["verdict"], "failed");

    // Aucun worker lancé : rien n'est « ok » par défaut.
    let v = compute_live(&run("completed"), p, &[], &[], &[]);
    assert_eq!(states(&v), vec!["missing", "missing", "missing"]);
}

#[tokio::test]
async fn live_endpoint_reads_events_children_and_receipts_from_postgres() {
    let pool = devforge_database::ephemeral_pg().await;
    crate::db::migrate(&pool).await.unwrap();
    for (uuid, parent, status, pb) in [
        ("run-p", None, "completed", Some("swarm")),
        ("run-w1", Some("run-p"), "completed", None),
        ("run-w2", Some("run-p"), "running", None),
    ] {
        sqlx::query(
            r#"INSERT INTO agent_runs (uuid, project_uuid, agent_uuid, message_uuid, status, created_at, updated_at, kind, title, parent_run_uuid, playbook)
               VALUES ($1, 'p1', 'a1', 'm-' || $1, $2, 'x', 'x', 'chat', $1, $3, $4)"#,
        )
        .bind(uuid)
        .bind(status)
        .bind(parent)
        .bind(pb)
        .execute(&pool)
        .await
        .unwrap();
    }
    let payload = json!({"type": "tool_done", "id": "d1", "name": "record_decision", "ok": true, "arguments": {},
        "result": {"ok": true, "decision": {"what": "Découpe", "why": "3 axes", "evidence": "docs/plan.md", "outcome": "ok", "step": 1}}});
    sqlx::query("INSERT INTO agent_run_events (run_uuid, seq, agent_uuid, type, payload) VALUES ('run-w1', 1, 'a1', 'tool_done', $1::jsonb)")
        .bind(payload.to_string())
        .execute(&pool)
        .await
        .unwrap();
    let (project, v) = live_json(&pool, "run-p").await.unwrap().unwrap();
    assert_eq!(project, "p1");
    assert_eq!(v["playbook"]["id"], "swarm");
    assert_eq!(v["workers"].as_array().unwrap().len(), 2);
    assert_eq!(v["decisions"][0]["evidence"], "docs/plan.md");
    assert_eq!(v["verdict"], "running");
    assert!(live_json(&pool, "absent").await.unwrap().is_none());
}
