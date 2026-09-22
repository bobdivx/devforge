//! Placement soft des forges sur les nœuds cluster.

use crate::models::{ClusterNode, NodeRole, NodeStatus};

/// True si l’URL pointe vers une machine injoignable depuis le leader (loopback).
pub fn is_loopback_host(host: &str) -> bool {
    let h = host.trim().trim_matches(|c| c == '[' || c == ']').to_ascii_lowercase();
    h == "localhost"
        || h == "127.0.0.1"
        || h == "::1"
        || h == "0.0.0.0"
        || h.ends_with(".localhost")
}

/// Extrait host:port d’une URL http(s).
pub fn url_host(url: &str) -> Option<String> {
    let u = url.trim();
    let rest = u
        .strip_prefix("https://")
        .or_else(|| u.strip_prefix("http://"))?;
    let hostport = rest.split('/').next().unwrap_or("").split('@').last()?;
    if hostport.is_empty() {
        return None;
    }
    Some(hostport.to_string())
}

pub fn is_loopback_advertise_url(url: &str) -> bool {
    url_host(url)
        .map(|hp| {
            // IPv6 bracketé : [::<host>] ou [::1]:port
            if let Some(inner) = hp.strip_prefix('[') {
                let host = inner.split(']').next().unwrap_or("");
                return is_loopback_host(host);
            }
            // host:port (IPv4 / hostname) — ne pas couper trop tôt sur IPv6 nu
            let host = if hp.matches(':').count() == 1 {
                hp.split(':').next().unwrap_or(hp.as_str())
            } else {
                hp.as_str()
            };
            is_loopback_host(host)
        })
        .unwrap_or(false)
}

/// Valide une URL d’annonce worker (joignable depuis le leader).
pub fn validate_worker_advertise_url(raw: &str) -> Result<String, String> {
    let u = raw.trim().trim_end_matches('/');
    if u.is_empty() {
        return Err("URL d’annonce requise pour un worker (pas 127.0.0.1)".into());
    }
    if !(u.starts_with("http://") || u.starts_with("https://")) {
        return Err("URL invalide — http:// ou https://".into());
    }
    if is_loopback_advertise_url(u) {
        return Err(
            "URL d’annonce loopback interdite (127.0.0.1 / localhost) — utilise l’IP LAN ou un hostname joignable depuis le leader"
                .into(),
        );
    }
    Ok(u.into())
}

#[derive(Debug, Clone)]
pub struct PlacementWeights {
    pub app_penalty: f64,
    pub cpu_penalty: f64,
    pub mem_penalty: f64,
    pub leader_penalty_if_workers: f64,
    pub empty_ingress_penalty: f64,
}

impl Default for PlacementWeights {
    fn default() -> Self {
        Self {
            app_penalty: 10.0,
            cpu_penalty: 0.35,
            mem_penalty: 40.0,
            leader_penalty_if_workers: 28.0,
            empty_ingress_penalty: 12.0,
        }
    }
}

/// Score un nœud ; `None` = éliminé (drain, offline, worker loopback, etc.).
pub fn score_node(
    node: &ClusterNode,
    app_count: u32,
    has_eligible_worker: bool,
    weights: &PlacementWeights,
) -> Option<f64> {
    if node.drained {
        return None;
    }
    if node.status != NodeStatus::Online {
        return None;
    }
    if node.role == NodeRole::Worker {
        if node.advertise_url.trim().is_empty() {
            return None;
        }
        if is_loopback_advertise_url(&node.advertise_url) {
            return None;
        }
    }

    let mut score = 100.0;
    score -= f64::from(app_count) * weights.app_penalty;

    if let Some(cpu) = node.metrics.cpu_percent {
        score -= cpu.clamp(0.0, 100.0) * weights.cpu_penalty;
    }
    if let (Some(used), Some(total)) = (node.metrics.mem_used_bytes, node.metrics.mem_total_bytes) {
        if total > 0 {
            let ratio = used as f64 / total as f64;
            score -= ratio * weights.mem_penalty;
        }
    }
    if node.ingress_host.trim().is_empty() {
        score -= weights.empty_ingress_penalty;
    }
    if has_eligible_worker && node.role == NodeRole::Leader {
        score -= weights.leader_penalty_if_workers;
    }
    Some(score)
}

fn worker_eligible(node: &ClusterNode) -> bool {
    node.role == NodeRole::Worker
        && !node.drained
        && node.status == NodeStatus::Online
        && !node.advertise_url.trim().is_empty()
        && !is_loopback_advertise_url(&node.advertise_url)
}

/// Workers en ligne qui peuvent recevoir une copie du journal SQLite.
pub fn replication_peers<'a>(nodes: &'a [ClusterNode], self_id: &str) -> Vec<&'a ClusterNode> {
    nodes
        .iter()
        .filter(|n| n.id != self_id && worker_eligible(n))
        .collect()
}

/// Nœuds hors ligne dont les applications doivent partir.
/// Un nœud en cours de join n’est pas hors ligne. On ne s’évacue pas soi-même.
pub fn nodes_to_evacuate<'a>(nodes: &'a [ClusterNode], self_id: &str) -> Vec<&'a ClusterNode> {
    nodes
        .iter()
        .filter(|n| n.id != self_id && n.status == NodeStatus::Offline)
        .collect()
}

/// Choisit le meilleur `server_id`, ou `None` si aucun candidat.
pub fn pick_placement(
    nodes: &[ClusterNode],
    app_counts: &std::collections::HashMap<String, u32>,
    weights: &PlacementWeights,
) -> Option<(String, f64)> {
    let has_eligible_worker = nodes.iter().any(worker_eligible);
    let mut best: Option<(String, f64)> = None;
    for n in nodes {
        let count = app_counts.get(&n.id).copied().unwrap_or(0);
        let Some(score) = score_node(n, count, has_eligible_worker, weights) else {
            continue;
        };
        match &best {
            None => best = Some((n.id.clone(), score)),
            Some((_, best_score)) if score > *best_score => best = Some((n.id.clone(), score)),
            Some((best_id, best_score)) if (score - *best_score).abs() < f64::EPSILON => {
                // Tie-break : id stable
                if n.id < *best_id {
                    best = Some((n.id.clone(), score));
                }
            }
            _ => {}
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{NodeMetrics, NodeRole, NodeStatus};

    fn node(
        id: &str,
        role: NodeRole,
        url: &str,
        status: NodeStatus,
        drained: bool,
        apps_hint: Option<f64>,
    ) -> ClusterNode {
        ClusterNode {
            id: id.into(),
            name: id.into(),
            role,
            advertise_url: url.into(),
            status,
            os: "linux".into(),
            arch: "x86_64".into(),
            capabilities: vec![],
            ssh_host: None,
            ssh_user: None,
            ssh_port: None,
            last_seen_at: Some("now".into()),
            last_error: None,
            drained,
            ingress_host: if role == NodeRole::Leader {
                "leader.cfargotunnel.com".into()
            } else {
                "worker.cfargotunnel.com".into()
            },
            metrics: NodeMetrics {
                cpu_percent: apps_hint,
                ..Default::default()
            },
            created_at: "now".into(),
            updated_at: "now".into(),
        }
    }

    #[test]
    fn rejects_loopback_urls() {
        assert!(is_loopback_advertise_url("http://127.0.0.1:8000"));
        assert!(is_loopback_advertise_url("http://localhost:8000"));
        assert!(is_loopback_advertise_url("https://[::1]/8000"));
        assert!(!is_loopback_advertise_url("http://192.168.1.10:8000"));
        assert!(validate_worker_advertise_url("http://127.0.0.1:8000").is_err());
        assert!(validate_worker_advertise_url("http://10.0.0.5:8000").is_ok());
    }

    #[test]
    fn prefers_healthy_worker_over_leader() {
        let nodes = vec![
            node("default", NodeRole::Leader, "http://127.0.0.1:8000", NodeStatus::Online, false, Some(10.0)),
            node(
                "node-aaaa",
                NodeRole::Worker,
                "http://192.168.1.20:8000",
                NodeStatus::Online,
                false,
                Some(5.0),
            ),
        ];
        let counts = std::collections::HashMap::new();
        let (id, _) = pick_placement(&nodes, &counts, &PlacementWeights::default()).unwrap();
        assert_eq!(id, "node-aaaa");
    }

    #[test]
    fn eliminates_loopback_worker() {
        let nodes = vec![
            node("default", NodeRole::Leader, "", NodeStatus::Online, false, Some(50.0)),
            node(
                "bad",
                NodeRole::Worker,
                "http://127.0.0.1:8000",
                NodeStatus::Online,
                false,
                Some(0.0),
            ),
        ];
        let counts = std::collections::HashMap::new();
        let (id, _) = pick_placement(&nodes, &counts, &PlacementWeights::default()).unwrap();
        assert_eq!(id, "default");
    }

    #[test]
    fn evacuate_only_other_offline_nodes() {
        let nodes = vec![
            node("default", NodeRole::Leader, "http://10.0.0.1:8000", NodeStatus::Online, false, None),
            node("down", NodeRole::Worker, "http://10.0.0.2:8000", NodeStatus::Offline, false, None),
            node("up", NodeRole::Worker, "http://10.0.0.3:8000", NodeStatus::Online, false, None),
            node("join", NodeRole::Worker, "http://10.0.0.4:8000", NodeStatus::Joining, false, None),
            node("self-off", NodeRole::Worker, "http://10.0.0.5:8000", NodeStatus::Offline, false, None),
        ];
        let ids: Vec<_> = nodes_to_evacuate(&nodes, "self-off")
            .into_iter()
            .map(|n| n.id.as_str())
            .collect();
        assert_eq!(ids, vec!["down"]);
    }

    #[test]
    fn replication_skips_drained_offline_and_the_leader() {
        let nodes = vec![
            node("default", NodeRole::Leader, "http://10.0.0.1:8000", NodeStatus::Online, false, None),
            node("off", NodeRole::Worker, "http://10.0.0.2:8000", NodeStatus::Offline, false, None),
            node("drain", NodeRole::Worker, "http://10.0.0.3:8000", NodeStatus::Online, true, None),
            node("loop", NodeRole::Worker, "http://127.0.0.1:8000", NodeStatus::Online, false, None),
            node("ok", NodeRole::Worker, "http://10.0.0.4:8000", NodeStatus::Online, false, None),
        ];
        let peers = replication_peers(&nodes, "default");
        assert_eq!(peers.len(), 1);
        assert_eq!(peers[0].id, "ok");
    }

    #[test]
    fn respects_drain_and_load() {
        let nodes = vec![
            node("default", NodeRole::Leader, "", NodeStatus::Online, false, Some(5.0)),
            node(
                "w1",
                NodeRole::Worker,
                "http://10.0.0.1:8000",
                NodeStatus::Online,
                true,
                Some(0.0),
            ),
            node(
                "w2",
                NodeRole::Worker,
                "http://10.0.0.2:8000",
                NodeStatus::Online,
                false,
                Some(80.0),
            ),
            node(
                "w3",
                NodeRole::Worker,
                "http://10.0.0.3:8000",
                NodeStatus::Online,
                false,
                Some(10.0),
            ),
        ];
        let mut counts = std::collections::HashMap::new();
        counts.insert("w3".into(), 5u32);
        let (id, _) = pick_placement(&nodes, &counts, &PlacementWeights::default()).unwrap();
        // w1 drained, w3 heavily loaded → w2
        assert_eq!(id, "w2");
    }
}
