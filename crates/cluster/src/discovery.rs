//! Découverte LAN des instances DevForge « en attente » (scan HTTP, pas mDNS).

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::net::Ipv4Addr;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Mutex, Semaphore};

/// Réponse de `GET /api/v1/cluster/pending` sur une instance neuve.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingInfo {
    pub pending: bool,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub hostname: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub os: String,
    #[serde(default)]
    pub arch: String,
    #[serde(default)]
    pub listen_port: u16,
    #[serde(default)]
    pub lan_urls: Vec<String>,
}

/// Peer découvert sur le LAN, prêt à être adopté.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredPeer {
    /// URL utilisée pour joindre l’instance (celle du probe qui a réussi).
    pub url: String,
    pub name: String,
    pub hostname: String,
    pub version: String,
    pub os: String,
    pub arch: String,
    pub listen_port: u16,
    pub lan_urls: Vec<String>,
}

/// Ports DevForge habituels à sonder (en plus du port d’écoute local).
pub const DEFAULT_DISCOVERY_PORTS: &[u16] = &[8000, 8080, 80];

/// Hostname machine (HOSTNAME / COMPUTERNAME).
pub fn machine_hostname() -> String {
    std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "devforge".into())
}

/// IPv4 non-loopback / non-link-local des interfaces locales.
pub fn local_ipv4_addrs() -> Vec<Ipv4Addr> {
    let Ok(ifaces) = if_addrs::get_if_addrs() else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for iface in ifaces {
        if iface.is_loopback() {
            continue;
        }
        let if_addrs::IfAddr::V4(v4) = iface.addr else {
            continue;
        };
        let ip = v4.ip;
        if ip.is_loopback() || ip.is_link_local() || ip.is_unspecified() || ip.is_multicast() {
            continue;
        }
        if !out.contains(&ip) {
            out.push(ip);
        }
    }
    out
}

/// URLs LAN http://IP:port pour cette machine (annonce / pending).
pub fn local_lan_urls(listen_port: u16) -> Vec<String> {
    let port = if listen_port == 0 { 8000 } else { listen_port };
    local_ipv4_addrs()
        .into_iter()
        .map(|ip| format!("http://{ip}:{port}"))
        .collect()
}

fn listen_port_from_env() -> u16 {
    std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8000)
}

/// Ports à scanner : port local + défauts, dédupliqués.
pub fn discovery_ports(extra: &[u16]) -> Vec<u16> {
    let mut ports = Vec::new();
    let local = listen_port_from_env();
    for p in std::iter::once(local)
        .chain(extra.iter().copied())
        .chain(DEFAULT_DISCOVERY_PORTS.iter().copied())
    {
        if p > 0 && !ports.contains(&p) {
            ports.push(p);
        }
    }
    ports
}

fn ipv4_subnet_hosts(ip: Ipv4Addr) -> Vec<Ipv4Addr> {
    let octets = ip.octets();
    let base = u32::from_be_bytes([octets[0], octets[1], octets[2], 0]);
    let mut hosts = Vec::with_capacity(254);
    for i in 1u32..=254 {
        let cand = Ipv4Addr::from((base + i).to_be_bytes());
        if cand != ip {
            hosts.push(cand);
        }
    }
    hosts
}

fn normalize_origin(url: &str) -> String {
    url.trim().trim_end_matches('/').to_string()
}

fn host_key(url: &str) -> Option<String> {
    let u = normalize_origin(url);
    let rest = u
        .strip_prefix("https://")
        .or_else(|| u.strip_prefix("http://"))?;
    let hostport = rest.split('/').next()?.split('@').last()?;
    Some(hostport.to_ascii_lowercase())
}

/// Scan LAN : GET `/api/v1/cluster/pending` sur les /24 locaux.
pub async fn discover_pending_peers(
    ports: &[u16],
    exclude_urls: &[String],
    probe_timeout: Duration,
    global_timeout: Duration,
    max_concurrency: usize,
) -> Vec<DiscoveredPeer> {
    let local_ips: HashSet<Ipv4Addr> = local_ipv4_addrs().into_iter().collect();
    if local_ips.is_empty() || ports.is_empty() {
        return Vec::new();
    }

    let mut exclude_hosts: HashSet<String> = HashSet::new();
    for u in exclude_urls {
        if let Some(h) = host_key(u) {
            exclude_hosts.insert(h);
        }
    }
    for ip in &local_ips {
        for p in ports {
            exclude_hosts.insert(format!("{ip}:{p}"));
            exclude_hosts.insert(ip.to_string());
        }
    }

    let mut targets: Vec<String> = Vec::new();
    let mut seen_targets = HashSet::new();
    for ip in &local_ips {
        for host in ipv4_subnet_hosts(*ip) {
            for p in ports {
                let url = format!("http://{host}:{p}");
                if let Some(hk) = host_key(&url) {
                    if exclude_hosts.contains(&hk) {
                        continue;
                    }
                }
                if seen_targets.insert(url.clone()) {
                    targets.push(url);
                }
            }
        }
    }

    if targets.is_empty() {
        return Vec::new();
    }

    let client = match reqwest::Client::builder()
        .timeout(probe_timeout)
        .connect_timeout(probe_timeout)
        .redirect(reqwest::redirect::Policy::none())
        .build()
    {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    let sem = Arc::new(Semaphore::new(max_concurrency.max(1)));
    let found: Arc<Mutex<Vec<DiscoveredPeer>>> = Arc::new(Mutex::new(Vec::new()));
    let seen_peers: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));

    let scan = async {
        let mut handles = Vec::new();
        for url in targets {
            let permit = match sem.clone().acquire_owned().await {
                Ok(p) => p,
                Err(_) => break,
            };
            let client = client.clone();
            let found = found.clone();
            let seen_peers = seen_peers.clone();
            handles.push(tokio::spawn(async move {
                let _permit = permit;
                let probe_url = format!("{}/api/v1/cluster/pending", normalize_origin(&url));
                let resp = match client.get(&probe_url).send().await {
                    Ok(r) => r,
                    Err(_) => return,
                };
                if !resp.status().is_success() {
                    return;
                }
                let info: PendingInfo = match resp.json().await {
                    Ok(i) => i,
                    Err(_) => return,
                };
                if !info.pending {
                    return;
                }
                let peer = DiscoveredPeer {
                    url: normalize_origin(&url),
                    name: if info.name.trim().is_empty() {
                        info.hostname.clone()
                    } else {
                        info.name
                    },
                    hostname: info.hostname,
                    version: info.version,
                    os: info.os,
                    arch: info.arch,
                    listen_port: if info.listen_port > 0 {
                        info.listen_port
                    } else {
                        url.rsplit(':')
                            .next()
                            .and_then(|p| p.parse().ok())
                            .unwrap_or(8000)
                    },
                    lan_urls: info.lan_urls,
                };
                // Dédupliquer par hostname ou ensemble d’URLs LAN.
                let dedup_key = if !peer.hostname.is_empty() {
                    peer.hostname.to_ascii_lowercase()
                } else {
                    peer.url.clone()
                };
                let mut seen = seen_peers.lock().await;
                if !seen.insert(dedup_key) {
                    return;
                }
                found.lock().await.push(peer);
            }));
        }
        for h in handles {
            let _ = h.await;
        }
    };

    let _ = tokio::time::timeout(global_timeout, scan).await;

    let mut peers = found.lock().await.clone();
    peers.sort_by(|a, b| {
        a.hostname
            .to_ascii_lowercase()
            .cmp(&b.hostname.to_ascii_lowercase())
            .then_with(|| a.url.cmp(&b.url))
    });
    peers
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovery_ports_include_defaults() {
        let p = discovery_ports(&[]);
        assert!(p.contains(&8000));
    }

    #[test]
    fn normalize_strips_slash() {
        assert_eq!(normalize_origin("http://10.0.0.2:8000/"), "http://10.0.0.2:8000");
    }
}
