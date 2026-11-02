//! Description d'une app « image » déployable (entrée de l'API `/api/v1/kube/apps`).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// Longueur max du nom d'app : laisse la place aux suffixes (`-env`, `-tls`) sous 63.
pub const MAX_NAME_LEN: usize = 40;
pub const MAX_REPLICAS: i32 = 20;

fn default_port() -> u16 {
    8080
}
fn default_replicas() -> i32 {
    1
}
fn default_true() -> bool {
    true
}

/// TLS de l'Ingress. `secret_name` absent → `<app>-tls`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct TlsSpec {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secret_name: Option<String>,
    /// Annotation `cert-manager.io/cluster-issuer` (si cert-manager est installé).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cluster_issuer: Option<String>,
}

/// Sondes HTTP (`path`) ou TCP (pas de `path`) sur le port de l'app.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct HealthSpec {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub initial_delay_seconds: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub period_seconds: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure_threshold: Option<i32>,
}

/// Limites (même syntaxe que le runtime Docker : `512m`, `2g`, `0.5`) ou quantités k8s.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct ResourceSpec {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub memory: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cpus: Option<String>,
}

/// App à déployer depuis une image déjà construite.
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppSpec {
    /// Nom DNS-1123 (`[a-z0-9-]`, ≤ 40) : nom du Deployment / Service / Ingress.
    pub name: String,
    /// Référence d'image complète, ex. `ghcr.io/owner/app:sha-abc1234`.
    pub image: String,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default = "default_replicas")]
    pub replicas: i32,
    /// Nom d'hôte public → Ingress. Absent → Service interne seulement.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tls: Option<TlsSpec>,
    /// Variables non sensibles (en clair dans le Deployment).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub env: BTreeMap<String, String>,
    /// Variables sensibles → `Secret` `<app>-env`. Jamais renvoyées par l'API.
    #[serde(default, skip_serializing)]
    pub secrets: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub health: Option<HealthSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resources: Option<ResourceSpec>,
    /// Secret `kubernetes.io/dockerconfigjson` pour un registre privé (GHCR…).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_pull_secret: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ingress_class: Option<String>,
    /// `securityContext.runAsNonRoot` (compatible PodSecurity `restricted`).
    #[serde(default = "default_true")]
    pub run_as_non_root: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_as_user: Option<i64>,
    /// Lien optionnel vers un projet DevForge (label `devforge.io/project`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_uuid: Option<String>,
    /// Projet (slug DNS) : en mode `per-project`, l'app vit dans le namespace
    /// `<préfixe><projet>` (ex. `devforge-blog`). Absent → namespace par défaut.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
}

/// Référence d'une app existante : nom + projet (namespace).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppRef {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
}

impl AppRef {
    pub fn new(name: impl Into<String>, project: Option<&str>) -> Self {
        Self {
            name: name.into(),
            project: project
                .map(|p| p.trim().to_string())
                .filter(|p| !p.is_empty()),
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        if !is_dns_label(&self.name) || self.name.len() > MAX_NAME_LEN {
            return Err(format!("nom d'app invalide ({})", self.name));
        }
        validate_project(self.project.as_deref())
    }
}

/// Slug de projet : label DNS, `MAX_NAME_LEN` caractères max (préfixe ≤ 20 → namespace ≤ 63).
pub fn validate_project(project: Option<&str>) -> Result<(), String> {
    match project {
        Some(p) if !is_dns_label(p) || p.len() > MAX_NAME_LEN => Err(format!(
            "projet invalide ({p}) — minuscules, chiffres et '-', {MAX_NAME_LEN} caractères max"
        )),
        _ => Ok(()),
    }
}

impl std::fmt::Debug for AppSpec {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AppSpec")
            .field("name", &self.name)
            .field("image", &self.image)
            .field("port", &self.port)
            .field("replicas", &self.replicas)
            .field("host", &self.host)
            .field("tls", &self.tls)
            .field("env", &self.env)
            .field("secrets", &self.secrets.keys().collect::<Vec<_>>())
            .field("health", &self.health)
            .field("resources", &self.resources)
            .field("image_pull_secret", &self.image_pull_secret)
            .field("ingress_class", &self.ingress_class)
            .field("run_as_non_root", &self.run_as_non_root)
            .field("run_as_user", &self.run_as_user)
            .field("project_uuid", &self.project_uuid)
            .field("project", &self.project)
            .finish()
    }
}

impl AppSpec {
    /// Spec minimale (tests, exemples).
    pub fn new(name: impl Into<String>, image: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            image: image.into(),
            port: default_port(),
            replicas: default_replicas(),
            host: None,
            tls: None,
            env: BTreeMap::new(),
            secrets: BTreeMap::new(),
            health: None,
            resources: None,
            image_pull_secret: None,
            ingress_class: None,
            run_as_non_root: true,
            run_as_user: None,
            project_uuid: None,
            project: None,
        }
    }

    pub fn app_ref(&self) -> AppRef {
        AppRef::new(&self.name, self.project.as_deref())
    }

    pub fn secret_name(&self) -> String {
        format!("{}-env", self.name)
    }

    pub fn tls_secret_name(&self) -> Option<String> {
        self.tls.as_ref().map(|t| {
            t.secret_name
                .clone()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| format!("{}-tls", self.name))
        })
    }

    /// Normalise (trim, vides → None) puis valide. Erreurs en français.
    pub fn normalize(&mut self) -> Result<(), String> {
        self.name = self.name.trim().to_string();
        self.image = self.image.trim().to_string();
        trim_opt(&mut self.host);
        trim_opt(&mut self.image_pull_secret);
        trim_opt(&mut self.ingress_class);
        trim_opt(&mut self.project_uuid);
        trim_opt(&mut self.project);
        if let Some(p) = self.project.as_mut() {
            *p = p.to_ascii_lowercase();
        }
        if let Some(h) = self.host.as_mut() {
            *h = h.to_ascii_lowercase();
        }
        if let Some(tls) = self.tls.as_mut() {
            trim_opt(&mut tls.secret_name);
            trim_opt(&mut tls.cluster_issuer);
        }
        if let Some(health) = self.health.as_mut() {
            trim_opt(&mut health.path);
        }
        if let Some(res) = self.resources.as_mut() {
            trim_opt(&mut res.memory);
            trim_opt(&mut res.cpus);
        }
        self.validate()
    }

    pub fn validate(&self) -> Result<(), String> {
        if !is_dns_label(&self.name) || self.name.len() > MAX_NAME_LEN {
            return Err(format!(
                "nom d'app invalide ({}) — minuscules, chiffres et '-', {MAX_NAME_LEN} caractères max",
                self.name
            ));
        }
        validate_image(&self.image)?;
        validate_project(self.project.as_deref())?;
        if self.port == 0 {
            return Err("port invalide (1-65535)".into());
        }
        if !(0..=MAX_REPLICAS).contains(&self.replicas) {
            return Err(format!("replicas invalide (0-{MAX_REPLICAS})"));
        }
        if let Some(host) = &self.host {
            if !is_hostname(host) {
                return Err(format!("nom d'hôte invalide ({host})"));
            }
        }
        if self.tls.is_some() && self.host.is_none() {
            return Err("TLS demandé sans nom d'hôte (host)".into());
        }
        if let Some(tls) = &self.tls {
            if let Some(s) = &tls.secret_name {
                if !is_dns_subdomain(s) {
                    return Err(format!("secret TLS invalide ({s})"));
                }
            }
        }
        for key in self.env.keys().chain(self.secrets.keys()) {
            if !is_env_key(key) {
                return Err(format!("nom de variable invalide ({key})"));
            }
        }
        if let Some(dup) = self.env.keys().find(|k| self.secrets.contains_key(*k)) {
            return Err(format!("variable {dup} à la fois dans env et secrets"));
        }
        if let Some(p) = &self.image_pull_secret {
            if !is_dns_subdomain(p) {
                return Err(format!("image_pull_secret invalide ({p})"));
            }
        }
        if let Some(c) = &self.ingress_class {
            if !is_dns_subdomain(c) {
                return Err(format!("ingress_class invalide ({c})"));
            }
        }
        if let Some(health) = &self.health {
            if let Some(path) = &health.path {
                if !path.starts_with('/') || path.chars().any(|c| c.is_whitespace()) {
                    return Err(format!("chemin de santé invalide ({path}) — ex. /health"));
                }
            }
            for v in [
                health.initial_delay_seconds,
                health.period_seconds,
                health.failure_threshold,
            ]
            .into_iter()
            .flatten()
            {
                if !(0..=3600).contains(&v) {
                    return Err("sonde : valeurs entre 0 et 3600".into());
                }
            }
        }
        if let Some(res) = &self.resources {
            if let Some(m) = &res.memory {
                memory_quantity(m)?;
            }
            if let Some(c) = &res.cpus {
                cpu_quantity(c)?;
            }
        }
        if let Some(uid) = self.run_as_user {
            if self.run_as_non_root && uid == 0 {
                return Err("run_as_user=0 incompatible avec run_as_non_root".into());
            }
            if uid < 0 {
                return Err("run_as_user invalide".into());
            }
        }
        if let Some(p) = &self.project_uuid {
            if p.len() > 63
                || !p
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
            {
                return Err("project_uuid invalide".into());
            }
        }
        Ok(())
    }
}

fn trim_opt(v: &mut Option<String>) {
    if let Some(s) = v.as_mut() {
        *s = s.trim().to_string();
        if s.is_empty() {
            *v = None;
        }
    }
}

pub fn is_dns_label(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 63
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !s.starts_with('-')
        && !s.ends_with('-')
}

pub fn is_dns_subdomain(s: &str) -> bool {
    !s.is_empty() && s.len() <= 253 && s.split('.').all(is_dns_label)
}

fn is_hostname(s: &str) -> bool {
    let s = s.strip_prefix("*.").unwrap_or(s);
    s.contains('.') && is_dns_subdomain(s)
}

fn is_env_key(s: &str) -> bool {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn validate_image(image: &str) -> Result<(), String> {
    if image.is_empty() {
        return Err("image manquante — ex. ghcr.io/owner/app:1.0.0".into());
    }
    if image.len() > 512
        || image
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || c == '\'' || c == '"')
    {
        return Err(format!("image invalide ({image})"));
    }
    Ok(())
}

/// `512m` / `2g` (syntaxe Docker, base 1024) → `512Mi` / `2Gi` ; `256Mi` / `1G` inchangés.
///
/// Attention : en k8s `512m` = 0,512 octet. On convertit donc toujours le suffixe Docker.
pub fn memory_quantity(raw: &str) -> Result<String, String> {
    let s = raw.trim();
    let err = || format!("mémoire invalide ({raw}) — ex. 512m, 2g, 256Mi");
    let digits_end = s.find(|c: char| !c.is_ascii_digit()).unwrap_or(s.len());
    let (num, unit) = s.split_at(digits_end);
    if num.is_empty() || num.parse::<u64>().ok().filter(|n| *n > 0).is_none() {
        return Err(err());
    }
    let unit = match unit {
        "b" | "B" | "" => "",
        "k" | "K" | "Ki" => "Ki",
        "m" | "M" | "Mi" => "Mi",
        "g" | "G" | "Gi" => "Gi",
        _ => return Err(err()),
    };
    Ok(format!("{num}{unit}"))
}

/// `0.5` / `2` / `500m` → quantité CPU k8s.
pub fn cpu_quantity(raw: &str) -> Result<String, String> {
    let s = raw.trim();
    let err = || format!("cpus invalide ({raw}) — ex. 0.5, 2 ou 500m");
    if let Some(milli) = s.strip_suffix('m') {
        return milli
            .parse::<u32>()
            .ok()
            .filter(|n| *n > 0)
            .map(|_| s.to_string())
            .ok_or_else(err);
    }
    match s.parse::<f64>() {
        Ok(v) if v > 0.0 && v <= 256.0 && !s.starts_with('.') && !s.ends_with('.') => {
            Ok(s.to_string())
        }
        _ => Err(err()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_trims_and_validates() {
        let mut s = AppSpec::new(" web ", " ghcr.io/o/web:1 ");
        s.host = Some(" App.Example.COM ".into());
        s.ingress_class = Some("  ".into());
        s.normalize().unwrap();
        assert_eq!(s.name, "web");
        assert_eq!(s.image, "ghcr.io/o/web:1");
        assert_eq!(s.host.as_deref(), Some("app.example.com"));
        assert_eq!(s.ingress_class, None);
    }

    #[test]
    fn rejects_bad_names_and_images() {
        for bad in ["", "Web", "-a", "a_b", &"x".repeat(41)] {
            let s = AppSpec::new(bad, "img:1");
            assert!(s.validate().is_err(), "{bad}");
        }
        assert!(AppSpec::new("a", "").validate().is_err());
        assert!(AppSpec::new("a", "img 1").validate().is_err());
        assert!(AppSpec::new("a", "img'1").validate().is_err());
    }

    #[test]
    fn rejects_tls_without_host_and_dup_env() {
        let mut s = AppSpec::new("a", "img:1");
        s.tls = Some(TlsSpec::default());
        assert!(s.validate().is_err());
        let mut s = AppSpec::new("a", "img:1");
        s.env.insert("TOKEN".into(), "x".into());
        s.secrets.insert("TOKEN".into(), "y".into());
        assert!(s.validate().unwrap_err().contains("TOKEN"));
        let mut s = AppSpec::new("a", "img:1");
        s.env.insert("1BAD".into(), "x".into());
        assert!(s.validate().is_err());
    }

    #[test]
    fn memory_conversion_never_emits_millibytes() {
        assert_eq!(memory_quantity("512m").unwrap(), "512Mi");
        assert_eq!(memory_quantity("2g").unwrap(), "2Gi");
        assert_eq!(memory_quantity("256Mi").unwrap(), "256Mi");
        assert_eq!(memory_quantity("1048576").unwrap(), "1048576");
        assert!(memory_quantity("0m").is_err());
        assert!(memory_quantity("abc").is_err());
        assert!(memory_quantity("1.5g").is_err());
    }

    #[test]
    fn cpu_quantities() {
        assert_eq!(cpu_quantity("0.5").unwrap(), "0.5");
        assert_eq!(cpu_quantity("500m").unwrap(), "500m");
        assert!(cpu_quantity("0").is_err());
        assert!(cpu_quantity("x").is_err());
        assert!(cpu_quantity(".5").is_err());
    }

    #[test]
    fn secrets_are_never_serialized_or_debug_printed() {
        let mut s = AppSpec::new("a", "img:1");
        s.secrets
            .insert("API_KEY".into(), "super-secret-value".into());
        let json = serde_json::to_string(&s).unwrap();
        assert!(!json.contains("super-secret-value"));
        assert!(!format!("{s:?}").contains("super-secret-value"));
        assert!(format!("{s:?}").contains("API_KEY"));
    }

    #[test]
    fn deserialize_defaults() {
        let s: AppSpec = serde_json::from_str(r#"{"name":"a","image":"i:1"}"#).unwrap();
        assert_eq!(s.port, 8080);
        assert_eq!(s.replicas, 1);
        assert!(s.run_as_non_root);
    }
}
