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
  RULES=$(docker inspect "$cid" --format "{{{{range $k, $v := .Config.Labels}}}}{{{{if contains $k \"traefik.http.routers.\"}}}}{{{{if contains $k \".rule\"}}}}{{{{println $v}}}}{{{{end}}}}{{{{end}}}}{{{{end}}}}" 2>/dev/null || echo "")
  
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
    NET=$(docker inspect "$cid" --format "{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}" 2>/dev/null | grep -v "^bridge$" | head -n1)
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
    NET=$(docker inspect "$cid" --format "{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}" 2>/dev/null | grep -v "^bridge$" | head -n1)
    if [ -n "$NET" ]; then
      echo "$NET"
      exit 0
    fi
  fi
done

# Strategy 3: Containers publishing port 80 or 443 (likely reverse proxy)
for port in 80 443; do
  for cid in $(docker ps -q --filter "publish=$port" 2>/dev/null); do
    NET=$(docker inspect "$cid" --format "{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}" 2>/dev/null | grep -v "^bridge$" | head -n1)
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
    NET=$(docker inspect "$cid" --format "{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}" 2>/dev/null | grep -v "^bridge$" | head -n1)
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
    NET=$(docker inspect "$cid" --format "{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}" 2>/dev/null | grep -v "^bridge$" | head -n1)
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
NET=$(docker inspect -f "{{{{range $k, $v := .NetworkSettings.Networks}}}}{{{{println $k}}}}{{{{end}}}}" "$N" | head -n1)
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
for spec in $(docker inspect -f "{{{{range $p, $conf := .HostConfig.PortBindings}}}}{{{{range $conf}}}}{{{{.HostPort}}}}:{{{{$p}}}} {{{{end}}}}{{{{end}}}}" "$N"); do
  [ -n "$spec" ] && set -- "$@" -p "$spec"
done

# Add env file
set -- "$@" --env-file "$ENV_FILE"

# Add image
set -- "$@" "$IMG"

docker stop "$N" >/dev/null
docker rm -f "$N" >/dev/null
docker run "$@"
rm -f "$ENV_FILE" "$LABEL_FILE"
echo "recreated $N with traefik labels"
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
    let service = format!("df-{short}");
    let router = format!("df-{short}-{}", host_router_key(host));
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
        Value::String(service.clone()),
    );
    map.insert(
        format!("traefik.http.routers.https-{router}.service"),
        Value::String(service),
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
        let piece = traefik_labels(
            project_uuid,
            host,
            path,
            *port,
            forward_auth_address,
        );
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
    use super::*;
    use serde_json::json;

    #[test]
    fn preview_url_isolation_prevents_production_host_theft() {
        // Cas d'usage : un conteneur df-* local/preview ne doit JAMAIS avoir
        // des labels pour starbasefr.jeser.app (production), seulement pour preview-xxx
        let preview_host = "preview-fbb6a152.devforge.local";
        let production_host = "starbasefr.jeser.app";
        
        let preview_labels = traefik_labels("fbb6a152-ef01", preview_host, "/", 4321, None);
        
        // Vérifier que le label preview existe
        let preview_rule_key = format!(
            "traefik.http.routers.http-df-fbb6a152-preview-fbb6a152-devforge-local.rule"
        );
        assert!(
            preview_labels.get(&preview_rule_key).is_some(),
            "Preview host doit avoir un router Traefik"
        );
        assert_eq!(
            preview_labels.get(&preview_rule_key).and_then(|v| v.as_str()),
            Some("Host(`preview-fbb6a152.devforge.local`)"),
            "Preview router doit pointer vers l'hôte preview"
        );
        
        // Vérifier qu'aucun label production n'existe dans les labels preview
        let production_rule_key = format!(
            "traefik.http.routers.http-df-fbb6a152-starbasefr-jeser-app.rule"
        );
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
            cmd.contains("{{range $k, $v := .NetworkSettings.Networks}}"),
            "Network template must have space after comma to avoid Docker template parse error"
        );
        assert!(
            !cmd.contains("{{range $k,$v :="),
            "Network template should not have comma without space"
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
        let labels = traefik_labels(
            "fbb6a152-ef01",
            "starbasefr.jeser.app",
            "/",
            4321,
            None,
        );
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
}
