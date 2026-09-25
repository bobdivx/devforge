//! Bascule DNS quand un worker devient leader intérimaire.
//!
//! Le leader d'origine publie le control plane (ex. `web.jeser.app`) et les apps via
//! son tunnel. S'il tombe, l'élu intérimaire (voir `worker::try_elect`) reprend les
//! écritures, mais le public reste pointé vers un tunnel mort. Ce module :
//!
//! - **control plane** : si l'URL publique ne répond plus (ou répond déjà depuis ce
//!   nœud), l'intérim pose une route Traefik locale `Host(fqdn) → DevForge local` puis
//!   repointe le CNAME vers **son** tunnel ;
//! - **apps** placées sur le leader d'origine : repointées seulement si leur tunnel est
//!   réellement mort (Cloudflare 530 / connexion impossible). Une app encore servie par
//!   un nœud vivant n'est jamais déplacée (ex. seul le conteneur DevForge est tombé) ;
//! - **retour** : chaque cible d'origine est mémorisée (`cluster-dns-failover.json`)
//!   avant la première bascule. À la rétrogradation de l'intérim, les enregistrements
//!   sont restaurés. Côté leader d'origine, garde-fou : s'il est sain, qu'aucun intérim
//!   n'est actif et que le control plane pointe encore vers le tunnel d'un worker, il
//!   remet la cible d'origine qu'il avait mémorisée (`control-plane-dns-origin.json`).
//!
//! Garde-fou partition : si l'URL publique répond depuis un **autre** nœud, l'intérim
//! ne touche à rien (le leader d'origine est vivant côté Internet).

use std::path::PathBuf;
use std::time::Duration;

use devforge_cluster::{LeaderClient, LocalClusterState, NodeRole};
use devforge_deploy::{LocalShellExecutor, RemoteExecutor};
use serde::{Deserialize, Serialize};

use crate::state::AppState;

/// Nom du fichier Traefik (file provider) posé sur l'intérim.
pub const CONTROL_PLANE_ROUTE_FILE: &str = "devforge-control-plane.yaml";
const TRAEFIK_CONTAINER: &str = "devforge-traefik";
const LOOP_SECS: u64 = 60;

// ---------------------------------------------------------------------------
// Décisions (pures, testées)
// ---------------------------------------------------------------------------

/// Résultat d'un GET `https://{fqdn}/api/v1/health` depuis ce nœud.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ControlPlaneProbe {
    /// 200 + `ok: true`. `node_id` absent = version sans identité.
    Healthy { node_id: Option<String> },
    /// Erreur réseau, timeout, 5xx, 530…
    Down,
}

/// Résultat d'un GET `https://{fqdn}/` sur une app.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppProbe {
    /// Une réponse HTTP venant d'une origine (même 404/502 d'un Traefik vivant).
    OriginAlive,
    /// Tunnel injoignable (Cloudflare 530 / 1033) ou aucune connexion possible.
    TunnelDown,
}

/// Classe un code HTTP de probe applicative.
pub fn classify_app_status(status: Option<u16>) -> AppProbe {
    match status {
        None | Some(530) => AppProbe::TunnelDown,
        Some(_) => AppProbe::OriginAlive,
    }
}

/// L'intérim doit-il servir le hostname du control plane ?
pub fn control_plane_should_point_here(
    acting_leader: bool,
    probe: &ControlPlaneProbe,
    my_node_id: &str,
    my_ingress: &str,
) -> bool {
    if !acting_leader || my_ingress.trim().is_empty() {
        return false;
    }
    match probe {
        ControlPlaneProbe::Down => true,
        // Déjà servi par nous : on garde tant qu'on est intérim.
        ControlPlaneProbe::Healthy { node_id: Some(id) } => id == my_node_id,
        // Un autre nœud (ou une version sans identité) répond : partition, on ne touche pas.
        ControlPlaneProbe::Healthy { node_id: None } => false,
    }
}

/// L'intérim doit-il repointer une app vers son tunnel ?
pub fn app_should_point_here(
    acting_leader: bool,
    app_on_original_leader: bool,
    live_is_mine: bool,
    probe: AppProbe,
    my_ingress: &str,
) -> bool {
    if !acting_leader || !app_on_original_leader || my_ingress.trim().is_empty() {
        return false;
    }
    live_is_mine || probe == AppProbe::TunnelDown
}

/// Le leader d'origine doit-il restaurer le CNAME du control plane ?
pub fn leader_should_restore(
    healthy_leader: bool,
    any_interim_acting: bool,
    live_target: Option<&str>,
    worker_ingresses: &[String],
    saved_origin: Option<&str>,
) -> bool {
    if !healthy_leader || any_interim_acting {
        return false;
    }
    let (Some(live), Some(origin)) = (live_target, saved_origin) else {
        return false;
    };
    if same_target(live, origin) {
        return false;
    }
    worker_ingresses.iter().any(|w| same_target(w, live))
}

pub fn same_target(a: &str, b: &str) -> bool {
    let n = |s: &str| s.trim().trim_end_matches('.').to_ascii_lowercase();
    !a.trim().is_empty() && n(a) == n(b)
}

/// URL amont (vue depuis le conteneur Traefik du nœud) vers DevForge local.
/// `advertise_url` d'un worker est joignable en LAN par définition ; sinon on passe
/// par `host.docker.internal` (Traefik est lancé avec `host-gateway`).
pub fn control_plane_upstream(advertise_url: &str, port: u16) -> String {
    let u = advertise_url.trim().trim_end_matches('/');
    let usable = u.starts_with("http://")
        && !devforge_cluster::is_loopback_advertise_url(u)
        && crate::control_pg::advertise_host(u).is_some();
    if usable {
        let rest = u.trim_start_matches("http://");
        let hostport = rest.split('/').next().unwrap_or(rest);
        return format!("http://{hostport}");
    }
    format!("http://host.docker.internal:{port}")
}

/// Fichier Traefik dynamique : `Host(fqdn)` (http + https) → DevForge local.
/// Pas de redirectScheme (le tunnel Cloudflare termine déjà le TLS).
pub fn control_plane_route_yaml(fqdn: &str, upstream: &str) -> String {
    format!(
        r#"http:
  routers:
    devforge-control-plane-http:
      rule: "Host(`{fqdn}`)"
      entryPoints:
        - http
      service: devforge-control-plane
      priority: 1000
    devforge-control-plane-https:
      rule: "Host(`{fqdn}`)"
      entryPoints:
        - https
      service: devforge-control-plane
      priority: 1000
      tls: {{}}
  services:
    devforge-control-plane:
      loadBalancer:
        servers:
          - url: "{upstream}"
"#
    )
}

// ---------------------------------------------------------------------------
// État persistant
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct FailoverEntry {
    pub fqdn: String,
    /// Cible avant bascule (`None` = pas d'enregistrement).
    pub original: Option<String>,
    /// Cible posée par l'intérim.
    pub target: String,
    #[serde(default)]
    pub control_plane: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct FailoverState {
    #[serde(default)]
    pub entries: Vec<FailoverEntry>,
}

impl FailoverState {
    pub fn get(&self, fqdn: &str) -> Option<&FailoverEntry> {
        self.entries
            .iter()
            .find(|e| e.fqdn.eq_ignore_ascii_case(fqdn))
    }

    /// Mémorise l'origine une seule fois (une 2e bascule ne l'écrase pas).
    pub fn record(&mut self, fqdn: &str, original: Option<String>, target: &str, cp: bool) {
        if let Some(e) = self
            .entries
            .iter_mut()
            .find(|e| e.fqdn.eq_ignore_ascii_case(fqdn))
        {
            e.target = target.into();
            return;
        }
        self.entries.push(FailoverEntry {
            fqdn: fqdn.to_ascii_lowercase(),
            original,
            target: target.into(),
            control_plane: cp,
        });
    }
}

fn state_path() -> PathBuf {
    devforge_cluster::data_dir().join("cluster-dns-failover.json")
}

fn origin_path() -> PathBuf {
    devforge_cluster::data_dir().join("control-plane-dns-origin.json")
}

pub fn load_state() -> FailoverState {
    std::fs::read_to_string(state_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_state(st: &FailoverState) {
    let path = state_path();
    if st.entries.is_empty() {
        let _ = std::fs::remove_file(path);
        return;
    }
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(st) {
        let _ = std::fs::write(path, json);
    }
}

/// Utilisé par la boucle DNS normale : ne pas écraser une bascule en cours.
pub fn is_overridden(fqdn: &str) -> bool {
    load_state().get(fqdn).is_some()
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct SavedOrigin {
    fqdn: String,
    target: String,
}

// ---------------------------------------------------------------------------
// Boucle
// ---------------------------------------------------------------------------

pub fn spawn_loop(state: AppState) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(LOOP_SECS)).await;
            tick(&state).await;
        }
    });
}

async fn tick(state: &AppState) {
    let Ok(local) = state.cluster.local().await else {
        return;
    };
    let dns = crate::dns::load(state).await;
    if !crate::dns::configured(&dns) {
        return;
    }
    if local.acting_leader && local.role == NodeRole::Leader {
        interim_tick(state, &local).await;
    } else if local.role == NodeRole::Leader {
        if !load_state().entries.is_empty() {
            // Ancien intérim redevenu leader « normal » ? Improbable ; on restaure.
            restore(state).await;
        }
        leader_tick(state, &local).await;
    }
}

async fn control_plane_fqdn(state: &AppState) -> Option<String> {
    let row: Option<(Option<String>,)> =
        sqlx::query_as("SELECT instance_url FROM instance_settings WHERE id = 1")
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten();
    let url = row.and_then(|r| r.0)?;
    crate::routes::fqdn_from_url(url.trim()).filter(|f| f.contains('.'))
}

fn http_client() -> Option<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::limited(3))
        .user_agent("DevForge-Failover-Probe/2.0")
        .build()
        .ok()
}

async fn probe_control_plane(fqdn: &str) -> ControlPlaneProbe {
    let Some(c) = http_client() else {
        return ControlPlaneProbe::Down;
    };
    let url = format!("https://{fqdn}/api/v1/health");
    let Ok(r) = c.get(&url).send().await else {
        return ControlPlaneProbe::Down;
    };
    if !r.status().is_success() {
        return ControlPlaneProbe::Down;
    }
    let Ok(v) = r.json::<serde_json::Value>().await else {
        return ControlPlaneProbe::Down;
    };
    if v.get("ok").and_then(|x| x.as_bool()) != Some(true) {
        return ControlPlaneProbe::Down;
    }
    ControlPlaneProbe::Healthy {
        node_id: v
            .get("node_id")
            .and_then(|x| x.as_str())
            .map(str::to_string)
            .filter(|s| !s.is_empty()),
    }
}

async fn probe_app(fqdn: &str) -> AppProbe {
    let Some(c) = http_client() else {
        return AppProbe::TunnelDown;
    };
    let status = c
        .get(format!("https://{fqdn}/"))
        .send()
        .await
        .ok()
        .map(|r| r.status().as_u16());
    classify_app_status(status)
}

async fn traefik_exec(cmd: &str) -> bool {
    LocalShellExecutor
        .exec("default", "/", cmd, 30)
        .await
        .map(|r| r.ok)
        .unwrap_or(false)
}

async fn write_control_plane_route(fqdn: &str, upstream: &str) -> bool {
    let yaml = control_plane_route_yaml(fqdn, upstream);
    let b64 = base64_encode(yaml.as_bytes());
    let cmd = format!(
        "echo {b64} | base64 -d | docker exec -i {TRAEFIK_CONTAINER} sh -c 'mkdir -p /traefik/dynamic && cat > /traefik/dynamic/{CONTROL_PLANE_ROUTE_FILE}'"
    );
    traefik_exec(&cmd).await
}

async fn remove_control_plane_route() {
    let cmd = format!(
        "docker exec {TRAEFIK_CONTAINER} rm -f /traefik/dynamic/{CONTROL_PLANE_ROUTE_FILE} >/dev/null 2>&1 || true"
    );
    let _ = traefik_exec(&cmd).await;
}

async fn interim_tick(state: &AppState, local: &LocalClusterState) {
    let my_ingress = crate::dns::ingress_for(state, &local.node_id).await;
    if my_ingress.is_empty() {
        tracing::warn!("bascule DNS : ce nœud n'a pas de tunnel / IP publique");
        return;
    }
    let mut st = load_state();
    let mut changed = false;

    if let Some(fqdn) = control_plane_fqdn(state).await {
        let probe = probe_control_plane(&fqdn).await;
        if control_plane_should_point_here(true, &probe, &local.node_id, &my_ingress) {
            let port: u16 = std::env::var("PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(8000);
            let upstream = control_plane_upstream(&local.advertise_url, port);
            if !write_control_plane_route(&fqdn, &upstream).await {
                tracing::warn!(%fqdn, "bascule DNS : route Traefik locale non écrite");
            }
            match crate::dns::lookup_target(state, &fqdn).await {
                Ok(live) if live.as_deref().is_some_and(|l| same_target(l, &my_ingress)) => {}
                Ok(live) => {
                    if st.get(&fqdn).is_none() {
                        st.record(&fqdn, live.clone(), &my_ingress, true);
                        save_state(&st);
                    }
                    match crate::dns::point_fqdn_to(state, &fqdn, &my_ingress).await {
                        Ok(()) => {
                            tracing::warn!(%fqdn, from = ?live, to = %my_ingress, "bascule DNS du control plane vers l'intérim");
                            changed = true;
                        }
                        Err(e) => tracing::warn!(%fqdn, error = %e, "bascule DNS control plane"),
                    }
                }
                Err(e) => tracing::warn!(%fqdn, error = %e, "lecture DNS control plane"),
            }
        }
    }

    let preferred = if local.preferred_leader_id.trim().is_empty() {
        devforge_cluster::LEADER_NODE_ID.to_string()
    } else {
        local.preferred_leader_id.clone()
    };
    for d in crate::dns::managed_domains(state).await {
        let fqdn = d["fqdn"].as_str().unwrap_or("").to_string();
        let node = d["node_id"].as_str().unwrap_or("").to_string();
        if fqdn.is_empty() {
            continue;
        }
        let on_leader = node == preferred || node == devforge_cluster::LEADER_NODE_ID;
        if !on_leader {
            continue;
        }
        let live = match crate::dns::lookup_target(state, &fqdn).await {
            Ok(l) => l,
            Err(_) => continue,
        };
        let live_is_mine = live.as_deref().is_some_and(|l| same_target(l, &my_ingress));
        let probe = if live_is_mine {
            AppProbe::OriginAlive
        } else {
            probe_app(&fqdn).await
        };
        if !app_should_point_here(true, true, live_is_mine, probe, &my_ingress) || live_is_mine {
            continue;
        }
        if st.get(&fqdn).is_none() {
            st.record(&fqdn, live.clone(), &my_ingress, false);
            save_state(&st);
        }
        match crate::dns::point_fqdn_to(state, &fqdn, &my_ingress).await {
            Ok(()) => {
                tracing::warn!(%fqdn, to = %my_ingress, "bascule DNS app (tunnel d'origine mort)");
                changed = true;
            }
            Err(e) => tracing::warn!(%fqdn, error = %e, "bascule DNS app"),
        }
    }
    if changed {
        save_state(&st);
    }
}

/// Remet chaque enregistrement basculé sur sa cible d'origine, puis retire la route
/// Traefik locale. Idempotent. Appelé à la rétrogradation de l'intérim et au boot.
pub async fn restore(state: &AppState) {
    let mut st = load_state();
    if st.entries.is_empty() {
        return;
    }
    let mut left = Vec::new();
    for e in st.entries.drain(..) {
        let Some(orig) = e.original.clone().filter(|o| !o.trim().is_empty()) else {
            // Pas d'origine connue : on laisse la boucle DNS normale réécrire.
            continue;
        };
        match crate::dns::point_fqdn_to(state, &e.fqdn, &orig).await {
            Ok(()) => tracing::warn!(fqdn = %e.fqdn, to = %orig, "DNS restauré après intérim"),
            Err(err) => {
                tracing::warn!(fqdn = %e.fqdn, error = %err, "restauration DNS");
                left.push(e);
            }
        }
    }
    st.entries = left;
    save_state(&st);
    remove_control_plane_route().await;
}

async fn any_interim_acting(state: &AppState, local: &LocalClusterState) -> bool {
    if local.failover_secret.is_empty() {
        return false;
    }
    let Ok(nodes) = state.cluster.list_nodes().await else {
        return true; // prudence
    };
    for n in nodes {
        if n.id == local.node_id || n.advertise_url.trim().is_empty() {
            continue;
        }
        let c = LeaderClient::new(&n.advertise_url);
        if let Ok(st) = c.failover_status(&local.failover_secret).await {
            if st.acting_leader {
                return true;
            }
        }
    }
    false
}

async fn leader_tick(state: &AppState, local: &LocalClusterState) {
    if local.writes_fenced || devforge_cluster::reopen_hold_path().is_file() {
        return;
    }
    let Some(fqdn) = control_plane_fqdn(state).await else {
        return;
    };
    let Ok(live) = crate::dns::lookup_target(state, &fqdn).await else {
        return;
    };
    let mut workers = Vec::new();
    if let Ok(nodes) = state.cluster.list_nodes().await {
        for n in nodes {
            if n.id != local.node_id && n.role == NodeRole::Worker {
                let ing = n.ingress_host.trim().to_string();
                if !ing.is_empty() {
                    workers.push(ing);
                }
            }
        }
    }
    let saved: Option<SavedOrigin> = std::fs::read_to_string(origin_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .filter(|o: &SavedOrigin| o.fqdn.eq_ignore_ascii_case(&fqdn));
    let Some(live) = live else {
        return;
    };
    let live_on_worker = workers.iter().any(|w| same_target(w, &live));
    if !live_on_worker {
        // Situation normale : mémoriser la cible d'origine pour un éventuel retour.
        if saved.as_ref().map(|o| o.target.as_str()) != Some(live.as_str()) {
            let o = SavedOrigin {
                fqdn: fqdn.clone(),
                target: live.clone(),
            };
            if let Ok(json) = serde_json::to_string_pretty(&o) {
                let _ = std::fs::write(origin_path(), json);
            }
        }
        return;
    }
    let healthy = true; // ce code tourne dans le leader qui sert l'API
    let acting = any_interim_acting(state, local).await;
    if leader_should_restore(
        healthy,
        acting,
        Some(&live),
        &workers,
        saved.as_ref().map(|o| o.target.as_str()),
    ) {
        let origin = saved.map(|o| o.target).unwrap_or_default();
        match crate::dns::point_fqdn_to(state, &fqdn, &origin).await {
            Ok(()) => {
                tracing::warn!(%fqdn, from = %live, to = %origin, "control plane rendu au leader d'origine")
            }
            Err(e) => tracing::warn!(%fqdn, error = %e, "retour DNS control plane"),
        }
    }
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

    const ME: &str = "node_5658218ef601";
    const MY_ING: &str = "5089c248.cfargotunnel.com";

    #[test]
    fn control_plane_moves_only_when_down_or_already_ours() {
        let down = ControlPlaneProbe::Down;
        assert!(control_plane_should_point_here(true, &down, ME, MY_ING));
        // Pas intérim → jamais.
        assert!(!control_plane_should_point_here(false, &down, ME, MY_ING));
        // Pas de tunnel local → jamais.
        assert!(!control_plane_should_point_here(true, &down, ME, ""));
        // Déjà servi par nous → on garde.
        let ours = ControlPlaneProbe::Healthy {
            node_id: Some(ME.into()),
        };
        assert!(control_plane_should_point_here(true, &ours, ME, MY_ING));
        // Le leader d'origine répond encore côté Internet (partition LAN) → on ne touche pas.
        let other = ControlPlaneProbe::Healthy {
            node_id: Some("default".into()),
        };
        assert!(!control_plane_should_point_here(true, &other, ME, MY_ING));
        let legacy = ControlPlaneProbe::Healthy { node_id: None };
        assert!(!control_plane_should_point_here(true, &legacy, ME, MY_ING));
    }

    #[test]
    fn app_moves_only_if_tunnel_dead() {
        assert_eq!(classify_app_status(Some(530)), AppProbe::TunnelDown);
        assert_eq!(classify_app_status(None), AppProbe::TunnelDown);
        // 502 / 404 = un Traefik vivant a répondu : l'app reste où elle est.
        assert_eq!(classify_app_status(Some(502)), AppProbe::OriginAlive);
        assert_eq!(classify_app_status(Some(404)), AppProbe::OriginAlive);
        assert_eq!(classify_app_status(Some(200)), AppProbe::OriginAlive);

        assert!(app_should_point_here(
            true,
            true,
            false,
            AppProbe::TunnelDown,
            MY_ING
        ));
        assert!(!app_should_point_here(
            true,
            true,
            false,
            AppProbe::OriginAlive,
            MY_ING
        ));
        // App placée sur un autre worker : jamais touchée.
        assert!(!app_should_point_here(
            true,
            false,
            false,
            AppProbe::TunnelDown,
            MY_ING
        ));
        assert!(!app_should_point_here(
            false,
            true,
            false,
            AppProbe::TunnelDown,
            MY_ING
        ));
        // Déjà chez nous : on garde.
        assert!(app_should_point_here(
            true,
            true,
            true,
            AppProbe::OriginAlive,
            MY_ING
        ));
    }

    #[test]
    fn leader_restores_only_when_safe() {
        let workers = vec![MY_ING.to_string()];
        let origin = "916cdfdf.cfargotunnel.com";
        assert!(leader_should_restore(
            true,
            false,
            Some(MY_ING),
            &workers,
            Some(origin)
        ));
        // Intérim encore actif → on attend la reprise.
        assert!(!leader_should_restore(
            true,
            true,
            Some(MY_ING),
            &workers,
            Some(origin)
        ));
        // Déjà sur l'origine.
        assert!(!leader_should_restore(
            true,
            false,
            Some(origin),
            &workers,
            Some(origin)
        ));
        // Pointé ailleurs que sur un worker (choix manuel) → ne pas écraser.
        assert!(!leader_should_restore(
            true,
            false,
            Some("autre.example.com"),
            &workers,
            Some(origin)
        ));
        // Origine inconnue.
        assert!(!leader_should_restore(
            true,
            false,
            Some(MY_ING),
            &workers,
            None
        ));
    }

    #[test]
    fn same_target_normalizes() {
        assert!(same_target("A.cfargotunnel.com.", "a.cfargotunnel.com"));
        assert!(!same_target("", ""));
    }

    #[test]
    fn upstream_prefers_lan_advertise_url() {
        assert_eq!(
            control_plane_upstream("http://10.1.0.88:8000/", 8000),
            "http://10.1.0.88:8000"
        );
        assert_eq!(
            control_plane_upstream("http://127.0.0.1:8000", 8000),
            "http://host.docker.internal:8000"
        );
        assert_eq!(
            control_plane_upstream("https://web.jeser.app", 8000),
            "http://host.docker.internal:8000"
        );
    }

    #[test]
    fn route_yaml_targets_host_and_upstream() {
        let y = control_plane_route_yaml("web.jeser.app", "http://10.1.0.88:8000");
        assert!(y.contains("Host(`web.jeser.app`)"));
        assert!(y.contains("url: \"http://10.1.0.88:8000\""));
        assert!(!y.contains("redirectScheme"));
    }

    #[test]
    fn state_records_origin_once() {
        let mut st = FailoverState::default();
        st.record(
            "Web.Jeser.App",
            Some("orig.cfargotunnel.com".into()),
            MY_ING,
            true,
        );
        st.record("web.jeser.app", Some(MY_ING.into()), "other", true);
        assert_eq!(st.entries.len(), 1);
        let e = st.get("web.jeser.app").unwrap();
        assert_eq!(e.original.as_deref(), Some("orig.cfargotunnel.com"));
        assert_eq!(e.target, "other");
        assert!(e.control_plane);
        let json = serde_json::to_string(&st).unwrap();
        let back: FailoverState = serde_json::from_str(&json).unwrap();
        assert_eq!(back, st);
    }

    #[test]
    fn base64_roundtrip_shape() {
        assert_eq!(base64_encode(b"abc"), "YWJj");
        assert_eq!(base64_encode(b"ab"), "YWI=");
        assert_eq!(base64_encode(b"a"), "YQ==");
    }
}
