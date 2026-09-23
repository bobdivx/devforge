//! Build command helpers (Docker-first). Pure string builders — no I/O.

use crate::docker;

/// Nixpacks CLI release baked into the local builder image.
/// `ghcr.io/railwayapp/nixpacks:ubuntu-*` are provider base images (the `FROM`
/// of generated Dockerfiles). They do not ship the `nixpacks` binary.
pub const NIXPACKS_CLI_VERSION: &str = "1.41.0";

/// Local image built on first deploy (override with `DEVFORGE_NIXPACKS_IMAGE`).
pub const DEFAULT_NIXPACKS_IMAGE: &str = "devforge/nixpacks:1.41.0";

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
            let v = v.trim().trim_matches('"').trim_matches('\'').to_string();
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

/// `ubuntu-*` / `debian-*` tags on ghcr.io/railwayapp/nixpacks are provider bases.
pub fn is_provider_base_image(image: &str) -> bool {
    let tag = image.rsplit('/').next().unwrap_or(image);
    let tag = tag.rsplit(':').next().unwrap_or(tag);
    tag == "ubuntu" || tag == "debian" || tag.starts_with("ubuntu-") || tag.starts_with("debian-")
}

pub fn resolve_nixpacks_image(configured: Option<&str>) -> String {
    match configured.map(str::trim).filter(|s| !s.is_empty()) {
        Some(image) if !is_provider_base_image(image) => image.to_string(),
        _ => DEFAULT_NIXPACKS_IMAGE.to_string(),
    }
}

pub fn nixpacks_image() -> String {
    resolve_nixpacks_image(std::env::var("DEVFORGE_NIXPACKS_IMAGE").ok().as_deref())
}

fn is_managed_cli_image(image: &str) -> bool {
    image == DEFAULT_NIXPACKS_IMAGE || image.starts_with("devforge/nixpacks:")
}

/// Dockerfile for a builder that actually contains `nixpacks` + the Docker CLI.
pub fn nixpacks_cli_dockerfile() -> String {
    format!(
        r#"FROM docker:27-cli
ARG TARGETARCH
RUN apk add --no-cache ca-certificates curl tar git \
 && case "$TARGETARCH" in \
      amd64) ASSET=x86_64-unknown-linux-musl ;; \
      arm64) ASSET=aarch64-unknown-linux-musl ;; \
      *) echo "arch $TARGETARCH non supportée" >&2; exit 1 ;; \
    esac \
 && curl -fsSL -o /tmp/nixpacks.tgz "https://github.com/railwayapp/nixpacks/releases/download/v{ver}/nixpacks-v{ver}-${{ASSET}}.tar.gz" \
 && tar -xzf /tmp/nixpacks.tgz -C /usr/local/bin \
 && chmod +x /usr/local/bin/nixpacks \
 && rm -f /tmp/nixpacks.tgz \
 && nixpacks --version
ENTRYPOINT ["nixpacks"]
"#,
        ver = NIXPACKS_CLI_VERSION
    )
}

/// Build the CLI image once on the deploy host. Empty when `image` is a user override.
fn nixpacks_cli_ensure(image: &str) -> String {
    if !is_managed_cli_image(image) {
        return String::new();
    }
    let df = nixpacks_cli_dockerfile();
    let image = shell_escape_token(image);
    if cfg!(windows) {
        format!(
            "if (-not (docker image inspect {image} 2>$null)) {{ \
$ctx = Join-Path $env:TEMP 'df-nixpacks-cli'; New-Item -ItemType Directory -Force -Path $ctx | Out-Null; \
@'\n{df}\n'@ | docker build -t {image} -f - $ctx; if ($LASTEXITCODE -ne 0) {{ exit $LASTEXITCODE }} }} "
        )
    } else {
        format!(
            r#"if ! docker image inspect {image} >/dev/null 2>&1; then \
echo "[nixpacks-cli] construction {image}"; \
CLI_CTX=$(mktemp -d 2>/dev/null || echo /tmp/df-nixpacks-cli-ctx); \
mkdir -p "$CLI_CTX"; \
docker build -t {image} -f - "$CLI_CTX" <<'NIXPACKS_CLI_EOF'
{df}NIXPACKS_CLI_EOF
ec=$?; rm -rf "$CLI_CTX"; \
if [ "$ec" -ne 0 ]; then exit "$ec"; fi; \
fi; "#
        )
    }
}

fn format_nixpacks_env_flags(build_envs: &[(String, String)]) -> String {
    let mut env_flags = String::new();
    for (k, v) in build_envs {
        env_flags.push_str(" --env ");
        env_flags.push_str(&format!(
            "{}={}",
            shell_escape_token(k),
            shell_escape_token(v)
        ));
    }
    env_flags
}

/// Nixpacks via Docker image — no host CLI required.
///
/// Forces `--entrypoint nixpacks`. The managed image is `devforge/nixpacks`
/// (CLI + Docker client). Do not point this at `ghcr.io/railwayapp/nixpacks:ubuntu-*`:
/// those tags are provider base images and do not contain the binary.
///
/// At runtime (Unix), prefers `--volumes-from` when DevForge runs nested with a
/// docker.sock (ZimaOS), otherwise bind-mounts `$PWD`. Decision is made on the
/// execution host so SSH remotes do not inherit a wrong `--volumes-from`.
pub fn nixpacks_docker_build(image: &str, build_envs: &[(String, String)]) -> String {
    nixpacks_docker_build_image(&nixpacks_image(), image, build_envs)
}

pub fn nixpacks_docker_build_image(
    builder: &str,
    image: &str,
    build_envs: &[(String, String)],
) -> String {
    let ensure = nixpacks_cli_ensure(builder);
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

    let run = if cfg!(windows) {
        format!(
            "docker run --rm --entrypoint nixpacks -v \"{pwd}:/app\" -w /app {builder} {nix_args}",
            pwd = "$(Get-Location)",
            builder = shell_escape_token(builder),
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
            builder = shell_escape_token(builder),
            nix_args = nix_args,
        )
    };
    format!("{ensure}{run}")
}

/// Fallback when nixpacks-docker fails.
/// The choice runs on the deploy host: project Dockerfile, else a Node image
/// that skips `npm run build` when the script is absent (typical API).
pub fn fallback_image_build_cmd(image: &str, port: u16) -> (String, &'static str) {
    let node = docker::docker_build_from_content(image, &docker::node_inline_dockerfile(port));
    let df = docker::docker_build(".", image, "Dockerfile");
    let cmd = if cfg!(windows) {
        format!(
            "if (Test-Path Dockerfile) {{ {df} }} elseif (Test-Path package.json) {{ {node} }} else {{ Write-Error '[fallback] ni Dockerfile ni package.json'; exit 1 }}"
        )
    } else {
        format!(
            "if [ -f Dockerfile ]; then {df}\nelif [ -f package.json ]; then\n{node}\nelse\necho \"[fallback] ni Dockerfile ni package.json — Nixpacks est requis pour ce runtime\" >&2\nexit 1\nfi\n"
        )
    };
    (
        cmd,
        "Dockerfile du projet, sinon Node (build seulement si le script existe)",
    )
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
        let cmd = nixpacks_docker_build_image(
            DEFAULT_NIXPACKS_IMAGE,
            "df-abc:latest",
            &collect_build_envs(None),
        );
        assert!(cmd.contains("docker image inspect"));
        assert!(cmd.contains("devforge/nixpacks:1.41.0"));
        assert!(cmd.contains("nixpacks-v1.41.0-"));
        assert!(!cmd.contains("ubuntu-1788826008"));
        assert!(cmd.contains("docker run"));
        assert!(cmd.contains("--entrypoint nixpacks"));
        assert!(cmd.contains("build . --name"));
        assert!(cmd.contains("df-abc:latest"));
        assert!(cmd.contains("PUPPETEER_SKIP_DOWNLOAD=1"));
    }

    #[test]
    fn provider_base_tag_is_not_used_as_cli() {
        assert!(is_provider_base_image(
            "ghcr.io/railwayapp/nixpacks:ubuntu-1788826008"
        ));
        assert_eq!(
            resolve_nixpacks_image(Some("ghcr.io/railwayapp/nixpacks:ubuntu-1788826008")),
            DEFAULT_NIXPACKS_IMAGE
        );
        assert_eq!(
            resolve_nixpacks_image(Some("ghcr.io/example/nixpacks:9")),
            "ghcr.io/example/nixpacks:9"
        );
    }

    #[test]
    fn custom_nixpacks_image_skips_bootstrap() {
        let cmd = nixpacks_docker_build_image("ghcr.io/example/nixpacks:9", "df-abc:latest", &[]);
        assert!(!cmd.contains("docker image inspect"));
        assert!(cmd.contains("ghcr.io/example/nixpacks:9"));
    }

    #[test]
    fn managed_nixpacks_script_is_valid_shell() {
        if cfg!(windows) {
            return;
        }
        let cmd = nixpacks_docker_build_image(DEFAULT_NIXPACKS_IMAGE, "df-abc:latest", &[]);
        let path = std::env::temp_dir().join("df-nixpacks-cmd.sh");
        std::fs::write(&path, &cmd).unwrap();
        let out = std::process::Command::new("sh")
            .arg("-n")
            .arg(&path)
            .output()
            .expect("sh -n");
        std::fs::remove_file(&path).ok();
        assert!(
            out.status.success(),
            "script invalide: {}\n{cmd}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    #[test]
    fn fallback_node_build_is_conditional() {
        let (cmd, _) = fallback_image_build_cmd("df-abc:latest", 8080);
        assert!(cmd.contains("package.json"));
        assert!(
            cmd.contains("scripts.build")
                || cmd.contains("pas de script build")
                || cmd.contains("skip build")
        );
        assert!(cmd.contains("Dockerfile"));
        assert!(cmd.contains("EXPOSE 8080"));
        if cfg!(windows) {
            return;
        }
        let path = std::env::temp_dir().join("df-fallback-cmd.sh");
        std::fs::write(&path, &cmd).unwrap();
        let out = std::process::Command::new("sh")
            .arg("-n")
            .arg(&path)
            .output()
            .expect("sh -n");
        std::fs::remove_file(&path).ok();
        assert!(
            out.status.success(),
            "script invalide: {}\n{cmd}",
            String::from_utf8_lossy(&out.stderr)
        );
    }
}
