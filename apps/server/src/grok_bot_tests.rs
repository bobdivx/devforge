//! Réveil du bot Grok : SSRF refusé, en-têtes, corps générique, secrets jamais renvoyés.

use std::time::Duration;

use serde_json::{json, Value};
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

use crate::grok_bot::*;
use crate::page_watch::FetchPolicy;

fn strict() -> FetchPolicy {
    FetchPolicy {
        timeout: Duration::from_secs(3),
        max_bytes: 0,
        allow_loopback: false,
    }
}

fn local() -> FetchPolicy {
    FetchPolicy {
        allow_loopback: true,
        ..strict()
    }
}

#[test]
fn webhook_url_refuses_internal_targets() {
    for bad in [
        "https://127.0.0.1/hook",
        "https://10.0.0.5/hook",
        "https://192.168.1.10/hook",
        "https://169.254.169.254/latest/meta-data",
        "https://[::1]/hook",
        "https://localhost/hook",
        "https://api.localhost/hook",
        "https://user:pass@example.com/hook",
        "ftp://example.com/hook",
        "http://example.com/hook",
        "",
    ] {
        assert!(validate_webhook_url(bad, &strict()).is_err(), "{bad}");
    }
    assert!(
        validate_webhook_url("https://api2.cursor.sh/automations/webhook/abc", &strict()).is_ok()
    );
}

#[test]
fn key_is_one_line() {
    assert!(validate_key("short").is_err());
    assert!(validate_key("abc def ghi jkl").is_err());
    assert_eq!(
        validate_key("  sk_live_0123456789  ").unwrap(),
        "sk_live_0123456789"
    );
}

#[test]
fn settings_never_expose_key_or_full_url() {
    let s = Settings {
        url: "https://api2.cursor.sh/automations/webhook/secret-id-123".into(),
        key: "sk_supersecret_value".into(),
        ..Default::default()
    };
    let v = settings_json(&s);
    let txt = v.to_string();
    assert!(!txt.contains("sk_supersecret_value"));
    assert!(!txt.contains("secret-id-123"));
    assert_eq!(v["configured"], true);
    assert_eq!(v["key_set"], true);
    assert_eq!(v["url_hint"], "https://api2.cursor.sh/…");
    assert_eq!(settings_json(&Settings::default())["configured"], false);
}

#[test]
fn payload_is_generic_and_bounded() {
    let p = payload(
        "devforge.run_failed",
        json!({"uuid": "p"}),
        Value::Null,
        &"x".repeat(5000),
    );
    let keys: Vec<&String> = p.as_object().unwrap().keys().collect();
    assert_eq!(keys.len(), 4);
    for k in ["event", "project", "run", "message"] {
        assert!(p.get(k).is_some(), "{k}");
    }
    assert_eq!(p["message"].as_str().unwrap().len(), 2000);
}

#[tokio::test]
async fn wake_posts_json_with_both_key_headers() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/hook"))
        .and(header("authorization", "Bearer key-12345678"))
        .and(header("x-automation-key", "key-12345678"))
        .and(header("content-type", "application/json"))
        .respond_with(ResponseTemplate::new(200).set_body_string("accepted secret-echo"))
        .expect(1)
        .mount(&server)
        .await;
    let body = payload("devforge.test", Value::Null, Value::Null, "bonjour");
    let r = send(
        &format!("{}/hook", server.uri()),
        "key-12345678",
        &body,
        &local(),
    )
    .await;
    assert!(r.ok, "{r:?}");
    assert_eq!(r.status, Some(200));
    // Le corps de réponse n'est jamais relayé.
    assert!(!r.message.contains("secret-echo"));
    let reqs: Vec<Request> = server.received_requests().await.unwrap();
    let sent: Value = serde_json::from_slice(&reqs[0].body).unwrap();
    assert_eq!(sent["event"], "devforge.test");
    assert_eq!(sent["message"], "bonjour");
}

#[tokio::test]
async fn wake_refuses_loopback_and_does_not_follow_redirects() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(
            ResponseTemplate::new(302).insert_header("location", "http://169.254.169.254/"),
        )
        .mount(&server)
        .await;
    let body = payload("devforge.test", Value::Null, Value::Null, "x");
    // Politique de production : adresse loopback refusée avant tout envoi.
    let r = send(
        &format!("{}/hook", server.uri()),
        "key-12345678",
        &body,
        &strict(),
    )
    .await;
    assert!(!r.ok);
    assert!(
        r.message.contains("Adresse interne refusée") || r.message.contains("https"),
        "{}",
        r.message
    );
    assert!(server.received_requests().await.unwrap().is_empty());
    // Redirection : jamais suivie.
    let r = send(
        &format!("{}/hook", server.uri()),
        "key-12345678",
        &body,
        &local(),
    )
    .await;
    assert!(!r.ok);
    assert_eq!(r.status, Some(302));
    assert_eq!(server.received_requests().await.unwrap().len(), 1);
}

#[tokio::test]
async fn wake_reports_refused_key() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(401))
        .mount(&server)
        .await;
    let body = payload("devforge.test", Value::Null, Value::Null, "x");
    let r = send(
        &format!("{}/hook", server.uri()),
        "key-12345678",
        &body,
        &local(),
    )
    .await;
    assert!(!r.ok);
    assert!(r.message.contains("Clé d'envoi refusée"));
    assert!(!r.message.contains("key-12345678"));
}

#[tokio::test]
async fn settings_are_stored_per_workspace_and_loaded_back() {
    let pool = devforge_database::ephemeral_pg().await;
    crate::db::migrate(&pool).await.unwrap();
    assert!(load(&pool, "ws1").await.url.is_empty());
    sqlx::query("INSERT INTO grok_bot_settings (workspace_uuid, url_sealed, key_sealed) VALUES ('ws1', $1, $2)")
        .bind(crate::secret_box::seal_compat("https://example.com/hook"))
        .bind(crate::secret_box::seal_compat("key-12345678"))
        .execute(&pool)
        .await
        .unwrap();
    let s = load(&pool, "ws1").await;
    assert_eq!(s.url, "https://example.com/hook");
    assert_eq!(s.key, "key-12345678");
    assert!(load(&pool, "ws2").await.key.is_empty());
}
