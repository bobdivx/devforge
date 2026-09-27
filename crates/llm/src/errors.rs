//! Humanisation des messages d'erreur LLM pour l'interface utilisateur.
//! Transforme les erreurs brutes API (JSON, codes HTTP) en phrases françaises claires.

use regex::Regex;
use serde_json::Value;

/// Taille maximale du message d'erreur humanisé (pour éviter overflow UI).
const MAX_ERROR_LENGTH: usize = 120;

/// Formate une erreur LLM brute en message français concis et clair.
///
/// Traite les cas courants :
/// - 429 / RESOURCE_EXHAUSTED / quota (Gemini, OpenAI)
/// - 401/403 clé invalide
/// - 404 modèle introuvable
/// - Timeouts / erreurs réseau
/// - Erreurs génériques (tronquées)
pub fn humanize_llm_error(raw_error: &str) -> String {
    if raw_error.is_empty() {
        return "Erreur inconnue".to_string();
    }

    let normalized = raw_error.trim();

    // Crédits épuisés / plafond de dépenses (xAI 403 « used all available credits or
    // reached its monthly spending limit », OpenAI `insufficient_quota`…) : la clé est
    // acceptée, c'est la facturation du compte qui bloque — ne pas parler de clé invalide.
    if let Some(msg) = handle_billing(normalized) {
        return msg;
    }

    // Pattern 429 avec extraction de retry delay
    if let Some(msg) = handle_rate_limit(normalized) {
        return msg;
    }

    // Fournisseur injoignable (avant les codes HTTP : une URL contient parfois « 403 »…).
    if let Some(msg) = handle_unreachable(normalized) {
        return msg;
    }

    // 401, ou 403 qui parle vraiment d'authentification : clé invalide.
    let l = normalized.to_lowercase();
    let auth_text = l.contains("api key")
        || l.contains("api_key")
        || l.contains("apikey")
        || l.contains("unauthorized")
        || l.contains("unauthenticated")
        || l.contains("authentication")
        || l.contains("invalid token")
        || l.contains("incorrect token");
    if normalized.contains("401") || (normalized.contains("403") && auth_text) {
        return "Clé API invalide ou refusée.".to_string();
    }

    // Autre 403 : accès refusé pour une autre raison (proxy, réseau, ACL) — on montre la
    // raison donnée par le fournisseur plutôt que d'accuser la clé.
    if normalized.contains("403") || normalized.contains("Forbidden") {
        let detail = provider_message(normalized).unwrap_or_default();
        let msg = if detail.is_empty() {
            "Accès refusé par le fournisseur (403), sans rapport avec la clé.".to_string()
        } else {
            format!("Accès refusé par le fournisseur : {detail}")
        };
        return truncate(msg);
    }

    // Pattern 404 - modèle introuvable
    if normalized.contains("404") && (normalized.contains("model") || normalized.contains("Model")) {
        return "Modèle introuvable.".to_string();
    }


    // Pattern quota sans 429 explicite
    if normalized.to_lowercase().contains("quota") || normalized.to_lowercase().contains("exceeded") {
        return "Quota dépassé. Réessaie plus tard.".to_string();
    }

    // Sinon : nettoyer et tronquer
    cleanup_generic_error(normalized)
}

fn handle_unreachable(error: &str) -> Option<String> {
    let l = error.to_lowercase();
    if l.contains("connection refused") {
        return Some("Fournisseur injoignable : connexion refusée. Vérifie l’URL et que le service tourne.".into());
    }
    if l.contains("dns error") || l.contains("failed to lookup address") || l.contains("name or service not known") {
        return Some("Fournisseur injoignable : nom d’hôte introuvable. Vérifie l’URL.".into());
    }
    if l.contains("no route to host") || l.contains("network is unreachable") || l.contains("host is unreachable") {
        return Some("Fournisseur injoignable : hôte hors d’atteinte. Vérifie l’URL et le réseau.".into());
    }
    if l.contains("timed out") || l.contains("timeout") {
        return Some("Fournisseur injoignable : délai dépassé.".into());
    }
    if l.contains("connection reset") || l.contains("connection closed") || l.contains("error sending request") || l.contains("connect error") {
        return Some("Fournisseur injoignable : connexion interrompue. Vérifie l’URL et que le service tourne.".into());
    }
    None
}

/// Message lisible d'un corps d'erreur JSON (`{"error":"…"}`, `{"error":{"message":"…"}}`,
/// `{"message":"…"}`), sinon le texte après le code HTTP.
fn provider_message(error: &str) -> Option<String> {
    let start = error.find('{')?;
    let v: Value = serde_json::from_str(&error[start..]).ok()?;
    v.get("error")
        .and_then(|e| e.as_str().map(str::to_string))
        .or_else(|| v.pointer("/error/message").and_then(|m| m.as_str()).map(str::to_string))
        .or_else(|| v.get("message").and_then(|m| m.as_str()).map(str::to_string))
        .map(|m| m.trim().to_string())
        .filter(|m| !m.is_empty())
}

fn truncate(msg: String) -> String {
    const MAX: usize = 180;
    if msg.chars().count() > MAX {
        format!("{}…", msg.chars().take(MAX - 1).collect::<String>())
    } else {
        msg
    }
}

fn handle_billing(error: &str) -> Option<String> {
    let l = error.to_lowercase();
    let billing = l.contains("credits")
        || l.contains("spending limit")
        || l.contains("insufficient_quota")
        || l.contains("insufficient balance");
    billing.then(|| {
        "Crédits épuisés ou plafond de dépenses atteint chez le fournisseur : la clé est acceptée, recharge le compte ou relève le plafond.".to_string()
    })
}

/// Gère les erreurs 429 (rate limit / quota) en extrayant retry seconds si présent.
fn handle_rate_limit(error: &str) -> Option<String> {
    if !error.contains("429") && !error.to_lowercase().contains("resource_exhausted") {
        return None;
    }

    // Tentative d'extraction du retry delay depuis le message JSON
    let retry_seconds = extract_retry_seconds(error);

    // Vérifier si c'est un quota free-tier
    let is_free_tier = error.to_lowercase().contains("free") 
        || error.to_lowercase().contains("tier")
        || error.to_lowercase().contains("quota");

    match (is_free_tier, retry_seconds) {
        (true, Some(secs)) => Some(format!("Quota dépassé (free-tier). Réessaie dans ~{}s.", secs)),
        (true, None) => Some("Quota dépassé (free-tier). Réessaie dans quelques instants.".to_string()),
        (false, Some(secs)) => Some(format!("Trop de requêtes. Réessaie dans ~{}s.", secs)),
        (false, None) => Some("Trop de requêtes. Réessaie plus tard.".to_string()),
    }
}

/// Extrait le délai de retry depuis un message d'erreur JSON (ex: Gemini).
/// Cherche des patterns comme "Try again in 60s" ou des valeurs numériques.
fn extract_retry_seconds(error: &str) -> Option<u32> {
    // Pattern 1: "Try again in XXs" ou "retry after XXs"
    let re_try_in = Regex::new(r"(?i)(?:try again|retry).*?(\d+)\s*(?:s|sec|second)").ok()?;
    if let Some(cap) = re_try_in.captures(error) {
        if let Some(num) = cap.get(1) {
            return num.as_str().parse::<u32>().ok();
        }
    }

    // Pattern 2: JSON avec { "error": { ... "message": "...60s..." } }
    if let Ok(json) = serde_json::from_str::<Value>(error) {
        if let Some(msg) = json.pointer("/error/message").and_then(|v| v.as_str()) {
            return extract_retry_seconds(msg);
        }
    }

    None
}

/// Nettoie et tronque une erreur générique.
/// - Retire les dumps JSON (arrays [...])
/// - Tronque à MAX_ERROR_LENGTH
fn cleanup_generic_error(error: &str) -> String {
    let mut cleaned = error.to_string();

    // Retirer les blocs JSON array [...]
    if let Some(bracket_pos) = cleaned.find('[') {
        cleaned = cleaned[..bracket_pos].trim().to_string();
    }

    // Retirer les blocs JSON object {...} (conserver seulement avant si significatif)
    if let Some(brace_pos) = cleaned.find('{') {
        let prefix = cleaned[..brace_pos].trim();
        if prefix.len() > 10 {
            cleaned = prefix.to_string();
        } else {
            // Préfixe trop court, chercher un message dans le JSON
            if let Ok(json) = serde_json::from_str::<Value>(&cleaned[brace_pos..]) {
                if let Some(msg) = json.get("message").and_then(|v| v.as_str()) {
                    cleaned = msg.to_string();
                } else if let Some(msg) = json.pointer("/error/message").and_then(|v| v.as_str()) {
                    cleaned = msg.to_string();
                } else {
                    cleaned = prefix.to_string();
                }
            } else {
                cleaned = prefix.to_string();
            }
        }
    }

    // Tronquer si trop long
    if cleaned.len() > MAX_ERROR_LENGTH {
        let truncated: String = cleaned.chars().take(MAX_ERROR_LENGTH - 3).collect();
        cleaned = format!("{}...", truncated);
    }

    // Fallback si vide après nettoyage
    if cleaned.is_empty() {
        return "Erreur provider.".to_string();
    }

    cleaned
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gemini_429_free_tier() {
        let raw = r#"LLM 429 Too Many Requests: [{ "error": { "code": 429, "message": "You exceeded your free-tier quota. Try again in 60s.", "status": "RESOURCE_EXHAUSTED" } }]"#;
        let result = humanize_llm_error(raw);
        assert!(result.contains("Quota dépassé"));
        assert!(result.contains("free-tier"));
        assert!(result.contains("60s"));
    }

    #[test]
    fn test_generic_429() {
        let raw = "LLM 429: Too Many Requests";
        let result = humanize_llm_error(raw);
        assert!(result.contains("Trop de requêtes"));
    }

    #[test]
    fn test_401_invalid_key() {
        let raw = "LLM 401: Unauthorized";
        let result = humanize_llm_error(raw);
        assert_eq!(result, "Clé API invalide ou refusée.");
    }

    #[test]
    fn test_xai_no_credits_is_not_invalid_key() {
        let raw = r#"LLM 403 Forbidden: {"code":"permission-denied","error":"Your team abc has either used all available credits or reached its monthly spending limit. To continue making API requests, please purchase more credits or raise your spending limit."}"#;
        let result = humanize_llm_error(raw);
        assert!(result.starts_with("Crédits épuisés"), "{result}");
        let oa = r#"LLM 429: {"error":{"code":"insufficient_quota","message":"You exceeded your current quota"}}"#;
        assert!(humanize_llm_error(oa).starts_with("Crédits épuisés"));
    }

    #[test]
    fn test_loopback_only_403_is_not_invalid_key() {
        let raw = r#"LLM 403 Forbidden: {"code":"loopback-only","error":"plaintext requests are accepted only from loopback; cluster peers must use the mTLS ingress"}"#;
        let r = humanize_llm_error(raw);
        assert!(r.starts_with("Accès refusé par le fournisseur : plaintext requests"), "{r}");
        let bad = r#"LLM 403 Forbidden: {"error":{"message":"Incorrect API key provided"}}"#;
        assert_eq!(humanize_llm_error(bad), "Clé API invalide ou refusée.");
    }

    #[test]
    fn test_connection_refused_is_clear() {
        let raw = "LLM HTTP: error sending request for url (http://172.17.0.1:11434/v1/chat/completions): client error (Connect): tcp connect error: Connection refused (os error 111)";
        let r = humanize_llm_error(raw);
        assert!(r.contains("connexion refusée"), "{r}");
        assert!(!r.contains("Clé API"));
        let dns = "LLM HTTP: error sending request for url (http://nope.invalid/v1): dns error: failed to lookup address information";
        assert!(humanize_llm_error(dns).contains("nom d’hôte introuvable"));
    }

    #[test]
    fn test_404_model_not_found() {
        let raw = "LLM 404: Model 'gpt-99' not found";
        let result = humanize_llm_error(raw);
        assert_eq!(result, "Modèle introuvable.");
    }

    #[test]
    fn test_timeout() {
        let raw = "LLM HTTP: connection timeout";
        let result = humanize_llm_error(raw);
        assert_eq!(result, "Fournisseur injoignable : délai dépassé.");
    }

    #[test]
    fn test_long_json_blob_truncated() {
        let raw = r#"LLM 500: {"error":{"type":"internal","message":"Something went very wrong in the backend and here is a very long technical explanation that nobody wants to read in the UI because it's just noise and makes everything look bad"}}"#;
        let result = humanize_llm_error(raw);
        assert!(result.len() <= MAX_ERROR_LENGTH);
        assert!(!result.contains('{'));
    }

    #[test]
    fn test_empty_error() {
        let result = humanize_llm_error("");
        assert_eq!(result, "Erreur inconnue");
    }

    #[test]
    fn test_quota_without_429() {
        let raw = "You have exceeded your quota";
        let result = humanize_llm_error(raw);
        assert!(result.contains("Quota dépassé"));
    }

    #[test]
    fn test_complex_gemini_error() {
        let raw = r#"LLM 429 Too Many Requests: { "error": { "code": 429, "message": "Resource exhausted: You exceeded the free-tier quota. Try again in 120s.", "status": "RESOURCE_EXHAUSTED" } }"#;
        let result = humanize_llm_error(raw);
        assert!(result.contains("Quota dépassé"));
        assert!(result.contains("120s"));
    }
}
