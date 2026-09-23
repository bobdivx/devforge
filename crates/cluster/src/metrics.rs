use crate::models::NodeMetrics;
use std::process::Command;

/// Snapshot léger (load, RAM, disque, Docker) — heartbeat worker + affichage leader.
pub fn collect_node_metrics() -> NodeMetrics {
    let mut m = NodeMetrics::default();
    m.load_1 = load_1();
    if let Some(nproc) = std::thread::available_parallelism()
        .ok()
        .map(|n| n.get().max(1) as f64)
    {
        if let Some(load) = m.load_1 {
            m.cpu_percent = Some(((load / nproc) * 100.0).clamp(0.0, 100.0));
        }
    }
    if let Some((used, total)) = mem_bytes() {
        m.mem_used_bytes = Some(used);
        m.mem_total_bytes = Some(total);
    }
    if let Some((used, total)) = disk_bytes() {
        m.disk_used_bytes = Some(used);
        m.disk_total_bytes = Some(total);
    }
    docker_snapshot(&mut m);
    m.software_version = Some(
        std::env::var("DEVFORGE_VERSION")
            .unwrap_or_else(|_| env!("CARGO_PKG_VERSION").to_string())
            .trim_start_matches('v')
            .to_string(),
    );
    m.public_ip = public_ipv4();
    m
}

fn public_ipv4() -> Option<String> {
    use std::sync::Mutex;
    use std::time::{Duration, Instant};
    static CACHE: Mutex<Option<(Instant, String)>> = Mutex::new(None);
    if let Ok(guard) = CACHE.lock() {
        if let Some((at, ip)) = guard.as_ref() {
            if at.elapsed() < Duration::from_secs(600) {
                return Some(ip.clone());
            }
        }
    }
    let out = Command::new("curl")
        .args(["-4", "-fsS", "--max-time", "3", "https://api.ipify.org"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let ip = String::from_utf8_lossy(&out.stdout).trim().to_string();
    ip.parse::<std::net::Ipv4Addr>().ok()?;
    if let Ok(mut guard) = CACHE.lock() {
        *guard = Some((Instant::now(), ip.clone()));
    }
    Some(ip)
}

fn load_1() -> Option<f64> {
    let raw = std::fs::read_to_string("/proc/loadavg").ok()?;
    raw.split_whitespace().next()?.parse().ok()
}

fn mem_bytes() -> Option<(u64, u64)> {
    let raw = std::fs::read_to_string("/proc/meminfo").ok()?;
    let mut total_kb = None;
    let mut avail_kb = None;
    for line in raw.lines() {
        if line.starts_with("MemTotal:") {
            total_kb = parse_meminfo_kb(line);
        } else if line.starts_with("MemAvailable:") {
            avail_kb = parse_meminfo_kb(line);
        }
    }
    let total = total_kb? * 1024;
    let avail = avail_kb? * 1024;
    Some((total.saturating_sub(avail), total))
}

fn parse_meminfo_kb(line: &str) -> Option<u64> {
    line.split_whitespace().nth(1)?.parse().ok()
}

fn disk_bytes() -> Option<(u64, u64)> {
    let path = std::env::var("DEVFORGE_DATA_DIR").unwrap_or_else(|_| "/".into());
    let out = Command::new("df").args(["-Pk", &path]).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let line = text.lines().nth(1)?;
    let cols: Vec<&str> = line.split_whitespace().collect();
    let total_kb: u64 = cols.get(1)?.parse().ok()?;
    let used_kb: u64 = cols.get(2)?.parse().ok()?;
    Some((used_kb * 1024, total_kb * 1024))
}

fn docker_snapshot(m: &mut NodeMetrics) {
    match Command::new("docker")
        .args(["info", "-f", "{{.ServerVersion}}"])
        .output()
    {
        Ok(out) => m.docker_ok = Some(out.status.success()),
        Err(_) => m.docker_ok = Some(false),
    }
    if let Ok(out) = Command::new("docker").args(["ps", "-q"]).output() {
        if out.status.success() {
            let n = String::from_utf8_lossy(&out.stdout)
                .lines()
                .filter(|l| !l.trim().is_empty())
                .count();
            m.containers = Some(n as u32);
        }
    }
}

pub fn diagnostic_command() -> &'static str {
    "echo \"=== uptime ===\"; uptime 2>/dev/null || true; \
     echo \"=== mem ===\"; (free -h || true) 2>/dev/null | head -5; \
     echo \"=== disk ===\"; df -h / /data 2>/dev/null | head -8; \
     echo \"=== docker ===\"; docker ps --format 'table {{.Names}}\\t{{.Status}}\\t{{.Ports}}' 2>/dev/null | head -25; \
     echo \"=== df-* ===\"; docker ps -a --filter name=df- --format 'table {{.Names}}\\t{{.Status}}' 2>/dev/null | head -20"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostic_command_covers_host() {
        let cmd = diagnostic_command();
        assert!(cmd.contains("uptime"));
        assert!(cmd.contains("docker ps"));
    }

    #[test]
    fn collect_metrics_includes_software_version() {
        let m = collect_node_metrics();
        assert!(m.software_version.is_some());
        assert!(!m.software_version.unwrap().is_empty());
    }
}
