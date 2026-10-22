//! Shared secret redaction for everything DevForge returns to agents, MCP
//! clients and the API (configs, env vars, headers, URLs, tool results).
//!
//! Rules:
//! - a string under a sensitive key name (token, secret, password, api_key,
//!   authorization, …) is replaced by a masked placeholder;
//! - every value of a `headers` / `secrets` / `env` map is masked;
//! - `{ "key"|"name": K, "value": V }` pairs mask `V` when `K` is sensitive
//!   (or `secret: true`) and get a `has_value` flag;
//! - credentials embedded in URLs (`user:pass@`, `?token=…`) are masked;
//! - whole strings shaped like a known token (`ghp_…`, `Bearer …`) are masked.
//!
//! Placeholders keep the original type (string) and never contain more than
//! the first and last 4 characters of a long secret (`ghp_…abcd`), short
//! secrets become `***`. [`is_masked_placeholder`] lets update flows ignore a
//! placeholder sent back by a client instead of overwriting the stored secret.

use serde_json::{Map, Value};

/// Placeholder for short secrets (and for any secret inside a URL).
pub const MASK: &str = "***";
/// Separator used in long-secret placeholders (`ghp_…abcd`).
const ELLIPSIS: char = '…';

/// Key fragments that mark a value as secret (compared on a normalised,
/// lowercase, `_`-separated key).
const SENSITIVE_FRAGMENTS: &[&str] = &[
    "token",
    "secret",
    "password",
    "passwd",
    "passphrase",
    "api_key",
    "apikey",
    "private_key",
    "privatekey",
    "access_key",
    "secret_key",
    "signing_key",
    "encryption_key",
    "master_key",
    "client_key",
    "authorization",
    "auth_header",
    "cookie",
    "credential",
    "bearer",
    "session_key",
    "dsn",
    "database_url",
    "connection_string",
];

/// Exact key names that are sensitive on their own.
const SENSITIVE_EXACT: &[&str] = &["pwd", "pass", "pat", "jwt", "otp", "x_api_key"];

/// Keys that contain a sensitive fragment but only carry metadata.
const NON_SENSITIVE_EXACT: &[&str] = &[
    "secret_keys",
    "token_type",
    "token_endpoint",
    "token_endpoint_auth_method",
    "token_prefix",
    "token_hint",
    "secrets_masked",
    "has_secrets",
    "has_api_key",
    "has_token",
    "has_value",
    "max_tokens",
    "max_output_tokens",
    "prompt_tokens",
    "completion_tokens",
    "total_tokens",
    "input_tokens",
    "output_tokens",
    "oauth_connected",
    "oauth_expires_at",
    "oauth_scopes",
    "secret",
];

/// Containers whose every scalar value is a secret.
const SECRET_CONTAINERS: &[&str] = &["headers", "secrets", "env", "environment", "env_vars"];

fn normalise_key(key: &str) -> String {
    let mut out = String::with_capacity(key.len());
    let mut prev_lower = false;
    for c in key.trim().chars() {
        if c.is_ascii_uppercase() && prev_lower {
            out.push('_');
        }
        prev_lower = c.is_ascii_lowercase() || c.is_ascii_digit();
        match c {
            '-' | ' ' | '.' => out.push('_'),
            c => out.push(c.to_ascii_lowercase()),
        }
    }
    out
}

/// `true` when a key name designates a secret value (`GITHUB_TOKEN`,
/// `apiKey`, `Authorization`, `oauth_refresh_token`, `client-secret`…).
pub fn is_sensitive_key(key: &str) -> bool {
    let k = normalise_key(key);
    if k.is_empty() {
        return false;
    }
    if NON_SENSITIVE_EXACT.contains(&k.as_str())
        || k.starts_with("has_")
        || k.ends_with("_expires_at")
        || k.ends_with("_scopes")
        || k.ends_with("_masked")
        || k.ends_with("_has_value")
        || k.ends_with("_tokens")
        || k.ends_with("_keys")
        || k.ends_with("public_key")
    {
        return false;
    }
    if SENSITIVE_EXACT.contains(&k.as_str()) {
        return true;
    }
    SENSITIVE_FRAGMENTS.iter().any(|f| k.contains(f))
        || k.ends_with("_key")
        || k.ends_with("_pat")
        || k.ends_with("_pass")
}

/// Masked placeholder for a secret: `""` stays `""` (no value), short values
/// become `***`, long ones keep 4 leading and 4 trailing chars (`ghp_…abcd`).
pub fn mask_secret(value: &str) -> String {
    if value.is_empty() {
        return String::new();
    }
    if is_masked_placeholder(value) {
        return value.to_string();
    }
    let chars: Vec<char> = value.chars().collect();
    if chars.len() < 20 {
        return MASK.to_string();
    }
    let head: String = chars[..4].iter().collect();
    let tail: String = chars[chars.len() - 4..].iter().collect();
    format!("{head}{ELLIPSIS}{tail}")
}

/// `true` when `value` is a placeholder produced by this module (or by the
/// older `********` / `••••` masks). Update flows must keep the stored secret
/// when they receive one of these.
pub fn is_masked_placeholder(value: &str) -> bool {
    let v = value.trim();
    if v.is_empty() {
        return false;
    }
    if v.chars().all(|c| c == '*' || c == '•') && v.chars().count() >= 3 {
        return true;
    }
    if v.contains("••••") || v.contains(":***@") || v.contains("=***") || v.starts_with("***@")
    {
        return true;
    }
    // `ghp_…abcd`: exactly one ellipsis, 4 chars on each side.
    let parts: Vec<&str> = v.split(ELLIPSIS).collect();
    parts.len() == 2 && parts[0].chars().count() == 4 && parts[1].chars().count() == 4
}

const TOKEN_PREFIXES: &[&str] = &[
    "ghp_",
    "gho_",
    "ghu_",
    "ghs_",
    "ghr_",
    "github_pat_",
    "glpat-",
    "xoxb-",
    "xoxp-",
    "xoxa-",
    "xoxr-",
    "xoxs-",
    "xapp-",
    "sk-",
    "sk_live_",
    "sk_test_",
    "rk_live_",
    "pk_live_",
    "AKIA",
    "ASIA",
    "AIza",
    "ya29.",
    "npm_",
    "pypi-",
    "hf_",
    "dop_v1_",
    "SG.",
    "shpat_",
];

/// `true` when the whole string looks like a credential: a known token
/// prefix, an `Authorization`-style value (`Bearer …`, `Basic …`) or a JWT.
pub fn looks_like_token(value: &str) -> bool {
    let v = value.trim();
    if v.is_empty() || v.chars().any(char::is_whitespace) && !has_auth_scheme(v) {
        return false;
    }
    if has_auth_scheme(v) {
        return true;
    }
    if v.len() >= 16 && TOKEN_PREFIXES.iter().any(|p| v.starts_with(p)) {
        return v
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "_-.=/+".contains(c));
    }
    // JWT: three base64url segments, header starting with `eyJ`.
    let segs: Vec<&str> = v.split('.').collect();
    segs.len() == 3
        && v.starts_with("eyJ")
        && segs.iter().all(|s| {
            s.len() >= 8
                && s.chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '=')
        })
}

fn has_auth_scheme(v: &str) -> bool {
    let mut it = v.splitn(2, ' ');
    let scheme = it.next().unwrap_or("").to_ascii_lowercase();
    let rest = it.next().unwrap_or("").trim();
    matches!(scheme.as_str(), "bearer" | "basic" | "token" | "bot")
        && !rest.is_empty()
        && !rest.contains(' ')
}

/// Masks credentials embedded in a URL: `user:pass@` → `user:***@`, a bare
/// `token@` userinfo → `***@`, and sensitive query parameters
/// (`?token=…&key=…`) → `=***`. Non-URL strings are returned unchanged.
pub fn redact_url(url: &str) -> String {
    let Some(scheme_end) = url.find("://") else {
        return url.to_string();
    };
    if url[..scheme_end].is_empty()
        || !url[..scheme_end]
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "+-.".contains(c))
    {
        return url.to_string();
    }
    let (scheme, rest) = url.split_at(scheme_end + 3);
    let authority_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let (authority, tail) = rest.split_at(authority_end);
    let authority = match authority.rfind('@') {
        Some(at) => {
            let (userinfo, host) = authority.split_at(at);
            match userinfo.split_once(':') {
                Some((user, _)) => format!("{user}:{MASK}{host}"),
                None => format!("{MASK}{host}"),
            }
        }
        None => authority.to_string(),
    };
    let (path, query_and_frag) = match tail.find('?') {
        Some(q) => tail.split_at(q),
        None => (tail, ""),
    };
    let query_and_frag = if query_and_frag.is_empty() {
        String::new()
    } else {
        let body = &query_and_frag[1..];
        let (query, frag) = match body.find('#') {
            Some(h) => body.split_at(h),
            None => (body, ""),
        };
        let q: Vec<String> = query
            .split('&')
            .map(|pair| match pair.split_once('=') {
                Some((k, v))
                    if !v.is_empty() && (is_sensitive_query_key(k) || looks_like_token(v)) =>
                {
                    format!("{k}={MASK}")
                }
                _ => pair.to_string(),
            })
            .collect();
        format!("?{}{frag}", q.join("&"))
    };
    format!("{scheme}{authority}{path}{query_and_frag}")
}

/// Git remote for display: any userinfo (`user:token@`, `token@`) becomes
/// `***@`, so neither the token nor its account name leaks
/// (`https://x-access-token:ghp_…@github.com/o/r.git` →
/// `https://***@github.com/o/r.git`). SSH remotes (`git@host:o/r`) and URLs
/// without credentials are returned unchanged.
pub fn redact_remote(url: &str) -> String {
    let t = url.trim();
    let Some(scheme_end) = t.find("://") else {
        return t.to_string();
    };
    let (scheme, rest) = t.split_at(scheme_end + 3);
    let authority_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    match rest[..authority_end].rfind('@') {
        Some(at) => format!("{scheme}{MASK}{}", &rest[at..]),
        None => t.to_string(),
    }
}

/// Masks credentials of every URL found in free text (logs, CLI output):
/// `scheme://user:token@host` → `scheme://***@host`. The rest of the text is
/// unchanged.
pub fn redact_urls_in_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find("://") {
        out.push_str(&rest[..i + 3]);
        rest = &rest[i + 3..];
        let end = rest
            .find(|c: char| {
                c.is_whitespace() || matches!(c, '/' | '?' | '#' | '\'' | '"' | '<' | '>' | '`')
            })
            .unwrap_or(rest.len());
        if let Some(at) = rest[..end].rfind('@') {
            out.push_str(MASK);
            rest = &rest[at..];
        }
    }
    out.push_str(rest);
    out
}

fn is_sensitive_query_key(k: &str) -> bool {
    let n = normalise_key(k);
    is_sensitive_key(k)
        || matches!(
            n.as_str(),
            "key"
                | "sig"
                | "signature"
                | "code"
                | "access_token"
                | "auth"
                | "apikey"
                | "x_amz_signature"
        )
}

fn looks_like_url(v: &str) -> bool {
    match v.find("://") {
        Some(i) if i > 0 && i < 20 => {
            !v.chars().any(char::is_whitespace)
                && v[..i]
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || "+-.".contains(c))
        }
        _ => false,
    }
}

/// Redacts one free-standing string (not under a sensitive key): URLs get
/// their credentials masked, token-shaped strings are masked, everything else
/// is returned unchanged (file contents and logs are never rewritten).
pub fn redact_str(value: &str) -> String {
    if looks_like_url(value) {
        return redact_url(value);
    }
    if looks_like_token(value) {
        return mask_secret(value);
    }
    value.to_string()
}

/// Masks a scalar known to be secret, keeping its JSON type for strings.
fn mask_value(v: &Value) -> Value {
    match v {
        Value::String(s) => Value::String(mask_secret(s)),
        Value::Null => Value::Null,
        Value::Bool(b) => Value::Bool(*b),
        Value::Number(_) => Value::String(MASK.into()),
        Value::Array(a) => Value::Array(a.iter().map(mask_value).collect()),
        Value::Object(o) => {
            Value::Object(o.iter().map(|(k, v)| (k.clone(), mask_value(v))).collect())
        }
    }
}

fn value_present(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}

/// Recursively redacts a JSON value (tool result, API payload, stored config).
pub fn redact_json(value: &Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(redact_object(map)),
        Value::Array(items) => Value::Array(redact_array(items)),
        Value::String(s) => Value::String(redact_str(s)),
        other => other.clone(),
    }
}

fn redact_array(items: &[Value]) -> Vec<Value> {
    // CLI-style args: `["--token", "abc"]` or `["--api-key=abc"]`.
    let mut out = Vec::with_capacity(items.len());
    let mut mask_next = false;
    for item in items {
        match item {
            Value::String(s) if mask_next => {
                out.push(Value::String(mask_secret(s)));
                mask_next = false;
            }
            Value::String(s) if s.starts_with('-') => {
                let flag = s.trim_start_matches('-');
                match flag.split_once('=') {
                    Some((k, v)) if is_sensitive_key(k) => {
                        out.push(Value::String(format!(
                            "{}={}",
                            &s[..s.len() - v.len() - 1],
                            mask_secret(v)
                        )));
                    }
                    Some(_) => out.push(Value::String(redact_str(s))),
                    None => {
                        mask_next = is_sensitive_key(flag);
                        out.push(item.clone());
                    }
                }
            }
            other => {
                mask_next = false;
                out.push(redact_json(other));
            }
        }
    }
    out
}

fn redact_object(map: &Map<String, Value>) -> Map<String, Value> {
    // `{key|name, value}` pairs (env vars, headers as lists).
    let pair_name = map
        .get("key")
        .or_else(|| map.get("name"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let pair_secret = map.get("secret").and_then(Value::as_bool).unwrap_or(false);
    let is_pair = pair_name.is_some() && map.contains_key("value");

    let mut out = Map::with_capacity(map.len() + 1);
    for (k, v) in map {
        let redacted = if is_pair && k == "value" {
            let name = pair_name.as_deref().unwrap_or("");
            if pair_secret || is_sensitive_key(name) {
                mask_value(v)
            } else {
                redact_json(v)
            }
        } else if is_sensitive_key(k) || (normalise_key(k) == "secret" && v.is_string()) {
            match v {
                Value::Object(_) | Value::Array(_) => mask_value(v),
                other => mask_value(other),
            }
        } else if SECRET_CONTAINERS.contains(&normalise_key(k).as_str()) && v.is_object() {
            let inner = v.as_object().cloned().unwrap_or_default();
            Value::Object(
                inner
                    .iter()
                    .map(|(ik, iv)| {
                        let masked = match iv {
                            Value::Object(o) => Value::Object(redact_object(o)),
                            Value::Array(a) => Value::Array(redact_array(a)),
                            scalar => mask_value(scalar),
                        };
                        (ik.clone(), masked)
                    })
                    .collect(),
            )
        } else {
            redact_json(v)
        };
        out.insert(k.clone(), redacted);
    }
    if is_pair && !map.contains_key("has_value") {
        let present = map.get("value").map(value_present).unwrap_or(false);
        out.insert("has_value".into(), Value::Bool(present));
    }
    out
}

/// Redacts a string that may contain a serialized JSON document (e.g. stored
/// `tool_calls_json`). Non-JSON strings are returned unchanged.
pub fn redact_json_str(raw: &str) -> String {
    match serde_json::from_str::<Value>(raw) {
        Ok(v @ (Value::Object(_) | Value::Array(_))) => {
            serde_json::to_string(&redact_json(&v)).unwrap_or_else(|_| raw.to_string())
        }
        _ => raw.to_string(),
    }
}

/// `{ "masked": "ghp_…abcd", "has_value": true }` view of a secret map
/// (MCP server secrets, headers…): agents and the UI see which keys exist
/// without the values.
pub fn masked_map<'a, I>(entries: I) -> Map<String, Value>
where
    I: IntoIterator<Item = (&'a String, &'a String)>,
{
    entries
        .into_iter()
        .map(|(k, v)| {
            (
                k.clone(),
                serde_json::json!({ "masked": mask_secret(v), "has_value": !v.is_empty() }),
            )
        })
        .collect()
}

/// Value to store on update: a masked placeholder (or an empty string when
/// `keep_on_empty`) sent back by a client keeps the previous secret.
pub fn keep_secret_on_placeholder(
    incoming: &str,
    previous: Option<&str>,
    keep_on_empty: bool,
) -> String {
    let placeholder =
        is_masked_placeholder(incoming) || (keep_on_empty && incoming.trim().is_empty());
    match (placeholder, previous) {
        (true, Some(prev)) => prev.to_string(),
        (true, None) if is_masked_placeholder(incoming) => String::new(),
        _ => incoming.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const GH: &str = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    #[test]
    fn sensitive_key_names() {
        for k in [
            "GITHUB_TOKEN",
            "api_key",
            "apiKey",
            "Authorization",
            "x-api-key",
            "oauth_access_token",
            "oauth_refresh_token",
            "client_secret",
            "DB_PASSWORD",
            "private_key_enc",
            "webhook_secret",
            "TURSO_AUTH_TOKEN",
            "Cookie",
            "DATABASE_URL",
        ] {
            assert!(is_sensitive_key(k), "{k}");
        }
        for k in [
            "name",
            "url",
            "secret_keys",
            "has_secrets",
            "oauth_expires_at",
            "oauth_scopes",
            "max_tokens",
            "token_type",
            "secret",
            "id",
            "catalog_id",
        ] {
            assert!(!is_sensitive_key(k), "{k}");
        }
    }

    #[test]
    fn masks_keep_only_edges() {
        assert_eq!(mask_secret(GH), "ghp_…6789");
        assert_eq!(mask_secret("short"), "***");
        assert_eq!(mask_secret(""), "");
        // multibyte input never panics
        assert_eq!(mask_secret("ééééééééééééééééééééééé"), "éééé…éééé");
        assert!(is_masked_placeholder(&mask_secret(GH)));
        assert!(is_masked_placeholder("***"));
        assert!(is_masked_placeholder("********"));
        assert!(is_masked_placeholder("Bearer ••••"));
        assert!(!is_masked_placeholder(GH));
        assert!(!is_masked_placeholder("hello"));
    }

    #[test]
    fn url_credentials_are_masked() {
        assert_eq!(
            redact_url("https://user:hunter2@example.com/repo.git"),
            "https://user:***@example.com/repo.git"
        );
        assert_eq!(
            redact_url(&format!("https://{GH}@github.com/o/r")),
            "https://***@github.com/o/r"
        );
        assert_eq!(
            redact_url("https://mcp.example.com/sse?token=abc123&org=me&key=zz#x"),
            "https://mcp.example.com/sse?token=***&org=me&key=***#x"
        );
        assert_eq!(
            redact_url("libsql://db.turso.io?authToken=eyJhbGciOi"),
            "libsql://db.turso.io?authToken=***"
        );
        assert_eq!(
            redact_url("https://example.com/a?b=c"),
            "https://example.com/a?b=c"
        );
        assert_eq!(redact_url("not a url"), "not a url");
        assert!(is_masked_placeholder(&redact_url("https://u:p@h/")));
    }

    #[test]
    fn token_shapes() {
        assert!(looks_like_token(GH));
        assert!(looks_like_token("Bearer abc.def"));
        assert!(looks_like_token("xoxb-1234567890-abcdefghij"));
        assert!(looks_like_token(
            "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijkl"
        ));
        assert!(!looks_like_token("hello world"));
        assert!(!looks_like_token("devforge"));
        assert!(!looks_like_token("sk-"));
    }

    #[test]
    fn redacts_mcp_like_config() {
        let cfg = json!({
            "id": "mcp_1",
            "name": "GitHub",
            "url": format!("https://api.example.com/mcp?access_token={GH}"),
            "headers": {"Authorization": format!("Bearer {GH}"), "X-Org": "acme"},
            "secrets": {"api_token": GH},
            "env": {"GITHUB_PERSONAL_ACCESS_TOKEN": GH, "LOG_LEVEL": "debug"},
            "args": ["run", "--token", GH, "--api-key=supersecretvalue", "--verbose"],
            "oauth_access_token": "tok-abcdefghijklmnopqrstuvwxyz",
            "oauth_refresh_token": "short",
            "oauth_expires_at": "2026-10-19T00:00:00Z",
            "secret_keys": ["api_token"],
            "meta": {"org": "acme", "client_secret": "abc"}
        });
        let r = redact_json(&cfg);
        let s = r.to_string();
        assert!(!s.contains(GH), "{s}");
        assert!(!s.contains("supersecretvalue"), "{s}");
        assert!(!s.contains("abcdefghijklmnopqrstuvwxyz"), "{s}");
        assert_eq!(r["name"], "GitHub");
        assert_eq!(r["url"], "https://api.example.com/mcp?access_token=***");
        assert_eq!(r["headers"]["X-Org"], "***");
        assert_eq!(r["env"]["GITHUB_PERSONAL_ACCESS_TOKEN"], "ghp_…6789");
        assert_eq!(r["args"][2], "ghp_…6789");
        assert_eq!(r["args"][3], "--api-key=***");
        assert_eq!(r["args"][4], "--verbose");
        assert_eq!(r["oauth_refresh_token"], "***");
        assert_eq!(r["oauth_expires_at"], "2026-10-19T00:00:00Z");
        assert_eq!(r["secret_keys"][0], "api_token");
        assert_eq!(r["meta"]["org"], "acme");
        assert_eq!(r["meta"]["client_secret"], "***");
    }

    #[test]
    fn env_pairs_keep_names_and_flag_values() {
        let env = json!({"env": [
            {"key": "AUTH_URL", "secret": false, "value": "https://app.example.com"},
            {"key": "POCKET_SECRET", "secret": false, "value": "plain-but-sensitive"},
            {"key": "SMOKE", "secret": true, "value": "abc"},
            {"key": "EMPTY_TOKEN", "secret": false, "value": ""}
        ]});
        let r = redact_json(&env);
        let e = r["env"].as_array().unwrap();
        assert_eq!(e[0]["key"], "AUTH_URL");
        assert_eq!(e[1]["key"], "POCKET_SECRET");
        assert_eq!(e[0]["value"], "https://app.example.com");
        assert_eq!(e[0]["has_value"], true);
        assert_eq!(e[1]["value"], "***");
        assert_eq!(e[2]["value"], "***");
        assert_eq!(e[3]["value"], "");
        assert_eq!(e[3]["has_value"], false);
    }

    #[test]
    fn secret_string_field_is_masked_but_flag_kept() {
        let r = redact_json(&json!({"secret": "whsec_abcdefghijklmnop", "x": {"secret": true}}));
        assert!(is_masked_placeholder(r["secret"].as_str().unwrap()));
        assert_eq!(r["x"]["secret"], true);
    }

    #[test]
    fn free_text_is_not_rewritten() {
        let v = json!({"content": "const t = process.env.TOKEN; // ghp_x", "logs": "token=abc in a log line"});
        assert_eq!(redact_json(&v), v);
    }

    #[test]
    fn serialized_tool_calls_are_redacted() {
        let raw = json!([{"name": "mcp_list_servers", "result": {"servers": [{"headers": {"Authorization": format!("Bearer {GH}")}}]}}]).to_string();
        let out = redact_json_str(&raw);
        assert!(!out.contains(GH));
        assert_eq!(redact_json_str("plain text"), "plain text");
    }

    #[test]
    fn placeholders_do_not_overwrite_stored_secrets() {
        assert_eq!(keep_secret_on_placeholder("ghp_…6789", Some(GH), false), GH);
        assert_eq!(keep_secret_on_placeholder("***", Some(GH), false), GH);
        assert_eq!(keep_secret_on_placeholder("", Some(GH), true), GH);
        assert_eq!(keep_secret_on_placeholder("", Some(GH), false), "");
        assert_eq!(
            keep_secret_on_placeholder("new-value", Some(GH), false),
            "new-value"
        );
        assert_eq!(keep_secret_on_placeholder("***", None, false), "");
    }

    #[test]
    fn masked_map_reports_presence() {
        let mut m = std::collections::HashMap::new();
        m.insert("api_token".to_string(), GH.to_string());
        m.insert("empty".to_string(), String::new());
        let r = masked_map(&m);
        assert_eq!(r["api_token"]["masked"], "ghp_…6789");
        assert_eq!(r["api_token"]["has_value"], true);
        assert_eq!(r["empty"]["has_value"], false);
    }

    #[test]
    fn redact_remote_hides_userinfo() {
        assert_eq!(
            redact_remote("https://x-access-token:ghp_abc123@github.com/o/r.git"),
            "https://***@github.com/o/r.git"
        );
        assert_eq!(
            redact_remote("https://ghp_abc@github.com/o/r"),
            "https://***@github.com/o/r"
        );
        assert_eq!(
            redact_remote("https://github.com/o/r.git"),
            "https://github.com/o/r.git"
        );
        assert_eq!(
            redact_remote("git@github.com:o/r.git"),
            "git@github.com:o/r.git"
        );
        assert_eq!(
            redact_remote("http://u:p@host:8080/x@y"),
            "http://***@host:8080/x@y"
        );
    }

    #[test]
    fn redact_urls_in_text_masks_every_url() {
        let log = "fatal: unable to access 'https://x-access-token:ghp_secret@github.com/o/r.git/': 403\n\
                   remote https://tok@gitlab.com/g/p ok, plain https://github.com/o/r";
        let r = redact_urls_in_text(log);
        assert!(!r.contains("ghp_secret"), "{r}");
        assert!(!r.contains("tok@"), "{r}");
        assert!(r.contains("'https://***@github.com/o/r.git/'"), "{r}");
        assert!(r.contains("https://***@gitlab.com/g/p ok"), "{r}");
        assert!(r.contains("plain https://github.com/o/r"), "{r}");
        assert_eq!(redact_urls_in_text("no url here"), "no url here");
        assert_eq!(redact_urls_in_text("mail me@x.org"), "mail me@x.org");
    }
}
