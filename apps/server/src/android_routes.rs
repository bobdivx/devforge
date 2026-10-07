//! Téléchargement de l'app Android depuis l'instance DevForge elle-même.
//!
//! L'APK n'est pas embarqué dans l'image : au premier besoin, le serveur récupère
//! l'asset de la GitHub Release qui correspond à **sa** version
//! (`DevForge-Android-{version}.apk`), le met en cache sur disque et le sert.
//! Si cet asset n'existe pas encore (release en cours), repli sur la release la
//! plus récente qui en contient un. Routes publiques : l'APK l'est déjà sur GitHub.

use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use axum::{
    body::Body,
    extract::State,
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde_json::{json, Value};
use tokio::sync::Mutex;

use crate::state::AppState;

pub const APK_PATH: &str = "/api/v1/android/apk";
const UA: &str = "DevForge-Server";
/// Après un échec (asset absent, réseau), on ne retente pas avant ce délai.
const NEGATIVE_TTL: Duration = Duration::from_secs(300);

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/android", get(info))
        .route(APK_PATH, get(download))
        .route("/api/v1/android/qr.svg", get(qr))
}

#[derive(Clone, Debug, PartialEq)]
pub struct CachedApk {
    pub version: String,
    pub path: PathBuf,
    pub size: u64,
}

struct Cache {
    found: Option<CachedApk>,
    failed_at: Option<Instant>,
}

fn cache() -> &'static Mutex<Cache> {
    static C: OnceLock<Mutex<Cache>> = OnceLock::new();
    C.get_or_init(|| {
        Mutex::new(Cache {
            found: None,
            failed_at: None,
        })
    })
}

fn cache_dir() -> PathBuf {
    let data = std::env::var("DEVFORGE_DATA_DIR").unwrap_or_else(|_| "/data".into());
    PathBuf::from(data).join("cache").join("android")
}

pub fn file_name(version: &str) -> String {
    format!("DevForge-Android-{version}.apk")
}

pub fn asset_url(owner: &str, repo: &str, version: &str) -> String {
    format!(
        "https://github.com/{owner}/{repo}/releases/download/v{version}/{}",
        file_name(version)
    )
}

/// Version d'une release qui porte un APK signé (`DevForge-Android-X.Y.Z.apk`).
pub fn apk_version_from_asset(name: &str) -> Option<String> {
    let v = name
        .strip_prefix("DevForge-Android-")?
        .strip_suffix(".apk")?;
    let ok = !v.is_empty()
        && v.split('.').count() == 3
        && v.split('.').all(|p| p.parse::<u32>().is_ok());
    ok.then(|| v.to_string())
}

/// Un APK Android commence par l'en-tête ZIP `PK\x03\x04`.
pub fn looks_like_apk(bytes: &[u8]) -> bool {
    bytes.len() > 1024 && bytes.starts_with(b"PK\x03\x04")
}

async fn fetch(http: &reqwest::Client, url: &str) -> Option<Vec<u8>> {
    let res = http
        .get(url)
        .header(header::USER_AGENT, UA)
        .timeout(Duration::from_secs(60))
        .send()
        .await
        .ok()?;
    if !res.status().is_success() {
        return None;
    }
    let bytes = res.bytes().await.ok()?;
    looks_like_apk(&bytes).then(|| bytes.to_vec())
}

/// Release la plus récente contenant un APK signé (repli quand la version courante n'en a pas encore).
async fn latest_with_apk(
    http: &reqwest::Client,
    owner: &str,
    repo: &str,
) -> Option<(String, String)> {
    let url = format!("https://api.github.com/repos/{owner}/{repo}/releases?per_page=10");
    let res = http
        .get(url)
        .header(header::USER_AGENT, UA)
        .header(header::ACCEPT, "application/vnd.github+json")
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .ok()?;
    let list: Value = res.json().await.ok()?;
    for rel in list.as_array()? {
        if rel.get("draft").and_then(Value::as_bool) == Some(true) {
            continue;
        }
        for a in rel.get("assets")?.as_array()? {
            let name = a.get("name").and_then(Value::as_str).unwrap_or("");
            if let Some(v) = apk_version_from_asset(name) {
                let dl = a
                    .get("browser_download_url")
                    .and_then(Value::as_str)?
                    .to_string();
                return Some((v, dl));
            }
        }
    }
    None
}

fn store(version: &str, bytes: &[u8]) -> Option<CachedApk> {
    let dir = cache_dir();
    std::fs::create_dir_all(&dir).ok()?;
    let path = dir.join(file_name(version));
    let tmp = dir.join(format!(".{}.part", file_name(version)));
    std::fs::write(&tmp, bytes).ok()?;
    std::fs::rename(&tmp, &path).ok()?;
    Some(CachedApk {
        version: version.to_string(),
        path,
        size: bytes.len() as u64,
    })
}

fn on_disk(version: &str) -> Option<CachedApk> {
    let path = cache_dir().join(file_name(version));
    let size = std::fs::metadata(&path).ok()?.len();
    (size > 1024).then(|| CachedApk {
        version: version.to_string(),
        path,
        size,
    })
}

/// APK de la version courante (ou à défaut la plus récente), en cache disque.
pub async fn resolve(state: &AppState) -> Option<CachedApk> {
    let cfg = state.updater.config();
    let version = cfg.current_version.clone();
    let mut c = cache().lock().await;
    if let Some(found) = &c.found {
        if found.version == version && found.path.exists() {
            return Some(found.clone());
        }
    }
    if let Some(hit) = on_disk(&version) {
        c.found = Some(hit.clone());
        return Some(hit);
    }
    // Repli déjà en cache et pas encore l'heure de retenter la version exacte.
    if let Some(t) = c.failed_at {
        if t.elapsed() < NEGATIVE_TTL {
            return c.found.clone().filter(|f| f.path.exists());
        }
    }
    let http = reqwest::Client::new();
    if let Some(bytes) = fetch(&http, &asset_url(&cfg.repo_owner, &cfg.repo_name, &version)).await {
        if let Some(saved) = store(&version, &bytes) {
            c.found = Some(saved.clone());
            c.failed_at = None;
            return Some(saved);
        }
    }
    c.failed_at = Some(Instant::now());
    if let Some((v, url)) = latest_with_apk(&http, &cfg.repo_owner, &cfg.repo_name).await {
        if let Some(hit) = on_disk(&v) {
            c.found = Some(hit.clone());
            return Some(hit);
        }
        if let Some(bytes) = fetch(&http, &url).await {
            if let Some(saved) = store(&v, &bytes) {
                c.found = Some(saved.clone());
                return Some(saved);
            }
        }
    }
    c.found.clone().filter(|f| f.path.exists())
}

async fn info(State(state): State<AppState>) -> Json<Value> {
    let server_version = state.updater.config().current_version.clone();
    let apk = resolve(&state).await;
    Json(json!({
        "data": {
            "available": apk.is_some(),
            "version": apk.as_ref().map(|a| a.version.clone()),
            "server_version": server_version,
            "matches_server": apk.as_ref().map(|a| a.version == server_version).unwrap_or(false),
            "size_bytes": apk.as_ref().map(|a| a.size),
            "file_name": apk.as_ref().map(|a| file_name(&a.version)),
            "download_path": APK_PATH,
            "package": "app.jeser.devforge",
            "min_android": "8.0",
        }
    }))
}

async fn download(State(state): State<AppState>) -> Response {
    let Some(apk) = resolve(&state).await else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "L'app Android n'est pas encore prête pour cette version. Réessaie dans quelques minutes."})),
        )
            .into_response();
    };
    match tokio::fs::read(&apk.path).await {
        Ok(bytes) => (
            [
                (
                    header::CONTENT_TYPE,
                    "application/vnd.android.package-archive".to_string(),
                ),
                (
                    header::CONTENT_DISPOSITION,
                    format!("attachment; filename=\"{}\"", file_name(&apk.version)),
                ),
                (header::CACHE_CONTROL, "public, max-age=300".to_string()),
            ],
            Body::from(bytes),
        )
            .into_response(),
        Err(_) => (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "APK introuvable"})),
        )
            .into_response(),
    }
}

pub fn qr_svg(url: &str) -> Option<String> {
    let code =
        qrcode::QrCode::with_error_correction_level(url.as_bytes(), qrcode::EcLevel::M).ok()?;
    Some(
        code.render::<qrcode::render::svg::Color>()
            .min_dimensions(220, 220)
            .quiet_zone(true)
            .dark_color(qrcode::render::svg::Color("#09090b"))
            .light_color(qrcode::render::svg::Color("#ffffff"))
            .build(),
    )
}

/// QR du lien de téléchargement (affiché sur ordinateur, à scanner avec le téléphone).
async fn qr(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let base = match crate::mcp_oauth::public_base(&state, &headers).await {
        Ok(b) => b,
        Err(r) => return r,
    };
    match qr_svg(&format!("{base}{APK_PATH}")) {
        Some(svg) => (
            [
                (header::CONTENT_TYPE, "image/svg+xml"),
                (header::CACHE_CONTROL, "public, max-age=3600"),
            ],
            svg,
        )
            .into_response(),
        None => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asset_names_and_urls() {
        assert_eq!(file_name("2.0.193"), "DevForge-Android-2.0.193.apk");
        assert_eq!(
            asset_url("bobdivx", "devforge", "2.0.193"),
            "https://github.com/bobdivx/devforge/releases/download/v2.0.193/DevForge-Android-2.0.193.apk"
        );
        assert_eq!(
            apk_version_from_asset("DevForge-Android-2.0.193.apk").as_deref(),
            Some("2.0.193")
        );
        assert_eq!(apk_version_from_asset("DevForge-Android.apk"), None);
        assert_eq!(
            apk_version_from_asset("DevForge-Android-2.0.193-debug-signed.apk"),
            None
        );
        assert_eq!(apk_version_from_asset("autre.apk"), None);
    }

    #[test]
    fn apk_magic() {
        let mut ok = b"PK\x03\x04".to_vec();
        ok.resize(4096, 0);
        assert!(looks_like_apk(&ok));
        assert!(!looks_like_apk(b"<html>Not Found</html>"));
        assert!(!looks_like_apk(b"PK\x03\x04"));
    }

    #[test]
    fn qr_is_svg() {
        let svg = qr_svg("https://web.jeser.app/api/v1/android/apk").unwrap();
        assert!(svg.contains("<svg"));
        assert!(svg.contains("#09090b"));
    }
}
