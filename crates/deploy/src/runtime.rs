//! Runtime options applied at `docker run` (ports, sidecars, limits, healthcheck).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PublishedPort {
    pub host: u16,
    pub container: u16,
    #[serde(default = "tcp")]
    pub protocol: String,
}

fn tcp() -> String {
    "tcp".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HealthcheckSpec {
    pub cmd: String,
    #[serde(default = "default_interval")]
    pub interval: String,
    #[serde(default = "default_timeout")]
    pub timeout: String,
    #[serde(default = "default_retries")]
    pub retries: u32,
    #[serde(default = "default_start")]
    pub start_period: String,
}

fn default_interval() -> String {
    "30s".into()
}
fn default_timeout() -> String {
    "10s".into()
}
fn default_retries() -> u32 {
    5
}
fn default_start() -> String {
    "2m".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SidecarSpec {
    pub name: String,
    pub image: String,
    #[serde(default)]
    pub ports: Vec<PublishedPort>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub memory: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct RuntimeSpec {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub memory: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cpus: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub healthcheck: Option<HealthcheckSpec>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ports: Vec<PublishedPort>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sidecars: Vec<SidecarSpec>,
}

/// Flags passed to one `docker run` (app or sidecar).
#[derive(Debug, Clone, Default)]
pub struct RunTune {
    pub extra_ports: Vec<PublishedPort>,
    pub memory: Option<String>,
    pub cpus: Option<String>,
    pub healthcheck: Option<HealthcheckSpec>,
    pub network_alias: Option<String>,
}

impl RunTune {
    pub fn from_runtime(spec: &RuntimeSpec) -> Self {
        Self {
            extra_ports: spec.ports.clone(),
            memory: spec.memory.clone(),
            cpus: spec.cpus.clone(),
            healthcheck: spec.healthcheck.clone(),
            network_alias: None,
        }
    }

    pub fn for_sidecar(spec: &SidecarSpec) -> Self {
        Self {
            extra_ports: spec.ports.clone(),
            memory: spec.memory.clone(),
            cpus: None,
            healthcheck: None,
            network_alias: Some(spec.name.clone()),
        }
    }
}

impl PublishedPort {
    pub fn publish_flag(&self) -> String {
        if self.protocol == "udp" {
            format!("{}:{}/udp", self.host, self.container)
        } else {
            format!("{}:{}", self.host, self.container)
        }
    }
}

impl RuntimeSpec {
    pub fn from_json(raw: &str) -> Result<Self, String> {
        let raw = raw.trim();
        if raw.is_empty() || raw == "null" {
            return Ok(Self::default());
        }
        let mut spec: Self = serde_json::from_str(raw).map_err(|e| format!("runtime JSON: {e}"))?;
        spec.normalize()?;
        Ok(spec)
    }

    pub fn normalize(&mut self) -> Result<(), String> {
        if let Some(mem) = self.memory.as_mut() {
            *mem = mem.trim().to_string();
            if mem.is_empty() {
                self.memory = None;
            } else if !valid_memory(mem) {
                return Err(format!("mémoire invalide ({mem}) — ex. 512m ou 20g"));
            }
        }
        if let Some(cpus) = self.cpus.as_mut() {
            *cpus = cpus.trim().to_string();
            if cpus.is_empty() {
                self.cpus = None;
            } else if !valid_cpus(cpus) {
                return Err(format!("cpus invalide ({cpus}) — ex. 1 ou 0.5"));
            }
        }
        if let Some(hc) = self.healthcheck.as_mut() {
            hc.cmd = hc.cmd.trim().to_string();
            if hc.cmd.is_empty() {
                self.healthcheck = None;
            } else {
                validate_health_cmd(&hc.cmd)?;
                if hc.interval.trim().is_empty() {
                    hc.interval = default_interval();
                }
                if hc.timeout.trim().is_empty() {
                    hc.timeout = default_timeout();
                }
                if hc.start_period.trim().is_empty() {
                    hc.start_period = default_start();
                }
                validate_duration(&hc.interval, "interval")?;
                validate_duration(&hc.timeout, "timeout")?;
                validate_duration(&hc.start_period, "start_period")?;
                if hc.retries == 0 || hc.retries > 20 {
                    return Err("retries healthcheck entre 1 et 20".into());
                }
            }
        }
        for port in &mut self.ports {
            normalize_port(port)?;
        }
        let mut names = Vec::new();
        for side in &mut self.sidecars {
            side.name = side.name.trim().to_ascii_lowercase();
            side.image = side.image.trim().to_string();
            validate_sidecar_name(&side.name)?;
            validate_image(&side.image)?;
            if names.contains(&side.name) {
                return Err(format!("sidecar {} en double", side.name));
            }
            names.push(side.name.clone());
            if let Some(mem) = side.memory.as_mut() {
                *mem = mem.trim().to_string();
                if mem.is_empty() {
                    side.memory = None;
                } else if !valid_memory(mem) {
                    return Err(format!("mémoire sidecar {} invalide", side.name));
                }
            }
            for port in &mut side.ports {
                normalize_port(port)?;
            }
        }
        Ok(())
    }
}

/// `true` si ce code HTTP prouve que le port du projet a répondu.
/// Même règle pour un site et pour un serveur : 401 ou 404 comptent.
pub fn app_http_is_up(code: u16) -> bool {
    (100..600).contains(&code)
}

fn normalize_port(port: &mut PublishedPort) -> Result<(), String> {
    if port.host == 0 || port.container == 0 {
        return Err("port 0 refusé".into());
    }
    port.protocol = port.protocol.trim().to_ascii_lowercase();
    if port.protocol.is_empty() {
        port.protocol = "tcp".into();
    }
    if port.protocol != "tcp" && port.protocol != "udp" {
        return Err(format!("protocole {} — tcp ou udp", port.protocol));
    }
    Ok(())
}

fn validate_sidecar_name(name: &str) -> Result<(), String> {
    let ok = !name.is_empty()
        && name.len() <= 32
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && name.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
        && !name.ends_with('-');
    if ok {
        Ok(())
    } else {
        Err(format!(
            "nom de service invalide ({name}) — lettres minuscules, chiffres, tirets"
        ))
    }
}

fn validate_image(image: &str) -> Result<(), String> {
    if image.is_empty() || image.len() > 200 {
        return Err("image Docker manquante".into());
    }
    if image.chars().any(|c| {
        c.is_whitespace() || matches!(c, ';' | '&' | '|' | '`' | '$' | '"' | '\'' | '\\' | '<' | '>')
    }) {
        return Err(format!("image Docker refusée ({image})"));
    }
    Ok(())
}

fn validate_health_cmd(cmd: &str) -> Result<(), String> {
    if cmd.len() > 500 || cmd.chars().any(|c| c == '\n' || c == '\r' || c == '`') {
        return Err("commande healthcheck refusée".into());
    }
    Ok(())
}

fn validate_duration(raw: &str, label: &str) -> Result<(), String> {
    let s = raw.trim();
    let digits: String = s.chars().take_while(|c| c.is_ascii_digit()).collect();
    let unit = &s[digits.len()..];
    if digits.is_empty() || !matches!(unit, "ms" | "s" | "m" | "h") {
        return Err(format!("{label} invalide ({raw}) — ex. 30s, 2m"));
    }
    Ok(())
}

fn valid_memory(raw: &str) -> bool {
    let s = raw.trim().to_ascii_lowercase();
    let (num, unit) = split_number(&s);
    if num.is_empty() {
        return false;
    }
    matches!(unit, "" | "b" | "k" | "kb" | "m" | "mb" | "g" | "gb")
}

fn valid_cpus(raw: &str) -> bool {
    let (num, unit) = split_number(raw.trim());
    !num.is_empty() && unit.is_empty() && num != "."
}

fn split_number(s: &str) -> (&str, &str) {
    let mut end = 0;
    let mut dot = false;
    for (i, c) in s.char_indices() {
        if c.is_ascii_digit() {
            end = i + 1;
        } else if c == '.' && !dot {
            dot = true;
            end = i + 1;
        } else {
            break;
        }
    }
    (&s[..end], &s[end..])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn popcorn_runtime_normalizes() {
        let raw = r#"{
            "memory": "20g",
            "cpus": "1",
            "healthcheck": {"cmd": "curl -f http://localhost:3000/api/client/health || exit 1"},
            "ports": [
                {"host": 4240, "container": 4240, "protocol": "tcp"},
                {"host": 4240, "container": 4240, "protocol": "udp"}
            ],
            "sidecars": [{
                "name": "flaresolverr",
                "image": "flaresolverr/flaresolverr:latest",
                "ports": [{"host": 9191, "container": 9191, "protocol": "tcp"}],
                "memory": "4g"
            }]
        }"#;
        let spec = RuntimeSpec::from_json(raw).unwrap();
        assert_eq!(spec.memory.as_deref(), Some("20g"));
        assert_eq!(spec.healthcheck.as_ref().unwrap().interval, "30s");
        assert_eq!(spec.ports[1].publish_flag(), "4240:4240/udp");
        assert_eq!(spec.sidecars[0].name, "flaresolverr");
        assert!(app_http_is_up(200));
        assert!(app_http_is_up(404));
        assert!(app_http_is_up(401));
        assert!(!app_http_is_up(0));
    }

    #[test]
    fn rejects_bad_sidecar_name() {
        let raw = r#"{"sidecars":[{"name":"Bad Name","image":"x:1"}]}"#;
        assert!(RuntimeSpec::from_json(raw).is_err());
    }
}
