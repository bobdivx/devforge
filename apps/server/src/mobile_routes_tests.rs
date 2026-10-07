use super::*;

fn project() -> Project {
    serde_json::from_value(json!({
        "id": 7, "uuid": "p-1", "name": "Vigie", "slug": "vigie", "status": "live",
        "workspace_uuid": "w", "build_pack": "nixpacks", "port": 3000, "is_static": 0,
        "base_directory": "/", "auto_deploy": 0, "gpu_nvidia": 0, "gpu_dri": 0,
        "volumes_json": "[]", "runtime_json": "{}", "domain_apex": "",
        "created_at": "2026-10-01T00:00:00+00:00", "updated_at": "2026-10-01T00:00:00+00:00"
    }))
    .expect("project fixture")
}

#[test]
fn since_defaults_to_24h_and_is_clamped_to_7_days() {
    let now = DateTime::parse_from_rfc3339("2026-10-07T12:00:00+00:00")
        .unwrap()
        .with_timezone(&Utc);
    assert_eq!(normalize_since(None, now), "2026-10-06T12:00:00+00:00");
    assert_eq!(
        normalize_since(Some("n'importe quoi"), now),
        "2026-10-06T12:00:00+00:00"
    );
    assert_eq!(
        normalize_since(Some("2026-10-07T13:30:00+02:00"), now),
        "2026-10-07T11:30:00+00:00"
    );
    assert_eq!(
        normalize_since(Some("2020-01-01T00:00:00Z"), now),
        "2026-09-30T12:00:00+00:00"
    );
}

#[test]
fn deploy_failed_event_has_stable_id_and_short_body() {
    let p = project();
    let long = "x".repeat(400);
    let e = deploy_failed_event(&p, "d-9", "2026-10-07T10:00:00+00:00", Some(&long));
    assert_eq!(e.id, "deploy:d-9");
    assert_eq!(e.kind, "deploy_failed");
    assert_eq!(e.project_uuid, "p-1");
    assert_eq!(e.body.chars().count(), 180);
    let e = deploy_failed_event(&p, "d-9", "t", Some("  "));
    assert!(e.body.contains("Rustine"));
}

#[test]
fn app_down_only_for_unhealthy_or_unrouted() {
    let p = project();
    assert!(app_down_event(&p, "live", "t").is_none());
    assert!(app_down_event(&p, "draft", "t").is_none());
    assert!(app_down_event(&p, "failed", "t").is_none());
    let e = app_down_event(&p, "unhealthy", "t").unwrap();
    assert_eq!(e.id, "down:p-1:unhealthy");
    assert_eq!(
        app_down_event(&p, "unrouted", "t").unwrap().kind,
        "app_down"
    );
}

#[test]
fn spec_waiting_only_for_awaiting_validation() {
    let p = project();
    let mut f: devforge_agent::sdd::FeatureStatus = serde_json::from_value(json!({
        "slug": "001-panier", "title": "Panier", "phase": "awaiting_validation",
        "attempts": 0, "updated_at": "2026-10-07T09:00:00+00:00"
    }))
    .unwrap();
    let e = spec_waiting_event(&p, &f).unwrap();
    assert_eq!(e.id, "spec:p-1:001-panier");
    assert!(e.title.starts_with("Braise attend ton OK"));
    f.dismissed = true;
    assert!(spec_waiting_event(&p, &f).is_none());
    f.dismissed = false;
    f.phase = "implement".into();
    assert!(spec_waiting_event(&p, &f).is_none());
}

#[test]
fn conversation_waiting_reasons() {
    let plan = r#"[{"name":"propose_plan","result":{"plan":{"title":"Page contact"}}}]"#;
    assert_eq!(conversation_waiting("assistant", "Voilà", "[]", true), Some("spec"));
    assert_eq!(conversation_waiting("assistant", "Mon plan :", plan, false), Some("plan"));
    assert_eq!(conversation_waiting("assistant", "On garde le bleu ? 🙂", "[]", false), Some("question"));
    assert_eq!(conversation_waiting("assistant", "C'est fait.", "[]", false), None);
    assert_eq!(conversation_waiting("user", "Tu peux ?", "[]", false), None);
    assert_eq!(conversation_waiting("assistant", "ok", "pas du json", false), None);
}

#[test]
fn excerpt_flattens_markdown_and_truncates() {
    assert_eq!(excerpt("## Bilan\n- **App** en ligne\n```\ncode\n```", 80), "Bilan App en ligne code");
    let long = "a".repeat(200);
    let e = excerpt(&long, 10);
    assert_eq!(e.chars().count(), 10);
    assert!(e.ends_with('…'));
}
