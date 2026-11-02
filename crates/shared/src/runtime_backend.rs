//! Choix du backend d'exécution des apps (`DEVFORGE_RUNTIME`).
//!
//! - `docker` (défaut) : comportement historique (`docker build` / `docker run`, Traefik).
//! - `kubernetes` (alias `k8s`, `kube`) : DevForge tourne dans un cluster et déploie des
//!   images déjà construites via l'API Kubernetes (phase 1).

/// Backend d'exécution sélectionné.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum RuntimeBackend {
    #[default]
    Docker,
    Kubernetes,
}

impl RuntimeBackend {
    /// Valeur inconnue ou vide → `Docker` (jamais de bascule silencieuse vers k8s).
    pub fn parse(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "kubernetes" | "k8s" | "kube" => Self::Kubernetes,
            _ => Self::Docker,
        }
    }

    pub fn from_env() -> Self {
        std::env::var("DEVFORGE_RUNTIME")
            .map(|v| Self::parse(&v))
            .unwrap_or_default()
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Docker => "docker",
            Self::Kubernetes => "kubernetes",
        }
    }

    pub fn is_kubernetes(self) -> bool {
        matches!(self, Self::Kubernetes)
    }
}

#[cfg(test)]
mod tests {
    use super::RuntimeBackend;

    #[test]
    fn parse_defaults_to_docker() {
        assert_eq!(RuntimeBackend::parse(""), RuntimeBackend::Docker);
        assert_eq!(RuntimeBackend::parse("docker"), RuntimeBackend::Docker);
        assert_eq!(RuntimeBackend::parse("nomad"), RuntimeBackend::Docker);
        assert_eq!(RuntimeBackend::default(), RuntimeBackend::Docker);
    }

    #[test]
    fn parse_kubernetes_aliases() {
        for v in ["kubernetes", "K8S", " kube "] {
            assert_eq!(RuntimeBackend::parse(v), RuntimeBackend::Kubernetes);
        }
        assert_eq!(RuntimeBackend::Kubernetes.as_str(), "kubernetes");
    }
}
