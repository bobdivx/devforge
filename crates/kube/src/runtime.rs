//! Abstraction runtime minimale pour les apps « image » et implémentation Kubernetes.

use std::time::Duration;

use async_trait::async_trait;
use serde::Serialize;
use serde_json::{json, Value};

use crate::client::{paths, KubeClient, KubeError};
use crate::config::{KubeDefaults, NamespaceMode};
use crate::manifests::{self, ANNOTATION_REPLICAS, ANNOTATION_RESTARTED_AT};
use crate::spec::{AppRef, AppSpec};
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
    async fn status(&self, app: &AppRef) -> Result<AppStatus, KubeError>;
    /// Toutes les apps gérées ; `project` filtre sur un projet.
    async fn list(&self, project: Option<&str>) -> Result<Vec<AppStatus>, KubeError>;
    async fn logs(&self, app: &AppRef, tail: u32) -> Result<AppLogs, KubeError>;
    async fn stop(&self, app: &AppRef) -> Result<AppStatus, KubeError>;
    async fn start(&self, app: &AppRef) -> Result<AppStatus, KubeError>;
    async fn restart(&self, app: &AppRef) -> Result<AppStatus, KubeError>;
    async fn remove(&self, app: &AppRef) -> Result<Vec<String>, KubeError>;
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

    /// Namespace d'une app (valide la référence).
    pub fn namespace_of(&self, app: &AppRef) -> Result<String, KubeError> {
        app.validate().map_err(KubeError::Invalid)?;
        Ok(self.defaults.namespace_for(app.project.as_deref()))
    }

    /// Valide la spec puis rend les manifests (aucun appel réseau).
    pub fn render(&self, spec: &AppSpec) -> Result<manifests::RenderedManifests, KubeError> {
        let mut spec = spec.clone();
        spec.normalize().map_err(KubeError::Invalid)?;
        Ok(manifests::render(&spec, &self.defaults))
    }

    /// Crée le namespace du projet s'il manque (mode `per-project`). Un namespace existant
    /// non créé par DevForge n'est utilisé que s'il s'agit du namespace par défaut.
    async fn ensure_namespace(&self, ns: &str, project: Option<&str>) -> Result<(), KubeError> {
        let path = paths::namespace(ns);
        match self.client.get(&path).await {
            Ok(Some(obj)) => {
                if is_managed(&obj) || ns == self.defaults.namespace {
                    Ok(())
                } else {
                    Err(KubeError::Invalid(format!(
                        "le namespace {ns} existe mais n'est pas géré par DevForge (label {LABEL_MANAGED_BY})"
                    )))
                }
            }
            Ok(None) => {
                let m = manifests::namespace(ns, project, &self.defaults.pod_security);
                self.client.apply(&path, &m).await?;
                tracing::info!(namespace = %ns, "namespace de projet créé");
                Ok(())
            }
            // RBAC sans droits sur les namespaces (mode `single`) : on suppose qu'il existe.
            Err(KubeError::Api { status: 403, .. }) if ns == self.defaults.namespace => Ok(()),
            Err(e) => Err(e),
        }
    }

    /// Mode per-project : recopie le secret de pull par défaut (ex. GHCR) depuis le
    /// namespace des apps vers celui du projet s'il n'y existe pas encore. Un secret
    /// déjà présent (géré à la main ou par DevForge) n'est jamais écrasé.
    async fn ensure_pull_secret(&self, ns: &str) -> Result<(), KubeError> {
        let Some(name) = self.defaults.image_pull_secret.as_deref() else {
            return Ok(());
        };
        if ns == self.defaults.namespace {
            return Ok(());
        }
        let target = paths::secret(ns, name);
        if self.client.get(&target).await?.is_some() {
            return Ok(());
        }
        let Some(src) = self
            .client
            .get(&paths::secret(&self.defaults.namespace, name))
            .await?
        else {
            tracing::warn!(secret = %name, source = %self.defaults.namespace,
                "secret de pull introuvable : à créer dans le namespace des apps");
            return Ok(());
        };
        let copy = json!({
            "apiVersion": "v1",
            "kind": "Secret",
            "metadata": {
                "name": name,
                "namespace": ns,
                "labels": { LABEL_MANAGED_BY: FIELD_MANAGER },
            },
            "type": src.get("type").cloned().unwrap_or(json!("kubernetes.io/dockerconfigjson")),
            "data": src.get("data").cloned().unwrap_or(json!({})),
        });
        self.client.apply(&target, &copy).await?;
        tracing::info!(secret = %name, namespace = %ns, "secret de pull recopié");
        Ok(())
    }

    async fn managed_deployment(&self, ns: &str, name: &str) -> Result<Option<Value>, KubeError> {
        let dep = self.client.get(&paths::deployment(ns, name)).await?;
        match dep {
            Some(d) if is_managed(&d) => Ok(Some(d)),
            Some(_) => Err(KubeError::Invalid(format!(
                "le Deployment {name} existe mais n'est pas géré par DevForge (label {LABEL_MANAGED_BY})"
            ))),
            None => Ok(None),
        }
    }

    async fn require_deployment(&self, ns: &str, name: &str) -> Result<Value, KubeError> {
        self.managed_deployment(ns, name)
            .await?
            .ok_or_else(|| KubeError::Api {
                status: 404,
                message: format!("app {name} introuvable (namespace {ns})"),
            })
    }

    async fn pods(&self, ns: &str, name: &str) -> Result<Vec<status::PodStatus>, KubeError> {
        let path = format!(
            "{}?{}",
            paths::pods(ns),
            paths::label_selector(LABEL_APP, name)
        );
        let list = self.client.get(&path).await?.unwrap_or(Value::Null);
        Ok(status::pods_from_list(&list))
    }

    /// Attend la fin du rollout (comme `kubectl rollout status`), au plus `timeout`.
    pub async fn wait_rollout(
        &self,
        app: &AppRef,
        timeout: Duration,
    ) -> Result<AppStatus, KubeError> {
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            let st = self.status(app).await?;
            if st.rollout_complete || st.phase == "degraded" || st.phase == "absent" {
                return Ok(st);
            }
            if tokio::time::Instant::now() >= deadline {
                return Ok(st);
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    }

    async fn patch_deployment(&self, app: &AppRef, patch: Value) -> Result<AppStatus, KubeError> {
        let ns = self.namespace_of(app)?;
        self.require_deployment(&ns, &app.name).await?;
        self.client
            .merge_patch(&paths::deployment(&ns, &app.name), &patch)
            .await?;
        self.status(app).await
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
        let ns = self.defaults.namespace_for(spec.project.as_deref());
        self.ensure_namespace(&ns, spec.project.as_deref()).await?;
        self.ensure_pull_secret(&ns).await?;
        // Refuse d'écraser une ressource posée à la main / par un autre outil.
        let _ = self.managed_deployment(&ns, &spec.name).await?;
        let rendered = manifests::render(&spec, &self.defaults);
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
        let status = self.status(&spec.app_ref()).await?;
        Ok(DeployOutcome {
            name: spec.name.clone(),
            namespace: ns,
            applied,
            pruned,
            status,
        })
    }

    async fn status(&self, app: &AppRef) -> Result<AppStatus, KubeError> {
        let ns = self.namespace_of(app)?;
        let dep = self.managed_deployment(&ns, &app.name).await?;
        let pods = if dep.is_some() {
            self.pods(&ns, &app.name).await?
        } else {
            Vec::new()
        };
        let mut st = status::app_status(&app.name, &ns, dep.as_ref(), pods);
        if st.project.is_none() {
            st.project = app.project.clone();
        }
        Ok(st)
    }

    async fn list(&self, project: Option<&str>) -> Result<Vec<AppStatus>, KubeError> {
        crate::spec::validate_project(project).map_err(KubeError::Invalid)?;
        let mut selector = paths::label_selector(LABEL_MANAGED_BY, FIELD_MANAGER);
        if let Some(p) = project {
            // `,` encodé : sélecteur ET.
            selector.push_str("%2C");
            selector.push_str(
                paths::label_selector(manifests::LABEL_PROJECT_NAME, p)
                    .trim_start_matches("labelSelector="),
            );
        }
        let base = match (self.defaults.namespace_mode, project) {
            (NamespaceMode::Single, _) => paths::deployments(&self.defaults.namespace),
            (NamespaceMode::PerProject, Some(p)) => {
                paths::deployments(&self.defaults.namespace_for(Some(p)))
            }
            (NamespaceMode::PerProject, None) => paths::all_deployments(),
        };
        let list = self
            .client
            .get(&format!("{base}?{selector}"))
            .await?
            .unwrap_or(Value::Null);
        let mut out = Vec::new();
        for dep in list
            .get("items")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
        {
            let meta = |k: &str| {
                dep.pointer(&format!("/metadata/{k}"))
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string()
            };
            let (name, ns) = (meta("name"), meta("namespace"));
            // Mode per-project : seuls les namespaces DevForge (préfixe ou défaut).
            if self.defaults.namespace_mode == NamespaceMode::PerProject
                && ns != self.defaults.namespace
                && !ns.starts_with(&self.defaults.namespace_prefix)
            {
                continue;
            }
            // Liste sans pods (un appel par app serait coûteux) ; détail via `status`.
            out.push(status::app_status(&name, &ns, Some(&dep), Vec::new()));
        }
        out.sort_by(|a, b| (&a.namespace, &a.name).cmp(&(&b.namespace, &b.name)));
        Ok(out)
    }

    async fn logs(&self, app: &AppRef, tail: u32) -> Result<AppLogs, KubeError> {
        let ns = self.namespace_of(app)?;
        self.require_deployment(&ns, &app.name).await?;
        let tail = tail.clamp(1, MAX_LOG_TAIL);
        let pods = self.pods(&ns, &app.name).await?;
        let mut names = Vec::new();
        let mut buf = String::new();
        for pod in pods.iter().take(MAX_LOG_PODS) {
            names.push(pod.name.clone());
            let path = paths::pod_log(&ns, &pod.name, CONTAINER_NAME, tail);
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
            name: app.name.clone(),
            pods: names,
            logs,
            truncated,
        })
    }

    async fn stop(&self, app: &AppRef) -> Result<AppStatus, KubeError> {
        let ns = self.namespace_of(app)?;
        let dep = self.require_deployment(&ns, &app.name).await?;
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
            app,
            json!({
                "metadata": { "annotations": { ANNOTATION_REPLICAS: remember.to_string() } },
                "spec": { "replicas": 0 }
            }),
        )
        .await
    }

    async fn start(&self, app: &AppRef) -> Result<AppStatus, KubeError> {
        let ns = self.namespace_of(app)?;
        let dep = self.require_deployment(&ns, &app.name).await?;
        let replicas = status::remembered_replicas(&dep);
        self.patch_deployment(app, json!({ "spec": { "replicas": replicas } }))
            .await
    }

    async fn restart(&self, app: &AppRef) -> Result<AppStatus, KubeError> {
        // Même mécanisme que `kubectl rollout restart` : rolling update sans coupure.
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        self.patch_deployment(
            app,
            json!({ "spec": { "template": { "metadata": { "annotations": {
                ANNOTATION_RESTARTED_AT: now
            }}}}}),
        )
        .await
    }

    /// Supprime les ressources de l'app. Le namespace du projet est conservé (autres apps,
    /// secrets de pull) : `kubectl delete ns` pour le retirer.
    async fn remove(&self, app: &AppRef) -> Result<Vec<String>, KubeError> {
        let ns = self.namespace_of(app)?;
        let name = app.name.as_str();
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
