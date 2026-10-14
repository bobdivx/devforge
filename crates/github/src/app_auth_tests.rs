use super::*;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

/// Clé RSA de test générée à la volée (jamais committée). `None` si openssl absent.
fn test_keys() -> Option<(String, String)> {
    let dir = std::env::temp_dir().join(format!("df-gh-{}-{}", std::process::id(), rand_suffix()));
    std::fs::create_dir_all(&dir).ok()?;
    let k = dir.join("k.pem");
    let p = dir.join("k.pub");
    let ok = std::process::Command::new("openssl")
        .args(["genrsa", "-traditional", "-out"])
        .arg(&k)
        .arg("2048")
        .output()
        .ok()?
        .status
        .success()
        && std::process::Command::new("openssl")
            .args(["rsa", "-pubout", "-in"])
            .arg(&k)
            .arg("-out")
            .arg(&p)
            .output()
            .ok()?
            .status
            .success();
    if !ok {
        return None;
    }
    let r = (
        std::fs::read_to_string(&k).ok()?,
        std::fs::read_to_string(&p).ok()?,
    );
    let _ = std::fs::remove_dir_all(&dir);
    Some(r)
}

fn rand_suffix() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos()
}

fn token_body(tok: &str, in_secs: i64) -> Value {
    let exp = chrono::Utc::now() + chrono::Duration::seconds(in_secs);
    json!({"token": tok, "expires_at": exp.to_rfc3339()})
}

#[test]
fn jwt_claims_and_signature() {
    let Some((pem, pubk)) = test_keys() else {
        eprintln!("openssl absent");
        return;
    };
    let creds = AppCredentials::new(4242, pem);
    assert_eq!(
        format!("{creds:?}"),
        "AppCredentials { app_id: 4242, private_key: *** }"
    );
    let jwt = creds.app_jwt().unwrap();
    assert_eq!(format!("{jwt:?}"), "***");
    let mut v = jsonwebtoken::Validation::new(jsonwebtoken::Algorithm::RS256);
    v.set_issuer(&["4242"]);
    v.set_required_spec_claims(&["exp", "iat", "iss"]);
    let c = jsonwebtoken::decode::<Value>(
        jwt.expose(),
        &jsonwebtoken::DecodingKey::from_rsa_pem(pubk.as_bytes()).unwrap(),
        &v,
    )
    .unwrap()
    .claims;
    let (iat, exp) = (c["iat"].as_i64().unwrap(), c["exp"].as_i64().unwrap());
    assert!(exp - iat <= 600);
    let now = chrono::Utc::now().timestamp();
    assert!(iat <= now - 59 && exp <= now + 541);
    assert!(AppCredentials::new(1, "nope").app_jwt().is_err());
}

#[tokio::test]
async fn concurrent_gets_single_post_then_cached() {
    let Some((pem, _)) = test_keys() else {
        return;
    };
    let gh = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/app/installations/7/access_tokens"))
        .respond_with(
            ResponseTemplate::new(201)
                .set_body_json(token_body("ghs_cachedtoken1234", 3600))
                .set_delay(std::time::Duration::from_millis(150)),
        )
        .expect(1)
        .mount(&gh)
        .await;
    let cache = Arc::new(InstallationTokenCache::new(gh.uri()));
    let creds = AppCredentials::new(1, pem);
    let (a, b) = tokio::join!(cache.get(&creds, 7), cache.get(&creds, 7));
    assert_eq!(a.unwrap().expose(), "ghs_cachedtoken1234");
    assert_eq!(b.unwrap().expose(), "ghs_cachedtoken1234");
    // Troisième appel : servi par le cache.
    cache.get(&creds, 7).await.unwrap();
    gh.verify().await;
}

#[tokio::test]
async fn token_near_expiry_is_renewed() {
    let Some((pem, _)) = test_keys() else {
        return;
    };
    let gh = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/app/installations/8/access_tokens"))
        .respond_with(
            ResponseTemplate::new(201).set_body_json(token_body("ghs_renewedtoken123", 3600)),
        )
        .expect(1)
        .mount(&gh)
        .await;
    let cache = InstallationTokenCache::new(gh.uri());
    let now = chrono::Utc::now().timestamp();
    cache
        .seed(
            8,
            InstallationToken {
                token: SecretString::new("ghs_oldtoken12345"),
                expires_at: now + 240,
            },
        )
        .await;
    let t = cache.get(&AppCredentials::new(1, pem), 8).await.unwrap();
    assert_eq!(t.expose(), "ghs_renewedtoken123");
    assert!(cache.cached_expiry(8).await.unwrap() > now + 3000);
    // 6 min restantes : pas renouvelé.
    assert!(InstallationToken {
        token: SecretString::default(),
        expires_at: now + 360
    }
    .fresh_at(now));
    assert!(!InstallationToken {
        token: SecretString::default(),
        expires_at: now + 240
    }
    .fresh_at(now));
}

#[tokio::test]
async fn unauthorized_retries_once_then_fails() {
    let Some((pem, _)) = test_keys() else {
        return;
    };
    let gh = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/app/installations/9/access_tokens"))
        .respond_with(ResponseTemplate::new(401))
        .expect(2)
        .mount(&gh)
        .await;
    let cache = InstallationTokenCache::new(gh.uri());
    let e = cache
        .get(&AppCredentials::new(1, pem), 9)
        .await
        .unwrap_err();
    assert_eq!(e, TokenError::Unauthorized);
    gh.verify().await;
}

#[tokio::test]
async fn suspended_and_scoped_body() {
    let Some((pem, _)) = test_keys() else {
        return;
    };
    let gh = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/app/installations/10/access_tokens"))
        .respond_with(
            ResponseTemplate::new(403)
                .set_body_json(json!({"message": "This installation has been suspended"})),
        )
        .mount(&gh)
        .await;
    Mock::given(method("POST"))
        .and(path("/app/installations/11/access_tokens"))
        .and(wiremock::matchers::body_json(
            json!({"repository_ids": [55], "permissions": {"contents": "read"}}),
        ))
        .respond_with(
            ResponseTemplate::new(201).set_body_json(token_body("ghs_scopedtoken1234", 3600)),
        )
        .expect(1)
        .mount(&gh)
        .await;
    let cache = InstallationTokenCache::new(gh.uri());
    let creds = AppCredentials::new(1, pem);
    assert_eq!(
        cache.get(&creds, 10).await.unwrap_err(),
        TokenError::Suspended
    );
    let scope = TokenScope {
        repository_ids: vec![55],
        permissions: Some(json!({"contents": "read"})),
    };
    let t = cache.scoped(&creds, 11, &scope).await.unwrap();
    assert_eq!(t.token.expose(), "ghs_scopedtoken1234");
    // Jamais mis en cache.
    assert!(cache.cached_expiry(11).await.is_none());
}

#[test]
fn redacts_tokens_in_logs() {
    assert_eq!(
        redact_tokens("fatal: https://x-access-token:ghs_xxx@github.com/o/r.git"),
        "fatal: https://x-access-token:***@github.com/o/r.git"
    );
    assert_eq!(
        redact_tokens("token ghs_abcdefgh12345 end"),
        "token ghs_*** end"
    );
    assert_eq!(
        redact_tokens("pat github_pat_11ABCDEFG_xyz"),
        "pat github_pat_***"
    );
    assert_eq!(redact_tokens("ghp_short"), "ghp_short");
    assert_eq!(redact_tokens("rien à masquer — é"), "rien à masquer — é");
}
