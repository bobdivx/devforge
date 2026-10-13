use super::*;
use wiremock::matchers::{header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

const FAKE_PEM: &str =
    "-----BEGIN RSA PRIVATE KEY-----\nMIIEtestonly\n-----END RSA PRIVATE KEY-----\n";

fn ensure_key() {
    if std::env::var(crate::secret_box::KEY_ENV).is_err() {
        std::env::set_var(
            crate::secret_box::KEY_ENV,
            base64::engine::general_purpose::STANDARD.encode([5u8; 32]),
        );
    }
    crate::secret_box::global().expect("coffre de test");
}

async fn pool() -> PgPool {
    ensure_key();
    let pool = devforge_database::ephemeral_pg().await;
    crate::db::migrate(&pool).await.unwrap();
    pool
}

#[test]
fn manifest_urls_and_permissions_whitelist() {
    let m = build_manifest("NAS Maison", "https://web.jeser.app/", false);
    assert_eq!(m["name"], "DevForge-NAS-Maison");
    assert_eq!(m["url"], "https://web.jeser.app");
    assert_eq!(
        m["hook_attributes"]["url"],
        "https://web.jeser.app/api/v1/webhooks/github-app"
    );
    assert_eq!(m["hook_attributes"]["active"], true);
    assert_eq!(
        m["redirect_url"],
        "https://web.jeser.app/api/v1/github-app/manifest/callback"
    );
    assert_eq!(
        m["setup_url"],
        "https://web.jeser.app/api/v1/github-app/installed"
    );
    assert_eq!(m["setup_on_update"], true);
    assert_eq!(m["public"], false);
    assert_eq!(
        m["callback_urls"],
        json!(["https://web.jeser.app/api/v1/github-app/oauth/callback"])
    );
    assert_eq!(
        m["default_permissions"],
        json!({
            "contents": "write", "metadata": "read", "pull_requests": "write",
            "checks": "write", "statuses": "write", "deployments": "write"
        })
    );
    assert_eq!(
        m["default_events"],
        json!(["push", "pull_request", "check_run", "check_suite"])
    );
    let perms = m["default_permissions"].as_object().unwrap();
    for forbidden in ["administration", "workflows", "secrets", "members"] {
        assert!(!perms.contains_key(forbidden), "{forbidden}");
    }
}

#[test]
fn workflows_is_opt_in_only() {
    let m = build_manifest("x", "https://a.b", true);
    assert_eq!(m["default_permissions"]["workflows"], "write");
    assert_eq!(m["default_permissions"].as_object().unwrap().len(), 7);
}

#[test]
fn app_name_is_sanitized_and_bounded() {
    assert_eq!(app_name(""), "DevForge");
    assert!(app_name(&"a".repeat(80)).len() <= 34);
    assert_eq!(app_name("  été/prod "), "DevForge-t--prod");
}

#[test]
fn post_url_personal_or_org() {
    assert_eq!(
        manifest_post_url("https://github.com", None, "s1"),
        "https://github.com/settings/apps/new?state=s1"
    );
    assert_eq!(
        manifest_post_url("https://github.com", Some("my-org"), "s1"),
        "https://github.com/organizations/my-org/settings/apps/new?state=s1"
    );
    assert!(valid_org("bobdivx"));
    assert!(!valid_org("../evil"));
    assert!(!valid_org("-x"));
}

#[test]
fn missing_permissions_detects_gaps() {
    let all = json!({"contents":"write","metadata":"read","pull_requests":"write","checks":"write","statuses":"write","deployments":"write"});
    assert!(missing_permissions(&all).is_empty());
    let partial = json!({"contents":"read","metadata":"write"});
    let miss = missing_permissions(&partial);
    assert!(miss.contains(&"contents:write".to_string()));
    assert!(!miss.contains(&"metadata:read".to_string()));
    assert_eq!(miss.len(), 5);
}

#[test]
fn manage_url_user_vs_org() {
    assert_eq!(
        manage_url("https://github.com", "s", "bob", "User"),
        "https://github.com/settings/apps/s/advanced"
    );
    assert_eq!(
        manage_url("https://github.com", "s", "acme", "Organization"),
        "https://github.com/organizations/acme/settings/apps/s/advanced"
    );
}

#[tokio::test]
async fn state_single_use_expiry_and_user_binding() {
    let pool = pool().await;
    let s = issue_state(&pool, "u1").await.unwrap();
    assert!(s.len() >= 43);
    assert_eq!(consume_state(&pool, &s, "u1").await, Ok(()));
    assert_eq!(
        consume_state(&pool, &s, "u1").await,
        Err(StateError::Unknown),
        "réutilisé"
    );

    let s = issue_state(&pool, "u1").await.unwrap();
    assert_eq!(
        consume_state(&pool, &s, "u2").await,
        Err(StateError::OtherUser)
    );
    assert_eq!(
        consume_state(&pool, &s, "u1").await,
        Err(StateError::Unknown),
        "consommé même si refusé"
    );

    sqlx::query("INSERT INTO github_manifest_states (state, user_uuid, expires_at) VALUES ('old', 'u1', now() - interval '1 minute')")
        .execute(&pool).await.unwrap();
    assert_eq!(
        consume_state(&pool, "old", "u1").await,
        Err(StateError::Expired)
    );
    assert_eq!(
        consume_state(&pool, "nope", "u1").await,
        Err(StateError::Unknown)
    );
    // Réponse HTTP : 400.
    assert_eq!(
        state_error_response(StateError::Expired).status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        state_error_response(StateError::OtherUser).status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        state_error_response(StateError::Unknown).status(),
        StatusCode::BAD_REQUEST
    );
}

fn conversion_body() -> Value {
    json!({
        "id": 4242, "slug": "devforge-nas", "client_id": "Iv1.abc", "node_id": "x",
        "html_url": "https://github.com/apps/devforge-nas",
        "owner": {"login": "bobdivx", "type": "User"},
        "client_secret": "cs_secret_value", "webhook_secret": "wh_secret_value",
        "pem": FAKE_PEM
    })
}

#[tokio::test]
async fn manifest_conversion_is_stored_sealed() {
    let pool = pool().await;
    let gh = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/app-manifests/abc123/conversions"))
        .respond_with(ResponseTemplate::new(201).set_body_json(conversion_body()))
        .expect(1)
        .mount(&gh)
        .await;
    let c = convert_manifest(&http(), &gh.uri(), "abc123")
        .await
        .unwrap();
    assert_eq!(c.id, 4242);
    store_app(&pool, &c).await.unwrap();

    let (pk, cs, ws): (String, String, String) = sqlx::query_as(
        "SELECT private_key_enc, client_secret_enc, webhook_secret_enc FROM github_app",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    // Validation P0/P1 : jamais de clé en clair en base.
    assert!(!pk.contains("BEGIN RSA") && pk.starts_with("v1:"));
    assert!(!cs.contains("cs_secret") && !ws.contains("wh_secret"));
    assert_eq!(
        crate::secret_box::open(&pk).unwrap().as_slice(),
        FAKE_PEM.as_bytes()
    );

    // Statut : aucun secret exposé.
    let st = status_json(&pool).await.unwrap().to_string();
    assert!(st.contains("devforge-nas") && st.contains("\"configured\":true"));
    for s in ["BEGIN RSA", "cs_secret_value", "wh_secret_value", "v1:"] {
        assert!(!st.contains(s), "{s} exposé");
    }
}

#[tokio::test]
async fn conversion_failure_and_bad_code() {
    let gh = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/app-manifests/gone/conversions"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&gh)
        .await;
    let e = convert_manifest(&http(), &gh.uri(), "gone")
        .await
        .err()
        .unwrap();
    assert!(e.contains("404"));
    assert!(convert_manifest(&http(), &gh.uri(), "../x").await.is_err());
}

#[tokio::test]
async fn installation_is_verified_then_stored_with_repos() {
    let pool = pool().await;
    let gh = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/app/installations/77"))
        .and(header("authorization", "Bearer app.jwt"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": 77, "account": {"login": "bobdivx", "type": "User"},
            "repository_selection": "selected",
            "permissions": {"contents": "write", "metadata": "read"},
            "suspended_at": null
        })))
        .mount(&gh)
        .await;
    Mock::given(method("POST"))
        .and(path("/app/installations/77/access_tokens"))
        .respond_with(
            ResponseTemplate::new(201)
                .set_body_json(json!({"token": "ghs_inst", "expires_at": "2026-10-13T23:00:00Z"})),
        )
        .mount(&gh)
        .await;
    Mock::given(method("GET"))
        .and(path("/installation/repositories"))
        .and(query_param("page", "1"))
        .and(header("authorization", "Bearer ghs_inst"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "total_count": 1,
            "repositories": [{"id": 9, "full_name": "bobdivx/devforge", "private": true, "default_branch": "main"}]
        })))
        .mount(&gh)
        .await;
    Mock::given(method("GET"))
        .and(path("/app/installations/666"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&gh)
        .await;

    // Installation inventée dans la query ⇒ refusée, rien en base.
    assert!(
        verify_and_store_installation(&pool, &http(), &gh.uri(), "app.jwt", 666, "u1")
            .await
            .is_err()
    );
    let inst = verify_and_store_installation(&pool, &http(), &gh.uri(), "app.jwt", 77, "u1")
        .await
        .unwrap();
    assert_eq!(inst.id, 77);
    // Idempotent (setup_on_update).
    verify_and_store_installation(&pool, &http(), &gh.uri(), "app.jwt", 77, "u1")
        .await
        .unwrap();

    let (n,): (i64,) = sqlx::query_as("SELECT count(*) FROM github_installations")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 1);
    let (full, private): (String, bool) = sqlx::query_as(
        "SELECT full_name, private FROM github_installation_repos WHERE installation_id = 77",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!((full.as_str(), private), ("bobdivx/devforge", true));
    let st = status_json(&pool).await.unwrap();
    let i = &st["installations"][0];
    assert_eq!(i["repositories"], 1);
    assert_eq!(i["missing_permissions"].as_array().unwrap().len(), 4);
    assert!(!st.to_string().contains("ghs_inst"));
}

#[test]
fn app_jwt_rs256_claims() {
    let dir = std::env::temp_dir().join(format!("df-jwt-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let key = dir.join("k.pem");
    let pubk = dir.join("k.pub");
    let ok = std::process::Command::new("openssl")
        .args(["genrsa", "-traditional", "-out"])
        .arg(&key)
        .arg("2048")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
        && std::process::Command::new("openssl")
            .args(["rsa", "-pubout", "-in"])
            .arg(&key)
            .arg("-out")
            .arg(&pubk)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
    if !ok {
        eprintln!("openssl indisponible — test JWT ignoré");
        return;
    }
    let pem = std::fs::read(&key).unwrap();
    let jwt = app_jwt(4242, &pem).unwrap();
    assert_eq!(format!("{jwt:?}"), "***");
    let mut v = jsonwebtoken::Validation::new(jsonwebtoken::Algorithm::RS256);
    v.set_issuer(&["4242"]);
    v.set_required_spec_claims(&["exp", "iat", "iss"]);
    let data = jsonwebtoken::decode::<Value>(
        jwt.expose(),
        &jsonwebtoken::DecodingKey::from_rsa_pem(&std::fs::read(&pubk).unwrap()).unwrap(),
        &v,
    )
    .unwrap();
    let c = data.claims;
    assert!(c["exp"].as_i64().unwrap() - c["iat"].as_i64().unwrap() <= 600);
    let _ = std::fs::remove_dir_all(&dir);
    assert!(app_jwt(1, b"not a key").is_err());
}
