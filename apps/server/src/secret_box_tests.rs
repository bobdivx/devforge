use super::*;

fn key(b: u8) -> SecretBox {
    SecretBox::from_key(&[b; 32])
}

#[test]
fn roundtrip() {
    let sb = key(7);
    let sealed = sb.seal(b"-----BEGIN RSA PRIVATE KEY-----\nabc");
    assert!(sealed.starts_with("v1:"));
    assert!(!sealed.contains("BEGIN RSA"));
    assert_eq!(
        sb.open(&sealed).unwrap().as_slice(),
        b"-----BEGIN RSA PRIVATE KEY-----\nabc"
    );
}

#[test]
fn nonce_differs_each_seal() {
    let sb = key(7);
    let a = sb.seal(b"same");
    let b = sb.seal(b"same");
    assert_ne!(a, b);
    let na = a.split(':').nth(1).unwrap();
    let nb = b.split(':').nth(1).unwrap();
    assert_ne!(na, nb);
}

#[test]
fn tampered_byte_fails() {
    let sb = key(7);
    let sealed = sb.seal(b"secret value");
    let ct_b64 = sealed.rsplit(':').next().unwrap();
    let mut ct = B64.decode(ct_b64).unwrap();
    ct[0] ^= 0x01;
    let prefix = &sealed[..sealed.len() - ct_b64.len()];
    let tampered = format!("{prefix}{}", B64.encode(ct));
    assert_eq!(sb.open(&tampered).unwrap_err(), SecretError::Decrypt);
}

#[test]
fn wrong_key_fails() {
    let sealed = key(1).seal(b"secret value");
    assert_eq!(key(2).open(&sealed).unwrap_err(), SecretError::Decrypt);
}

#[test]
fn malformed_is_format_error() {
    let sb = key(1);
    assert_eq!(sb.open("ghp_plain").unwrap_err(), SecretError::Format);
    assert_eq!(sb.open("v1:nope").unwrap_err(), SecretError::Format);
}

#[test]
fn env_key_must_be_32_bytes() {
    assert!(matches!(
        SecretBox::from_b64(&B64.encode([0u8; 16])),
        Err(SecretError::Key(_))
    ));
    assert!(SecretBox::from_b64(&B64.encode([0u8; 32])).is_ok());
}

#[test]
fn key_file_created_0600_and_reused() {
    let dir = std::env::temp_dir().join(format!("df-sb-{}", uuid::Uuid::new_v4()));
    let a = SecretBox::load(None, &dir).unwrap();
    let path = dir.join(KEY_FILE);
    assert!(path.is_file());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }
    let sealed = a.seal(b"x");
    let b = SecretBox::load(None, &dir).unwrap();
    assert_eq!(b.open(&sealed).unwrap().as_slice(), b"x");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn env_key_takes_precedence_over_file() {
    let dir = std::env::temp_dir().join(format!("df-sb-{}", uuid::Uuid::new_v4()));
    let env = B64.encode([9u8; 32]);
    let a = SecretBox::load(Some(&env), &dir).unwrap();
    assert!(!dir.join(KEY_FILE).exists());
    assert_eq!(key(9).open(&a.seal(b"y")).unwrap().as_slice(), b"y");
}

#[test]
fn redacted_debug_hides_value() {
    let r = Redacted::new("ghs_supersecret".to_string());
    assert_eq!(format!("{r:?}"), "***");
    assert_eq!(format!("{r}"), "***");
    assert_eq!(r.expose(), "ghs_supersecret");
}

#[tokio::test]
async fn github_app_migration_idempotent_and_pat_sealed() {
    if std::env::var(KEY_ENV).is_err() {
        std::env::set_var(KEY_ENV, B64.encode([3u8; 32]));
    }
    global().expect("coffre de test");
    let pool = devforge_database::ephemeral_pg().await;
    crate::db::migrate(&pool).await.unwrap();
    sqlx::query("INSERT INTO user_settings (user_uuid, wildcard_domain, github_token, updated_at) VALUES ('u1', '', 'ghp_legacyplain', '')")
        .execute(&pool).await.unwrap();
    sqlx::query("UPDATE instance_settings SET github_token = 'ghp_instanceplain' WHERE id = 1")
        .execute(&pool)
        .await
        .unwrap();
    // Deuxième passage : aucune erreur, scelle les PAT en clair.
    crate::db::migrate(&pool).await.unwrap();
    crate::db::migrate(&pool).await.unwrap();

    let (stored,): (String,) =
        sqlx::query_as("SELECT github_token FROM user_settings WHERE user_uuid = 'u1'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(stored.starts_with("v1:") && !stored.contains("ghp_"));
    assert_eq!(
        crate::user_prefs::github_token(&pool, "u1").await,
        "ghp_legacyplain"
    );
    let (inst,): (String,) =
        sqlx::query_as("SELECT github_token FROM instance_settings WHERE id = 1")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(inst.starts_with("v1:"));
    assert_eq!(open_compat(&inst), "ghp_instanceplain");

    // Écriture : re-scellée.
    crate::user_prefs::set_github_token(&pool, "u2", "ghp_new")
        .await
        .unwrap();
    let (s2,): (String,) =
        sqlx::query_as("SELECT github_token FROM user_settings WHERE user_uuid = 'u2'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(s2.starts_with("v1:"));
    assert_eq!(
        crate::user_prefs::github_token(&pool, "u2").await,
        "ghp_new"
    );

    // Validation P0 : une clé privée stockée scellée ne contient jamais `BEGIN RSA`.
    let pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEfake\n-----END RSA PRIVATE KEY-----\n";
    sqlx::query("INSERT INTO github_app (id, app_id, slug, client_id, client_secret_enc, webhook_secret_enc, private_key_enc, html_url, owner_login) VALUES (1, 1, 's', 'c', $1, $2, $3, 'h', 'o')")
        .bind(seal(b"cs").unwrap()).bind(seal(b"ws").unwrap()).bind(seal(pem.as_bytes()).unwrap())
        .execute(&pool).await.unwrap();
    let (pk,): (String,) = sqlx::query_as("SELECT private_key_enc FROM github_app")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(!pk.contains("BEGIN RSA"));
    assert_eq!(open(&pk).unwrap().as_slice(), pem.as_bytes());

    let (n,): (i64,) = sqlx::query_as("SELECT count(*) FROM information_schema.columns WHERE table_name = 'projects' AND column_name IN ('github_installation_id','github_repo_id','pr_previews_enabled','legacy_webhook_id')")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(n, 4);
}
