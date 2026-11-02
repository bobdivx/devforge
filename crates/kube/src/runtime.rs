//! Abstraction runtime minimale pour les apps « image » et implémentation Kubernetes.

use std::time::Duration;

use async_trait::async_trait;
use serde::Serialize;
use serde_json::{json, Value};

use crate::client::{paths, KubeClient, KubeError};
use crate::config::KubeDefaults;
use crate::manifests::{self, ANNOTATION_REPLICAS, ANNOTATION_RESTARTED_AT};
use crate::spec::AppSpec;
use crate::status::{self, AppStatus};
use crate::{CONTAINER_NAME, FIELD_MANAGER, LABEL_APP, LABEL_MANAGED_BY};

pub const MAX_LOG_TAIL: u32 = 2000;
const MAX_LOG_PODS: usize = 3;
const MAX_LOG_BYTES: usize = 512 * 1024;

/// Résultat d'un déploiement.
#[derive(Debug, Clone, Serialize)]
pub struct DeployOutcome {
    pub name: String,
    pub namespace: String,
    /// Ressources appliquées (`Kind/nom`).
    pub applied: Vec<String>,
    /// Ressources supprimées car plus requises (Ingress sans host, Secret vide).
    pub pruned: Vec<String>,
    pub status: AppStatus,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppLogs {
    pub name: String,
    pub pods: Vec<String>,
    pub logs: String,
    pub truncated: bool,
}

/// Opérations minimales d'un runtime capable de faire tourner une image déjà construite.
///
/// Phase 1 : seule l'implémentation Kubernetes existe ; le chemin Docker historique
/// (build + `docker run`) reste dans `devforge-deploy` et n'est pas modifié.
#[async_trait]
pub trait ImageRuntime: Send + Sync {
    fn backend(&self) -> &'static str;
    async fn deploy(&self, spec: &AppSpec) -> Result<DeployOutcome, KubeError>;
    async fn status(&self, name: &str) -> Result<AppStatus, KubeError>;
    async fn list(&self) -> Result<Vec<AppStatus>, KubeError>;
    async fn logs(&self, name: &str, tail: u32) -> Result<AppLogs, KubeError>;
    async fn stop(&self, name: &str) -> Result<AppStatus, KubeError>;
    async fn start(&self, name: &str) -> Result<AppStatus, KubeError>;
    async fn restart(&self, name: &str) -> Result<AppStatus, KubeError>;
    async fn remove(&self, name: &str) -> Result<Vec<String>, KubeError>;
}

pub struct KubeRuntime {
    client: KubeClient,
    defaults: KubeDefaults,
}

impl KubeRuntime {
    pub fn new(client: KubeClient, defaults: KubeDefaults) -> Self {
        Self { client, defaults }
    }

    pub fn from_env() -> Result<Self, KubeError> {
        Ok(Self::new(KubeClient::from_env()?, KubeDefaults::from_env()))
    }

    pub fn namespace(&self) -> &str {
        &self.defaults.namespace
    }

    pub fn defaults(&self) -> &KubeDefaults {
        &self.defaults
    }

    pub fn client(&self) -> &KubeClient {
        &self.client
    }

    fn ns(&self) -> &str {
        &self.defaults.namespace
    }

    fn check_name(name: &str) -> Result<(), KubeError> {
        if crate::spec::is_dns_label(name) && name.len() <= crate::spec::MAX_NAME_LEN {
            Ok(())
        } else {
            Err(KubeError::Invalid(format!("nom d'app invalide ({name})")))
        }
    }

    /// Valide la spec puis rend les manifests (aucun appel réseau).
    pub fn render(&self, spec: &AppSpec) -> Result<manifests::RenderedManifests, KubeError> {
        let mut spec = spec.clone();
        spec.normalize().map_err(KubeError::Invalid)?;
        Ok(manifests::render(&spec, &self.defaults))
    }

    async fn managed_deployment(&self, name: &str) -> Result<Option<Value>, KubeError> {
        let dep = self.client.get(&paths::deployment(self.ns(), name)).await?;
        match dep {
            Some(d) if is_managed(&d) => Ok(Some(d)),
            Some(_) => Err(KubeError::Invalid(format!(
                "le Deployment {name} existe mais n'est pas géré par DevForge (label {LABEL_MANAGED_BY})"
            ))),
            None => Ok(None),
        }
    }

    async fn pods(&self, name: &str) -> Result<Vec<status::PodStatus>, KubeError> {
        let path = format!(
            "{}?{}",
            paths::pods(self.ns()),
            paths::label_selector(LABEL_APP, name)
        );
        let list = self.client.get(&path).await?.unwrap_or(Value::Null);
        Ok(status::pods_from_list(&list))
    }

    /// Attend la fin du rollout (comme `kubectl rollout status`), au plus `timeout`.
    pub async fn wait_rollout(
        &self,
        name: &str,
        timeout: Duration,
    ) -> Result<AppStatus, KubeError> {
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            let st = self.status(name).await?;
            if st.rollout_complete || st.phase == "degraded" || st.phase == "absent" {
                return Ok(st);
            }
            if tokio::time::Instant::now() >= deadline {
                return Ok(st);
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    }

    async fn patch_deployment(&self, name: &str, patch: Value) -> Result<AppStatus, KubeError> {
        if self.managed_deployment(name).await?.is_none() {
            return Err(KubeError::Api {
                status: 404,
                message: format!("app {name} introuvable"),
            });
        }
        self.client
            .merge_patch(&paths::deployment(self.ns(), name), &patch)
            .await?;
        self.status(name).await
    }
}

fn is_managed(obj: &Value) -> bool {
    obj.pointer("/metadata/labels")
        .and_then(|l| l.get(LABEL_MANAGED_BY))
        .and_then(Value::as_str)
        == Some(FIELD_MANAGER)
}

fn kind_name(m: &Value) -> String {
    format!(
        "{}/{}",
        m.get("kind").and_then(Value::as_str).unwrap_or("?"),
        m.pointer("/metadata/name")
            .and_then(Value::as_str)
            .unwrap_or("?")
    )
}

#[async_trait]
impl ImageRuntime for KubeRuntime {
    fn backend(&self) -> &'static str {
        "kubernetes"
    }

    async fn deploy(&self, spec: &AppSpec) -> Result<DeployOutcome, KubeError> {
        let mut spec = spec.clone();
        spec.normalize().map_err(KubeError::Invalid)?;
        // Refuse d'écraser une ressource posée à la main / par un autre outil.
        let _ = self.managed_deployment(&spec.name).await?;
        let rendered = manifests::render(&spec, &self.defaults);
        let ns = self.ns().to_string();
        let mut applied = Vec::new();
        for m in rendered.all() {
            let path = paths::for_manifest(&ns, m)
                .ok_or_else(|| KubeError::Invalid(format!("kind non géré : {}", kind_name(m))))?;
            self.client.apply(&path, m).await?;
            applied.push(kind_name(m));
        }
        let mut pruned = Vec::new();
        if rendered.ingress.is_none() {
            let p = paths::ingress(&ns, &spec.name);
            if let Some(obj) = self.client.get(&p).await? {
                if is_managed(&obj) && self.client.delete(&p).await? {
                    pruned.push(format!("Ingress/{}", spec.name));
                }
            }
        }
        if rendered.secret.is_none() {
            let p = paths::secret(&ns, &spec.secret_name());
            if let Some(obj) = self.client.get(&p).await? {
                if is_managed(&obj) && self.client.delete(&p).await? {
                    pruned.push(format!("Secret/{}", spec.secret_name()));
                }
            }
        }
        tracing::info!(app = %spec.name, namespace = %ns, image = %spec.image, "kube deploy appliqué");
        let status = self.status(&spec.name).await?;
        Ok(DeployOutcome {
            name: spec.name.clone(),
            namespace: ns,
            applied,
            pruned,
            status,
        })
    }

    async fn status(&self, name: &str) -> Result<AppStatus, KubeError> {
        Self::check_name(name)?;
        let dep = self.managed_deployment(name).await?;
        let pods = if dep.is_some() {
            self.pods(name).await?
        } else {
            Vec::new()
        };
        Ok(status::app_status(name, self.ns(), dep.as_ref(), pods))
    }

    async fn list(&self) -> Result<Vec<AppStatus>, KubeError> {
        let path = format!(
            "{}?{}",
            paths::deployments(self.ns()),
            paths::label_selector(LABEL_MANAGED_BY, FIELD_MANAGER)
        );
        let list = self.client.get(&path).await?.unwrap_or(Value::Null);
        let mut out = Vec::new();
        for dep in list
            .get("items")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
        {
            let name = dep
                .pointer("/metadata/name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            // Liste sans pods (un appel par app serait coûteux) ; détail via `status`.
            out.push(status::app_status(&name, self.ns(), Some(&dep), Vec::new()));
        }
        out.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(out)
    }

    async fn logs(&self, name: &str, tail: u32) -> Result<AppLogs, KubeError> {
        Self::check_name(name)?;
        if self.managed_deployment(name).await?.is_none() {
            return Err(KubeError::Api {
                status: 404,
                message: format!("app {name} introuvable"),
            });
        }
        let tail = tail.clamp(1, MAX_LOG_TAIL);
        let pods = self.pods(name).await?;
        let mut names = Vec::new();
        let mut buf = String::new();
        for pod in pods.iter().take(MAX_LOG_PODS) {
            names.push(pod.name.clone());
            let path = paths::pod_log(self.ns(), &pod.name, CONTAINER_NAME, tail);
            let text = match self.client.get_text(&path).await {
                Ok(t) => t,
                // Pod pas encore démarré (ContainerCreating, ImagePullBackOff…).
                Err(KubeError::Api {
                    status: 400,
                    message,
                }) => format!("({message})\n"),
                Err(e) => return Err(e),
            };
            buf.push_str(&format!("==> {} ({}) <==\n", pod.name, pod.phase));
            buf.push_str(&text);
            if !buf.ends_with('\n') {
                buf.push('\n');
            }
        }
        let mut logs = devforge_shared::log_redact::redact_log_text(&buf);
        let truncated = logs.len() > MAX_LOG_BYTES;
        if truncated {
            let mut cut = logs.len() - MAX_LOG_BYTES;
            while !logs.is_char_boundary(cut) {
                cut += 1;
            }
            logs = logs[cut..].to_string();
        }
        Ok(AppLogs {
            name: name.into(),
            pods: names,
            logs,
            truncated,
        })
    }

    async fn stop(&self, name: &str) -> Result<AppStatus, KubeError> {
        Self::check_name(name)?;
        let Some(dep) = self.managed_deployment(name).await? else {
            return Err(KubeError::Api {
                status: 404,
                message: format!("app {name} introuvable"),
            });
        };
        let current = dep
            .pointer("/spec/replicas")
            .and_then(Value::as_i64)
            .unwrap_or(1);
        let remember = if current > 0 {
            current
        } else {
            status::remembered_replicas(&dep)
        };
        self.patch_deployment(
            name,
            json!({
                "metadata": { "annotations": { ANNOTATION_REPLICAS: remember.to_string() } },
                "spec": { "replicas": 0 }
            }),
        )
        .await
    }

    async fn start(&self, name: &str) -> Result<AppStatus, KubeError> {
        Self::check_name(name)?;
        let Some(dep) = self.managed_deployment(name).await? else {
            return Err(KubeError::Api {
                status: 404,
                message: format!("app {name} introuvable"),
            });
        };
        let replicas = status::remembered_replicas(&dep);
        self.patch_deployment(name, json!({ "spec": { "replicas": replicas } }))
            .await
    }

    async fn restart(&self, name: &str) -> Result<AppStatus, KubeError> {
        Self::check_name(name)?;
        // Même mécanisme que `kubectl rollout restart` : rolling update sans coupure.
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        self.patch_deployment(
            name,
            json!({ "spec": { "template": { "metadata": { "annotations": {
                ANNOTATION_RESTARTED_AT: now
            }}}}}),
        )
        .await
    }

    async fn remove(&self, name: &str) -> Result<Vec<String>, KubeError> {
        Self::check_name(name)?;
        let ns = self.ns().to_string();
        let mut removed = Vec::new();
        let targets = [
            ("Ingress", paths::ingress(&ns, name)),
            ("Service", paths::service(&ns, name)),
            ("Deployment", paths::deployment(&ns, name)),
            ("Secret", paths::secret(&ns, &format!("{name}-env"))),
        ];
        for (kind, path) in targets {
            if let Some(obj) = self.client.get(&path).await? {
                if is_managed(&obj) && self.client.delete(&path).await? {
                    removed.push(format!(
                        "{kind}/{}",
                        obj.pointer("/metadata/name")
                            .and_then(Value::as_str)
                            .unwrap_or(name)
                    ));
                }
            }
        }
        Ok(removed)
    }
}
