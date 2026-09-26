use crate::models::EnvEntry;

pub const MIN_RUNNER_VERSION: &str = "2.327.1";
pub const DEFAULT_RUNNER_VERSION: &str = "2.336.0";

pub fn parse_version(text: &str) -> Option<String> {
    // Match e.g. Runner version: '2.336.0' or RUNNER_VERSION=2.336.0
    let re_patterns = [
        r"(?i)runner version[:\s']+([0-9]+\.[0-9]+\.[0-9]+)",
        r"(?i)RUNNER_VERSION[=:\s]+([0-9]+\.[0-9]+\.[0-9]+)",
    ];
    for pat in re_patterns {
        if let Some(v) = simple_capture(text, pat) {
            return Some(v);
        }
    }
    None
}

fn simple_capture(text: &str, _pat: &str) -> Option<String> {
    // Lightweight scan without regex crate dependency.
    let lower = text.to_lowercase();
    for key in ["runner version", "runner_version"] {
        if let Some(idx) = lower.find(key) {
            let slice = &text[idx..];
            let digits: String = slice
                .chars()
                .skip_while(|c| !c.is_ascii_digit())
                .take_while(|c| c.is_ascii_digit() || *c == '.')
                .collect();
            if digits.split('.').count() == 3 && !digits.is_empty() {
                return Some(digits);
            }
        }
    }
    None
}

fn version_tuple(v: &str) -> Option<(u32, u32, u32)> {
    let mut parts = v.split('.');
    let a = parts.next()?.parse().ok()?;
    let b = parts.next()?.parse().ok()?;
    let c = parts.next()?.parse().ok()?;
    Some((a, b, c))
}

pub fn is_compatible(version: Option<&str>) -> bool {
    let Some(v) = version.and_then(version_tuple) else {
        return false;
    };
    let min = version_tuple(MIN_RUNNER_VERSION).unwrap_or((2, 327, 1));
    v >= min
}

/// Ensure extra_env contains a compatible RUNNER_VERSION.
pub fn with_compatible_extra_env(mut extra: Vec<EnvEntry>) -> Vec<EnvEntry> {
    let has = extra
        .iter()
        .any(|e| e.key.eq_ignore_ascii_case("RUNNER_VERSION"));
    if !has {
        extra.push(EnvEntry {
            key: "RUNNER_VERSION".into(),
            value: DEFAULT_RUNNER_VERSION.into(),
        });
        return extra;
    }
    for e in &mut extra {
        if e.key.eq_ignore_ascii_case("RUNNER_VERSION") {
            if !is_compatible(Some(&e.value)) {
                e.value = DEFAULT_RUNNER_VERSION.into();
            }
            e.key = "RUNNER_VERSION".into();
        }
    }
    extra
}

pub fn with_compatible_runner_version_lines(env_lines: Vec<String>) -> Vec<String> {
    let mut found = false;
    let mut out = Vec::with_capacity(env_lines.len() + 1);
    for line in env_lines {
        if let Some((key, value)) = line.split_once('=') {
            if key.eq_ignore_ascii_case("RUNNER_VERSION") {
                found = true;
                let v = if is_compatible(Some(value)) {
                    value.to_string()
                } else {
                    DEFAULT_RUNNER_VERSION.to_string()
                };
                out.push(format!("RUNNER_VERSION={v}"));
                continue;
            }
        }
        out.push(line);
    }
    if !found {
        out.push(format!("RUNNER_VERSION={DEFAULT_RUNNER_VERSION}"));
    }
    out
}
