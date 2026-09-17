//! Auth + onboarding (first-run wizard).

use axum::{
    extract::{Path, State},
    http::{header::AUTHORIZATION, HeaderMap},
    routing::{get, patch, post},
    Json, Router,
};
use chrono::{Duration, Utc};
use devforge_auth::{
    hash_password, new_session_token, new_uuid, slugify, verify_password, AuthTeam, AuthUser,
    OnboardingSteps, PLAN_FREE, PLAN_PRO, ROLE_INSTANCE_ADMIN, ROLE_USER, ABILITY_READ,
    ABILITY_WRITE, hash_api_token, parse_abilities_csv,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::FromRow;

use crate::state::{now_str, AppState};

#[derive(Debug, Clone, FromRow)]
pub struct UserRow {
    pub uuid: String,
    pub email: String,
    pub name: String,
    pub password_hash: String,
    pub role: String,
}

#[derive(Debug, Clone, FromRow)]
pub struct TeamRow {
    pub uuid: String,
    pub name: String,
    pub slug: String,
    pub show_boarding: i64,
    pub plan: String,
}

#[derive(Debug, Clone, FromRow)]
struct SettingsRow {
    instance_name: String,
    instance_url: String,
    wildcard_domain: String,
    github_token: String,
    ssh_host: String,
    ssh_user: String,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/bootstrap", get(bootstrap))
        .route("/api/v1/auth/register", post(register))
        .route("/api/v1/auth/login", post(login))
        .route("/api/v1/auth/logout", post(logout))
        .route("/api/v1/me", get(me))
        .route("/api/v1/onboarding", get(onboarding_status).post(save_onboarding))
        .route("/api/v1/onboarding/complete", post(complete_onboarding))
        .route("/api/v1/settings/dns", get(get_dns).post(save_dns))
        .route("/api/v1/settings/dns/status", get(dns_status))
        .route("/api/v1/settings/dns/test", post(test_dns))
        .route("/api/v1/settings/ssh", get(ssh_status).post(save_ssh))
        .route("/api/v1/settings/ssh/generate-key", post(generate_ssh_key))
        .route("/api/v1/admin/overview", get(admin_overview))
        .route("/api/v1/admin/workspaces/{uuid}", patch(admin_update_workspace))
}

pub fn bearer_from(headers: &HeaderMap) -> Option<String> {
    headers
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

async fn user_count(state: &AppState) -> Result<i64, (axum::http::StatusCode, Json<Value>)> {
    let (n,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users")
        .fetch_one(&state.pool)
        .await
        .map_err(internal)?;
    Ok(n)
}

async fn load_settings(
    state: &AppState,
) -> Result<SettingsRow, (axum::http::StatusCode, Json<Value>)> {
    sqlx::query_as::<_, SettingsRow>(
        "SELECT instance_name, instance_url, wildcard_domain, github_token, ssh_host, ssh_user FROM instance_settings WHERE id = 1",
    )
    .fetch_one(&state.pool)
    .await
    .map_err(internal)
}

/// Resolve user from session (`df_…`) or API token (`dfat_…`).
async fn session_user(
    state: &AppState,
    token: &str,
) -> Result<Option<UserRow>, (axum::http::StatusCode, Json<Value>)> {
    Ok(resolve_auth(state, token).await?.map(|(u, _)| u))
}

/// Returns user + abilities (sessions always have read+write).
pub async fn resolve_auth(
    state: &AppState,
    token: &str,
) -> Result<Option<(UserRow, Vec<String>)>, (axum::http::StatusCode, Json<Value>)> {
    let now = Utc::now().to_rfc3339();
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT user_uuid FROM sessions WHERE token = ? AND expires_at > ? LIMIT 1",
    )
    .bind(token)
    .bind(&now)
    .fetch_optional(&state.pool)
    .await
    .map_err(internal)?;
    if let Some((user_uuid,)) = row {
        let user = sqlx::query_as::<_, UserRow>(
            "SELECT uuid, email, name, password_hash, role FROM users WHERE uuid = ?",
        )
        .bind(user_uuid)
        .fetch_optional(&state.pool)
        .await
        .map_err(internal)?;
        return Ok(user.map(|u| {
            (
                u,
                vec![ABILITY_READ.to_string(), ABILITY_WRITE.to_string()],
            )
        }));
    }

    if !token.starts_with("dfat_") {
        return Ok(None);
    }
    let hash = hash_api_token(token);
    let tok: Option<(String, String, Option<String>, String)> = sqlx::query_as(
        r#"SELECT id, user_uuid, expires_at, abilities FROM api_tokens
           WHERE token_hash = ? LIMIT 1"#,
    )
    .bind(&hash)
    .fetch_optional(&state.pool)
    .await
    .map_err(internal)?;
    let Some((id, user_uuid, expires_at, abilities)) = tok else {
        return Ok(None);
    };
    if let Some(exp) = &expires_at {
        if exp.as_str() < now.as_str() {
            return Ok(None);
        }
    }
    let _ = sqlx::query("UPDATE api_tokens SET last_used_at = ? WHERE id = ?")
        .bind(&now)
        .bind(&id)
        .execute(&state.pool)
        .await;
    let user = sqlx::query_as::<_, UserRow>(
        "SELECT uuid, email, name, password_hash, role FROM users WHERE uuid = ?",
    )
    .bind(user_uuid)
    .fetch_optional(&state.pool)
    .await
    .map_err(internal)?;
    Ok(user.map(|u| (u, parse_abilities_csv(&abilities))))
}

pub async fn user_team(
    state: &AppState,
    user_uuid: &str,
) -> Result<Option<TeamRow>, (axum::http::StatusCode, Json<Value>)> {
    sqlx::query_as::<_, TeamRow>(
        r#"
        SELECT t.uuid, t.name, t.slug, t.show_boarding, t.plan
        FROM teams t
        JOIN team_members m ON m.team_uuid = t.uuid
        WHERE m.user_uuid = ?
        LIMIT 1
        "#,
    )
    .bind(user_uuid)
    .fetch_optional(&state.pool)
    .await
    .map_err(internal)
}

/// Resolve authenticated user + workspace from Authorization header.
pub async fn current_workspace(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<(UserRow, TeamRow), (axum::http::StatusCode, Json<Value>)> {
    let token = bearer_from(headers).ok_or_else(unauthorized)?;
    let user = session_user(state, &token)
        .await?
        .ok_or_else(unauthorized)?;
    let team = user_team(state, &user.uuid)
        .await?
        .ok_or_else(|| {
            (
                axum::http::StatusCode::FORBIDDEN,
                Json(json!({"error": "Aucun workspace"})),
            )
        })?;
    Ok((user, team))
}

pub async fn create_session(
    state: &AppState,
    user_uuid: &str,
) -> Result<String, (axum::http::StatusCode, Json<Value>)> {
    let token = new_session_token();
    let now = now_str();
    let expires = (Utc::now() + Duration::days(30)).to_rfc3339();
    sqlx::query("INSERT INTO sessions (token, user_uuid, expires_at, created_at) VALUES (?, ?, ?, ?)")
        .bind(&token)
        .bind(user_uuid)
        .bind(&expires)
        .bind(&now)
        .execute(&state.pool)
        .await
        .map_err(internal)?;
    Ok(token)
}

fn to_user(u: &UserRow) -> AuthUser {
    AuthUser {
        uuid: u.uuid.clone(),
        email: u.email.clone(),
        name: u.name.clone(),
        role: u.role.clone(),
    }
}

fn to_team(t: &TeamRow) -> AuthTeam {
    AuthTeam {
        uuid: t.uuid.clone(),
        name: t.name.clone(),
        slug: t.slug.clone(),
        show_boarding: t.show_boarding != 0,
        plan: t.plan.clone(),
    }
}

fn steps_json(s: &OnboardingSteps) -> Value {
    json!({
        "account": s.account,
        "instance": s.instance,
        "domain": s.domain,
        "github": s.github,
        "server": s.server,
    })
}

async fn bootstrap(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let count = user_count(&state).await?;
    let settings = load_settings(&state).await?;
    let sso_settings = crate::sso::load_sso_settings(&state.pool).await;
    let token = bearer_from(&headers);
    let mut user = None;
    let mut team = None;
    if let Some(t) = token {
        if let Some(u) = session_user(&state, &t).await? {
            team = user_team(&state, &u.uuid).await?;
            user = Some(u);
        }
    }

    let steps = OnboardingSteps::from_settings(
        user.is_some(),
        &settings.instance_name,
        &settings.instance_url,
        &settings.wildcard_domain,
        &settings.github_token,
        &settings.ssh_host,
    );
    let show_boarding = team.as_ref().map(|t| t.show_boarding != 0).unwrap_or(false)
        && user
            .as_ref()
            .map(|u| u.role == ROLE_INSTANCE_ADMIN)
            .unwrap_or(false);

    // Break-glass: DEVFORGE_FORCE_LOCAL_LOGIN=1 force le login local même si hide_local_login est activé
    let force_local_login = matches!(
        std::env::var("DEVFORGE_FORCE_LOCAL_LOGIN")
            .unwrap_or_default()
            .to_lowercase()
            .as_str(),
        "1" | "true" | "yes"
    );

    let hide_local_login = if force_local_login {
        false
    } else {
        sso_settings.hide_local_login()
    };

    let cluster_local = state
        .cluster
        .local()
        .await
        .unwrap_or_default();

    Ok(Json(json!({
        "ok": true,
        "needs_setup": count == 0,
        "allow_register": count == 0 || registration_open(),
        "authenticated": user.is_some(),
        "user": user.as_ref().map(to_user),
        "workspace": team.as_ref().map(to_team),
        "team": team.as_ref().map(to_team),
        "onboarding": {
            "required": show_boarding,
            "steps": steps_json(&steps),
        },
        "settings": {
            "instance_name": settings.instance_name,
            "instance_url": settings.instance_url,
            "wildcard_domain": settings.wildcard_domain,
            "github_connected": !settings.github_token.is_empty(),
            "ssh_host": settings.ssh_host,
            "ssh_user": settings.ssh_user,
            "dns": crate::dns::public_json(&crate::dns::load(&state).await),
        },
        "sso": {
            "enabled": sso_settings.enable_platform_login(),
            "oidc_configured": sso_settings.oidc_configured(),
            "hide_local_login": hide_local_login,
            "provider": sso_settings.provider(),
            "issuer_url": sso_settings.issuer(),
        },
        "cluster": {
            "role": cluster_local.role,
            "leader_url": cluster_local.leader_url,
            "node_id": cluster_local.node_id,
            "node_name": cluster_local.node_name,
        }
    })))
}

#[derive(Deserialize)]
pub struct RegisterBody {
    pub name: String,
    pub email: String,
    pub password: String,
    pub team_name: Option<String>,
}

async fn register(
    State(state): State<AppState>,
    Json(body): Json<RegisterBody>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let count = user_count(&state).await?;
    // Après le premier compte : inscription fermée sauf DEVFORGE_ALLOW_REGISTER=1
    if count > 0 && !registration_open() {
        return Err((
            axum::http::StatusCode::FORBIDDEN,
            Json(json!({
                "error": "Inscription fermée — demande à un admin ou définis DEVFORGE_ALLOW_REGISTER=1"
            })),
        ));
    }
    let email = body.email.trim().to_lowercase();
    let name = body.name.trim();
    if email.is_empty() || !email.contains('@') || name.is_empty() {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({"error": "Nom et email requis"})),
        ));
    }
    let password_hash = hash_password(&body.password).map_err(|e| {
        (
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({"error": e.to_string()})),
        )
    })?;

    let is_first = count == 0;
    let role = if is_first {
        ROLE_INSTANCE_ADMIN
    } else {
        ROLE_USER
    };
    // First account = instance admin (configure shared infra). Others = isolated free workspace.
    let show_boarding = if is_first { 1 } else { 0 };
    let plan = if is_first { PLAN_PRO } else { PLAN_FREE };

    let user_uuid = new_uuid();
    let team_uuid = new_uuid();
    let team_name = if is_first {
        body.team_name
            .as_deref()
            .unwrap_or("Admin")
            .trim()
            .to_string()
    } else {
        body.team_name
            .as_deref()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| format!("Workspace · {name}"))
    };
    let mut team_slug = slugify(&team_name);
    if !is_first {
        team_slug = format!("{}-{}", team_slug, &user_uuid[..6]);
    }
    let now = now_str();

    let existing: Option<(i64,)> = sqlx::query_as("SELECT id FROM users WHERE email = ?")
        .bind(&email)
        .fetch_optional(&state.pool)
        .await
        .map_err(internal)?;
    if existing.is_some() {
        return Err((
            axum::http::StatusCode::CONFLICT,
            Json(json!({"error": "Cet email est déjà utilisé"})),
        ));
    }

    sqlx::query(
        "INSERT INTO users (uuid, email, name, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&user_uuid)
    .bind(&email)
    .bind(name)
    .bind(&password_hash)
    .bind(role)
    .bind(&now)
    .bind(&now)
    .execute(&state.pool)
    .await
    .map_err(internal)?;

    sqlx::query(
        "INSERT INTO teams (uuid, name, slug, show_boarding, plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&team_uuid)
    .bind(&team_name)
    .bind(&team_slug)
    .bind(show_boarding)
    .bind(plan)
    .bind(&now)
    .bind(&now)
    .execute(&state.pool)
    .await
    .map_err(internal)?;

    sqlx::query(
        "INSERT INTO team_members (team_uuid, user_uuid, role, created_at) VALUES (?, ?, 'owner', ?)",
    )
    .bind(&team_uuid)
    .bind(&user_uuid)
    .bind(&now)
    .execute(&state.pool)
    .await
    .map_err(internal)?;

    let token = create_session(&state, &user_uuid).await?;

    Ok(Json(json!({
        "ok": true,
        "token": token,
        "user": { "uuid": user_uuid, "email": email, "name": name, "role": role },
        "workspace": {
            "uuid": team_uuid,
            "name": team_name,
            "slug": team_slug,
            "show_boarding": show_boarding == 1,
            "plan": plan,
        },
        "team": {
            "uuid": team_uuid,
            "name": team_name,
            "slug": team_slug,
            "show_boarding": show_boarding == 1,
            "plan": plan,
        },
        "onboarding": { "required": show_boarding == 1 }
    })))
}

#[derive(Deserialize)]
pub struct LoginBody {
    pub email: String,
    pub password: String,
}

async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginBody>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let email = body.email.trim().to_lowercase();
    let user = sqlx::query_as::<_, UserRow>(
        "SELECT uuid, email, name, password_hash, role FROM users WHERE email = ?",
    )
    .bind(&email)
    .fetch_optional(&state.pool)
    .await
    .map_err(internal)?
    .ok_or_else(|| {
        (
            axum::http::StatusCode::UNAUTHORIZED,
            Json(json!({"error": "Email ou mot de passe incorrect"})),
        )
    })?;

    let ok = verify_password(&body.password, &user.password_hash).map_err(|e| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;
    if !ok {
        return Err((
            axum::http::StatusCode::UNAUTHORIZED,
            Json(json!({"error": "Email ou mot de passe incorrect"})),
        ));
    }

    let token = create_session(&state, &user.uuid).await?;
    let team = user_team(&state, &user.uuid).await?;

    Ok(Json(json!({
        "ok": true,
        "token": token,
        "user": to_user(&user),
        "team": team.as_ref().map(to_team),
        "onboarding": {
            "required": team.as_ref().map(|t| t.show_boarding != 0).unwrap_or(false)
        }
    })))
}

async fn logout(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    if let Some(token) = bearer_from(&headers) {
        sqlx::query("DELETE FROM sessions WHERE token = ?")
            .bind(token)
            .execute(&state.pool)
            .await
            .map_err(internal)?;
    }
    Ok(Json(json!({"ok": true})))
}

async fn me(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let token = bearer_from(&headers).ok_or_else(unauthorized)?;
    let user = session_user(&state, &token)
        .await?
        .ok_or_else(|| {
            (
                axum::http::StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Session expirée"})),
            )
        })?;
    let team = user_team(&state, &user.uuid).await?;
    Ok(Json(json!({
        "ok": true,
        "user": to_user(&user),
        "team": team.as_ref().map(to_team),
    })))
}

async fn onboarding_status(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let token = bearer_from(&headers).ok_or_else(unauthorized)?;
    let user = session_user(&state, &token).await?.ok_or_else(unauthorized)?;
    let team = user_team(&state, &user.uuid).await?;
    let settings = load_settings(&state).await?;
    let steps = OnboardingSteps::from_settings(
        true,
        &settings.instance_name,
        &settings.instance_url,
        &settings.wildcard_domain,
        &settings.github_token,
        &settings.ssh_host,
    );
    Ok(Json(json!({
        "ok": true,
        "required": team.as_ref().map(|t| t.show_boarding != 0).unwrap_or(false),
        "steps": steps_json(&steps),
        "settings": {
            "instance_name": settings.instance_name,
            "instance_url": settings.instance_url,
            "wildcard_domain": settings.wildcard_domain,
            "github_connected": !settings.github_token.is_empty(),
            "ssh_host": settings.ssh_host,
            "ssh_user": settings.ssh_user,
        }
    })))
}

#[derive(Deserialize)]
pub struct OnboardingSaveBody {
    pub instance_name: Option<String>,
    pub instance_url: Option<String>,
    pub wildcard_domain: Option<String>,
    pub github_token: Option<String>,
    pub ssh_host: Option<String>,
    pub ssh_user: Option<String>,
}

async fn save_onboarding(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<OnboardingSaveBody>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let token = bearer_from(&headers).ok_or_else(unauthorized)?;
    let user = session_user(&state, &token).await?.ok_or_else(unauthorized)?;
    if user.role != ROLE_INSTANCE_ADMIN {
        return Err((
            axum::http::StatusCode::FORBIDDEN,
            Json(json!({"error": "Réservé à l’admin instance"})),
        ));
    }
    let mut s = load_settings(&state).await?;
    if let Some(v) = body.instance_name {
        s.instance_name = v.trim().to_string();
    }
    if let Some(v) = body.instance_url {
        s.instance_url = v.trim().trim_end_matches('/').to_string();
    }
    if let Some(v) = body.wildcard_domain {
        s.wildcard_domain = v.trim().trim_start_matches('.').to_lowercase();
    }
    if let Some(v) = body.github_token {
        let t = v.trim().to_string();
        if !t.is_empty() {
            state.configure_github(&t).await.map_err(|e| {
                (
                    axum::http::StatusCode::BAD_REQUEST,
                    Json(json!({"error": format!("GitHub: {e}")})),
                )
            })?;
            s.github_token = t;
        }
    }
    if let Some(v) = body.ssh_host {
        s.ssh_host = v.trim().to_string();
    }
    if let Some(v) = body.ssh_user {
        let u = v.trim().to_string();
        if !u.is_empty() {
            s.ssh_user = u;
        }
    }
    let now = now_str();
    sqlx::query(
        r#"
        UPDATE instance_settings SET
            instance_name = ?, instance_url = ?, wildcard_domain = ?,
            ssh_host = ?, ssh_user = ?, updated_at = ?
        WHERE id = 1
        "#,
    )
    .bind(&s.instance_name)
    .bind(&s.instance_url)
    .bind(&s.wildcard_domain)
    .bind(&s.ssh_host)
    .bind(&s.ssh_user)
    .bind(&now)
    .execute(&state.pool)
    .await
    .map_err(internal)?;

    // Reload settings after github configure (token already persisted there)
    s = load_settings(&state).await?;

    if !s.ssh_host.is_empty() {
        std::env::set_var("DEVFORGE_SSH_HOST", &s.ssh_host);
        std::env::set_var("DEVFORGE_SSH_USER", &s.ssh_user);
    }

    let steps = OnboardingSteps::from_settings(
        true,
        &s.instance_name,
        &s.instance_url,
        &s.wildcard_domain,
        &s.github_token,
        &s.ssh_host,
    );

    Ok(Json(json!({
        "ok": true,
        "steps": steps_json(&steps),
    })))
}

#[derive(Deserialize)]
struct DnsSaveBody {
    pub provider: Option<String>,
    pub zone: Option<String>,
    pub token: Option<String>,
    pub api_key: Option<String>,
    pub secret: Option<String>,
}

async fn get_dns(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_instance_admin(&state, &headers).await?;
    let dns = crate::dns::load(&state).await;
    Ok(Json(json!({ "ok": true, "dns": crate::dns::public_json(&dns) })))
}

async fn save_dns(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<DnsSaveBody>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_instance_admin(&state, &headers).await?;
    let mut dns = crate::dns::load(&state).await;
    if let Some(p) = body.provider {
        dns.provider = match p.trim().to_lowercase().as_str() {
            "cloudflare" | "porkbun" => p.trim().to_lowercase(),
            _ => String::new(),
        };
    }
    if let Some(z) = body.zone {
        dns.zone = z.trim().trim_start_matches('.').to_lowercase();
    }
    let token = body
        .token
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    match dns.provider.as_str() {
        "cloudflare" => {
            if let Some(t) = token {
                dns.cf_token = t.to_string();
            }
        }
        "porkbun" => {
            let mut k = body
                .api_key
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string);
            let mut s = body
                .secret
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string);
            if k.is_none() && s.is_none() {
                if let Some(t) = token {
                    let (pk, ps) = devforge_domain::parse_porkbun_token(t);
                    if pk.is_empty() {
                        return Err((
                            axum::http::StatusCode::BAD_REQUEST,
                            Json(json!({"error": "Clé API Porkbun vide"})),
                        ));
                    }
                    if ps.is_empty() {
                        return Err((
                            axum::http::StatusCode::BAD_REQUEST,
                            Json(json!({"error": "Porkbun : renseigne la clé API et le Secret API (deux champs)"})),
                        ));
                    }
                    k = Some(pk);
                    s = Some(ps);
                }
            } else if s.is_none() {
                if let Some(ref key) = k {
                    if key.contains(':') || key.contains('|') {
                        let (pk, ps) = devforge_domain::parse_porkbun_token(key);
                        if !ps.is_empty() {
                            k = Some(pk);
                            s = Some(ps);
                        }
                    }
                }
            }
            if let Some(k) = k {
                dns.api_key = k;
            }
            if let Some(s) = s {
                dns.secret = s;
            }
            let (nk, ns) = devforge_domain::normalize_porkbun_keys(&dns.api_key, &dns.secret);
            dns.api_key = nk;
            dns.secret = ns;
        }
        _ => {}
    }
    if dns.provider == "porkbun" && (dns.api_key.is_empty() || dns.secret.is_empty()) {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({"error": "Porkbun : renseigne la clé API et le Secret API (ce ne sont pas le token Cloudflare)"})),
        ));
    }
    if dns.provider == "cloudflare" {
        if dns.cf_token.trim().is_empty()
            && dns.secret.trim().is_empty()
            && !dns.api_key.trim().is_empty()
        {
            dns.cf_token = dns.api_key.clone();
        }
        if dns.cf_token.trim().is_empty() {
            return Err((
                axum::http::StatusCode::BAD_REQUEST,
                Json(json!({"error": "Token Cloudflare requis"})),
            ));
        }
    }
    let now = now_str();
    sqlx::query(
        r#"UPDATE instance_settings SET
            dns_provider = ?, porkbun_zone = ?, porkbun_api_key = ?, porkbun_secret = ?,
            cloudflare_api_token = ?, updated_at = ?
           WHERE id = 1"#,
    )
    .bind(&dns.provider)
    .bind(&dns.zone)
    .bind(&dns.api_key)
    .bind(&dns.secret)
    .bind(&dns.cf_token)
    .bind(&now)
    .execute(&state.pool)
    .await
    .map_err(internal)?;
    let provision = crate::dns::provision_all(&state).await;
    let dns = crate::dns::load(&state).await;
    let status = crate::dns::collect_status(&state).await;
    match provision {
        Ok(v) => Ok(Json(json!({
            "ok": true,
            "dns": crate::dns::public_json(&dns),
            "provision": v,
            "status": status,
        }))),
        Err(e) => Ok(Json(json!({
            "ok": true,
            "dns": crate::dns::public_json(&dns),
            "provision_error": e,
            "status": status,
        }))),
    }
}

async fn dns_status(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_instance_admin(&state, &headers).await?;
    let dns = crate::dns::load(&state).await;
    Ok(Json(json!({
        "ok": true,
        "dns": crate::dns::public_json(&dns),
        "status": crate::dns::collect_status(&state).await,
    })))
}

async fn test_dns(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_instance_admin(&state, &headers).await?;
    crate::dns::ping_configured(&state)
        .await
        .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": e}))))?;
    Ok(Json(json!({
        "ok": true,
        "status": crate::dns::collect_status(&state).await,
    })))
}

async fn complete_onboarding(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let token = bearer_from(&headers).ok_or_else(unauthorized)?;
    let user = session_user(&state, &token).await?.ok_or_else(unauthorized)?;
    if user.role != ROLE_INSTANCE_ADMIN {
        return Err((
            axum::http::StatusCode::FORBIDDEN,
            Json(json!({"error": "Réservé à l’admin instance"})),
        ));
    }
    let team = user_team(&state, &user.uuid)
        .await?
        .ok_or_else(|| {
            (
                axum::http::StatusCode::BAD_REQUEST,
                Json(json!({"error": "Aucune équipe"})),
            )
        })?;
    let settings = load_settings(&state).await?;
    let steps = OnboardingSteps::from_settings(
        true,
        &settings.instance_name,
        &settings.instance_url,
        &settings.wildcard_domain,
        &settings.github_token,
        &settings.ssh_host,
    );
    if !steps.all_required_done() {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "Complète au moins instance et domaine",
                "steps": steps_json(&steps),
            })),
        ));
    }
    let now = now_str();
    sqlx::query("UPDATE teams SET show_boarding = 0, updated_at = ? WHERE uuid = ?")
        .bind(&now)
        .bind(&team.uuid)
        .execute(&state.pool)
        .await
        .map_err(internal)?;

    Ok(Json(json!({
        "ok": true,
        "redirect": "/app"
    })))
}

pub(crate) fn ssh_key_paths() -> (std::path::PathBuf, std::path::PathBuf) {
    let data = std::env::var("DEVFORGE_DATA_DIR").unwrap_or_else(|_| "/data".into());
    let private = std::env::var("DEVFORGE_SSH_KEY")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from(format!("{data}/ssh/id_ed25519")));
    let public = {
        let mut p = private.clone();
        let name = p
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("id_ed25519");
        p.set_file_name(format!("{name}.pub"));
        p
    };
    (private, public)
}

async fn require_admin_from_headers(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<(), (axum::http::StatusCode, Json<Value>)> {
    let token = bearer_from(headers).ok_or_else(unauthorized)?;
    let user = session_user(state, &token).await?.ok_or_else(unauthorized)?;
    if user.role != ROLE_INSTANCE_ADMIN {
        return Err((
            axum::http::StatusCode::FORBIDDEN,
            Json(json!({"error": "Réservé à l’admin instance"})),
        ));
    }
    Ok(())
}

async fn ssh_status(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_admin_from_headers(&state, &headers).await?;
    let s = load_settings(&state).await?;
    let (private, public) = ssh_key_paths();
    let key_exists = private.is_file();
    let public_key = if public.is_file() {
        tokio::fs::read_to_string(&public).await.ok()
    } else {
        None
    };
    let executor = std::env::var("DEVFORGE_EXECUTOR").unwrap_or_else(|_| "local".into());
    Ok(Json(json!({
        "ok": true,
        "executor": executor,
        "local_docker": executor == "local",
        "ssh_host": s.ssh_host,
        "ssh_user": s.ssh_user,
        "key_path": private.to_string_lossy(),
        "key_exists": key_exists,
        "public_key": public_key,
    })))
}

#[derive(Deserialize)]
pub struct SshSaveBody {
    pub ssh_host: Option<String>,
    pub ssh_user: Option<String>,
}

async fn save_ssh(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<SshSaveBody>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_admin_from_headers(&state, &headers).await?;
    let mut s = load_settings(&state).await?;
    if let Some(v) = body.ssh_host {
        s.ssh_host = v.trim().to_string();
    }
    if let Some(v) = body.ssh_user {
        let u = v.trim().to_string();
        if !u.is_empty() {
            s.ssh_user = u;
        }
    }
    let now = now_str();
    sqlx::query(
        "UPDATE instance_settings SET ssh_host = ?, ssh_user = ?, updated_at = ? WHERE id = 1",
    )
    .bind(&s.ssh_host)
    .bind(&s.ssh_user)
    .bind(&now)
    .execute(&state.pool)
    .await
    .map_err(internal)?;

    if s.ssh_host.is_empty() {
        std::env::remove_var("DEVFORGE_SSH_HOST");
    } else {
        std::env::set_var("DEVFORGE_SSH_HOST", &s.ssh_host);
        std::env::set_var("DEVFORGE_SSH_USER", &s.ssh_user);
    }
    let (private, _) = ssh_key_paths();
    if private.is_file() {
        std::env::set_var("DEVFORGE_SSH_KEY", private.to_string_lossy().to_string());
    }

    Ok(Json(json!({
        "ok": true,
        "ssh_host": s.ssh_host,
        "ssh_user": s.ssh_user,
    })))
}

async fn generate_ssh_key(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_admin_from_headers(&state, &headers).await?;
    let (private, public) = ssh_key_paths();
    if let Some(parent) = private.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": format!("mkdir ssh: {e}")})),
            )
        })?;
    }
    if private.is_file() {
        let pub_key = tokio::fs::read_to_string(&public).await.unwrap_or_default();
        return Ok(Json(json!({
            "ok": true,
            "created": false,
            "key_path": private.to_string_lossy(),
            "public_key": pub_key,
            "hint": "Clé déjà présente — copie la publique dans authorized_keys du serveur distant.",
        })));
    }

    let out = tokio::process::Command::new("ssh-keygen")
        .args([
            "-t",
            "ed25519",
            "-N",
            "",
            "-C",
            "devforge",
            "-f",
            private.to_str().unwrap_or("/data/ssh/id_ed25519"),
        ])
        .output()
        .await
        .map_err(|e| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": format!("ssh-keygen: {e}")})),
            )
        })?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err((
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": format!("ssh-keygen failed: {err}")})),
        ));
    }

    std::env::set_var("DEVFORGE_SSH_KEY", private.to_string_lossy().to_string());
    let pub_key = tokio::fs::read_to_string(&public).await.unwrap_or_default();
    Ok(Json(json!({
        "ok": true,
        "created": true,
        "key_path": private.to_string_lossy(),
        "public_key": pub_key,
        "hint": "Ajoute cette clé publique dans ~/.ssh/authorized_keys sur le host distant.",
    })))
}

async fn require_instance_admin(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<UserRow, (axum::http::StatusCode, Json<Value>)> {
    let token = bearer_from(headers).ok_or_else(unauthorized)?;
    let user = session_user(state, &token).await?.ok_or_else(unauthorized)?;
    if user.role != ROLE_INSTANCE_ADMIN {
        return Err((
            axum::http::StatusCode::FORBIDDEN,
            Json(json!({"error": "Réservé à l’admin instance"})),
        ));
    }
    Ok(user)
}

#[derive(Debug, FromRow)]
struct AdminWorkspaceRow {
    workspace_uuid: String,
    workspace_name: String,
    workspace_slug: String,
    plan: String,
    created_at: String,
    owner_uuid: String,
    owner_email: String,
    owner_name: String,
    owner_role: String,
    project_count: i64,
}

/// Vue opérateur : tous les workspaces clients (style SaaS).
async fn admin_overview(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let _admin = require_instance_admin(&state, &headers).await?;
    let rows: Vec<AdminWorkspaceRow> = sqlx::query_as(
        r#"
        SELECT
            t.uuid AS workspace_uuid,
            t.name AS workspace_name,
            t.slug AS workspace_slug,
            t.plan AS plan,
            t.created_at AS created_at,
            u.uuid AS owner_uuid,
            u.email AS owner_email,
            u.name AS owner_name,
            u.role AS owner_role,
            (SELECT COUNT(*) FROM projects p WHERE p.workspace_uuid = t.uuid) AS project_count
        FROM teams t
        JOIN team_members tm ON tm.team_uuid = t.uuid AND tm.role = 'owner'
        JOIN users u ON u.uuid = tm.user_uuid
        ORDER BY t.created_at DESC
        "#,
    )
    .fetch_all(&state.pool)
    .await
    .map_err(internal)?;

    let users_total = rows.len() as i64;
    let free = rows.iter().filter(|r| r.plan == PLAN_FREE).count() as i64;
    let pro = rows.iter().filter(|r| r.plan == PLAN_PRO).count() as i64;
    let projects_total: i64 = rows.iter().map(|r| r.project_count).sum();

    let workspaces: Vec<Value> = rows
        .into_iter()
        .map(|r| {
            json!({
                "uuid": r.workspace_uuid,
                "name": r.workspace_name,
                "slug": r.workspace_slug,
                "plan": r.plan,
                "created_at": r.created_at,
                "project_count": r.project_count,
                "owner": {
                    "uuid": r.owner_uuid,
                    "email": r.owner_email,
                    "name": r.owner_name,
                    "role": r.owner_role,
                }
            })
        })
        .collect();

    Ok(Json(json!({
        "ok": true,
        "stats": {
            "workspaces": users_total,
            "users": users_total,
            "plan_free": free,
            "plan_pro": pro,
            "projects": projects_total,
        },
        "workspaces": workspaces,
    })))
}

#[derive(Deserialize)]
pub struct AdminUpdateWorkspaceBody {
    pub plan: String,
}

async fn admin_update_workspace(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Json(body): Json<AdminUpdateWorkspaceBody>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let _admin = require_instance_admin(&state, &headers).await?;
    let plan = body.plan.trim().to_lowercase();
    if plan != PLAN_FREE && plan != PLAN_PRO {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({"error": "Plan invalide (free | pro)"})),
        ));
    }
    let now = now_str();
    let res = sqlx::query("UPDATE teams SET plan = ?, updated_at = ? WHERE uuid = ?")
        .bind(&plan)
        .bind(&now)
        .bind(&uuid)
        .execute(&state.pool)
        .await
        .map_err(internal)?;
    if res.rows_affected() == 0 {
        return Err((
            axum::http::StatusCode::NOT_FOUND,
            Json(json!({"error": "Workspace introuvable"})),
        ));
    }
    Ok(Json(json!({
        "ok": true,
        "uuid": uuid,
        "plan": plan,
    })))
}

fn registration_open() -> bool {
    matches!(
        std::env::var("DEVFORGE_ALLOW_REGISTER")
            .unwrap_or_default()
            .to_lowercase()
            .as_str(),
        "1" | "true" | "yes"
    )
}

fn unauthorized() -> (axum::http::StatusCode, Json<Value>) {
    (
        axum::http::StatusCode::UNAUTHORIZED,
        Json(json!({"error": "Non authentifié"})),
    )
}

fn internal(e: sqlx::Error) -> (axum::http::StatusCode, Json<Value>) {
    (
        axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({"error": e.to_string()})),
    )
}
