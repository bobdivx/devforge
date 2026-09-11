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

    // Pattern 429 avec extraction de retry delay
    if let Some(msg) = handle_rate_limit(normalized) {
        return msg;
    }

    // Pattern 401/403 - clé invalide
    if normalized.contains("401") || normalized.contains("403") || normalized.contains("Unauthorized") || normalized.contains("Forbidden") {
        return "Clé API invalide ou refusée.".to_string();
    }

    // Pattern 404 - modèle introuvable
    if normalized.contains("404") && (normalized.contains("model") || normalized.contains("Model")) {
        return "Modèle introuvable.".to_string();
    }

    // Pattern timeout / réseau
    if normalized.contains("timeout") || normalized.contains("Timeout") || normalized.contains("connection") || normalized.contains("Connection") {
        return "Provider injoignable.".to_string();
    }

    // Pattern quota sans 429 explicite
    if normalized.to_lowercase().contains("quota") || normalized.to_lowercase().contains("exceeded") {
        return "Quota dépassé. Réessaie plus tard.".to_string();
    }

    // Sinon : nettoyer et tronquer
    cleanup_generic_error(normalized)
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
    fn test_404_model_not_found() {
        let raw = "LLM 404: Model 'gpt-99' not found";
        let result = humanize_llm_error(raw);
        assert_eq!(result, "Modèle introuvable.");
    }

    #[test]
    fn test_timeout() {
        let raw = "LLM HTTP: connection timeout";
        let result = humanize_llm_error(raw);
        assert_eq!(result, "Provider injoignable.");
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
