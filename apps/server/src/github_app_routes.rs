//! GitHub App native — P1 : création en 1 clic (Manifest flow) et retour d'installation.
//!
//! Routes (admin d'instance uniquement) :
//! - `POST   /api/v1/github-app/manifest`           → `{ post_url, manifest, state }`
//! - `GET    /api/v1/github-app/manifest/callback`  → conversion du code, secrets scellés
//! - `GET    /api/v1/github-app/installed`          → installation vérifiée côté GitHub
//! - `GET    /api/v1/github-app`                    → statut (jamais de secret)
//! - `DELETE /api/v1/github-app`                    → oubli local
//!
//! Aucun secret (clé privée, webhook secret, client secret, token) n'est renvoyé ni journalisé.

use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Redirect, Response},
    routing::{get, post},
    Json, Router,
};
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64URL;
use base64::Engine;
use rand::RngCore;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::PgPool;

use crate::auth_routes::UserRow;
use crate::secret_box::Redacted;
use crate::state::AppState;

type ApiErr = (StatusCode, Json<Value>);

pub const STATE_TTL_MINUTES: i64 = 10;
const SETTINGS_PATH: &str = "/app/settings?tab=github";

/// Permissions minimales demandées (liste blanche, cf. plan P1-01).
pub const REQUIRED_PERMISSIONS: &[(&str, &str)] = &[
    ("contents", "write"),
    ("metadata", "read"),
    ("pull_requests", "write"),
    ("checks", "write"),
    ("statuses", "write"),
    ("deployments", "write"),
];
pub const DEFAULT_EVENTS: &[&str] = &["push", "pull_request", "check_run", "check_suite"];

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/github-app", get(status).delete(forget))
        .route("/api/v1/github-app/manifest", post(create_manifest))
        .route(
            "/api/v1/github-app/manifest/callback",
            get(manifest_callback),
        )
        .route("/api/v1/github-app/installed", get(installed))
}

pub(crate) fn api_base() -> String {
    std::env::var("DEVFORGE_GITHUB_API_URL")
        .ok()
        .map(|s| s.trim().trim_end_matches('/').to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "https://api.github.com".into())
}

pub(crate) fn web_base() -> String {
    std::env::var("DEVFORGE_GITHUB_WEB_URL")
        .ok()
        .map(|s| s.trim().trim_end_matches('/').to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "https://github.com".into())
}

fn http() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("DevForge")
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .unwrap_or_default()
}

fn err(code: StatusCode, msg: &str) -> ApiErr {
    (code, Json(json!({ "error": msg })))
}

fn db_err(e: sqlx::Error) -> ApiErr {
    tracing::error!("github-app : erreur base : {e}");
    err(StatusCode::INTERNAL_SERVER_ERROR, "erreur base de données")
}

fn settings_redirect(extra: &str) -> Response {
    Redirect::to(&format!("{SETTINGS_PATH}&{extra}")).into_response()
}

async fn require_admin(state: &AppState, headers: &HeaderMap) -> Result<UserRow, ApiErr> {
    let user = crate::auth_routes::user_from_bearer_or_cookie(state, headers)
        .await?
        .ok_or_else(|| err(StatusCode::UNAUTHORIZED, "connexion requise"))?;
    if user.role != "instance_admin" {
        return Err(err(StatusCode::FORBIDDEN, "Réservé à l’admin instance"));
    }
    Ok(user)
}

// ───────────────────────── Manifest ─────────────────────────

/// Nom d'app GitHub : 34 caractères max, lettres/chiffres/tirets.
pub fn app_name(instance_name: &str) -> String {
    let cleaned: String = instance_name
        .trim()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let cleaned = cleaned.trim_matches('-');
    let mut name = if cleaned.is_empty() {
        "DevForge".to_string()
    } else {
        format!("DevForge-{cleaned}")
    };
    name.truncate(34);
    name.trim_end_matches('-').to_string()
}

pub fn build_manifest(instance_name: &str, instance_url: &str, workflows: bool) -> Value {
    let base = instance_url.trim().trim_end_matches('/');
    let mut perms = serde_json::Map::new();
    for (k, v) in REQUIRED_PERMISSIONS {
        perms.insert((*k).into(), json!(v));
    }
    if workflows {
        perms.insert("workflows".into(), json!("write"));
    }
    json!({
        "name": app_name(instance_name),
        "url": base,
        "hook_attributes": { "url": format!("{base}/api/v1/webhooks/github-app"), "active": true },
        "redirect_url": format!("{base}/api/v1/github-app/manifest/callback"),
        "setup_url": format!("{base}/api/v1/github-app/installed"),
        "setup_on_update": true,
        "callback_urls": [format!("{base}/api/v1/github-app/oauth/callback")],
        "public": false,
        "default_permissions": Value::Object(perms),
        "default_events": DEFAULT_EVENTS,
    })
}

/// URL de création : compte personnel ou organisation.
pub fn manifest_post_url(web: &str, org: Option<&str>, state: &str) -> String {
    let st = urlencoding::encode(state);
    match org.map(str::trim).filter(|o| !o.is_empty()) {
        Some(o) => format!(
            "{web}/organizations/{}/settings/apps/new?state={st}",
            urlencoding::encode(o)
        ),
        None => format!("{web}/settings/apps/new?state={st}"),
    }
}

pub fn valid_org(org: &str) -> bool {
    !org.is_empty()
        && org.len() <= 39
        && org.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        && !org.starts_with('-')
}

fn new_state() -> String {
    let mut b = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut b);
    B64URL.encode(b)
}

pub async fn issue_state(pool: &PgPool, user_uuid: &str) -> Result<String, sqlx::Error> {
    // Purge opportuniste des états expirés.
    let _ = sqlx::query("DELETE FROM github_manifest_states WHERE expires_at < now()")
        .execute(pool)
        .await;
    let s = new_state();
    sqlx::query(
        "INSERT INTO github_manifest_states (state, user_uuid, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3))",
    )
    .bind(&s)
    .bind(user_uuid)
    .bind(STATE_TTL_MINUTES as i32)
    .execute(pool)
    .await?;
    Ok(s)
}

#[derive(Debug, PartialEq, Eq)]
pub enum StateError {
    Unknown,
    Expired,
    OtherUser,
}

/// Usage unique : l'état est supprimé quel que soit le résultat de la vérification.
pub async fn consume_state(pool: &PgPool, state: &str, user_uuid: &str) -> Result<(), StateError> {
    let row: Option<(String, bool)> = sqlx::query_as(
        "DELETE FROM github_manifest_states WHERE state = $1 RETURNING user_uuid, expires_at > now()",
    )
    .bind(state)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    match row {
        None => Err(StateError::Unknown),
        Some((_, false)) => Err(StateError::Expired),
        Some((u, true)) if u != user_uuid => Err(StateError::OtherUser),
        Some(_) => Ok(()),
    }
}

#[derive(Deserialize, Default)]
struct ManifestBody {
    org: Option<String>,
    #[serde(default)]
    workflows: bool,
}

async fn create_manifest(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Option<Json<ManifestBody>>,
) -> Result<Json<Value>, ApiErr> {
    let user = require_admin(&state, &headers).await?;
    let body = body.map(|b| b.0).unwrap_or_default();
    let org = body.org.as_deref().map(str::trim).filter(|o| !o.is_empty());
    if let Some(o) = org {
        if !valid_org(o) {
            return Err(err(StatusCode::BAD_REQUEST, "Nom d’organisation invalide"));
        }
    }
    let (name, url): (String, String) =
        sqlx::query_as("SELECT instance_name, instance_url FROM instance_settings WHERE id = 1")
            .fetch_one(&state.pool)
            .await
            .map_err(db_err)?;
    if !url.trim().starts_with("https://") && !url.trim().starts_with("http://") {
        return Err(err(
            StatusCode::BAD_REQUEST,
            "Configure d’abord l’URL publique de l’instance (Admin → Serveur)",
        ));
    }
    let st = issue_state(&state.pool, &user.uuid).await.map_err(db_err)?;
    Ok(Json(json!({
        "ok": true,
        "post_url": manifest_post_url(&web_base(), org, &st),
        "manifest": build_manifest(&name, &url, body.workflows),
        "state": st,
    })))
}

// ───────────────────── Conversion du code ─────────────────────

#[derive(Deserialize)]
struct ConvOwner {
    login: String,
    #[serde(rename = "type", default)]
    kind: String,
}

/// Réponse de `POST /app-manifests/{code}/conversions`. Les secrets restent masqués en Debug.
#[derive(Deserialize)]
pub struct ManifestConversion {
    pub id: i64,
    pub slug: String,
    pub client_id: String,
    pub html_url: String,
    owner: ConvOwner,
    client_secret: Redacted<String>,
    webhook_secret: Redacted<String>,
    pem: Redacted<String>,
}

impl<'de> Deserialize<'de> for Redacted<String> {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Option::<String>::deserialize(d).map(|v| Redacted(v.unwrap_or_default()))
    }
}

pub async fn convert_manifest(
    client: &reqwest::Client,
    api: &str,
    code: &str,
) -> Result<ManifestConversion, String> {
    if code.is_empty()
        || !code
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err("code invalide".into());
    }
    let res = client
        .post(format!("{api}/app-manifests/{code}/conversions"))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("GitHub injoignable : {}", e.without_url()))?;
    let status = res.status();
    if !status.is_success() {
        return Err(format!(
            "conversion refusée par GitHub ({})",
            status.as_u16()
        ));
    }
    res.json::<ManifestConversion>()
        .await
        .map_err(|_| "réponse GitHub inattendue".to_string())
}

pub async fn store_app(pool: &PgPool, c: &ManifestConversion) -> Result<(), String> {
    let seal = |v: &str| crate::secret_box::seal(v.as_bytes()).map_err(|e| e.to_string());
    let cs = seal(c.client_secret.expose())?;
    let ws = seal(c.webhook_secret.expose())?;
    let pk = seal(c.pem.expose())?;
    sqlx::query(
        r#"
        INSERT INTO github_app (id, app_id, slug, client_id, client_secret_enc, webhook_secret_enc,
                                private_key_enc, html_url, owner_login, owner_type)
        VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO UPDATE SET
            app_id = EXCLUDED.app_id, slug = EXCLUDED.slug, client_id = EXCLUDED.client_id,
            client_secret_enc = EXCLUDED.client_secret_enc,
            webhook_secret_enc = EXCLUDED.webhook_secret_enc,
            private_key_enc = EXCLUDED.private_key_enc, html_url = EXCLUDED.html_url,
            owner_login = EXCLUDED.owner_login, owner_type = EXCLUDED.owner_type,
            created_at = now()
        "#,
    )
    .bind(c.id)
    .bind(&c.slug)
    .bind(&c.client_id)
    .bind(cs)
    .bind(ws)
    .bind(pk)
    .bind(&c.html_url)
    .bind(&c.owner.login)
    .bind(if c.owner.kind.is_empty() {
        "User"
    } else {
        &c.owner.kind
    })
    .execute(pool)
    .await
    .map_err(|e| format!("enregistrement impossible : {e}"))?;
    Ok(())
}

#[derive(Deserialize)]
struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
}

fn state_error_response(e: StateError) -> Response {
    let msg = match e {
        StateError::Unknown => {
            "Lien de création invalide ou déjà utilisé. Relance depuis DevForge."
        }
        StateError::Expired => "Lien de création expiré (10 min). Relance depuis DevForge.",
        StateError::OtherUser => "Ce lien a été généré pour un autre compte.",
    };
    err(StatusCode::BAD_REQUEST, msg).into_response()
}

async fn manifest_callback(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<CallbackQuery>,
) -> Response {
    let user = match require_admin(&state, &headers).await {
        Ok(u) => u,
        Err(e) => return e.into_response(),
    };
    let (Some(code), Some(st)) = (q.code, q.state) else {
        return err(StatusCode::BAD_REQUEST, "code ou state manquant").into_response();
    };
    if let Err(e) = consume_state(&state.pool, &st, &user.uuid).await {
        return state_error_response(e);
    }
    let conv = match convert_manifest(&http(), &api_base(), &code).await {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("github-app : {e}");
            return settings_redirect("error=conversion");
        }
    };
    if let Err(e) = store_app(&state.pool, &conv).await {
        tracing::error!("github-app : {e}");
        return settings_redirect("error=stockage");
    }
    tracing::info!(app_id = conv.id, slug = %conv.slug, "github-app : app créée");
    let install_state = match issue_state(&state.pool, &user.uuid).await {
        Ok(s) => s,
        Err(e) => return db_err(e).into_response(),
    };
    Redirect::to(&format!(
        "{}/apps/{}/installations/new?state={}",
        web_base(),
        urlencoding::encode(&conv.slug),
        urlencoding::encode(&install_state)
    ))
    .into_response()
}

// ───────────────────── Installation ─────────────────────

/// Identifiants de l'app (clé privée descellée, jamais journalisée).
pub async fn load_credentials(
    pool: &PgPool,
) -> Result<devforge_github::app_auth::AppCredentials, String> {
    let row: Option<(i64, String)> =
        sqlx::query_as("SELECT app_id, private_key_enc FROM github_app WHERE id = 1")
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?;
    let (app_id, enc) = row.ok_or("aucune app GitHub configurée")?;
    let pem = crate::secret_box::open(&enc).map_err(|e| e.to_string())?;
    let pem = String::from_utf8(pem.to_vec()).map_err(|_| "clé privée illisible")?;
    Ok(devforge_github::app_auth::AppCredentials::new(app_id, pem))
}

async fn load_app_jwt(pool: &PgPool) -> Result<Redacted<String>, String> {
    let creds = load_credentials(pool).await?;
    creds
        .app_jwt()
        .map(|j| Redacted(j.expose().to_string()))
        .map_err(|e| e.to_string())
}

#[derive(Deserialize)]
struct InstAccount {
    login: String,
    #[serde(rename = "type", default)]
    kind: String,
}

#[derive(Deserialize)]
pub struct Installation {
    pub id: i64,
    account: InstAccount,
    #[serde(default)]
    repository_selection: String,
    #[serde(default)]
    permissions: Value,
    #[serde(default)]
    suspended_at: Option<String>,
}

#[derive(Deserialize)]
struct InstRepo {
    id: i64,
    full_name: String,
    #[serde(default)]
    private: bool,
    default_branch: Option<String>,
}

#[derive(Deserialize)]
struct InstRepoPage {
    repositories: Vec<InstRepo>,
}

#[derive(Deserialize)]
struct InstToken {
    token: Redacted<String>,
}

async fn gh_get<T: serde::de::DeserializeOwned>(
    client: &reqwest::Client,
    url: &str,
    bearer: &str,
) -> Result<T, String> {
    let res = client
        .get(url)
        .bearer_auth(bearer)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| format!("GitHub injoignable : {}", e.without_url()))?;
    let s = res.status();
    if !s.is_success() {
        return Err(format!("GitHub a répondu {}", s.as_u16()));
    }
    res.json::<T>()
        .await
        .map_err(|_| "réponse GitHub inattendue".into())
}

/// Vérifie l'installation côté GitHub (on ne fait pas confiance à la query), puis upsert + repos.
pub async fn verify_and_store_installation(
    pool: &PgPool,
    client: &reqwest::Client,
    api: &str,
    jwt: &str,
    installation_id: i64,
    user_uuid: &str,
) -> Result<Installation, String> {
    let inst: Installation = gh_get(
        client,
        &format!("{api}/app/installations/{installation_id}"),
        jwt,
    )
    .await?;
    if inst.id != installation_id {
        return Err("installation incohérente".into());
    }
    sqlx::query(
        r#"
        INSERT INTO github_installations (installation_id, account_login, account_type,
            repository_selection, permissions, suspended_at, created_by_user_uuid)
        VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7)
        ON CONFLICT (installation_id) DO UPDATE SET
            account_login = EXCLUDED.account_login, account_type = EXCLUDED.account_type,
            repository_selection = EXCLUDED.repository_selection,
            permissions = EXCLUDED.permissions, suspended_at = EXCLUDED.suspended_at,
            updated_at = now()
        "#,
    )
    .bind(inst.id)
    .bind(&inst.account.login)
    .bind(&inst.account.kind)
    .bind(&inst.repository_selection)
    .bind(&inst.permissions)
    .bind(inst.suspended_at.as_deref())
    .bind(user_uuid)
    .execute(pool)
    .await
    .map_err(|e| format!("enregistrement installation : {e}"))?;

    // Synchronisation des dépôts accessibles (token d'installation éphémère, non mis en cache en P1).
    let res = client
        .post(format!(
            "{api}/app/installations/{installation_id}/access_tokens"
        ))
        .bearer_auth(jwt)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("GitHub injoignable : {}", e.without_url()))?;
    if !res.status().is_success() {
        return Err(format!(
            "token d’installation refusé ({})",
            res.status().as_u16()
        ));
    }
    let tok: InstToken = res.json().await.map_err(|_| "réponse GitHub inattendue")?;
    let mut repos = Vec::new();
    for page in 1..=10 {
        let p: InstRepoPage = gh_get(
            client,
            &format!("{api}/installation/repositories?per_page=100&page={page}"),
            tok.token.expose(),
        )
        .await?;
        let n = p.repositories.len();
        repos.extend(p.repositories);
        if n < 100 {
            break;
        }
    }
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM github_installation_repos WHERE installation_id = $1")
        .bind(installation_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    for r in &repos {
        sqlx::query(
            "INSERT INTO github_installation_repos (installation_id, repo_id, full_name, private, default_branch) VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(installation_id)
        .bind(r.id)
        .bind(&r.full_name)
        .bind(r.private)
        .bind(&r.default_branch)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(inst)
}

#[derive(Deserialize)]
struct InstalledQuery {
    installation_id: Option<String>,
    setup_action: Option<String>,
    state: Option<String>,
}

async fn installed(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<InstalledQuery>,
) -> Response {
    let user = match require_admin(&state, &headers).await {
        Ok(u) => u,
        Err(e) => return e.into_response(),
    };
    // `setup_on_update` : GitHub rappelle aussi lors d'une mise à jour, sans `state`.
    if let Some(st) = q.state.as_deref().filter(|s| !s.is_empty()) {
        if let Err(e) = consume_state(&state.pool, st, &user.uuid).await {
            return state_error_response(e);
        }
    }
    let Some(id) = q.installation_id.and_then(|s| s.trim().parse::<i64>().ok()) else {
        return err(StatusCode::BAD_REQUEST, "installation_id manquant").into_response();
    };
    let jwt = match load_app_jwt(&state.pool).await {
        Ok(j) => j,
        Err(e) => {
            tracing::warn!("github-app : {e}");
            return settings_redirect("error=app");
        }
    };
    match verify_and_store_installation(
        &state.pool,
        &http(),
        &api_base(),
        jwt.expose(),
        id,
        &user.uuid,
    )
    .await
    {
        Ok(inst) => {
            tracing::info!(
                installation_id = inst.id,
                account = %inst.account.login,
                action = q.setup_action.as_deref().unwrap_or(""),
                "github-app : installation enregistrée"
            );
            settings_redirect("installed=1")
        }
        Err(e) => {
            tracing::warn!(
                installation_id = id,
                "github-app : vérification impossible : {e}"
            );
            settings_redirect("error=installation")
        }
    }
}

// ───────────────────── Statut / oubli ─────────────────────

/// Permissions requises absentes ou insuffisantes (`write` couvre `read`).
pub fn missing_permissions(granted: &Value) -> Vec<String> {
    REQUIRED_PERMISSIONS
        .iter()
        .filter(|(k, need)| {
            let have = granted.get(*k).and_then(Value::as_str).unwrap_or("");
            !(have == *need || (have == "write" && *need == "read") || have == "admin")
        })
        .map(|(k, need)| format!("{k}:{need}"))
        .collect()
}

pub fn manage_url(web: &str, slug: &str, owner_login: &str, owner_type: &str) -> String {
    if owner_type.eq_ignore_ascii_case("Organization") {
        format!("{web}/organizations/{owner_login}/settings/apps/{slug}/advanced")
    } else {
        format!("{web}/settings/apps/{slug}/advanced")
    }
}

pub async fn status_json(pool: &PgPool) -> Result<Value, sqlx::Error> {
    let app: Option<(i64, String, String, String, String, String)> = sqlx::query_as(
        "SELECT app_id, slug, client_id, html_url, owner_login, owner_type FROM github_app WHERE id = 1",
    )
    .fetch_optional(pool)
    .await?;
    let insts: Vec<(i64, String, String, String, Value, bool)> = sqlx::query_as(
        r#"SELECT i.installation_id, i.account_login, i.account_type, i.repository_selection,
                  i.permissions, i.suspended_at IS NOT NULL
           FROM github_installations i ORDER BY i.created_at"#,
    )
    .fetch_all(pool)
    .await?;
    let counts: Vec<(i64, i64)> = sqlx::query_as(
        "SELECT installation_id, count(*) FROM github_installation_repos GROUP BY installation_id",
    )
    .fetch_all(pool)
    .await?;
    // Projets liés à une installation supprimée côté GitHub (mode « déconnecté »).
    let (disconnected,): (i64,) = sqlx::query_as(
        r#"SELECT count(*) FROM projects p WHERE p.github_installation_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM github_installations i
                           WHERE i.installation_id = p.github_installation_id)"#,
    )
    .fetch_one(pool)
    .await?;
    let web = web_base();
    let installations: Vec<Value> = insts
        .into_iter()
        .map(|(id, login, kind, sel, perms, suspended)| {
            let repos = counts
                .iter()
                .find(|(i, _)| *i == id)
                .map(|c| c.1)
                .unwrap_or(0);
            json!({
                "installation_id": id,
                "account_login": login,
                "account_type": kind,
                "repository_selection": sel,
                "repositories": repos,
                "suspended": suspended,
                "permissions": perms,
                "missing_permissions": missing_permissions(&perms),
            })
        })
        .collect();
    let required: serde_json::Map<String, Value> = REQUIRED_PERMISSIONS
        .iter()
        .map(|(k, v)| ((*k).to_string(), json!(v)))
        .collect();
    Ok(match app {
        None => json!({
            "ok": true, "configured": false, "required_permissions": required,
            "installations": installations, "disconnected_projects": disconnected,
        }),
        Some((app_id, slug, client_id, html_url, owner, owner_type)) => json!({
            "ok": true,
            "configured": true,
            "app_id": app_id,
            "slug": slug,
            "client_id": client_id,
            "html_url": html_url,
            "owner_login": owner,
            "owner_type": owner_type,
            "install_url": format!("{web}/apps/{slug}/installations/new"),
            "manage_url": manage_url(&web, &slug, &owner, &owner_type),
            "required_permissions": required,
            "installations": installations,
            "disconnected_projects": disconnected,
        }),
    })
}

async fn status(State(state): State<AppState>, headers: HeaderMap) -> Result<Json<Value>, ApiErr> {
    require_admin(&state, &headers).await?;
    status_json(&state.pool).await.map(Json).map_err(db_err)
}

async fn forget(State(state): State<AppState>, headers: HeaderMap) -> Result<Json<Value>, ApiErr> {
    require_admin(&state, &headers).await?;
    let st = status_json(&state.pool).await.map_err(db_err)?;
    let mut tx = state.pool.begin().await.map_err(db_err)?;
    sqlx::query("DELETE FROM github_installations")
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    sqlx::query("DELETE FROM github_app WHERE id = 1")
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;
    Ok(Json(json!({
        "ok": true,
        "configured": false,
        // L'app existe toujours chez GitHub : lien pour la supprimer là-bas.
        "manage_url": st.get("manage_url").cloned().unwrap_or(Value::Null),
    })))
}

#[cfg(test)]
#[path = "github_app_routes_tests.rs"]
mod tests;
