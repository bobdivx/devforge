//! Client REST minimal de l'API Kubernetes (server-side apply, get, patch, delete, logs).
//!
//! Volontairement léger (reqwest + JSON) plutôt qu'un client complet : la phase 1 n'utilise
//! qu'une dizaine d'appels sur 5 types de ressources.

use std::time::Duration;

use reqwest::{Method, StatusCode};
use serde_json::Value;

use crate::config::KubeConfig;
use crate::FIELD_MANAGER;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KubeError {
    /// Configuration absente / invalide (hors cluster, CA illisible…).
    Config(String),
    /// Réseau / TLS.
    Transport(String),
    /// Réponse HTTP non 2xx de l'API (message `Status` de Kubernetes).
    Api { status: u16, message: String },
    /// Spec refusée avant tout appel.
    Invalid(String),
}

impl std::fmt::Display for KubeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Config(m) => write!(f, "configuration Kubernetes : {m}"),
            Self::Transport(m) => write!(f, "API Kubernetes injoignable : {m}"),
            Self::Api { status, message } => {
                let hint = match status {
                    401 => " (jeton du compte de service refusé)",
                    403 => " (droits RBAC insuffisants — voir Role du chart Helm)",
                    _ => "",
                };
                write!(f, "API Kubernetes HTTP {status} : {message}{hint}")
            }
            Self::Invalid(m) => write!(f, "{m}"),
        }
    }
}

impl std::error::Error for KubeError {}

impl KubeError {
    pub fn is_not_found(&self) -> bool {
        matches!(self, Self::Api { status: 404, .. })
    }

    /// Code HTTP à renvoyer par l'API DevForge.
    pub fn http_status(&self) -> u16 {
        match self {
            Self::Invalid(_) => 400,
            Self::Api { status: 404, .. } => 404,
            Self::Api { status: 409, .. } | Self::Api { status: 422, .. } => 422,
            Self::Config(_) => 503,
            _ => 502,
        }
    }
}

#[derive(Clone)]
pub struct KubeClient {
    cfg: KubeConfig,
    http: reqwest::Client,
}

impl std::fmt::Debug for KubeClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("KubeClient")
            .field("api_url", &self.cfg.api_url)
            .finish()
    }
}

impl KubeClient {
    pub fn new(cfg: KubeConfig) -> Result<Self, KubeError> {
        let mut b = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10));
        if let Some(pem) = &cfg.ca_pem {
            let certs = reqwest::Certificate::from_pem_bundle(pem)
                .map_err(|e| KubeError::Config(format!("CA invalide : {e}")))?;
            for c in certs {
                b = b.add_root_certificate(c);
            }
        }
        if cfg.insecure_skip_tls_verify {
            tracing::warn!("DEVFORGE_KUBE_INSECURE_SKIP_TLS_VERIFY actif — dev uniquement");
            b = b.danger_accept_invalid_certs(true);
        }
        let http = b
            .build()
            .map_err(|e| KubeError::Config(format!("client HTTP : {e}")))?;
        Ok(Self { cfg, http })
    }

    pub fn from_env() -> Result<Self, KubeError> {
        Self::new(KubeConfig::from_env().map_err(KubeError::Config)?)
    }

    pub fn api_url(&self) -> &str {
        &self.cfg.api_url
    }

    async fn send(
        &self,
        method: Method,
        path: &str,
        content_type: Option<&str>,
        body: Option<&Value>,
    ) -> Result<reqwest::Response, KubeError> {
        let url = format!("{}{}", self.cfg.api_url, path);
        let mut req = self
            .http
            .request(method, &url)
            .header("Accept", "application/json");
        if let Some(tok) = self.cfg.bearer_token().map_err(KubeError::Config)? {
            req = req.bearer_auth(tok);
        }
        if let Some(body) = body {
            req = req
                .header("Content-Type", content_type.unwrap_or("application/json"))
                .body(body.to_string());
        }
        let resp = req
            .send()
            .await
            .map_err(|e| KubeError::Transport(e.without_url().to_string()))?;
        if resp.status().is_success() {
            return Ok(resp);
        }
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        Err(api_error(status, &text))
    }

    async fn json(
        &self,
        method: Method,
        path: &str,
        content_type: Option<&str>,
        body: Option<&Value>,
    ) -> Result<Value, KubeError> {
        let resp = self.send(method, path, content_type, body).await?;
        let text = resp
            .text()
            .await
            .map_err(|e| KubeError::Transport(e.to_string()))?;
        if text.trim().is_empty() {
            return Ok(Value::Null);
        }
        serde_json::from_str(&text).map_err(|e| KubeError::Transport(format!("JSON : {e}")))
    }

    /// `GET`, `None` si 404.
    pub async fn get(&self, path: &str) -> Result<Option<Value>, KubeError> {
        match self.json(Method::GET, path, None, None).await {
            Ok(v) => Ok(Some(v)),
            Err(e) if e.is_not_found() => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub async fn get_text(&self, path: &str) -> Result<String, KubeError> {
        self.send(Method::GET, path, None, None)
            .await?
            .text()
            .await
            .map_err(|e| KubeError::Transport(e.to_string()))
    }

    /// Server-side apply (`fieldManager=devforge`, `force=true`). Le JSON est un YAML valide.
    pub async fn apply(&self, path: &str, manifest: &Value) -> Result<Value, KubeError> {
        let sep = if path.contains('?') { '&' } else { '?' };
        let p = format!("{path}{sep}fieldManager={FIELD_MANAGER}&force=true");
        self.json(
            Method::PATCH,
            &p,
            Some("application/apply-patch+yaml"),
            Some(manifest),
        )
        .await
    }

    /// JSON merge patch (stop / start / restart).
    pub async fn merge_patch(&self, path: &str, patch: &Value) -> Result<Value, KubeError> {
        let sep = if path.contains('?') { '&' } else { '?' };
        let p = format!("{path}{sep}fieldManager={FIELD_MANAGER}");
        self.json(
            Method::PATCH,
            &p,
            Some("application/merge-patch+json"),
            Some(patch),
        )
        .await
    }

    /// `DELETE` (propagation en arrière-plan). `false` si déjà absent.
    pub async fn delete(&self, path: &str) -> Result<bool, KubeError> {
        let sep = if path.contains('?') { '&' } else { '?' };
        let p = format!("{path}{sep}propagationPolicy=Background");
        match self.json(Method::DELETE, &p, None, None).await {
            Ok(_) => Ok(true),
            Err(e) if e.is_not_found() => Ok(false),
            Err(e) => Err(e),
        }
    }

    /// Version du serveur (test de connectivité).
    pub async fn version(&self) -> Result<String, KubeError> {
        let v = self.json(Method::GET, "/version", None, None).await?;
        Ok(v.get("gitVersion")
            .and_then(Value::as_str)
            .unwrap_or("inconnue")
            .to_string())
    }
}

fn api_error(status: StatusCode, body: &str) -> KubeError {
    let message = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v.get("message").and_then(Value::as_str).map(str::to_string))
        .unwrap_or_else(|| body.chars().take(300).collect());
    KubeError::Api {
        status: status.as_u16(),
        message: devforge_shared::log_redact::redact_log_text(&message),
    }
}

/// Chemins REST des ressources gérées.
pub mod paths {
    pub fn deployments(ns: &str) -> String {
        format!("/apis/apps/v1/namespaces/{ns}/deployments")
    }
    pub fn deployment(ns: &str, name: &str) -> String {
        format!("{}/{name}", deployments(ns))
    }
    pub fn service(ns: &str, name: &str) -> String {
        format!("/api/v1/namespaces/{ns}/services/{name}")
    }
    pub fn secret(ns: &str, name: &str) -> String {
        format!("/api/v1/namespaces/{ns}/secrets/{name}")
    }
    pub fn ingress(ns: &str, name: &str) -> String {
        format!("/apis/networking.k8s.io/v1/namespaces/{ns}/ingresses/{name}")
    }
    pub fn pods(ns: &str) -> String {
        format!("/api/v1/namespaces/{ns}/pods")
    }
    /// Sélecteur `clé=valeur` encodé pour une query string.
    pub fn label_selector(key: &str, value: &str) -> String {
        let raw = format!("{key}={value}");
        let mut out = String::new();
        for b in raw.bytes() {
            match b {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' => out.push(b as char),
                _ => out.push_str(&format!("%{b:02X}")),
            }
        }
        format!("labelSelector={out}")
    }
    pub fn pod_log(ns: &str, pod: &str, container: &str, tail: u32) -> String {
        format!(
            "/api/v1/namespaces/{ns}/pods/{pod}/log?container={container}&tailLines={tail}&timestamps=true"
        )
    }

    /// Chemin d'un manifest (`kind` + `metadata.name`).
    pub fn for_manifest(ns: &str, m: &serde_json::Value) -> Option<String> {
        let name = m.pointer("/metadata/name")?.as_str()?;
        match m.get("kind")?.as_str()? {
            "Deployment" => Some(deployment(ns, name)),
            "Service" => Some(service(ns, name)),
            "Secret" => Some(secret(ns, name)),
            "Ingress" => Some(ingress(ns, name)),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn api_error_uses_status_message() {
        let e = api_error(
            StatusCode::FORBIDDEN,
            r#"{"kind":"Status","message":"deployments.apps is forbidden"}"#,
        );
        assert_eq!(
            e,
            KubeError::Api {
                status: 403,
                message: "deployments.apps is forbidden".into()
            }
        );
        assert!(e.to_string().contains("RBAC"));
        assert_eq!(e.http_status(), 502);
        assert!(api_error(StatusCode::NOT_FOUND, "nope").is_not_found());
    }

    #[test]
    fn paths_and_selectors() {
        assert_eq!(
            paths::label_selector("devforge.io/app", "web"),
            "labelSelector=devforge.io%2Fapp%3Dweb"
        );
        let m = json!({"kind":"Ingress","metadata":{"name":"web"}});
        assert_eq!(
            paths::for_manifest("ns", &m).unwrap(),
            "/apis/networking.k8s.io/v1/namespaces/ns/ingresses/web"
        );
        assert!(
            paths::for_manifest("ns", &json!({"kind":"Pod","metadata":{"name":"x"}})).is_none()
        );
    }
}
