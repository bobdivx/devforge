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

pub fn nixpacks_build(image: &str) -> String {
    format!("nixpacks build . --name {}", shell_escape(image))
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

/// Traefik labels (entrypoints http/https — compatible Traefik v3 local/NAS).
pub fn traefik_labels(project_uuid: &str, host: &str, path_prefix: &str, port: u16) -> Value {
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
        Value::String(router),
    );
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
