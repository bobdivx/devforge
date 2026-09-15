//! SSO OIDC pour apps (IdP externe générique ou Pocket ID) — ForwardAuth Traefik + env OIDC.

use chrono::Utc;
use serde::Serialize;
use sqlx::FromRow;

use crate::state::{AppState, Project};

pub const MIDDLEWARE_NAME: &str = "devforge-sso-auth";
pub const PROVIDER_GENERIC: &str = "generic";
pub const PROVIDER_POCKET_ID: &str = "pocket_id";

#[derive(Debug, Clone, Default, Serialize, FromRow)]
pub struct SsoSettings {
    pub sso_protect_apps_by_default: i64,
    pub sso_forward_auth_address: String,
    pub sso_hide_local_login: i64,
    pub sso_pocket_id_url: String,
    pub sso_oauth2_proxy_url: String,
    pub sso_apps_client_id: String,
    pub sso_apps_client_secret: String,
    pub sso_pocket_id_api_token: String,
    pub sso_oidc_provider: String,
    pub sso_enable_platform_login: i64,
}

impl SsoSettings {
    pub fn protect_by_default(&self) -> bool {
        self.sso_protect_apps_by_default != 0
    }

    pub fn hide_local_login(&self) -> bool {
        self.sso_hide_local_login != 0
    }

    pub fn enable_platform_login(&self) -> bool {
        self.sso_enable_platform_login != 0
    }

    pub fn forward_auth_configured(&self) -> bool {
        !self.sso_forward_auth_address.trim().is_empty()
    }

    pub fn provider(&self) -> &str {
        let p = self.sso_oidc_provider.trim();
        if p == PROVIDER_POCKET_ID {
            PROVIDER_POCKET_ID
        } else {
            PROVIDER_GENERIC
        }
    }

    pub fn is_pocket_id(&self) -> bool {
        self.provider() == PROVIDER_POCKET_ID
    }

    pub fn oidc_configured(&self) -> bool {
        !self.sso_pocket_id_url.trim().is_empty() && !self.sso_apps_client_id.trim().is_empty()
    }

    /// Issuer OIDC (colonne historique `sso_pocket_id_url`).
    pub fn issuer(&self) -> &str {
        self.sso_pocket_id_url.trim().trim_end_matches('/')
    }

    /// Adresse ForwardAuth effective (interne docker prioritaire, sinon URL publique proxy).
    pub fn effective_forward_auth_address(&self) -> Option<String> {
        let internal = self.sso_forward_auth_address.trim();
        if !internal.is_empty() {
            return Some(normalize_forward_auth(internal));
        }
        let public = self.sso_oauth2_proxy_url.trim();
        if !public.is_empty() {
            return Some(normalize_forward_auth(public));
        }
        None
    }
}

pub fn normalize_provider(raw: &str) -> String {
    match raw.trim().to_lowercase().as_str() {
        "pocket_id" | "pocket-id" | "pocketid" => PROVIDER_POCKET_ID.to_string(),
        _ => PROVIDER_GENERIC.to_string(),
    }
}

fn normalize_forward_auth(addr: &str) -> String {
    let a = addr.trim();
    if a.ends_with('/') {
        a.to_string()
    } else {
        format!("{a}/")
    }
}

pub async fn load_sso_settings(pool: &sqlx::SqlitePool) -> SsoSettings {
    let row: Option<SsoSettings> = sqlx::query_as(
        r#"SELECT sso_protect_apps_by_default, sso_forward_auth_address, sso_hide_local_login,
                  sso_pocket_id_url, sso_oauth2_proxy_url, sso_apps_client_id, sso_apps_client_secret,
                  sso_pocket_id_api_token, sso_oidc_provider, sso_enable_platform_login
           FROM instance_settings WHERE id = 1"#,
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    row.unwrap_or_default()
}

/// Logique alpha : ForwardAuth seulement si adresse configurée + règles projet.
pub fn should_protect_project(settings: &SsoSettings, project: &Project) -> bool {
    if settings.effective_forward_auth_address().is_none() {
        return false;
    }
    if project.has_own_user_system == Some(1) {
        return false;
    }
    match project.is_sso_protected {
        Some(0) => false,
        Some(_) => true,
        None => {
            if project.has_own_user_system == Some(0) {
                settings.protect_by_default()
            } else {
                false
            }
        }
    }
}

pub async fn sync_project_proxy(state: &AppState, project: &Project) {
    let settings = load_sso_settings(&state.pool).await;
    let addr = if should_protect_project(&settings, project) {
        settings.effective_forward_auth_address()
    } else {
        None
    };
    let _ = state
        .proxy
        .sync_with(&project.uuid, addr.as_deref())
        .await;
}

/// Injecte les variables OIDC manquantes.
/// 
/// Priorise les credentials du client OIDC dédié du projet si disponibles,
/// sinon utilise le client partagé de la plateforme.
/// 
/// **Migration** : Pour les projets existants, remplace les anciennes valeurs
/// du client partagé par celles du client dédié si un provisionnement a été effectué.
pub async fn ensure_oidc_env(pool: &sqlx::SqlitePool, project: &Project) -> usize {
    let settings = load_sso_settings(pool).await;
    if !settings.oidc_configured() {
        return 0;
    }
    let issuer = settings.issuer().to_string();
    if issuer.is_empty() {
        return 0;
    }
    
    let project_client = crate::project_oidc::load_project_oidc_client(pool, &project.uuid).await;
    
    let (client_id, client_secret, force_update) = if let Some(pc) = project_client {
        (pc.client_id, pc.client_secret, true)
    } else {
        (
            settings.sso_apps_client_id.trim().to_string(),
            settings.sso_apps_client_secret.trim().to_string(),
            false,
        )
    };
    
    let discovery = format!("{issuer}/.well-known/openid-configuration");

    let mut pairs: Vec<(&str, String, bool)> = vec![
        ("OIDC_ISSUER", issuer.clone(), false),
        ("OIDC_ISSUER_URL", issuer.clone(), false),
        ("OIDC_DISCOVERY_URL", discovery, false),
        ("OIDC_CLIENT_ID", client_id.clone(), false),
        ("OIDC_SCOPES", "openid email profile".into(), false),
        ("OIDC_PROVIDER", settings.provider().to_string(), false),
    ];
    if settings.is_pocket_id() {
        pairs.push(("POCKET_ID_URL", issuer.clone(), false));
        pairs.push(("AUTH_POCKET_ID_ID", client_id.clone(), false));
        pairs.push(("AUTH_POCKET_ID_ISSUER", issuer.clone(), false));
    }
    if !client_secret.is_empty() {
        pairs.push(("OIDC_CLIENT_SECRET", client_secret.clone(), true));
        if settings.is_pocket_id() {
            pairs.push(("AUTH_POCKET_ID_SECRET", client_secret, true));
        }
    }

    if let Some(origin) = app_origin(project.production_url.as_deref()) {
        pairs.push(("AUTH_URL", origin.clone(), false));
        pairs.push(("NEXTAUTH_URL", origin.clone(), false));
        pairs.push(("AUTH_TRUST_HOST", "true".into(), false));
        let callback_path = if settings.is_pocket_id() {
            "pocket-id"
        } else {
            "oidc"
        };
        let redirect = format!("{origin}/api/auth/callback/{callback_path}");
        pairs.push(("OIDC_REDIRECT_URI", redirect.clone(), false));
        if settings.is_pocket_id() {
            pairs.push(("AUTH_POCKET_ID_REDIRECT_URI", redirect, false));
        }
    }

    let now = Utc::now().to_rfc3339();
    let mut inserted = 0usize;
    for (key, value, secret) in pairs {
        let should_update = if force_update {
            matches!(
                key,
                "OIDC_CLIENT_ID"
                    | "OIDC_CLIENT_SECRET"
                    | "AUTH_POCKET_ID_ID"
                    | "AUTH_POCKET_ID_SECRET"
                    | "OIDC_REDIRECT_URI"
                    | "AUTH_POCKET_ID_REDIRECT_URI"
            )
        } else {
            false
        };
        
        if should_update {
            let res = sqlx::query(
                r#"INSERT INTO project_env_vars (project_uuid, key, value, secret, updated_at)
                   VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT(project_uuid, key) DO UPDATE SET
                     value = excluded.value,
                     secret = excluded.secret,
                     updated_at = excluded.updated_at"#,
            )
            .bind(&project.uuid)
            .bind(key)
            .bind(&value)
            .bind(if secret { 1i64 } else { 0 })
            .bind(&now)
            .execute(pool)
            .await;
            if res.is_ok() {
                inserted += 1;
            }
        } else {
            let exists: Option<(i64,)> = sqlx::query_as(
                "SELECT 1 FROM project_env_vars WHERE project_uuid = ? AND key = ?",
            )
            .bind(&project.uuid)
            .bind(key)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();
            if exists.is_some() {
                continue;
            }
            let res = sqlx::query(
                r#"INSERT INTO project_env_vars (project_uuid, key, value, secret, updated_at)
                   VALUES (?, ?, ?, ?, ?)"#,
            )
            .bind(&project.uuid)
            .bind(key)
            .bind(&value)
            .bind(if secret { 1i64 } else { 0 })
            .bind(&now)
            .execute(pool)
            .await;
            if res.is_ok() {
                inserted += 1;
            }
        }
    }
    inserted
}

fn app_origin(production_url: Option<&str>) -> Option<String> {
    let raw = production_url?.trim();
    if raw.is_empty() {
        return None;
    }
    let (scheme, rest) = if let Some(r) = raw.strip_prefix("https://") {
        ("https", r)
    } else if let Some(r) = raw.strip_prefix("http://") {
        ("http", r)
    } else {
        ("https", raw)
    };
    let hostport = rest.split('/').next()?.split('?').next()?.trim();
    if hostport.is_empty() {
        return None;
    }
    Some(format!("{scheme}://{hostport}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(is_sso: Option<i64>, own: Option<i64>) -> Project {
        Project {
            id: 1,
            uuid: "u".into(),
            name: "n".into(),
            slug: "s".into(),
            status: "ready".into(),
            git_repository: None,
            git_branch: None,
            server_id: None,
            workdir: None,
            test_command: None,
            production_url: None,
            workspace_uuid: "".into(),
            build_pack: "nixpacks".into(),
            port: 3000,
            is_static: 0,
            is_sso_protected: is_sso,
            has_own_user_system: own,
            publish_directory: None,
            base_directory: "/".into(),
            docker_compose_location: None,
            auto_deploy: 1,
            created_at: "".into(),
            updated_at: "".into(),
        }
    }

    #[test]
    fn protect_requires_forward_auth() {
        let mut s = SsoSettings::default();
        s.sso_protect_apps_by_default = 1;
        assert!(!should_protect_project(&s, &project(Some(1), Some(0))));
        s.sso_forward_auth_address = "http://oauth2-proxy:4180".into();
        assert!(should_protect_project(&s, &project(Some(1), Some(0))));
    }

    #[test]
    fn own_user_system_skips_barrier() {
        let mut s = SsoSettings::default();
        s.sso_forward_auth_address = "http://x:4180/".into();
        assert!(!should_protect_project(&s, &project(Some(1), Some(1))));
    }

    #[test]
    fn inherit_default_when_own_explicit_false() {
        let mut s = SsoSettings::default();
        s.sso_forward_auth_address = "http://x:4180/".into();
        s.sso_protect_apps_by_default = 1;
        assert!(should_protect_project(&s, &project(None, Some(0))));
        assert!(!should_protect_project(&s, &project(None, None)));
    }
}
