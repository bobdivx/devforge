//! Tests du serveur OAuth MCP (métadonnées, PKCE, redirect_uri, flux code → token → refresh).

use super::*;
use axum::body::to_bytes;

const BASE: &str = "https://web.jeser.app";

async fn body_json(res: Response) -> (StatusCode, Value) {
    let status = res.status();
    let bytes = to_bytes(res.into_body(), 1024 * 1024).await.unwrap();
    let v = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, v)
}

#[test]
fn pkce_s256_matches_rfc7636_vector() {
    // Valeur de référence calculée indépendamment (hashlib Python).
    assert_eq!(
        pkce_s256("dBjftJeZ4CVP-mA92Q-_ogxo4uFb0bk1Re5c3hF0UPA"),
        "zZOf6htWoR7etzGsLrXeyO85syHpL2OUH3ZE2Oqjse8"
    );
    assert!(valid_code_verifier(
        "dBjftJeZ4CVP-mA92Q-_ogxo4uFb0bk1Re5c3hF0UPA"
    ));
    assert!(!valid_code_verifier("court"));
    assert!(!valid_code_verifier(&"a".repeat(129)));
}

#[test]
fn metadata_documents_use_public_https_base() {
    let prm = protected_resource_doc(BASE, "/api/v1/mcp");
    assert_eq!(prm["resource"], "https://web.jeser.app/api/v1/mcp");
    assert_eq!(prm["authorization_servers"][0], BASE);

    let asm = authorization_server_doc(BASE);
    assert_eq!(asm["issuer"], BASE);
    assert_eq!(
        asm["authorization_endpoint"],
        "https://web.jeser.app/oauth/authorize"
    );
    assert_eq!(asm["token_endpoint"], "https://web.jeser.app/oauth/token");
    assert_eq!(
        asm["registration_endpoint"],
        "https://web.jeser.app/oauth/register"
    );
    assert_eq!(asm["code_challenge_methods_supported"], json!(["S256"]));
    assert_eq!(asm["client_id_metadata_document_supported"], true);
}

#[test]
fn www_authenticate_points_to_resource_metadata() {
    let h = www_authenticate(BASE, "/api/v1/mcp", false);
    assert!(h.starts_with("Bearer "));
    assert!(h.contains(
        r#"resource_metadata="https://web.jeser.app/.well-known/oauth-protected-resource/api/v1/mcp""#
    ));
    assert!(!h.contains("invalid_token"));
    assert!(www_authenticate(BASE, "/mcp", true).contains(r#"error="invalid_token""#));
}

#[test]
fn redirect_uri_registration_rules() {
    assert!(redirect_uri_allowed(
        "https://grok.com/connectors-oauth-exchange-code"
    ));
    assert!(redirect_uri_allowed("http://127.0.0.1:33418/callback"));
    assert!(redirect_uri_allowed("http://localhost/cb"));
    assert!(redirect_uri_allowed(
        "cursor://anysphere.cursor-mcp/oauth/callback"
    ));
    assert!(!redirect_uri_allowed("http://evil.example/cb"));
    assert!(!redirect_uri_allowed("javascript:alert(1)"));
    assert!(!redirect_uri_allowed("https://grok.com/cb#frag"));
    assert!(!redirect_uri_allowed("pas une url"));
}

#[test]
fn url_client_id_without_document_uses_same_origin_rule() {
    // Comme Home Assistant : client_id `https://grok.com`, page HTML (pas de JSON).
    let c = client_from_url_doc("https://grok.com", None).unwrap();
    assert_eq!(c.name, "Grok");
    assert!(redirect_matches(
        &c,
        "https://grok.com/connectors-oauth-exchange-code"
    ));
    assert!(redirect_matches(&c, "https://auth.grok.com/callback"));
    assert!(!redirect_matches(&c, "https://evilgrok.com/callback"));
    assert!(!redirect_matches(&c, "http://grok.com/callback"));
    assert!(!redirect_matches(&c, "https://grok.com.evil.io/callback"));
}

#[test]
fn url_client_id_with_metadata_document_requires_exact_redirect() {
    let doc = json!({
        "client_id": "https://client.example/oauth/metadata.json",
        "client_name": "Exemple",
        "redirect_uris": ["https://client.example/callback"],
    });
    let c = client_from_url_doc("https://client.example/oauth/metadata.json", Some(&doc)).unwrap();
    assert_eq!(c.name, "Exemple");
    assert!(redirect_matches(&c, "https://client.example/callback"));
    assert!(!redirect_matches(&c, "https://client.example/other"));

    let mismatch = json!({"client_id": "https://autre.example/x", "redirect_uris": ["https://autre.example/cb"]});
    assert!(client_from_url_doc(
        "https://client.example/oauth/metadata.json",
        Some(&mismatch)
    )
    .is_err());
}

#[test]
fn loopback_redirect_accepts_any_port() {
    let c = ClientInfo {
        client_id: "dfc_x".into(),
        name: "CLI".into(),
        redirect_uris: vec!["http://127.0.0.1:5000/callback".into()],
        origin_rule: None,
    };
    assert!(redirect_matches(&c, "http://127.0.0.1:61234/callback"));
    assert!(!redirect_matches(&c, "http://127.0.0.1:61234/autre"));
}

#[test]
fn scope_and_resource_rules() {
    assert_eq!(granted_scope(None), "mcp");
    assert_eq!(granted_scope(Some("openid profile")), "mcp");
    assert_eq!(
        granted_scope(Some("mcp offline_access")),
        "mcp offline_access"
    );
    assert!(resource_ok(BASE, "https://web.jeser.app/api/v1/mcp"));
    assert!(resource_ok(BASE, "https://web.jeser.app/"));
    assert!(!resource_ok(BASE, "https://web.jeser.app.evil.io/mcp"));
    assert!(!resource_ok(BASE, "https://autre.example/mcp"));
}

#[test]
fn form_parsing_decodes_values() {
    let p =
        parse_form("grant_type=authorization_code&redirect_uri=https%3A%2F%2Fgrok.com%2Fcb&x=a+b");
    assert_eq!(p["grant_type"], "authorization_code");
    assert_eq!(p["redirect_uri"], "https://grok.com/cb");
    assert_eq!(p["x"], "a b");
}

#[test]
fn private_addresses_are_not_fetched() {
    assert!(!is_public_ip("10.1.0.88".parse().unwrap()));
    assert!(!is_public_ip("127.0.0.1".parse().unwrap()));
    assert!(!is_public_ip("169.254.1.1".parse().unwrap()));
    assert!(!is_public_ip("::1".parse().unwrap()));
    assert!(is_public_ip("1.1.1.1".parse().unwrap()));
}

/// Postgres de test joignable ? (sinon le test DB est ignoré, comme en CI sans conteneur).
async fn test_pool() -> Option<sqlx::PgPool> {
    let url = std::env::var("DEVFORGE_TEST_PG").unwrap_or_else(|_| {
        "postgres://devforge:devforge@127.0.0.1:54329/postgres?sslmode=disable".into()
    });
    let probe = tokio::time::timeout(
        std::time::Duration::from_secs(3),
        sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .connect(&url),
    )
    .await;
    match probe {
        Ok(Ok(p)) => {
            p.close().await;
            Some(devforge_database::ephemeral_pg().await)
        }
        _ => {
            eprintln!("Postgres de test injoignable — test OAuth DB ignoré");
            None
        }
    }
}

#[tokio::test]
async fn dcr_code_token_refresh_flow() {
    let Some(pool) = test_pool().await else {
        return;
    };
    migrate(&pool).await.unwrap();
    sqlx::query(
        "CREATE TABLE users (uuid TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL)",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO users VALUES ('u1', 'mathieu@example.com', 'Mathieu', '', 'instance_admin')",
    )
    .execute(&pool)
    .await
    .unwrap();

    // DCR
    let (status, reg) = body_json(
        register_client_core(
            &pool,
            br#"{"client_name":"Grok","redirect_uris":["https://grok.com/connectors-oauth-exchange-code"],"token_endpoint_auth_method":"none"}"#,
        )
        .await,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let client_id = reg["client_id"].as_str().unwrap().to_string();
    assert!(client_id.starts_with("dfc_"));
    assert!(reg.get("client_secret").is_none());

    let client = resolve_client(&pool, &client_id).await.unwrap();
    assert!(redirect_matches(
        &client,
        "https://grok.com/connectors-oauth-exchange-code"
    ));
    assert!(!redirect_matches(&client, "https://grok.com/autre"));

    // DCR refuse une redirection http non loopback
    let (status, _) = body_json(
        register_client_core(&pool, br#"{"redirect_uris":["http://evil.example/cb"]}"#).await,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // Code (consentement accordé) → token
    let verifier = "dBjftJeZ4CVP-mA92Q-_ogxo4uFb0bk1Re5c3hF0UPA";
    let redirect = "https://grok.com/connectors-oauth-exchange-code";
    let code = insert_code(
        &pool,
        &client_id,
        "Grok",
        "u1",
        redirect,
        &pkce_s256(verifier),
        "mcp",
        "",
    )
    .await
    .unwrap();

    // Mauvais verifier → invalid_grant (sans consommer le code)
    let mut p = HashMap::new();
    p.insert("grant_type".to_string(), "authorization_code".to_string());
    p.insert("code".to_string(), code.clone());
    p.insert("redirect_uri".to_string(), redirect.to_string());
    p.insert("client_id".to_string(), client_id.clone());
    p.insert("code_verifier".to_string(), "x".repeat(43));
    let (status, err) = body_json(token_from_code(&pool, &p, &client_id, None).await).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(err["error"], "invalid_grant");

    p.insert("code_verifier".to_string(), verifier.to_string());
    let (status, tok) = body_json(token_from_code(&pool, &p, &client_id, None).await).await;
    assert_eq!(status, StatusCode::OK, "{tok}");
    assert_eq!(tok["token_type"], "Bearer");
    let access = tok["access_token"].as_str().unwrap().to_string();
    let refresh = tok["refresh_token"].as_str().unwrap().to_string();
    assert!(access.starts_with(ACCESS_TOKEN_PREFIX));

    let (user, abilities) = resolve_access_token(&pool, &access).await.unwrap().unwrap();
    assert_eq!(user.uuid, "u1");
    assert!(abilities.contains(&"write".to_string()));
    assert!(resolve_access_token(&pool, "dfoa_inconnu")
        .await
        .unwrap()
        .is_none());
    assert!(resolve_access_token(&pool, "dfat_pas_oauth")
        .await
        .unwrap()
        .is_none());

    // Rejeu du code → refusé + tokens émis révoqués
    let (status, _) = body_json(token_from_code(&pool, &p, &client_id, None).await).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(resolve_access_token(&pool, &access)
        .await
        .unwrap()
        .is_none());

    // Nouveau code → refresh tournant
    let code2 = insert_code(
        &pool,
        &client_id,
        "Grok",
        "u1",
        redirect,
        &pkce_s256(verifier),
        "mcp",
        "",
    )
    .await
    .unwrap();
    p.insert("code".to_string(), code2);
    let (_, tok) = body_json(token_from_code(&pool, &p, &client_id, None).await).await;
    let refresh = {
        let _ = refresh;
        tok["refresh_token"].as_str().unwrap().to_string()
    };
    let mut r = HashMap::new();
    r.insert("grant_type".to_string(), "refresh_token".to_string());
    r.insert("refresh_token".to_string(), refresh.clone());
    let (status, tok2) = body_json(token_from_refresh(&pool, &r, "", None).await).await;
    assert_eq!(status, StatusCode::OK, "{tok2}");
    let access2 = tok2["access_token"].as_str().unwrap();
    assert!(resolve_access_token(&pool, access2)
        .await
        .unwrap()
        .is_some());
    // L'ancien refresh ne sert plus
    let (status, _) = body_json(token_from_refresh(&pool, &r, "", None).await).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    // Refresh présenté par un autre client → refusé
    r.insert(
        "refresh_token".to_string(),
        tok2["refresh_token"].as_str().unwrap().to_string(),
    );
    let (status, _) = body_json(token_from_refresh(&pool, &r, "dfc_autre", None).await).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn confidential_dcr_client_needs_secret() {
    let Some(pool) = test_pool().await else {
        return;
    };
    migrate(&pool).await.unwrap();
    let (status, reg) = body_json(
        register_client_core(
            &pool,
            br#"{"redirect_uris":["https://grok.com/cb"],"token_endpoint_auth_method":"client_secret_post"}"#,
        )
        .await,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let id = reg["client_id"].as_str().unwrap();
    let secret = reg["client_secret"].as_str().unwrap();
    assert!(authenticate_client(&pool, id, None).await.is_err());
    assert!(authenticate_client(&pool, id, Some("mauvais"))
        .await
        .is_err());
    assert!(authenticate_client(&pool, id, Some(secret)).await.is_ok());
    assert!(authenticate_client(&pool, "dfc_inconnu", None)
        .await
        .is_err());
    assert!(authenticate_client(&pool, "https://grok.com", None)
        .await
        .is_ok());
}

#[test]
fn mcp_protocol_version_negotiation() {
    use crate::mcp_routes::negotiate_protocol_version as neg;
    assert_eq!(neg(Some("2025-06-18")), "2025-06-18");
    assert_eq!(neg(Some("2025-03-26")), "2025-03-26");
    assert_eq!(neg(Some("1999-01-01")), "2025-11-25");
    assert_eq!(neg(None), "2024-11-05");
}
