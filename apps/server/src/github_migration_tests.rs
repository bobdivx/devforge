use super::*;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn p(uuid: &str, repo: Option<&str>, inst: Option<i64>) -> ProjectRepo {
    ProjectRepo {
        uuid: uuid.into(),
        name: uuid.into(),
        git_repository: repo.map(str::to_string),
        installation_id: inst,
    }
}

fn cache() -> Vec<CachedRepo> {
    vec![CachedRepo {
        installation_id: 7,
        repo_id: 42,
        full_name: "bobdivx/Template-Studio".into(),
    }]
}

#[test]
fn dry_run_report_is_exact() {
    let c = cache();
    assert_eq!(
        coverage(
            &p(
                "a",
                Some("https://github.com/bobdivx/template-studio.git"),
                None
            ),
            &c
        ),
        Coverage::Covered {
            installation_id: 7,
            repo_id: 42
        }
    );
    assert_eq!(
        coverage(&p("b", Some("https://github.com/bobdivx/other"), None), &c),
        Coverage::NotCovered {
            full_name: "bobdivx/other".into()
        }
    );
    assert_eq!(
        coverage(&p("c", Some("https://github.com/x/y"), Some(3)), &c),
        Coverage::AlreadyLinked { installation_id: 3 }
    );
    assert_eq!(coverage(&p("d", None, None), &c), Coverage::NotGithub);
    assert_eq!(
        coverage(&p("e", Some("https://gitlab.com/a/b"), None), &c),
        Coverage::NotGithub
    );
    let j = coverage_json(
        &p("b", Some("https://github.com/bobdivx/other"), None),
        &coverage(&p("b", Some("https://github.com/bobdivx/other"), None), &c),
    );
    assert_eq!(j["status"], "not_covered");
    assert_eq!(j["repo"], "bobdivx/other");
}

#[test]
fn only_devforge_hooks_are_selected() {
    let hooks = vec![
        (
            1,
            "https://web.jeser.app/api/v1/webhooks/github/".to_string(),
        ),
        (2, "https://ci.example/hook".to_string()),
        (
            3,
            "https://web.jeser.app/api/v1/webhooks/github".to_string(),
        ),
    ];
    assert_eq!(
        legacy_hook_ids(&hooks, "https://web.jeser.app/api/v1/webhooks/github"),
        vec![1, 3]
    );
}

#[test]
fn rate_window_limits_per_minute() {
    let w = RateWindow::new();
    assert!(w.allow(120, 2));
    assert!(w.allow(130, 2));
    assert!(!w.allow(150, 2));
    assert!(w.allow(180, 2), "nouvelle minute");
}

#[tokio::test]
async fn legacy_flag_from_instance_settings() {
    let pool = devforge_database::ephemeral_pg().await;
    crate::db::migrate(&pool).await.unwrap();
    assert!(legacy_webhook_enabled(&pool).await);
    set_legacy_webhook(&pool, false).await.unwrap();
    assert!(!legacy_webhook_enabled(&pool).await);
    set_legacy_webhook(&pool, true).await.unwrap();
    assert!(legacy_webhook_enabled(&pool).await);
}

#[tokio::test]
async fn real_mode_deletes_and_rollback_recreates_hook() {
    let gh = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/repos/bobdivx/demo/hooks"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
            {"id": 11, "config": {"url": "https://df.example/api/v1/webhooks/github"}},
            {"id": 12, "config": {"url": "https://other.example/"}},
        ])))
        .mount(&gh)
        .await;
    Mock::given(method("DELETE"))
        .and(path("/repos/bobdivx/demo/hooks/11"))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&gh)
        .await;
    Mock::given(method("DELETE"))
        .and(path("/repos/bobdivx/demo/hooks/12"))
        .respond_with(ResponseTemplate::new(204))
        .expect(0)
        .mount(&gh)
        .await;
    Mock::given(method("POST"))
        .and(path("/repos/bobdivx/demo/hooks"))
        .respond_with(ResponseTemplate::new(201).set_body_json(serde_json::json!({"id": 21})))
        .expect(1)
        .mount(&gh)
        .await;
    let api = RepoApi::new(gh.uri(), "ghp_test", "bobdivx", "demo");
    let hooks = api.list_hooks().await.unwrap();
    let ids = legacy_hook_ids(&hooks, "https://df.example/api/v1/webhooks/github");
    assert_eq!(ids, vec![11]);
    for id in ids {
        api.delete_hook(id).await.unwrap();
    }
    let id = api
        .create_push_hook("https://df.example/api/v1/webhooks/github", Some("s"))
        .await
        .unwrap();
    assert_eq!(id, 21);
}
