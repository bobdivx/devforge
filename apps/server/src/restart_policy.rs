//! Politique `unless-stopped` et relance après reboot du démon Docker.
//!
//! Les `docker run` des apps portent déjà `--restart unless-stopped`. Les
//! conteneurs créés avant (politique `no`) restent `Exited (255)` quand le
//! nœud redémarre. Au boot, et toutes les minutes, on aligne la politique et
//! on redémarre le conteneur vivant du projet — sauf arrêt voulu
//! (`stopped` / `paused`, ou `draft` / `deploying` pour une app).

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::time::Duration;

use devforge_cluster::NodeStatus;
use devforge_deploy::RuntimeSpec;

use crate::state::AppState;

pub const POLICY: &str = "unless-stopped";
const LOOP_SECS: u64 = 60;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RestartItem {
    pub name: String,
    pub should_run: bool,
}

/// Arrêt voulu par l'utilisateur (ou pause). On ne relance pas.
pub fn user_kept_down(status: &str) -> bool {
    matches!(
        status.trim().to_ascii_lowercase().as_str(),
        "stopped" | "paused"
    )
}

/// App à relancer : pas un brouillon, pas un déploiement en cours, pas un arrêt voulu.
pub fn app_should_run(status: &str, busy: bool) -> bool {
    if busy || user_kept_down(status) {
        return false;
    }
    !matches!(
        status.trim().to_ascii_lowercase().as_str(),
        "draft" | "deploying"
    )
}

/// Postgres / runner : seulement l'arrêt voulu (un brouillon peut avoir une base).
pub fn service_should_run(status: &str, busy: bool) -> bool {
    !busy && !user_kept_down(status)
}

pub fn safe_container_name(name: &str) -> bool {
    let b = name.as_bytes();
    if b.is_empty() || b.len() > 128 {
        return false;
    }
    b[0].is_ascii_alphanumeric()
        && b.iter()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'.' | b'-'))
}

pub fn reconcile_script(items: &[RestartItem]) -> String {
    let mut s = format!(
        "set +e\n\
fix() {{\n\
  n=\"$1\"\n\
  want=\"$2\"\n\
  pol=$(docker inspect -f '{{{{.HostConfig.RestartPolicy.Name}}}}' \"$n\" 2>/dev/null) || return 0\n\
  if [ \"$pol\" != \"{POLICY}\" ]; then\n\
    docker update --restart={POLICY} \"$n\" >/dev/null 2>&1 || true\n\
    echo \"policy $n\"\n\
  fi\n\
  if [ \"$want\" = \"1\" ]; then\n\
    run=$(docker inspect -f '{{{{.State.Running}}}}' \"$n\" 2>/dev/null || echo false)\n\
    if [ \"$run\" != \"true\" ]; then\n\
      docker start \"$n\" >/dev/null 2>&1 && echo \"started $n\" || true\n\
    fi\n\
  fi\n\
}}\n"
    );
    for item in items {
        if !safe_container_name(&item.name) || item.name.ends_with("-new") {
            continue;
        }
        let want = if item.should_run { "1" } else { "0" };
        s.push_str(&format!("fix {} {want}\n", item.name));
    }
    s.push_str(
        r#"docker ps -a --format '{{.Names}}' 2>/dev/null | while read -r n; do
  case "$n" in
    devforge-sso-*|devforge-keeper|devforge-keeper-*)
      fix "$n" 1
      ;;
  esac
done
true
"#,
    );
    s
}

fn sidecar_names(runtime_json: &str) -> Vec<String> {
    RuntimeSpec::from_json(runtime_json)
        .map(|s| s.sidecars.into_iter().map(|side| side.name).collect())
        .unwrap_or_default()
}

fn remember(
    map: &mut BTreeMap<String, BTreeMap<String, bool>>,
    server: &str,
    name: &str,
    should_run: bool,
) {
    if !safe_container_name(name) || name.ends_with("-new") {
        return;
    }
    let sid = {
        let t = server.trim();
        if t.is_empty() {
            "default"
        } else {
            t
        }
    };
    map.entry(sid.to_string())
        .or_default()
        .entry(name.to_string())
        .and_modify(|cur| *cur = *cur && should_run)
        .or_insert(should_run);
}

pub fn spawn_loop(state: AppState) {
    if devforge_shared::runtime_backend::RuntimeBackend::from_env().is_kubernetes() {
        return;
    }
    tokio::spawn(async move {
        loop {
            reconcile_once(&state).await;
            tokio::time::sleep(Duration::from_secs(LOOP_SECS)).await;
        }
    });
}

pub async fn reconcile_once(state: &AppState) {
    let plan = match collect(state).await {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!(error = %e, "relance conteneurs : lecture");
            return;
        }
    };
    let mut servers: BTreeSet<String> = plan.keys().cloned().collect();
    if let Ok(nodes) = state.cluster.list_nodes().await {
        for n in nodes {
            if n.status == NodeStatus::Offline {
                continue;
            }
            servers.insert(n.id);
        }
    }
    if servers.is_empty() {
        servers.insert("default".into());
    }
    for sid in servers {
        let items: Vec<RestartItem> = plan
            .get(&sid)
            .map(|m| {
                m.iter()
                    .map(|(name, should_run)| RestartItem {
                        name: name.clone(),
                        should_run: *should_run,
                    })
                    .collect()
            })
            .unwrap_or_default();
        let script = reconcile_script(&items);
        match state.deploy.exec(&sid, "", &script, 120).await {
            Ok(r) => {
                let out = r.output.trim();
                if !out.is_empty() {
                    tracing::info!(node = %sid, %out, "relance conteneurs");
                }
            }
            Err(e) => tracing::warn!(node = %sid, error = %e, "relance conteneurs"),
        }
    }
}

async fn collect(state: &AppState) -> Result<BTreeMap<String, BTreeMap<String, bool>>, String> {
    let mut map = BTreeMap::new();

    let projects: Vec<(i64, String, String, Option<String>, String, Option<String>)> =
        sqlx::query_as(
            r#"SELECT id, uuid, COALESCE(status, ''),
                      NULLIF(trim(COALESCE(server_id, '')), ''),
                      COALESCE(runtime_json, '{}'),
                      NULLIF(trim(COALESCE(dev_branch, '')), '')
               FROM projects"#,
        )
        .fetch_all(&state.pool)
        .await
        .map_err(|e| e.to_string())?;

    let busy_rows: Vec<(i64, String)> = sqlx::query_as(
        r#"SELECT project_id, COALESCE(environment, 'production')
           FROM deployments
           WHERE status IN ('running', 'queued', 'building', 'pending', 'deploying')"#,
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| e.to_string())?;
    let mut busy: HashMap<i64, HashSet<String>> = HashMap::new();
    for (id, env) in busy_rows {
        busy.entry(id).or_default().insert(env);
    }

    for (id, uuid, status, server, runtime_json, dev_branch) in &projects {
        let server = server.as_deref().unwrap_or("default");
        let envs = busy.get(id);
        let prod_busy = envs.is_some_and(|s| {
            s.iter()
                .any(|e| e.eq_ignore_ascii_case("production") || e.is_empty())
        });
        let run = app_should_run(status, prod_busy);
        let app = devforge_deploy::project_container_name(uuid);
        remember(&mut map, server, &app, run);
        for side in sidecar_names(runtime_json) {
            let name = format!("{app}-{side}");
            remember(&mut map, server, &name, run);
        }
        if dev_branch.is_some() {
            let dev_busy = envs.is_some_and(|s| s.iter().any(|e| e.eq_ignore_ascii_case("dev")));
            let dev_run = app_should_run(status, dev_busy);
            let dev = crate::dev_env::dev_container_name(uuid);
            remember(&mut map, server, &dev, dev_run);
        }
    }

    let previews: Vec<(String, i32, Option<String>)> = sqlx::query_as(
        r#"SELECT r.project_uuid, r.pr_number,
                  NULLIF(trim(COALESCE(p.server_id, '')), '')
           FROM pr_previews r
           JOIN projects p ON p.uuid = r.project_uuid
           WHERE r.status = 'ready'"#,
    )
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();
    for (uuid, pr, server) in previews {
        let server = server.as_deref().unwrap_or("default");
        let env = crate::pr_previews::preview_environment(i64::from(pr));
        let busy_env = projects
            .iter()
            .find(|p| p.1 == uuid)
            .is_some_and(|p| busy.get(&p.0).is_some_and(|s| s.iter().any(|e| e == &env)));
        // Une preview prête ne suit pas l'arrêt de l'app de production.
        let run = service_should_run("live", busy_env);
        let name = crate::pr_previews::preview_container_name(&uuid, i64::from(pr));
        remember(&mut map, server, &name, run);
    }

    let runners: Vec<(String, String, i64)> = sqlx::query_as(
        r#"SELECT COALESCE(NULLIF(trim(server_id), ''), 'default'),
                  container_name, COALESCE(enabled, 0)
           FROM managed_runners"#,
    )
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();
    for (server, name, enabled) in runners {
        remember(&mut map, &server, &name, enabled != 0);
    }

    let pgs: Vec<(String, String, String)> = sqlx::query_as(
        r#"SELECT COALESCE(NULLIF(trim(server_id), ''), 'default'),
                  resource_id, COALESCE(meta_json, '{}')
           FROM project_resource_links
           WHERE provider = 'postgres'"#,
    )
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();
    for (server, container, meta_json) in pgs {
        // L'action stop n'arrête que le conteneur d'app, pas la base.
        let run = service_should_run("live", false);
        remember(&mut map, &server, &container, run);
        if let Ok(meta) = serde_json::from_str::<serde_json::Value>(&meta_json) {
            let standby_server = meta
                .get("standby_server_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if !standby_server.is_empty() && safe_container_name(&container) {
                remember(&mut map, &standby_server, &format!("{container}-ha"), run);
            }
        }
    }

    Ok(map)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stopped_and_paused_are_not_restarted() {
        assert!(user_kept_down("stopped"));
        assert!(user_kept_down("Paused"));
        assert!(!user_kept_down("live"));
        assert!(!user_kept_down("unhealthy"));
        assert!(!user_kept_down("failed"));
        assert!(!app_should_run("stopped", false));
        assert!(!app_should_run("paused", false));
        assert!(!app_should_run("draft", false));
        assert!(!app_should_run("deploying", false));
        assert!(!app_should_run("live", true));
        assert!(app_should_run("live", false));
        assert!(app_should_run("unhealthy", false));
        assert!(app_should_run("unrouted", false));
        assert!(app_should_run("failed", false));
        assert!(service_should_run("draft", false));
        assert!(!service_should_run("stopped", false));
    }

    #[test]
    fn script_sets_policy_and_starts_only_wanted() {
        let script = reconcile_script(&[
            RestartItem {
                name: "df-abcdef123456".into(),
                should_run: true,
            },
            RestartItem {
                name: "df-stopped0001".into(),
                should_run: false,
            },
            RestartItem {
                name: "df-evil;rm".into(),
                should_run: true,
            },
            RestartItem {
                name: "df-abcdef123456-new".into(),
                should_run: true,
            },
        ]);
        assert!(script.contains("unless-stopped"));
        assert!(script.contains("docker start"));
        assert!(script.contains("fix df-abcdef123456 1"));
        assert!(script.contains("fix df-stopped0001 0"));
        assert!(!script.contains("df-evil"));
        assert!(!script.contains("df-abcdef123456-new"));
        assert!(script.contains("devforge-sso-*"));
        assert!(script.contains("devforge-keeper"));
    }
}
