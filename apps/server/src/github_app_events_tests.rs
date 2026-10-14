use super::*;
use axum::http::HeaderValue;

const SECRET: &[u8] = b"wh_test_secret";

macro_rules! fixture {
    ($name:literal) => {
        include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/github/",
            $name
        ))
    };
}

fn fx(raw: &str) -> Value {
    serde_json::from_str(raw).unwrap()
}

async fn pool_with_app() -> PgPool {
    if std::env::var(crate::secret_box::KEY_ENV).is_err() {
        use base64::Engine;
        std::env::set_var(
            crate::secret_box::KEY_ENV,
            base64::engine::general_purpose::STANDARD.encode([6u8; 32]),
        );
    }
    crate::secret_box::global().unwrap();
    let pool = devforge_database::ephemeral_pg().await;
    crate::db::migrate(&pool).await.unwrap();
    let seal = |b: &[u8]| crate::secret_box::seal(b).unwrap();
    sqlx::query("INSERT INTO github_app (id, app_id, slug, client_id, client_secret_enc, webhook_secret_enc, private_key_enc, html_url, owner_login) VALUES (1, 4242, 'devforge-nas', 'Iv1', $1, $2, $3, 'h', 'bobdivx')")
        .bind(seal(b"cs")).bind(seal(SECRET)).bind(seal(b"pem"))
        .execute(&pool).await.unwrap();
    pool
}

fn headers(event: &str, delivery: &str, sig: Option<String>) -> HeaderMap {
    let mut h = HeaderMap::new();
    h.insert("x-github-event", HeaderValue::from_str(event).unwrap());
    h.insert(
        "x-github-delivery",
        HeaderValue::from_str(delivery).unwrap(),
    );
    if let Some(s) = sig {
        h.insert("x-hub-signature-256", HeaderValue::from_str(&s).unwrap());
    }
    h
}

fn code(o: &Outcome) -> StatusCode {
    match o {
        Outcome::Reply(c, _) => *c,
        Outcome::Process(_) => StatusCode::OK,
    }
}

async fn know_installation(pool: &PgPool) {
    apply_installation_event(pool, "created", &fx(fixture!("installation_created.json")))
        .await
        .unwrap();
}

#[test]
fn signature_verification_is_strict() {
    let body = br#"{"a":1}"#;
    let sig = sign(SECRET, body);
    assert!(verify_signature(SECRET, body, &sig));
    assert!(!verify_signature(SECRET, br#"{"a":2}"#, &sig));
    assert!(!verify_signature(b"other", body, &sig));
    assert!(!verify_signature(SECRET, body, ""));
    assert!(!verify_signature(SECRET, body, "sha1=abcd"));
    assert!(!verify_signature(SECRET, body, "sha256=zz"));
}

#[tokio::test]
async fn signature_valid_invalid_missing_modified() {
    let pool = pool_with_app().await;
    know_installation(&pool).await;
    let body = fixture!("push.json").as_bytes();
    let good = sign(SECRET, body);

    let ok = receive(&pool, &headers("push", "d-valid", Some(good.clone())), body).await;
    assert_eq!(code(&ok), StatusCode::OK);
    assert!(matches!(ok, Outcome::Process(_)));

    let bad = receive(
        &pool,
        &headers("push", "d-invalid", Some(sign(b"wrong", body))),
        body,
    )
    .await;
    assert_eq!(code(&bad), StatusCode::UNAUTHORIZED);

    let missing = receive(&pool, &headers("push", "d-missing", None), body).await;
    assert_eq!(code(&missing), StatusCode::UNAUTHORIZED);

    let mut modified = body.to_vec();
    modified[10] ^= 1;
    let m = receive(&pool, &headers("push", "d-mod", Some(good)), &modified).await;
    assert_eq!(code(&m), StatusCode::UNAUTHORIZED);

    // Rejets de signature : aucune livraison enregistrée.
    let (n,): (i64,) = sqlx::query_as("SELECT count(*) FROM github_webhook_deliveries")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 1);
}

#[tokio::test]
async fn no_app_configured_is_503_and_no_insecure_bypass() {
    let pool = devforge_database::ephemeral_pg().await;
    crate::db::migrate(&pool).await.unwrap();
    std::env::set_var("DEVFORGE_ALLOW_INSECURE_WEBHOOK", "1");
    let body = fixture!("ping.json").as_bytes();
    let o = receive(
        &pool,
        &headers("ping", "d1", Some(sign(SECRET, body))),
        body,
    )
    .await;
    assert_eq!(code(&o), StatusCode::SERVICE_UNAVAILABLE);
    let o = receive(&pool, &headers("ping", "d1", None), body).await;
    assert_eq!(code(&o), StatusCode::UNAUTHORIZED);
    std::env::remove_var("DEVFORGE_ALLOW_INSECURE_WEBHOOK");
}

#[tokio::test]
async fn same_delivery_twice_is_processed_once() {
    let pool = pool_with_app().await;
    know_installation(&pool).await;
    let body = fixture!("push.json").as_bytes();
    let h = headers("push", "dup-1", Some(sign(SECRET, body)));
    let mut processed = 0;
    for _ in 0..2 {
        match receive(&pool, &h, body).await {
            Outcome::Process(_) => processed += 1,
            Outcome::Reply(c, v) => {
                assert_eq!(c, StatusCode::OK);
                assert_eq!(v["duplicate"], true);
            }
        }
    }
    assert_eq!(processed, 1, "un seul déploiement enfilé");
}

#[tokio::test]
async fn unknown_installation_is_ignored_but_created_is_accepted() {
    let pool = pool_with_app().await;
    let body = fixture!("push.json").as_bytes();
    let o = receive(
        &pool,
        &headers("push", "u1", Some(sign(SECRET, body))),
        body,
    )
    .await;
    assert_eq!(code(&o), StatusCode::ACCEPTED);
    let body = fixture!("installation_created.json").as_bytes();
    let o = receive(
        &pool,
        &headers("installation", "u2", Some(sign(SECRET, body))),
        body,
    )
    .await;
    assert!(matches!(o, Outcome::Process(_)));
    let body = fixture!("ping.json").as_bytes();
    let o = receive(
        &pool,
        &headers("ping", "u3", Some(sign(SECRET, body))),
        body,
    )
    .await;
    assert_eq!(code(&o), StatusCode::OK);

    let list = recent_deliveries(&pool).await.unwrap();
    assert_eq!(list.len(), 3);
    let s = serde_json::to_string(&list).unwrap();
    assert!(s.contains("ignored_unknown_installation"));
    // Jamais de payload ni de secret.
    assert!(!s.contains("head_commit") && !s.contains("wh_test_secret"));
}

#[tokio::test]
async fn installation_fixtures_effects() {
    let pool = pool_with_app().await;
    know_installation(&pool).await;
    let repos = |pool: PgPool| async move {
        let r: Vec<(i64,)> = sqlx::query_as("SELECT repo_id FROM github_installation_repos WHERE installation_id = 77 ORDER BY repo_id")
            .fetch_all(&pool).await.unwrap();
        r.into_iter().map(|x| x.0).collect::<Vec<_>>()
    };
    assert_eq!(repos(pool.clone()).await, vec![9001, 9002]);

    apply_installation_repositories(
        &pool,
        "added",
        &fx(fixture!("installation_repositories_added.json")),
    )
    .await
    .unwrap();
    apply_installation_repositories(
        &pool,
        "removed",
        &fx(fixture!("installation_repositories_removed.json")),
    )
    .await
    .unwrap();
    assert_eq!(repos(pool.clone()).await, vec![9001, 9003]);

    apply_installation_event(&pool, "suspend", &fx(fixture!("installation_suspend.json")))
        .await
        .unwrap();
    let (s,): (bool,) = sqlx::query_as(
        "SELECT suspended_at IS NOT NULL FROM github_installations WHERE installation_id = 77",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(s);
    apply_installation_event(
        &pool,
        "unsuspend",
        &fx(fixture!("installation_unsuspend.json")),
    )
    .await
    .unwrap();
    let (s,): (bool,) = sqlx::query_as(
        "SELECT suspended_at IS NOT NULL FROM github_installations WHERE installation_id = 77",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(!s);

    // deleted : installation + repos supprimés, projet conservé et signalé déconnecté.
    sqlx::query("INSERT INTO projects (uuid, name, slug, created_at, updated_at, github_installation_id, github_repo_id) VALUES ('p1','A','a','x','x', 77, 9001)")
        .execute(&pool).await.unwrap();
    apply_installation_event(&pool, "deleted", &fx(fixture!("installation_deleted.json")))
        .await
        .unwrap();
    let (n,): (i64,) = sqlx::query_as("SELECT count(*) FROM github_installation_repos")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 0);
    let (p,): (i64,) = sqlx::query_as("SELECT count(*) FROM projects WHERE uuid = 'p1'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(p, 1);
    let st = crate::github_app_routes::status_json(&pool).await.unwrap();
    assert_eq!(st["disconnected_projects"], 1);
}

#[test]
fn rerequested_maps_to_push_of_head_branch() {
    for (ev, raw) in [
        ("check_suite", fixture!("check_suite_rerequested.json")),
        ("check_run", fixture!("check_run_rerequested.json")),
    ] {
        let p = rerequest_as_push(ev, &fx(raw)).unwrap();
        assert_eq!(p["ref"], "refs/heads/main");
        assert_eq!(p["repository"]["id"], 9001);
        assert_eq!(
            p["head_commit"]["id"],
            "6dcb09b5b57875f334f61aebed695e2e4193db5e"
        );
    }
}

#[test]
fn push_skip_deleted_and_tags() {
    use crate::infra_routes::push_skip_reason;
    assert_eq!(
        push_skip_reason(&fx(fixture!("push_deleted.json"))),
        Some("deleted")
    );
    assert_eq!(
        push_skip_reason(&json!({"ref": "refs/tags/v1"})),
        Some("tag")
    );
    assert_eq!(push_skip_reason(&fx(fixture!("push.json"))), None);
}

/// `handle_push` : sélection des projets, commune aux deux routes (non-régression).
#[tokio::test]
async fn push_targets_legacy_vs_installation() {
    use crate::infra_routes::{push_target_projects, PushScope};
    let pool = devforge_database::ephemeral_pg().await;
    crate::db::migrate(&pool).await.unwrap();
    sqlx::query(r#"INSERT INTO projects (uuid, name, slug, created_at, updated_at, git_repository, github_installation_id, github_repo_id) VALUES
        ('p-legacy','A','a','x','x','https://github.com/bobdivx/demo', NULL, NULL),
        ('p-linked','B','b','x','x','https://github.com/bobdivx/demo', 77, 9001),
        ('p-other-inst','C','c','x','x','bobdivx/demo', 78, 9001),
        ('p-unrelated','D','d','x','x','https://github.com/bobdivx/autre', NULL, NULL)"#)
        .execute(&pool).await.unwrap();
    let push = fx(fixture!("push.json"));
    let names = |v: Vec<crate::state::Project>| {
        let mut n: Vec<String> = v.into_iter().map(|p| p.uuid).collect();
        n.sort();
        n
    };
    let flag = crate::github_auth::flag_from_env(
        std::env::var(crate::github_auth::FLAG_ENV).ok().as_deref(),
    );
    if !flag {
        // Sans mode App : webhook historique strictement inchangé (tous les projets du dépôt).
        assert_eq!(
            names(
                push_target_projects(&pool, &push, PushScope::Legacy)
                    .await
                    .unwrap()
            ),
            vec!["p-legacy", "p-linked", "p-other-inst"]
        );
    }
    assert_eq!(
        names(
            push_target_projects(&pool, &push, PushScope::Installation(77))
                .await
                .unwrap()
        ),
        vec!["p-linked"]
    );
    // Mode App actif : les projets migrés ne sont plus déployés par l'ancien webhook.
    sqlx::query("INSERT INTO github_app (id, app_id, slug, client_id, client_secret_enc, webhook_secret_enc, private_key_enc, html_url, owner_login) VALUES (1,1,'s','c','v1:a:b','v1:a:b','v1:a:b','h','o')")
        .execute(&pool).await.unwrap();
    assert_eq!(
        names(
            push_target_projects(&pool, &push, PushScope::Legacy)
                .await
                .unwrap()
        ),
        vec!["p-legacy"]
    );
}

#[tokio::test]
async fn purge_keeps_recent_deliveries() {
    let pool = devforge_database::ephemeral_pg().await;
    crate::db::migrate(&pool).await.unwrap();
    sqlx::query("INSERT INTO github_webhook_deliveries (delivery_id, event, status, received_at) VALUES ('old','push','processed', now() - interval '8 days'), ('new','push','processed', now())")
        .execute(&pool).await.unwrap();
    purge_old_deliveries(&pool).await;
    let (n,): (i64,) = sqlx::query_as("SELECT count(*) FROM github_webhook_deliveries")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 1);
}
