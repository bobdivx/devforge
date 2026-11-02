//! Backend Kubernetes de DevForge — phase 1.
//!
//! Déploie une application à partir d'une **image déjà construite** (registre OCI) :
//! `Deployment` + `Service` + `Ingress` (optionnel) + `Secret` (variables sensibles),
//! sondes de santé, statut, logs (API Pod), stop / start / restart et rolling update.
//!
//! Activé uniquement avec `DEVFORGE_RUNTIME=kubernetes` ; le backend Docker reste le défaut.
//! Pas de build dans le cluster en phase 1 (Kaniko prévu en phase 2).

pub mod client;
pub mod config;
pub mod manifests;
pub mod runtime;
pub mod spec;
pub mod status;

pub use client::{KubeClient, KubeError};
pub use config::{KubeConfig, KubeDefaults, NamespaceMode};
pub use manifests::{render, RenderedManifests};
pub use runtime::{ImageRuntime, KubeRuntime};
pub use spec::{AppRef, AppSpec, HealthSpec, ResourceSpec, TlsSpec};
pub use status::{AppStatus, PodStatus};

/// Gestionnaire de champs (server-side apply) et valeur du label `managed-by`.
pub const FIELD_MANAGER: &str = "devforge";
/// Label commun à toutes les ressources posées par DevForge.
pub const LABEL_MANAGED_BY: &str = "app.kubernetes.io/managed-by";
/// Label sélecteur d'une app (stable, utilisé par `Service` et la recherche des pods).
pub const LABEL_APP: &str = "devforge.io/app";
/// Nom du conteneur principal dans le pod.
pub const CONTAINER_NAME: &str = "app";
