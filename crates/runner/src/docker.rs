use crate::compat::{with_compatible_extra_env, with_compatible_runner_version_lines};
use crate::models::{AuthMode, DockerContainerSnapshot, EnvEntry};
use devforge_shared::{DevForgeError, Result};

pub fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

pub fn slugify_runner_name(name: &str) -> String {
    let mut out = String::new();
    for c in name.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if c == '-' || c == '_' || c == '.' {
            out.push('-');
        } else if c.is_whitespace() {
            out.push('-');
        }
    }
    while out.contains("--") {
        out = out.replace("--", "-");
    }
    out.trim_matches('-').to_string()
}

pub fn assert_valid_container_name(name: &str) -> Result<()> {
    if name.is_empty() || name.len() > 64 {
        return Err(DevForgeError::Message("nom de conteneur invalide".into()));
    }
    let ok = name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.');
    if !ok || name.starts_with('-') || name.starts_with('.') {
        return Err(DevForgeError::Message("nom de conteneur invalide".into()));
    }
    Ok(())
}

pub fn assert_safe_volume_mount(volume: &str) -> Result<()> {
    let parts: Vec<&str> = volume.split(':').collect();
    if parts.len() < 2 || parts.len() > 3 {
        return Err(DevForgeError::Message(
            "volume invalide — format /host:/container[:ro|rw]".into(),
        ));
    }
    let host = parts[0];
    let container = parts[1];
    let mode = parts.get(2).copied();
    if host.is_empty()
        || container.is_empty()
        || !host.starts_with('/')
        || !container.starts_with('/')
    {
        return Err(DevForgeError::Message(
            "chemins host/conteneur doivent être absolus".into(),
        ));
    }
    if host.contains("..") || container.contains("..") {
        return Err(DevForgeError::Message(
            "les chemins de volume ne doivent pas contenir « .. »".into(),
        ));
    }
    if let Some(m) = mode {
        if m != "ro" && m != "rw" {
            return Err(DevForgeError::Message(
                "mode de volume invalide (ro|rw)".into(),
            ));
        }
    }
    let is_docker_sock = host.contains("docker.sock") || volume.contains("docker.sock");
    if !is_docker_sock {
        for prefix in [
            "/etc", "/root", "/boot", "/proc", "/sys", "/dev", "/var/run",
        ] {
            if host == prefix || host.starts_with(&format!("{prefix}/")) {
                return Err(DevForgeError::Message(format!(
                    "le montage de {prefix} est interdit"
                )));
            }
        }
    }
    Ok(())
}

pub fn image_treats_access_token_as_pat(image: &str) -> bool {
    image.to_lowercase().contains("myoung34")
}

pub fn auth_environment_variables(
    image: &str,
    auth_mode: AuthMode,
    auth_token: &str,
) -> Vec<(String, String)> {
    match auth_mode {
        AuthMode::Pat => vec![
            ("ACCESS_TOKEN".into(), auth_token.into()),
            ("PAT_TOKEN".into(), auth_token.into()),
        ],
        AuthMode::Registration if image_treats_access_token_as_pat(image) => {
            vec![("RUNNER_TOKEN".into(), auth_token.into())]
        }
        AuthMode::Registration => vec![
            ("RUNNER_TOKEN".into(), auth_token.into()),
            ("ACCESS_TOKEN".into(), auth_token.into()),
            ("PAT_TOKEN".into(), auth_token.into()),
        ],
    }
}

/// Volume Docker qui conserve la configuration du runner (`.runner`, `.credentials`…).
pub fn runner_state_volume(container_name: &str) -> String {
    format!("{container_name}-state")
}

/// Supprime le volume d'état (recréation / suppression → nouvel enregistrement propre).
pub fn docker_rm_state_volume_cmd(container_name: &str) -> String {
    format!(
        "docker volume rm -f {} >/dev/null 2>&1 || true",
        shell_escape(&runner_state_volume(container_name))
    )
}

/// Image myoung34 : réutiliser la config entre redémarrages.
///
/// Incident 2026-09-25 : tous les runners en boucle « Cannot configure the runner because
/// it is already configured » (+ « configuredSettings null »). Le jeton d'enregistrement
/// (valable 1 h) est figé dans l'env ; à chaque redémarrage l'entrypoint relançait
/// `config.sh` sur un `.runner` resté dans la couche du conteneur, puis la
/// désinscription échouait. Avec `CONFIGURED_ACTIONS_RUNNER_FILES_DIR` sur un volume et
/// sans désinscription automatique, l'entrypoint reprend la config existante.
fn runner_reuse_env(image: &str, extra_env: &[EnvEntry]) -> Vec<(String, String)> {
    if !image_treats_access_token_as_pat(image) {
        return vec![];
    }
    let has = |k: &str| extra_env.iter().any(|e| e.key.eq_ignore_ascii_case(k));
    let mut out = vec![];
    if !has("CONFIGURED_ACTIONS_RUNNER_FILES_DIR") {
        out.push((
            "CONFIGURED_ACTIONS_RUNNER_FILES_DIR".into(),
            RUNNER_STATE_DIR.into(),
        ));
    }
    if !has("DISABLE_AUTOMATIC_DEREGISTRATION") {
        out.push(("DISABLE_AUTOMATIC_DEREGISTRATION".into(), "true".into()));
    }
    out
}

const RUNNER_STATE_DIR: &str = "/runner-state";

pub fn build_docker_run_command(
    container_name: &str,
    image: &str,
    repo_url: &str,
    runner_name: &str,
    auth_token: &str,
    auth_mode: AuthMode,
    labels: &str,
    network_mode: &str,
    timezone: &str,
    replace_existing: bool,
    volumes: &[String],
    extra_env: &[EnvEntry],
) -> Result<String> {
    assert_valid_container_name(container_name)?;
    for v in volumes {
        assert_safe_volume_mount(v)?;
    }

    let mut parts = vec![
        "docker run -d".into(),
        format!("--name {}", shell_escape(container_name)),
        "--restart unless-stopped".into(),
        "--privileged".into(),
        format!("--network {}", shell_escape(network_mode)),
        "-v /var/run/docker.sock:/var/run/docker.sock".into(),
    ];

    for volume in volumes {
        parts.push(format!("-v {}", shell_escape(volume)));
    }
    let reuse_env = runner_reuse_env(image, extra_env);
    if reuse_env
        .iter()
        .any(|(k, v)| k == "CONFIGURED_ACTIONS_RUNNER_FILES_DIR" && v == RUNNER_STATE_DIR)
    {
        parts.push(format!(
            "-v {}",
            shell_escape(&format!(
                "{}:{RUNNER_STATE_DIR}",
                runner_state_volume(container_name)
            ))
        ));
    }

    let env_pairs = [
        ("REPO_URL", repo_url),
        ("RUNNER_URL", repo_url),
        ("RUNNER_NAME", runner_name),
        ("RUNNER_SCOPE", "repo"),
        ("LABELS", labels),
        ("RUNNER_LABELS", labels),
        ("RUNNER_WORKDIR", "/tmp/runner/work"),
        ("TZ", timezone),
        (
            "RUNNER_REPLACE_EXISTING",
            if replace_existing { "true" } else { "false" },
        ),
    ];
    for (k, v) in env_pairs {
        parts.push(format!("-e {}", shell_escape(&format!("{k}={v}"))));
    }

    for (k, v) in auth_environment_variables(image, auth_mode, auth_token) {
        parts.push(format!("-e {}", shell_escape(&format!("{k}={v}"))));
    }
    for (k, v) in &reuse_env {
        parts.push(format!("-e {}", shell_escape(&format!("{k}={v}"))));
    }

    let extra = with_compatible_extra_env(extra_env.to_vec());
    for e in &extra {
        parts.push(format!(
            "-e {}",
            shell_escape(&format!("{}={}", e.key, e.value))
        ));
    }

    parts.push(format!(
        "--label {}",
        shell_escape("com.devforge.runner=true")
    ));
    parts.push(format!(
        "--label {}",
        shell_escape(&format!("com.devforge.runner.repo_url={repo_url}"))
    ));
    parts.push(format!(
        "--label {}",
        shell_escape(&format!("com.devforge.runner.name={runner_name}"))
    ));
    parts.push(format!(
        "--label {}",
        shell_escape(&format!(
            "com.devforge.runner.auth_mode={}",
            auth_mode.as_str()
        ))
    ));
    parts.push(format!("--label {}", shell_escape("devforge.managed=true")));
    parts.push(format!("--label {}", shell_escape("devforge.type=service")));
    parts.push(shell_escape(image));

    Ok(parts.join(" "))
}

/// `{{json .}}` fait calculer la taille de chaque conteneur par le daemon : ~20 s par
/// appel sur le NAS, au-delà du timeout de découverte (25 s) → tous les runners
/// affichés « missing ». On ne sérialise que les champs utiles.
const DISCOVERY_FORMAT: &str = r#"{"ID":{{json .ID}},"Names":{{json .Names}},"Image":{{json .Image}},"State":{{json .State}},"Status":{{json .Status}},"Labels":{{json .Labels}}}"#;

pub fn discovery_command() -> String {
    format!(
        "docker ps -a --filter label=com.devforge.runner=true --format '{f}' ; docker ps -a --filter name=github-runner --format '{f}'",
        f = DISCOVERY_FORMAT
    )
}

pub fn parse_docker_ps_json_lines(raw: &str) -> Vec<DockerContainerSnapshot> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() || !line.starts_with('{') {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let name_raw = v
            .get("Names")
            .or_else(|| v.get("Name"))
            .and_then(|n| n.as_str())
            .unwrap_or("")
            .trim_start_matches('/');
        let name = name_raw
            .split(|c: char| c == ',' || c.is_whitespace())
            .next()
            .unwrap_or("")
            .trim_start_matches('/')
            .to_string();
        if name.is_empty() || !seen.insert(name.clone()) {
            continue;
        }
        if !is_github_runner_container(&v, &name) {
            continue;
        }
        let labels = v
            .get("Labels")
            .and_then(|l| l.as_str())
            .unwrap_or("")
            .to_string();
        let state = v
            .get("State")
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_lowercase();
        let status = v
            .get("Status")
            .and_then(|s| s.as_str())
            .unwrap_or(&state)
            .to_string();
        out.push(DockerContainerSnapshot {
            name: name.clone(),
            container_id: v
                .get("ID")
                .or_else(|| v.get("Id"))
                .and_then(|i| i.as_str())
                .unwrap_or("")
                .to_string(),
            image: v
                .get("Image")
                .and_then(|i| i.as_str())
                .unwrap_or("")
                .to_string(),
            state: if state.is_empty() {
                infer_state_from_status(&status)
            } else {
                state
            },
            status,
            repo_url: extract_label(&labels, "com.devforge.runner.repo_url")
                .or_else(|| extract_label(&labels, "repo_url")),
            runner_name: extract_label(&labels, "com.devforge.runner.name")
                .or_else(|| extract_label(&labels, "runner_name"))
                .or(Some(name)),
        });
    }
    out
}

fn is_github_runner_container(v: &serde_json::Value, name: &str) -> bool {
    let name_l = name.to_lowercase();
    let image = v
        .get("Image")
        .and_then(|i| i.as_str())
        .unwrap_or("")
        .to_lowercase();
    let labels = v
        .get("Labels")
        .and_then(|l| l.as_str())
        .unwrap_or("")
        .to_lowercase();
    if name_l.contains("github-runner") || name_l.contains("actions-runner") {
        return true;
    }
    if image.contains("github-runner")
        || image.contains("github-actions-runner")
        || image.contains("actions-runner")
    {
        return true;
    }
    labels.contains("com.devforge.runner=true")
        || labels.contains("github-runners")
        || labels.contains("github.actions.runner")
}

fn extract_label(labels: &str, key: &str) -> Option<String> {
    for pair in labels.split(',') {
        let mut parts = pair.splitn(2, '=');
        let k = parts.next()?.trim();
        let v = parts.next()?.trim();
        if k.eq_ignore_ascii_case(key) && !v.is_empty() {
            return Some(v.to_string());
        }
    }
    None
}

fn infer_state_from_status(status: &str) -> String {
    let lower = status.to_lowercase();
    if lower.starts_with("up") {
        "running".into()
    } else if lower.starts_with("exited") {
        "exited".into()
    } else if lower.starts_with("created") {
        "created".into()
    } else if lower.starts_with("restarting") {
        "restarting".into()
    } else if lower.starts_with("paused") {
        "paused".into()
    } else if lower.starts_with("dead") {
        "dead".into()
    } else if lower.is_empty() {
        "unknown".into()
    } else {
        lower
    }
}

pub fn docker_start_cmd(name: &str) -> String {
    format!("docker start {}", shell_escape(name))
}

pub fn docker_stop_cmd(name: &str) -> String {
    format!("docker stop {}", shell_escape(name))
}

pub fn docker_restart_cmd(name: &str) -> String {
    format!("docker restart {}", shell_escape(name))
}

pub fn docker_rm_cmd(name: &str) -> String {
    format!("docker rm -f {}", shell_escape(name))
}

pub fn docker_pull_cmd(image: &str) -> String {
    format!("docker pull {}", shell_escape(image))
}

pub fn docker_logs_cmd(name: &str, lines: usize) -> String {
    format!(
        "docker logs --tail {} {}",
        lines.clamp(10, 1000),
        shell_escape(name)
    )
}

pub fn docker_inspect_running_cmd(name: &str) -> String {
    format!(
        "docker inspect -f '{{{{.State.Running}}}}' {} 2>/dev/null || true",
        shell_escape(name)
    )
}

pub fn docker_inspect_json_cmd(name: &str) -> String {
    format!(
        "docker inspect {} --format '{{{{json .}}}}'",
        shell_escape(name)
    )
}

pub fn stale_network_cleanup(container_name: &str, network_mode: &str) -> String {
    let mut nets = vec![network_mode, "bridge", "host"];
    nets.sort_unstable();
    nets.dedup();
    nets.into_iter()
        .filter(|n| !n.is_empty() && *n != "none")
        .map(|n| {
            format!(
                "docker network disconnect -f {} {} >/dev/null 2>&1 || true",
                shell_escape(n),
                shell_escape(container_name)
            )
        })
        .collect::<Vec<_>>()
        .join(" ; ")
}

pub fn mask_sensitive_env_key(key: &str) -> bool {
    const SENSITIVE: &[&str] = &[
        "ACCESS_TOKEN",
        "RUNNER_TOKEN",
        "GITHUB_TOKEN",
        "TOKEN",
        "PASSWORD",
        "SECRET",
        "PRIVATE_KEY",
    ];
    let upper = key.to_uppercase();
    SENSITIVE
        .iter()
        .any(|n| upper == *n || upper.ends_with(&format!("_{n}")))
}

pub fn parse_inspect_env(inspect: &serde_json::Value) -> Vec<EnvEntry> {
    let mut out = Vec::new();
    let Some(arr) = inspect.pointer("/Config/Env").and_then(|v| v.as_array()) else {
        return out;
    };
    for line in arr {
        let Some(s) = line.as_str() else { continue };
        let Some((k, v)) = s.split_once('=') else {
            continue;
        };
        out.push(EnvEntry {
            key: k.to_string(),
            value: if mask_sensitive_env_key(k) {
                "••••••••".into()
            } else {
                v.to_string()
            },
        });
    }
    out
}

/// Rebuild docker run from inspect (for unmanaged recreate), bumping RUNNER_VERSION.
pub fn build_docker_run_from_inspect(
    inspect: &serde_json::Value,
    container_name: &str,
) -> Result<String> {
    assert_valid_container_name(container_name)?;
    let image = inspect
        .pointer("/Config/Image")
        .or_else(|| inspect.get("Image"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if image.is_empty() {
        return Err(DevForgeError::Message(
            "image Docker invalide pour la recréation".into(),
        ));
    }
    let mut network_mode = inspect
        .pointer("/HostConfig/NetworkMode")
        .and_then(|v| v.as_str())
        .unwrap_or("bridge")
        .to_string();
    if network_mode.is_empty() {
        network_mode = "bridge".into();
    }
    let restart = inspect
        .pointer("/HostConfig/RestartPolicy/Name")
        .and_then(|v| v.as_str())
        .unwrap_or("unless-stopped");
    let restart = match restart {
        "no" | "always" | "unless-stopped" | "on-failure" => restart,
        _ => "unless-stopped",
    };

    let mut parts = vec![
        "docker run -d".into(),
        format!("--name {}", shell_escape(container_name)),
        format!("--restart {}", shell_escape(restart)),
        format!("--network {}", shell_escape(&network_mode)),
    ];
    if inspect
        .pointer("/HostConfig/Privileged")
        .and_then(|v| v.as_bool())
        .unwrap_or(true)
    {
        parts.push("--privileged".into());
    }

    if let Some(binds) = inspect
        .pointer("/HostConfig/Binds")
        .and_then(|v| v.as_array())
    {
        for b in binds {
            let Some(s) = b.as_str() else { continue };
            if !s.contains("docker.sock") {
                assert_safe_volume_mount(s)?;
            }
            parts.push(format!("-v {}", shell_escape(s)));
        }
    }

    let env_lines: Vec<String> = inspect
        .pointer("/Config/Env")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    for line in with_compatible_runner_version_lines(env_lines) {
        if let Some((key, _)) = line.split_once('=') {
            if key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
                parts.push(format!("-e {}", shell_escape(&line)));
            }
        }
    }

    if let Some(labels) = inspect
        .pointer("/Config/Labels")
        .and_then(|v| v.as_object())
    {
        for (k, v) in labels {
            let val = v.as_str().unwrap_or("");
            parts.push(format!("--label {}", shell_escape(&format!("{k}={val}"))));
        }
    }

    parts.push(shell_escape(image));
    Ok(parts.join(" "))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::AuthMode;

    #[test]
    fn builds_docker_run_with_custom_image_and_volume() {
        let cmd = build_docker_run_command(
            "github-runner-ci",
            "ghcr.io/example/custom-runner:1",
            "https://github.com/acme/app",
            "ci-1",
            "REGTOKEN",
            AuthMode::Registration,
            "self-hosted,devforge",
            "bridge",
            "UTC",
            true,
            &["/data/cache:/cache:rw".into()],
            &[],
        )
        .unwrap();
        assert!(cmd.contains("ghcr.io/example/custom-runner:1"));
        assert!(cmd.contains("com.devforge.runner=true"));
        assert!(cmd.contains("/data/cache:/cache:rw"));
        assert!(cmd.contains("RUNNER_TOKEN=REGTOKEN"));
    }

    #[test]
    fn myoung34_runner_reuses_config_from_state_volume() {
        let cmd = build_docker_run_command(
            "github-runner-app",
            "myoung34/github-runner:latest",
            "https://github.com/acme/app",
            "app-runner",
            "REGTOKEN",
            AuthMode::Registration,
            "self-hosted,devforge",
            "bridge",
            "UTC",
            true,
            &[],
            &[],
        )
        .unwrap();
        assert!(
            cmd.contains("github-runner-app-state:/runner-state"),
            "{cmd}"
        );
        assert!(cmd.contains("CONFIGURED_ACTIONS_RUNNER_FILES_DIR=/runner-state"));
        assert!(cmd.contains("DISABLE_AUTOMATIC_DEREGISTRATION=true"));
        // Autre image : pas d'injection.
        let other = build_docker_run_command(
            "github-runner-ci",
            "ghcr.io/example/custom-runner:1",
            "https://github.com/acme/app",
            "ci-1",
            "REGTOKEN",
            AuthMode::Registration,
            "self-hosted",
            "bridge",
            "UTC",
            true,
            &[],
            &[],
        )
        .unwrap();
        assert!(!other.contains("runner-state"));
        assert_eq!(
            docker_rm_state_volume_cmd("github-runner-app"),
            "docker volume rm -f 'github-runner-app-state' >/dev/null 2>&1 || true"
        );
    }

    #[test]
    fn discovery_avoids_size_computation_and_parses() {
        let cmd = discovery_command();
        assert!(!cmd.contains("{{json .}}"), "{cmd}");
        let line = r#"{"ID":"eb756ad51fe5","Names":"github-runner-tesla-527f-runner","Image":"myoung34/github-runner:latest","State":"running","Status":"Up 2 minutes","Labels":"com.devforge.runner=true,com.devforge.runner.name=tesla-527f-runner"}"#;
        let got = parse_docker_ps_json_lines(line);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].name, "github-runner-tesla-527f-runner");
        assert_eq!(got[0].state, "running");
        assert_eq!(got[0].runner_name.as_deref(), Some("tesla-527f-runner"));
    }

    #[test]
    fn rejects_unsafe_volume() {
        assert!(assert_safe_volume_mount("/etc/passwd:/x:ro").is_err());
        assert!(assert_safe_volume_mount("/var/run/docker.sock:/var/run/docker.sock").is_ok());
    }
}
