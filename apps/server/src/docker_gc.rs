//! Nettoyage Docker automatique (cache de build, images inutilisées, anciennes
//! images de déploiement) sur chaque nœud du cluster.
//!
//! Ce module ne contient que la logique pure (réglages, scripts shell, parsing,
//! sélection) ; l'exécution, la planification et l'API sont dans
//! `docker_gc_routes.rs`.
//!
//! Garanties (testées) :
//! - jamais de `docker volume …`, `container prune` ni `system prune` ;
//! - jamais `docker image rm -f` : Docker refuse donc de supprimer une image
//!   utilisée par un conteneur, même arrêté (filet de sécurité en plus de la
//!   sélection) ;
//! - une image utilisée par un conteneur (en cours ou arrêté) n'est jamais
//!   sélectionnée, ni `df-…:latest` (image du déploiement courant) ;
//! - par projet DevForge (`df-<id>`), les N images les plus récentes sont gardées
//!   pour un rollback.

use std::collections::{BTreeMap, HashMap, HashSet};

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

pub const DEFAULT_TIMEZONE: &str = "Europe/Paris";

/// Réglages (stockés en JSON dans `docker_gc_settings`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct GcSettings {
    pub enabled: bool,
    /// Fréquence en heures (diviseur de 24, ou multiple de 24 jusqu'à 168).
    pub frequency_hours: u32,
    /// Heure locale du premier passage (0–23).
    pub hour: u32,
    /// Expression cron (5 champs) : remplace fréquence + heure si renseignée.
    pub cron: Option<String>,
    pub timezone: String,
    /// Âge minimal du cache de build et des images inutilisées supprimés.
    pub retention_hours: u32,
    /// Images gardées par projet pour un rollback.
    pub keep_per_project: u32,
    /// Seuil d'occupation disque (%) qui déclenche un nettoyage d'urgence.
    pub disk_alert_percent: u32,
    /// Rotation des logs des conteneurs lancés par DevForge (`--log-opt`).
    pub log_rotation: bool,
    pub log_max_size_mb: u32,
    pub log_max_files: u32,
}

impl Default for GcSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            frequency_hours: 24,
            hour: 3,
            cron: None,
            timezone: DEFAULT_TIMEZONE.into(),
            retention_hours: 24,
            keep_per_project: 3,
            disk_alert_percent: 85,
            log_rotation: false,
            log_max_size_mb: 10,
            log_max_files: 3,
        }
    }
}

impl GcSettings {
    pub fn validate(&self) -> Result<(), String> {
        let f = self.frequency_hours;
        if f == 0 || f > 168 || (24 % f != 0 && f % 24 != 0) {
            return Err(
                "Fréquence : 1, 2, 3, 4, 6, 8, 12 h ou un multiple de 24 h (max 168 h).".into(),
            );
        }
        if self.hour > 23 {
            return Err("Heure : entre 0 et 23.".into());
        }
        if !devforge_cron::timezone_is_known(&self.timezone) {
            return Err(format!("Fuseau inconnu : {}", self.timezone));
        }
        if let Some(c) = self
            .cron
            .as_deref()
            .map(str::trim)
            .filter(|c| !c.is_empty())
        {
            if !devforge_cron::is_five_fields(c) {
                return Err("Cron : 5 champs (minute heure jour mois jour-semaine).".into());
            }
            devforge_cron::validate_cron_expression(c)?;
            if devforge_cron::min_interval_minutes(c).is_some_and(|m| m < 60) {
                return Err("Cron : au plus un passage par heure.".into());
            }
        }
        if !(1..=720).contains(&self.retention_hours) {
            return Err("Rétention : entre 1 et 720 h.".into());
        }
        if !(1..=20).contains(&self.keep_per_project) {
            return Err("Images gardées par projet : entre 1 et 20.".into());
        }
        if !(50..=99).contains(&self.disk_alert_percent) {
            return Err("Seuil d'alerte disque : entre 50 et 99 %.".into());
        }
        if !(1..=1024).contains(&self.log_max_size_mb) || !(1..=20).contains(&self.log_max_files) {
            return Err("Logs : taille 1–1024 Mo, 1–20 fichiers.".into());
        }
        Ok(())
    }

    /// Expression cron effective (5 champs, fuseau [`Self::timezone`]).
    pub fn cron_expression(&self) -> String {
        if let Some(c) = self
            .cron
            .as_deref()
            .map(str::trim)
            .filter(|c| !c.is_empty())
        {
            return c.to_string();
        }
        let h = self.hour.min(23);
        let f = self.frequency_hours.clamp(1, 168);
        if f < 24 && 24 % f == 0 {
            let mut hours: Vec<u32> = (0..24 / f).map(|k| (h + k * f) % 24).collect();
            hours.sort_unstable();
            let list: Vec<String> = hours.iter().map(u32::to_string).collect();
            return format!("0 {} * * *", list.join(","));
        }
        match f / 24 {
            0 | 1 => format!("0 {h} * * *"),
            7 => format!("0 {h} * * 1"),
            d => format!("0 {h} */{d} * *"),
        }
    }

    pub fn next_run(&self) -> Option<DateTime<Utc>> {
        devforge_cron::next_run_time(&self.cron_expression(), Some(&self.timezone))
    }
}

// ───────────────────────── Inventaire ─────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ImageInfo {
    pub id: String,
    pub created: DateTime<Utc>,
    pub size: u64,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ContainerInfo {
    pub id: String,
    pub image_id: String,
    pub state: String,
    pub name: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct DiskInfo {
    pub root_dir: String,
    pub logging_driver: String,
    pub docker_version: String,
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub avail_bytes: u64,
    pub percent: f64,
    /// Ancien cron `devforge-disk-guard` : present / absent / container.
    pub legacy_guard: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct Inventory {
    pub disk: DiskInfo,
    pub images: Vec<ImageInfo>,
    pub containers: Vec<ContainerInfo>,
    pub builders: Vec<String>,
    /// Conteneurs BuildKit en cours (`buildx_buildkit_*`), nettoyés via `buildctl`.
    pub buildkit: Vec<String>,
    /// Lignes `docker system df` : (type, taille, récupérable).
    pub system_df: Vec<(String, String, String)>,
}

/// `DOCKER_CONFIG` inscriptible (ZimaOS : `/root/.docker` en lecture seule)
/// puis racine Docker (`$R`).
const ROOT_DETECT: &str = "DC=\"${DOCKER_CONFIG:-$HOME/.docker}\"; \
     if ! mkdir -p \"$DC\" 2>/dev/null || [ ! -w \"$DC\" ]; then \
     export DOCKER_CONFIG=/tmp/devforge-docker-gc; mkdir -p \"$DOCKER_CONFIG\"; fi; \
     R=$(docker info -f '{{.DockerRootDir}}' 2>/dev/null); [ -n \"$R\" ] || R=/var/lib/docker";

/// Ancien garde-fou cron (installé à la main avant la v2) : cassé sous dcron
/// (champ `root` + lignes de variables refusés) et il supprimait les
/// conteneurs arrêtés. Remplacé par le planificateur intégré.
pub const LEGACY_GUARD_CRON: &str = "/etc/cron.d/devforge-disk-guard";

/// État de l'ancien cron : `container` (DevForge conteneurisé, hôte non
/// visible), `present` ou `absent`.
const LEGACY_DETECT: &str = "if [ -f /.dockerenv ]; then echo container; \
     elif [ -f /etc/cron.d/devforge-disk-guard ]; then echo present; else echo absent; fi";

/// Désactive l'ancien cron s'il est visible : déplacé (réversible) vers
/// `/DATA/.devforge/state/` (persistant sur ZimaOS), sinon `/var/tmp`.
pub fn retire_legacy_guard_command() -> String {
    format!(
        "f={LEGACY_GUARD_CRON}; if [ ! -f /.dockerenv ] && [ -f \"$f\" ] && grep -q 'disk-guard.sh' \"$f\"; then \
         d=/DATA/.devforge/state; mkdir -p \"$d\" 2>/dev/null || d=/var/tmp; \
         mv \"$f\" \"$d/devforge-disk-guard.cron.disabled\" && echo retired || echo failed; else echo noop; fi"
    )
}

/// Commande légère : disque de la racine Docker + driver de logs.
pub fn disk_command() -> String {
    format!(
        "{ROOT_DETECT}; echo '@@info'; docker info -f '{{{{.DockerRootDir}}}}|{{{{.LoggingDriver}}}}|{{{{.ServerVersion}}}}' 2>/dev/null; \
         echo '@@df'; df -Pk \"$R\" 2>/dev/null | tail -n 1; echo '@@legacy'; {LEGACY_DETECT}; echo '@@end'"
    )
}

/// Inventaire en lecture seule (aucune suppression).
pub fn inventory_command() -> String {
    format!(
        "{disk}; echo '@@images'; I=$(docker image ls -q --no-trunc 2>/dev/null | sort -u); \
         [ -z \"$I\" ] || docker image inspect --format '{{{{.Id}}}}|{{{{.Created}}}}|{{{{.Size}}}}|{{{{join .RepoTags \",\"}}}}' $I 2>/dev/null; \
         echo '@@containers'; C=$(docker ps -aq --no-trunc 2>/dev/null); \
         [ -z \"$C\" ] || docker inspect --type container --format '{{{{.Id}}}}|{{{{.Image}}}}|{{{{.State.Status}}}}|{{{{.Name}}}}' $C 2>/dev/null; \
         echo '@@builders'; docker buildx ls 2>/dev/null; \
         echo '@@buildkit'; docker ps --filter name=buildx_buildkit_ --format '{{{{.Names}}}}' 2>/dev/null; \
         echo '@@sysdf'; docker system df --format '{{{{.Type}}}}|{{{{.Size}}}}|{{{{.Reclaimable}}}}' 2>/dev/null; echo '@@end'",
        disk = disk_command().trim_end_matches("; echo '@@end'")
    )
}

/// Cache de build récupérable : par builder buildx (plus vieux que
/// `retention_hours`) et par conteneur BuildKit (`buildctl du`, sans filtre
/// d'âge disponible : total récupérable).
pub fn cache_du_command(
    builders: &[String],
    buildkit: &[String],
    retention_hours: Option<u32>,
) -> String {
    let filter = retention_hours
        .map(|h| format!(" --filter until={h}h"))
        .unwrap_or_default();
    let mut cmd = format!("{ROOT_DETECT}; echo '@@cache'");
    for c in buildkit.iter().filter(|c| is_safe_name(c)) {
        cmd.push_str(&format!(
            "; printf '%s|%s\\n' 'buildkit:{c}' \"$(docker exec '{c}' buildctl du 2>/dev/null | awk '/^Reclaimable:/{{print $2}}' | tail -n 1)\""
        ));
    }
    for b in builders.iter().filter(|b| is_safe_name(b)) {
        cmd.push_str(&format!(
            "; printf '%s|%s\\n' '{b}' \"$(docker buildx du --builder '{b}'{filter} 2>/dev/null | awk '/^Reclaimable:/{{print $2}}' | tail -n 1)\""
        ));
    }
    cmd.push_str("; echo '@@end'");
    cmd
}

fn is_safe_name(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
}

/// Référence d'image passable à `docker image rm` (tag ou id), sans
/// caractère shell.
fn is_safe_ref(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 256
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_.:/@".contains(c))
}

fn sections(output: &str) -> HashMap<String, Vec<String>> {
    let mut out: HashMap<String, Vec<String>> = HashMap::new();
    let mut current: Option<String> = None;
    for line in output.lines() {
        let t = line.trim_end();
        if let Some(name) = t.trim().strip_prefix("@@") {
            let name = name.trim().to_string();
            current = if name == "end" {
                None
            } else {
                Some(name.clone())
            };
            if let Some(n) = &current {
                out.entry(n.clone()).or_default();
            }
            continue;
        }
        if let Some(n) = &current {
            if !t.trim().is_empty() {
                out.entry(n.clone()).or_default().push(t.to_string());
            }
        }
    }
    out
}

pub fn parse_disk(output: &str) -> DiskInfo {
    let s = sections(output);
    let mut d = DiskInfo::default();
    if let Some(line) = s.get("info").and_then(|v| v.first()) {
        let mut p = line.split('|');
        d.root_dir = p.next().unwrap_or("").trim().to_string();
        d.logging_driver = p.next().unwrap_or("").trim().to_string();
        d.docker_version = p.next().unwrap_or("").trim().to_string();
    }
    if let Some(line) = s.get("legacy").and_then(|v| v.first()) {
        d.legacy_guard = line.trim().to_string();
    }
    if let Some(line) = s.get("df").and_then(|v| v.last()) {
        let cols: Vec<&str> = line.split_whitespace().collect();
        // Filesystem 1024-blocks Used Available Capacity Mounted
        if cols.len() >= 4 {
            let total = cols[1].parse::<u64>().unwrap_or(0) * 1024;
            let used = cols[2].parse::<u64>().unwrap_or(0) * 1024;
            let avail = cols[3].parse::<u64>().unwrap_or(0) * 1024;
            d.total_bytes = total;
            d.used_bytes = used;
            d.avail_bytes = avail;
            if used + avail > 0 {
                d.percent = ((used as f64) * 1000.0 / ((used + avail) as f64)).round() / 10.0;
            }
        }
    }
    d
}

/// Noms des builders `docker buildx ls` (formats ancien et nouveau).
pub fn parse_builders(lines: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for line in lines {
        if line.starts_with(char::is_whitespace) || line.starts_with('\\') {
            continue;
        }
        let Some(first) = line.split_whitespace().next() else {
            continue;
        };
        if first == "NAME/NODE" || first == "NAME" {
            continue;
        }
        let name = first.trim_end_matches('*').trim();
        if is_safe_name(name) && !out.iter().any(|n| n == name) {
            out.push(name.to_string());
        }
    }
    out
}

pub fn parse_inventory(output: &str) -> Inventory {
    let s = sections(output);
    let mut inv = Inventory {
        disk: parse_disk(output),
        ..Default::default()
    };
    let mut seen = HashSet::new();
    for line in s.get("images").into_iter().flatten() {
        let p: Vec<&str> = line.splitn(4, '|').collect();
        if p.len() < 3 {
            continue;
        }
        let Ok(created) = DateTime::parse_from_rfc3339(p[1].trim()) else {
            continue;
        };
        let id = p[0].trim().to_string();
        if !seen.insert(id.clone()) {
            continue;
        }
        let tags = p
            .get(3)
            .map(|t| {
                t.split(',')
                    .map(str::trim)
                    .filter(|t| !t.is_empty() && *t != "<none>:<none>")
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        inv.images.push(ImageInfo {
            id,
            created: created.with_timezone(&Utc),
            size: p[2].trim().parse().unwrap_or(0),
            tags,
        });
    }
    for line in s.get("containers").into_iter().flatten() {
        let p: Vec<&str> = line.splitn(4, '|').collect();
        if p.len() < 3 {
            continue;
        }
        inv.containers.push(ContainerInfo {
            id: p[0].trim().to_string(),
            image_id: p[1].trim().to_string(),
            state: p[2].trim().to_string(),
            name: p
                .get(3)
                .unwrap_or(&"")
                .trim()
                .trim_start_matches('/')
                .to_string(),
        });
    }
    inv.builders = parse_builders(s.get("builders").map(Vec::as_slice).unwrap_or(&[]));
    for line in s.get("buildkit").into_iter().flatten() {
        let n = line.trim();
        if n.starts_with("buildx_buildkit_")
            && is_safe_name(n)
            && !inv.buildkit.iter().any(|b| b == n)
        {
            inv.buildkit.push(n.to_string());
        }
    }
    for line in s.get("sysdf").into_iter().flatten() {
        let p: Vec<&str> = line.splitn(3, '|').collect();
        if p.len() == 3 {
            inv.system_df
                .push((p[0].trim().into(), p[1].trim().into(), p[2].trim().into()));
        }
    }
    inv
}

/// `builder|1.2GB` → (builder, octets).
pub fn parse_cache_du(output: &str) -> Vec<(String, u64)> {
    sections(output)
        .get("cache")
        .into_iter()
        .flatten()
        .filter_map(|l| {
            let (b, size) = l.split_once('|')?;
            Some((b.trim().to_string(), parse_size(size).unwrap_or(0)))
        })
        .collect()
}

/// Taille Docker (`1.23GB`, `512MB`, `12.3kB`, `0B`, `1.5GiB`) → octets.
pub fn parse_size(s: &str) -> Option<u64> {
    let t = s.trim().split_whitespace().next()?.trim();
    // `docker system df` : « 1.2GB (45%) » → on ne garde que la taille.
    let t = t.split('(').next()?.trim();
    if t.is_empty() {
        return None;
    }
    let idx = t
        .find(|c: char| !(c.is_ascii_digit() || c == '.'))
        .unwrap_or(t.len());
    let (num, unit) = t.split_at(idx);
    let n: f64 = num.parse().ok()?;
    let mult: f64 = match unit.trim().to_ascii_lowercase().as_str() {
        "" | "b" => 1.0,
        "kb" => 1e3,
        "mb" => 1e6,
        "gb" => 1e9,
        "tb" => 1e12,
        "kib" => 1024.0,
        "mib" => 1024f64.powi(2),
        "gib" => 1024f64.powi(3),
        "tib" => 1024f64.powi(4),
        _ => return None,
    };
    Some((n * mult).round() as u64)
}

// ───────────────────────── Sélection ─────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Candidate {
    pub id: String,
    /// Références à passer à `docker image rm` (tags, sinon l'id).
    pub refs: Vec<String>,
    pub size: u64,
    pub created: DateTime<Utc>,
    pub project: Option<String>,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Kept {
    pub id: String,
    pub tags: Vec<String>,
    pub reason: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct ImagePlan {
    pub remove: Vec<Candidate>,
    pub kept: Vec<Kept>,
}

impl ImagePlan {
    pub fn bytes(&self) -> u64 {
        self.remove.iter().map(|c| c.size).sum()
    }
}

/// `docker.io/library/df-abc:r2026…` → (`df-abc`, `r2026…`).
fn split_tag(tag: &str) -> (String, String) {
    let t = tag
        .trim_start_matches("docker.io/")
        .trim_start_matches("library/");
    match t.rfind(':') {
        Some(i) if !t[i + 1..].contains('/') => (t[..i].to_string(), t[i + 1..].to_string()),
        _ => (t.to_string(), "latest".to_string()),
    }
}

/// Projet DevForge d'une image (`df-<id>` ou preview `df-pv…`), sinon `None`.
fn project_of(image: &ImageInfo) -> Option<String> {
    image.tags.iter().find_map(|t| {
        let (repo, _) = split_tag(t);
        let rest = repo.strip_prefix("df-")?;
        (!rest.is_empty() && rest.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'))
            .then_some(repo)
    })
}

fn is_current_deploy(image: &ImageInfo) -> bool {
    image.tags.iter().any(|t| {
        let (repo, tag) = split_tag(t);
        repo.starts_with("df-") && tag == "latest"
    })
}

/// Choisit les images à supprimer. Ne regarde ni les volumes ni les
/// conteneurs : un conteneur (quel que soit son état) protège son image.
pub fn select_images(
    images: &[ImageInfo],
    containers: &[ContainerInfo],
    now: DateTime<Utc>,
    retention_hours: u32,
    keep_per_project: u32,
) -> ImagePlan {
    let running: HashSet<&str> = containers
        .iter()
        .filter(|c| c.state == "running" || c.state == "restarting" || c.state == "paused")
        .map(|c| c.image_id.as_str())
        .collect();
    let used: HashSet<&str> = containers.iter().map(|c| c.image_id.as_str()).collect();
    let cutoff = now - Duration::hours(i64::from(retention_hours));
    let keep_n = keep_per_project.max(1) as usize;

    let mut plan = ImagePlan::default();
    let mut by_project: BTreeMap<String, Vec<&ImageInfo>> = BTreeMap::new();
    for img in images {
        if let Some(p) = project_of(img) {
            by_project.entry(p).or_default().push(img);
        }
    }
    let mut rollback_kept: HashSet<&str> = HashSet::new();
    for list in by_project.values_mut() {
        list.sort_by(|a, b| b.created.cmp(&a.created));
        for img in list.iter().take(keep_n) {
            rollback_kept.insert(img.id.as_str());
        }
    }

    for img in images {
        let kept = |reason: &str| Kept {
            id: img.id.clone(),
            tags: img.tags.clone(),
            reason: reason.into(),
        };
        if running.contains(img.id.as_str()) {
            plan.kept.push(kept("utilisée par un conteneur en cours"));
            continue;
        }
        if used.contains(img.id.as_str()) {
            plan.kept
                .push(kept("utilisée par un conteneur arrêté (jamais touché)"));
            continue;
        }
        if is_current_deploy(img) {
            plan.kept.push(kept("image du déploiement courant"));
            continue;
        }
        let project = project_of(img);
        let reason = if project.is_some() {
            if rollback_kept.contains(img.id.as_str()) {
                plan.kept
                    .push(kept(&format!("gardée pour rollback ({keep_n} par projet)")));
                continue;
            }
            format!("ancien déploiement (au-delà des {keep_n} gardées)")
        } else if img.created <= cutoff {
            if img.tags.is_empty() {
                format!("image orpheline de plus de {retention_hours} h")
            } else {
                format!("inutilisée, créée il y a plus de {retention_hours} h")
            }
        } else {
            plan.kept
                .push(kept(&format!("plus récente que {retention_hours} h")));
            continue;
        };
        let refs: Vec<String> = if img.tags.is_empty() {
            vec![img.id.clone()]
        } else {
            img.tags.clone()
        };
        if !refs.iter().all(|r| is_safe_ref(r)) {
            plan.kept.push(kept("référence non reconnue (ignorée)"));
            continue;
        }
        plan.remove.push(Candidate {
            id: img.id.clone(),
            refs,
            size: img.size,
            created: img.created,
            project,
            reason,
        });
    }
    plan.remove.sort_by(|a, b| b.size.cmp(&a.size));
    plan
}

/// Script de nettoyage d'un nœud. `cache_until_hours = None` (urgence) vide
/// tout le cache de build inutilisé. N'utilise jamais `-f` sur `image rm`.
pub fn cleanup_command(
    builders: &[String],
    buildkit: &[String],
    cache_until_hours: Option<u32>,
    plan: &ImagePlan,
) -> String {
    let filter = cache_until_hours
        .map(|h| format!(" --filter until={h}h"))
        .unwrap_or_default();
    let avail = "$(df -Pk \"$R\" 2>/dev/null | tail -n 1 | awk '{print $4}')";
    let mut cmd = format!("{ROOT_DETECT}; A0={avail}");
    let safe: Vec<&String> = builders.iter().filter(|b| is_safe_name(b)).collect();
    if safe.is_empty() {
        cmd.push_str(&format!(
            "; echo '@@cache default'; docker builder prune -f{filter} 2>&1 | tail -n 2"
        ));
    } else {
        for b in safe {
            cmd.push_str(&format!(
                "; echo '@@cache {b}'; docker buildx prune --builder '{b}' -f{filter} 2>&1 | tail -n 2"
            ));
        }
    }
    // Builders buildx non enregistrés pour cet utilisateur (ZimaOS) : prune
    // directement dans chaque conteneur BuildKit en cours.
    let keep = cache_until_hours
        .map(|h| format!(" --keep-duration {h}h"))
        .unwrap_or_default();
    for c in buildkit.iter().filter(|c| is_safe_name(c)) {
        cmd.push_str(&format!(
            "; echo '@@cache {c}'; docker exec '{c}' buildctl prune{keep} 2>&1 | tail -n 2"
        ));
    }
    for c in &plan.remove {
        for r in c.refs.iter().filter(|r| is_safe_ref(r)) {
            cmd.push_str(&format!(
                "; echo '@@rmi {r}'; docker image rm '{r}' 2>&1 | tail -n 2"
            ));
        }
    }
    cmd.push_str(&format!("; echo \"@@avail $A0 {avail}\"; echo '@@end'"));
    cmd
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct CleanupOutcome {
    pub freed_bytes: u64,
    pub images_removed: u32,
    pub errors: Vec<String>,
}

/// Lit la sortie de [`cleanup_command`] : espace libéré (df avant/après),
/// images supprimées et erreurs.
pub fn parse_cleanup(output: &str) -> CleanupOutcome {
    let mut out = CleanupOutcome::default();
    let mut current: Option<String> = None;
    let mut rmi_ok = false;
    let finish = |cur: &Option<String>, ok: bool, out: &mut CleanupOutcome| {
        if ok && cur.as_deref().is_some_and(|c| c.starts_with("rmi ")) {
            out.images_removed += 1;
        }
    };
    for line in output.lines() {
        let t = line.trim();
        if let Some(rest) = t.strip_prefix("@@") {
            finish(&current, rmi_ok, &mut out);
            rmi_ok = false;
            if let Some(nums) = rest.strip_prefix("avail ") {
                let v: Vec<u64> = nums
                    .split_whitespace()
                    .filter_map(|n| n.parse().ok())
                    .collect();
                if v.len() == 2 {
                    out.freed_bytes = v[1].saturating_sub(v[0]) * 1024;
                }
                current = None;
                continue;
            }
            current = (rest != "end").then(|| rest.to_string());
            continue;
        }
        let Some(cur) = &current else { continue };
        if cur.starts_with("rmi ") {
            // « Deleted: » n'apparaît qu'à la suppression effective de l'image
            // (les tags précédents ne donnent que « Untagged: »).
            if t.starts_with("Deleted:") {
                rmi_ok = true;
            } else if t.to_ascii_lowercase().contains("error") {
                out.errors.push(format!("{}: {}", cur, t));
            }
        } else if cur.starts_with("cache ") && t.to_ascii_lowercase().contains("error") {
            out.errors.push(format!("{}: {}", cur, t));
        }
    }
    finish(&current, rmi_ok, &mut out);
    out
}
