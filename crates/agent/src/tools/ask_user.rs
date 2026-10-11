//! P5-04 : question fermée à l'utilisateur, rendue en boutons (QuestionCard). Le tour s'arrête après.

use async_trait::async_trait;
use devforge_shared::{Result, Tool};
use serde_json::{json, Value};

pub const ASK_USER: &str = "ask_user";
const ACTIONS: &[&str] = &["reply", "approve_publish"];
const STYLES: &[&str] = &["primary", "secondary", "danger"];

pub struct AskUserTool;

fn valid_id(id: &str) -> bool {
    (1..=32).contains(&id.len()) && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
}

fn clip(s: &str, max: usize) -> String {
    let t = s.trim();
    if t.chars().count() <= max {
        t.to_string()
    } else {
        let mut out: String = t.chars().take(max.saturating_sub(1)).collect();
        out.push('…');
        out
    }
}

/// Valide et normalise la question. Erreur = message pour le modèle (il peut se corriger).
pub fn normalize(args: &Value) -> std::result::Result<Value, String> {
    let question = args.get("question").and_then(|v| v.as_str()).unwrap_or("").trim();
    if question.is_empty() {
        return Err("question requise".into());
    }
    let options = args.get("options").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    if !(2..=5).contains(&options.len()) {
        return Err(format!("options : 2 à 5 attendues, {} reçue(s)", options.len()));
    }
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for (i, o) in options.iter().enumerate() {
        let label = o.get("label").and_then(|v| v.as_str()).unwrap_or("").trim();
        if label.is_empty() {
            return Err(format!("option {} : label requis", i + 1));
        }
        let raw_id = o.get("id").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
        let id = if valid_id(&raw_id) { raw_id } else { format!("opt{}", i + 1) };
        if !seen.insert(id.clone()) {
            return Err(format!("option {} : id « {id} » en double", i + 1));
        }
        let action = o.get("action").and_then(|v| v.as_str()).filter(|a| ACTIONS.contains(a)).unwrap_or("reply");
        let style = o.get("style").and_then(|v| v.as_str()).filter(|s| STYLES.contains(s)).unwrap_or("secondary");
        let mut opt = json!({"id": id, "label": clip(label, 60), "action": action, "style": style});
        if let Some(d) = o.get("description").and_then(|v| v.as_str()).filter(|d| !d.trim().is_empty()) {
            opt["description"] = json!(clip(d, 140));
        }
        out.push(opt);
    }
    let allow_free_text = args.get("allow_free_text").and_then(|v| v.as_bool()).unwrap_or(true);
    Ok(json!({
        "ok": true,
        "awaiting_answer": true,
        "question": clip(question, 300),
        "options": out,
        "allow_free_text": allow_free_text,
    }))
}

/// Texte remis au modèle pour une réponse structurée (`answer_to`).
pub fn answer_text(question: &str, label: &str, free_text: Option<&str>) -> String {
    match free_text.map(str::trim).filter(|t| !t.is_empty()) {
        Some(t) => format!("Réponse à ta question « {question} » : {t}"),
        None => format!("Réponse à ta question « {question} » : {label}"),
    }
}

#[async_trait]
impl Tool for AskUserTool {
    fn name(&self) -> &str {
        ASK_USER
    }

    fn description(&self) -> &str {
        "Pose UNE question fermée à l'utilisateur avec des options cliquables, puis termine ton tour. À utiliser seulement quand une décision de l'utilisateur est indispensable (publication, choix entre approches, info introuvable en mémoire). Pour publier : une option action=approve_publish (style primary) et une option « garder en local »."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "question": { "type": "string", "maxLength": 300 },
                "options": {
                    "type": "array", "minItems": 2, "maxItems": 5,
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": { "type": "string", "pattern": "^[a-z0-9_-]{1,32}$" },
                            "label": { "type": "string", "maxLength": 60 },
                            "description": { "type": "string", "maxLength": 140 },
                            "action": { "type": "string", "enum": ["reply", "approve_publish"], "default": "reply" },
                            "style": { "type": "string", "enum": ["primary", "secondary", "danger"], "default": "secondary" }
                        },
                        "required": ["id", "label"]
                    }
                },
                "allow_free_text": { "type": "boolean", "default": true }
            },
            "required": ["question", "options"]
        })
    }

    async fn execute(&self, arguments: Value) -> Result<Value> {
        Ok(match normalize(&arguments) {
            Ok(v) => v,
            Err(e) => json!({"ok": false, "error": format!("ask_user invalide : {e}")}),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts(n: usize) -> Vec<Value> {
        (0..n).map(|i| json!({"id": format!("o{i}"), "label": format!("Option {i}")})).collect()
    }

    #[test]
    fn two_to_five_options() {
        for n in [0, 1, 6] {
            assert!(normalize(&json!({"question": "Q ?", "options": opts(n)})).is_err(), "{n} options acceptées");
        }
        for n in 2..=5 {
            let v = normalize(&json!({"question": "Q ?", "options": opts(n)})).unwrap();
            assert_eq!(v["options"].as_array().unwrap().len(), n);
        }
    }

    #[test]
    fn defaults_and_sanitizing() {
        let v = normalize(&json!({
            "question": "Je pousse le correctif lockfile sur fix/lockfile ?",
            "options": [
                {"id": "Oui Publier", "label": "Oui, publier", "action": "approve_publish", "style": "primary"},
                {"id": "local", "label": "Non, garder en local", "action": "rm -rf", "style": "rainbow"}
            ]
        }))
        .unwrap();
        assert_eq!(v["options"][0]["id"], "opt1", "id invalide remplacé");
        assert_eq!(v["options"][0]["action"], "approve_publish");
        assert_eq!(v["options"][1]["action"], "reply");
        assert_eq!(v["options"][1]["style"], "secondary");
        assert_eq!(v["allow_free_text"], true);
    }

    #[test]
    fn rejects_empty_question_and_duplicate_ids() {
        assert!(normalize(&json!({"question": " ", "options": opts(2)})).is_err());
        assert!(normalize(&json!({"question": "Q", "options": [{"id": "a", "label": "A"}, {"id": "a", "label": "B"}]})).is_err());
    }

    #[test]
    fn answer_text_for_model() {
        assert_eq!(answer_text("Publier ?", "Oui", None), "Réponse à ta question « Publier ? » : Oui");
        assert_eq!(answer_text("Publier ?", "Oui", Some("plutôt demain")), "Réponse à ta question « Publier ? » : plutôt demain");
    }
}
