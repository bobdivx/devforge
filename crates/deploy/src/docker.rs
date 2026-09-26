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
    docker_run_ex(
        name,
        image,
        ports,
        env_file,
        None,
        None,
        false,
        false,
        &[],
        &crate::runtime::RunTune::default(),
    )
}

/// `source:cible` ou `source:cible:ro|rw`. Chemins absolus, pas de `..`.
pub fn normalize_volume_mount(raw: &str) -> Result<String, String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Err("montage vide".into());
    }
    if raw.chars().any(|c| {
        c.is_whitespace()
            || matches!(
                c,
                ';' | '&' | '|' | '`' | '$' | '"' | '\'' | '\\' | '\n' | '\r'
            )
    }) {
        return Err(format!(
            "montage refusé ({raw}) — pas d’espace ni de caractère shell"
        ));
    }
    let parts: Vec<&str> = raw.split(':').collect();
    if parts.len() < 2 || parts.len() > 3 {
        return Err(format!(
            "montage invalide ({raw}) — format /hôte:/conteneur[:ro|rw]"
        ));
    }
    let host = parts[0];
    let container = parts[1];
    if host.is_empty()
        || container.is_empty()
        || !host.starts_with('/')
        || !container.starts_with('/')
        || host.contains("..")
        || container.contains("..")
    {
        return Err(format!(
            "montage invalide ({raw}) — chemins absolus, sans « .. »"
        ));
    }
    if let Some(mode) = parts.get(2) {
        if *mode != "ro" && *mode != "rw" {
            return Err(format!("mode de montage invalide ({raw}) — ro ou rw"));
        }
    }
    Ok(raw.to_string())
}

pub fn normalize_volume_mounts(inputs: &[String]) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    for raw in inputs {
        let mount = normalize_volume_mount(raw)?;
        if !out.iter().any(|e| e == &mount) {
            out.push(mount);
        }
    }
    Ok(out)
}

pub fn decode_volume_mounts(raw: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(raw)
        .ok()
        .map(|v| normalize_volume_mounts(&v).unwrap_or_default())
        .unwrap_or_default()
}

/// Run with optional Docker network + Traefik labels.
///
/// ## Traefik network requirement
/// If `labels` contains Traefik routing rules, `network` should point to the same Docker
/// network Traefik monitors (typically from `DEVFORGE_DOCKER_NETWORK`). Without a shared network,
/// Traefik can match routes but cannot reach the container → requests hang/timeout.
///
/// Common network names: `devforge-net`, `traefik-public`, or legacy shared proxy network
///
/// Port publishing (`-p`) alone is insufficient for Traefik reverse-proxy; containers must
/// share a network for Traefik to forward traffic.
pub fn docker_run_ex(
    name: &str,
    image: &str,
    ports: &[(u16, u16)],
    env_file: Option<&str>,
    network: Option<&str>,
    labels: Option<&Value>,
    gpu_nvidia: bool,
    gpu_dri: bool,
    volumes: &[String],
    tune: &crate::runtime::RunTune,
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
    if gpu_nvidia {
        args.push("--gpus".into());
        args.push("all".into());
    }
    if gpu_dri {
        args.push("--device".into());
        args.push("/dev/dri".into());
    }
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
    for port in &tune.extra_ports {
        args.push("-p".into());
        args.push(port.publish_flag());
    }
    if let Some(mem) = tune.memory.as_deref().filter(|s| !s.is_empty()) {
        args.push("--memory".into());
        args.push(shell_escape(mem));
    }
    if let Some(cpus) = tune.cpus.as_deref().filter(|s| !s.is_empty()) {
        args.push("--cpus".into());
        args.push(shell_escape(cpus));
    }
    if let Some(alias) = tune.network_alias.as_deref().filter(|s| !s.is_empty()) {
        args.push("--network-alias".into());
        args.push(shell_escape(alias));
    }
    if let Some(hc) = &tune.healthcheck {
        args.push("--health-cmd".into());
        args.push(shell_escape(&hc.cmd));
        args.push("--health-interval".into());
        args.push(shell_escape(&hc.interval));
        args.push("--health-timeout".into());
        args.push(shell_escape(&hc.timeout));
        args.push("--health-retries".into());
        args.push(hc.retries.to_string());
        args.push("--health-start-period".into());
        args.push(shell_escape(&hc.start_period));
    }
    if let Some(ef) = env_file {
        args.push("--env-file".into());
        args.push(shell_escape(ef));
    }
    for volume in volumes {
        args.push("-v".into());
        args.push(shell_escape(volume));
    }
    args.push(shell_escape(image));
    args.join(" ")
}

/// Crée le réseau s'il manque et y branche le conteneur.
/// Avec `alias`, déconnecte d'abord pour remplacer un alias déjà posé.
pub fn docker_network_attach(network: &str, container: &str, alias: Option<&str>) -> String {
    let net = shell_escape(network);
    let ctr = shell_escape(container);
    match alias.map(str::trim).filter(|s| !s.is_empty()) {
        Some(alias) => {
            let alias = shell_escape(alias);
            format!(
                "docker network create {net} >/dev/null 2>&1 || true; docker network disconnect {net} {ctr} >/dev/null 2>&1 || true; docker network connect --alias {alias} {net} {ctr}"
            )
        }
        None => format!(
            "docker network create {net} >/dev/null 2>&1 || true; docker network connect {net} {ctr} >/dev/null 2>&1 || true"
        ),
    }
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

/// Fallback when nixpacks is unavailable: Node image.
/// `npm run build` runs only when `package.json` defines a build script
/// (APIs often only have `start`). Start uses `npm start`, else `server.js` / `index.js`.
/// Skips Puppeteer/Chromium download during install.
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
RUN node -e 'const p=require("./package.json"); if(!(p.scripts&&p.scripts.build)){{console.log("skip build"); process.exit(0)}} process.exit(1)' \
  || npm run build

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
CMD sh -c 'if node -e "const p=require(\"./package.json\"); process.exit(p.scripts&&p.scripts.start?0:1)"; then exec npm run start; elif [ -f server.js ]; then exec node server.js; elif [ -f index.js ]; then exec node index.js; else echo "[devforge] ni script start, ni server.js, ni index.js"; exit 1; fi'
"#,
        port = port
    )
}

/// Host shell: run `npm run build` only when the script exists.
pub fn npm_build_if_present_shell() -> &'static str {
    if cfg!(windows) {
        r#"node -e "const p=require('./package.json'); process.exit(p.scripts&&p.scripts.build?1:0)"; if ($LASTEXITCODE -eq 0) { Write-Output '[node] pas de script build — skip' } else { npm run build; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }"#
    } else {
        r#"if node -e 'const p=require("./package.json"); process.exit(p.scripts&&p.scripts.build?1:0)'; then echo "[node] pas de script build — skip"; else npm run build; fi"#
    }
}

/// Host shell used when Docker is unavailable: `npm start`, else a JS entrypoint.
pub fn npm_start_if_present_shell() -> &'static str {
    r#"if node -e 'const p=require("./package.json"); process.exit(p.scripts&&p.scripts.start?0:1)'; then exec npm run start; elif [ -f server.js ]; then exec node server.js; elif [ -f index.js ]; then exec node index.js; else echo "[devforge] ni script start, ni server.js, ni index.js"; exit 1; fi"#
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
        format!("docker stop {n}; docker rm -f {n}", n = shell_escape(name))
    } else {
        format!(
            "docker stop {} && docker rm -f {}",
            shell_escape(name),
            shell_escape(name)
        )
    }
}

/// Ports hôte tenus par le reverse proxy DevForge (Traefik) : une app ne doit jamais
/// les publier ni évincer leur détenteur.
pub fn is_proxy_reserved_host_port(port: u16) -> bool {
    matches!(port, 0 | 80 | 443)
}

/// Stop/remove our container, then any other container publishing `host_port`
/// (avoids `Bind for 0.0.0.0:PORT failed: port is already allocated`).
/// Ne touche JAMAIS au reverse proxy (`devforge-traefik` / label `devforge.proxy=true`).
pub fn docker_prepare_run(name: &str, host_port: u16) -> String {
    if cfg!(windows) {
        format!(
            "docker rm -f {n} 2>$null; $ids = @(docker ps -aq --filter publish={p} 2>$null); if ($ids) {{ docker rm -f @($ids) }}",
            n = shell_escape(name),
            p = host_port
        )
    } else {
        if is_proxy_reserved_host_port(host_port) {
            return format!(
                "docker rm -f {} >/dev/null 2>&1 || true",
                shell_escape(name)
            );
        }
        format!(
            "docker rm -f {n} >/dev/null 2>&1 || true; \
for id in $(docker ps -aq --filter publish={p} 2>/dev/null || true); do \
{guard} \
docker rm -f \"$id\" >/dev/null 2>&1 || true; \
done",
            n = shell_escape(name),
            p = host_port,
            guard = PROXY_GUARD_SH
        )
    }
}

/// Like docker_prepare_run but KEEPS the container named `except_name` alive (blue/green).
/// Only removes other containers publishing the same port.
pub fn docker_prepare_run_except(except_name: &str, host_port: u16) -> String {
    if cfg!(windows) {
        format!(
            "$ids = @(docker ps -aq --filter publish={p} 2>$null | Where-Object {{ \
                $n = (docker inspect $_ --format '{{{{.Name}}}}' 2>$null); \
                $n -ne '/{except}' -and $n -ne '{except}' \
            }}); if ($ids) {{ docker rm -f @($ids) 2>$null }}",
            p = host_port,
            except = shell_escape(except_name)
        )
    } else {
        if is_proxy_reserved_host_port(host_port) {
            return "true".into();
        }
        format!(
            "for id in $(docker ps -aq --filter publish={p} 2>/dev/null || true); do \
                {guard} \
                n=$(docker inspect \"$id\" --format '{{{{.Name}}}}' 2>/dev/null || echo ''); \
                if [ \"$n\" != '/{except}' ] && [ \"$n\" != '{except}' ]; then \
                    docker rm -f \"$id\" >/dev/null 2>&1 || true; \
                fi; \
            done",
            p = host_port,
            except = shell_escape(except_name),
            guard = PROXY_GUARD_SH
        )
    }
}

/// Fragment shell (dans une boucle `for id`) : saute le reverse proxy DevForge.
const PROXY_GUARD_SH: &str = "case \"$(docker inspect \"$id\" --format '{{.Name}} {{index .Config.Labels \"devforge.proxy\"}}' 2>/dev/null)\" in /devforge-traefik*|*' true') continue;; esac;";

pub fn docker_restart(name: &str) -> String {
    format!("docker restart {}", shell_escape(name))
}

/// Sonde HTTP du conteneur sur son port d’écoute, depuis l’hôte Docker.
/// Affiche un code HTTP, ou `down` si rien n’écoute.
pub fn docker_http_probe_cmd(container: &str, port: u16, path: &str) -> String {
    let path = if path.starts_with('/')
        && path.len() <= 200
        && path.chars().all(|c| {
            c.is_ascii_alphanumeric() || matches!(c, '/' | '_' | '.' | '-' | '?' | '=' | '&' | '%')
        }) {
        path
    } else {
        "/"
    };
    let container = if container_name_ok(container) {
        container
    } else {
        "invalid"
    };
    format!(
        "ip=$(docker inspect --format '{{{{range .NetworkSettings.Networks}}}}{{{{.IPAddress}}}}{{{{println}}}}{{{{end}}}}' {container} | awk 'NF{{print; exit}}'); if [ -z \"$ip\" ]; then echo down; exit 0; fi; code=$(curl -sS -o /dev/null -w '%{{http_code}}' --max-time 5 --connect-timeout 3 \"http://$ip:{port}{path}\" 2>/dev/null || true); case \"$code\" in [1-5][0-9][0-9]) echo \"$code\" ;; *) echo down ;; esac"
    )
}

fn container_name_ok(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphanumeric() => {}
        _ => return false,
    }
    !name.is_empty()
        && name.len() <= 80
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

pub fn docker_ps_status(name: &str) -> String {
    format!(
        "docker ps -a --filter name={} --format '{{{{.Status}}}}'",
        shell_escape(name)
    )
}

/// Docker ne permet pas de muter les labels d’un conteneur existant (`docker update`
/// n’a pas `--label-add`). On recrée le conteneur en préservant image / env / réseau / ports.
pub fn docker_update_labels(name: &str, labels: &Value) -> String {
    docker_recreate_with_labels(name, labels)
}

/// Vérifie si un Host Traefik est déjà revendiqué par un conteneur existant.
///
/// ## Traefik Host conflict guard
/// Avant d'appliquer des labels `Host(...)` à un conteneur `df-*`, cette fonction
/// détecte si un autre conteneur **running** (surtout non-df) possède déjà ce Host.
///
/// Ceci évite qu'un conteneur preview/local ne vole les routes de production → 504.
///
/// ## Retour
/// Commande shell qui affiche l'ID (ou nom) du premier conteneur conflictuel trouvé,
/// ou une chaîne vide si le Host est libre.
///
/// ## Stratégie
/// - Inspecte tous les conteneurs running
/// - Extrait les labels Traefik `traefik.http.routers.*.rule`
/// - Parse les règles pour trouver `Host(\`{fqdn}\`)`
/// - Retourne le premier match (priorité aux conteneurs non-df)
pub fn docker_check_host_conflicts(fqdn: &str) -> String {
    let escaped_fqdn = shell_escape(fqdn);
    format!(
        r#"sh -c '
HOST="{}"
for cid in $(docker ps -q 2>/dev/null); do
  NAME=$(docker inspect "$cid" --format "{{{{.Name}}}}" 2>/dev/null | sed "s/^\///" || echo "")
  
  # Extraire tous les labels traefik.http.routers.*.rule
  RULES=$(docker inspect "$cid" --format "{{{{range \$k, \$v := .Config.Labels}}}}{{{{if contains \$k \"traefik.http.routers.\"}}}}{{{{if contains \$k \".rule\"}}}}{{{{println \$v}}}}{{{{end}}}}{{{{end}}}}{{{{end}}}}" 2>/dev/null || echo "")
  
  # Vérifier si une règle contient Host(`$HOST`)
  if echo "$RULES" | grep -qF "Host(\`$HOST\`)"; then
    # Trouvé conflit : afficher nom ou id
    if [ -n "$NAME" ]; then
      echo "$NAME"
    else
      echo "$cid"
    fi
    exit 0
  fi
done
echo ""
'"#,
        escaped_fqdn
    )
}

/// Detect Traefik Docker network using multiple strategies.
/// Returns shell command that outputs network name or empty string.
///
/// Strategies (in order):
/// 1. Container name patterns (traefik, caddy, proxy (substring), zima (substring), casaos (substring))
/// 2. Container image containing 'traefik'
/// 3. Containers publishing port 80 or 443 (reverse proxy indicators)
/// 4. Containers with traefik.enable=true label (proxy itself)
/// 5. Networks containing known working apps (sonozz, df-) alongside proxy containers
/// 5. Check for host-network mode proxies (NetworkMode=host)
/// 6. Networks containing DevForge apps (df- substring)
///
/// NOTE: Docker --filter name= uses substring matching, NOT shell globs.
pub fn docker_detect_traefik_network() -> String {
    r#"sh -c '
# Strategy 1: Check common proxy container name patterns
for pattern in traefik caddy proxy devforge zima casaos; do
  for cid in $(docker ps -q --filter "name=$pattern" 2>/dev/null); do
    NET=$(docker inspect "$cid" --format "{{range \$k, \$v := .NetworkSettings.Networks}}{{println \$k}}{{end}}" 2>/dev/null | grep -v "^bridge$" | head -n1)
    if [ -n "$NET" ]; then
      echo "$NET"
      exit 0
    fi
  done
done

# Strategy 2: Check containers by image containing "traefik"
for cid in $(docker ps -q 2>/dev/null); do
  IMG=$(docker inspect "$cid" --format "{{.Config.Image}}" 2>/dev/null || echo "")
  if echo "$IMG" | grep -qi "traefik"; then
    NET=$(docker inspect "$cid" --format "{{range \$k, \$v := .NetworkSettings.Networks}}{{println \$k}}{{end}}" 2>/dev/null | grep -v "^bridge$" | head -n1)
    if [ -n "$NET" ]; then
      echo "$NET"
      exit 0
    fi
  fi
done

# Strategy 3: Containers publishing port 80 or 443 (likely reverse proxy)
for port in 80 443; do
  for cid in $(docker ps -q --filter "publish=$port" 2>/dev/null); do
    NET=$(docker inspect "$cid" --format "{{range \$k, \$v := .NetworkSettings.Networks}}{{println \$k}}{{end}}" 2>/dev/null | grep -v "^bridge$" | head -n1)
    if [ -n "$NET" ]; then
      echo "$NET"
      exit 0
    fi
  done
done

# Strategy 4: Containers with traefik.enable=true label (proxy infrastructure)
for cid in $(docker ps -q 2>/dev/null); do
  ENABLED=$(docker inspect "$cid" --format "{{index .Config.Labels \"traefik.enable\"}}" 2>/dev/null || echo "")
  if [ "$ENABLED" = "true" ]; then
    NET=$(docker inspect "$cid" --format "{{range \$k, \$v := .NetworkSettings.Networks}}{{println \$k}}{{end}}" 2>/dev/null | grep -v "^bridge$" | head -n1)
    if [ -n "$NET" ]; then
      echo "$NET"
      exit 0
    fi
  fi
done


# Strategy 5: Check for host-network mode proxies
# If proxy uses NetworkMode=host, return special marker "host-network-detected"
for pattern in traefik caddy proxy zima casaos; do
  for cid in $(docker ps -q --filter "name=$pattern" 2>/dev/null); do
    MODE=$(docker inspect "$cid" --format "{{.HostConfig.NetworkMode}}" 2>/dev/null || echo "")
    if [ "$MODE" = "host" ]; then
      echo "host-network-detected"
      exit 0
    fi
  done
done

# Strategy 6: Networks containing DevForge apps (df- substring)
for pattern in df-; do
  for cid in $(docker ps -q --filter "name=$pattern" 2>/dev/null); do
    NET=$(docker inspect "$cid" --format "{{range \$k, \$v := .NetworkSettings.Networks}}{{println \$k}}{{end}}" 2>/dev/null | grep -v "^bridge$" | head -n1)
    if [ -n "$NET" ]; then
      echo "$NET"
      exit 0
    fi
  done
done

echo ""
'"#
        .to_string()
}

/// Recrée `name` avec les labels fournis (Traefik sync après changement de domaine).
///
/// ## Network preservation
/// The script inspects and preserves the container's original Docker network(s).
/// Critical for Traefik: if the original container was on a custom network (e.g. `devforge-net`),
/// the recreated container **must** rejoin it, otherwise Traefik routing will match but hang
/// (Traefik cannot reach containers on different networks).
///
/// ## DevForge container fix (2026-09-14 incident C)
/// App containers (df-*) **must** be connected to the Traefik network (`devforge`) even if
/// they were previously only on `bridge`. Without this, Traefik 502s despite labels being correct.
///
/// ## Label safety
/// Labels are passed via heredoc → tempfile → POSIX positional parameters (`set -- "$@" --label "$line"`).
/// Each label becomes its own argv element, preventing shell command substitution of backticks
/// in Traefik `Host(\`fqdn\`)` rules.
pub fn docker_recreate_with_labels(name: &str, labels: &Value) -> String {
    let mut label_heredoc = String::new();
    if let Some(obj) = labels.as_object() {
        for (k, v) in obj {
            let val = v.as_str().unwrap_or("");
            label_heredoc.push_str(&format!("{}={}\n", k, val));
        }
    }
    let n = shell_escape(name);

    format!(
        r#"sh -c 'set -e
N={n}
if ! docker inspect "$N" >/dev/null 2>&1; then echo "container $N introuvable"; exit 1; fi
IMG=$(docker inspect -f "{{{{.Config.Image}}}}" "$N")
NET=$(docker inspect -f "{{{{range \$k, \$v := .NetworkSettings.Networks}}}}{{{{println \$k}}}}{{{{end}}}}" "$N" | head -n1)
ENV_FILE=$(mktemp)
docker inspect -f "{{{{range .Config.Env}}}}{{{{println .}}}}{{{{end}}}}" "$N" > "$ENV_FILE"
LABEL_FILE=$(mktemp)
cat >"$LABEL_FILE" <<'"'"'LABELS_EOF'"'"'
{label_heredoc}LABELS_EOF

# Build docker run args via positional parameters (safe for backticks/special chars)
set -- -d --name "$N" --restart unless-stopped

# Add labels from file (each --label is a separate argv, preventing command substitution)
while IFS= read -r line; do
  [ -n "$line" ] && set -- "$@" --label "$line"
done < "$LABEL_FILE"

# Add network if present and not bridge
if [ -n "$NET" ] && [ "$NET" != "bridge" ]; then
  set -- "$@" --network "$NET"
fi

# Add port mappings
for spec in $(docker inspect -f "{{{{range \$p, \$conf := .HostConfig.PortBindings}}}}{{{{range \$conf}}}}{{{{.HostPort}}}}:{{\${{p}}}} {{{{end}}}}{{{{end}}}}" "$N"); do
  [ -n "$spec" ] && set -- "$@" -p "$spec"
done

# Bind mounts and named volumes (lost otherwise: docker run is rebuilt from inspect)
MOUNT_FILE=$(mktemp)
docker inspect -f "{{{{range .Mounts}}}}{{{{.Type}}}}|{{{{.Source}}}}|{{{{.Destination}}}}|{{{{.RW}}}}|{{{{.Name}}}}
{{{{end}}}}" "$N" > "$MOUNT_FILE"
while IFS="|" read -r typ src dst rw name; do
  spec=""
  if [ "$typ" = "bind" ] && [ -n "$src" ] && [ -n "$dst" ]; then
    spec="$src:$dst"
  elif [ "$typ" = "volume" ] && [ -n "$name" ] && [ -n "$dst" ]; then
    spec="$name:$dst"
  fi
  if [ -n "$spec" ]; then
    if [ "$rw" = "false" ]; then spec="${{spec}}:ro"; fi
    set -- "$@" -v "$spec"
  fi
done < "$MOUNT_FILE"
rm -f "$MOUNT_FILE"

REQ=$(docker inspect -f "{{{{json .HostConfig.DeviceRequests}}}}" "$N" 2>/dev/null || echo null)
echo "$REQ" | grep -q gpu && set -- "$@" --gpus all
DEV=$(docker inspect -f "{{{{json .HostConfig.Devices}}}}" "$N" 2>/dev/null || echo null)
echo "$DEV" | grep -q "/dev/dri" && set -- "$@" --device /dev/dri

MEM=$(docker inspect -f "{{{{.HostConfig.Memory}}}}" "$N" 2>/dev/null || echo 0)
if [ -n "$MEM" ] && [ "$MEM" != "0" ] && [ "$MEM" != "<no value>" ]; then
  set -- "$@" --memory "$MEM"
fi
NANO=$(docker inspect -f "{{{{.HostConfig.NanoCpus}}}}" "$N" 2>/dev/null || echo 0)
if [ -n "$NANO" ] && [ "$NANO" != "0" ] && [ "$NANO" != "<no value>" ]; then
  set -- "$@" --cpu-period 100000 --cpu-quota "$((NANO / 10000))"
fi
HC_CMD=$(docker inspect -f "{{{{if .Config.Healthcheck}}}}{{{{index .Config.Healthcheck.Test 1}}}}{{{{end}}}}" "$N" 2>/dev/null || true)
if [ -n "$HC_CMD" ]; then
  HC_INT=$(docker inspect -f "{{{{.Config.Healthcheck.Interval}}}}" "$N" 2>/dev/null || echo 30s)
  HC_TO=$(docker inspect -f "{{{{.Config.Healthcheck.Timeout}}}}" "$N" 2>/dev/null || echo 10s)
  HC_RET=$(docker inspect -f "{{{{.Config.Healthcheck.Retries}}}}" "$N" 2>/dev/null || echo 5)
  HC_START=$(docker inspect -f "{{{{.Config.Healthcheck.StartPeriod}}}}" "$N" 2>/dev/null || echo 0s)
  set -- "$@" --health-cmd "$HC_CMD" --health-interval "$HC_INT" --health-timeout "$HC_TO" --health-retries "$HC_RET"
  if [ -n "$HC_START" ] && [ "$HC_START" != "0s" ]; then
    set -- "$@" --health-start-period "$HC_START"
  fi
fi

# Add env file
set -- "$@" --env-file "$ENV_FILE"

# Add image
set -- "$@" "$IMG"

# Réseaux supplémentaires (groupe, sidecars) + alias : perdus sinon par la recréation.
OLD_ID=$(docker inspect -f "{{{{.Id}}}}" "$N" | cut -c1-12)
EXTRA_NETS=$(docker inspect -f "{{{{range \$k, \$v := .NetworkSettings.Networks}}}}{{{{\$k}}}}|{{{{range \$v.Aliases}}}}{{{{.}}}},{{{{end}}}}{{{{println}}}}{{{{end}}}}" "$N" | tail -n +2)

docker stop "$N" >/dev/null
docker rm -f "$N" >/dev/null
CID=$(docker run "$@")
rm -f "$ENV_FILE" "$LABEL_FILE"
echo "$EXTRA_NETS" | while IFS="|" read -r xn xa; do
  [ -n "$xn" ] || continue
  [ "$xn" != "bridge" ] || continue
  set --
  for a in $(echo "$xa" | tr "," " "); do
    [ "$a" = "$OLD_ID" ] || [ "$a" = "$N" ] || set -- "$@" --alias "$a"
  done
  docker network connect "$@" "$xn" "$CID" >/dev/null 2>&1 || true
done

# CRITICAL FIX (2026-09-14 incident C): Ensure df-* containers are connected to devforge network
# If container name starts with df-, always connect it to devforge network for Traefik routing
if echo "$N" | grep -q "^df-"; then
  if ! echo "$NET" | grep -q "devforge"; then
    # Not on devforge network, connect it now (handles bridge-only deployments)
    if docker network inspect devforge >/dev/null 2>&1; then
      docker network connect devforge "$CID" 2>/dev/null || true
      echo "recreated $N with traefik labels + connected to devforge network"
    else
      echo "recreated $N with traefik labels (devforge network missing)"
    fi
  else
    echo "recreated $N with traefik labels"
  fi
else
  echo "recreated $N with traefik labels"
fi
'"#
    )
}

/// Nom du middleware Traefik ForwardAuth SSO (IdP externe / oauth2-proxy).
pub const SSO_MIDDLEWARE_NAME: &str = "devforge-sso-auth";

fn host_router_key(host: &str) -> String {
    let mut out = String::new();
    for c in host.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "host".into()
    } else {
        // garder la clé courte pour les labels Traefik
        trimmed.chars().take(48).collect()
    }
}

/// Traefik labels pour **un** host (router unique par FQDN, service partagé par projet).
/// Plusieurs appels peuvent être fusionnés : chaque domaine garde son `Host(...)`.
pub fn traefik_labels(
    project_uuid: &str,
    host: &str,
    path_prefix: &str,
    port: u16,
    forward_auth_address: Option<&str>,
) -> Value {
    let short = project_uuid.chars().take(8).collect::<String>();
    traefik_labels_for_service(
        &format!("df-{short}"),
        host,
        path_prefix,
        port,
        forward_auth_address,
    )
}

/// Labels atelier : service `dfdev-{8}` pour ne pas collisionner avec la prod `df-{8}`.
pub fn traefik_dev_labels(project_uuid: &str, host: &str, port: u16) -> Value {
    let short = project_uuid.chars().take(8).collect::<String>();
    traefik_labels_for_service(&format!("dfdev-{short}"), host, "/", port, None)
}

/// Nom conteneur atelier : `df-dev-{12}` (distinct de la prod `df-{12}`).
pub fn dev_container_name(project_uuid: &str) -> String {
    format!(
        "df-dev-{}",
        project_uuid.chars().take(12).collect::<String>()
    )
}

fn traefik_labels_for_service(
    service: &str,
    host: &str,
    path_prefix: &str,
    port: u16,
    forward_auth_address: Option<&str>,
) -> Value {
    let router = format!("{service}-{}", host_router_key(host));
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
        format!("traefik.http.services.{service}.loadbalancer.server.port"),
        Value::String(port.to_string()),
    );
    map.insert(
        format!("traefik.http.routers.http-{router}.service"),
        Value::String(service.to_string()),
    );
    map.insert(
        format!("traefik.http.routers.https-{router}.service"),
        Value::String(service.to_string()),
    );

    if let Some(addr) = forward_auth_address
        .map(str::trim)
        .filter(|a| !a.is_empty())
    {
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

/// `docker run` pour l’atelier : workdir monté + labels Traefik `dev-*` (pas de ports host).
/// Retourne la ligne shell (RemoteExecutor) — préférer [`docker_run_dev_preview_args`] en process local.
pub fn docker_run_dev_preview(
    name: &str,
    host_workdir: &str,
    network: Option<&str>,
    labels: &Value,
    port: u16,
    shell_command: &str,
    image: &str,
) -> String {
    let mut parts = vec!["docker".to_string()];
    for a in docker_run_dev_preview_args(
        name,
        host_workdir,
        network,
        labels,
        port,
        shell_command,
        image,
    ) {
        parts.push(shell_escape(&a));
    }
    parts.join(" ")
}

/// Args argv pour `docker run` atelier (sans shell).
pub fn docker_run_dev_preview_args(
    name: &str,
    host_workdir: &str,
    network: Option<&str>,
    labels: &Value,
    port: u16,
    shell_command: &str,
    image: &str,
) -> Vec<String> {
    let mut args = vec![
        "run".into(),
        "-d".into(),
        "--name".into(),
        name.to_string(),
        "--restart".into(),
        "unless-stopped".into(),
        "-v".into(),
        format!("{host_workdir}:/app"),
        "-w".into(),
        "/app".into(),
        "-e".into(),
        "HOST=0.0.0.0".into(),
        "-e".into(),
        format!("PORT={port}"),
        "-e".into(),
        "BROWSER=none".into(),
        "-e".into(),
        "PUPPETEER_SKIP_DOWNLOAD=1".into(),
        "-e".into(),
        "PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1".into(),
    ];
    if let Some(net) = network.filter(|n| !n.is_empty()) {
        args.push("--network".into());
        args.push(net.to_string());
    }
    if let Value::Object(map) = labels {
        for (k, v) in map {
            let val = v.as_str().unwrap_or("");
            args.push("--label".into());
            args.push(format!("{k}={val}"));
        }
    }
    args.push(image.to_string());
    args.push("sh".into());
    args.push("-c".into());
    args.push(shell_command.to_string());
    args
}

/// Fusionne les labels Traefik pour tous les hosts d’un projet.
/// Chaque entrée = `(host, path_prefix, target_port)`.
pub fn traefik_labels_for_routes(
    project_uuid: &str,
    routes: &[(&str, &str, u16)],
    forward_auth_address: Option<&str>,
) -> Value {
    let mut map = Map::new();
    map.insert("traefik.enable".into(), Value::String("true".into()));
    for (host, path, port) in routes {
        let piece = traefik_labels(project_uuid, host, path, *port, forward_auth_address);
        if let Some(obj) = piece.as_object() {
            for (k, v) in obj {
                if k == "traefik.enable" {
                    continue;
                }
                map.insert(k.clone(), v.clone());
            }
        }
    }
    Value::Object(map)
}

/// État du moteur Docker **local** (CLI + daemon), pour le zip Windows/Linux.
#[derive(Debug, Clone, serde::Serialize)]
pub struct DockerEngineStatus {
    pub ok: bool,
    pub version: Option<String>,
    pub hint: String,
}

fn docker_bin_candidates() -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            let unix = dir.join("docker");
            if unix.is_file() {
                out.push(unix);
            }
            let win = dir.join("docker.exe");
            if win.is_file() {
                out.push(win);
            }
        }
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        out.push(
            std::path::PathBuf::from(local)
                .join(r"Programs\DockerDesktop\resources\bin\docker.exe"),
        );
    }
    out.push(std::path::PathBuf::from(
        r"C:\Program Files\Docker\Docker\resources\bin\docker.exe",
    ));
    out.into_iter().filter(|p| p.is_file()).collect()
}

/// `docker version` avec timeout court. N’embarque pas Docker : on détecte seulement.
pub fn probe_engine() -> DockerEngineStatus {
    let bins = docker_bin_candidates();
    if bins.is_empty() {
        return DockerEngineStatus {
            ok: false,
            version: None,
            hint: "Docker n’est pas installé. Installe Docker Desktop (Windows / macOS) ou le moteur Docker (Linux) pour déployer des apps en conteneurs.".into(),
        };
    }
    let bin = bins[0].clone();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let r = std::process::Command::new(&bin)
            .args(["version", "--format", "{{.Server.Version}}"])
            .output();
        let _ = tx.send(r);
    });
    match rx.recv_timeout(std::time::Duration::from_secs(4)) {
        Ok(Ok(out)) if out.status.success() => {
            let ver = String::from_utf8_lossy(&out.stdout).trim().to_string();
            DockerEngineStatus {
                ok: true,
                version: if ver.is_empty() { None } else { Some(ver) },
                hint: "Docker prêt — les apps se déploient en conteneurs.".into(),
            }
        }
        Ok(Ok(_)) => DockerEngineStatus {
            ok: false,
            version: None,
            hint: "Docker CLI trouvé, mais le moteur ne répond pas. Démarre Docker Desktop ou le service docker.".into(),
        },
        Ok(Err(_)) | Err(_) => DockerEngineStatus {
            ok: false,
            version: None,
            hint: "Impossible d’interroger Docker. Vérifie que le moteur est démarré.".into(),
        },
    }
}

/// Nom sûr à insérer tel quel dans une commande (conteneur, réseau Docker).
pub fn is_safe_docker_name(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// Sonde de disponibilité HTTP d’un conteneur applicatif, exécutée depuis le conteneur
/// du reverse proxy (il partage le réseau de l’app, contrairement au serveur DevForge).
/// Sortie : `state=<status>|<health> ip=<ip> code=<http|000|noprobe>`.
/// `None` si un nom n’est pas sûr (on retombe alors sur le simple état du conteneur).
pub fn docker_http_probe(container: &str, network: &str, port: u16, path: &str) -> Option<String> {
    if !is_safe_docker_name(container) || !is_safe_docker_name(network) {
        return None;
    }
    let path = if path.starts_with('/')
        && path
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "/-_.~?=&%".contains(c))
    {
        path
    } else {
        "/"
    };
    Some(format!(
        r#"ST=$(docker inspect -f '{{{{.State.Status}}}}|{{{{if .State.Health}}}}{{{{.State.Health.Status}}}}{{{{end}}}}' {c} 2>/dev/null || echo 'missing|')
IP=$(docker inspect -f '{{{{with index .NetworkSettings.Networks "{n}"}}}}{{{{.IPAddress}}}}{{{{end}}}}' {c} 2>/dev/null)
CODE=noprobe
if [ -n "$IP" ] && [ "$(docker inspect -f '{{{{.State.Running}}}}' devforge-traefik 2>/dev/null)" = "true" ]; then
  CODE=$(docker exec devforge-traefik wget -S -q -O /dev/null -T 3 "http://$IP:{port}{path}" 2>&1 | awk '/^ *HTTP\//{{c=$2}} END{{print c}}')
  [ -n "$CODE" ] || CODE=000
fi
echo "state=$ST ip=$IP code=$CODE""#,
        c = container,
        n = network,
    ))
}

/// Verdict d’une sonde de disponibilité (voir [`docker_http_probe`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReadyProbe {
    /// L’app répond (ou healthcheck Docker `healthy`).
    Ready,
    /// Pas encore prête (démarrage, 5xx, connexion refusée…).
    Wait,
    /// Répond 404 : attendre, puis tolérer si stable (API sans page `/`).
    NotFound,
    /// Conteneur arrêté / absent : inutile d’attendre.
    Dead,
    /// Impossible de sonder (proxy absent, pas d’IP sur le réseau).
    NoProbe,
}

pub fn classify_ready_probe(out: &str) -> ReadyProbe {
    let line = out
        .lines()
        .rev()
        .find(|l| l.contains("state="))
        .unwrap_or("");
    let field = |k: &str| {
        line.split_whitespace()
            .find_map(|t| t.strip_prefix(k))
            .unwrap_or("")
            .to_string()
    };
    let st = field("state=");
    let (status, health) = st.split_once('|').unwrap_or((st.as_str(), ""));
    match status {
        "running" => {}
        "created" | "restarting" => return ReadyProbe::Wait,
        _ => return ReadyProbe::Dead,
    }
    // Healthcheck Docker configuré sur le projet : c’est lui qui fait foi.
    if !health.is_empty() {
        return if health == "healthy" {
            ReadyProbe::Ready
        } else {
            ReadyProbe::Wait
        };
    }
    let code = field("code=");
    if code == "noprobe" || code.is_empty() {
        return ReadyProbe::NoProbe;
    }
    match code.parse::<u16>() {
        Ok(404) => ReadyProbe::NotFound,
        Ok(c) if (100..500).contains(&c) => ReadyProbe::Ready,
        _ => ReadyProbe::Wait,
    }
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

#[cfg(test)]
mod tests {
    #[test]
    fn http_probe_command_and_classifier() {
        let c = docker_http_probe("df-68e751f3-ec3-new", "devforge", 4321, "/").unwrap();
        assert!(c.contains("http://$IP:4321/"), "{c}");
        assert!(c.contains(r#"Networks "devforge""#), "{c}");
        assert!(docker_http_probe("x;rm -rf /", "devforge", 80, "/").is_none());
        let p = docker_http_probe("df-a", "net", 80, "/health").unwrap();
        assert!(p.contains(":80/health"), "{p}");
        let p = docker_http_probe("df-a", "net", 80, "/$(id)").unwrap();
        assert!(p.contains(":80/\""), "{p}");

        use ReadyProbe::*;
        assert_eq!(
            classify_ready_probe("state=running| ip=172.26.0.8 code=200"),
            Ready
        );
        assert_eq!(
            classify_ready_probe("state=running| ip=1.2.3.4 code=302"),
            Ready
        );
        assert_eq!(
            classify_ready_probe("state=running| ip=1.2.3.4 code=401"),
            Ready
        );
        assert_eq!(
            classify_ready_probe("state=running| ip=1.2.3.4 code=404"),
            NotFound
        );
        assert_eq!(
            classify_ready_probe("state=running| ip=1.2.3.4 code=502"),
            Wait
        );
        assert_eq!(
            classify_ready_probe("state=running| ip=1.2.3.4 code=000"),
            Wait
        );
        assert_eq!(
            classify_ready_probe("state=running| ip= code=noprobe"),
            NoProbe
        );
        assert_eq!(classify_ready_probe("state=exited| ip= code=noprobe"), Dead);
        assert_eq!(
            classify_ready_probe("state=missing| ip= code=noprobe"),
            Dead
        );
        assert_eq!(classify_ready_probe("state=restarting| ip= code=000"), Wait);
        assert_eq!(
            classify_ready_probe("state=running|starting ip=1.2.3.4 code=200"),
            Wait
        );
        assert_eq!(
            classify_ready_probe("state=running|healthy ip=1.2.3.4 code=000"),
            Ready
        );
    }

    use super::*;

    #[test]
    fn prepare_never_evicts_reverse_proxy() {
        assert!(is_proxy_reserved_host_port(80));
        assert!(is_proxy_reserved_host_port(443));
        assert!(!is_proxy_reserved_host_port(4321));
        if !cfg!(windows) {
            let c = docker_prepare_run_except("df-x", 80);
            assert!(!c.contains("publish=80"), "{c}");
            let c = docker_prepare_run("df-x", 443);
            assert!(!c.contains("publish=443"), "{c}");
            let c = docker_prepare_run_except("df-x", 4321);
            assert!(
                c.contains("publish=4321") && c.contains("devforge-traefik"),
                "{c}"
            );
            let c = docker_prepare_run("df-x", 4321);
            assert!(
                c.contains("publish=4321") && c.contains("devforge.proxy"),
                "{c}"
            );
        }
    }
    use serde_json::json;

    #[test]
    fn preview_url_isolation_prevents_production_host_theft() {
        // Cas d'usage : un conteneur df-* local/atelier ne doit JAMAIS avoir
        // des labels pour starbasefr.jeser.app (production), seulement pour dev-xxx
        let preview_host = "dev-fbb6a152.devforge.local";
        let _production_host = "starbasefr.jeser.app";

        let preview_labels = traefik_labels("fbb6a152-ef01", preview_host, "/", 4321, None);

        // Vérifier que le label atelier (dev-) existe
        let preview_rule_key =
            format!("traefik.http.routers.http-df-fbb6a152-dev-fbb6a152-devforge-local.rule");
        assert!(
            preview_labels.get(&preview_rule_key).is_some(),
            "Preview host doit avoir un router Traefik"
        );
        assert_eq!(
            preview_labels
                .get(&preview_rule_key)
                .and_then(|v| v.as_str()),
            Some("Host(`dev-fbb6a152.devforge.local`)"),
            "Preview router doit pointer vers l’hôte dev-"
        );

        // Vérifier qu'aucun label production n'existe dans les labels preview
        let production_rule_key =
            format!("traefik.http.routers.http-df-fbb6a152-starbasefr-jeser-app.rule");
        assert!(
            preview_labels.get(&production_rule_key).is_none(),
            "Preview labels ne doivent PAS contenir les routes production"
        );
    }

    #[test]
    fn conflict_detection_command_generates_valid_shell() {
        let cmd = docker_check_host_conflicts("starbasefr.jeser.app");

        // Vérifier syntaxe shell basique
        assert!(cmd.contains("sh -c"));
        assert!(cmd.contains("starbasefr.jeser.app"));
        assert!(cmd.contains("docker ps -q"));
        assert!(cmd.contains("Host(`"));

        // Pas de quote mal échappées
        assert!(!cmd.contains("\"\"\""));
    }

    #[test]
    fn traefik_multi_host_keeps_distinct_routers() {
        let a = traefik_labels("fbb6a152-ef01", "starbasefr.jeser.app", "/", 4321, None);
        let b = traefik_labels("fbb6a152-ef01", "starbasefr.com", "/", 4321, None);
        let mut map = serde_json::Map::new();
        for piece in [a, b] {
            if let Some(obj) = piece.as_object() {
                for (k, v) in obj {
                    map.insert(k.clone(), v.clone());
                }
            }
        }
        let rule_jeser = map
            .get("traefik.http.routers.http-df-fbb6a152-starbasefr-jeser-app.rule")
            .and_then(|v| v.as_str());
        let rule_com = map
            .get("traefik.http.routers.http-df-fbb6a152-starbasefr-com.rule")
            .and_then(|v| v.as_str());
        assert_eq!(rule_jeser, Some("Host(`starbasefr.jeser.app`)"));
        assert_eq!(rule_com, Some("Host(`starbasefr.com`)"));
        assert_eq!(
            map.get("traefik.http.services.df-fbb6a152.loadbalancer.server.port"),
            Some(&json!("4321"))
        );
    }

    #[test]
    fn docker_run_applies_popcorn_runtime() {
        use crate::runtime::{HealthcheckSpec, PublishedPort, RunTune};
        let tune = RunTune {
            extra_ports: vec![
                PublishedPort {
                    host: 4240,
                    container: 4240,
                    protocol: "tcp".into(),
                },
                PublishedPort {
                    host: 4240,
                    container: 4240,
                    protocol: "udp".into(),
                },
            ],
            memory: Some("20g".into()),
            cpus: Some("1".into()),
            healthcheck: Some(HealthcheckSpec {
                cmd: "curl -f http://localhost:3000/api/client/health || exit 1".into(),
                interval: "30s".into(),
                timeout: "10s".into(),
                retries: 5,
                start_period: "2m".into(),
            }),
            network_alias: None,
        };
        let cmd = docker_run_ex("app", "img", &[], None, None, None, true, false, &[], &tune);
        assert!(cmd.contains("-p 4240:4240"));
        assert!(cmd.contains("-p 4240:4240/udp"));
        assert!(cmd.contains("--memory 20g"));
        assert!(cmd.contains("--cpus 1"));
        assert!(cmd.contains("--gpus all"));
        assert!(cmd.contains("--health-cmd"));
        assert!(cmd.contains("--health-start-period 2m"));
    }

    #[test]
    fn http_probe_targets_container_port() {
        let cmd = docker_http_probe_cmd("df-4f6e25150269", 3000, "/api/client/health");
        assert!(cmd.contains("{{range .NetworkSettings.Networks}}{{.IPAddress}}"));
        assert!(cmd.contains("http://$ip:3000/api/client/health"));
        assert!(cmd.contains("echo down"));
        let bad = docker_http_probe_cmd("df-bad;rm", 3000, "/");
        assert!(bad.contains(" invalid "));
        assert!(!bad.contains("df-bad"));
    }

    #[test]
    fn docker_run_ex_mounts_host_directories() {
        let volumes = vec![
            "/media/Docker/AppData/popcorn:/app/.data".into(),
            "/media/Media/Popcornn/media:/app/downloads".into(),
            "/var/run/docker.sock:/var/run/docker.sock".into(),
        ];
        let cmd = docker_run_ex(
            "app",
            "img",
            &[(3000, 3000)],
            None,
            None,
            None,
            false,
            false,
            &volumes,
            &crate::runtime::RunTune::default(),
        );
        assert!(cmd.contains("-v /media/Docker/AppData/popcorn:/app/.data"));
        assert!(cmd.contains("-v /media/Media/Popcornn/media:/app/downloads"));
        assert!(cmd.contains("-v /var/run/docker.sock:/var/run/docker.sock"));
    }

    #[test]
    fn volume_mount_rejects_relative_and_accepts_popcorn_binds() {
        assert!(normalize_volume_mount(
            "/media/Media/Popcornn/streaming:/app/downloads/transcode_cache"
        )
        .is_ok());
        assert!(normalize_volume_mount("media:/app/downloads").is_err());
        assert!(normalize_volume_mount("/media/../etc:/app").is_err());
        let many = normalize_volume_mounts(&[
            "/media/Docker/AppData/popcorn:/app/.data".into(),
            "/media/Docker/AppData/popcorn:/app/.data".into(),
        ])
        .unwrap();
        assert_eq!(many.len(), 1);
    }

    #[test]
    fn docker_run_ex_adds_gpu_devices() {
        let cmd = docker_run_ex(
            "app",
            "img",
            &[],
            None,
            Some("devforge"),
            None,
            true,
            true,
            &[],
            &crate::runtime::RunTune::default(),
        );
        assert!(cmd.contains("--gpus all"));
        assert!(cmd.contains("--device /dev/dri"));
        let plain = docker_run_ex(
            "app",
            "img",
            &[],
            None,
            None,
            None,
            false,
            false,
            &[],
            &crate::runtime::RunTune::default(),
        );
        assert!(!plain.contains("--gpus"));
        assert!(!plain.contains("--device"));
    }

    #[test]
    fn docker_network_attach_sets_role_alias() {
        let cmd = docker_network_attach("dfg-popcorn", "df-abc", Some("server"));
        assert!(cmd.contains("docker network create dfg-popcorn"));
        assert!(cmd.contains("docker network connect --alias server dfg-popcorn df-abc"));
        let plain = docker_network_attach("dfg-popcorn", "df-abc", None);
        assert!(!plain.contains("--alias"));
    }

    #[test]
    fn docker_update_labels_recreates_not_label_add() {
        let labels = json!({"traefik.enable": "true"});
        let cmd = docker_update_labels("df-fbb6a152-ef0", &labels);
        assert!(cmd.contains("docker run"));
        assert!(!cmd.contains("--label-add"));
        assert!(cmd.contains("traefik.enable"));
    }

    #[test]
    fn docker_recreate_network_template_has_space_after_comma() {
        let labels = json!({"traefik.enable": "true"});
        let cmd = docker_recreate_with_labels("test-container", &labels);
        assert!(
            cmd.contains(r"{{range \$k, \$v := .NetworkSettings.Networks}}"),
            "Network template must have space after comma to avoid Docker template parse error"
        );
        assert!(
            !cmd.contains(r"{{range \$k,\$v :="),
            "Network template should not have comma without space"
        );
        assert!(
            !cmd.contains("inspect -f '"),
            "docker inspect templates must stay inside the outer sh -c single quotes"
        );
        assert!(
            cmd.contains("IFS=\"|\""),
            "mount parser must not break the outer sh -c quotes"
        );
        assert!(
            cmd.contains(r"\$k, \$v"),
            "docker template variables must be escaped inside double quotes"
        );
        assert!(
            cmd.contains(r"\$p, \$conf"),
            "port template variables must be escaped inside double quotes"
        );
    }

    #[test]
    fn docker_recreate_preserves_host_labels_with_backticks() {
        let labels = json!({
            "traefik.enable": "true",
            "traefik.http.routers.test.rule": "Host(`starbasefr.jeser.app`)"
        });
        let cmd = docker_recreate_with_labels("df-test", &labels);
        assert!(
            cmd.contains("Host(`starbasefr.jeser.app`)"),
            "Host label with backticks must survive in heredoc"
        );
        // Must use positional params (set -- "$@" ...) not LABEL_ARGS variable
        assert!(
            cmd.contains("set -- \"$@\" --label"),
            "Must use positional parameters to protect backticks from command substitution"
        );
        assert!(
            !cmd.contains("LABEL_ARGS=") || cmd.contains("set -- "),
            "If using intermediate storage, must switch to positional params before docker run"
        );
    }

    #[test]
    fn docker_recreate_uses_network_when_not_bridge() {
        let labels = json!({"traefik.enable": "true"});
        let cmd = docker_recreate_with_labels("test-app", &labels);
        assert!(
            cmd.contains(r#"[ "$NET" != "bridge" ]"#),
            "Should skip --network flag if bridge (default network)"
        );
        assert!(
            cmd.contains("--network \"$NET\"") || cmd.contains(r#"set -- "$@" --network "$NET""#),
            "Should add --network argument for non-bridge networks"
        );
    }

    #[test]
    fn docker_recreate_with_traefik_host_labels_shell_valid() {
        // Regression test: Traefik Host(`fqdn`) labels with backticks/parentheses
        // must not break POSIX shell syntax when embedded in sh -c '...'
        let labels = traefik_labels("fbb6a152-ef01", "starbasefr.jeser.app", "/", 4321, None);
        let cmd = docker_recreate_with_labels("df-fbb6a152-ef0", &labels);

        // Write the generated script to a temp file and validate with sh -n
        let temp_dir = std::env::temp_dir();
        let script_path = temp_dir.join("test_recreate_labels.sh");
        std::fs::write(&script_path, &cmd).expect("failed to write test script");

        let output = std::process::Command::new("sh")
            .arg("-n")
            .arg(&script_path)
            .output()
            .expect("failed to run sh -n");

        std::fs::remove_file(&script_path).ok();

        assert!(
            output.status.success(),
            "Generated shell script has syntax errors:\n{}\n\nScript:\n{}",
            String::from_utf8_lossy(&output.stderr),
            cmd
        );

        // Verify the script contains expected Traefik labels
        assert!(cmd.contains("starbasefr.jeser.app"));
        assert!(cmd.contains("4321"));
    }

    #[test]
    fn docker_recreate_multi_host_labels_shell_valid() {
        // Test multiple hosts with complex Traefik rules
        let labels = traefik_labels_for_routes(
            "fbb6a152-ef01",
            &[
                ("starbasefr.jeser.app", "/", 4321),
                ("starbasefr.com", "/api", 4321),
            ],
            None,
        );
        let cmd = docker_recreate_with_labels("df-fbb6a152-ef0", &labels);

        let temp_dir = std::env::temp_dir();
        let script_path = temp_dir.join("test_recreate_multi_labels.sh");
        std::fs::write(&script_path, &cmd).expect("failed to write test script");

        let output = std::process::Command::new("sh")
            .arg("-n")
            .arg(&script_path)
            .output()
            .expect("failed to run sh -n");

        std::fs::remove_file(&script_path).ok();

        assert!(
            output.status.success(),
            "Multi-host script has syntax errors:\n{}\n\nScript:\n{}",
            String::from_utf8_lossy(&output.stderr),
            cmd
        );

        assert!(cmd.contains("starbasefr.jeser.app"));
        assert!(cmd.contains("starbasefr.com"));
    }

    #[test]
    fn docker_recreate_with_sso_middleware_shell_valid() {
        // Test ForwardAuth SSO middleware labels (contains && in Traefik rules potentially)
        let labels = traefik_labels(
            "fbb6a152-ef01",
            "secure.example.com",
            "/",
            8080,
            Some("http://oauth2-proxy:4180/auth"),
        );
        let cmd = docker_recreate_with_labels("df-secure", &labels);

        let temp_dir = std::env::temp_dir();
        let script_path = temp_dir.join("test_recreate_sso_labels.sh");
        std::fs::write(&script_path, &cmd).expect("failed to write test script");

        let output = std::process::Command::new("sh")
            .arg("-n")
            .arg(&script_path)
            .output()
            .expect("failed to run sh -n");

        std::fs::remove_file(&script_path).ok();

        assert!(
            output.status.success(),
            "SSO middleware script has syntax errors:\n{}\n\nScript:\n{}",
            String::from_utf8_lossy(&output.stderr),
            cmd
        );

        assert!(cmd.contains("forwardauth.address"));
    }

    #[test]
    fn shell_escape_preserves_simple_values() {
        // Ensure simple labels still work without unnecessary quoting
        assert_eq!(shell_escape("traefik.enable"), "traefik.enable");
        assert_eq!(shell_escape("true"), "true");
        assert_eq!(shell_escape("df-fbb6a152"), "df-fbb6a152");
        assert_eq!(shell_escape("4321"), "4321");
        assert_eq!(shell_escape("/api/v1"), "/api/v1");
    }

    #[test]
    fn shell_escape_handles_special_chars() {
        // Complex values should be quoted
        assert!(shell_escape("Host(`example.com`)").contains('\''));
        assert!(shell_escape("value with spaces").contains('\''));
        assert!(shell_escape("a && b").contains('\''));
    }

    #[test]
    fn probe_engine_returns_status() {
        let s = probe_engine();
        assert!(!s.hint.is_empty());
        if s.ok {
            assert!(s.version.is_some());
        }
    }
}
