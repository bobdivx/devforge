//! Configuration de connexion à l'API Kubernetes et valeurs par défaut de rendu.
//!
//! Dans le cluster (cas nominal, chart Helm) : compte de service monté dans
//! `/var/run/secrets/kubernetes.io/serviceaccount/` + `KUBERNETES_SERVICE_HOST/PORT`.
//!
//! Variables (toutes optionnelles) :
//! - `DEVFORGE_KUBE_NAMESPACE_MODE` : `per-project` (défaut : un namespace `<préfixe><projet>`
//!   par projet, créé à la demande) ou `single` (toutes les apps dans `DEVFORGE_KUBE_NAMESPACE`)
//! - `DEVFORGE_KUBE_NAMESPACE_PREFIX` : préfixe des namespaces de projet (défaut `devforge-`)
//! - `DEVFORGE_KUBE_POD_SECURITY` : niveau PodSecurity posé sur les namespaces créés
//!   (`restricted` par défaut, `baseline`, `privileged`)
//! - `DEVFORGE_KUBE_NAMESPACE` : namespace des apps sans projet / mode `single`
//!   (défaut : namespace du pod, sinon `devforge-apps`)
//! - `DEVFORGE_KUBE_API_URL`, `DEVFORGE_KUBE_TOKEN_FILE`, `DEVFORGE_KUBE_CA_FILE` : hors cluster
//! - `DEVFORGE_KUBE_INSECURE_SKIP_TLS_VERIFY=1` : dev uniquement
//! - `DEVFORGE_KUBE_INGRESS_CLASS` (défaut `traefik`, `none` → classe par défaut du cluster),
//!   `DEVFORGE_KUBE_IMAGE_PULL_SECRET`, `DEVFORGE_KUBE_CLUSTER_ISSUER` : valeurs par défaut des apps

use std::path::PathBuf;

const SA_DIR: &str = "/var/run/secrets/kubernetes.io/serviceaccount";
pub const DEFAULT_NAMESPACE: &str = "devforge-apps";
pub const DEFAULT_NAMESPACE_PREFIX: &str = "devforge-";
pub const DEFAULT_INGRESS_CLASS: &str = "traefik";
pub const DEFAULT_POD_SECURITY: &str = "restricted";

/// Où vivent les apps.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum NamespaceMode {
    /// Un namespace par projet (`<préfixe><projet>`), créé à la demande. Défaut.
    #[default]
    PerProject,
    /// Toutes les apps dans un namespace unique (RBAC namespacé, sans droits cluster).
    Single,
}

impl NamespaceMode {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().replace('_', "-").as_str() {
            "per-project" | "perproject" | "project" => Some(Self::PerProject),
            "single" => Some(Self::Single),
            _ => None,
        }
    }
}

/// Valeurs appliquées quand la spec de l'app ne les précise pas.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KubeDefaults {
    /// Namespace des apps sans projet (et de toutes les apps en mode `single`).
    pub namespace: String,
    pub namespace_mode: NamespaceMode,
    pub namespace_prefix: String,
    /// Niveau PodSecurity des namespaces créés par DevForge.
    pub pod_security: String,
    pub ingress_class: Option<String>,
    pub image_pull_secret: Option<String>,
    pub cluster_issuer: Option<String>,
}

impl Default for KubeDefaults {
    fn default() -> Self {
        Self {
            namespace: DEFAULT_NAMESPACE.into(),
            namespace_mode: NamespaceMode::default(),
            namespace_prefix: DEFAULT_NAMESPACE_PREFIX.into(),
            pod_security: DEFAULT_POD_SECURITY.into(),
            ingress_class: Some(DEFAULT_INGRESS_CLASS.into()),
            image_pull_secret: None,
            cluster_issuer: None,
        }
    }
}

impl KubeDefaults {
    pub fn new(namespace: impl Into<String>) -> Self {
        Self {
            namespace: namespace.into(),
            ..Default::default()
        }
    }

    pub fn from_env() -> Self {
        let ingress_class = match env_opt("DEVFORGE_KUBE_INGRESS_CLASS") {
            None => Some(DEFAULT_INGRESS_CLASS.to_string()),
            Some(v) if v.eq_ignore_ascii_case("none") || v == "-" => None,
            Some(v) => Some(v),
        };
        let pod_security = env_opt("DEVFORGE_KUBE_POD_SECURITY")
            .map(|v| v.to_ascii_lowercase())
            .filter(|v| matches!(v.as_str(), "restricted" | "baseline" | "privileged"))
            .unwrap_or_else(|| DEFAULT_POD_SECURITY.into());
        Self {
            namespace: env_opt("DEVFORGE_KUBE_NAMESPACE")
                .or_else(|| read_trimmed(&PathBuf::from(SA_DIR).join("namespace")))
                .unwrap_or_else(|| DEFAULT_NAMESPACE.into()),
            namespace_mode: env_opt("DEVFORGE_KUBE_NAMESPACE_MODE")
                .and_then(|v| NamespaceMode::parse(&v))
                .unwrap_or_default(),
            namespace_prefix: env_opt("DEVFORGE_KUBE_NAMESPACE_PREFIX")
                .filter(|p| valid_prefix(p))
                .unwrap_or_else(|| DEFAULT_NAMESPACE_PREFIX.into()),
            pod_security,
            ingress_class,
            image_pull_secret: env_opt("DEVFORGE_KUBE_IMAGE_PULL_SECRET"),
            cluster_issuer: env_opt("DEVFORGE_KUBE_CLUSTER_ISSUER"),
        }
    }

    /// Namespace d'une app. `project` doit déjà être validé (label DNS).
    pub fn namespace_for(&self, project: Option<&str>) -> String {
        match (self.namespace_mode, project) {
            (NamespaceMode::PerProject, Some(p)) => format!("{}{p}", self.namespace_prefix),
            _ => self.namespace.clone(),
        }
    }
}

/// Préfixe : minuscules, chiffres, '-', 1–20 caractères, commence par une lettre.
fn valid_prefix(p: &str) -> bool {
    !p.is_empty()
        && p.len() <= 20
        && p.starts_with(|c: char| c.is_ascii_lowercase())
        && p.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Connexion à l'API server. Le jeton est relu à chaque requête (jetons projetés tournants)
/// et n'est jamais stocké ni affiché.
#[derive(Clone)]
pub struct KubeConfig {
    pub api_url: String,
    pub token_file: Option<PathBuf>,
    pub ca_pem: Option<Vec<u8>>,
    pub insecure_skip_tls_verify: bool,
}

impl std::fmt::Debug for KubeConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("KubeConfig")
            .field("api_url", &self.api_url)
            .field("token_file", &self.token_file)
            .field("ca_pem", &self.ca_pem.as_ref().map(|_| "[set]"))
            .field("insecure_skip_tls_verify", &self.insecure_skip_tls_verify)
            .finish()
    }
}

impl KubeConfig {
    pub fn from_env() -> Result<Self, String> {
        let sa = PathBuf::from(SA_DIR);
        let api_url = match env_opt("DEVFORGE_KUBE_API_URL") {
            Some(u) => u.trim_end_matches('/').to_string(),
            None => {
                let host = env_opt("KUBERNETES_SERVICE_HOST").ok_or_else(|| {
                    "API Kubernetes introuvable : ni DEVFORGE_KUBE_API_URL ni KUBERNETES_SERVICE_HOST (DevForge tourne-t-il dans le cluster ?)".to_string()
                })?;
                let port = env_opt("KUBERNETES_SERVICE_PORT").unwrap_or_else(|| "443".into());
                let host = if host.contains(':') && !host.starts_with('[') {
                    format!("[{host}]")
                } else {
                    host
                };
                format!("https://{host}:{port}")
            }
        };
        let token_file = env_opt("DEVFORGE_KUBE_TOKEN_FILE")
            .map(PathBuf::from)
            .or_else(|| {
                let p = sa.join("token");
                p.is_file().then_some(p)
            });
        let ca_file = env_opt("DEVFORGE_KUBE_CA_FILE")
            .map(PathBuf::from)
            .or_else(|| {
                let p = sa.join("ca.crt");
                p.is_file().then_some(p)
            });
        let ca_pem = match ca_file {
            Some(p) => {
                Some(std::fs::read(&p).map_err(|e| format!("CA Kubernetes {}: {e}", p.display()))?)
            }
            None => None,
        };
        let insecure = env_opt("DEVFORGE_KUBE_INSECURE_SKIP_TLS_VERIFY")
            .is_some_and(|v| v == "1" || v.eq_ignore_ascii_case("true"));
        Ok(Self {
            api_url,
            token_file,
            ca_pem,
            insecure_skip_tls_verify: insecure,
        })
    }

    /// Jeton courant (relu depuis le fichier), `None` si aucun fichier.
    pub fn bearer_token(&self) -> Result<Option<String>, String> {
        match &self.token_file {
            Some(p) => read_trimmed(p)
                .map(Some)
                .ok_or_else(|| format!("jeton Kubernetes illisible ({})", p.display())),
            None => Ok(None),
        }
    }
}

fn env_opt(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn read_trimmed(p: &std::path::Path) -> Option<String> {
    std::fs::read_to_string(p)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn namespace_per_project_and_single() {
        let d = KubeDefaults::default();
        assert_eq!(d.namespace_for(Some("blog")), "devforge-blog");
        assert_eq!(d.namespace_for(None), "devforge-apps");
        assert_eq!(d.ingress_class.as_deref(), Some("traefik"));
        let single = KubeDefaults {
            namespace_mode: NamespaceMode::Single,
            ..KubeDefaults::new("apps")
        };
        assert_eq!(single.namespace_for(Some("blog")), "apps");
        assert_eq!(
            NamespaceMode::parse("per_project"),
            Some(NamespaceMode::PerProject)
        );
        assert_eq!(NamespaceMode::parse("SINGLE"), Some(NamespaceMode::Single));
        assert!(valid_prefix("df-") && !valid_prefix("-x") && !valid_prefix("Df"));
    }

    #[test]
    fn debug_never_prints_ca_or_token() {
        let cfg = KubeConfig {
            api_url: "https://10.0.0.1:443".into(),
            token_file: Some("/tmp/t".into()),
            ca_pem: Some(b"-----BEGIN CERTIFICATE-----".to_vec()),
            insecure_skip_tls_verify: false,
        };
        let d = format!("{cfg:?}");
        assert!(!d.contains("BEGIN"));
        assert!(d.contains("[set]"));
    }

    #[test]
    fn token_is_reread_from_file() {
        let dir = std::env::temp_dir().join(format!("df-kube-tok-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("token");
        std::fs::write(&p, "abc\n").unwrap();
        let cfg = KubeConfig {
            api_url: "https://x".into(),
            token_file: Some(p.clone()),
            ca_pem: None,
            insecure_skip_tls_verify: false,
        };
        assert_eq!(cfg.bearer_token().unwrap().as_deref(), Some("abc"));
        std::fs::write(&p, "def").unwrap();
        assert_eq!(cfg.bearer_token().unwrap().as_deref(), Some("def"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
