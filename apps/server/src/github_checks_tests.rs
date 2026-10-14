use super::*;
use serde_json::json;
use wiremock::matchers::{body_partial_json, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const SHA: &str = "6dcb09b5b57875f334f61aebed695e2e4193db5e";

fn reporter(uri: &str, mode: Mode) -> Reporter {
    Reporter {
        api: RepoApi::new(uri, "ghs_testtoken123456", "bobdivx", "demo"),
        mode,
        details_url: Some(
            "https://df.example/app/projects/view?uuid=p&tab=deployments&deployment=d".into(),
        ),
        environment_url: Some("https://demo.example".into()),
        environment: "Production".into(),
        retry_delay: Duration::from_millis(1),
    }
}

async fn mount(
    gh: &MockServer,
    m: &str,
    p: &str,
    body: serde_json::Value,
    resp: serde_json::Value,
    n: u64,
) {
    Mock::given(method(m))
        .and(path(p))
        .and(body_partial_json(body))
        .respond_with(ResponseTemplate::new(201).set_body_json(resp))
        .expect(n)
        .mount(gh)
        .await;
}

async fn deployments(gh: &MockServer, final_state: &str) {
    mount(gh, "POST", "/repos/bobdivx/demo/deployments",
        json!({"ref": SHA, "environment": "Production", "auto_merge": false, "required_contexts": []}), json!({"id": 9}), 1).await;
    mount(
        gh,
        "POST",
        "/repos/bobdivx/demo/deployments/9/statuses",
        json!({"state": "in_progress"}),
        json!({}),
        1,
    )
    .await;
    mount(
        gh,
        "POST",
        "/repos/bobdivx/demo/deployments/9/statuses",
        json!({"state": final_state}),
        json!({}),
        1,
    )
    .await;
}

#[tokio::test]
async fn checks_success_lifecycle() {
    let gh = MockServer::start().await;
    mount(&gh, "POST", "/repos/bobdivx/demo/check-runs",
        json!({"name": "DevForge / deploy", "head_sha": SHA, "status": "queued", "external_id": "dep-1"}), json!({"id": 1}), 1).await;
    mount(
        &gh,
        "PATCH",
        "/repos/bobdivx/demo/check-runs/1",
        json!({"status": "in_progress"}),
        json!({}),
        1,
    )
    .await;
    mount(
        &gh,
        "PATCH",
        "/repos/bobdivx/demo/check-runs/1",
        json!({"status": "completed", "conclusion": "success"}),
        json!({}),
        1,
    )
    .await;
    deployments(&gh, "success").await;
    let r = reporter(&gh.uri(), Mode::Checks);
    let ids = r.queued(SHA, "dep-1").await;
    assert_eq!(
        ids,
        Ids {
            head_sha: SHA.into(),
            check_run_id: Some(1),
            deployment_id: Some(9)
        }
    );
    r.in_progress(&ids).await;
    r.finish(
        &ids,
        &Final::Success {
            summary: "ok".into(),
        },
    )
    .await;
    gh.verify().await;
}

#[tokio::test]
async fn checks_failure_and_cancel() {
    let gh = MockServer::start().await;
    mount(
        &gh,
        "POST",
        "/repos/bobdivx/demo/check-runs",
        json!({"status": "queued"}),
        json!({"id": 2}),
        2,
    )
    .await;
    mount(
        &gh,
        "PATCH",
        "/repos/bobdivx/demo/check-runs/2",
        json!({"status": "completed", "conclusion": "failure"}),
        json!({}),
        1,
    )
    .await;
    mount(
        &gh,
        "PATCH",
        "/repos/bobdivx/demo/check-runs/2",
        json!({"status": "completed", "conclusion": "cancelled"}),
        json!({}),
        1,
    )
    .await;
    mount(
        &gh,
        "POST",
        "/repos/bobdivx/demo/deployments",
        json!({}),
        json!({"id": 9}),
        2,
    )
    .await;
    mount(
        &gh,
        "POST",
        "/repos/bobdivx/demo/deployments/9/statuses",
        json!({"state": "failure"}),
        json!({}),
        1,
    )
    .await;
    mount(
        &gh,
        "POST",
        "/repos/bobdivx/demo/deployments/9/statuses",
        json!({"state": "inactive"}),
        json!({}),
        1,
    )
    .await;
    let r = reporter(&gh.uri(), Mode::Checks);
    let ids = r.queued(SHA, "dep-2").await;
    r.finish(&ids, &failure_output("step 1\nnpm ERR! boom\n", &[]))
        .await;
    let ids = r.queued(SHA, "dep-3").await;
    r.finish(&ids, &Final::Cancelled).await;
    gh.verify().await;
}

#[tokio::test]
async fn pat_projects_use_commit_statuses() {
    let gh = MockServer::start().await;
    let p = format!("/repos/bobdivx/demo/statuses/{SHA}");
    mount(
        &gh,
        "POST",
        &p,
        json!({"state": "pending", "context": "devforge/deploy"}),
        json!({}),
        2,
    )
    .await;
    mount(
        &gh,
        "POST",
        &p,
        json!({"state": "failure", "context": "devforge/deploy"}),
        json!({}),
        1,
    )
    .await;
    deployments(&gh, "failure").await;
    Mock::given(method("POST"))
        .and(path("/repos/bobdivx/demo/check-runs"))
        .respond_with(ResponseTemplate::new(201))
        .expect(0)
        .mount(&gh)
        .await;
    let r = reporter(&gh.uri(), Mode::Statuses);
    let ids = r.queued(SHA, "dep-4").await;
    assert_eq!(ids.check_run_id, None);
    r.in_progress(&ids).await;
    r.finish(&ids, &failure_output("x", &[])).await;
    gh.verify().await;
}

#[tokio::test]
async fn github_network_failure_never_breaks_the_deploy() {
    let gh = MockServer::start().await;
    Mock::given(wiremock::matchers::any())
        .respond_with(ResponseTemplate::new(502))
        .mount(&gh)
        .await;
    let r = reporter(&gh.uri(), Mode::Checks);
    let ids = r.queued(SHA, "dep-5").await;
    assert_eq!(ids.check_run_id, None);
    assert_eq!(ids.deployment_id, None);
    r.in_progress(&ids).await;
    r.finish(
        &ids,
        &Final::Success {
            summary: "ok".into(),
        },
    )
    .await;
    // 1 essai + 1 nouvel essai par appel : check run + deployment.
    assert_eq!(gh.received_requests().await.unwrap().len(), 4);
    // Hôte injoignable : idem, pas de panique.
    let r = reporter("http://127.0.0.1:9", Mode::Statuses);
    let ids = r.queued(SHA, "dep-6").await;
    r.finish(&ids, &Final::Cancelled).await;
}

#[test]
fn failure_output_masks_project_secrets_and_tokens() {
    let mut logs: String = (0..80).map(|i| format!("line {i}\n")).collect();
    logs.push_str("DATABASE_URL=postgres://u:SuperSecretPw@db/x\n");
    logs.push_str("fatal: https://x-access-token:ghs_abcdefghijklmnop@github.com/o/r.git\n");
    logs.push_str("token ghp_abcdefghijklmnop12\n");
    let secrets = vec!["SuperSecretPw".to_string(), "ab".to_string()];
    let Final::Failure { text, title, .. } = failure_output(&logs, &secrets) else {
        panic!()
    };
    assert!(!text.contains("SuperSecretPw"));
    assert!(!text.contains("ghs_abcdefghijklmnop"));
    assert!(!text.contains("ghp_abcdefghijklmnop12"));
    assert!(text.contains("x-access-token:***"));
    assert!(!text.contains("line 0\n") && text.contains("line 79"));
    assert!(text.lines().count() <= 52);
    assert!(!title.is_empty());
}
