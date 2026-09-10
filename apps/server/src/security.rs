//! CORS + static web assets for production hardening.

use axum::http::{HeaderValue, Method};
use tower_http::cors::{AllowOrigin, CorsLayer};

/// Origins autorisées :
/// - `DEVFORGE_CORS_ORIGINS` = liste CSV (prod)
/// - sinon localhost de dev uniquement (plus de `Any`)
pub fn cors_layer() -> CorsLayer {
    let raw = std::env::var("DEVFORGE_CORS_ORIGINS").unwrap_or_default();
    let origins: Vec<HeaderValue> = raw
        .split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .filter_map(|s| s.parse().ok())
        .collect();

    let allow = if origins.is_empty() {
        AllowOrigin::list([
            "http://localhost:8080".parse().unwrap(),
            "http://127.0.0.1:8080".parse().unwrap(),
            "http://localhost:4321".parse().unwrap(),
            "http://127.0.0.1:4321".parse().unwrap(),
            "http://localhost:3000".parse().unwrap(),
            "http://127.0.0.1:3000".parse().unwrap(),
        ])
    } else {
        AllowOrigin::list(origins)
    };

    CorsLayer::new()
        .allow_origin(allow)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            axum::http::header::AUTHORIZATION,
            axum::http::header::CONTENT_TYPE,
            axum::http::header::ACCEPT,
        ])
}
