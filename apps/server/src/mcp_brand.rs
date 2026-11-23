//! Logo public du connecteur MCP DevForge.
//!
//! Grok (Bot et application) et les clients MCP 2025-06-18 lisent l’icône :
//! - avant la session, dans `logo_uri` des métadonnées OAuth (serveur d’autorisation
//!   et ressource protégée) ;
//! - après `initialize`, dans `serverInfo.icons` (URLs absolues).
//!
//! Le `logo_uri` d’une réponse DCR (RFC 7591) est le logo du *client* qui s’enregistre.
//! Il est renvoyé tel quel s’il a été fourni : ce n’est pas le logo DevForge.
//!
//! Les PNG viennent de `brand/` (même fichier que `apps/web/public/brand/icon-512.png`).
//! Le SVG est le logo vectoriel déjà référencé par les plugins
//! (`cursor-plugin/*/assets/logo.svg`). `brand/icon.svg` est un PNG encapsulé, trop
//! lourd pour une carte de connecteur.

use axum::body::Body;
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::Response;
use axum::routing::get;
use axum::Router;
use serde_json::{json, Value};

use crate::state::AppState;

const PNG_512: &[u8] = include_bytes!("../../../brand/icon-512.png");
const PNG_256: &[u8] = include_bytes!("../../../brand/icon-256.png");
const SVG: &[u8] = include_bytes!("../../../cursor-plugin/devforge/assets/logo.svg");

pub fn router() -> Router<AppState> {
    icon_router()
}

fn icon_router<S>() -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route("/icons/devforge-512.png", get(icon_512))
        .route("/icons/devforge-256.png", get(icon_256))
        .route("/icons/devforge.svg", get(icon_svg))
}

/// URL absolue annoncée comme `logo_uri` (PNG 512, fond opaque).
pub fn logo_uri(base: &str) -> String {
    format!(
        "{}/icons/devforge-512.png",
        base.trim().trim_end_matches('/')
    )
}

/// Icônes au format MCP (`serverInfo.icons`).
pub fn icons_json(base: &str) -> Value {
    let b = base.trim().trim_end_matches('/');
    json!([
        { "src": format!("{b}/icons/devforge-512.png"), "mimeType": "image/png", "sizes": ["512x512"] },
        { "src": format!("{b}/icons/devforge-256.png"), "mimeType": "image/png", "sizes": ["256x256"] },
        { "src": format!("{b}/icons/devforge.svg"), "mimeType": "image/svg+xml", "sizes": ["any"] }
    ])
}

pub fn server_info(base: &str) -> Value {
    let base = base.trim().trim_end_matches('/');
    let mut info = json!({
        "name": "devforge",
        "title": "DevForge",
        "version": env!("CARGO_PKG_VERSION"),
    });
    if !base.is_empty() {
        info["websiteUrl"] = json!(base);
        info["icons"] = icons_json(base);
    }
    info
}

fn icon(bytes: &'static [u8], mime: &'static str) -> Response {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, HeaderValue::from_static(mime))
        .header(
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=86400"),
        )
        .header(
            header::ACCESS_CONTROL_ALLOW_ORIGIN,
            HeaderValue::from_static("*"),
        )
        .header(
            "x-content-type-options",
            HeaderValue::from_static("nosniff"),
        )
        .body(Body::from(bytes))
        .expect("réponse icône")
}

async fn icon_512() -> Response {
    icon(PNG_512, "image/png")
}

async fn icon_256() -> Response {
    icon(PNG_256, "image/png")
}

async fn icon_svg() -> Response {
    icon(SVG, "image/svg+xml")
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use axum::http::header;
    use tower::ServiceExt;

    fn png_dims(b: &[u8]) -> (u32, u32) {
        assert!(b.len() >= 24, "PNG trop court");
        assert_eq!(&b[..8], b"\x89PNG\r\n\x1a\n");
        (
            u32::from_be_bytes(b[16..20].try_into().unwrap()),
            u32::from_be_bytes(b[20..24].try_into().unwrap()),
        )
    }

    #[test]
    fn embedded_icons_match_announced_sizes() {
        assert_eq!(png_dims(PNG_512), (512, 512));
        assert_eq!(png_dims(PNG_256), (256, 256));
        let svg = std::str::from_utf8(SVG).unwrap();
        assert!(svg.contains("<svg"));
        assert!(svg.contains("viewBox"));
    }

    #[test]
    fn icons_are_absolute_under_public_base() {
        let base = "https://web.jeser.app";
        let icons = icons_json(base);
        assert_eq!(
            icons[0]["src"],
            "https://web.jeser.app/icons/devforge-512.png"
        );
        assert_eq!(icons[0]["sizes"], json!(["512x512"]));
        assert_eq!(icons[1]["mimeType"], "image/png");
        assert_eq!(icons[2]["mimeType"], "image/svg+xml");
        assert_eq!(
            logo_uri(base),
            "https://web.jeser.app/icons/devforge-512.png"
        );
        assert_eq!(logo_uri("https://web.jeser.app/"), logo_uri(base));

        let info = server_info(base);
        assert_eq!(info["title"], "DevForge");
        assert_eq!(info["websiteUrl"], base);
        assert_eq!(info["icons"][0]["src"], logo_uri(base));
        assert!(server_info("").get("icons").is_none());
    }

    #[tokio::test]
    async fn icon_routes_are_public_png_and_svg() {
        let app = icon_router::<()>();
        for (uri, mime, png) in [
            ("/icons/devforge-512.png", "image/png", true),
            ("/icons/devforge-256.png", "image/png", true),
            ("/icons/devforge.svg", "image/svg+xml", false),
        ] {
            let res = app
                .clone()
                .oneshot(
                    axum::http::Request::builder()
                        .uri(uri)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(res.status(), StatusCode::OK, "{uri}");
            assert_eq!(res.headers()[header::CONTENT_TYPE], mime, "{uri}");
            assert!(res.headers()[header::CACHE_CONTROL]
                .to_str()
                .unwrap()
                .contains("max-age=86400"));
            assert_eq!(res.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN], "*");
            let bytes = to_bytes(res.into_body(), 1024 * 1024).await.unwrap();
            if png {
                let (w, h) = png_dims(&bytes);
                assert_eq!(w, h);
                assert!(w == 512 || w == 256, "{uri} {w}");
            } else {
                assert!(bytes.starts_with(b"<svg"));
            }
        }
    }
}
