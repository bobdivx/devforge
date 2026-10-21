use super::*;
use serde_json::json;

fn pr_payload(action: &str, number: i64, head_repo: i64, base_repo: i64, sha: &str) -> Value {
    json!({
        "action": action,
        "number": number,
        "repository": {"id": base_repo, "full_name": "bobdivx/template-studio"},
        "pull_request": {
            "number": number,
            "head": {"sha": sha, "ref": "feat/x", "repo": {"id": head_repo}},
            "base": {"ref": "main", "repo": {"id": base_repo}},
        },
    })
}

const SHA: &str = "0123456789abcdef0123456789abcdef01234567";

#[test]
fn host_is_dns_valid_and_one_level_under_zone() {
    let h = preview_fqdn("popcornn.jeser.app", Some("jeser.app"), 12, "popcornn").unwrap();
    assert_eq!(h, "pr-12-popcornn.jeser.app");
    let apex = preview_fqdn("example.com", None, 3, "Mon Projet!").unwrap();
    assert_eq!(apex, "pr-3-mon-projet.example.com");
    let long = "x".repeat(200);
    let h = preview_fqdn("a.jeser.app", Some("jeser.app"), 99999, &long).unwrap();
    let label = h.split('.').next().unwrap();
    assert!(label.len() <= 63, "{label}");
    assert!(label
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'));
    assert!(!label.ends_with('-'));
    assert_eq!(preview_fqdn("localhost", None, 1, "a"), None);
    assert_eq!(preview_fqdn("a.b.c", None, 0, "a"), None);
}

#[test]
fn slugify_cleans() {
    assert_eq!(slugify("  Hello__World--2 "), "hello-world-2");
    assert_eq!(slugify("---"), "");
}

#[test]
fn instance_is_unique_per_pr_and_12_chars() {
    let a = preview_instance_id("02792add-bf8d-41a3-8761-3ad7f75ae6f8", 1);
    let b = preview_instance_id("02792add-bf8d-41a3-8761-3ad7f75ae6f8", 2);
    let c = preview_instance_id("4e528e23-f69e-4758-bd17-4e6378374dc7", 1);
    assert_eq!(a.len(), 12);
    assert!(a.starts_with("pv"));
    assert!(a != b && a != c);
    // Jamais en collision avec une prod (`df-<uuid12>`, hex) ni une dev (`df-dv…`).
    assert!(preview_container_name("02792add-bf8d-41a3-8761-3ad7f75ae6f8", 1).starts_with("df-pv"));
    assert_eq!(preview_environment(7), "preview-7");
    assert_eq!(pr_of_env("preview-7"), Some(7));
    assert!(is_preview_env("preview-7") && !is_preview_env("production") && !is_preview_env("dev"));
}

#[test]
fn classify_actions() {
    assert_eq!(
        classify("opened", &pr_payload("opened", 4, 1, 1, SHA)),
        PrAction::Deploy {
            number: 4,
            head_sha: SHA.into(),
            head_ref: "feat/x".into()
        }
    );
    assert!(matches!(
        classify("synchronize", &pr_payload("synchronize", 4, 1, 1, SHA)),
        PrAction::Deploy { .. }
    ));
    assert_eq!(
        classify("closed", &pr_payload("closed", 4, 1, 1, SHA)),
        PrAction::Close { number: 4 }
    );
    assert_eq!(
        classify("labeled", &pr_payload("labeled", 4, 1, 1, SHA)),
        PrAction::Ignore
    );
    assert_eq!(
        classify("opened", &pr_payload("opened", 4, 1, 1, "nothex")),
        PrAction::Ignore
    );
}

#[test]
fn fork_pr_is_never_deployed() {
    let p = pr_payload("opened", 5, 999, 1, SHA);
    assert!(is_fork(&p));
    assert_eq!(
        classify("opened", &p),
        PrAction::Fork {
            number: 5,
            head_sha: SHA.into()
        }
    );
    // Dépôt de tête supprimé : traité comme un fork.
    let mut gone = pr_payload("opened", 5, 1, 1, SHA);
    gone["pull_request"]["head"]["repo"] = Value::Null;
    assert!(is_fork(&gone));
}

#[test]
fn comment_has_marker_and_single_table_row() {
    let v = CommentView {
        project_name: "template|studio".into(),
        status: "ready".into(),
        url: Some("https://pr-1-template-studio.jeser.app".into()),
        sha: SHA.into(),
        updated: "15/10 10:42".into(),
    };
    let b = comment_body("uuid-1", &v);
    assert!(b.starts_with("<!-- devforge-preview:uuid-1 -->"));
    assert!(b.contains("| Projet | Statut | Preview | Commit | Mis à jour (heure Paris) |"));
    assert!(b.contains(
        "[https://pr-1-template-studio.jeser.app](https://pr-1-template-studio.jeser.app)"
    ));
    assert!(b.contains("`0123456`"));
    assert!(b.contains("template\\|studio"));
    assert_eq!(b.matches("\n| ").count(), 2, "en-tête + 1 ligne");
    let deleted = comment_body(
        "uuid-1",
        &CommentView {
            status: "deleted".into(),
            ..v
        },
    );
    assert!(deleted.contains("Preview supprimée"));
    assert!(!deleted.contains("https://"));
}

#[test]
fn paris_time_is_local() {
    let t = chrono::DateTime::parse_from_rfc3339("2026-10-15T08:30:00Z")
        .unwrap()
        .with_timezone(&chrono::Utc);
    assert_eq!(paris_time(t), "15/10 10:30");
}

#[test]
fn runtime_is_capped_and_unpublished() {
    let prod = devforge_deploy::RuntimeSpec {
        memory: Some("8g".into()),
        ..Default::default()
    };
    let rt = preview_runtime(&prod, "1g", "1");
    assert_eq!(rt.memory.as_deref(), Some("1g"));
    assert_eq!(rt.cpus.as_deref(), Some("1"));
    assert!(rt.ports.is_empty());
}

#[test]
fn teardown_targets_only_this_preview() {
    let cmd = teardown_command("02792add-bf8d-41a3-8761-3ad7f75ae6f8", 3);
    let name = preview_container_name("02792add-bf8d-41a3-8761-3ad7f75ae6f8", 3);
    assert!(cmd.contains(&format!("'^{name}(-|$)'")));
    assert!(!cmd.contains("df-02792add"));
}

mod comment_api {
    use super::*;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn api(uri: &str) -> RepoApi {
        RepoApi::new(uri, "ghs_testtoken123456", "bobdivx", "demo")
    }

    #[tokio::test]
    async fn open_then_three_synchronize_keeps_a_single_comment() {
        let gh = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/repos/bobdivx/demo/issues/7/comments"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
            .expect(1)
            .mount(&gh)
            .await;
        Mock::given(method("POST"))
            .and(path("/repos/bobdivx/demo/issues/7/comments"))
            .respond_with(ResponseTemplate::new(201).set_body_json(json!({"id": 55})))
            .expect(1)
            .mount(&gh)
            .await;
        Mock::given(method("PATCH"))
            .and(path("/repos/bobdivx/demo/issues/comments/55"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"id": 55})))
            .expect(3)
            .mount(&gh)
            .await;
        let a = api(&gh.uri());
        let id = upsert_comment(&a, "p1", 7, None, "opened").await;
        assert_eq!(id, Some(55));
        for _ in 0..3 {
            assert_eq!(upsert_comment(&a, "p1", 7, id, "sync").await, Some(55));
        }
    }

    #[tokio::test]
    async fn lost_comment_id_is_found_again_by_marker() {
        let gh = MockServer::start().await;
        Mock::given(method("PATCH"))
            .and(path("/repos/bobdivx/demo/issues/comments/1"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&gh)
            .await;
        Mock::given(method("GET"))
            .and(path("/repos/bobdivx/demo/issues/7/comments"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                {"id": 10, "body": "hello"},
                {"id": 11, "body": format!("{}\nold", marker("p1"))},
            ])))
            .mount(&gh)
            .await;
        Mock::given(method("PATCH"))
            .and(path("/repos/bobdivx/demo/issues/comments/11"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"id": 11})))
            .expect(1)
            .mount(&gh)
            .await;
        Mock::given(method("POST"))
            .and(path("/repos/bobdivx/demo/issues/7/comments"))
            .respond_with(ResponseTemplate::new(201).set_body_json(json!({"id": 99})))
            .expect(0)
            .mount(&gh)
            .await;
        assert_eq!(
            upsert_comment(&api(&gh.uri()), "p1", 7, Some(1), "x").await,
            Some(11)
        );
    }
}

fn env_rows(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
    pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

fn env_get<'a>(env: &'a [(String, String)], key: &str) -> Option<&'a str> {
    env.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
}

const PV_URL: &str = "https://pr-6-vigie.jeser.app";

#[test]
fn preview_env_carries_project_vars_like_prod() {
    let rows = env_rows(&[
        ("TURSO_DATABASE_URL", "libsql://prod.turso.io"),
        ("TURSO_AUTH_TOKEN", "prod-token"),
        ("OIDC_ISSUER", "https://id.example.com"),
        ("OIDC_CLIENT_ID", "vigie"),
        ("OIDC_CLIENT_SECRET", "s3cret"),
    ]);
    let env = build_preview_env(&rows, 6, PV_URL);
    assert_eq!(
        env_get(&env, "TURSO_DATABASE_URL"),
        Some("libsql://prod.turso.io")
    );
    assert_eq!(env_get(&env, "TURSO_AUTH_TOKEN"), Some("prod-token"));
    assert_eq!(env_get(&env, "OIDC_ISSUER"), Some("https://id.example.com"));
    assert_eq!(env_get(&env, "OIDC_CLIENT_ID"), Some("vigie"));
    assert_eq!(env_get(&env, "OIDC_CLIENT_SECRET"), Some("s3cret"));
    assert_eq!(env_get(&env, "DEVFORGE_PREVIEW"), Some("1"));
    assert_eq!(env_get(&env, "DEVFORGE_PREVIEW_PR"), Some("6"));
    assert_eq!(env_get(&env, "DEVFORGE_PREVIEW_URL"), Some(PV_URL));
    assert_eq!(
        preview_shared_db_keys(&rows),
        vec!["TURSO_DATABASE_URL".to_string()]
    );
}

#[test]
fn preview_overrides_replace_prod_values() {
    let rows = env_rows(&[
        ("TURSO_DATABASE_URL", "libsql://prod.turso.io"),
        ("TURSO_AUTH_TOKEN", "prod-token"),
        ("PREVIEW_TURSO_DATABASE_URL", "libsql://preview.turso.io"),
        ("PREVIEW_TURSO_AUTH_TOKEN", "preview-token"),
        ("PREVIEW_ONLY_FLAG", "on"),
    ]);
    let env = build_preview_env(&rows, 6, PV_URL);
    assert_eq!(
        env_get(&env, "TURSO_DATABASE_URL"),
        Some("libsql://preview.turso.io")
    );
    assert_eq!(env_get(&env, "TURSO_AUTH_TOKEN"), Some("preview-token"));
    assert_eq!(env_get(&env, "ONLY_FLAG"), Some("on"));
    assert!(env.iter().all(|(k, _)| !k.starts_with("PREVIEW_")));
    assert!(preview_shared_db_keys(&rows).is_empty());
    // Override vide : la base n'est pas considérée comme isolée.
    let empty = env_rows(&[
        ("TURSO_DATABASE_URL", "libsql://prod.turso.io"),
        ("PREVIEW_TURSO_DATABASE_URL", " "),
    ]);
    assert_eq!(
        preview_shared_db_keys(&empty),
        vec!["TURSO_DATABASE_URL".to_string()]
    );
}

#[test]
fn preview_redirect_uris_point_to_preview_host() {
    let rows = env_rows(&[
        (
            "OIDC_REDIRECT_URI",
            "https://vigie.jeser.app/api/auth/callback?x=1",
        ),
        (
            "AUTH_POCKET_ID_REDIRECT_URL",
            "https://vigie.jeser.app:443/cb",
        ),
        ("NOT_A_REDIRECT", "https://vigie.jeser.app/keep"),
        ("WEIRD_REDIRECT_URI", "not a url"),
    ]);
    let env = build_preview_env(&rows, 6, PV_URL);
    assert_eq!(
        env_get(&env, "OIDC_REDIRECT_URI"),
        Some("https://pr-6-vigie.jeser.app/api/auth/callback?x=1")
    );
    assert_eq!(
        env_get(&env, "AUTH_POCKET_ID_REDIRECT_URL"),
        Some("https://pr-6-vigie.jeser.app/cb")
    );
    assert_eq!(
        env_get(&env, "NOT_A_REDIRECT"),
        Some("https://vigie.jeser.app/keep")
    );
    assert_eq!(env_get(&env, "WEIRD_REDIRECT_URI"), Some("not a url"));
    // Un override explicite gagne sur la réécriture.
    let rows = env_rows(&[
        ("OIDC_REDIRECT_URI", "https://vigie.jeser.app/cb"),
        ("PREVIEW_OIDC_REDIRECT_URI", "https://fixed.example.com/cb"),
    ]);
    let env = build_preview_env(&rows, 6, PV_URL);
    assert_eq!(
        env_get(&env, "OIDC_REDIRECT_URI"),
        Some("https://fixed.example.com/cb")
    );
}

#[test]
fn preview_env_cannot_spoof_devforge_markers() {
    let rows = env_rows(&[
        ("DEVFORGE_PREVIEW", "0"),
        ("PREVIEW_DEVFORGE_PREVIEW_PR", "999"),
    ]);
    let env = build_preview_env(&rows, 6, PV_URL);
    let markers: Vec<_> = env
        .iter()
        .filter(|(k, _)| k.starts_with("DEVFORGE_PREVIEW"))
        .collect();
    assert_eq!(markers.len(), 3);
    assert_eq!(env_get(&env, "DEVFORGE_PREVIEW"), Some("1"));
    assert_eq!(env_get(&env, "DEVFORGE_PREVIEW_PR"), Some("6"));
}

#[test]
fn rewrite_url_host_keeps_path_and_query() {
    assert_eq!(
        rewrite_url_host("http://u:p@a.example.com:8080/x/y?z=1#f", "b.example.com").as_deref(),
        Some("https://b.example.com/x/y?z=1#f")
    );
    assert_eq!(
        rewrite_url_host("https://a.example.com", "b.example.com").as_deref(),
        Some("https://b.example.com")
    );
    assert_eq!(rewrite_url_host("ftp://a/x", "b"), None);
    assert_eq!(rewrite_url_host("https:///x", "b"), None);
}
