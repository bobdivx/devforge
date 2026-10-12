//! Filtre de secrets (P3-04) : la mémoire est injectée dans les prompts et lisible par tous
//! les agents de l'utilisateur, donc rien qui ressemble à un secret n'y entre.
//!
//! Les motifs de fournisseurs sont partagés avec la revue de sécurité du workdir
//! (`crates/agent/src/tools/security.rs`).

use regex::Regex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;

/// Motifs des jetons connus : (règle, regex). Source unique pour la mémoire et la revue sécurité.
pub const PROVIDER_PATTERNS: &[(&str, &str)] = &[
    ("aws_access_key", r"\bAKIA[0-9A-Z]{16}\b"),
    (
        "github_token",
        r"\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b",
    ),
    ("openai_key", r"\bsk-[A-Za-z0-9_-]{20,}\b"),
    ("stripe_live", r"\bsk_live_[A-Za-z0-9]{8,}\b"),
    ("slack_token", r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b"),
    ("private_key", r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
];

/// Motifs supplémentaires propres à la mémoire (plus stricts que la revue du workdir).
const MEMORY_PATTERNS: &[(&str, &str)] = &[
    ("pem_block", r"-----BEGIN [A-Z ]+-----"),
    (
        "jwt",
        r"\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*",
    ),
    // Préfixes courts : même tronqués (« ghp_xxx… »), on n'enregistre pas.
    (
        "token_prefix",
        r"\b(?:ghp_|gho_|github_pat_|xox[baprs]-|sk-[A-Za-z0-9]{6,}|AKIA[0-9A-Z]{4,})",
    ),
    // password=…, token: …, secret=…, api_key=… suivi d'une valeur.
    (
        "credential_assignment",
        r"(?i)\b(?:password|passwd|pwd|mot de passe|mdp|token|secret|api[_-]?key|apikey|client[_-]?secret|bearer)\s*[:=]\s*([^\s,;]{6,})",
    ),
    (
        "bearer_header",
        r"(?i)\bauthorization\s*:\s*bearer\s+[A-Za-z0-9._~+/=-]{12,}",
    ),
];

static REJECTIONS: AtomicU64 = AtomicU64::new(0);

/// Nombre de refus depuis le démarrage (métriques P3-08).
pub fn rejections() -> u64 {
    REJECTIONS.load(Ordering::Relaxed)
}

fn compiled() -> &'static Vec<(&'static str, Regex)> {
    static RX: OnceLock<Vec<(&'static str, Regex)>> = OnceLock::new();
    RX.get_or_init(|| {
        PROVIDER_PATTERNS
            .iter()
            .chain(MEMORY_PATTERNS.iter())
            .map(|(rule, p)| (*rule, Regex::new(p).expect("motif secret")))
            .collect()
    })
}

fn token_rx() -> &'static Regex {
    static RX: OnceLock<Regex> = OnceLock::new();
    RX.get_or_init(|| Regex::new(r"[A-Za-z0-9+/=_-]{32,}").expect("token"))
}

fn uuid_rx() -> &'static Regex {
    static RX: OnceLock<Regex> = OnceLock::new();
    RX.get_or_init(|| {
        Regex::new(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
            .expect("uuid")
    })
}

/// Entropie de Shannon (bits par caractère).
pub fn entropy(s: &str) -> f64 {
    let mut counts = std::collections::HashMap::new();
    let mut n = 0usize;
    for c in s.chars() {
        *counts.entry(c).or_insert(0usize) += 1;
        n += 1;
    }
    if n == 0 {
        return 0.0;
    }
    counts
        .values()
        .map(|&k| {
            let p = k as f64 / n as f64;
            -p * p.log2()
        })
        .sum()
}

/// Longue chaîne hex/base64 à haute entropie (> 3.5 bits/car.). Exclut les UUID, les SHA git
/// (40 hex) et les identifiants en kebab-case/snake_case tout en minuscules.
fn high_entropy_token(tok: &str) -> bool {
    if uuid_rx().is_match(tok) {
        return false;
    }
    let has_digit = tok.chars().any(|c| c.is_ascii_digit());
    let has_alpha = tok.chars().any(|c| c.is_ascii_alphabetic());
    if !has_digit || !has_alpha {
        return false;
    }
    let is_hex = tok.chars().all(|c| c.is_ascii_hexdigit());
    if is_hex {
        // SHA de commit : public, utile dans le journal.
        return tok.len() != 40 && entropy(tok) > 3.0;
    }
    let has_upper = tok.chars().any(|c| c.is_ascii_uppercase());
    let has_lower = tok.chars().any(|c| c.is_ascii_lowercase());
    has_upper && has_lower && entropy(tok) > 3.5
}

/// Règle déclenchée si `content` contient un secret, sinon `None`.
/// `known_values` : valeurs exactes des variables d'environnement marquées secrètes.
pub fn detect(content: &str, known_values: &[String]) -> Option<&'static str> {
    for (rule, rx) in compiled() {
        if *rule == "credential_assignment" {
            // La valeur doit ressembler à un secret (chiffre ou symbole), pas à un mot.
            let hit = rx.captures_iter(content).any(|c| {
                c.get(1)
                    .map(|v| v.as_str().chars().any(|ch| !ch.is_alphabetic()))
                    .unwrap_or(false)
            });
            if hit {
                return Some(rule);
            }
            continue;
        }
        if rx.is_match(content) {
            return Some(rule);
        }
    }
    if token_rx()
        .find_iter(content)
        .any(|m| high_entropy_token(m.as_str()))
    {
        return Some("high_entropy");
    }
    if known_values
        .iter()
        .map(|v| v.trim())
        .filter(|v| v.len() >= 6)
        .any(|v| content.contains(v))
    {
        return Some("env_secret_value");
    }
    None
}

/// Comme `detect`, en comptant le refus (métriques).
pub fn check(content: &str, known_values: &[String]) -> Result<(), String> {
    match detect(content, known_values) {
        Some(rule) => {
            REJECTIONS.fetch_add(1, Ordering::Relaxed);
            tracing::info!(rule, "mémoire : secret détecté, écriture refusée");
            Err(REJECTED_MESSAGE.to_string())
        }
        None => Ok(()),
    }
}

pub const REJECTED_MESSAGE: &str = "secret détecté — non enregistré";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_table() {
        let cases: &[(&str, bool)] = &[
            // positifs
            (
                "le token GitHub est ghp_abcdefghijklmnopqrstuvwxyz0123456789",
                true,
            ),
            ("le token GitHub est ghp_xxx…", true),
            (
                "PAT : github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz",
                true,
            ),
            ("clé OpenAI sk-proj-AbCdEf0123456789AbCdEf0123", true),
            ("bot slack xoxb-123456789012-abcdefghijkl", true),
            ("AWS AKIAIOSFODNN7EXAMPLE pour le bucket", true),
            ("-----BEGIN OPENSSH PRIVATE KEY----- b3BlbnNzaC1rZXk", true),
            (
                "cookie eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N",
                true,
            ),
            ("password=Hunter2!x", true),
            ("le token: 9f8e7d6c5b4a", true),
            ("secret = s3cr3t-value", true),
            ("clé: Zx9QmT4vLp2RsW8yNb6KcF3hJd7GaE5u", true),
            // négatifs
            ("Le worker Demeter répond sur http://10.1.0.88:8000.", false),
            (
                "L'app est en ligne sur https://web.jeser.app/api/v1/health",
                false,
            ),
            ("Déploiement 3f2a9c1 : succès — smoke 200", false),
            (
                "Commit 54607a2ecdaf0def85bad0ce86b11237034be232 mergé",
                false,
            ),
            (
                "Projet 02792add-bf8d-41a3-8761-3ad7f75ae6f8 = template-studio",
                false,
            ),
            (
                "Préfère des réponses courtes, accusé de réception puis travail.",
                false,
            ),
            (
                "Le mot de passe est dans le gestionnaire, ne jamais le demander.",
                false,
            ),
            (
                "Branche fix-resynchroniser-package-lock-json en attente",
                false,
            ),
            ("Le secret: utiliser la branche dev", false),
        ];
        for (text, want) in cases {
            assert_eq!(
                detect(text, &[]).is_some(),
                *want,
                "cas : {text} → {:?}",
                detect(text, &[])
            );
        }
    }

    #[test]
    fn known_env_values_are_rejected() {
        let vals = vec!["SuperValeur42".to_string(), "abc".to_string()];
        assert_eq!(
            detect("la clé vaut SuperValeur42", &vals),
            Some("env_secret_value")
        );
        // Valeurs trop courtes ignorées (sinon tout texte serait refusé).
        assert_eq!(detect("abc est un mot", &vals), None);
    }

    #[test]
    fn check_counts_rejections() {
        let before = rejections();
        assert_eq!(
            check("ghp_abcdefghijklmnopqrstuvwxyz0123456789", &[]).unwrap_err(),
            REJECTED_MESSAGE
        );
        assert!(rejections() > before);
        assert!(check("rien de sensible", &[]).is_ok());
    }
}
