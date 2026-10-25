//! P3 : surveillance de page (« page watch »).
//!
//! Idée reprise d'OpenMuse (MIT), pas le code. Une surveillance relit une page publique à
//! intervalle régulier et prévient quand :
//! - `change` : le texte de la page change (après normalisation) ;
//! - `text` : un texte apparaît (`appears`) ou disparaît (`disappears`) ;
//! - `price` : un prix passe sous (`below`) ou au-dessus (`above`) d'un seuil, dans une devise.
//!
//! Règles :
//! - normalisation avant comparaison : scripts, styles et commentaires retirés, espaces
//!   compactés, dates relatives (« il y a 2 h », « 5 min ago ») neutralisées ;
//! - alertes dédupliquées : clé = hash(surveillance, séquence, état détecté), insérée une seule
//!   fois ; le même état n'est jamais signalé deux fois de suite ;
//! - erreurs : nouvel essai dans min(60, 2^n) minutes, pause automatique après 5 échecs
//!   d'affilée, avec une seule alerte ;
//! - planification : le tic d'une minute du planificateur cron (`devforge_cron::add_tick_hook`),
//!   avec un bail SQL par surveillance (même principe que les baux des runs, P1) ;
//! - SSRF : http/https seulement, IP privées / loopback / link-local / métadonnées refusées,
//!   y compris après résolution DNS et après chaque redirection ; taille et durée bornées ;
//!   aucun cookie ni identifiant transmis.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use regex::Regex;
use reqwest::Url;
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::PgPool;

/// Taille maximale lue (au-delà : échec « page trop lourde »).
pub const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;
/// Durée maximale d'une vérification complète (DNS + redirections + corps).
pub const FETCH_TIMEOUT: Duration = Duration::from_secs(15);
pub const MAX_REDIRECTS: usize = 5;
/// Pause automatique après ce nombre d'échecs consécutifs.
pub const MAX_FAILURES: i32 = 5;
/// Plafond du backoff (minutes).
pub const MAX_BACKOFF_MINUTES: i64 = 60;
/// Intervalles proposés (minutes). 60 par défaut.
pub const INTERVALS: &[i32] = &[15, 30, 60, 180, 360, 720, 1440];
pub const DEFAULT_INTERVAL: i32 = 60;
pub const MAX_WATCHES_PER_WORKSPACE: i64 = 50;
/// Bail d'une vérification en cours (une vérif dure au plus `FETCH_TIMEOUT`).
pub const LEASE_SECS: i64 = 120;
/// Historique conservé par surveillance.
pub const KEEP_CHECKS: i64 = 50;
/// Instantané de texte conservé pour le diff lisible.
const MAX_SNAPSHOT_BYTES: usize = 100 * 1024;
const MAX_LINES: usize = 2000;
const MAX_LINE_CHARS: usize = 300;
pub const USER_AGENT: &str = "DevForge-PageWatch/1.0 (+https://web.jeser.app)";

pub const CURRENCIES: &[&str] = &["EUR", "USD", "GBP", "CHF"];

// ---------------------------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------------------------

pub async fn migrate(pool: &PgPool) -> Result<(), sqlx::Error> {
    for sql in [
        r#"CREATE TABLE IF NOT EXISTS page_watches (
            uuid              TEXT PRIMARY KEY,
            workspace_uuid    TEXT NOT NULL,
            created_by        TEXT NULL,
            name              TEXT NOT NULL,
            url               TEXT NOT NULL,
            kind              TEXT NOT NULL DEFAULT 'change',
            needle            TEXT NULL,
            text_mode         TEXT NULL,
            price_op          TEXT NULL,
            threshold         DOUBLE PRECISION NULL,
            currency          TEXT NULL,
            interval_minutes  INT NOT NULL DEFAULT 60,
            status            TEXT NOT NULL DEFAULT 'active',
            paused_reason     TEXT NULL,
            failure_streak    INT NOT NULL DEFAULT 0,
            last_check_at     TIMESTAMPTZ NULL,
            next_check_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_success_at   TIMESTAMPTZ NULL,
            last_error        TEXT NULL,
            last_http_status  INT NULL,
            last_value        TEXT NULL,
            last_summary      TEXT NULL,
            condition_met     BOOLEAN NOT NULL DEFAULT FALSE,
            last_hash         TEXT NULL,
            last_snapshot     TEXT NULL,
            last_alert_hash   TEXT NULL,
            alert_seq         INT NOT NULL DEFAULT 0,
            last_alert_at     TIMESTAMPTZ NULL,
            lease_owner       TEXT NULL,
            lease_until       TIMESTAMPTZ NULL,
            created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
        )"#,
        // Colonnes ajoutées après coup : rejouables.
        "ALTER TABLE page_watches ADD COLUMN IF NOT EXISTS last_alert_at TIMESTAMPTZ NULL",
        "ALTER TABLE page_watches ADD COLUMN IF NOT EXISTS paused_reason TEXT NULL",
        "CREATE INDEX IF NOT EXISTS idx_page_watches_ws ON page_watches (workspace_uuid, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_page_watches_due ON page_watches (status, next_check_at)",
        r#"CREATE TABLE IF NOT EXISTS page_watch_checks (
            uuid         TEXT PRIMARY KEY,
            watch_uuid   TEXT NOT NULL REFERENCES page_watches(uuid) ON DELETE CASCADE,
            checked_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            outcome      TEXT NOT NULL,
            http_status  INT NULL,
            duration_ms  INT NULL,
            value        TEXT NULL,
            summary      TEXT NULL,
            error        TEXT NULL,
            state_hash   TEXT NULL,
            alerted      BOOLEAN NOT NULL DEFAULT FALSE
        )"#,
        "CREATE INDEX IF NOT EXISTS idx_page_watch_checks ON page_watch_checks (watch_uuid, checked_at DESC)",
        r#"CREATE TABLE IF NOT EXISTS page_watch_alerts (
            uuid            TEXT PRIMARY KEY,
            dedupe_key      TEXT NOT NULL UNIQUE,
            watch_uuid      TEXT NOT NULL REFERENCES page_watches(uuid) ON DELETE CASCADE,
            workspace_uuid  TEXT NOT NULL,
            kind            TEXT NOT NULL,
            title           TEXT NOT NULL,
            body            TEXT NOT NULL,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            read_at         TIMESTAMPTZ NULL
        )"#,
        "CREATE INDEX IF NOT EXISTS idx_page_watch_alerts_ws ON page_watch_alerts (workspace_uuid, created_at DESC)",
    ] {
        sqlx::query(sql).execute(pool).await?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Modèle
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct PageWatch {
    pub uuid: String,
    pub workspace_uuid: String,
    pub created_by: Option<String>,
    pub name: String,
    pub url: String,
    pub kind: String,
    pub needle: Option<String>,
    pub text_mode: Option<String>,
    pub price_op: Option<String>,
    pub threshold: Option<f64>,
    pub currency: Option<String>,
    pub interval_minutes: i32,
    pub status: String,
    pub paused_reason: Option<String>,
    pub failure_streak: i32,
    pub last_check_at: Option<DateTime<Utc>>,
    pub next_check_at: DateTime<Utc>,
    pub last_success_at: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
    pub last_http_status: Option<i32>,
    pub last_value: Option<String>,
    pub last_summary: Option<String>,
    pub condition_met: bool,
    pub last_hash: Option<String>,
    #[serde(skip)]
    pub last_snapshot: Option<String>,
    #[serde(skip)]
    pub last_alert_hash: Option<String>,
    pub alert_seq: i32,
    pub last_alert_at: Option<DateTime<Utc>>,
    #[serde(skip)]
    pub lease_owner: Option<String>,
    #[serde(skip)]
    #[allow(dead_code)]
    pub lease_until: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl PageWatch {
    pub fn spec(&self) -> WatchSpec {
        WatchSpec {
            kind: self.kind.clone(),
            needle: self.needle.clone(),
            text_mode: self.text_mode.clone(),
            price_op: self.price_op.clone(),
            threshold: self.threshold,
            currency: self.currency.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct WatchCheck {
    pub uuid: String,
    pub watch_uuid: String,
    pub checked_at: DateTime<Utc>,
    pub outcome: String,
    pub http_status: Option<i32>,
    pub duration_ms: Option<i32>,
    pub value: Option<String>,
    pub summary: Option<String>,
    pub error: Option<String>,
    pub state_hash: Option<String>,
    pub alerted: bool,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct WatchAlert {
    pub uuid: String,
    pub watch_uuid: String,
    pub workspace_uuid: String,
    pub kind: String,
    pub title: String,
    pub body: String,
    pub created_at: DateTime<Utc>,
    pub read_at: Option<DateTime<Utc>>,
}

/// Ce qu'on surveille (sans l'URL ni la planification).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct WatchSpec {
    pub kind: String,
    pub needle: Option<String>,
    pub text_mode: Option<String>,
    pub price_op: Option<String>,
    pub threshold: Option<f64>,
    pub currency: Option<String>,
}

impl WatchSpec {
    /// Valide et complète les valeurs par défaut (zéro config : `change`, EUR, `below`, `appears`).
    pub fn normalized(mut self) -> Result<Self, String> {
        let kind = self.kind.trim().to_lowercase();
        self.kind = if kind.is_empty() {
            "change".into()
        } else {
            kind
        };
        self.needle = self
            .needle
            .map(|n| n.trim().chars().take(200).collect::<String>())
            .filter(|n| !n.is_empty());
        match self.kind.as_str() {
            "change" => {
                self.needle = None;
                self.text_mode = None;
                self.price_op = None;
                self.threshold = None;
                self.currency = None;
            }
            "text" => {
                if self.needle.is_none() {
                    return Err("Indique le texte à guetter.".into());
                }
                let mode = self
                    .text_mode
                    .as_deref()
                    .unwrap_or("appears")
                    .trim()
                    .to_lowercase();
                if !matches!(mode.as_str(), "appears" | "disappears") {
                    return Err("Choisis « apparaît » ou « disparaît ».".into());
                }
                self.text_mode = Some(mode);
                self.price_op = None;
                self.threshold = None;
                self.currency = None;
            }
            "price" => {
                let op = self
                    .price_op
                    .as_deref()
                    .unwrap_or("below")
                    .trim()
                    .to_lowercase();
                if !matches!(op.as_str(), "below" | "above") {
                    return Err("Choisis « sous » ou « au-dessus ».".into());
                }
                let t = self.threshold.ok_or("Indique le seuil de prix.")?;
                if !t.is_finite() || t < 0.0 || t > 1e9 {
                    return Err("Seuil de prix invalide.".into());
                }
                let cur = self
                    .currency
                    .as_deref()
                    .unwrap_or("EUR")
                    .trim()
                    .to_uppercase();
                if !CURRENCIES.contains(&cur.as_str()) {
                    return Err("Devise non prise en charge (EUR, USD, GBP, CHF).".into());
                }
                self.price_op = Some(op);
                self.currency = Some(cur);
                self.text_mode = None;
            }
            _ => return Err("Type inconnu : change, text ou price.".into()),
        }
        Ok(self)
    }
}

pub fn normalize_interval(v: Option<i32>) -> Result<i32, String> {
    let v = v.unwrap_or(DEFAULT_INTERVAL);
    if INTERVALS.contains(&v) {
        Ok(v)
    } else {
        Err("Intervalle non proposé (15 min à 24 h).".into())
    }
}

pub fn new_uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub fn sha256_hex(parts: &[&str]) -> String {
    let mut h = Sha256::new();
    for p in parts {
        h.update(p.as_bytes());
        h.update([0x1f]);
    }
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

// ---------------------------------------------------------------------------------------------
// SSRF : adresses refusées, validation d'URL, résolveur filtrant
// ---------------------------------------------------------------------------------------------

/// IPv4 non publique : loopback, privée, link-local (dont 169.254.169.254), CGNAT, réservée…
pub fn ipv4_is_forbidden(v4: Ipv4Addr) -> bool {
    let o = v4.octets();
    v4.is_unspecified()
        || v4.is_loopback()
        || v4.is_private()
        || v4.is_link_local()
        || v4.is_broadcast()
        || v4.is_multicast()
        || v4.is_documentation()
        || o[0] == 0
        || (o[0] == 100 && (o[1] & 0xc0) == 64) // 100.64.0.0/10
        || (o[0] == 192 && o[1] == 0 && o[2] == 0) // 192.0.0.0/24
        || (o[0] == 198 && (o[1] & 0xfe) == 18) // 198.18.0.0/15
        || o[0] >= 240
}

pub fn ipv6_is_forbidden(v6: Ipv6Addr) -> bool {
    if let Some(v4) = v6.to_ipv4_mapped() {
        return ipv4_is_forbidden(v4);
    }
    let s = v6.segments();
    let embedded =
        |hi: u16, lo: u16| Ipv4Addr::new((hi >> 8) as u8, hi as u8, (lo >> 8) as u8, lo as u8);
    v6.is_unspecified()
        || v6.is_loopback()
        || v6.is_multicast()
        || (s[0] & 0xfe00) == 0xfc00 // fc00::/7 (dont fd00:ec2::254)
        || (s[0] & 0xffc0) == 0xfe80 // fe80::/10
        || (s[0] & 0xffc0) == 0xfec0 // fec0::/10
        || (s[0] == 0x2001 && s[1] == 0x0db8) // documentation
        || (s[0] == 0x2001 && s[1] == 0) // Teredo
        || (s[0] == 0x0064 && s[1] == 0xff9b && ipv4_is_forbidden(embedded(s[6], s[7]))) // NAT64
        || (s[0] == 0x2002 && ipv4_is_forbidden(embedded(s[1], s[2]))) // 6to4
        || (s[..6].iter().all(|x| *x == 0)) // ::a.b.c.d (déprécié)
}

pub fn ip_is_forbidden(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => ipv4_is_forbidden(v4),
        IpAddr::V6(v6) => ipv6_is_forbidden(v6),
    }
}

pub const BLOCKED_MESSAGE: &str =
    "Adresse interne refusée : seules les pages publiques sont surveillées.";

/// Bornes d'une lecture. `allow_loopback` n'existe que pour les tests (serveur local).
#[derive(Debug, Clone)]
pub struct FetchPolicy {
    pub timeout: Duration,
    pub max_bytes: usize,
    pub allow_loopback: bool,
}

impl Default for FetchPolicy {
    fn default() -> Self {
        Self {
            timeout: FETCH_TIMEOUT,
            max_bytes: MAX_BODY_BYTES,
            allow_loopback: false,
        }
    }
}

impl FetchPolicy {
    pub fn allows(&self, ip: IpAddr) -> bool {
        if self.allow_loopback && ip.is_loopback() {
            return true;
        }
        !ip_is_forbidden(ip)
    }
}

/// URL publique http(s), sans identifiants, sans IP interne littérale.
pub fn validate_url(raw: &str, policy: &FetchPolicy) -> Result<Url, String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Err("Indique l'adresse de la page.".into());
    }
    if raw.len() > 2048 {
        return Err("Adresse trop longue.".into());
    }
    let url = Url::parse(raw)
        .map_err(|_| "Adresse invalide (ex. https://exemple.fr/page).".to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Seules les adresses http et https sont acceptées.".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(
            "Pas d'identifiants dans l'adresse : seules les pages publiques sont surveillées."
                .into(),
        );
    }
    let host = url.host_str().unwrap_or("").to_lowercase();
    let bare = host.trim_start_matches('[').trim_end_matches(']');
    if bare.is_empty() {
        return Err("Adresse sans domaine.".into());
    }
    if let Ok(ip) = bare.parse::<IpAddr>() {
        if !policy.allows(ip) {
            return Err(BLOCKED_MESSAGE.into());
        }
    } else {
        let d = bare.trim_end_matches('.');
        let local = d == "localhost" || d.ends_with(".localhost");
        if (local && !policy.allow_loopback) || d.is_empty() {
            return Err(BLOCKED_MESSAGE.into());
        }
    }
    Ok(url)
}

#[derive(Debug)]
struct Blocked;

impl std::fmt::Display for Blocked {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(BLOCKED_MESSAGE)
    }
}

impl std::error::Error for Blocked {}

/// Résout puis filtre : la connexion part vers une adresse déjà vérifiée (pas de rebinding).
/// Une seule adresse interne parmi les réponses suffit à refuser.
pub async fn resolve_public(
    host: &str,
    port: u16,
    policy: &FetchPolicy,
) -> Result<Vec<SocketAddr>, String> {
    let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host, port))
        .await
        .map_err(|_| format!("Domaine introuvable : {host}"))?
        .collect();
    if addrs.is_empty() {
        return Err(format!("Domaine introuvable : {host}"));
    }
    if addrs.iter().any(|a| !policy.allows(a.ip())) {
        return Err(BLOCKED_MESSAGE.into());
    }
    Ok(addrs)
}

struct GuardedResolver {
    policy: FetchPolicy,
}

impl reqwest::dns::Resolve for GuardedResolver {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let policy = self.policy.clone();
        Box::pin(async move {
            let host = name.as_str().to_string();
            match resolve_public(&host, 0, &policy).await {
                Ok(addrs) => Ok(Box::new(addrs.into_iter()) as reqwest::dns::Addrs),
                Err(e) if e == BLOCKED_MESSAGE => {
                    Err(Box::new(Blocked) as Box<dyn std::error::Error + Send + Sync>)
                }
                Err(e) => Err(e.into()),
            }
        })
    }
}

#[derive(Debug, Clone)]
pub struct Fetched {
    pub status: u16,
    #[allow(dead_code)]
    pub final_url: String,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FetchError {
    pub message: String,
    pub http_status: Option<u16>,
    /// Adresse interne (SSRF) : refus de principe.
    pub blocked: bool,
}

impl FetchError {
    fn msg(m: impl Into<String>) -> Self {
        Self {
            message: m.into(),
            http_status: None,
            blocked: false,
        }
    }
    fn blocked() -> Self {
        Self {
            message: BLOCKED_MESSAGE.into(),
            http_status: None,
            blocked: true,
        }
    }
}

fn error_chain(e: &(dyn std::error::Error + 'static)) -> (bool, String) {
    let mut cur: Option<&(dyn std::error::Error + 'static)> = Some(e);
    let mut parts = Vec::new();
    let mut blocked = false;
    while let Some(err) = cur {
        if err.is::<Blocked>() || err.to_string().contains(BLOCKED_MESSAGE) {
            blocked = true;
        }
        parts.push(err.to_string());
        cur = err.source();
    }
    (blocked, parts.join(" : "))
}

fn map_reqwest(e: reqwest::Error) -> FetchError {
    let (blocked, chain) = error_chain(&e);
    if blocked {
        return FetchError::blocked();
    }
    if e.is_timeout() {
        return FetchError::msg("La page met trop de temps à répondre.");
    }
    if e.is_connect() {
        if chain.contains("Domaine introuvable") {
            return FetchError::msg("Domaine introuvable.");
        }
        return FetchError::msg("Connexion impossible à la page.");
    }
    FetchError::msg("Lecture de la page impossible.")
}

fn content_type_ok(ct: &str) -> bool {
    let ct = ct.to_lowercase();
    ct.is_empty()
        || ct.starts_with("text/")
        || ct.contains("html")
        || ct.contains("xml")
        || ct.contains("json")
}

/// Lit une page publique en GET. Redirections suivies à la main (≤ 5), chacune revalidée.
/// Aucun cookie, aucun en-tête d'authentification, aucun proxy système.
pub async fn fetch(raw_url: &str, policy: &FetchPolicy) -> Result<Fetched, FetchError> {
    let policy = policy.clone();
    match tokio::time::timeout(policy.timeout, fetch_inner(raw_url, &policy)).await {
        Ok(r) => r,
        Err(_) => Err(FetchError::msg("La page met trop de temps à répondre.")),
    }
}

async fn fetch_inner(raw_url: &str, policy: &FetchPolicy) -> Result<Fetched, FetchError> {
    let client = reqwest::Client::builder()
        .dns_resolver(Arc::new(GuardedResolver {
            policy: policy.clone(),
        }))
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .connect_timeout(Duration::from_secs(5))
        .timeout(policy.timeout)
        .user_agent(USER_AGENT)
        .build()
        .map_err(|_| FetchError::msg("Client HTTP indisponible."))?;

    let mut url = validate_url(raw_url, policy).map_err(|m| FetchError {
        blocked: m == BLOCKED_MESSAGE,
        message: m,
        http_status: None,
    })?;
    for _hop in 0..=MAX_REDIRECTS {
        let resp = client
            .get(url.clone())
            .header(
                reqwest::header::ACCEPT,
                "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
            )
            .header(reqwest::header::ACCEPT_LANGUAGE, "fr-FR,fr;q=0.9,en;q=0.7")
            .send()
            .await
            .map_err(map_reqwest)?;
        let status = resp.status();
        if status.is_redirection() {
            let loc = resp
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| FetchError::msg("Redirection sans destination."))?;
            let next = url
                .join(loc)
                .map_err(|_| FetchError::msg("Redirection invalide."))?;
            url = validate_url(next.as_str(), policy).map_err(|m| FetchError {
                blocked: m == BLOCKED_MESSAGE,
                message: m,
                http_status: None,
            })?;
            continue;
        }
        if !status.is_success() {
            return Err(FetchError {
                message: format!("La page répond {}.", status.as_u16()),
                http_status: Some(status.as_u16()),
                blocked: false,
            });
        }
        let ct = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        if !content_type_ok(&ct) {
            return Err(FetchError {
                message: "Ce n'est pas une page web (image, PDF…).".into(),
                http_status: Some(status.as_u16()),
                blocked: false,
            });
        }
        if resp
            .content_length()
            .is_some_and(|n| n as usize > policy.max_bytes)
        {
            return Err(too_big(status.as_u16(), policy));
        }
        let mut resp = resp;
        let mut buf: Vec<u8> = Vec::new();
        while let Some(chunk) = resp.chunk().await.map_err(map_reqwest)? {
            if buf.len() + chunk.len() > policy.max_bytes {
                return Err(too_big(status.as_u16(), policy));
            }
            buf.extend_from_slice(&chunk);
        }
        return Ok(Fetched {
            status: status.as_u16(),
            final_url: url.to_string(),
            body: String::from_utf8_lossy(&buf).into_owned(),
        });
    }
    Err(FetchError::msg("Trop de redirections."))
}

fn too_big(status: u16, policy: &FetchPolicy) -> FetchError {
    FetchError {
        message: format!(
            "Page trop lourde (plus de {} Mo).",
            (policy.max_bytes / (1024 * 1024)).max(1)
        ),
        http_status: Some(status),
        blocked: false,
    }
}

// ---------------------------------------------------------------------------------------------
// Normalisation et diff
// ---------------------------------------------------------------------------------------------

static RE_COMMENT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)<!--.*?-->").unwrap());
static RE_DROP: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    [
        "script", "style", "noscript", "template", "svg", "iframe", "head", "canvas",
    ]
    .iter()
    .map(|t| Regex::new(&format!(r"(?is)<{t}\b[^>]*>.*?</{t}\s*>")).unwrap())
    .collect()
});
static RE_BLOCK: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)<\s*(?:br|hr|/p|/div|/li|/tr|/h[1-6]|/section|/article|/header|/footer|/ul|/ol|/table|/dd|/dt|/blockquote|/main|/nav|/aside|/option|/label|/button|/td|/th)\b[^>]*>").unwrap()
});
static RE_TAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)<[^>]*>").unwrap());
static RE_NUM_ENTITY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"&#(?:x([0-9a-fA-F]{1,6})|([0-9]{1,7}));").unwrap());
static RE_SPACES: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[\s\u{a0}\u{202f}\u{2009}]+").unwrap());
static RE_REL_FR: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\bil y a\s+(?:environ\s+|plus d[e']\s*|moins d[e']\s*)?(?:(?:\d+|une?|quelques)\s*(?:secondes?|sec|s|minutes?|mins?|mn|m|heures?|h|jours?|j|semaines?|sem|mois|ans?|années?)\b\s*(?:et\s+)?)+").unwrap()
});
static RE_REL_EN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(?:about\s+|over\s+)?(?:(?:\d+|an?|a few)\s*(?:seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|months?|mo|years?|yrs?|y)\b\s*(?:and\s+)?)+ago\b").unwrap()
});
static RE_REL_WORDS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(?:à l['’]instant|just now|\bmoments? ago\b)").unwrap());

fn decode_entities(s: &str) -> String {
    let s = RE_NUM_ENTITY.replace_all(s, |c: &regex::Captures| {
        let code = c
            .get(1)
            .and_then(|h| u32::from_str_radix(h.as_str(), 16).ok())
            .or_else(|| c.get(2).and_then(|d| d.as_str().parse().ok()));
        code.and_then(char::from_u32)
            .map(|ch| ch.to_string())
            .unwrap_or_default()
    });
    s.replace("&nbsp;", " ")
        .replace("&euro;", "€")
        .replace("&pound;", "£")
        .replace("&dollar;", "$")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&rsquo;", "’")
        .replace("&lsquo;", "‘")
        .replace("&hellip;", "…")
        .replace("&eacute;", "é")
        .replace("&egrave;", "è")
        .replace("&agrave;", "à")
        .replace("&ccedil;", "ç")
        .replace("&amp;", "&")
}

/// Neutralise les dates relatives : un changement qui ne touche qu'elles reste silencieux.
pub fn neutralize_relative(line: &str) -> String {
    let a = RE_REL_FR.replace_all(line, "il y a … ");
    let b = RE_REL_EN.replace_all(&a, "… ago");
    let c = RE_REL_WORDS.replace_all(&b, "…");
    c.into_owned()
}

/// Lignes de texte normalisées, dédoublonnées et bornées.
pub fn page_lines(html: &str) -> Vec<String> {
    let mut s = RE_COMMENT.replace_all(html, " ").into_owned();
    for re in RE_DROP.iter() {
        s = re.replace_all(&s, " ").into_owned();
    }
    let s = RE_BLOCK.replace_all(&s, "\n");
    let s = RE_TAG.replace_all(&s, " ");
    let s = decode_entities(&s);
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for raw in s.lines() {
        let line = RE_SPACES.replace_all(raw, " ");
        let line = neutralize_relative(line.trim());
        let line = RE_SPACES.replace_all(line.trim(), " ").into_owned();
        if line.is_empty() {
            continue;
        }
        let line: String = line.chars().take(MAX_LINE_CHARS).collect();
        if seen.insert(line.clone()) {
            out.push(line);
            if out.len() >= MAX_LINES {
                break;
            }
        }
    }
    out
}

/// Texte d'une page (lignes jointes par « \n »).
#[allow(dead_code)]
pub fn page_text(html: &str) -> String {
    page_lines(html).join("\n")
}

fn bounded_snapshot(lines: &[String]) -> String {
    let mut out = String::new();
    for l in lines {
        if out.len() + l.len() + 1 > MAX_SNAPSHOT_BYTES {
            break;
        }
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str(l);
    }
    out
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct PageDiff {
    pub added: Vec<String>,
    pub removed: Vec<String>,
}

impl PageDiff {
    pub fn summary(&self) -> String {
        let mut parts = Vec::new();
        if !self.added.is_empty() {
            parts.push(format!(
                "{} ligne{} nouvelle{}",
                self.added.len(),
                plural(self.added.len()),
                plural(self.added.len())
            ));
        }
        if !self.removed.is_empty() {
            parts.push(format!(
                "{} ligne{} retirée{}",
                self.removed.len(),
                plural(self.removed.len()),
                plural(self.removed.len())
            ));
        }
        if parts.is_empty() {
            return "Ordre du texte modifié.".into();
        }
        let mut s = parts.join(", ");
        if let Some(first) = self.added.first() {
            let first: String = first.chars().take(140).collect();
            s.push_str(&format!(" · « {first} »"));
        } else if let Some(first) = self.removed.first() {
            let first: String = first.chars().take(140).collect();
            s.push_str(&format!(" · retiré : « {first} »"));
        }
        s
    }
}

fn plural(n: usize) -> &'static str {
    if n > 1 {
        "s"
    } else {
        ""
    }
}

/// Nouvelles / disparues (ensemble de lignes).
pub fn diff_lines(old: &[String], new: &[String]) -> PageDiff {
    let old_set: std::collections::HashSet<&String> = old.iter().collect();
    let new_set: std::collections::HashSet<&String> = new.iter().collect();
    PageDiff {
        added: new
            .iter()
            .filter(|l| !old_set.contains(l))
            .cloned()
            .collect(),
        removed: old
            .iter()
            .filter(|l| !new_set.contains(l))
            .cloned()
            .collect(),
    }
}

// ---------------------------------------------------------------------------------------------
// Prix
// ---------------------------------------------------------------------------------------------

fn currency_symbols(cur: &str) -> &'static [&'static str] {
    match cur {
        "USD" => &["US$", "$", "USD"],
        "GBP" => &["£", "GBP"],
        "CHF" => &["CHF", "Fr."],
        _ => &["€", "EUR"],
    }
}

const NUM: &str = r"\d{1,3}(?:[ \u{a0}\u{202f}.,']\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?";

fn price_regex(cur: &str) -> Regex {
    let syms = currency_symbols(cur)
        .iter()
        .map(|s| {
            let e = regex::escape(s);
            if s.chars().all(|c| c.is_ascii_alphabetic()) {
                format!(r"\b{e}\b")
            } else {
                e
            }
        })
        .collect::<Vec<_>>()
        .join("|");
    // « 12€99 », « 12,99 € », « € 12.99 », « 1 299,00 EUR ».
    Regex::new(&format!(
        r"(?i)(?P<i>\d+)\s?(?:{syms})(?P<c>\d{{2}})\b|(?:{syms})\s?(?P<a>{NUM})|(?P<b>{NUM})\s?(?:{syms})"
    ))
    .unwrap()
}

/// « 1 299,99 » → 1299.99 ; « 1.299 » → 1299 ; « 12.5 » → 12.5.
pub fn parse_number(raw: &str) -> Option<f64> {
    let s: String = raw
        .chars()
        .filter(|c| !matches!(c, ' ' | '\u{a0}' | '\u{202f}' | '\''))
        .collect();
    if s.is_empty() {
        return None;
    }
    let last_dot = s.rfind('.');
    let last_comma = s.rfind(',');
    let normalized = match (last_dot, last_comma) {
        (Some(d), Some(c)) => {
            let (dec, thou) = if d > c { ('.', ',') } else { (',', '.') };
            s.replace(thou, "").replace(dec, ".")
        }
        (Some(p), None) | (None, Some(p)) => {
            let sep = s.as_bytes()[p] as char;
            let decimals = s.len() - p - 1;
            let count = s.matches(sep).count();
            if count == 1 && (1..=2).contains(&decimals) {
                s.replace(sep, ".")
            } else {
                s.replace(sep, "")
            }
        }
        (None, None) => s,
    };
    normalized.parse::<f64>().ok().filter(|v| v.is_finite())
}

/// Prix trouvés dans un texte, dans l'ordre d'apparition.
pub fn prices_in(text: &str, currency: &str) -> Vec<f64> {
    let re = price_regex(currency);
    re.captures_iter(text)
        .filter_map(|c| {
            if let (Some(i), Some(cents)) = (c.name("i"), c.name("c")) {
                return format!("{}.{}", i.as_str(), cents.as_str()).parse().ok();
            }
            c.name("a")
                .or_else(|| c.name("b"))
                .and_then(|m| parse_number(m.as_str()))
        })
        .collect()
}

static RE_META_PRICE: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    vec![
        Regex::new(r#"(?is)<meta[^>]+(?:itemprop|property|name)\s*=\s*["'](?:price|product:price:amount|og:price:amount)["'][^>]*content\s*=\s*["']\s*([0-9][0-9.,\s]*)["']"#).unwrap(),
        Regex::new(r#"(?is)<meta[^>]+content\s*=\s*["']\s*([0-9][0-9.,\s]*)["'][^>]*(?:itemprop|property|name)\s*=\s*["'](?:price|product:price:amount|og:price:amount)["']"#).unwrap(),
        Regex::new(r#"(?is)"(?:price|lowPrice)"\s*:\s*"?\s*([0-9]+(?:[.,][0-9]+)?)"?"#).unwrap(),
    ]
});
static RE_META_CURRENCY: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?is)(?:"priceCurrency"\s*:\s*"|(?:itemprop|property)\s*=\s*["'](?:priceCurrency|product:price:currency|og:price:currency)["'][^>]*content\s*=\s*["'])([A-Za-z]{3})"#).unwrap()
});

/// Prix déclaré par la page (JSON-LD, microdonnées, Open Graph), si la devise concorde.
pub fn structured_price(html: &str, currency: &str) -> Option<f64> {
    if let Some(c) = RE_META_CURRENCY.captures(html) {
        if !c[1].eq_ignore_ascii_case(currency) {
            return None;
        }
    }
    RE_META_PRICE
        .iter()
        .find_map(|re| re.captures(html).and_then(|c| parse_number(c[1].trim())))
}

fn fold(s: &str) -> String {
    RE_SPACES
        .replace_all(&s.to_lowercase(), " ")
        .trim()
        .to_string()
}

/// Prix suivi : après le texte repère s'il y en a un, sinon le prix déclaré par la page,
/// sinon le premier prix affiché dans la devise.
pub fn tracked_price(html: &str, text: &str, currency: &str, anchor: Option<&str>) -> Option<f64> {
    if let Some(anchor) = anchor.map(fold).filter(|a| !a.is_empty()) {
        let hay = fold(text);
        let at = hay.find(&anchor)?;
        let window: String = hay[at..]
            .chars()
            .take(anchor.chars().count() + 400)
            .collect();
        return prices_in(&window, currency).into_iter().next();
    }
    structured_price(html, currency).or_else(|| prices_in(text, currency).into_iter().next())
}

pub fn format_price(v: f64, currency: &str) -> String {
    let s = format!("{v:.2}");
    let s = s.strip_suffix(".00").map(str::to_string).unwrap_or(s);
    match currency {
        "USD" => format!("${s}"),
        "GBP" => format!("£{s}"),
        "CHF" => format!("{} CHF", s.replace('.', ",")),
        _ => format!("{} €", s.replace('.', ",")),
    }
}

// ---------------------------------------------------------------------------------------------
// Évaluation d'une page et décision
// ---------------------------------------------------------------------------------------------

/// Résultat d'une lecture réussie.
#[derive(Debug, Clone, PartialEq)]
pub struct Evaluation {
    /// Condition remplie (`change` : la page a changé depuis la dernière lecture).
    pub met: bool,
    /// Empreinte de l'état détecté (base de la déduplication).
    pub state_hash: String,
    /// Empreinte du texte normalisé.
    pub page_hash: String,
    pub snapshot: String,
    /// Valeur lisible (prix trouvé, « présent »…).
    pub value: Option<String>,
    pub summary: String,
    /// Première lecture d'un `change` : référence, jamais une alerte.
    pub baseline: bool,
}

/// Évalue une page. `previous_hash` / `previous_snapshot` : dernière lecture (diff de `change`).
pub fn evaluate(
    spec: &WatchSpec,
    html: &str,
    previous_hash: Option<&str>,
    previous_snapshot: Option<&str>,
) -> Result<Evaluation, String> {
    let lines = page_lines(html);
    let snapshot = bounded_snapshot(&lines);
    let page_hash = sha256_hex(&[&lines.join("\n")]);
    match spec.kind.as_str() {
        "text" => {
            let needle = spec.needle.as_deref().unwrap_or("");
            let present = !needle.is_empty() && fold(&lines.join(" ")).contains(&fold(needle));
            let appears = spec.text_mode.as_deref() != Some("disappears");
            let met = if appears { present } else { !present };
            let value = if present { "présent" } else { "absent" };
            Ok(Evaluation {
                met,
                state_hash: sha256_hex(&["text", value]),
                page_hash,
                snapshot,
                value: Some(value.into()),
                summary: if present {
                    format!("« {needle} » est sur la page.")
                } else {
                    format!("« {needle} » n'est pas sur la page.")
                },
                baseline: false,
            })
        }
        "price" => {
            let cur = spec.currency.as_deref().unwrap_or("EUR");
            let text = lines.join("\n");
            let price = tracked_price(html, &text, cur, spec.needle.as_deref()).ok_or_else(
                || match spec.needle.as_deref() {
                    Some(a) => format!("Aucun prix en {cur} trouvé près de « {a} »."),
                    None => format!("Aucun prix en {cur} trouvé sur la page."),
                },
            )?;
            let threshold = spec.threshold.unwrap_or(0.0);
            let below = spec.price_op.as_deref() != Some("above");
            let met = if below {
                price <= threshold
            } else {
                price >= threshold
            };
            let shown = format_price(price, cur);
            Ok(Evaluation {
                met,
                state_hash: sha256_hex(&[
                    "price",
                    &format!("{price:.2}"),
                    if met { "1" } else { "0" },
                ]),
                page_hash,
                snapshot,
                value: Some(shown.clone()),
                summary: format!(
                    "Prix lu : {shown} (seuil {} {}).",
                    if below { "≤" } else { "≥" },
                    format_price(threshold, cur)
                ),
                baseline: false,
            })
        }
        _ => {
            let baseline = previous_hash.is_none();
            let changed = previous_hash.is_some_and(|h| h != page_hash);
            let summary = if baseline {
                format!("Référence enregistrée ({} lignes).", lines.len())
            } else if changed {
                let old: Vec<String> = previous_snapshot
                    .unwrap_or("")
                    .lines()
                    .map(str::to_string)
                    .collect();
                diff_lines(&old, &lines).summary()
            } else {
                "Aucun changement.".into()
            };
            Ok(Evaluation {
                met: changed,
                state_hash: page_hash.clone(),
                page_hash,
                snapshot,
                value: None,
                summary,
                baseline,
            })
        }
    }
}

/// Backoff après `streak` échecs : min(60, 2^streak) minutes.
pub fn backoff_minutes(streak: i32) -> i64 {
    let s = streak.clamp(0, 10) as u32;
    (1i64 << s).min(MAX_BACKOFF_MINUTES)
}

#[derive(Debug, Clone, PartialEq)]
pub struct AlertDraft {
    pub dedupe_key: String,
    pub kind: &'static str,
    pub title: String,
    pub body: String,
}

/// Ce que fait une vérification sur la surveillance (fonction pure, testée).
#[derive(Debug, Clone, PartialEq)]
pub struct Decision {
    /// `baseline` | `unchanged` | `changed` | `met` | `not_met` | `error`.
    pub outcome: &'static str,
    pub failure_streak: i32,
    pub next_in_minutes: i64,
    pub auto_pause: bool,
    pub alert: Option<AlertDraft>,
    pub alert_seq: i32,
    pub last_alert_hash: Option<String>,
    pub condition_met: bool,
}

pub fn decide(w: &PageWatch, result: &Result<Evaluation, String>) -> Decision {
    match result {
        Err(err) => {
            let streak = w.failure_streak + 1;
            let pause = streak >= MAX_FAILURES;
            let alert = pause.then(|| {
                let seq = w.alert_seq + 1;
                AlertDraft {
                    dedupe_key: sha256_hex(&[&w.uuid, "paused", &seq.to_string()]),
                    kind: "watch_paused",
                    title: format!("Surveillance en pause · {}", w.name),
                    body: format!(
                        "{MAX_FAILURES} échecs d'affilée ({}). Reprends-la quand la page répond à nouveau.",
                        err.trim_end_matches('.')
                    ),
                }
            });
            Decision {
                outcome: "error",
                failure_streak: streak,
                next_in_minutes: backoff_minutes(streak),
                auto_pause: pause,
                alert_seq: w.alert_seq + i32::from(alert.is_some()),
                alert,
                last_alert_hash: w.last_alert_hash.clone(),
                condition_met: w.condition_met,
            }
        }
        Ok(ev) => {
            let interval = i64::from(w.interval_minutes.max(5));
            let mut d = Decision {
                outcome: "unchanged",
                failure_streak: 0,
                next_in_minutes: interval,
                auto_pause: false,
                alert: None,
                alert_seq: w.alert_seq,
                last_alert_hash: w.last_alert_hash.clone(),
                condition_met: ev.met,
            };
            if w.kind == "change" || !matches!(w.kind.as_str(), "text" | "price") {
                if ev.baseline {
                    d.outcome = "baseline";
                    d.condition_met = false;
                    return d;
                }
                if !ev.met {
                    return d;
                }
                d.outcome = "changed";
                if w.last_alert_hash.as_deref() == Some(ev.state_hash.as_str()) {
                    return d;
                }
                let seq = w.alert_seq + 1;
                d.alert = Some(AlertDraft {
                    dedupe_key: sha256_hex(&[&w.uuid, &seq.to_string(), &ev.state_hash]),
                    kind: "watch_alert",
                    title: format!("Page modifiée · {}", w.name),
                    body: ev.summary.clone(),
                });
                d.alert_seq = seq;
                d.last_alert_hash = Some(ev.state_hash.clone());
                return d;
            }
            if !ev.met {
                // Condition retombée : la prochaine fois qu'elle se remplit, on prévient.
                d.outcome = "not_met";
                d.last_alert_hash = None;
                return d;
            }
            d.outcome = "met";
            if w.last_alert_hash.as_deref() == Some(ev.state_hash.as_str()) {
                return d; // même état déjà signalé
            }
            let seq = w.alert_seq + 1;
            let (title, body) = match w.kind.as_str() {
                "text" => {
                    let needle = w.needle.as_deref().unwrap_or("");
                    if w.text_mode.as_deref() == Some("disappears") {
                        (
                            format!("Texte disparu · {}", w.name),
                            format!("« {needle} » n'est plus sur la page."),
                        )
                    } else {
                        (
                            format!("Texte trouvé · {}", w.name),
                            format!("« {needle} » est maintenant sur la page."),
                        )
                    }
                }
                _ => {
                    let below = w.price_op.as_deref() != Some("above");
                    (
                        format!(
                            "Prix {} du seuil · {}",
                            if below { "sous" } else { "au-dessus" },
                            w.name
                        ),
                        ev.summary.clone(),
                    )
                }
            };
            d.alert = Some(AlertDraft {
                dedupe_key: sha256_hex(&[&w.uuid, &seq.to_string(), &ev.state_hash]),
                kind: "watch_alert",
                title,
                body,
            });
            d.alert_seq = seq;
            d.last_alert_hash = Some(ev.state_hash.clone());
            d
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Stockage : bail, fin fencée, alertes
// ---------------------------------------------------------------------------------------------

/// Jeton de bail : instance + aléa, pour qu'une vérification d'avant une pause/reprise
/// ne puisse jamais écrire par-dessus celle d'après (même instance).
fn lease_token(owner: &str) -> String {
    format!("{owner}#{}", &new_uuid()[..8])
}

/// Prend le bail des surveillances dues (une seule instance gagne chacune).
pub async fn claim_due(
    pool: &PgPool,
    owner: &str,
    limit: i64,
) -> Result<Vec<PageWatch>, sqlx::Error> {
    sqlx::query_as::<_, PageWatch>(
        r#"UPDATE page_watches SET lease_owner = $1,
               lease_until = now() + make_interval(secs => $3), updated_at = now()
           WHERE uuid IN (
               SELECT uuid FROM page_watches
               WHERE status = 'active' AND next_check_at <= now()
                 AND (lease_until IS NULL OR lease_until < now())
               ORDER BY next_check_at
               LIMIT $2
               FOR UPDATE SKIP LOCKED)
           RETURNING *"#,
    )
    .bind(lease_token(owner))
    .bind(limit)
    .bind(LEASE_SECS as f64)
    .fetch_all(pool)
    .await
}

/// Bail d'une surveillance précise (« vérifier maintenant ») : refusé si une vérif tourne
/// déjà ou si elle est en pause.
pub async fn claim_one(
    pool: &PgPool,
    uuid: &str,
    owner: &str,
) -> Result<Option<PageWatch>, sqlx::Error> {
    sqlx::query_as::<_, PageWatch>(
        r#"UPDATE page_watches SET lease_owner = $2,
               lease_until = now() + make_interval(secs => $3), updated_at = now()
           WHERE uuid = $1 AND status = 'active'
             AND (lease_until IS NULL OR lease_until < now())
           RETURNING *"#,
    )
    .bind(uuid)
    .bind(lease_token(owner))
    .bind(LEASE_SECS as f64)
    .fetch_optional(pool)
    .await
}

pub struct CheckInput {
    pub result: Result<Evaluation, String>,
    pub http_status: Option<i32>,
    pub duration_ms: i32,
}

/// Enregistre une vérification. Fencée : n'écrit rien si le bail a été perdu entre-temps
/// (pause, suppression, reprise par une autre instance). L'alerte n'est insérée qu'avec
/// l'état de la surveillance, dans la même transaction, et une seule fois par clé.
pub async fn apply_check(
    pool: &PgPool,
    w: &PageWatch,
    owner: &str,
    input: CheckInput,
) -> Result<Option<WatchCheck>, sqlx::Error> {
    let token = w.lease_owner.as_deref().unwrap_or(owner);
    let d = decide(w, &input.result);
    let (snapshot, page_hash, value, summary, error, state_hash) = match &input.result {
        Ok(ev) => (
            Some(ev.snapshot.clone()),
            Some(ev.page_hash.clone()),
            ev.value.clone(),
            Some(ev.summary.clone()),
            None,
            Some(ev.state_hash.clone()),
        ),
        Err(e) => (None, None, None, None, Some(e.clone()), None),
    };
    let ok = input.result.is_ok();
    let mut tx = pool.begin().await?;
    let updated = sqlx::query(
        r#"UPDATE page_watches SET
               lease_owner = NULL, lease_until = NULL,
               last_check_at = now(),
               next_check_at = now() + make_interval(mins => $3),
               failure_streak = $4,
               status = CASE WHEN $5 THEN 'paused' ELSE status END,
               paused_reason = CASE WHEN $5 THEN 'failures' ELSE paused_reason END,
               last_success_at = CASE WHEN $6 THEN now() ELSE last_success_at END,
               last_error = $7,
               last_http_status = COALESCE($8, last_http_status),
               last_value = CASE WHEN $6 THEN $9 ELSE last_value END,
               last_summary = CASE WHEN $6 THEN $10 ELSE last_summary END,
               last_hash = CASE WHEN $6 THEN $11 ELSE last_hash END,
               last_snapshot = CASE WHEN $6 THEN $12 ELSE last_snapshot END,
               condition_met = $13,
               last_alert_hash = $14,
               alert_seq = $15,
               last_alert_at = CASE WHEN $16 THEN now() ELSE last_alert_at END,
               updated_at = now()
           WHERE uuid = $1 AND lease_owner = $2 AND status = 'active'"#,
    )
    .bind(&w.uuid)
    .bind(token)
    .bind(d.next_in_minutes as i32)
    .bind(d.failure_streak)
    .bind(d.auto_pause)
    .bind(ok)
    .bind(error.as_deref())
    .bind(input.http_status)
    .bind(value.as_deref())
    .bind(summary.as_deref())
    .bind(page_hash.as_deref())
    .bind(snapshot.as_deref())
    .bind(d.condition_met)
    .bind(d.last_alert_hash.as_deref())
    .bind(d.alert_seq)
    .bind(d.alert.is_some())
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() == 0 {
        tx.rollback().await?;
        return Ok(None);
    }
    let mut alerted = false;
    if let Some(a) = &d.alert {
        let r = sqlx::query(
            r#"INSERT INTO page_watch_alerts (uuid, dedupe_key, watch_uuid, workspace_uuid, kind, title, body)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               ON CONFLICT (dedupe_key) DO NOTHING"#,
        )
        .bind(new_uuid())
        .bind(&a.dedupe_key)
        .bind(&w.uuid)
        .bind(&w.workspace_uuid)
        .bind(a.kind)
        .bind(&a.title)
        .bind(&a.body)
        .execute(&mut *tx)
        .await?;
        alerted = r.rows_affected() == 1;
    }
    let check = sqlx::query_as::<_, WatchCheck>(
        r#"INSERT INTO page_watch_checks
               (uuid, watch_uuid, outcome, http_status, duration_ms, value, summary, error, state_hash, alerted)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING *"#,
    )
    .bind(new_uuid())
    .bind(&w.uuid)
    .bind(d.outcome)
    .bind(input.http_status)
    .bind(input.duration_ms)
    .bind(value.as_deref())
    .bind(summary.as_deref())
    .bind(error.as_deref())
    .bind(state_hash.as_deref())
    .bind(alerted)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query(
        r#"DELETE FROM page_watch_checks WHERE watch_uuid = $1 AND uuid NOT IN (
               SELECT uuid FROM page_watch_checks WHERE watch_uuid = $1
               ORDER BY checked_at DESC LIMIT $2)"#,
    )
    .bind(&w.uuid)
    .bind(KEEP_CHECKS)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Some(check))
}

/// Lit la page et évalue (sans rien écrire).
pub async fn observe(w: &PageWatch, policy: &FetchPolicy) -> CheckInput {
    let started = Instant::now();
    let fetched = fetch(&w.url, policy).await;
    let duration_ms = started.elapsed().as_millis().min(i32::MAX as u128) as i32;
    match fetched {
        Ok(f) => CheckInput {
            result: evaluate(
                &w.spec(),
                &f.body,
                w.last_hash.as_deref(),
                w.last_snapshot.as_deref(),
            ),
            http_status: Some(i32::from(f.status)),
            duration_ms,
        },
        Err(e) => CheckInput {
            result: Err(e.message),
            http_status: e.http_status.map(i32::from),
            duration_ms,
        },
    }
}

/// Vérification complète d'une surveillance dont on détient le bail.
pub async fn run_claimed(
    pool: &PgPool,
    w: &PageWatch,
    owner: &str,
    policy: &FetchPolicy,
) -> Result<Option<WatchCheck>, sqlx::Error> {
    let input = observe(w, policy).await;
    apply_check(pool, w, owner, input).await
}

/// Un tic : prend les surveillances dues et les vérifie (4 en parallèle au plus).
pub async fn tick(pool: &PgPool, owner: &str, policy: &FetchPolicy) -> usize {
    let due = match claim_due(pool, owner, 8).await {
        Ok(d) => d,
        Err(e) => {
            tracing::warn!(error = %e, "surveillance : lecture des pages dues");
            return 0;
        }
    };
    let n = due.len();
    use futures_util::StreamExt;
    futures_util::stream::iter(due)
        .for_each_concurrent(4, |w| async move {
            if let Err(e) = run_claimed(pool, &w, owner, policy).await {
                tracing::warn!(watch = %w.uuid, error = %e, "surveillance : enregistrement");
            }
        })
        .await;
    n
}

pub async fn get(
    pool: &PgPool,
    workspace: &str,
    uuid: &str,
) -> Result<Option<PageWatch>, sqlx::Error> {
    sqlx::query_as::<_, PageWatch>(
        "SELECT * FROM page_watches WHERE uuid = $1 AND workspace_uuid = $2",
    )
    .bind(uuid)
    .bind(workspace)
    .fetch_optional(pool)
    .await
}

pub async fn list(pool: &PgPool, workspace: &str) -> Result<Vec<PageWatch>, sqlx::Error> {
    sqlx::query_as::<_, PageWatch>(
        "SELECT * FROM page_watches WHERE workspace_uuid = $1 ORDER BY created_at DESC LIMIT 200",
    )
    .bind(workspace)
    .fetch_all(pool)
    .await
}

pub async fn checks(
    pool: &PgPool,
    watch: &str,
    limit: i64,
) -> Result<Vec<WatchCheck>, sqlx::Error> {
    sqlx::query_as::<_, WatchCheck>(
        "SELECT * FROM page_watch_checks WHERE watch_uuid = $1 ORDER BY checked_at DESC LIMIT $2",
    )
    .bind(watch)
    .bind(limit.clamp(1, KEEP_CHECKS))
    .fetch_all(pool)
    .await
}

/// Pause manuelle : le bail est effacé, une vérification en cours ne pourra plus écrire.
pub async fn pause(pool: &PgPool, workspace: &str, uuid: &str) -> Result<bool, sqlx::Error> {
    let r = sqlx::query(
        r#"UPDATE page_watches SET status = 'paused', paused_reason = 'user',
               lease_owner = NULL, lease_until = NULL, updated_at = now()
           WHERE uuid = $1 AND workspace_uuid = $2 AND status = 'active'"#,
    )
    .bind(uuid)
    .bind(workspace)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() == 1)
}

/// Reprise : compteur d'échecs remis à zéro, vérification tout de suite.
pub async fn resume(pool: &PgPool, workspace: &str, uuid: &str) -> Result<bool, sqlx::Error> {
    let r = sqlx::query(
        r#"UPDATE page_watches SET status = 'active', paused_reason = NULL, failure_streak = 0,
               last_error = NULL, next_check_at = now(), lease_owner = NULL, lease_until = NULL,
               updated_at = now()
           WHERE uuid = $1 AND workspace_uuid = $2 AND status = 'paused'"#,
    )
    .bind(uuid)
    .bind(workspace)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() == 1)
}

pub async fn delete(pool: &PgPool, workspace: &str, uuid: &str) -> Result<bool, sqlx::Error> {
    let r = sqlx::query("DELETE FROM page_watches WHERE uuid = $1 AND workspace_uuid = $2")
        .bind(uuid)
        .bind(workspace)
        .execute(pool)
        .await?;
    Ok(r.rows_affected() == 1)
}

pub async fn alerts(
    pool: &PgPool,
    workspace: &str,
    unread_only: bool,
    limit: i64,
) -> Result<Vec<WatchAlert>, sqlx::Error> {
    sqlx::query_as::<_, WatchAlert>(
        r#"SELECT uuid, watch_uuid, workspace_uuid, kind, title, body, created_at, read_at
           FROM page_watch_alerts
           WHERE workspace_uuid = $1 AND ($2 = FALSE OR read_at IS NULL)
           ORDER BY created_at DESC LIMIT $3"#,
    )
    .bind(workspace)
    .bind(unread_only)
    .bind(limit.clamp(1, 100))
    .fetch_all(pool)
    .await
}

pub async fn unread_count(pool: &PgPool, workspace: &str) -> Result<i64, sqlx::Error> {
    let (n,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM page_watch_alerts WHERE workspace_uuid = $1 AND read_at IS NULL",
    )
    .bind(workspace)
    .fetch_one(pool)
    .await?;
    Ok(n)
}

/// Marque lues (toutes, ou la liste donnée).
pub async fn mark_read(
    pool: &PgPool,
    workspace: &str,
    uuids: Option<&[String]>,
) -> Result<u64, sqlx::Error> {
    let r = match uuids {
        Some(ids) => {
            sqlx::query(
                "UPDATE page_watch_alerts SET read_at = now() WHERE workspace_uuid = $1 AND read_at IS NULL AND uuid = ANY($2)",
            )
            .bind(workspace)
            .bind(ids)
            .execute(pool)
            .await?
        }
        None => {
            sqlx::query(
                "UPDATE page_watch_alerts SET read_at = now() WHERE workspace_uuid = $1 AND read_at IS NULL",
            )
            .bind(workspace)
            .execute(pool)
            .await?
        }
    };
    Ok(r.rows_affected())
}

/// Alertes récentes pour la boîte de réception Android (`since` RFC 3339).
pub async fn alerts_since(
    pool: &PgPool,
    workspace: &str,
    since: &str,
) -> Vec<(WatchAlert, String)> {
    let since = DateTime::parse_from_rfc3339(since)
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now() - chrono::Duration::hours(24));
    sqlx::query_as::<_, (String, String, String, String, String, String, DateTime<Utc>, Option<DateTime<Utc>>, String)>(
        r#"SELECT a.uuid, a.watch_uuid, a.workspace_uuid, a.kind, a.title, a.body, a.created_at, a.read_at, w.name
           FROM page_watch_alerts a JOIN page_watches w ON w.uuid = a.watch_uuid
           WHERE a.workspace_uuid = $1 AND a.created_at > $2
           ORDER BY a.created_at DESC LIMIT 20"#,
    )
    .bind(workspace)
    .bind(since)
    .fetch_all(pool)
    .await
    .unwrap_or_default()
    .into_iter()
    .map(|(uuid, watch_uuid, workspace_uuid, kind, title, body, created_at, read_at, name)| {
        (
            WatchAlert {
                uuid,
                watch_uuid,
                workspace_uuid,
                kind,
                title,
                body,
                created_at,
                read_at,
            },
            name,
        )
    })
    .collect()
}

// ---------------------------------------------------------------------------------------------
// Branchement sur le tic du planificateur
// ---------------------------------------------------------------------------------------------

struct WatchTick {
    pool: PgPool,
    running: std::sync::atomic::AtomicBool,
}

impl devforge_cron::TickHook for WatchTick {
    fn tick(&self) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + '_>> {
        Box::pin(async move {
            use std::sync::atomic::Ordering;
            // Un tic à la fois par instance ; entre instances, ce sont les baux qui arbitrent.
            if self.running.swap(true, Ordering::SeqCst) {
                return;
            }
            let n = tick(
                &self.pool,
                crate::agent_runs::instance_id(),
                &FetchPolicy::default(),
            )
            .await;
            if n > 0 {
                tracing::debug!(count = n, "surveillance : pages vérifiées");
            }
            self.running.store(false, Ordering::SeqCst);
        })
    }
}

pub fn install(pool: PgPool) {
    devforge_cron::add_tick_hook(Arc::new(WatchTick {
        pool,
        running: std::sync::atomic::AtomicBool::new(false),
    }));
}
