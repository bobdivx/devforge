//! Journal « montre-moi ton travail » : une ligne par décision (quoi, pourquoi, preuve, résultat).
//! L'outil ne fait que valider : la ligne est lue ensuite dans les événements du run
//! (`agent_run_events`, `tool_done` de `record_decision`). Règle : une preuve est un lien ou un
//! chemin, jamais un paragraphe.

use async_trait::async_trait;
use devforge_shared::{Result, Tool};
use serde_json::{json, Value};

pub const RECORD_DECISION: &str = "record_decision";
pub const EVIDENCE_RULE: &str = "Une preuve est un lien ou un chemin, jamais un paragraphe.";
const MAX_EVIDENCE: usize = 300;

/// Issue d'une décision. Absente ou inconnue : refusée (un résultat manquant n'est pas un succès).
pub fn normalize_outcome(raw: &str) -> Option<&'static str> {
    match raw.trim().to_lowercase().as_str() {
        "ok" | "success" | "succès" | "done" | "passed" => Some("ok"),
        "failed" | "fail" | "échec" | "echec" | "error" | "ko" => Some("failed"),
        "skipped" | "skip" | "ignoré" | "n/a" => Some("skipped"),
        _ => None,
    }
}

/// Lien http(s) ou chemin (fichier, route) : un seul mot, sans espace, borné.
pub fn is_evidence(raw: &str) -> bool {
    let s = raw.trim();
    if s.is_empty() || s.chars().count() > MAX_EVIDENCE || s.chars().any(char::is_whitespace) {
        return false;
    }
    let lower = s.to_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        let rest = s.split_once("://").map(|(_, r)| r).unwrap_or("");
        return !rest.is_empty() && !rest.starts_with('/');
    }
    if lower.contains("://") || lower.starts_with("javascript:") || lower.starts_with("data:") {
        return false;
    }
    // Chemin : `/app/…`, `./src/x.ts`, `src/main.rs`, `Cargo.toml`, `src/a.rs:42`.
    s.starts_with('/')
        || s.starts_with("./")
        || s.starts_with("../")
        || s.starts_with("~/")
        || s.contains('/')
        || (s.contains('.') && !s.ends_with('.'))
}

fn arg(args: &Value, key: &str) -> String {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .unwrap_or_default()
}

fn clip(s: &str, max: usize) -> String {
    let one: String = s.split_whitespace().collect::<Vec<_>>().join(" ");
    one.chars().take(max).collect()
}

pub struct RecordDecisionTool;

#[async_trait]
impl Tool for RecordDecisionTool {
    fn name(&self) -> &str {
        RECORD_DECISION
    }

    fn description(&self) -> &str {
        "Note une décision dans le journal « montre-moi ton travail » du run (visible par l'utilisateur).\n\
         Une ligne par décision : what (quoi, court), why (pourquoi, une phrase), evidence (preuve = \
         UN lien https://… ou UN chemin src/fichier.rs ou /app/… — jamais un paragraphe), outcome \
         (ok | failed | skipped). step (1, 2 ou 3) rattache la décision à une étape du modèle.\n\
         Un résultat non vérifié n'est pas « ok » : mets failed ou skipped."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "what": { "type": "string", "maxLength": 120, "description": "Décision prise (court)" },
                "why": { "type": "string", "maxLength": 300, "description": "Pourquoi, en une phrase" },
                "evidence": { "type": "string", "maxLength": 300, "description": "Lien https://… ou chemin (src/x.rs, /app/…)" },
                "outcome": { "type": "string", "enum": ["ok", "failed", "skipped"] },
                "step": { "type": "integer", "minimum": 1, "maximum": 3, "description": "Étape du modèle (1-3)" }
            },
            "required": ["what", "why", "evidence", "outcome"]
        })
    }

    async fn execute(&self, args: Value) -> Result<Value> {
        let what = clip(&arg(&args, "what"), 120);
        let why = clip(&arg(&args, "why"), 300);
        let evidence = arg(&args, "evidence");
        if what.is_empty() || why.is_empty() {
            return Ok(json!({"ok": false, "error": "what et why sont requis"}));
        }
        if !is_evidence(&evidence) {
            return Ok(json!({"ok": false, "error": EVIDENCE_RULE}));
        }
        let Some(outcome) = normalize_outcome(&arg(&args, "outcome")) else {
            return Ok(json!({
                "ok": false,
                "error": "outcome requis : ok, failed ou skipped (un résultat manquant ne compte jamais comme un succès)"
            }));
        };
        let step = args
            .get("step")
            .and_then(|v| {
                v.as_i64()
                    .or_else(|| v.as_str().and_then(|s| s.trim().parse().ok()))
            })
            .filter(|n| (1..=3).contains(n));
        Ok(json!({
            "ok": true,
            "decision": {
                "what": what,
                "why": why,
                "evidence": evidence,
                "outcome": outcome,
                "step": step,
            },
            "message": "Décision notée au journal.",
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn evidence_is_a_link_or_a_path_never_a_paragraph() {
        for ok in [
            "https://web.jeser.app/health",
            "src/main.rs",
            "/app/receipts",
            "./apps/web/src/x.tsx:42",
            "Cargo.toml",
        ] {
            assert!(is_evidence(ok), "{ok}");
        }
        for bad in [
            "",
            "le build est passé sans erreur",
            "javascript:alert(1)",
            "ftp://x.y/z",
            "ok",
            &"a/".repeat(200),
        ] {
            assert!(!is_evidence(bad), "{bad}");
        }
    }

    #[test]
    fn missing_outcome_is_refused() {
        assert_eq!(normalize_outcome("OK"), Some("ok"));
        assert_eq!(normalize_outcome("échec"), Some("failed"));
        assert_eq!(normalize_outcome(""), None);
        assert_eq!(normalize_outcome("probablement"), None);
    }

    #[tokio::test]
    async fn records_a_valid_decision_and_refuses_paragraph_evidence() {
        let t = RecordDecisionTool;
        let ok = t
            .execute(json!({"what": "Relancer le build", "why": "lockfile corrigé", "evidence": "package-lock.json", "outcome": "ok", "step": 2}))
            .await
            .unwrap();
        assert_eq!(ok["ok"], true);
        assert_eq!(ok["decision"]["step"], 2);
        let bad = t
            .execute(json!({"what": "x", "why": "y", "evidence": "j'ai regardé les logs et tout va bien", "outcome": "ok"}))
            .await
            .unwrap();
        assert_eq!(bad["ok"], false);
        assert_eq!(bad["error"], EVIDENCE_RULE);
        let none = t
            .execute(json!({"what": "x", "why": "y", "evidence": "src/a.rs"}))
            .await
            .unwrap();
        assert_eq!(none["ok"], false);
    }
}
