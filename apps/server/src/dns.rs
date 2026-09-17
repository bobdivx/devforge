//! Entrée publique auto : Porkbun (DNS A) ou Cloudflare (tunnel par nœud).

use crate::state::AppState;
use devforge_cluster::LEADER_NODE_ID;
use devforge_domain::{
    cloudflare_connect, cloudflare_ping, infer_zone, porkbun_lookup, porkbun_ping,
    porkbun_verify_zone, upsert_record, CloudflareClient, PorkbunCreds,
};
use serde_json::{json, Value};

#[derive(Debug, Clone, Default)]
pub struct DnsSettings {
    pub provider: String,
    pub zone: String,
    pub api_key: String,
    pub secret: String,
}

pub async fn load(state: &AppState) -> DnsSettings {
    let row: Option<(String, String, String, String, String)> = sqlx::query_as(
        "SELECT COALESCE(dns_provider,''), COALESCE(porkbun_zone,''), COALESCE(porkbun_api_key,''),
                COALESCE(porkbun_secret,''), COALESCE(wildcard_domain,'')
         FROM instance_settings WHERE id = 1",
    )
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();
    row.map(|(provider, zone, api_key, secret, wildcard)| {
        let zone = if zone.trim().is_empty() {
            infer_zone(&wildcard)
        } else {
            zone.trim().trim_start_matches('.').to_lowercase()
        };
        DnsSettings {
            provider: provider.trim().to_lowercase(),
            zone,
            api_key,
            secret,
        }
    })
    .unwrap_or_default()
}

pub fn configured(dns: &DnsSettings) -> bool {
    if dns.zone.is_empty() || dns.api_key.trim().is_empty() {
        return false;
    }
    match dns.provider.as_str() {
        "cloudflare" => true,
        "porkbun" => !dns.secret.trim().is_empty(),
        _ => false,
    }
}

fn porkbun_creds(dns: &DnsSettings) -> Option<PorkbunCreds> {
    if dns.provider != "porkbun" || !configured(dns) {
        return None;
    }
    Some(PorkbunCreds {
        apikey: dns.api_key.clone(),
        secretapikey: dns.secret.clone(),
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

async fn ingress_for(state: &AppState, server_id: &str) -> String {
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
            match cloudflare_connect(&dns.api_key, &dns.zone).await {
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
            if cur.is_empty() {
                if let Some(ip) = detect_public_ip(state, &sid).await {
                    set_ingress_host(state, &sid, &ip).await;
                }
            }
        }
        _ => {}
    }
}

async fn docker_running(state: &AppState, server_id: &str, container: &str) -> Result<bool, String> {
    let cmd = format!(
        "docker inspect -f '{{{{.State.Running}}}}' {container} 2>/dev/null || echo false"
    );
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
    if dns.api_key.trim().is_empty() {
        return Err("Token manquant".into());
    }
    match dns.provider.as_str() {
        "cloudflare" => {
            let _ = cloudflare_ping(&dns.api_key)
                .await
                .map_err(|e| e.to_string())?;
        }
        "porkbun" => {
            let c = porkbun_creds(&dns).ok_or("Porkbun : colle APIKEY:SECRET")?;
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
        return Ok(v);
    }
    let projects: Vec<(String,)> = sqlx::query_as("SELECT uuid FROM projects")
        .fetch_all(&state.pool)
        .await
        .unwrap_or_default();
    for (uuid,) in projects {
        sync_project(state, &uuid).await;
    }
    Ok(collect_status(state).await)
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
            match provision_nodes(&state).await {
                Ok(v) if v.get("skipped").and_then(|x| x.as_bool()).unwrap_or(false) => {}
                Ok(_) => tracing::debug!("dns loop ok"),
                Err(e) => tracing::warn!(error = %e, "dns loop"),
            }
        }
    });
}

pub async fn sync_fqdn(state: &AppState, fqdn: &str, server_id: &str) {
    let dns = load(state).await;
    if !configured(&dns) {
        return;
    }
    let mut host = ingress_for(state, server_id).await;
    if host.is_empty() {
        provision_node(state, server_id).await;
        host = ingress_for(state, server_id).await;
    }
    if host.is_empty() {
        tracing::warn!(fqdn, "pas de cible DNS pour ce nœud");
        return;
    }
    match dns.provider.as_str() {
        "porkbun" => {
            if let Some(c) = porkbun_creds(&dns) {
                match upsert_record(&c, fqdn, &host).await {
                    Ok(()) => tracing::info!(fqdn, target = %host, "Porkbun OK"),
                    Err(e) => tracing::warn!(fqdn, error = %e, "Porkbun"),
                }
            }
        }
        "cloudflare" => match cloudflare_connect(&dns.api_key, &dns.zone).await {
            Ok(cf) => {
                if let Err(e) = cf.upsert_cname(fqdn, &host).await {
                    tracing::warn!(fqdn, error = %e, "Cloudflare DNS");
                } else {
                    tracing::info!(fqdn, target = %host, "Cloudflare CNAME OK");
                }
            }
            Err(e) => tracing::warn!(error = %e, "Cloudflare connect"),
        },
        _ => {}
    }
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
            if let Ok(cf) = cloudflare_connect(&dns.api_key, &dns.zone).await {
                if let Err(e) = cf.delete_name(fqdn).await {
                    tracing::warn!(fqdn, error = %e, "Cloudflare delete");
                }
            }
        }
        _ => {}
    }
}

pub async fn sync_project(state: &AppState, project_uuid: &str) {
    let row: Option<(Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT server_id, production_url FROM projects WHERE uuid = ?",
    )
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();
    let Some((server_id, production_url)) = row else {
        return;
    };
    let server_id = server_id.unwrap_or_default();
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
    for fqdn in fqdns {
        sync_fqdn(state, &fqdn, &server_id).await;
    }
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
        if n.ingress_host.ends_with("cfargotunnel.com") {
            return;
        }
        if n.ingress_host.trim().is_empty() || n.ingress_host == ip {
            set_ingress_host(state, &id, ip).await;
        }
    }
}

async fn list_managed_domains(state: &AppState) -> Vec<Value> {
    let rows: Vec<(String, String, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT uuid, name, server_id, production_url FROM projects ORDER BY name",
    )
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
    a.trim().trim_end_matches('.').eq_ignore_ascii_case(b.trim().trim_end_matches('.'))
}

async fn enrich_live_records(dns: &DnsSettings, domains: &mut [Value]) {
    if domains.is_empty() {
        return;
    }
    match dns.provider.as_str() {
        "porkbun" => {
            let Some(c) = porkbun_creds(dns) else {
                return;
            };
            for d in domains.iter_mut() {
                let fqdn = d["fqdn"].as_str().unwrap_or("").to_string();
                let target = d["target"].as_str().unwrap_or("").to_string();
                match porkbun_lookup(&c, &fqdn).await {
                    Ok(Some((kind, content))) => {
                        let synced = same_dns_target(&content, &target);
                        d["live_kind"] = json!(kind);
                        d["live"] = json!(content);
                        d["in_sync"] = json!(synced);
                        if !synced {
                            d["error"] = json!(format!(
                                "Porkbun a {kind} {content}, attendu {target}"
                            ));
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
            let Ok(cf) = cloudflare_connect(&dns.api_key, &dns.zone).await else {
                return;
            };
            for d in domains.iter_mut() {
                let fqdn = d["fqdn"].as_str().unwrap_or("").to_string();
                let target = d["target"].as_str().unwrap_or("").to_string();
                match cf.lookup_name(&fqdn).await {
                    Ok(Some((kind, content))) => {
                        let synced = same_dns_target(&content, &target);
                        d["live_kind"] = json!(kind);
                        d["live"] = json!(content);
                        d["in_sync"] = json!(synced);
                        if !synced {
                            d["error"] = json!(format!(
                                "Cloudflare a {kind} {content}, attendu {target}"
                            ));
                        }
                    }
                    Ok(None) => {
                        d["in_sync"] = json!(false);
                        d["error"] = json!("CNAME absent chez Cloudflare");
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
    if !dns.provider.is_empty() && !dns.api_key.trim().is_empty() {
        match dns.provider.as_str() {
            "cloudflare" => match cloudflare_ping(&dns.api_key).await {
                Ok(name) => {
                    token_ok = true;
                    account = name;
                    if !dns.zone.is_empty() {
                        if let Err(e) = cloudflare_connect(&dns.api_key, &dns.zone).await {
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
                None => error = Some("Porkbun : token APIKEY:SECRET incomplet".into()),
            },
            _ => {}
        }
    } else if !dns.provider.is_empty() {
        error = Some("Token manquant".into());
    }

    let listed = state.cluster.list_nodes().await.unwrap_or_default();
    let ids = node_ids(state).await.unwrap_or_else(|_| vec![LEADER_NODE_ID.into()]);
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
        let traefik = docker_running(state, &id, "devforge-traefik").await;
        let agent = if dns.provider == "cloudflare" {
            docker_running(state, &id, "devforge-cloudflared").await
        } else {
            Ok(false)
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
        if let Some(e) = traefik_err {
            node_error = Some(format!("nœud injoignable ({e})"));
        } else if dns.provider == "cloudflare" {
            if let Some(e) = agent_err {
                node_error = Some(format!("nœud injoignable ({e})"));
            }
        }
        match dns.provider.as_str() {
            "cloudflare" => {
                if !ingress.ends_with("cfargotunnel.com") {
                    node_error = Some(
                        node_error.unwrap_or_else(|| "tunnel Cloudflare non créé".into()),
                    );
                } else if !agent_ok && node_error.is_none() {
                    node_error = Some("cloudflared n’est pas démarré".into());
                } else if !traefik_ok && node_error.is_none() {
                    node_error = Some("Traefik n’est pas démarré".into());
                }
            }
            "porkbun" => {
                if ingress.is_empty() && node_error.is_none() {
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
                "porkbun" => !ingress.is_empty(),
                _ => true,
            };
        nodes_out.push(json!({
            "id": id,
            "name": name,
            "role": role,
            "tunnel": if dns.provider == "cloudflare" { tunnel_name(&id) } else { String::new() },
            "ingress": ingress,
            "public_ip": public_ip,
            "traefik": traefik_ok,
            "cloudflared": agent_ok,
            "ok": ok,
            "error": node_error,
        }));
    }

    let mut domains = list_managed_domains(state).await;
    enrich_live_records(&dns, &mut domains).await;
    let nodes_ok = !nodes_out.is_empty() && nodes_out.iter().all(|n| n["ok"].as_bool() == Some(true));
    let domains_ok = domains
        .iter()
        .all(|d| d["in_sync"].as_bool().unwrap_or(true));
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
    })
}

pub fn public_json(dns: &DnsSettings) -> Value {
    json!({
        "provider": dns.provider,
        "zone": dns.zone,
        "configured": configured(dns),
        "token_set": !dns.api_key.trim().is_empty(),
        "api_key_set": !dns.api_key.trim().is_empty(),
        "secret_set": !dns.secret.trim().is_empty(),
    })
}

pub async fn ping_configured(state: &AppState) -> Result<(), String> {
    let dns = load(state).await;
    match dns.provider.as_str() {
        "cloudflare" => {
            if dns.api_key.trim().is_empty() {
                return Err("Token Cloudflare manquant".into());
            }
            let _ = cloudflare_ping(&dns.api_key)
                .await
                .map_err(|e| e.to_string())?;
            if !dns.zone.is_empty() {
                cloudflare_connect(&dns.api_key, &dns.zone)
                    .await
                    .map_err(|e| e.to_string())?;
            }
            Ok(())
        }
        "porkbun" => {
            let c = porkbun_creds(&dns).ok_or("Porkbun : token APIKEY:SECRET et domaine")?;
            porkbun_ping(&c).await.map_err(|e| e.to_string())?;
            porkbun_verify_zone(&c).await.map_err(|e| e.to_string())
        }
        _ => Err("Choisis Cloudflare ou Porkbun".into()),
    }
}
