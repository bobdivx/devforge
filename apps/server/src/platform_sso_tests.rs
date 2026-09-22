//! Tests pour la connexion SSO plateforme DevForge.

#[cfg(test)]
mod platform_sso_tests {
    use crate::sso::SsoSettings;

    #[test]
    fn test_enable_platform_login_default_false() {
        let cfg = SsoSettings::default();
        assert!(!cfg.enable_platform_login());
    }

    #[test]
    fn test_enable_platform_login_when_set() {
        let mut cfg = SsoSettings::default();
        cfg.sso_enable_platform_login = 1;
        assert!(cfg.enable_platform_login());
        assert!(cfg.platform_login_effective());
    }

    #[test]
    fn pocket_id_opens_devforge_login_without_extra_flag() {
        let mut cfg = SsoSettings::default();
        cfg.sso_oidc_provider = "pocket_id".into();
        cfg.sso_pocket_id_url = "https://id.example.com".into();
        cfg.sso_apps_client_id = "devforge".into();
        assert!(!cfg.enable_platform_login());
        assert!(cfg.platform_login_effective());
    }

    #[test]
    fn test_hide_local_login_requires_platform_sso() {
        // La logique métier : hide_local_login doit être utilisé uniquement
        // quand le SSO plateforme est activé ET OIDC configuré.
        // Pas de force ici, juste documentation via tests.
        
        let mut cfg = SsoSettings::default();
        cfg.sso_hide_local_login = 1;
        cfg.sso_enable_platform_login = 0;
        
        // Le flag hide_local_login est activé, mais sans platform SSO,
        // le frontend devrait ignorer ou l'admin devrait voir un avertissement.
        assert!(cfg.hide_local_login());
        assert!(!cfg.enable_platform_login());
    }

    #[test]
    fn test_oidc_configured_minimal() {
        let mut cfg = SsoSettings::default();
        cfg.sso_pocket_id_url = "https://id.example.com".to_string();
        cfg.sso_apps_client_id = "devforge".to_string();
        assert!(cfg.oidc_configured());
    }

    #[test]
    fn test_oidc_not_configured_when_missing_issuer() {
        let mut cfg = SsoSettings::default();
        cfg.sso_apps_client_id = "devforge".to_string();
        assert!(!cfg.oidc_configured());
    }

    #[test]
    fn test_oidc_not_configured_when_missing_client_id() {
        let mut cfg = SsoSettings::default();
        cfg.sso_pocket_id_url = "https://id.example.com".to_string();
        assert!(!cfg.oidc_configured());
    }
}

#[cfg(test)]
mod endpoint_resolution_tests {
    use super::*;
    use crate::sso::SsoSettings;
    use crate::platform_sso::{OidcDiscoveryDocument, OidcEndpoints, build_authorization_url, resolve_oidc_endpoints};

    #[tokio::test]
    async fn test_pocket_id_fallback_endpoints() {
        let mut cfg = SsoSettings::default();
        cfg.sso_pocket_id_url = "https://id.jeser.app".to_string();
        cfg.sso_oidc_provider = "pocket_id".to_string();
        
        let endpoints = resolve_oidc_endpoints(&cfg).await;
        
        assert_eq!(endpoints.token_endpoint, "https://id.jeser.app/api/oidc/token");
        assert_eq!(endpoints.userinfo_endpoint, "https://id.jeser.app/api/oidc/userinfo");
        assert_eq!(endpoints.authorization_endpoint, Some("https://id.jeser.app/authorize".to_string()));
    }

    #[tokio::test]
    async fn test_generic_oidc_fallback_endpoints() {
        let mut cfg = SsoSettings::default();
        cfg.sso_pocket_id_url = "https://id.example.com".to_string();
        cfg.sso_oidc_provider = "generic".to_string();
        
        let endpoints = resolve_oidc_endpoints(&cfg).await;
        
        assert_eq!(endpoints.token_endpoint, "https://id.example.com/token");
        assert_eq!(endpoints.userinfo_endpoint, "https://id.example.com/userinfo");
        assert_eq!(endpoints.authorization_endpoint, Some("https://id.example.com/authorize".to_string()));
    }

    #[test]
    fn test_discovery_document_parsing() {
        let json = r#"{
            "issuer": "https://id.example.com",
            "authorization_endpoint": "https://id.example.com/oauth/authorize",
            "token_endpoint": "https://id.example.com/oauth/token",
            "userinfo_endpoint": "https://id.example.com/oauth/userinfo"
        }"#;
        
        let doc: OidcDiscoveryDocument = serde_json::from_str(json).unwrap();
        
        assert_eq!(doc.authorization_endpoint, Some("https://id.example.com/oauth/authorize".to_string()));
        assert_eq!(doc.token_endpoint, Some("https://id.example.com/oauth/token".to_string()));
        assert_eq!(doc.userinfo_endpoint, Some("https://id.example.com/oauth/userinfo".to_string()));
    }

    #[test]
    fn test_discovery_document_minimal() {
        let json = r#"{
            "issuer": "https://id.example.com",
            "token_endpoint": "https://id.example.com/token",
            "userinfo_endpoint": "https://id.example.com/userinfo"
        }"#;
        
        let doc: OidcDiscoveryDocument = serde_json::from_str(json).unwrap();
        
        assert_eq!(doc.authorization_endpoint, None);
        assert_eq!(doc.token_endpoint, Some("https://id.example.com/token".to_string()));
        assert_eq!(doc.userinfo_endpoint, Some("https://id.example.com/userinfo".to_string()));
    }

    #[test]
    fn test_build_authorization_url_with_discovered_endpoint() {
        let mut cfg = SsoSettings::default();
        cfg.sso_pocket_id_url = "https://id.example.com".to_string();
        cfg.sso_apps_client_id = "test-client".to_string();
        
        let endpoints = OidcEndpoints {
            authorization_endpoint: Some("https://id.example.com/custom/authorize".to_string()),
            token_endpoint: "https://id.example.com/custom/token".to_string(),
            userinfo_endpoint: "https://id.example.com/custom/userinfo".to_string(),
        };
        
        let url = build_authorization_url(&cfg, &endpoints, "state123", "nonce456", "https://app.example.com/callback", "challenge789");
        
        assert!(url.starts_with("https://id.example.com/custom/authorize?"));
        assert!(url.contains("client_id=test-client"));
        assert!(url.contains("state=state123"));
        assert!(url.contains("nonce=nonce456"));
        assert!(url.contains("code_challenge=challenge789"));
        assert!(url.contains("code_challenge_method=S256"));
    }

    #[test]
    fn test_build_authorization_url_fallback_when_no_endpoint() {
        let mut cfg = SsoSettings::default();
        cfg.sso_pocket_id_url = "https://id.example.com".to_string();
        cfg.sso_apps_client_id = "test-client".to_string();
        
        let endpoints = OidcEndpoints {
            authorization_endpoint: None,
            token_endpoint: "https://id.example.com/token".to_string(),
            userinfo_endpoint: "https://id.example.com/userinfo".to_string(),
        };
        
        let url = build_authorization_url(&cfg, &endpoints, "state123", "nonce456", "https://app.example.com/callback", "challenge789");
        
        assert!(url.starts_with("https://id.example.com/authorize?"));
        assert!(url.contains("code_challenge=challenge789"));
        assert!(url.contains("code_challenge_method=S256"));
    }
}

#[cfg(test)]
mod pkce_tests {
    use super::*;
    use crate::platform_sso::{compute_code_challenge};

    #[test]
    fn test_compute_code_challenge_known_vector() {
        // RFC 7636 example
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let challenge = compute_code_challenge(verifier);
        // Expected: E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
        assert_eq!(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn test_compute_code_challenge_no_padding() {
        let verifier = "test";
        let challenge = compute_code_challenge(verifier);
        // Vérifier absence de padding '='
        assert!(!challenge.contains('='));
        // Vérifier caractères base64url uniquement
        assert!(challenge.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    }

    #[test]
    fn test_code_challenge_deterministic() {
        let verifier = "my_test_verifier_123";
        let challenge1 = compute_code_challenge(verifier);
        let challenge2 = compute_code_challenge(verifier);
        assert_eq!(challenge1, challenge2);
    }
}
