//! Docker helper command builders (executed via RemoteExecutor).

use serde_json::{Map, Value};

pub fn docker_build(workdir: &str, image: &str, dockerfile: &str) -> String {
    format!(
        "docker build -f {} -t {} {}",
        shell_escape(dockerfile),
        shell_escape(image),
        shell_escape(workdir)
    )
}

pub fn docker_run(name: &str, image: &str, ports: &[(u16, u16)], env_file: Option<&str>) -> String {
    docker_run_ex(name, image, ports, env_file, None, None)
}

/// Run with optional Docker network + Traefik labels.
pub fn docker_run_ex(
    name: &str,
    image: &str,
    ports: &[(u16, u16)],
    env_file: Option<&str>,
    network: Option<&str>,
    labels: Option<&Value>,
) -> String {
    let mut args = vec![
        "docker".into(),
        "run".into(),
        "-d".into(),
        "--name".into(),
        shell_escape(name),
        "--restart".into(),
        "unless-stopped".into(),
    ];
    if let Some(net) = network.filter(|n| !n.is_empty()) {
        args.push("--network".into());
        args.push(shell_escape(net));
    }
    if let Some(Value::Object(map)) = labels {
        for (k, v) in map {
            let val = v.as_str().unwrap_or("");
            args.push("--label".into());
            args.push(format!("{}={}", shell_escape(k), shell_escape(val)));
        }
    }
    for (host, container) in ports {
        args.push("-p".into());
        args.push(format!("{host}:{container}"));
    }
    if let Some(ef) = env_file {
        args.push("--env-file".into());
        args.push(shell_escape(ef));
    }
    args.push(shell_escape(image));
    args.join(" ")
}

pub fn docker_compose_up(compose_file: &str) -> String {
    format!(
        "docker compose -f {} up -d --build",
        shell_escape(compose_file)
    )
}

/// Host CLI nixpacks (legacy). Prefer [`crate::builders::nixpacks_docker_build`].
pub fn nixpacks_build(image: &str) -> String {
    format!("nixpacks build . --name {}", shell_escape(image))
}

/// Fallback when nixpacks is unavailable: Node multi-stage Dockerfile (build + start).
/// Skips Puppeteer/Chromium browser download during `npm ci` (apps that need Chrome
/// at runtime should ship their own Dockerfile or nixpacks.toml).
pub fn node_inline_dockerfile(port: u16) -> String {
    format!(
        r#"FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_SKIP_DOWNLOAD=1 \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1
COPY package.json package-lock.json* npm-shrinkwrap.json* yarn.lock* pnpm-lock.yaml* ./
RUN if [ -f package-lock.json ]; then npm ci; \
  elif [ -f yarn.lock ]; then corepack enable && yarn install --frozen-lockfile; \
  elif [ -f pnpm-lock.yaml ]; then corepack enable && pnpm install --frozen-lockfile; \
  else npm install; fi
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production HOST=0.0.0.0 PORT={port} \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1
COPY --from=build /app /app
EXPOSE {port}
CMD ["npm", "run", "start"]
"#,
        port = port
    )
}

pub fn docker_build_from_content(image: &str, dockerfile: &str) -> String {
    if cfg!(windows) {
        let escaped = dockerfile.replace('\'', "''");
        format!(
            "Set-Content -LiteralPath .devforge.Dockerfile -Value @'\n{escaped}\n'@; docker build -f .devforge.Dockerfile -t {} .",
            shell_escape(image)
        )
    } else {
        format!(
            "docker build -t {} -f - . <<'DFEOF'\n{}\nDFEOF",
            shell_escape(image),
            dockerfile
        )
    }
}

/// Static site: npm build then nginx (publish_directory relative to workdir, default dist).
pub fn static_inline_dockerfile(publish_directory: &str) -> String {
    let pub_dir = publish_directory.trim().trim_start_matches('/');
    let pub_dir = if pub_dir.is_empty() { "dist" } else { pub_dir };
    format!(
        r#"FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_SKIP_DOWNLOAD=1 \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1
COPY package.json package-lock.json* npm-shrinkwrap.json* yarn.lock* pnpm-lock.yaml* ./
RUN if [ -f package-lock.json ]; then npm ci; \
  elif [ -f yarn.lock ]; then corepack enable && yarn install --frozen-lockfile; \
  elif [ -f pnpm-lock.yaml ]; then corepack enable && pnpm install --frozen-lockfile; \
  else npm install; fi
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/{pub_dir} /usr/share/nginx/html
EXPOSE 80
"#,
        pub_dir = pub_dir
    )
}

pub fn docker_stop(name: &str) -> String {
    if cfg!(windows) {
        format!(
            "docker stop {n}; docker rm -f {n}",
            n = shell_escape(name)
        )
    } else {
        format!(
            "docker stop {} && docker rm -f {}",
            shell_escape(name),
            shell_escape(name)
        )
    }
}

/// Stop/remove our container, then any other container publishing `host_port`
/// (avoids `Bind for 0.0.0.0:PORT failed: port is already allocated`).
pub fn docker_prepare_run(name: &str, host_port: u16) -> String {
    if cfg!(windows) {
        format!(
            "docker rm -f {n} 2>$null; $ids = @(docker ps -aq --filter publish={p} 2>$null); if ($ids) {{ docker rm -f @($ids) }}",
            n = shell_escape(name),
            p = host_port
        )
    } else {
        format!(
            "docker rm -f {n} >/dev/null 2>&1 || true; \
ids=$(docker ps -aq --filter publish={p} 2>/dev/null || true); \
if [ -n \"$ids\" ]; then docker rm -f $ids >/dev/null 2>&1 || true; fi",
            n = shell_escape(name),
            p = host_port
        )
    }
}

pub fn docker_restart(name: &str) -> String {
    format!("docker restart {}", shell_escape(name))
}

pub fn docker_ps_status(name: &str) -> String {
    format!(
        "docker ps -a --filter name={} --format '{{{{.Status}}}}'",
        shell_escape(name)
    )
}

pub fn docker_update_labels(name: &str, labels: &Value) -> String {
    let mut parts = vec!["docker update".to_string()];
    if let Some(obj) = labels.as_object() {
        for (k, v) in obj {
            let val = v.as_str().unwrap_or("");
            parts.push(format!(
                "--label-add {}={}",
                shell_escape(k),
                shell_escape(val)
            ));
        }
    }
    parts.push(shell_escape(name));
    parts.join(" ")
}

/// Nom du middleware Traefik ForwardAuth SSO (IdP externe / oauth2-proxy).
pub const SSO_MIDDLEWARE_NAME: &str = "devforge-sso-auth";

/// Traefik labels (entrypoints http/https — compatible Traefik v3 local/NAS).
/// Si `forward_auth_address` est fourni, attache le middleware ForwardAuth SSO.
pub fn traefik_labels(
    project_uuid: &str,
    host: &str,
    path_prefix: &str,
    port: u16,
    forward_auth_address: Option<&str>,
) -> Value {
    let short = project_uuid.chars().take(8).collect::<String>();
    let router = format!("df-{short}");
    let path = if path_prefix.trim().is_empty() {
        "/"
    } else {
        path_prefix
    };
    let rule = if path == "/" {
        format!("Host(`{host}`)")
    } else {
        format!("Host(`{host}`) && PathPrefix(`{path}`)")
    };
    let mut map = Map::new();
    map.insert("traefik.enable".into(), Value::String("true".into()));
    map.insert(
        format!("traefik.http.routers.http-{router}.rule"),
        Value::String(rule.clone()),
    );
    map.insert(
        format!("traefik.http.routers.http-{router}.entrypoints"),
        Value::String("http".into()),
    );
    map.insert(
        format!("traefik.http.routers.https-{router}.rule"),
        Value::String(rule),
    );
    map.insert(
        format!("traefik.http.routers.https-{router}.entrypoints"),
        Value::String("https".into()),
    );
    map.insert(
        format!("traefik.http.routers.https-{router}.tls"),
        Value::String("true".into()),
    );
    map.insert(
        format!("traefik.http.services.{router}.loadbalancer.server.port"),
        Value::String(port.to_string()),
    );
    map.insert(
        format!("traefik.http.routers.http-{router}.service"),
        Value::String(router.clone()),
    );
    map.insert(
        format!("traefik.http.routers.https-{router}.service"),
        Value::String(router.clone()),
    );

    if let Some(addr) = forward_auth_address.map(str::trim).filter(|a| !a.is_empty()) {
        let mw = SSO_MIDDLEWARE_NAME;
        let headers = "X-Auth-Request-User,X-Auth-Request-Email,X-Auth-Request-Preferred-Username,X-Auth-Request-Groups,Authorization";
        map.insert(
            format!("traefik.http.middlewares.{mw}.forwardauth.address"),
            Value::String(addr.to_string()),
        );
        map.insert(
            format!("traefik.http.middlewares.{mw}.forwardauth.trustForwardHeader"),
            Value::String("true".into()),
        );
        map.insert(
            format!("traefik.http.middlewares.{mw}.forwardauth.authResponseHeaders"),
            Value::String(headers.into()),
        );
        map.insert(
            format!("traefik.http.routers.http-{router}.middlewares"),
            Value::String(mw.into()),
        );
        map.insert(
            format!("traefik.http.routers.https-{router}.middlewares"),
            Value::String(mw.into()),
        );
    }

    Value::Object(map)
}

fn shell_escape(s: &str) -> String {
    if s.chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/' | ':' | '='))
    {
        s.to_string()
    } else {
        format!("'{}'", s.replace('\'', "'\\''"))
    }
}
