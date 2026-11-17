//! Routes Traefik de secours quand plusieurs nœuds partagent un tunnel Cloudflare.
//!
//! Le modèle normal est un tunnel `devforge-{nœud}` et un CNAME vers CE tunnel.
//! Si deux `cloudflared` se connectent au même tunnel, Cloudflare répartit les
//! requêtes : le Traefik du mauvais nœud répond 404. Chaque nœud écrit alors
//! une route fichier de priorité basse, par hostname, vers le proxy du nœud
//! qui héberge l'app (sinon le leader). Un nœud ne se renvoie jamais à lui-même.
//! L'en-tête `X-DevForge-Forwarded` empêche une seconde transmission.
//!
//! Le fichier manuel `zz-fallback-nas.yml` (PathPrefix `/` vers le NAS) est
//! retiré : ces routes le remplacent.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::time::Duration;

use devforge_cluster::{NodeStatus, LEADER_NODE_ID};

use crate::state::AppState;

pub const FORWARD_FILE: &str = "devforge-peer-forward.yaml";
pub const HOTFIX_FILE: &str = "zz-fallback-nas.yml";
pub const FORWARDED_HEADER: &str = "X-DevForge-Forwarded";
const TRAEFIK: &str = "devforge-traefik";
const LOOP_SECS: u64 = 60;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NodeRef {
    pub id: String,
    pub advertise_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostPlace {
    pub fqdn: String,
    pub node_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Forward {
    pub fqdn: String,
    pub upstream: String,
}

pub fn sanitize_fqdn(raw: &str) -> Option<String> {
    let s = raw.trim().trim_end_matches('.').to_ascii_lowercase();
    if s.len() < 3 || s.len() > 253 || !s.contains('.') {
        return None;
    }
    if !s
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
    {
        return None;
    }
    if s.starts_with('.') || s.ends_with('.') || s.contains("..") {
        return None;
    }
    Some(s)
}

fn upstream_of(node: Option<&NodeRef>) -> Option<String> {
    let node = node?;
    if devforge_cluster::is_loopback_advertise_url(&node.advertise_url) {
        return None;
    }
    let host = crate::control_pg::advertise_host(&node.advertise_url)?;
    if host.eq_ignore_ascii_case("localhost") {
        return None;
    }
    Some(format!("http://{host}:80"))
}

fn same_host(upstream: &str, advertise: &str) -> bool {
    let Some(a) = crate::control_pg::advertise_host(upstream) else {
        return false;
    };
    let Some(b) = crate::control_pg::advertise_host(advertise) else {
        return false;
    };
    a.eq_ignore_ascii_case(&b)
}

/// Routes pour le nœud `me` : hôtes qu'il n'héberge pas, vers le nœud propriétaire
/// ou, à défaut, le leader. Jamais vers soi.
pub fn plan(me: &str, nodes: &[NodeRef], hosts: &[HostPlace]) -> Vec<Forward> {
    let me = me.trim();
    let i_am_origin = me.is_empty() || me == LEADER_NODE_ID;
    let by_id: HashMap<&str, &NodeRef> = nodes.iter().map(|n| (n.id.as_str(), n)).collect();
    let mine = by_id.get(me).copied();
    let mut seen = HashSet::new();
    let mut ranked: Vec<&HostPlace> = hosts.iter().collect();
    ranked.sort_by(|a, b| a.fqdn.cmp(&b.fqdn).then(a.node_id.cmp(&b.node_id)));
    let mut out = Vec::new();
    for h in ranked {
        let Some(fqdn) = sanitize_fqdn(&h.fqdn) else {
            continue;
        };
        if !seen.insert(fqdn.clone()) {
            continue;
        }
        let owner = h.node_id.trim();
        let owner_is_me = owner == me
            || (owner.is_empty() && i_am_origin)
            || (owner == LEADER_NODE_ID && i_am_origin);
        if owner_is_me {
            continue;
        }
        let direct = upstream_of(by_id.get(owner).copied());
        let upstream = direct.or_else(|| {
            if i_am_origin {
                None
            } else {
                upstream_of(by_id.get(LEADER_NODE_ID).copied())
            }
        });
        let Some(upstream) = upstream else {
            continue;
        };
        if mine.is_some_and(|n| same_host(&upstream, &n.advertise_url)) {
            continue;
        }
        out.push(Forward { fqdn, upstream });
    }
    out
}

pub fn forward_yaml(routes: &[Forward]) -> Option<String> {
    if routes.is_empty() {
        return None;
    }
    let mut y = String::from(
        "\
# DevForge : secours multi-nœud (priorité basse, les routeurs Docker locaux gagnent).
# Remplace zz-fallback-nas.yml. Ne pas réécrire à la main.
http:
  middlewares:
    devforge-forwarded:
      headers:
        customRequestHeaders:
          X-DevForge-Forwarded: \"1\"
  routers:\n",
    );
    for (i, r) in routes.iter().enumerate() {
        let rule = format!(
            "Host(`{fqdn}`) && !Header(`{FORWARDED_HEADER}`, `1`)",
            fqdn = r.fqdn
        );
        for (ep, tls) in [("http", ""), ("https", "\n      tls: {}")] {
            y.push_str(&format!(
                "\
    df-fwd-{i}-{ep}:
      rule: \"{rule}\"
      entryPoints:
        - {ep}
      priority: 1
      middlewares:
        - devforge-forwarded
      service: df-fwd-{i}{tls}
"
            ));
        }
    }
    y.push_str("  services:\n");
    for (i, r) in routes.iter().enumerate() {
        y.push_str(&format!(
            "\
    df-fwd-{i}:
      loadBalancer:
        passHostHeader: true
        servers:
          - url: \"{url}\"
",
            url = r.upstream
        ));
    }
    Some(y)
}

pub fn dynamic_sync_shell(yaml: Option<&str>) -> String {
    let rm = format!(
        "docker exec {TRAEFIK} rm -f /traefik/dynamic/{HOTFIX_FILE} /traefik/dynamic/{FORWARD_FILE} >/dev/null 2>&1 || true"
    );
    match yaml {
        None => rm,
        Some(body) => {
            let b64 = base64_encode(body.as_bytes());
            format!(
                "{rm}\necho {b64} | base64 -d | docker exec -i {TRAEFIK} sh -c 'mkdir -p /traefik/dynamic && cat > /traefik/dynamic/{FORWARD_FILE}'"
            )
        }
    }
}

pub fn spawn_loop(state: AppState) {
    if devforge_shared::runtime_backend::RuntimeBackend::from_env().is_kubernetes() {
        return;
    }
    tokio::spawn(async move {
        loop {
            sync_once(&state).await;
            tokio::time::sleep(Duration::from_secs(LOOP_SECS)).await;
        }
    });
}

pub async fn sync_once(state: &AppState) {
    let Ok(local) = state.cluster.local().await else {
        return;
    };
    if local.writes_fenced {
        return;
    }
    let nodes = state.cluster.list_nodes().await.unwrap_or_default();
    let mut refs: Vec<NodeRef> = nodes
        .iter()
        .map(|n| NodeRef {
            id: n.id.clone(),
            advertise_url: n.advertise_url.clone(),
        })
        .collect();
    if !refs.iter().any(|n| n.id == local.node_id) {
        refs.push(NodeRef {
            id: local.node_id.clone(),
            advertise_url: local.advertise_url.clone(),
        });
    }
    let hosts = collect_hosts(state, &local.node_id).await;
    let mut targets: BTreeSet<String> = refs.iter().map(|n| n.id.clone()).collect();
    if targets.is_empty() {
        targets.insert(local.node_id.clone());
    }
    for n in &nodes {
        if n.status == NodeStatus::Offline && n.id != local.node_id {
            targets.remove(&n.id);
        }
    }
    for sid in targets {
        let routes = plan(&sid, &refs, &hosts);
        let yaml = forward_yaml(&routes);
        let cmd = dynamic_sync_shell(yaml.as_deref());
        match state.deploy.exec(&sid, "", &cmd, 30).await {
            Ok(r) if r.ok => {
                if !routes.is_empty() {
                    tracing::info!(
                        node = %sid,
                        routes = routes.len(),
                        "routes Traefik de secours (tunnel partagé)"
                    );
                }
            }
            Ok(r) => tracing::warn!(
                node = %sid,
                output = %r.output.trim(),
                "routes Traefik de secours non écrites"
            ),
            Err(e) => tracing::warn!(node = %sid, error = %e, "routes Traefik de secours"),
        }
    }
}

async fn collect_hosts(state: &AppState, control_plane_node: &str) -> Vec<HostPlace> {
    let mut hosts = Vec::new();
    for d in crate::dns::managed_domains(state).await {
        let fqdn = d["fqdn"].as_str().unwrap_or("");
        let node = d["node_id"].as_str().unwrap_or(LEADER_NODE_ID);
        if let Some(fqdn) = sanitize_fqdn(fqdn) {
            hosts.push(HostPlace {
                fqdn,
                node_id: node.to_string(),
            });
        }
    }
    let devs: Vec<(Option<String>, Option<String>, String, Option<String>)> = sqlx::query_as(
        r#"SELECT NULLIF(trim(COALESCE(server_id, '')), ''),
                  production_url,
                  COALESCE(domain_apex, ''),
                  NULLIF(trim(COALESCE(dev_branch, '')), '')
           FROM projects"#,
    )
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();
    for (server, url, apex, dev_branch) in devs {
        if dev_branch.is_none() {
            continue;
        }
        let Some(prod) = url.as_deref().and_then(crate::routes::fqdn_from_url) else {
            continue;
        };
        let apex = if apex.trim().is_empty() {
            None
        } else {
            Some(apex.as_str())
        };
        if let Some(fqdn) = crate::dev_env::dev_fqdn(&prod, apex).and_then(|f| sanitize_fqdn(&f)) {
            hosts.push(HostPlace {
                fqdn,
                node_id: server.unwrap_or_else(|| LEADER_NODE_ID.into()),
            });
        }
    }
    let previews: Vec<(Option<String>, Option<String>)> = sqlx::query_as(
        r#"SELECT NULLIF(trim(COALESCE(p.server_id, '')), ''), r.url
           FROM pr_previews r
           JOIN projects p ON p.uuid = r.project_uuid
           WHERE r.status = 'ready'"#,
    )
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();
    for (server, url) in previews {
        let Some(fqdn) = url
            .as_deref()
            .and_then(crate::routes::fqdn_from_url)
            .and_then(|f| sanitize_fqdn(&f))
        else {
            continue;
        };
        hosts.push(HostPlace {
            fqdn,
            node_id: server.unwrap_or_else(|| LEADER_NODE_ID.into()),
        });
    }
    if let Some(fqdn) = control_plane_fqdn(state)
        .await
        .and_then(|f| sanitize_fqdn(&f))
    {
        hosts.push(HostPlace {
            fqdn,
            node_id: control_plane_node.to_string(),
        });
    }
    hosts
}

async fn control_plane_fqdn(state: &AppState) -> Option<String> {
    let row: Option<(Option<String>,)> =
        sqlx::query_as("SELECT instance_url FROM instance_settings WHERE id = 1")
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten();
    row.and_then(|r| r.0)
        .and_then(|u| crate::routes::fqdn_from_url(u.trim()))
}

fn base64_encode(data: &[u8]) -> String {
    const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b = [
            chunk[0] as u32,
            *chunk.get(1).unwrap_or(&0) as u32,
            *chunk.get(2).unwrap_or(&0) as u32,
        ];
        let n = (b[0] << 16) | (b[1] << 8) | b[2];
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            T[((n >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            T[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn nas() -> NodeRef {
        NodeRef {
            id: "default".into(),
            advertise_url: "http://10.1.0.58:8000".into(),
        }
    }
    fn demeter() -> NodeRef {
        NodeRef {
            id: "node_5658218ef601".into(),
            advertise_url: "http://10.1.0.40:8000".into(),
        }
    }

    #[test]
    fn remote_host_goes_to_its_node_port_80() {
        let nodes = vec![nas(), demeter()];
        let hosts = vec![
            HostPlace {
                fqdn: "popcorn.example.com".into(),
                node_id: "default".into(),
            },
            HostPlace {
                fqdn: "local.example.com".into(),
                node_id: "node_5658218ef601".into(),
            },
        ];
        let routes = plan("node_5658218ef601", &nodes, &hosts);
        assert_eq!(routes.len(), 1);
        assert_eq!(routes[0].fqdn, "popcorn.example.com");
        assert_eq!(routes[0].upstream, "http://10.1.0.58:80");
        let back = plan("default", &nodes, &hosts);
        assert_eq!(back.len(), 1);
        assert_eq!(back[0].fqdn, "local.example.com");
        assert_eq!(back[0].upstream, "http://10.1.0.40:80");
    }

    #[test]
    fn loopback_owner_falls_back_to_leader_except_on_the_leader() {
        let nodes = vec![
            nas(),
            NodeRef {
                id: "node_aabbccddeeff".into(),
                advertise_url: "http://127.0.0.1:8000".into(),
            },
        ];
        let hosts = vec![HostPlace {
            fqdn: "orphan.example.com".into(),
            node_id: "node_aabbccddeeff".into(),
        }];
        let from_demeter = plan("node_5658218ef601", &nodes, &hosts);
        assert_eq!(from_demeter[0].upstream, "http://10.1.0.58:80");
        assert!(plan("default", &nodes, &hosts).is_empty());
    }

    #[test]
    fn rejects_unsafe_names_and_does_not_use_a_catch_all() {
        let nodes = vec![nas(), demeter()];
        let hosts = vec![HostPlace {
            fqdn: "bad`name.example.com".into(),
            node_id: "default".into(),
        }];
        assert!(plan("node_5658218ef601", &nodes, &hosts).is_empty());
        let yaml = forward_yaml(&plan(
            "node_5658218ef601",
            &nodes,
            &[HostPlace {
                fqdn: "app.example.com".into(),
                node_id: "default".into(),
            }],
        ))
        .unwrap();
        assert!(yaml.contains("X-DevForge-Forwarded"));
        assert!(yaml.contains("!Header(`X-DevForge-Forwarded`, `1`)"));
        assert!(yaml.contains("priority: 1"));
        assert!(yaml.contains("http://10.1.0.58:80"));
        assert!(!yaml.contains("PathPrefix"));
        let shell = dynamic_sync_shell(Some(&yaml));
        assert!(shell.contains(HOTFIX_FILE));
        assert!(shell.contains(FORWARD_FILE));
        assert!(dynamic_sync_shell(None).contains(HOTFIX_FILE));
        assert!(!dynamic_sync_shell(None).contains("base64"));
    }
}
