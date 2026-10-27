//! Logs d'exécution d'un conteneur projet (lecture seule).
//!
//! Utilisé par l'API `GET /api/v1/projects/{uuid}/runtime-logs` et par l'outil
//! MCP / agent `get_container_logs` : même validation, même commande Docker,
//! même masquage des secrets.
//!
//! - `tail` : nombre de lignes renvoyées (défaut 200, max [`MAX_TAIL`]) ;
//! - `since` : durée relative (`30m`, `2h`, `1h30m`, `1d`), horodatage
//!   RFC 3339 ou epoch Unix ;
//! - `grep` : filtre texte insensible à la casse (appliqué sur toute la
//!   fenêtre `since` / [`MAX_SCAN_LINES`] lignes, puis `tail` sur les
//!   correspondances) ;
//! - `level` : `error` | `warn` | `info` | `debug` (seuil minimal, heuristique
//!   sur les mots-clés de niveau dans la ligne) ;
//! - stdout + stderr fusionnés, horodatage Docker optionnel ;
//! - sortie masquée ([`devforge_shared::log_redact`]) et bornée à `max_bytes`
//!   (drapeau `truncated`).

use crate::docker::shell_escape;
use serde::Serialize;
use serde_json::{json, Value};

/// Lignes renvoyées par défaut.
pub const DEFAULT_TAIL: u32 = 200;
/// Plafond de lignes renvoyées.
pub const MAX_TAIL: u32 = 5000;
/// Lignes lues côté Docker quand un filtre (`grep` / `level`) est actif.
pub const MAX_SCAN_LINES: u32 = 100_000;
/// Taille de sortie par défaut (octets, après masquage).
pub const DEFAULT_MAX_BYTES: usize = 256 * 1024;
/// Plafond de sortie (octets, après masquage).
pub const MAX_OUTPUT_BYTES: usize = 400 * 1024;
/// Octets rapatriés depuis l'hôte Docker (les exécuteurs coupent à 512 000
/// caractères en gardant le *début* : on borne donc côté hôte avec `tail -c`
/// pour garder les lignes les plus récentes).
pub const REMOTE_FETCH_BYTES: usize = 480_000;
const MAX_GREP_LEN: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Error,
    Warn,
    Info,
    Debug,
}

impl LogLevel {
    pub fn parse(raw: &str) -> Result<Option<Self>, String> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "" | "all" | "any" | "*" => Ok(None),
            "error" | "err" | "fatal" | "critical" => Ok(Some(Self::Error)),
            "warn" | "warning" => Ok(Some(Self::Warn)),
            "info" | "notice" => Ok(Some(Self::Info)),
            "debug" | "trace" => Ok(Some(Self::Debug)),
            other => Err(format!(
                "level invalide « {other} » (attendu : error, warn, info, debug ou all)"
            )),
        }
    }

    fn keywords(self) -> &'static [&'static str] {
        const ERROR: &[&str] = &[
            "error",
            "err",
            "fatal",
            "panic",
            "panicked",
            "crit",
            "critical",
            "emerg",
            "alert",
            "exception",
            "traceback",
            "failed",
        ];
        const WARN: &[&str] = &[
            "error",
            "err",
            "fatal",
            "panic",
            "panicked",
            "crit",
            "critical",
            "emerg",
            "alert",
            "exception",
            "traceback",
            "failed",
            "warn",
            "warning",
        ];
        const INFO: &[&str] = &[
            "error",
            "err",
            "fatal",
            "panic",
            "panicked",
            "crit",
            "critical",
            "emerg",
            "alert",
            "exception",
            "traceback",
            "failed",
            "warn",
            "warning",
            "info",
            "notice",
        ];
        const DEBUG: &[&str] = &[
            "error",
            "err",
            "fatal",
            "panic",
            "panicked",
            "crit",
            "critical",
            "emerg",
            "alert",
            "exception",
            "traceback",
            "failed",
            "warn",
            "warning",
            "info",
            "notice",
            "debug",
            "dbg",
            "trace",
            "verbose",
        ];
        match self {
            Self::Error => ERROR,
            Self::Warn => WARN,
            Self::Info => INFO,
            Self::Debug => DEBUG,
        }
    }

    /// Expression ERE (grep -E -i) : un mot-clé de niveau isolé.
    pub fn grep_pattern(self) -> String {
        format!("(^|[^A-Za-z])({})([^A-Za-z]|$)", self.keywords().join("|"))
    }

    /// Même règle que [`Self::grep_pattern`], côté Rust (vérification après masquage).
    pub fn matches(self, line: &str) -> bool {
        let lower = line.to_ascii_lowercase();
        let bytes = lower.as_bytes();
        self.keywords().iter().any(|kw| {
            let mut from = 0;
            while let Some(pos) = lower[from..].find(kw) {
                let start = from + pos;
                let end = start + kw.len();
                let before_ok = start == 0 || !bytes[start - 1].is_ascii_alphabetic();
                let after_ok = end >= bytes.len() || !bytes[end].is_ascii_alphabetic();
                if before_ok && after_ok {
                    return true;
                }
                from = start + 1;
            }
            false
        })
    }
}

/// Paramètres validés d'une lecture de logs.
#[derive(Debug, Clone, PartialEq)]
pub struct RuntimeLogsOptions {
    pub tail: u32,
    /// Valeur passée à `docker logs --since` (déjà normalisée).
    pub since: Option<String>,
    pub grep: Option<String>,
    pub level: Option<LogLevel>,
    pub timestamps: bool,
    /// Service annexe (sidecar) : conteneur `<app>-<service>`.
    pub service: Option<String>,
    pub max_bytes: usize,
}

impl Default for RuntimeLogsOptions {
    fn default() -> Self {
        Self {
            tail: DEFAULT_TAIL,
            since: None,
            grep: None,
            level: None,
            timestamps: true,
            service: None,
            max_bytes: DEFAULT_MAX_BYTES,
        }
    }
}

/// Paramètres bruts (query string API ou arguments d'outil).
#[derive(Debug, Clone, Default)]
pub struct RuntimeLogsParams<'a> {
    pub tail: Option<u64>,
    pub since: Option<&'a str>,
    pub grep: Option<&'a str>,
    pub level: Option<&'a str>,
    pub timestamps: Option<bool>,
    pub service: Option<&'a str>,
    pub max_bytes: Option<u64>,
}

impl RuntimeLogsOptions {
    pub fn from_params(p: &RuntimeLogsParams<'_>) -> Result<Self, String> {
        let tail = p
            .tail
            .unwrap_or(DEFAULT_TAIL as u64)
            .clamp(1, MAX_TAIL as u64) as u32;
        let since = match p.since.map(str::trim).filter(|s| !s.is_empty()) {
            Some(s) => Some(parse_since(s)?),
            None => None,
        };
        let grep = match p.grep.map(str::trim).filter(|s| !s.is_empty()) {
            Some(g) => {
                if g.chars().count() > MAX_GREP_LEN {
                    return Err(format!("grep trop long (max {MAX_GREP_LEN} caractères)"));
                }
                if g.chars().any(|c| c.is_control()) {
                    return Err("grep ne doit pas contenir de caractère de contrôle".into());
                }
                Some(g.to_string())
            }
            None => None,
        };
        let level = match p.level {
            Some(l) => LogLevel::parse(l)?,
            None => None,
        };
        let service = match p.service.map(str::trim).filter(|s| !s.is_empty()) {
            Some(s) => {
                if !service_name_ok(s) {
                    return Err(format!(
                        "service invalide « {s} » (lettres minuscules, chiffres, - _ ., 40 car. max)"
                    ));
                }
                Some(s.to_string())
            }
            None => None,
        };
        let max_bytes = p
            .max_bytes
            .map(|b| b as usize)
            .unwrap_or(DEFAULT_MAX_BYTES)
            .clamp(1024, MAX_OUTPUT_BYTES);
        Ok(Self {
            tail,
            since,
            grep,
            level,
            timestamps: p.timestamps.unwrap_or(true),
            service,
            max_bytes,
        })
    }

    fn has_filter(&self) -> bool {
        self.grep.is_some() || self.level.is_some()
    }

    /// Nom du conteneur ciblé (`df-xxx` ou `df-xxx-<service>`).
    pub fn container(&self, app_container: &str) -> String {
        match &self.service {
            Some(s) => format!("{app_container}-{s}"),
            None => app_container.to_string(),
        }
    }
}

fn service_name_ok(s: &str) -> bool {
    let mut chars = s.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_lowercase() || c.is_ascii_digit())
        && s.len() <= 40
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '-' | '_' | '.'))
}

/// `30m`, `2h`, `1h30m`, `45s`, `1d`, `1w` → `5400s` ; RFC 3339 → UTC RFC 3339 ;
/// epoch Unix (secondes) → tel quel. Erreur lisible sinon.
pub fn parse_since(raw: &str) -> Result<String, String> {
    let s = raw.trim();
    if s.is_empty() {
        return Err("since vide".into());
    }
    if let Some(secs) = parse_duration_secs(s) {
        if secs == 0 {
            return Err("since doit être > 0".into());
        }
        return Ok(format!("{secs}s"));
    }
    if s.len() <= 12 && s.chars().all(|c| c.is_ascii_digit()) {
        return Ok(s.to_string());
    }
    match chrono::DateTime::parse_from_rfc3339(s) {
        Ok(dt) => Ok(dt
            .with_timezone(&chrono::Utc)
            .to_rfc3339_opts(chrono::SecondsFormat::Secs, true)),
        Err(_) => Err(format!(
            "since invalide « {s} » (attendu : durée 30m / 2h / 1h30m / 1d, RFC 3339 ou epoch)"
        )),
    }
}

/// Durée composée `1h30m`, `90s`, `2d` (unités s, m, h, d, w). `None` si ce n'est pas une durée.
pub fn parse_duration_secs(s: &str) -> Option<u64> {
    let s = s.trim().to_ascii_lowercase();
    if s.is_empty() {
        return None;
    }
    let mut total: u64 = 0;
    let mut num = String::new();
    let mut saw_unit = false;
    for c in s.chars() {
        if c.is_ascii_digit() {
            num.push(c);
            continue;
        }
        let mult = match c {
            's' => 1,
            'm' => 60,
            'h' => 3600,
            'd' => 86_400,
            'w' => 604_800,
            _ => return None,
        };
        if num.is_empty() || num.len() > 9 {
            return None;
        }
        let n: u64 = num.parse().ok()?;
        total = total.checked_add(n.checked_mul(mult)?)?;
        num.clear();
        saw_unit = true;
    }
    if !num.is_empty() || !saw_unit {
        return None;
    }
    Some(total)
}

/// Commande shell (lecture seule) : vérifie le conteneur, lit les logs
/// (stdout+stderr), filtre côté hôte puis borne la taille rapatriée.
pub fn docker_logs_command(container: &str, opts: &RuntimeLogsOptions) -> String {
    let name = shell_escape(container);
    let scan = if opts.has_filter() {
        MAX_SCAN_LINES
    } else {
        opts.tail
    };
    let mut cmd = format!(
        "docker inspect --type container {name} >/dev/null 2>&1 || {{ echo \"conteneur introuvable : {}\"; exit 3; }}; docker logs --tail {scan}",
        container.replace(['"', '$', '`', '\\'], "")
    );
    if let Some(since) = &opts.since {
        cmd.push_str(&format!(" --since {}", shell_escape(since)));
    }
    if opts.timestamps {
        cmd.push_str(" --timestamps");
    }
    cmd.push_str(&format!(" {name} 2>&1"));
    if let Some(g) = &opts.grep {
        cmd.push_str(&format!(" | grep -i -F -e {}", quote(g)));
    }
    if let Some(level) = opts.level {
        cmd.push_str(&format!(" | grep -i -E {}", quote(&level.grep_pattern())));
    }
    if opts.has_filter() {
        cmd.push_str(&format!(" | tail -n {}", opts.tail));
    }
    cmd.push_str(&format!(" | tail -c {}", REMOTE_FETCH_BYTES + 1));
    cmd
}

/// Toujours entre quotes simples (motifs utilisateur).
fn quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Résultat final, prêt à sérialiser.
#[derive(Debug, Clone, Serialize)]
pub struct RuntimeLogsOutput {
    pub logs: String,
    pub lines: usize,
    pub bytes: usize,
    pub truncated: bool,
}

/// Post-traitement : coupe la ligne partielle (si l'hôte a tronqué), masque
/// les secrets, réapplique les filtres sur le texte masqué (un `grep` ne peut
/// donc pas confirmer la valeur d'un secret), garde `tail` lignes et borne à
/// `max_bytes` en conservant la fin.
pub fn finalize_logs(raw: &str, opts: &RuntimeLogsOptions) -> RuntimeLogsOutput {
    let mut truncated = false;
    let mut text: &str = raw;
    if raw.len() > REMOTE_FETCH_BYTES {
        truncated = true;
        text = match raw.find('\n') {
            Some(i) => &raw[i + 1..],
            None => raw,
        };
    }
    let masked = devforge_shared::log_redact::redact_log_text(text.trim_end_matches('\n'));
    let grep_lower = opts.grep.as_ref().map(|g| g.to_lowercase());
    let mut lines: Vec<&str> = masked
        .split('\n')
        .filter(|l| match &grep_lower {
            Some(g) => l.to_lowercase().contains(g.as_str()),
            None => true,
        })
        .filter(|l| opts.level.is_none_or(|lv| lv.matches(l)))
        .collect();
    if lines.len() == 1 && lines[0].is_empty() {
        lines.clear();
    }
    if lines.len() > opts.tail as usize {
        lines.drain(..lines.len() - opts.tail as usize);
    }
    let joined = lines.join("\n");
    let logs = crate::truncate_runtime_logs(&joined, opts.max_bytes);
    if logs.len() < joined.len() {
        truncated = true;
    }
    let count = if logs.is_empty() {
        0
    } else {
        logs.split('\n').count()
    };
    RuntimeLogsOutput {
        bytes: logs.len(),
        lines: count,
        logs,
        truncated,
    }
}

/// Métadonnées de la requête (écho dans la réponse).
pub fn options_json(opts: &RuntimeLogsOptions) -> Value {
    json!({
        "tail": opts.tail,
        "since": opts.since,
        "grep": opts.grep,
        "level": opts.level,
        "timestamps": opts.timestamps,
        "service": opts.service,
        "max_bytes": opts.max_bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts() -> RuntimeLogsOptions {
        RuntimeLogsOptions::default()
    }

    #[test]
    fn since_durations_are_normalised_to_seconds() {
        assert_eq!(parse_since("30m").unwrap(), "1800s");
        assert_eq!(parse_since("2h").unwrap(), "7200s");
        assert_eq!(parse_since("1h30m").unwrap(), "5400s");
        assert_eq!(parse_since("1d").unwrap(), "86400s");
        assert_eq!(parse_since(" 45S ").unwrap(), "45s");
        assert!(parse_since("0m").is_err());
        assert!(parse_since("abc").is_err());
        assert!(parse_since("30x").is_err());
        assert!(parse_since("m30").is_err());
        assert!(parse_since("1h; rm -rf /").is_err());
    }

    #[test]
    fn since_accepts_rfc3339_and_epoch() {
        assert_eq!(
            parse_since("2026-10-27T01:00:00+01:00").unwrap(),
            "2026-10-27T00:00:00Z"
        );
        assert_eq!(
            parse_since("2026-10-27T00:00:00.123Z").unwrap(),
            "2026-10-27T00:00:00Z"
        );
        assert_eq!(parse_since("1793061205").unwrap(), "1793061205");
        assert!(parse_since("2026-13-45T00:00:00Z").is_err());
    }

    #[test]
    fn tail_is_capped_and_defaulted() {
        let o = RuntimeLogsOptions::from_params(&RuntimeLogsParams::default()).unwrap();
        assert_eq!(o.tail, DEFAULT_TAIL);
        assert!(o.timestamps);
        let o = RuntimeLogsOptions::from_params(&RuntimeLogsParams {
            tail: Some(1_000_000),
            ..Default::default()
        })
        .unwrap();
        assert_eq!(o.tail, MAX_TAIL);
        let o = RuntimeLogsOptions::from_params(&RuntimeLogsParams {
            tail: Some(0),
            max_bytes: Some(10_000_000),
            ..Default::default()
        })
        .unwrap();
        assert_eq!(o.tail, 1);
        assert_eq!(o.max_bytes, MAX_OUTPUT_BYTES);
    }

    #[test]
    fn invalid_params_are_rejected() {
        let bad = |p: RuntimeLogsParams<'_>| RuntimeLogsOptions::from_params(&p).is_err();
        assert!(bad(RuntimeLogsParams {
            level: Some("loud"),
            ..Default::default()
        }));
        assert!(bad(RuntimeLogsParams {
            service: Some("../etc"),
            ..Default::default()
        }));
        assert!(bad(RuntimeLogsParams {
            service: Some("Db; ls"),
            ..Default::default()
        }));
        assert!(bad(RuntimeLogsParams {
            grep: Some("a\nb"),
            ..Default::default()
        }));
        let long = "x".repeat(MAX_GREP_LEN + 1);
        assert!(bad(RuntimeLogsParams {
            grep: Some(&long),
            ..Default::default()
        }));
    }

    #[test]
    fn command_without_filter_uses_tail_and_since() {
        let mut o = opts();
        o.tail = 5000;
        o.since = Some(parse_since("2h").unwrap());
        let cmd = docker_logs_command("df-abc", &o);
        assert!(
            cmd.contains("docker logs --tail 5000 --since 7200s --timestamps df-abc 2>&1"),
            "{cmd}"
        );
        assert!(
            cmd.contains(&format!("tail -c {}", REMOTE_FETCH_BYTES + 1)),
            "{cmd}"
        );
        assert!(!cmd.contains("grep"), "{cmd}");
        assert!(
            cmd.starts_with("docker inspect --type container df-abc"),
            "{cmd}"
        );
    }

    #[test]
    fn command_with_grep_scans_wider_and_quotes_pattern() {
        let mut o = opts();
        o.tail = 300;
        o.grep = Some("it's $(reboot)".into());
        o.level = Some(LogLevel::Warn);
        let cmd = docker_logs_command("df-abc", &o);
        assert!(cmd.contains(&format!("--tail {MAX_SCAN_LINES}")), "{cmd}");
        assert!(cmd.contains(r"grep -i -F -e 'it'\''s $(reboot)'"), "{cmd}");
        assert!(cmd.contains("grep -i -E '(^|[^A-Za-z])(error|"), "{cmd}");
        assert!(cmd.contains("| tail -n 300 |"), "{cmd}");
    }

    #[test]
    fn service_targets_sidecar_container() {
        let o = RuntimeLogsOptions::from_params(&RuntimeLogsParams {
            service: Some("redis"),
            ..Default::default()
        })
        .unwrap();
        assert_eq!(o.container("df-abc"), "df-abc-redis");
        assert_eq!(opts().container("df-abc"), "df-abc");
    }

    #[test]
    fn finalize_masks_secrets_and_keeps_recent_lines() {
        let raw = (0..10)
            .map(|i| format!("2026-10-27T00:00:0{i}Z GET /play?token=SECRET{i} 200"))
            .collect::<Vec<_>>()
            .join("\n");
        let mut o = opts();
        o.tail = 3;
        let out = finalize_logs(&raw, &o);
        assert_eq!(out.lines, 3);
        assert!(!out.logs.contains("SECRET"), "{}", out.logs);
        assert!(out.logs.contains("token=***"));
        assert!(out.logs.ends_with("200"));
        assert!(out.logs.starts_with("2026-10-27T00:00:07Z"));
        assert!(!out.truncated);
    }

    #[test]
    fn finalize_grep_is_case_insensitive_and_runs_after_masking() {
        let raw = "a Playback started\nb ffmpeg ERROR codec\nc Authorization: Bearer hunter2hunter2\nd playback stalled";
        let mut o = opts();
        o.grep = Some("PLAYBACK".into());
        let out = finalize_logs(raw, &o);
        assert_eq!(out.lines, 2);
        assert!(out.logs.contains("Playback started"));
        assert!(out.logs.contains("playback stalled"));
        // Chercher la valeur d'un secret ne renvoie rien : le filtre passe après masquage.
        o.grep = Some("hunter2".into());
        assert_eq!(finalize_logs(raw, &o).lines, 0);
    }

    #[test]
    fn finalize_level_filter() {
        let raw = "x INFO ready\ny WARN slow segment\nz [error] transcoder crashed\nw terrorist movie title";
        let mut o = opts();
        o.level = Some(LogLevel::Error);
        let out = finalize_logs(raw, &o);
        assert_eq!(out.logs, "z [error] transcoder crashed");
        o.level = Some(LogLevel::Warn);
        assert_eq!(finalize_logs(raw, &o).lines, 2);
        o.level = Some(LogLevel::Info);
        assert_eq!(finalize_logs(raw, &o).lines, 3);
    }

    #[test]
    fn finalize_caps_bytes_and_flags_truncation() {
        let raw = (0..2000)
            .map(|i| format!("line {i} {}", "x".repeat(100)))
            .collect::<Vec<_>>()
            .join("\n");
        let mut o = opts();
        o.tail = 5000;
        o.max_bytes = 4096;
        let out = finalize_logs(&raw, &o);
        assert!(out.truncated);
        assert!(out.bytes <= 4096);
        assert!(out.logs.contains("line 1999"));
        assert!(out.logs.starts_with("line "));
    }

    #[test]
    fn finalize_drops_partial_first_line_when_host_truncated() {
        let mut raw = "partial-line-without-start".to_string();
        raw.push('\n');
        while raw.len() <= REMOTE_FETCH_BYTES {
            raw.push_str("2026-10-27T00:00:00Z ok\n");
        }
        let out = finalize_logs(&raw, &opts());
        assert!(out.truncated);
        assert!(!out.logs.contains("partial-line"));
    }

    #[test]
    fn finalize_empty_output() {
        let out = finalize_logs("", &opts());
        assert_eq!(out.lines, 0);
        assert_eq!(out.logs, "");
    }
}
