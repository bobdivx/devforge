//! Front Astro statique (`web/`) : fichiers, repli SPA et wiki public.
//!
//! Le wiki est figé au build du front (`web/wiki/<Slug>/index.html`, lu depuis
//! `wiki/*.md`) : servi comme n'importe quel fichier statique, sans session ni
//! base. `ServeDir` refuse `..` et les chemins hors racine. Une page de wiki
//! inconnue renvoie l'accueil du wiki (qui l'annonce) plutôt que la vitrine.

use std::path::{Path, PathBuf};

use axum::{
    body::Body,
    http::{header, HeaderValue, Request, StatusCode},
    response::{IntoResponse, Response},
    routing::any,
    Router,
};
use tower_http::services::ServeDir;

/// Chemin sous `/wiki` ? (`/wiki`, `/wiki/`, `/wiki/x/…`)
pub fn is_wiki_path(path: &str) -> bool {
    path == "/wiki" || path.starts_with("/wiki/")
}

/// Fichier HTML servi quand aucun fichier ne correspond à `path`.
pub fn not_found_page(root: &Path, path: &str) -> Option<PathBuf> {
    if is_wiki_path(path) {
        let wiki = root.join("wiki").join("index.html");
        if wiki.is_file() {
            return Some(wiki);
        }
    }
    let index = root.join("index.html");
    index.is_file().then_some(index)
}

async fn serve_not_found(root: PathBuf, path: String) -> Response {
    let Some(file) = not_found_page(&root, &path) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    match tokio::fs::read(&file).await {
        Ok(bytes) => {
            let mut res = (StatusCode::NOT_FOUND, Body::from(bytes)).into_response();
            res.headers_mut().insert(
                header::CONTENT_TYPE,
                HeaderValue::from_static("text/html; charset=utf-8"),
            );
            res
        }
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

/// Ajoute le service statique en repli du routeur (API d'abord, puis fichiers).
pub fn with_static_dir<S>(app: Router<S>, root: &Path) -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    let base = root.to_path_buf();
    let fallback = any(move |req: Request<Body>| {
        let base = base.clone();
        let path = req.uri().path().to_string();
        async move { serve_not_found(base, path).await }
    });
    app.fallback_service(ServeDir::new(root).fallback(fallback))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::routing::get;
    use tower::ServiceExt;

    fn site() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "df-static-web-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(dir.join("wiki/Kubernetes")).unwrap();
        std::fs::write(dir.join("index.html"), "VITRINE").unwrap();
        std::fs::write(dir.join("wiki/index.html"), "WIKI-HOME").unwrap();
        std::fs::write(dir.join("wiki/Kubernetes/index.html"), "WIKI-K8S").unwrap();
        std::fs::write(dir.join("wiki/search-index.json"), "[]").unwrap();
        // Hors racine : ne doit jamais être servi.
        std::fs::write(dir.with_extension("secret"), "SECRET").unwrap();
        dir
    }

    async fn get_body(app: Router, uri: &str) -> (StatusCode, String) {
        let res = app
            .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = res.status();
        let bytes = axum::body::to_bytes(res.into_body(), 1 << 20)
            .await
            .unwrap();
        (status, String::from_utf8_lossy(&bytes).into_owned())
    }

    fn app(root: &Path) -> Router {
        with_static_dir(
            Router::new().route("/api/v1/health", get(|| async { "ok" })),
            root,
        )
    }

    #[tokio::test]
    async fn wiki_pages_are_public_static_files() {
        let root = site();
        let (s, b) = get_body(app(&root), "/wiki/Kubernetes/").await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(b, "WIKI-K8S");
        let (s, b) = get_body(app(&root), "/wiki/").await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(b, "WIKI-HOME");
        let (s, _) = get_body(app(&root), "/wiki/search-index.json").await;
        assert_eq!(s, StatusCode::OK);
        let (_, b) = get_body(app(&root), "/api/v1/health").await;
        assert_eq!(b, "ok");
    }

    #[tokio::test]
    async fn unknown_wiki_page_falls_back_to_wiki_home() {
        let root = site();
        let (s, b) = get_body(app(&root), "/wiki/Nope/").await;
        assert_eq!(s, StatusCode::NOT_FOUND);
        assert_eq!(b, "WIKI-HOME");
        let (_, b) = get_body(app(&root), "/app/inconnu").await;
        assert_eq!(b, "VITRINE");
    }

    #[tokio::test]
    async fn traversal_never_leaves_web_root() {
        let root = site();
        let name = root.with_extension("secret");
        let name = name.file_name().unwrap().to_string_lossy();
        for uri in [
            format!("/wiki/../../{name}"),
            format!("/wiki/%2e%2e/%2e%2e/{name}"),
            format!("/wiki/..%2f..%2f{name}"),
            format!("/..%5c{name}"),
        ] {
            let (_, b) = get_body(app(&root), &uri).await;
            assert!(
                !b.contains("SECRET"),
                "{uri} a servi un fichier hors racine"
            );
        }
    }

    #[test]
    fn wiki_path_detection() {
        assert!(is_wiki_path("/wiki"));
        assert!(is_wiki_path("/wiki/Kubernetes/"));
        assert!(!is_wiki_path("/wikipedia"));
        assert!(!is_wiki_path("/app/wiki"));
    }

    #[test]
    fn missing_wiki_build_falls_back_to_site_index() {
        let root = site();
        std::fs::remove_file(root.join("wiki/index.html")).unwrap();
        assert_eq!(
            not_found_page(&root, "/wiki/x"),
            Some(root.join("index.html"))
        );
    }
}
