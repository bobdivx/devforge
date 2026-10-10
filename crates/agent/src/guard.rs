//! Garde-fous « publication » appliqués EN CODE (P1-01).
//!
//! Toute action qui écrit hors du workdir local (GitHub, déploiement, variables de prod)
//! exige un accord humain récent (`project_publish_grants`, 15 min, posé par
//! `POST /api/v1/projects/{uuid}/publish-approval`). Le prompt ne décide plus de rien :
//! `publish_intent` sert seulement à choisir le texte du prompt.

use async_trait::async_trait;
use serde_json::{json, Value};
use sqlx::PgPool;
use std::sync::Arc;

/// Outils qui écrivent toujours hors du workdir local.
pub const ALWAYS_REMOTE: &[&str] = &[
    "create_github_fix",
    "sync_workdir_to_github",
    "publish_to_github",
    "create_github_repo",
    "trigger_deploy",
    "cancel_deployment",
    "upsert_env_var",
];

/// Outils MCP distants (GitHub…) qui écrivent : comparés par suffixe (`github_create_pull_request`…).
const MCP_WRITES: &[&str] = &[
    "create_pull_request",
    "create_or_update_file",
    "create_branch",
    "push_files",
    "merge_pull_request",
    "delete_file",
    "create_repository",
    "update_pull_request",
];

/// Outils / appels qui écrivent hors du workdir local (GitHub, déploiement, prod).
pub fn is_remote_write(tool: &str, args: &Value) -> bool {
    if ALWAYS_REMOTE.contains(&tool) {
        return true;
    }
    if tool == "write_project_file" {
        return args.get("mode").and_then(|v| v.as_str()).map(str::trim) == Some("github");
    }
    if tool == "mcp_call_tool" {
        let t = args
            .get("tool")
            .or_else(|| args.get("tool_name"))
            .or_else(|| args.get("name"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_lowercase();
        return MCP_WRITES.iter().any(|w| t.ends_with(w));
    }
    false
}

/// Accord de publication en cours de validité pour un projet.
#[async_trait]
pub trait PublishGate: Send + Sync {
    async fn allowed(&self, project_uuid: &str) -> bool;
}

/// Gate réel : lit `project_publish_grants.expires_at` (RFC 3339, comparé à maintenant).
pub struct PgPublishGate {
    pub pool: Arc<PgPool>,
}

#[async_trait]
impl PublishGate for PgPublishGate {
    async fn allowed(&self, project_uuid: &str) -> bool {
        publish_grant_valid(&self.pool, project_uuid).await
    }
}

/// Gate fixe (tests, ou registre sans base : refuse par défaut).
pub struct StaticGate(pub bool);

#[async_trait]
impl PublishGate for StaticGate {
    async fn allowed(&self, _project_uuid: &str) -> bool {
        self.0
    }
}

pub async fn publish_grant_valid(pool: &PgPool, project_uuid: &str) -> bool {
    if project_uuid.trim().is_empty() {
        return false;
    }
    let grant: Option<(String,)> =
        sqlx::query_as("SELECT expires_at FROM project_publish_grants WHERE project_uuid = $1")
            .bind(project_uuid)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();
    grant
        .map(|(exp,)| grant_still_valid(&exp, chrono::Utc::now()))
        .unwrap_or(false)
}

/// `expires_at` est stocké en RFC 3339 ; on parse (et on retombe sur la comparaison texte).
pub fn grant_still_valid(expires_at: &str, now: chrono::DateTime<chrono::Utc>) -> bool {
    match chrono::DateTime::parse_from_rfc3339(expires_at.trim()) {
        Ok(exp) => exp.with_timezone(&chrono::Utc) > now,
        Err(_) => expires_at > now.to_rfc3339().as_str(),
    }
}

/// Refus historique des outils de publication (`publish_to_github`).
pub async fn publish_approval_refusal(pool: &PgPool, project_uuid: &str) -> Option<Value> {
    if publish_grant_valid(pool, project_uuid).await {
        None
    } else {
        Some(json!({
            "ok": false,
            "error": "Accord explicite requis avant publication.",
            "hint": "POST /api/v1/projects/{uuid}/publish-approval",
            "code": "publish_approval_required"
        }))
    }
}

/// Résumé court de l'action bloquée, pour le message à l'utilisateur.
pub fn remote_write_summary(tool: &str, args: &Value) -> String {
    let s = |k: &str| args.get(k).and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    match tool {
        "create_github_fix" => {
            let title = s("title");
            if title.is_empty() { "ouvrir une pull request".into() } else { format!("pull request « {title} »") }
        }
        "sync_workdir_to_github" => {
            let msg = s("commit_message");
            if msg.is_empty() { "pousser le brouillon sur GitHub".into() } else { format!("pousser sur GitHub : « {msg} »") }
        }
        "publish_to_github" => "publier le projet sur GitHub".into(),
        "create_github_repo" => "créer le dépôt GitHub".into(),
        "trigger_deploy" => "lancer un déploiement".into(),
        "cancel_deployment" => "annuler un déploiement".into(),
        "upsert_env_var" => "modifier des variables d'environnement de production".into(),
        "write_project_file" => format!("écrire {} directement sur GitHub", s("path")),
        "mcp_call_tool" => format!("appel GitHub {}", s("tool")),
        other => other.to_string(),
    }
}

/// Résultat renvoyé au modèle quand une action distante est tentée sans accord.
pub fn remote_write_blocked(tool: &str, args: &Value) -> Value {
    let summary = remote_write_summary(tool, args);
    json!({
        "ok": false,
        "code": "publish_approval_required",
        "error": "Action distante bloquée : validation explicite requise.",
        "needs_user_action": true,
        "kind": "publish_approval",
        "blocked_tool": tool,
        "message_fr": format!("Je suis prêt à publier ({summary}). Valide pour que je continue."),
        "resume_hint": "Après validation, l'agent reprend la publication (accord valable 15 minutes)."
    })
}

/// Intention de publication exprimée dans le message (sert UNIQUEMENT au prompt).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PublishIntent {
    Explicit,
    Negated,
    None,
}

fn normalize(msg: &str) -> String {
    msg.to_lowercase()
        .replace(['\u{2019}', '\u{2018}', '`', '\u{00b4}'], "'")
        .replace('\u{00a0}', " ")
}

/// Mots-clés (déjà normalisés) qui expriment une demande de publication.
const PUBLISH_NEEDLES: &[&str] = &[
    "crée une pr", "creer une pr", "créer une pr", "crée la pr", "creer la pr", "créer la pr",
    "ouvre une pr", "ouvre la pr", "ouvrir une pr", "open a pr", "pull request", "publie", "publier",
    "valide et crée", "valider et créer", "valide les changements", "merge", "déploie en prod",
    "deploie en prod", "déploie en production", "mets en ligne", "met en ligne", "create_github_fix",
    "ok pour la pr", "tu peux publier", "je valide", "validé", "valide", "pousse sur github",
    "push sur github", "publication validée",
];

const NEGATIONS: &[&str] = &["ne", "n'", "pas", "sans", "aucun", "aucune", "jamais", "don't", "dont", "not", "no", "non", "surtout"];

/// Négation dans la fenêtre de 4 mots avant `start` (ou « pas de <mot-clé> »).
fn negated_before(text: &str, start: usize) -> bool {
    let before = &text[..start];
    let words: Vec<&str> = before
        .split(|c: char| c.is_whitespace() || matches!(c, ',' | ';' | ':' | '(' | ')'))
        .filter(|w| !w.is_empty())
        .collect();
    let window = &words[words.len().saturating_sub(4)..];
    window.iter().any(|w| {
        let w = w.trim_matches(|c: char| !c.is_alphanumeric() && c != '\'');
        // « n'ouvre », « n'publie » : le mot commence par n'
        NEGATIONS.contains(&w) || w.starts_with("n'")
    }) || text[start..].starts_with("n'")
}

pub fn publish_intent(msg: &str) -> PublishIntent {
    let t = normalize(msg);
    let mut found = false;
    let mut negated = false;
    for needle in PUBLISH_NEEDLES {
        let mut from = 0;
        while let Some(pos) = t[from..].find(needle) {
            let start = from + pos;
            // « valide » ne doit pas matcher « invalide »/« validation » isolés en milieu de mot.
            let prev_ok = t[..start].chars().last().map(|c| !c.is_alphanumeric()).unwrap_or(true);
            if prev_ok {
                if negated_before(&t, start) {
                    negated = true;
                } else {
                    found = true;
                }
            }
            from = start + needle.len();
        }
    }
    if found {
        PublishIntent::Explicit
    } else if negated {
        PublishIntent::Negated
    } else {
        PublishIntent::None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_write_table() {
        let cases: &[(&str, Value, bool)] = &[
            ("write_project_file", json!({"mode": "local", "path": "a"}), false),
            ("write_project_file", json!({"path": "a"}), false),
            ("write_project_file", json!({"mode": "github", "path": "a"}), true),
            ("mcp_call_tool", json!({"server": "github", "tool": "create_pull_request"}), true),
            ("mcp_call_tool", json!({"server": "github", "tool": "github_push_files"}), true),
            ("mcp_call_tool", json!({"server": "github", "tool": "merge_pull_request"}), true),
            ("mcp_call_tool", json!({"server": "github", "tool": "get_file_contents"}), false),
            ("read_github_file", json!({}), false),
            ("create_github_fix", json!({}), true),
            ("sync_workdir_to_github", json!({}), true),
            ("publish_to_github", json!({}), true),
            ("create_github_repo", json!({}), true),
            ("trigger_deploy", json!({}), true),
            ("cancel_deployment", json!({}), true),
            ("upsert_env_var", json!({}), true),
            ("run_workdir_command", json!({"command": "npm install"}), false),
            ("http_smoke", json!({}), false),
        ];
        for (tool, args, expected) in cases {
            assert_eq!(is_remote_write(tool, args), *expected, "{tool} {args}");
        }
    }

    #[test]
    fn intent_detects_negation() {
        assert_eq!(publish_intent("ne publie pas"), PublishIntent::Negated);
        assert_eq!(publish_intent("ne publie pas, corrige juste en local"), PublishIntent::Negated);
        assert_eq!(publish_intent("pas de pull request"), PublishIntent::Negated);
        assert_ne!(publish_intent("Ne crée pas de PR"), PublishIntent::Explicit);
        assert_eq!(publish_intent("don't open a PR, just fix it"), PublishIntent::Negated);
        assert_eq!(publish_intent("sans publier"), PublishIntent::Negated);
        assert_eq!(publish_intent("n’ouvre pas de pull request"), PublishIntent::Negated);
    }

    #[test]
    fn intent_detects_explicit() {
        assert_eq!(publish_intent("Validé"), PublishIntent::Explicit);
        assert_eq!(publish_intent("publie la PR"), PublishIntent::Explicit);
        assert_eq!(publish_intent("Je valide, tu peux publier"), PublishIntent::Explicit);
        assert_eq!(publish_intent("ok pour la PR"), PublishIntent::Explicit);
        assert_eq!(publish_intent("Valide les changements locaux et ouvre une pull request."), PublishIntent::Explicit);
        assert_eq!(publish_intent("Publication validée, continue."), PublishIntent::Explicit);
        assert_eq!(publish_intent("merge"), PublishIntent::Explicit);
    }

    #[test]
    fn intent_none_for_plain_requests() {
        assert_eq!(publish_intent("améliore la page d'accueil"), PublishIntent::None);
        assert_eq!(publish_intent("go"), PublishIntent::None);
        assert_eq!(publish_intent("le formulaire est invalide"), PublishIntent::None);
    }

    #[test]
    fn grant_validity_parses_rfc3339() {
        let now = chrono::Utc::now();
        let later = (now + chrono::Duration::minutes(5)).to_rfc3339();
        let earlier = (now - chrono::Duration::minutes(5)).to_rfc3339();
        assert!(grant_still_valid(&later, now));
        assert!(!grant_still_valid(&earlier, now));
    }

    #[tokio::test]
    async fn static_gate() {
        assert!(StaticGate(true).allowed("p").await);
        assert!(!StaticGate(false).allowed("p").await);
    }

    #[test]
    fn blocked_payload_is_user_action() {
        let v = remote_write_blocked("create_github_fix", &json!({"title": "Corrige le header"}));
        assert_eq!(v["ok"], false);
        assert_eq!(v["code"], "publish_approval_required");
        assert_eq!(v["needs_user_action"], true);
        assert_eq!(v["kind"], "publish_approval");
        assert!(v["message_fr"].as_str().unwrap().contains("Corrige le header"));
    }

}
