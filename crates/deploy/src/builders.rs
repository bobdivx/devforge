//! Build command helpers (Docker-first). Pure string builders — no I/O.

use crate::docker;

/// Default nixpacks builder image (override with `DEVFORGE_NIXPACKS_IMAGE`).
/// Pinned timestamp tag from ghcr.io/railwayapp/nixpacks (not floating `latest`).
pub const DEFAULT_NIXPACKS_IMAGE: &str = "ghcr.io/railwayapp/nixpacks:ubuntu-1788826008";

/// Env keys passed to nixpacks `--env` (build-time).
pub fn is_build_env_key(key: &str) -> bool {
    let k = key.trim();
    k.starts_with("PUPPETEER_")
        || k.starts_with("NODE_")
        || k.starts_with("NPM_")
        || k.starts_with("YARN_")
        || k.starts_with("PNPM_")
        || k == "CI"
        || k == "NODE_OPTIONS"
}

/// Parse project `.env` body → filtered build envs, always ensuring Puppeteer skip.
pub fn collect_build_envs(env_file: Option<&str>) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut has_puppeteer_skip = false;
    if let Some(body) = env_file {
        for line in body.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let Some((k, v)) = line.split_once('=') else {
                continue;
            };
            let k = k.trim();
            if k.is_empty() || !is_build_env_key(k) {
                continue;
            }
            let v = v
                .trim()
                .trim_matches('"')
                .trim_matches('\'')
                .to_string();
            if k == "PUPPETEER_SKIP_DOWNLOAD" || k == "PUPPETEER_SKIP_CHROMIUM_DOWNLOAD" {
                has_puppeteer_skip = true;
            }
            out.push((k.to_string(), v));
        }
    }
    if !has_puppeteer_skip {
        out.push(("PUPPETEER_SKIP_DOWNLOAD".into(), "1".into()));
        out.push(("PUPPETEER_SKIP_CHROMIUM_DOWNLOAD".into(), "1".into()));
    }
    out
}

fn nixpacks_image() -> String {
    std::env::var("DEVFORGE_NIXPACKS_IMAGE")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_NIXPACKS_IMAGE.to_string())
}

fn format_nixpacks_env_flags(build_envs: &[(String, String)]) -> String {
    let mut env_flags = String::new();
    for (k, v) in build_envs {
        env_flags.push_str(" --env ");
        env_flags.push_str(&format!("{}={}", shell_escape_token(k), shell_escape_token(v)));
    }
    env_flags
}

/// Nixpacks via Docker image — no host CLI required.
///
/// Forces `--entrypoint nixpacks` because some image tags have an empty
/// ENTRYPOINT (otherwise Docker tries to exec `build` → exit 127).
///
/// At runtime (Unix), prefers `--volumes-from` when DevForge runs nested with a
/// docker.sock (ZimaOS), otherwise bind-mounts `$PWD`. Decision is made on the
/// execution host so SSH remotes do not inherit a wrong `--volumes-from`.
pub fn nixpacks_docker_build(image: &str, build_envs: &[(String, String)]) -> String {
    let builder = nixpacks_image();
    let env_flags = format_nixpacks_env_flags(build_envs);
    // Hint for nested local executor (exported into the shell snippet).
    let self_hint = std::env::var("DEVFORGE_SELF_CONTAINER")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_default();

    // Common args after image: nixpacks subcommand (ENTRYPOINT forced below).
    let nix_args = format!(
        "build . --name {image}{env_flags}",
        image = shell_escape_token(image),
        env_flags = env_flags,
    );

    if cfg!(windows) {
        format!(
            "docker run --rm --entrypoint nixpacks -v \"{pwd}:/app\" -w /app {builder} {nix_args}",
            pwd = "$(Get-Location)",
            builder = shell_escape_token(&builder),
            nix_args = nix_args,
        )
    } else {
        format!(
            r#"SELF_CTR="{self_hint}"; \
if [ -z "$SELF_CTR" ] && [ -n "${{DEVFORGE_SELF_CONTAINER:-}}" ]; then SELF_CTR="$DEVFORGE_SELF_CONTAINER"; fi; \
if [ -n "$SELF_CTR" ] && docker inspect "$SELF_CTR" >/dev/null 2>&1; then \
  docker run --rm --entrypoint nixpacks -v /var/run/docker.sock:/var/run/docker.sock --volumes-from "$SELF_CTR" -w "$PWD" {builder} {nix_args}; \
elif [ -f /.dockerenv ] && docker inspect "$(hostname)" >/dev/null 2>&1; then \
  docker run --rm --entrypoint nixpacks -v /var/run/docker.sock:/var/run/docker.sock --volumes-from "$(hostname)" -w "$PWD" {builder} {nix_args}; \
else \
  docker run --rm --entrypoint nixpacks -v /var/run/docker.sock:/var/run/docker.sock -v "$PWD":/app -w /app {builder} {nix_args}; \
fi"#,
            self_hint = self_hint.replace('"', "").replace('`', "").replace('$', ""),
            builder = shell_escape_token(&builder),
            nix_args = nix_args,
        )
    }
}

/// Fallback when nixpacks-docker fails: project Dockerfile or hardened Node inline.
pub fn fallback_image_build_cmd(build_dir: &str, image: &str, port: u16) -> (String, &'static str) {
    let has_df = std::path::Path::new(&format!("{build_dir}/Dockerfile")).is_file();
    if has_df {
        (
            docker::docker_build(".", image, "Dockerfile"),
            "docker build Dockerfile",
        )
    } else {
        (
            docker::docker_build_from_content(image, &docker::node_inline_dockerfile(port)),
            "docker build Node inline Dockerfile",
        )
    }
}

fn shell_escape_token(s: &str) -> String {
    if s.chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/' | ':' | '=' | '@'))
    {
        s.to_string()
    } else {
        format!("'{}'", s.replace('\'', "'\\''"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collect_always_adds_puppeteer_skip() {
        let envs = collect_build_envs(None);
        assert!(envs
            .iter()
            .any(|(k, v)| k == "PUPPETEER_SKIP_DOWNLOAD" && v == "1"));
    }

    #[test]
    fn collect_filters_secrets() {
        let body = "DATABASE_URL=secret\nNODE_ENV=production\nPUPPETEER_SKIP_DOWNLOAD=1\n";
        let envs = collect_build_envs(Some(body));
        assert!(!envs.iter().any(|(k, _)| k == "DATABASE_URL"));
        assert!(envs
            .iter()
            .any(|(k, v)| k == "NODE_ENV" && v == "production"));
    }

    #[test]
    fn nixpacks_cmd_contains_builder_and_name() {
        let cmd = nixpacks_docker_build("df-abc:latest", &collect_build_envs(None));
        assert!(cmd.contains("docker run"));
        assert!(cmd.contains("--entrypoint nixpacks"));
        assert!(cmd.contains("build . --name"));
        assert!(cmd.contains("df-abc:latest"));
        assert!(cmd.contains("PUPPETEER_SKIP_DOWNLOAD=1"));
    }
}
