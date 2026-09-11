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
