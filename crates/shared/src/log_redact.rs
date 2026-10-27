//! Masquage des secrets dans du texte libre de logs (conteneurs, CLI).
//!
//! Complète [`crate::redact`] (pensé pour du JSON) avec des règles ligne à
//! ligne : en-têtes `Authorization` / `Cookie`, `Bearer …`, identifiants dans
//! les URL (`user:pass@`), paramètres de requête sensibles (`?token=…`,
//! `&api_key=…`), paires `clé=valeur` / `"clé": "valeur"` dont la clé est
//! sensible (même liste que [`crate::redact::is_sensitive_key`]) et jetons
//! reconnaissables (`ghp_…`, `sk-…`, JWT…).
//!
//! Le texte non sensible est conservé tel quel : un agent doit pouvoir lire
//! les logs pour diagnostiquer.

use crate::redact::{is_sensitive_key, looks_like_token, mask_secret, redact_url, MASK};
use regex::{Captures, Regex};
use std::sync::OnceLock;

fn re(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("regex de masquage valide"))
}

/// `Authorization: Bearer xxx`, `proxy-authorization=Basic xxx`,
/// `"authorization":"token xxx"` → schéma conservé, valeur masquée.
fn auth_header_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(
        &R,
        r#"(?i)((?:proxy-)?authori[sz]ation["']?\s*[:=]\s*["']?)(?:(bearer|basic|token|bot|digest|negotiate|apikey)\s+)?([^\s"',;]+)"#,
    )
}

/// `Cookie: a=b; c=d` / `Set-Cookie: sid=…` → tout le reste de l'en-tête.
fn cookie_header_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(
        &R,
        r#"(?i)\b((?:set-)?cookie["']?\s*[:=]\s*["']?)([^"'\r\n]+)"#,
    )
}

/// `Bearer <jeton>` isolé.
fn bearer_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(&R, r"(?i)\b(bearer)\s+([A-Za-z0-9\-._~+/]{8,}=*)")
}

/// URL complètes (schéma://…).
fn url_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(&R, r#"\b[a-zA-Z][a-zA-Z0-9+.\-]{1,15}://[^\s"'<>`]+"#)
}

/// Paramètres de requête, y compris hors URL complète (`GET /x?token=…`).
fn query_param_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(&R, r#"([?&;])([A-Za-z0-9_.\-\[\]]{1,64})=([^&\s"'#<>]+)"#)
}

/// Paires clé/valeur : `KEY=val`, `key: val`, `"key":"val"`, `key='val'`.
fn key_value_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(
        &R,
        r#"(["']?)([A-Za-z_][A-Za-z0-9_.\-]{1,63})(["']?\s*[:=]\s*["']?)([^\s"',;&}\]\)]+)"#,
    )
}

/// Mots qui pourraient être des jetons (préfixe connu, JWT…).
fn token_word_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(&R, r"[A-Za-z0-9_\-.=/+]{16,}")
}

fn is_sensitive_query_param(k: &str) -> bool {
    let n = k.trim().to_ascii_lowercase().replace('-', "_");
    is_sensitive_key(k)
        || matches!(
            n.as_str(),
            "key"
                | "sig"
                | "signature"
                | "code"
                | "auth"
                | "apikey"
                | "api_key"
                | "access_token"
                | "refresh_token"
                | "id_token"
                | "session"
                | "sessionid"
                | "sid"
                | "jwt"
                | "x_amz_signature"
                | "x_amz_credential"
                | "x_plex_token"
        )
}

fn already_masked(v: &str) -> bool {
    v.is_empty()
        || v == MASK
        || v.trim_matches('*').is_empty()
        || crate::redact::is_masked_placeholder(v)
}

/// En-têtes déjà traités par une règle dédiée (schéma `Bearer` conservé).
fn handled_header(key: &str) -> bool {
    matches!(
        key.to_ascii_lowercase().replace('_', "-").as_str(),
        "authorization" | "authorisation" | "proxy-authorization" | "cookie" | "set-cookie"
    )
}

/// Masque les secrets d'une ligne de log.
pub fn redact_log_line(line: &str) -> String {
    if line.is_empty() {
        return String::new();
    }
    let s = auth_header_re().replace_all(line, |c: &Captures| match c.get(2) {
        Some(scheme) => format!("{}{} {MASK}", &c[1], scheme.as_str()),
        None => format!("{}{MASK}", &c[1]),
    });
    let s = cookie_header_re().replace_all(&s, |c: &Captures| format!("{}{MASK}", &c[1]));
    let s = bearer_re().replace_all(&s, |c: &Captures| format!("{} {MASK}", &c[1]));
    let s = url_re().replace_all(&s, |c: &Captures| redact_url(&c[0]));
    let s = query_param_re().replace_all(&s, |c: &Captures| {
        if is_sensitive_query_param(&c[2]) && !already_masked(&c[3]) {
            format!("{}{}={MASK}", &c[1], &c[2])
        } else {
            c[0].to_string()
        }
    });
    let s = key_value_re().replace_all(&s, |c: &Captures| {
        let key = &c[2];
        let val = &c[4];
        if is_sensitive_key(key) && !already_masked(val) && !handled_header(key) {
            format!("{}{}{}{MASK}", &c[1], key, &c[3])
        } else {
            c[0].to_string()
        }
    });
    let s = token_word_re().replace_all(&s, |c: &Captures| {
        let w = &c[0];
        if looks_like_token(w) {
            mask_secret(w)
        } else {
            w.to_string()
        }
    });
    s.into_owned()
}

/// Masque les secrets d'un bloc de logs, ligne par ligne.
pub fn redact_log_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for (i, line) in text.split('\n').enumerate() {
        if i > 0 {
            out.push('\n');
        }
        out.push_str(&redact_log_line(line));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_authorization_headers() {
        let l = redact_log_line("GET /api Authorization: Bearer abcdefghijklmnop1234 ok");
        assert!(!l.contains("abcdefghijklmnop1234"), "{l}");
        assert!(l.contains("Authorization: Bearer ***"), "{l}");
        let l = redact_log_line(r#"{"authorization":"Basic dXNlcjpwYXNz"}"#);
        assert!(!l.contains("dXNlcjpwYXNz"), "{l}");
        let l = redact_log_line("proxy-authorization=s3cr3tvalue");
        assert!(!l.contains("s3cr3tvalue"), "{l}");
    }

    #[test]
    fn masks_bare_bearer_and_cookies() {
        let l = redact_log_line("upstream sent bearer eyJhbGciOi.payload.sig123456");
        assert!(!l.contains("eyJhbGciOi"), "{l}");
        let l = redact_log_line("Cookie: session=abc123; theme=dark");
        assert!(!l.contains("abc123"), "{l}");
        assert!(l.starts_with("Cookie: ***"), "{l}");
        let l = redact_log_line("Set-Cookie: sid=zzz999; Path=/; HttpOnly");
        assert!(!l.contains("zzz999"), "{l}");
    }

    #[test]
    fn masks_url_credentials_and_query_tokens() {
        let l = redact_log_line("fetch https://user:hunter2@example.com/x?token=t0k3n&page=2 done");
        assert!(!l.contains("hunter2"), "{l}");
        assert!(!l.contains("t0k3n"), "{l}");
        assert!(l.contains("page=2"), "{l}");
        let l = redact_log_line(
            r#"GET /stream/42.m3u8?api_key=KEY123&X-Plex-Token=plx999 HTTP/1.1" 200"#,
        );
        assert!(!l.contains("KEY123"), "{l}");
        assert!(!l.contains("plx999"), "{l}");
        assert!(l.contains("/stream/42.m3u8"), "{l}");
        let l = redact_log_line("postgres://app:pgpass@db:5432/app");
        assert!(!l.contains("pgpass"), "{l}");
    }

    #[test]
    fn masks_sensitive_key_values() {
        let l = redact_log_line("config loaded DB_PASSWORD=supersecret TMDB_API_KEY=abc PORT=8080");
        assert!(!l.contains("supersecret"), "{l}");
        assert!(!l.contains("TMDB_API_KEY=abc"), "{l}");
        assert!(l.contains("PORT=8080"), "{l}");
        let l = redact_log_line(r#"{"refresh_token": "rt-123", "user": "bob"}"#);
        assert!(!l.contains("rt-123"), "{l}");
        assert!(l.contains("bob"), "{l}");
        let l = redact_log_line("X-Api-Key: k-777");
        assert!(!l.contains("k-777"), "{l}");
    }

    #[test]
    fn masks_token_shaped_words() {
        let l = redact_log_line("using ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345 for clone");
        assert!(!l.contains("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345"), "{l}");
        let l = redact_log_line("sk-proj-abcdefghijklmnopqrstuv in env");
        assert!(!l.contains("abcdefghijklmnopqrstuv"), "{l}");
    }

    #[test]
    fn keeps_plain_lines_and_is_idempotent() {
        let plain = "2026-10-27T01:00:00Z INFO ffmpeg exited with code 1 (max_tokens=5)";
        assert_eq!(redact_log_line(plain), plain);
        let once = redact_log_text("a\nAuthorization: Bearer abcdefghijklmnop\nb");
        assert_eq!(redact_log_text(&once), once);
        assert_eq!(once.lines().count(), 3);
    }
}
