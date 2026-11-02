//! Génération pure (sans réseau) des manifests Kubernetes d'une app « image ».

use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::config::KubeDefaults;
use crate::spec::{cpu_quantity, memory_quantity, AppSpec};
use crate::{CONTAINER_NAME, FIELD_MANAGER, LABEL_APP, LABEL_MANAGED_BY};

/// Annotation (template de pod) : empreinte env + secrets → un changement de config
/// déclenche un rolling update même si l'image ne change pas.
pub const ANNOTATION_CONFIG_HASH: &str = "devforge.io/config-hash";
/// Annotation (Deployment) : réplicas à restaurer après un `stop`.
pub const ANNOTATION_REPLICAS: &str = "devforge.io/replicas";
pub const ANNOTATION_RESTARTED_AT: &str = "kubectl.kubernetes.io/restartedAt";
pub const LABEL_PROJECT: &str = "devforge.io/project";
/// Slug du projet propriétaire d'un namespace créé par DevForge.
pub const LABEL_PROJECT_NAME: &str = "devforge.io/project-name";

/// Délai `preStop` avant l'arrêt d'un pod (retrait de l'endpoint côté ingress).
pub const PRESTOP_SLEEP_SECONDS: u64 = 5;

/// Namespace de projet créé à la demande (mode `per-project`), avec labels PodSecurity.
pub fn namespace(name: &str, project: Option<&str>, pod_security: &str) -> Value {
    let mut labels = Map::new();
    labels.insert(LABEL_MANAGED_BY.into(), json!(FIELD_MANAGER));
    if let Some(p) = project {
        labels.insert(LABEL_PROJECT_NAME.into(), json!(p));
    }
    for mode in ["enforce", "audit", "warn"] {
        labels.insert(
            format!("pod-security.kubernetes.io/{mode}"),
            json!(pod_security),
        );
    }
    labels.insert(
        "pod-security.kubernetes.io/enforce-version".into(),
        json!("latest"),
    );
    json!({
        "apiVersion": "v1",
        "kind": "Namespace",
        "metadata": { "name": name, "labels": labels }
    })
}

/// Manifests d'une app. `ingress` / `secret` sont `None` quand non requis
/// (ils sont alors supprimés du cluster au déploiement).
#[derive(Debug, Clone, PartialEq)]
pub struct RenderedManifests {
    pub namespace: String,
    pub deployment: Value,
    pub service: Value,
    pub ingress: Option<Value>,
    pub secret: Option<Value>,
}

impl RenderedManifests {
    /// Liste ordonnée (Secret d'abord : le Deployment le référence).
    pub fn all(&self) -> Vec<&Value> {
        let mut v = Vec::new();
        if let Some(s) = &self.secret {
            v.push(s);
        }
        v.push(&self.deployment);
        v.push(&self.service);
        if let Some(i) = &self.ingress {
            v.push(i);
        }
        v
    }

    /// Version affichable : valeurs du Secret masquées.
    pub fn redacted(&self) -> Value {
        let items: Vec<Value> = self
            .all()
            .into_iter()
            .map(|m| {
                let mut m = m.clone();
                if m.get("kind").and_then(Value::as_str) == Some("Secret") {
                    if let Some(data) = m.get_mut("stringData").and_then(Value::as_object_mut) {
                        for v in data.values_mut() {
                            *v = Value::String("***".into());
                        }
                    }
                }
                m
            })
            .collect();
        json!({ "apiVersion": "v1", "kind": "List", "items": items })
    }
}

/// Labels communs (et sélecteur via `devforge.io/app`).
pub fn labels(spec: &AppSpec) -> Map<String, Value> {
    let mut m = Map::new();
    m.insert("app.kubernetes.io/name".into(), json!(spec.name));
    m.insert("app.kubernetes.io/instance".into(), json!(spec.name));
    m.insert(LABEL_MANAGED_BY.into(), json!(FIELD_MANAGER));
    m.insert(LABEL_APP.into(), json!(spec.name));
    if let Some(p) = &spec.project_uuid {
        m.insert(LABEL_PROJECT.into(), json!(p));
    }
    if let Some(p) = &spec.project {
        m.insert(LABEL_PROJECT_NAME.into(), json!(p));
    }
    m
}

fn selector(spec: &AppSpec) -> Value {
    json!({ LABEL_APP: spec.name })
}

/// Empreinte courte et stable de la configuration (env + secrets), sans révéler les valeurs.
pub fn config_hash(spec: &AppSpec) -> String {
    let mut h = Sha256::new();
    for (k, v) in &spec.env {
        h.update(b"e\0");
        h.update(k.as_bytes());
        h.update(b"\0");
        h.update(v.as_bytes());
        h.update(b"\0");
    }
    for (k, v) in &spec.secrets {
        h.update(b"s\0");
        h.update(k.as_bytes());
        h.update(b"\0");
        h.update(v.as_bytes());
        h.update(b"\0");
    }
    h.finalize()
        .iter()
        .take(8)
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// `latest` ou sans tag (ni digest) → `Always`, sinon `IfNotPresent`.
pub fn pull_policy(image: &str) -> &'static str {
    if image.contains('@') {
        return "IfNotPresent";
    }
    let last = image.rsplit('/').next().unwrap_or(image);
    match last.split_once(':') {
        Some((_, tag)) if tag != "latest" => "IfNotPresent",
        _ => "Always",
    }
}

fn probes(spec: &AppSpec) -> (Value, Value) {
    let h = spec.health.clone().unwrap_or_default();
    let action = match &h.path {
        Some(path) => json!({ "httpGet": { "path": path, "port": "http" } }),
        None => json!({ "tcpSocket": { "port": "http" } }),
    };
    let period = h.period_seconds.unwrap_or(10).max(1);
    let failure = h.failure_threshold.unwrap_or(3).max(1);
    let mut readiness = action.clone();
    let mut liveness = action;
    let r = readiness.as_object_mut().expect("probe object");
    r.insert(
        "initialDelaySeconds".into(),
        json!(h.initial_delay_seconds.unwrap_or(5)),
    );
    r.insert("periodSeconds".into(), json!(period));
    r.insert("failureThreshold".into(), json!(failure));
    r.insert("timeoutSeconds".into(), json!(5));
    let l = liveness.as_object_mut().expect("probe object");
    // La liveness démarre plus tard : une app lente ne doit pas boucler en redémarrage.
    l.insert(
        "initialDelaySeconds".into(),
        json!(h.initial_delay_seconds.unwrap_or(5).max(30)),
    );
    l.insert("periodSeconds".into(), json!(period.max(20)));
    l.insert("failureThreshold".into(), json!(failure.max(3)));
    l.insert("timeoutSeconds".into(), json!(5));
    (readiness, liveness)
}

fn resources(spec: &AppSpec) -> Option<Value> {
    let res = spec.resources.as_ref()?;
    let mut limits = Map::new();
    let mut requests = Map::new();
    if let Some(m) = res.memory.as_deref().and_then(|m| memory_quantity(m).ok()) {
        limits.insert("memory".into(), json!(m));
        requests.insert("memory".into(), json!(m));
    }
    if let Some(c) = res.cpus.as_deref().and_then(|c| cpu_quantity(c).ok()) {
        limits.insert("cpu".into(), json!(c));
    }
    if limits.is_empty() {
        return None;
    }
    Some(json!({ "limits": limits, "requests": requests }))
}

pub fn deployment(spec: &AppSpec, d: &KubeDefaults) -> Value {
    let lbl = labels(spec);
    let env: Vec<Value> = spec
        .env
        .iter()
        .map(|(k, v)| json!({ "name": k, "value": v }))
        .collect();
    let (readiness, liveness) = probes(spec);
    let mut container = json!({
        "name": CONTAINER_NAME,
        "image": spec.image,
        "imagePullPolicy": pull_policy(&spec.image),
        "ports": [{ "name": "http", "containerPort": spec.port, "protocol": "TCP" }],
        "readinessProbe": readiness,
        "livenessProbe": liveness,
        // Rolling update sans coupure : le pod sortant continue de servir le temps que
        // l'ingress controller retire son endpoint (sinon 502 / timeouts constatés sur k3s +
        // Traefik). Action `sleep` native (Kubernetes ≥ 1.30) : marche sans shell dans l'image.
        "lifecycle": { "preStop": { "sleep": { "seconds": PRESTOP_SLEEP_SECONDS } } },
        "securityContext": {
            "allowPrivilegeEscalation": false,
            "capabilities": { "drop": ["ALL"] }
        }
    });
    let c = container.as_object_mut().expect("container object");
    if !env.is_empty() {
        c.insert("env".into(), Value::Array(env));
    }
    if !spec.secrets.is_empty() {
        c.insert(
            "envFrom".into(),
            json!([{ "secretRef": { "name": spec.secret_name() } }]),
        );
    }
    if let Some(r) = resources(spec) {
        c.insert("resources".into(), r);
    }

    let mut pod_sc = Map::new();
    pod_sc.insert("seccompProfile".into(), json!({ "type": "RuntimeDefault" }));
    if spec.run_as_non_root {
        pod_sc.insert("runAsNonRoot".into(), json!(true));
    }
    if let Some(uid) = spec.run_as_user {
        pod_sc.insert("runAsUser".into(), json!(uid));
    }

    let mut pod_spec = json!({
        "automountServiceAccountToken": false,
        "terminationGracePeriodSeconds": PRESTOP_SLEEP_SECONDS + 30,
        "enableServiceLinks": false,
        "securityContext": pod_sc,
        "containers": [container],
    });
    if let Some(pull) = spec
        .image_pull_secret
        .clone()
        .or_else(|| d.image_pull_secret.clone())
    {
        pod_spec
            .as_object_mut()
            .expect("pod spec object")
            .insert("imagePullSecrets".into(), json!([{ "name": pull }]));
    }

    json!({
        "apiVersion": "apps/v1",
        "kind": "Deployment",
        "metadata": {
            "name": spec.name,
            "namespace": d.namespace_for(spec.project.as_deref()),
            "labels": lbl,
            "annotations": { ANNOTATION_REPLICAS: spec.replicas.max(1).to_string() }
        },
        "spec": {
            "replicas": spec.replicas,
            "revisionHistoryLimit": 5,
            "progressDeadlineSeconds": 600,
            "selector": { "matchLabels": selector(spec) },
            "strategy": {
                "type": "RollingUpdate",
                "rollingUpdate": { "maxSurge": 1, "maxUnavailable": 0 }
            },
            "template": {
                "metadata": {
                    "labels": lbl,
                    "annotations": { ANNOTATION_CONFIG_HASH: config_hash(spec) }
                },
                "spec": pod_spec
            }
        }
    })
}

pub fn service(spec: &AppSpec, d: &KubeDefaults) -> Value {
    json!({
        "apiVersion": "v1",
        "kind": "Service",
        "metadata": { "name": spec.name, "namespace": d.namespace_for(spec.project.as_deref()), "labels": labels(spec) },
        "spec": {
            "type": "ClusterIP",
            "selector": selector(spec),
            "ports": [{ "name": "http", "port": 80, "targetPort": "http", "protocol": "TCP" }]
        }
    })
}

pub fn ingress(spec: &AppSpec, d: &KubeDefaults) -> Option<Value> {
    let host = spec.host.as_ref()?;
    let mut annotations = Map::new();
    let issuer = spec
        .tls
        .as_ref()
        .and_then(|t| t.cluster_issuer.clone())
        .or_else(|| spec.tls.as_ref().and(d.cluster_issuer.clone()));
    if let Some(issuer) = issuer {
        annotations.insert("cert-manager.io/cluster-issuer".into(), json!(issuer));
    }
    let mut ing_spec = json!({
        "rules": [{
            "host": host,
            "http": { "paths": [{
                "path": "/",
                "pathType": "Prefix",
                "backend": { "service": { "name": spec.name, "port": { "number": 80 } } }
            }]}
        }]
    });
    let s = ing_spec.as_object_mut().expect("ingress spec object");
    if let Some(class) = spec
        .ingress_class
        .clone()
        .or_else(|| d.ingress_class.clone())
    {
        s.insert("ingressClassName".into(), json!(class));
    }
    if let Some(secret) = spec.tls_secret_name() {
        s.insert(
            "tls".into(),
            json!([{ "hosts": [host], "secretName": secret }]),
        );
    }
    let mut meta = json!({ "name": spec.name, "namespace": d.namespace_for(spec.project.as_deref()), "labels": labels(spec) });
    if !annotations.is_empty() {
        meta.as_object_mut()
            .expect("metadata object")
            .insert("annotations".into(), Value::Object(annotations));
    }
    Some(json!({
        "apiVersion": "networking.k8s.io/v1",
        "kind": "Ingress",
        "metadata": meta,
        "spec": ing_spec
    }))
}

pub fn secret(spec: &AppSpec, d: &KubeDefaults) -> Option<Value> {
    if spec.secrets.is_empty() {
        return None;
    }
    Some(json!({
        "apiVersion": "v1",
        "kind": "Secret",
        "type": "Opaque",
        "metadata": { "name": spec.secret_name(), "namespace": d.namespace_for(spec.project.as_deref()), "labels": labels(spec) },
        "stringData": spec.secrets
    }))
}

/// Rend tous les manifests (la spec doit avoir été validée).
pub fn render(spec: &AppSpec, d: &KubeDefaults) -> RenderedManifests {
    RenderedManifests {
        namespace: d.namespace_for(spec.project.as_deref()),
        deployment: deployment(spec, d),
        service: service(spec, d),
        ingress: ingress(spec, d),
        secret: secret(spec, d),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pull_policy_rules() {
        assert_eq!(pull_policy("nginx"), "Always");
        assert_eq!(pull_policy("nginx:latest"), "Always");
        assert_eq!(pull_policy("ghcr.io/o/a:1.2"), "IfNotPresent");
        assert_eq!(pull_policy("localhost:5000/a"), "Always");
        assert_eq!(pull_policy("localhost:5000/a:v1"), "IfNotPresent");
        assert_eq!(pull_policy("a@sha256:abc"), "IfNotPresent");
    }

    #[test]
    fn config_hash_changes_with_secret_values() {
        let mut a = AppSpec::new("a", "i:1");
        let h0 = config_hash(&a);
        a.secrets.insert("K".into(), "v1".into());
        let h1 = config_hash(&a);
        a.secrets.insert("K".into(), "v2".into());
        let h2 = config_hash(&a);
        assert_ne!(h0, h1);
        assert_ne!(h1, h2);
        assert_eq!(h2.len(), 16);
        assert!(!h2.contains("v2"));
    }

    #[test]
    fn project_app_goes_to_its_own_namespace_with_traefik() {
        let mut spec = AppSpec::new("web", "nginx:1");
        spec.project = Some("shop".into());
        spec.host = Some("shop.example.com".into());
        let r = render(&spec, &KubeDefaults::new("devforge-apps"));
        assert_eq!(r.namespace, "devforge-shop");
        assert_eq!(r.deployment["metadata"]["namespace"], "devforge-shop");
        assert_eq!(
            r.deployment["metadata"]["labels"][LABEL_PROJECT_NAME],
            "shop"
        );
        let ing = r.ingress.expect("ingress");
        assert_eq!(ing["metadata"]["namespace"], "devforge-shop");
        assert_eq!(ing["spec"]["ingressClassName"], "traefik");
        let ns = namespace("devforge-shop", Some("shop"), "restricted");
        assert_eq!(
            ns["metadata"]["labels"]["pod-security.kubernetes.io/enforce"],
            "restricted"
        );
        assert_eq!(ns["metadata"]["labels"][LABEL_MANAGED_BY], FIELD_MANAGER);
    }

    #[test]
    fn no_host_means_no_ingress_and_no_secret() {
        let r = render(&AppSpec::new("a", "i:1"), &KubeDefaults::new("ns"));
        assert!(r.ingress.is_none());
        assert!(r.secret.is_none());
        assert_eq!(r.all().len(), 2);
    }

    #[test]
    fn redacted_hides_secret_values() {
        let mut s = AppSpec::new("a", "i:1");
        s.secrets.insert("DB_PASSWORD".into(), "hunter2".into());
        let r = render(&s, &KubeDefaults::new("ns"));
        let txt = r.redacted().to_string();
        assert!(!txt.contains("hunter2"));
        assert!(txt.contains("DB_PASSWORD"));
        // Le manifest réel, lui, contient bien la valeur (envoyée à l'API uniquement).
        assert!(r.secret.unwrap().to_string().contains("hunter2"));
    }

    #[test]
    fn defaults_apply_only_when_spec_is_silent() {
        let mut d = KubeDefaults::new("ns");
        d.ingress_class = Some("traefik".into());
        d.image_pull_secret = Some("ghcr-pull".into());
        d.cluster_issuer = Some("letsencrypt".into());
        let mut s = AppSpec::new("a", "i:1");
        s.host = Some("a.example.com".into());
        let r = render(&s, &d);
        let ing = r.ingress.unwrap();
        assert_eq!(ing["spec"]["ingressClassName"], "traefik");
        // Pas de TLS demandé → pas d'annotation cert-manager.
        assert!(ing["metadata"].get("annotations").is_none());
        assert_eq!(
            r.deployment["spec"]["template"]["spec"]["imagePullSecrets"][0]["name"],
            "ghcr-pull"
        );
        s.ingress_class = Some("nginx".into());
        s.tls = Some(Default::default());
        let ing = render(&s, &d).ingress.unwrap();
        assert_eq!(ing["spec"]["ingressClassName"], "nginx");
        assert_eq!(
            ing["metadata"]["annotations"]["cert-manager.io/cluster-issuer"],
            "letsencrypt"
        );
        assert_eq!(ing["spec"]["tls"][0]["secretName"], "a-tls");
    }
}
