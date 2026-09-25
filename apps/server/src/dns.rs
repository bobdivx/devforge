//! Entrée publique auto : Porkbun (DNS A) ou Cloudflare (tunnel par nœud).

use crate::state::AppState;
use devforge_cluster::LEADER_NODE_ID;
use devforge_domain::{
    cloudflare_connect, cloudflare_connect_for_fqdn, cloudflare_ping, infer_zone, porkbun_lookup,
    porkbun_ping, porkbun_verify_zone, split_host, upsert_record, CloudflareClient, PorkbunCreds,
};
use serde_json::{json, Value};

#[derive(Debug, Clone, Default)]
pub struct DnsSettings {
    pub provider: String,
    pub zone: String,
    /// Token API Cloudflare (Bearer).
    pub cf_token: String,
    /// Porkbun API key.
    pub api_key: String,
    /// Porkbun secret key.
    pub secret: String,
}

fn cf_key(dns: &DnsSettings) -> &str {
    let t = dns.cf_token.trim();
    if !t.is_empty() {
        return t;
    }
    // Ancien stockage : le token CF était dans porkbun_api_key, secret vide.
    if dns.provider == "cloudflare" {
        dns.api_key.trim()
    } else {
        ""
    }
}

fn porkbun_ready(dns: &DnsSettings) -> bool {
    let (k, s) = devforge_domain::normalize_porkbun_keys(&dns.api_key, &dns.secret);
    !k.is_empty() && !s.is_empty()
}

pub async fn load(state: &AppState) -> DnsSettings {
    let row: Option<(String, String, String, String, String, String)> = sqlx::query_as(
        "SELECT COALESCE(dns_provider,''), COALESCE(porkbun_zone,''), COALESCE(porkbun_api_key,''),
                COALESCE(porkbun_secret,''), COALESCE(cloudflare_api_token,''), COALESCE(wildcard_domain,'')
         FROM instance_settings WHERE id = 1",
    )
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();
    let mut dns = row
        .map(|(provider, zone, api_key, secret, cf_token, wildcard)| {
            let zone = if zone.trim().is_empty() {
                infer_zone(&wildcard)
            } else {
                zone.trim().trim_start_matches('.').to_lowercase()
            };
            DnsSettings {
                provider: provider.trim().to_lowercase(),
                zone,
                cf_token,
                api_key,
                secret,
            }
        })
        .unwrap_or_default();
    if dns.cf_token.trim().is_empty()
        && dns.provider == "cloudflare"
        && !dns.api_key.trim().is_empty()
        && dns.secret.trim().is_empty()
    {
        dns.cf_token = dns.api_key.clone();
        dns.api_key.clear();
        let _ = sqlx::query(
            "UPDATE instance_settings SET cloudflare_api_token = $1, porkbun_api_key = '' WHERE id = 1",
        )
        .bind(&dns.cf_token)
        .execute(&state.pool)
        .await;
    }
    dns
}

pub fn configured(dns: &DnsSettings) -> bool {
    if dns.zone.is_empty() {
        return false;
    }
    match dns.provider.as_str() {
        "cloudflare" => !cf_key(dns).is_empty(),
        "porkbun" => porkbun_ready(dns),
        _ => false,
    }
}

fn porkbun_creds(dns: &DnsSettings) -> Option<PorkbunCreds> {
    if dns.provider != "porkbun" || !configured(dns) {
        return None;
    }
    let (apikey, secretapikey) = devforge_domain::normalize_porkbun_keys(&dns.api_key, &dns.secret);
    Some(PorkbunCreds {
        apikey,
        secretapikey,
        zone: dns.zone.clone(),
    })
}

fn tunnel_name(node_id: &str) -> String {
    let id = crate::cluster_routes::normalize_server_id(node_id);
    let safe: String = id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    format!("devforge-{safe}")
}

pub(crate) async fn ingress_for(state: &AppState, server_id: &str) -> String {
    let id = crate::cluster_routes::normalize_server_id(server_id);
    if let Ok(Some(n)) = state.cluster.store().get_node(&id).await {
        if !n.ingress_host.trim().is_empty() {
            return n.ingress_host.trim().to_string();
        }
        if let Some(ip) = n.metrics.public_ip.as_deref() {
            if !ip.trim().is_empty() {
                return ip.trim().to_string();
            }
        }
    }
    String::new()
}

async fn set_ingress_host(state: &AppState, server_id: &str, host: &str) {
    let id = crate::cluster_routes::normalize_server_id(server_id);
    let Ok(Some(mut n)) = state.cluster.store().get_node(&id).await else {
        return;
    };
    let host = host.trim().trim_end_matches('.');
    if n.ingress_host == host {
        return;
    }
    n.ingress_host = host.into();
    n.updated_at = chrono::Utc::now().to_rfc3339();
    let _ = state.cluster.store().upsert_node(&n).await;
}

async fn detect_public_ip(state: &AppState, server_id: &str) -> Option<String> {
    let cmd = r#"curl -4 -fsS --max-time 4 https://api.ipify.org 2>/dev/null || curl -4 -fsS --max-time 4 https://ifconfig.me 2>/dev/null || true"#;
    let res = state.deploy.exec(server_id, "", cmd, 12).await.ok()?;
    let ip = res.output.trim();
    if ip.parse::<std::net::Ipv4Addr>().is_ok() {
        Some(ip.to_string())
    } else {
        None
    }
}

pub async fn provision_node(state: &AppState, server_id: &str) {
    let dns = load(state).await;
    if !configured(&dns) {
        return;
    }
    let sid = crate::cluster_routes::normalize_server_id(server_id);
    if let Err(e) = state.proxy.ensure_traefik_on(&sid).await {
        tracing::warn!(node = %sid, error = %e, "Traefik nœud");
    }
    match dns.provider.as_str() {
        "cloudflare" => {
            let host = ingress_for(state, &sid).await;
            if host.ends_with("cfargotunnel.com") && cloudflared_running(state, &sid).await {
                return;
            }
            match cloudflare_connect(cf_key(&dns), &dns.zone).await {
                Ok(cf) => match cf.ensure_tunnel(&tunnel_name(&sid)).await {
                    Ok((id, token)) => {
                        let host = CloudflareClient::tunnel_hostname(&id);
                        set_ingress_host(state, &sid, &host).await;
                        if let Err(e) = state.proxy.ensure_cloudflared(&sid, &token).await {
                            tracing::warn!(node = %sid, error = %e, "cloudflared");
                        }
                    }
                    Err(e) => tracing::warn!(node = %sid, error = %e, "tunnel Cloudflare"),
                },
                Err(e) => tracing::warn!(error = %e, "Cloudflare connect"),
            }
        }
        "porkbun" => {
            let cur = ingress_for(state, &sid).await;
            let needs_ip = cur.is_empty()
                || cur.ends_with("cfargotunnel.com")
                || cur.parse::<std::net::IpAddr>().is_err();
            if needs_ip {
                if let Some(ip) = detect_public_ip(state, &sid).await {
                    set_ingress_host(state, &sid, &ip).await;
                    tracing::info!(node = %sid, %ip, "Porkbun : cible IP (remplace tunnel/legacy)");
                } else if cur.ends_with("cfargotunnel.com") {
                    tracing::warn!(
                        node = %sid,
                        "Porkbun : IP publique introuvable, cible tunnel Cloudflare encore en place"
                    );
                }
            }
        }
        _ => {}
    }
}

async fn docker_running(
    state: &AppState,
    server_id: &str,
    container: &str,
) -> Result<bool, String> {
    let cmd =
        format!("docker inspect -f '{{{{.State.Running}}}}' {container} 2>/dev/null || echo false");
    let res = state
        .deploy
        .exec(server_id, "", &cmd, 8)
        .await
        .map_err(|e| e.to_string())?;
    Ok(res.output.trim().eq_ignore_ascii_case("true"))
}

async fn cloudflared_running(state: &AppState, server_id: &str) -> bool {
    docker_running(state, server_id, "devforge-cloudflared")
        .await
        .unwrap_or(false)
}

async fn node_ids(state: &AppState) -> Result<Vec<String>, String> {
    let nodes = state
        .cluster
        .list_nodes()
        .await
        .map_err(|e| e.to_string())?;
    let mut ids: Vec<String> = nodes.into_iter().map(|n| n.id).collect();
    if !ids.iter().any(|id| id == LEADER_NODE_ID) {
        ids.push(LEADER_NODE_ID.into());
    }
    Ok(ids)
}

pub async fn provision_nodes(state: &AppState) -> Result<Value, String> {
    let dns = load(state).await;
    if dns.provider != "cloudflare" && dns.provider != "porkbun" {
        return Ok(json!({"ok": true, "skipped": true}));
    }
    if dns.zone.is_empty() {
        return Err("Indique le domaine, ou un wildcard dans Settings → Domaine".into());
    }
    let token_missing = match dns.provider.as_str() {
        "cloudflare" => cf_key(&dns).is_empty(),
        "porkbun" => !porkbun_ready(&dns),
        _ => true,
    };
    if token_missing {
        return Err("Token manquant".into());
    }
    match dns.provider.as_str() {
        "cloudflare" => {
            let _ = cloudflare_ping(cf_key(&dns))
                .await
                .map_err(|e| e.to_string())?;
        }
        "porkbun" => {
            let c = porkbun_creds(&dns).ok_or("Porkbun : clé API et Secret API requis")?;
            porkbun_ping(&c).await.map_err(|e| e.to_string())?;
        }
        _ => {}
    }
    let ids = node_ids(state).await?;
    for id in &ids {
        provision_node(state, id).await;
    }
    Ok(json!({ "ok": true, "nodes": ids.len() }))
}

pub async fn provision_all(state: &AppState) -> Result<Value, String> {
    let v = provision_nodes(state).await?;
    if v.get("skipped").and_then(|x| x.as_bool()).unwrap_or(false) {
        let mut skipped = v;
        if let Some(obj) = skipped.as_object_mut() {
            obj.insert("sync_results".into(), json!([]));
            obj.insert("server_version".into(), json!(env!("CARGO_PKG_VERSION")));
            obj.insert("dns_sync_api".into(), json!(2));
        }
        return Ok(skipped);
    }
    // Même liste que l’UI (production_url + domaines attachés), pas seulement sync_project.
    let managed = list_managed_domains(state).await;
    let mut sync_results = Vec::new();
    for d in &managed {
        let fqdn = d["fqdn"].as_str().unwrap_or("").to_string();
        let node_id = d["node_id"].as_str().unwrap_or(LEADER_NODE_ID).to_string();
        if fqdn.is_empty() {
            continue;
        }
        match sync_fqdn(state, &fqdn, &node_id).await {
            Ok(()) => sync_results.push(json!({ "fqdn": fqdn, "ok": true })),
            Err(e) => {
                tracing::warn!(fqdn, error = %e, "sync DNS");
                sync_results.push(json!({ "fqdn": fqdn, "ok": false, "error": e }));
            }
        }
    }
    let mut status = collect_status(state).await;
    if let Some(obj) = status.as_object_mut() {
        obj.insert("sync_results".into(), json!(sync_results));
        obj.insert("server_version".into(), json!(env!("CARGO_PKG_VERSION")));
        obj.insert("dns_sync_api".into(), json!(2));
    }
    Ok(status)
}

pub fn spawn_dns_loop(state: AppState) {
    tokio::spawn(async move {
        match provision_all(&state).await {
            Ok(v) if v.get("skipped").and_then(|x| x.as_bool()).unwrap_or(false) => {}
            Ok(_) => tracing::info!("dns provision initial ok"),
            Err(e) => tracing::warn!(error = %e, "dns provision initial"),
        }
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(180));
        interval.tick().await;
        loop {
            interval.tick().await;
            match provision_all(&state).await {
                Ok(v) if v.get("skipped").and_then(|x| x.as_bool()).unwrap_or(false) => {}
                Ok(_) => tracing::debug!("dns loop ok"),
                Err(e) => tracing::warn!(error = %e, "dns loop"),
            }
        }
    });
}

pub async fn sync_fqdn(state: &AppState, fqdn: &str, server_id: &str) -> Result<(), String> {
    let dns = load(state).await;
    if !configured(&dns) {
        return Err("DNS auto non configuré".into());
    }
    // Bascule intérim en cours sur ce hostname : ne pas le renvoyer vers le tunnel mort.
    if crate::dns_failover::is_overridden(fqdn) {
        if let Ok(local) = state.cluster.local().await {
            if local.acting_leader {
                return Ok(());
            }
        }
    }
    let sid = if server_id.trim().is_empty() {
        LEADER_NODE_ID.to_string()
    } else {
        crate::cluster_routes::normalize_server_id(server_id)
    };
    let mut host = ingress_for(state, &sid).await;
    if host.is_empty() {
        provision_node(state, &sid).await;
        host = ingress_for(state, &sid).await;
    }
    if host.is_empty() {
        return Err(format!("pas de cible DNS pour le nœud {sid}"));
    }
    match dns.provider.as_str() {
        "porkbun" => {
            if split_host(fqdn, &dns.zone).is_err() {
                return Err(format!("{fqdn} hors zone {}", dns.zone));
            }
            let c = porkbun_creds(&dns).ok_or("Porkbun : credentials manquants")?;
            upsert_record(&c, fqdn, &host)
                .await
                .map_err(|e| e.to_string())?;
            tracing::info!(fqdn, target = %host, "Porkbun OK");
            Ok(())
        }
        "cloudflare" => {
            let cf = cloudflare_connect_for_fqdn(cf_key(&dns), fqdn)
                .await
                .map_err(|e| e.to_string())?;
            cf.upsert_cname(fqdn, &host)
                .await
                .map_err(|e| format!("zone {}: {e}", cf.zone))?;
            tracing::info!(fqdn, zone = %cf.zone, target = %host, "Cloudflare CNAME OK");
            Ok(())
        }
        _ => Err("provider DNS inconnu".into()),
    }
}

/// Cible actuelle (CNAME / A) d'un hostname chez le provider DNS.
pub(crate) async fn lookup_target(state: &AppState, fqdn: &str) -> Result<Option<String>, String> {
    let dns = load(state).await;
    match dns.provider.as_str() {
        "cloudflare" => {
            let cf = cloudflare_connect_for_fqdn(cf_key(&dns), fqdn)
                .await
                .map_err(|e| e.to_string())?;
            cf.lookup_name(fqdn)
                .await
                .map(|r| r.map(|(_, content)| content))
                .map_err(|e| e.to_string())
        }
        "porkbun" => {
            let c = porkbun_creds(&dns).ok_or("Porkbun : credentials manquants")?;
            porkbun_lookup(&c, fqdn)
                .await
                .map(|r| r.map(|(_, content)| content))
                .map_err(|e| e.to_string())
        }
        _ => Err("DNS auto non configuré".into()),
    }
}

/// Pointe un hostname vers une cible précise (CNAME Cloudflare / A Porkbun).
pub(crate) async fn point_fqdn_to(state: &AppState, fqdn: &str, target: &str) -> Result<(), String> {
    let dns = load(state).await;
    if !configured(&dns) {
        return Err("DNS auto non configuré".into());
    }
    match dns.provider.as_str() {
        "cloudflare" => {
            let cf = cloudflare_connect_for_fqdn(cf_key(&dns), fqdn)
                .await
                .map_err(|e| e.to_string())?;
            cf.upsert_cname(fqdn, target)
                .await
                .map_err(|e| format!("zone {}: {e}", cf.zone))
        }
        "porkbun" => {
            let c = porkbun_creds(&dns).ok_or("Porkbun : credentials manquants")?;
            upsert_record(&c, fqdn, target)
                .await
                .map_err(|e| e.to_string())
        }
        _ => Err("provider DNS inconnu".into()),
    }
}

/// Domaines d'apps gérés (même liste que l'UI) : `{ fqdn, node_id, … }`.
pub(crate) async fn managed_domains(state: &AppState) -> Vec<Value> {
    list_managed_domains(state).await
}

pub async fn remove_fqdn(state: &AppState, fqdn: &str) {
    let dns = load(state).await;
    if !configured(&dns) {
        return;
    }
    match dns.provider.as_str() {
        "porkbun" => {
            if let Some(c) = porkbun_creds(&dns) {
                if let Err(e) = devforge_domain::delete_record(&c, fqdn).await {
                    tracing::warn!(fqdn, error = %e, "Porkbun delete");
                }
            }
        }
        "cloudflare" => {
            if let Ok(cf) = cloudflare_connect_for_fqdn(cf_key(&dns), fqdn).await {
                if let Err(e) = cf.delete_name(fqdn).await {
                    tracing::warn!(fqdn, error = %e, "Cloudflare delete");
                }
            }
        }
        _ => {}
    }
}

/// Retourne une entrée par FQDN synchronisé : `{ fqdn, ok, error? }`.
pub async fn sync_project(state: &AppState, project_uuid: &str) -> Vec<Value> {
    let row: Option<(Option<String>, Option<String>)> =
        sqlx::query_as("SELECT server_id, production_url FROM projects WHERE uuid = $1")
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten();
    let Some((server_id, production_url)) = row else {
        return vec![];
    };
    let server_id = server_id
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| LEADER_NODE_ID.to_string());
    let mut fqdns = Vec::new();
    if let Some(url) = production_url.as_deref() {
        if let Some(f) = crate::routes::fqdn_from_url(url) {
            fqdns.push(f);
        }
    }
    if let Ok(listed) = state.domains.list(project_uuid).await {
        if let Some(arr) = listed.get("domains").and_then(|d| d.as_array()) {
            for d in arr {
                if let Some(f) = d.get("fqdn").and_then(|v| v.as_str()) {
                    let t = f.trim().trim_end_matches('.').to_lowercase();
                    if t.contains('.') && !fqdns.iter().any(|x| x == &t) {
                        fqdns.push(t);
                    }
                }
            }
        }
    }
    let mut out = Vec::new();
    for fqdn in fqdns {
        match sync_fqdn(state, &fqdn, &server_id).await {
            Ok(()) => out.push(json!({ "fqdn": fqdn, "ok": true })),
            Err(e) => {
                tracing::warn!(fqdn, error = %e, "sync DNS");
                out.push(json!({ "fqdn": fqdn, "ok": false, "error": e }));
            }
        }
    }
    out
}

pub async fn note_public_ip(state: &AppState, node_id: &str, ip: &str) {
    let dns = load(state).await;
    if dns.provider != "porkbun" {
        return;
    }
    if ip.parse::<std::net::Ipv4Addr>().is_err() {
        return;
    }
    let id = crate::cluster_routes::normalize_server_id(node_id);
    if let Ok(Some(n)) = state.cluster.store().get_node(&id).await {
        let cur = n.ingress_host.trim();
        // Remplacer aussi les tunnels Cloudflare résiduels après un switch Porkbun.
        if cur.is_empty()
            || cur == ip
            || cur.ends_with("cfargotunnel.com")
            || cur.parse::<std::net::IpAddr>().is_err()
        {
            set_ingress_host(state, &id, ip).await;
        }
    }
}

async fn list_managed_domains(state: &AppState) -> Vec<Value> {
    let rows: Vec<(String, String, Option<String>, Option<String>)> =
        sqlx::query_as("SELECT uuid, name, server_id, production_url FROM projects ORDER BY name")
            .fetch_all(&state.pool)
            .await
            .unwrap_or_default();
    let mut out = Vec::new();
    for (uuid, name, server_id, production_url) in rows {
        let sid = server_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(LEADER_NODE_ID)
            .to_string();
        let target = ingress_for(state, &sid).await;
        let mut fqdns = Vec::new();
        if let Some(url) = production_url.as_deref() {
            if let Some(f) = crate::routes::fqdn_from_url(url) {
                fqdns.push(f);
            }
        }
        if let Ok(listed) = state.domains.list(&uuid).await {
            if let Some(arr) = listed.get("domains").and_then(|d| d.as_array()) {
                for d in arr {
                    if let Some(f) = d.get("fqdn").and_then(|v| v.as_str()) {
                        let t = f.trim().trim_end_matches('.').to_lowercase();
                        if t.contains('.') && !fqdns.iter().any(|x| x == &t) {
                            fqdns.push(t);
                        }
                    }
                }
            }
        }
        for fqdn in fqdns {
            out.push(json!({
                "fqdn": fqdn,
                "project": name,
                "project_uuid": uuid,
                "node_id": sid,
                "target": target,
            }));
        }
    }
    out
}

fn same_dns_target(a: &str, b: &str) -> bool {
    a.trim()
        .trim_end_matches('.')
        .eq_ignore_ascii_case(b.trim().trim_end_matches('.'))
}

async fn enrich_live_records(dns: &DnsSettings, domains: &mut [Value]) {
    if domains.is_empty() {
        return;
    }
    let zone = dns.zone.trim().trim_start_matches('.').to_lowercase();
    match dns.provider.as_str() {
        "porkbun" => {
            let Some(c) = porkbun_creds(dns) else {
                return;
            };
            for d in domains.iter_mut() {
                let fqdn = d["fqdn"].as_str().unwrap_or("").to_string();
                let target = d["target"].as_str().unwrap_or("").to_string();
                if !zone.is_empty() && split_host(&fqdn, &zone).is_err() {
                    d["out_of_zone"] = json!(true);
                    d["in_sync"] = Value::Null;
                    d["error"] = json!(format!(
                        "Hors zone {zone} — Porkbun ne gère que *.{zone} (passe en Cloudflare multi-zone ou une zone Porkbun dédiée)"
                    ));
                    continue;
                }
                match porkbun_lookup(&c, &fqdn).await {
                    Ok(Some((kind, content))) => {
                        let synced = same_dns_target(&content, &target);
                        d["live_kind"] = json!(kind);
                        d["live"] = json!(content);
                        d["in_sync"] = json!(synced);
                        if !synced {
                            d["error"] =
                                json!(format!("Porkbun a {kind} {content}, attendu {target}"));
                        }
                    }
                    Ok(None) => {
                        d["in_sync"] = json!(false);
                        d["error"] = json!("record absent chez Porkbun");
                    }
                    Err(e) => {
                        d["in_sync"] = json!(false);
                        d["error"] = json!(e.to_string());
                    }
                }
            }
        }
        "cloudflare" => {
            let token = cf_key(dns).to_string();
            if token.is_empty() {
                return;
            }
            for d in domains.iter_mut() {
                let fqdn = d["fqdn"].as_str().unwrap_or("").to_string();
                let target = d["target"].as_str().unwrap_or("").to_string();
                let cf = match cloudflare_connect_for_fqdn(&token, &fqdn).await {
                    Ok(cf) => cf,
                    Err(e) => {
                        d["out_of_zone"] = json!(true);
                        d["in_sync"] = Value::Null;
                        d["error"] = json!(e.to_string());
                        continue;
                    }
                };
                d["dns_zone"] = json!(cf.zone);
                match cf.lookup_name(&fqdn).await {
                    Ok(Some((kind, content))) => {
                        let synced = same_dns_target(&content, &target);
                        d["live_kind"] = json!(kind);
                        d["live"] = json!(content);
                        d["in_sync"] = json!(synced);
                        if !synced {
                            d["error"] = json!(format!(
                                "Cloudflare ({}) a {kind} {content}, attendu {target}",
                                cf.zone
                            ));
                        }
                    }
                    Ok(None) => {
                        d["in_sync"] = json!(false);
                        d["error"] =
                            json!(format!("CNAME absent chez Cloudflare (zone {})", cf.zone));
                    }
                    Err(e) => {
                        d["in_sync"] = json!(false);
                        d["error"] = json!(e.to_string());
                    }
                }
            }
        }
        _ => {}
    }
}

pub async fn collect_status(state: &AppState) -> Value {
    let dns = load(state).await;
    let mut token_ok = false;
    let mut account = String::new();
    let mut error: Option<String> = None;
    if !dns.provider.is_empty() {
        match dns.provider.as_str() {
            "cloudflare" => match cloudflare_ping(cf_key(&dns)).await {
                Ok(name) => {
                    token_ok = true;
                    account = name;
                    if !dns.zone.is_empty() {
                        if let Err(e) = cloudflare_connect(cf_key(&dns), &dns.zone).await {
                            error = Some(e.to_string());
                            token_ok = false;
                        }
                    }
                }
                Err(e) => error = Some(e.to_string()),
            },
            "porkbun" => match porkbun_creds(&dns) {
                Some(c) => match porkbun_ping(&c).await {
                    Ok(()) => {
                        token_ok = true;
                        if let Err(e) = porkbun_verify_zone(&c).await {
                            error = Some(e.to_string());
                            token_ok = false;
                        }
                    }
                    Err(e) => error = Some(e.to_string()),
                },
                None => error = Some("Porkbun : clé API ou Secret API manquant".into()),
            },
            _ => {}
        }
    } else if !dns.provider.is_empty() {
        error = Some("Token manquant".into());
    }

    let listed = state.cluster.list_nodes().await.unwrap_or_default();
    let ids = node_ids(state)
        .await
        .unwrap_or_else(|_| vec![LEADER_NODE_ID.into()]);
    let mut nodes_out = Vec::new();
    for id in ids {
        let meta = listed.iter().find(|n| n.id == id);
        let name = meta
            .map(|n| n.name.clone())
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| id.clone());
        let role = meta
            .map(|n| n.role.as_str().to_string())
            .unwrap_or_else(|| "leader".into());
        let ingress = meta
            .map(|n| n.ingress_host.trim().to_string())
            .unwrap_or_default();
        let public_ip = meta
            .and_then(|n| n.metrics.public_ip.clone())
            .unwrap_or_default();
        let advertise_url = meta.map(|n| n.advertise_url.clone()).unwrap_or_default();
        let advertise_ok = role == "leader"
            || (!advertise_url.trim().is_empty()
                && !devforge_cluster::is_loopback_advertise_url(&advertise_url));
        let skip_remote = role != "leader" && !advertise_ok;
        let traefik = if skip_remote {
            Err("URL d’annonce loopback ou vide — corrige l’IP LAN du worker".into())
        } else {
            docker_running(state, &id, "devforge-traefik").await
        };
        let agent = if dns.provider != "cloudflare" {
            Ok(false)
        } else if skip_remote {
            Err("URL d’annonce loopback ou vide — corrige l’IP LAN du worker".into())
        } else {
            docker_running(state, &id, "devforge-cloudflared").await
        };
        let mut node_error = None;
        let (traefik_ok, traefik_err) = match &traefik {
            Ok(v) => (*v, None),
            Err(e) => (false, Some(e.clone())),
        };
        let (agent_ok, agent_err) = match &agent {
            Ok(v) => (*v, None),
            Err(e) => (false, Some(e.clone())),
        };
        if skip_remote {
            node_error = Some(
                "URL d’annonce loopback (127.0.0.1) — le leader ne peut pas joindre ce worker"
                    .into(),
            );
        } else if let Some(e) = traefik_err {
            let msg = if e.contains("pas un nœud worker") {
                "worker injoignable (rôle / secret) — vérifie advertise_url et le join".to_string()
            } else {
                format!("nœud injoignable ({e})")
            };
            node_error = Some(msg);
        } else if dns.provider == "cloudflare" {
            if let Some(e) = agent_err {
                let msg = if e.contains("pas un nœud worker") {
                    "worker injoignable (rôle / secret) — vérifie advertise_url et le join"
                        .to_string()
                } else {
                    format!("nœud injoignable ({e})")
                };
                node_error = Some(msg);
            }
        }
        match dns.provider.as_str() {
            "cloudflare" => {
                if !ingress.ends_with("cfargotunnel.com") {
                    node_error =
                        Some(node_error.unwrap_or_else(|| "tunnel Cloudflare non créé".into()));
                } else if !agent_ok && node_error.is_none() {
                    node_error = Some("cloudflared n’est pas démarré".into());
                } else if !traefik_ok && node_error.is_none() {
                    node_error = Some("Traefik n’est pas démarré".into());
                }
            }
            "porkbun" => {
                if ingress.ends_with("cfargotunnel.com") && node_error.is_none() {
                    node_error = Some(
                        "cible tunnel Cloudflare résiduelle — Enregistrer / Actualiser pour forcer l’IP publique".into(),
                    );
                } else if ingress.is_empty() && node_error.is_none() {
                    node_error = Some(if public_ip.is_empty() {
                        "IP publique absente".into()
                    } else {
                        format!("IP {public_ip} détectée, pas encore écrite comme cible DNS")
                    });
                } else if !traefik_ok && node_error.is_none() {
                    node_error = Some("Traefik n’est pas démarré".into());
                }
            }
            _ => {}
        }
        let ok = node_error.is_none()
            && traefik_ok
            && match dns.provider.as_str() {
                "cloudflare" => agent_ok && ingress.ends_with("cfargotunnel.com"),
                "porkbun" => !ingress.is_empty() && !ingress.ends_with("cfargotunnel.com"),
                _ => true,
            };
        nodes_out.push(json!({
            "id": id,
            "name": name,
            "role": role,
            "tunnel": if dns.provider == "cloudflare" { tunnel_name(&id) } else { String::new() },
            "ingress": ingress,
            "public_ip": public_ip,
            "advertise_url": advertise_url,
            "advertise_ok": advertise_ok,
            "traefik": traefik_ok,
            "cloudflared": agent_ok,
            "ok": ok,
            "error": node_error,
        }));
    }

    let mut domains = list_managed_domains(state).await;
    enrich_live_records(&dns, &mut domains).await;
    let nodes_ok =
        !nodes_out.is_empty() && nodes_out.iter().all(|n| n["ok"].as_bool() == Some(true));
    let domains_ok = domains.iter().all(|d| {
        if d["out_of_zone"].as_bool() == Some(true) {
            return true;
        }
        d["in_sync"].as_bool().unwrap_or(true)
    });
    let ok = configured(&dns) && token_ok && error.is_none() && nodes_ok && domains_ok;
    json!({
        "ok": ok,
        "configured": configured(&dns),
        "provider": dns.provider,
        "zone": dns.zone,
        "account": account,
        "token_ok": token_ok,
        "error": error,
        "nodes": nodes_out,
        "domains": domains,
        "server_version": env!("CARGO_PKG_VERSION"),
        "dns_sync_api": 2,
    })
}

pub fn public_json(dns: &DnsSettings) -> Value {
    let cf_set = !cf_key(dns).is_empty();
    let pb_set = porkbun_ready(dns);
    let token_set = match dns.provider.as_str() {
        "cloudflare" => cf_set,
        "porkbun" => pb_set,
        _ => false,
    };
    let mut inactive = Vec::new();
    match dns.provider.as_str() {
        "cloudflare" => {
            if pb_set {
                inactive.push("porkbun");
            }
        }
        "porkbun" => {
            if cf_set {
                inactive.push("cloudflare");
            }
        }
        _ => {
            if cf_set {
                inactive.push("cloudflare");
            }
            if pb_set {
                inactive.push("porkbun");
            }
        }
    }
    json!({
        "provider": dns.provider,
        "zone": dns.zone,
        "configured": configured(dns),
        "token_set": token_set,
        "cloudflare_token_set": cf_set,
        "porkbun_token_set": pb_set,
        "api_key_set": !dns.api_key.trim().is_empty(),
        "secret_set": !dns.secret.trim().is_empty(),
        "inactive_credentials": inactive,
    })
}

/// Efface les credentials d’un provider. Si on efface ceux du provider actif, désactive le DNS auto.
pub async fn clear_credentials(state: &AppState, which: &str) -> Result<DnsSettings, String> {
    let mut dns = load(state).await;
    let which = which.trim().to_lowercase();
    let targets: Vec<&str> = match which.as_str() {
        "cloudflare" => vec!["cloudflare"],
        "porkbun" => vec!["porkbun"],
        "inactive" => match dns.provider.as_str() {
            "cloudflare" => vec!["porkbun"],
            "porkbun" => vec!["cloudflare"],
            _ => {
                let mut t = Vec::new();
                if !cf_key(&dns).is_empty() {
                    t.push("cloudflare");
                }
                if porkbun_ready(&dns) {
                    t.push("porkbun");
                }
                t
            }
        },
        _ => return Err("which: cloudflare | porkbun | inactive".into()),
    };
    for t in targets {
        match t {
            "cloudflare" => {
                dns.cf_token.clear();
                // Legacy : token CF dans porkbun_api_key sans secret.
                if dns.secret.trim().is_empty() && !dns.api_key.trim().is_empty() {
                    dns.api_key.clear();
                }
                if dns.provider == "cloudflare" {
                    dns.provider.clear();
                }
            }
            "porkbun" => {
                dns.api_key.clear();
                dns.secret.clear();
                if dns.provider == "porkbun" {
                    dns.provider.clear();
                }
            }
            _ => {}
        }
    }
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        r#"UPDATE instance_settings SET
            dns_provider = $1, porkbun_api_key = $2, porkbun_secret = $3,
            cloudflare_api_token = $4, updated_at = $5
           WHERE id = 1"#,
    )
    .bind(&dns.provider)
    .bind(&dns.api_key)
    .bind(&dns.secret)
    .bind(&dns.cf_token)
    .bind(&now)
    .execute(&state.pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(load(state).await)
}

pub async fn ping_configured(state: &AppState) -> Result<(), String> {
    let dns = load(state).await;
    match dns.provider.as_str() {
        "cloudflare" => {
            if cf_key(&dns).is_empty() {
                return Err("Token Cloudflare manquant".into());
            }
            let _ = cloudflare_ping(cf_key(&dns))
                .await
                .map_err(|e| e.to_string())?;
            if !dns.zone.is_empty() {
                cloudflare_connect(cf_key(&dns), &dns.zone)
                    .await
                    .map_err(|e| e.to_string())?;
            }
            Ok(())
        }
        "porkbun" => {
            let c = porkbun_creds(&dns).ok_or("Porkbun : clé API, Secret API et domaine")?;
            porkbun_ping(&c).await.map_err(|e| e.to_string())?;
            porkbun_verify_zone(&c).await.map_err(|e| e.to_string())
        }
        _ => Err("Choisis Cloudflare ou Porkbun".into()),
    }
}
