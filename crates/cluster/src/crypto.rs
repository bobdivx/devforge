use sha2::{Digest, Sha256};
use uuid::Uuid;

pub fn hash_secret(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn new_join_token() -> String {
    format!("dfjoin_{}", Uuid::new_v4().simple())
}

pub fn new_node_secret() -> String {
    format!("dfnode_{}", Uuid::new_v4().simple())
}

pub fn new_node_id() -> String {
    let s = Uuid::new_v4().simple().to_string();
    format!("node_{}", &s[..12])
}

/// Code unique à coller : `dfjoin_…@https://leader`.
pub fn format_join_code(leader_url: &str, token: &str) -> String {
    let url = leader_url.trim().trim_end_matches('/');
    format!("{}@{}", token.trim(), url)
}

/// Token `dfjoin_…` seul, même si on a collé le code `dfjoin_…@https://leader`.
pub fn extract_join_token(raw: &str) -> Option<String> {
    let compact: String = raw.split_whitespace().collect();
    if let Some((tok, url)) = compact.split_once('@') {
        if tok.starts_with("dfjoin_")
            && (url.starts_with("http://") || url.starts_with("https://"))
        {
            return Some(tok.to_string());
        }
    }
    compact
        .split(|c: char| c == '@' || c.is_whitespace())
        .find(|s| s.starts_with("dfjoin_"))
        .map(|s| s.to_string())
}

/// Extrait (leader_url, token) d’un code, d’une URL `/join?token=`, ou du couple séparé.
pub fn parse_join_invite(token: &str, leader_url: &str) -> Result<(String, String), String> {
    let raw = token.trim();
    let url_in = leader_url.trim();

    if let Some(pair) = parse_code(raw) {
        return Ok(pair);
    }
    if let Some(pair) = parse_join_url(raw) {
        return Ok(pair);
    }
    if let Some(pair) = parse_two_lines(raw) {
        return Ok(pair);
    }

    let tok = raw
        .split_whitespace()
        .find(|s| s.starts_with("dfjoin_"))
        .unwrap_or(raw)
        .trim()
        .to_string();
    if !tok.starts_with("dfjoin_") {
        return Err("Invitation invalide — colle le code copié sur le leader".into());
    }
    let url = url_in.trim_end_matches('/').to_string();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Invitation incomplète — le code doit contenir l’URL du leader".into());
    }
    Ok((url, tok))
}

fn parse_code(raw: &str) -> Option<(String, String)> {
    let compact = raw.split_whitespace().collect::<String>();
    let (tok, url) = compact.split_once('@')?;
    if !tok.starts_with("dfjoin_") {
        return None;
    }
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return None;
    }
    Some((url.trim_end_matches('/').into(), tok.into()))
}

fn parse_join_url(raw: &str) -> Option<(String, String)> {
    let s = raw.trim();
    if !(s.starts_with("http://") || s.starts_with("https://")) {
        return None;
    }
    let (without_frag, frag) = s
        .split_once('#')
        .map(|(a, b)| (a, Some(b)))
        .unwrap_or((s, None));
    let (base, query) = without_frag
        .split_once('?')
        .map(|(b, q)| (b, Some(q)))
        .unwrap_or((without_frag, None));
    let mut token = None;
    if let Some(q) = query {
        for part in q.split('&') {
            if let Some((k, v)) = part.split_once('=') {
                if k == "token" || k == "t" {
                    token = Some(v.to_string());
                }
            }
        }
    }
    if token.is_none() {
        if let Some(h) = frag.filter(|h| h.starts_with("dfjoin_")) {
            token = Some(h.to_string());
        }
    }
    let token = token?;
    if !token.starts_with("dfjoin_") {
        return None;
    }
    let (scheme, rest) = base.split_once("://")?;
    let hostport = rest.split('/').next()?;
    if hostport.is_empty() {
        return None;
    }
    Some((format!("{scheme}://{hostport}"), token))
}

fn parse_two_lines(raw: &str) -> Option<(String, String)> {
    let mut url = None;
    let mut token = None;
    for line in raw.lines().map(str::trim).filter(|l| !l.is_empty()) {
        if line.starts_with("dfjoin_") {
            token = Some(line.to_string());
        } else if line.starts_with("http://") || line.starts_with("https://") {
            url = Some(line.trim_end_matches('/').to_string());
        }
    }
    match (url, token) {
        (Some(u), Some(t)) => Some((u, t)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_is_stable() {
        assert_eq!(hash_secret("abc"), hash_secret("abc"));
        assert_ne!(hash_secret("abc"), hash_secret("abd"));
        assert_eq!(hash_secret("abc").len(), 64);
    }

    #[test]
    fn tokens_have_prefix() {
        assert!(new_join_token().starts_with("dfjoin_"));
        assert!(new_node_secret().starts_with("dfnode_"));
        assert!(new_node_id().starts_with("node_"));
    }

    #[test]
    fn join_code_roundtrip() {
        let code = format_join_code("https://web.jeser.app/", "dfjoin_abc");
        assert_eq!(code, "dfjoin_abc@https://web.jeser.app");
        let (url, tok) = parse_join_invite(&code, "").unwrap();
        assert_eq!(url, "https://web.jeser.app");
        assert_eq!(tok, "dfjoin_abc");
        assert_eq!(extract_join_token(&code).as_deref(), Some("dfjoin_abc"));
        // Ancien formulaire : code collé dans token + mauvaise URL locale
        let (url2, tok2) = parse_join_invite(&code, "http://10.1.0.58:8000").unwrap();
        assert_eq!(url2, "https://web.jeser.app");
        assert_eq!(tok2, "dfjoin_abc");
    }

    #[test]
    fn join_url_and_two_fields() {
        let (url, tok) = parse_join_invite(
            "https://web.jeser.app/join?token=dfjoin_xyz",
            "",
        )
        .unwrap();
        assert_eq!(url, "https://web.jeser.app");
        assert_eq!(tok, "dfjoin_xyz");
        let (url2, tok2) =
            parse_join_invite("dfjoin_zzz", "https://10.1.0.88:8000/").unwrap();
        assert_eq!(url2, "https://10.1.0.88:8000");
        assert_eq!(tok2, "dfjoin_zzz");
    }
}
