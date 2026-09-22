//! Provisionnement de clients OIDC dédiés par projet déployé.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

use crate::pocket_id;
use crate::sso::load_sso_settings;
use crate::state::Project;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ProjectOidcClient {
    pub project_uuid: String,
    pub client_id: String,
    pub client_secret: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProvisionProjectResult {
    pub client_id: String,
    pub created_client: bool,
    pub created_secret: bool,
    pub callbacks: Vec<String>,
}

pub async fn load_project_oidc_client(
    pool: &sqlx::PgPool,
    project_uuid: &str,
) -> Option<ProjectOidcClient> {
    sqlx::query_as::<_, ProjectOidcClient>(
        "SELECT project_uuid, client_id, client_secret, created_at, updated_at 
         FROM project_oidc_clients WHERE project_uuid = $1",
    )
    .bind(project_uuid)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
}

/// Génère un client_id stable basé sur le slug du projet.
pub fn derive_client_id(project_slug: &str) -> String {
    let slug = project_slug.trim().to_lowercase();
    if slug.is_empty() {
        return format!("devforge-app-{}", uuid::Uuid::new_v4());
    }
    format!("devforge-app-{}", slug)
}

/// Construit les callback URLs précis pour un projet donné.
/// Inclut les variantes hostname (*.briseteia.me legacy, www.) pour couvrir les routes Traefik.
pub fn project_callback_urls(project: &Project) -> Vec<String> {
    let mut urls = Vec::new();

    if let Some(prod_url) = project.production_url.as_deref() {
        let origin = normalize_origin(prod_url);
        if !origin.is_empty() {
            let origins = derive_callback_origins(&origin);
            for base in &origins {
                urls.push(format!("{}/api/auth/callback/pocket-id", base));
                urls.push(format!("{}/api/auth/callback/pocket-id/", base));
                urls.push(format!("{}/api/auth/callback/oidc", base));
                urls.push(format!("{}/api/auth/callback/oidc/", base));
                urls.push(format!("{}/oauth2/callback", base));
                urls.push(format!("{}/oauth2/callback/", base));
            }
        }
    }

    urls
}

/// Origine de la preview atelier : `https://dev-{8 premiers caractères uuid}.{wildcard}`.
pub fn preview_origin(project_uuid: &str, wildcard_domain: &str) -> Option<String> {
    let domain = wildcard_domain
        .trim()
        .trim_start_matches('.')
        .to_lowercase();
    if domain.is_empty() || project_uuid.len() < 8 {
        return None;
    }
    let short: String = project_uuid.chars().take(8).collect();
    Some(format!("https://dev-{short}.{domain}"))
}

pub fn preview_callback_urls(project_uuid: &str, wildcard_domain: &str) -> Vec<String> {
    let Some(origin) = preview_origin(project_uuid, wildcard_domain) else {
        return Vec::new();
    };
    vec![
        format!("{origin}/api/auth/callback/pocket-id"),
        format!("{origin}/api/auth/callback/pocket-id/"),
        format!("{origin}/api/auth/callback/oidc"),
        format!("{origin}/api/auth/callback/oidc/"),
        format!("{origin}/oauth2/callback"),
        format!("{origin}/oauth2/callback/"),
    ]
}

/// Callbacks production + preview atelier.
pub async fn all_callback_urls(pool: &sqlx::PgPool, project: &Project) -> Vec<String> {
    let mut urls = project_callback_urls(project);
    let domain =
        crate::user_prefs::effective_wildcard_for_workspace(pool, &project.workspace_uuid).await;
    if !domain.is_empty() {
        urls.extend(preview_callback_urls(&project.uuid, &domain));
    }
    urls
}

/// Crée ou met à jour le client OIDC Pocket ID du projet.
/// `refresh_callbacks` force la mise à jour des URLs (deploy, changement d'URL).
/// Retourne true si un appel Pocket ID a eu lieu.
pub async fn sync_project_oidc_client(
    pool: &sqlx::PgPool,
    project: &Project,
    refresh_callbacks: bool,
) -> Result<bool, String> {
    let settings = load_sso_settings(pool).await;
    if !settings.is_pocket_id() || settings.sso_pocket_id_api_token.trim().is_empty() {
        return Ok(false);
    }
    if all_callback_urls(pool, project).await.is_empty() {
        return Ok(false);
    }
    let existing = load_project_oidc_client(pool, &project.uuid).await;
    if existing.is_some() && !refresh_callbacks {
        return Ok(false);
    }
    provision_project_oidc_client(pool, project, false)
        .await
        .map(|_| true)
        .map_err(|e| e.message)
}

/// Dérive les origines alternatives pour callbacks OIDC (legacy *.briseteia.me, www.).
fn derive_callback_origins(origin: &str) -> Vec<String> {
    let mut origins = vec![origin.to_string()];

    if let Some(host) = extract_host(origin) {
        // Si *.jeser.app → ajouter *.briseteia.me legacy
        if host.ends_with(".jeser.app") {
            if let Some(prefix) = host.strip_suffix(".jeser.app") {
                let legacy = format!("https://{}.briseteia.me", prefix);
                origins.push(legacy);
            }
        }

        // Si domaine apex (pas de sous-domaine sauf www) → ajouter variante www.
        if !host.starts_with("www.") && is_apex_domain(&host) {
            let with_www = origin.replace(&format!("://{}", host), &format!("://www.{}", host));
            if with_www != origin {
                origins.push(with_www);
            }
        }
        // Si commence par www. → ajouter variante sans www.
        if let Some(without_www) = host.strip_prefix("www.") {
            let no_www = origin.replace(&format!("://{}", host), &format!("://{}", without_www));
            if no_www != origin {
                origins.push(no_www);
            }
        }
    }

    origins
}

fn extract_host(origin: &str) -> Option<&str> {
    let after_scheme = origin
        .strip_prefix("https://")
        .or_else(|| origin.strip_prefix("http://"))?;
    after_scheme.split('/').next()
}

fn is_apex_domain(host: &str) -> bool {
    let parts: Vec<&str> = host.split('.').collect();
    // Apex = exactement 2 segments (example.com) ou 3 si dernier est TLD composé (.co.uk)
    parts.len() == 2 || (parts.len() == 3 && parts[1].len() <= 3)
}

fn normalize_origin(url: &str) -> String {
    let raw = url.trim();
    if raw.is_empty() {
        return String::new();
    }

    let (scheme, rest) = if let Some(r) = raw.strip_prefix("https://") {
        ("https", r)
    } else if let Some(r) = raw.strip_prefix("http://") {
        ("http", r)
    } else {
        ("https", raw)
    };

    let hostport = rest
        .split('/')
        .next()
        .unwrap_or("")
        .split('?')
        .next()
        .unwrap_or("")
        .trim();

    if hostport.is_empty() {
        return String::new();
    }

    format!("{}://{}", scheme, hostport)
}

/// Provisionne ou met à jour le client OIDC dédié pour ce projet.
pub async fn provision_project_oidc_client(
    pool: &sqlx::PgPool,
    project: &Project,
    force_new_secret: bool,
) -> Result<ProvisionProjectResult, pocket_id::PocketIdError> {
    let settings = load_sso_settings(pool).await;

    if !settings.is_pocket_id() {
        return Err(pocket_id::PocketIdError {
            message: "Le provider OIDC doit être pocket_id".into(),
            status: None,
        });
    }

    let issuer = settings.issuer();
    if issuer.is_empty() {
        return Err(pocket_id::PocketIdError {
            message: "URL Pocket ID non configurée".into(),
            status: None,
        });
    }

    let api_token = settings.sso_pocket_id_api_token.trim();
    if api_token.is_empty() {
        return Err(pocket_id::PocketIdError {
            message: "Token API Pocket ID manquant".into(),
            status: None,
        });
    }

    let client_id = derive_client_id(&project.slug);
    let callbacks = all_callback_urls(pool, project).await;

    if callbacks.is_empty() {
        return Err(pocket_id::PocketIdError {
            message: "URL de production ou domaine wildcard requis pour générer les callbacks"
                .into(),
            status: None,
        });
    }

    let existing_client = load_project_oidc_client(pool, &project.uuid).await;
    let need_secret = force_new_secret || existing_client.is_none();

    let production_origin = normalize_origin(project.production_url.as_deref().unwrap_or(""));
    let domain =
        crate::user_prefs::effective_wildcard_for_workspace(pool, &project.workspace_uuid).await;
    let preview = if domain.is_empty() {
        String::new()
    } else {
        preview_origin(&project.uuid, &domain).unwrap_or_default()
    };
    let launch_owned = if !production_origin.is_empty() {
        production_origin.clone()
    } else {
        preview
    };
    let launch_url = if launch_owned.is_empty() {
        None
    } else {
        Some(launch_owned.as_str())
    };

    let logo = if !production_origin.is_empty() {
        Some(format!("{}/favicon.ico", production_origin))
    } else {
        None
    };
    let branding = pocket_id::BrandingUrls {
        logo_url: logo.clone(),
        dark_logo_url: logo.clone(),
        background_url: None,
        email_logo_url: logo.clone(),
        default_profile_picture_url: logo,
    };

    let client_name = &project.name;
    let client_description = format!("OIDC client for {}", project.name);

    let result = pocket_id::provision_oidc_client(
        issuer,
        api_token,
        &client_id,
        client_name,
        &client_description,
        &callbacks,
        launch_url,
        need_secret,
        &branding,
        existing_client.is_none(),
    )
    .await?;

    let client_secret = if let Some(secret) = result.client_secret {
        secret
    } else if let Some(existing) = existing_client {
        existing.client_secret
    } else {
        return Err(pocket_id::PocketIdError {
            message: "Impossible de récupérer le client_secret".into(),
            status: None,
        });
    };

    let now = Utc::now().to_rfc3339();

    sqlx::query(
        r#"INSERT INTO project_oidc_clients 
           (project_uuid, client_id, client_secret, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT(project_uuid) DO UPDATE SET
             client_id = excluded.client_id,
             client_secret = excluded.client_secret,
             updated_at = excluded.updated_at"#,
    )
    .bind(&project.uuid)
    .bind(&result.client_id)
    .bind(&client_secret)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|e| pocket_id::PocketIdError {
        message: format!("Erreur DB: {}", e),
        status: None,
    })?;

    Ok(ProvisionProjectResult {
        client_id: result.client_id,
        created_client: result.created_client,
        created_secret: result.created_secret,
        callbacks,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_derive_client_id() {
        assert_eq!(derive_client_id("my-app"), "devforge-app-my-app");
        assert_eq!(derive_client_id("MyApp"), "devforge-app-myapp");
        assert!(derive_client_id("").starts_with("devforge-app-"));
    }

    #[test]
    fn test_normalize_origin() {
        assert_eq!(
            normalize_origin("https://example.com/path"),
            "https://example.com"
        );
        assert_eq!(
            normalize_origin("http://example.com:3000"),
            "http://example.com:3000"
        );
        assert_eq!(normalize_origin("example.com"), "https://example.com");
        assert_eq!(normalize_origin(""), "");
    }

    #[test]
    fn test_project_callback_urls() {
        let project = Project {
            id: 1,
            uuid: "test".into(),
            name: "Test".into(),
            slug: "test".into(),
            status: "live".into(),
            git_repository: None,
            git_branch: None,
            server_id: None,
            workdir: None,
            test_command: None,
            production_url: Some("https://app.example.com".into()),
            workspace_uuid: "".into(),
            build_pack: "nixpacks".into(),
            port: 3000,
            is_static: 0,
            is_sso_protected: None,
            has_own_user_system: None,
            publish_directory: None,
            base_directory: "/".into(),
            docker_compose_location: None,
            auto_deploy: 1,
            gpu_nvidia: 0,
            gpu_dri: 0,
            created_at: "".into(),
            updated_at: "".into(),
        };

        let urls = project_callback_urls(&project);
        assert!(urls.contains(&"https://app.example.com/api/auth/callback/pocket-id".into()));
        assert!(urls.contains(&"https://app.example.com/oauth2/callback".into()));
    }

    #[test]
    fn test_preview_callback_urls() {
        let urls = preview_callback_urls("abcdef12-3456-7890", "apps.example.com");
        assert!(urls
            .contains(&"https://dev-abcdef12.apps.example.com/api/auth/callback/pocket-id".into()));
        assert!(preview_callback_urls("short", "apps.example.com").is_empty());
        assert!(preview_origin("abcdef12-3456", "").is_none());
    }

    #[test]
    fn test_derive_callback_origins_jeser_app() {
        let origins = derive_callback_origins("https://sonozz.jeser.app");
        assert_eq!(origins.len(), 2);
        assert!(origins.contains(&"https://sonozz.jeser.app".into()));
        assert!(origins.contains(&"https://sonozz.briseteia.me".into()));
    }

    #[test]
    fn test_derive_callback_origins_apex_domain() {
        let origins = derive_callback_origins("https://example.com");
        assert!(origins.len() >= 2);
        assert!(origins.contains(&"https://example.com".into()));
        assert!(origins.contains(&"https://www.example.com".into()));
    }

    #[test]
    fn test_derive_callback_origins_with_www() {
        let origins = derive_callback_origins("https://www.example.com");
        assert!(origins.len() >= 2);
        assert!(origins.contains(&"https://www.example.com".into()));
        assert!(origins.contains(&"https://example.com".into()));
    }

    #[test]
    fn test_extract_host() {
        assert_eq!(extract_host("https://example.com"), Some("example.com"));
        assert_eq!(
            extract_host("https://sub.example.com"),
            Some("sub.example.com")
        );
        assert_eq!(
            extract_host("https://example.com/path"),
            Some("example.com")
        );
        assert_eq!(
            extract_host("http://localhost:3000"),
            Some("localhost:3000")
        );
    }

    #[test]
    fn test_is_apex_domain() {
        assert!(is_apex_domain("example.com"));
        assert!(is_apex_domain("example.co.uk"));
        assert!(!is_apex_domain("sub.example.com"));
        assert!(!is_apex_domain("www.example.com"));
    }
}
