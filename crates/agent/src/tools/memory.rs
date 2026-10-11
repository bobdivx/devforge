//! Outils `memory_search`, `memory_write`, `memory_forget` (P3-03).
//!
//! L'identité (`user_uuid`, `project_uuid`, `caller_agent_uuid`, rôle, kind) est injectée par le
//! serveur (`inject_tool_defaults`) et écrase toute valeur fournie par le modèle.

use async_trait::async_trait;
use devforge_memory::{ForgetTarget, MemoryItem, MemoryStore, Scope, SearchReq, Tier, WriteOutcome, WriteReq};
use devforge_shared::{Result, Tool};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;

/// Arguments d'identité réservés au serveur.
pub const IDENTITY_ARGS: &[&str] =
    &["user_uuid", "project_uuid", "caller_agent_uuid", "caller_agent_role", "caller_agent_kind"];

struct Who {
    user: Option<String>,
    project: Option<String>,
    agent: Option<String>,
    role: String,
    kind: String,
}

fn s(args: &Value, k: &str) -> Option<String> {
    args.get(k).and_then(|v| v.as_str()).map(str::trim).filter(|v| !v.is_empty()).map(str::to_string)
}

fn who(args: &Value) -> Who {
    Who {
        user: s(args, "user_uuid"),
        project: s(args, "project_uuid"),
        agent: s(args, "caller_agent_uuid"),
        role: s(args, "caller_agent_role").unwrap_or_default(),
        kind: s(args, "caller_agent_kind").unwrap_or_default(),
    }
}

fn no_user() -> Value {
    json!({"ok": false, "error": "mémoire indisponible : utilisateur inconnu pour ce fil"})
}

/// Rôles de surveillance : n'écrivent que dans le journal, n'oublient rien.
fn watcher(role: &str) -> bool {
    matches!(role, "runner" | "actions" | "crons")
}

fn scope_of(name: &str, w: &Who) -> std::result::Result<Scope, String> {
    match name {
        "user" => Ok(Scope::User),
        "project" => w
            .project
            .clone()
            .map(Scope::Project)
            .ok_or_else(|| "portée project : aucun projet courant".to_string()),
        "agent" => w
            .agent
            .clone()
            .map(Scope::Agent)
            .ok_or_else(|| "portée agent : aucun fil courant".to_string()),
        other => Err(format!("portée inconnue : {other} (user, project, agent)")),
    }
}

/// Portées lisibles par ce fil : utilisateur + projet courant + fil courant.
fn readable_scopes(w: &Who) -> Vec<Scope> {
    let mut v = vec![Scope::User];
    if let Some(p) = &w.project {
        v.push(Scope::Project(p.clone()));
    }
    if let Some(a) = &w.agent {
        v.push(Scope::Agent(a.clone()));
    }
    v
}

pub fn item_json(i: &MemoryItem) -> Value {
    json!({
        "uuid": i.uuid,
        "scope": i.scope.name(),
        "tier": i.tier.as_str(),
        "kind": i.kind,
        "key": i.key,
        "content": i.content,
        "source": i.source,
        "confidence": i.confidence,
        "updated_at": i.updated_at.to_rfc3339(),
        "expires_at": i.expires_at.map(|e| e.to_rfc3339()),
    })
}

pub struct MemorySearchTool {
    pub store: Arc<dyn MemoryStore>,
}

#[async_trait]
impl Tool for MemorySearchTool {
    fn name(&self) -> &str {
        "memory_search"
    }

    fn description(&self) -> &str {
        "Cherche dans la mémoire durable (profil utilisateur, journal daté, notes). Utilise-le avant de demander à l'utilisateur une info qu'il a pu déjà donner (machines, préférences, décisions passées, incidents déjà vus). Renvoie des entrées datées avec leur source."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "query": { "type": "string", "description": "Mots-clés ou question, ex. 'adresse worker Demeter' ou 'lockfile devforge-esp'" },
                "scope": { "type": "string", "enum": ["user", "project", "agent", "all"], "default": "all" },
                "tier":  { "type": "string", "enum": ["profile", "log", "note", "all"], "default": "all" },
                "kind":  { "type": "string", "enum": devforge_memory::KINDS },
                "since": { "type": "string", "description": "Date ISO 8601 minimale (optionnel)" },
                "limit": { "type": "integer", "minimum": 1, "maximum": 20, "default": 8 }
            },
            "required": ["query"]
        })
    }

    async fn execute(&self, args: Value) -> Result<Value> {
        let w = who(&args);
        let Some(user) = w.user.clone() else { return Ok(no_user()) };
        let query = s(&args, "query").unwrap_or_default();
        let scopes = match s(&args, "scope").as_deref().unwrap_or("all") {
            "all" => readable_scopes(&w),
            name => match scope_of(name, &w) {
                Ok(sc) => vec![sc],
                Err(e) => return Ok(json!({"ok": false, "error": e})),
            },
        };
        let tiers = match s(&args, "tier").as_deref().unwrap_or("all") {
            "all" => vec![],
            t => match Tier::parse(t) {
                Some(t) => vec![t],
                None => return Ok(json!({"ok": false, "error": format!("tier inconnu : {t}")})),
            },
        };
        let since = s(&args, "since").and_then(|d| {
            chrono::DateTime::parse_from_rfc3339(&d)
                .map(|d| d.with_timezone(&chrono::Utc))
                .ok()
                .or_else(|| {
                    chrono::NaiveDate::parse_from_str(&d, "%Y-%m-%d")
                        .ok()
                        .and_then(|n| n.and_hms_opt(0, 0, 0))
                        .map(|n| n.and_utc())
                })
        });
        let req = SearchReq {
            query,
            scopes,
            tiers,
            kinds: s(&args, "kind").into_iter().collect(),
            since,
            limit: args.get("limit").and_then(|v| v.as_u64()).unwrap_or(8).clamp(1, 20) as usize,
            include_superseded: false,
            min_match: 1,
        };
        match self.store.search(&user, &req).await {
            Ok(items) => Ok(json!({
                "ok": true,
                "count": items.len(),
                "items": items.iter().map(item_json).collect::<Vec<_>>(),
            })),
            Err(e) => Ok(json!({"ok": false, "error": e.to_string()})),
        }
    }
}

pub struct MemoryWriteTool {
    pub store: Arc<dyn MemoryStore>,
}

#[async_trait]
impl Tool for MemoryWriteTool {
    fn name(&self) -> &str {
        "memory_write"
    }

    fn description(&self) -> &str {
        "Enregistre un fait durable. À appeler quand l'utilisateur énonce une préférence ou un fait stable, quand l'infra change, quand une décision est prise ou qu'un incident est résolu. Jamais de secret (token, mot de passe, clé). Utilise une clé stable pour les faits qui peuvent changer (le plus récent remplace l'ancien)."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "content": { "type": "string", "maxLength": 2000, "description": "Une phrase autonome et datable, ex. 'Le worker Demeter répond sur http://10.1.0.88:8000.'" },
                "scope":   { "type": "string", "enum": ["user", "project", "agent"] },
                "tier":    { "type": "string", "enum": ["profile", "log", "note"] },
                "kind":    { "type": "string", "enum": devforge_memory::KINDS },
                "key":     { "type": "string", "pattern": "^[a-z0-9_.-]{3,120}$", "description": "Clé canonique optionnelle, ex. 'infra.machine.demeter.address', 'pref.reply.style'" },
                "source":  { "type": "string", "enum": ["user_said", "observed"], "default": "observed" },
                "expires_in_hours": { "type": "integer", "minimum": 1, "maximum": 168, "description": "Obligatoire pour tier=note" }
            },
            "required": ["content", "scope", "tier", "kind"]
        })
    }

    async fn execute(&self, args: Value) -> Result<Value> {
        let w = who(&args);
        let Some(user) = w.user.clone() else { return Ok(no_user()) };
        let scope_name = s(&args, "scope").unwrap_or_else(|| "project".into());
        let tier_name = s(&args, "tier").unwrap_or_else(|| "log".into());
        let Some(tier) = Tier::parse(&tier_name) else {
            return Ok(json!({"ok": false, "error": format!("tier inconnu : {tier_name}")}));
        };
        if watcher(&w.role) && tier != Tier::Log {
            return Ok(json!({"ok": false, "error": format!("le rôle {} n'écrit que dans le journal (tier=log)", w.role)}));
        }
        if w.kind == "subagent" && scope_name == "user" && tier != Tier::Log {
            return Ok(json!({"ok": false, "error": "un sous-agent n'écrit en portée user que dans le journal (tier=log)"}));
        }
        let scope = match scope_of(&scope_name, &w) {
            Ok(sc) => sc,
            Err(e) => return Ok(json!({"ok": false, "error": e})),
        };
        let source = match s(&args, "source").as_deref() {
            Some("user_said") => "user_said",
            _ => "observed",
        };
        let hours = args.get("expires_in_hours").and_then(|v| v.as_u64());
        let req = WriteReq {
            user_uuid: user,
            scope,
            project_uuid: w.project.clone(),
            tier,
            kind: s(&args, "kind").unwrap_or_else(|| "fact".into()),
            key: s(&args, "key"),
            content: s(&args, "content").unwrap_or_default(),
            source: source.into(),
            source_ref: None,
            confidence: 1.0,
            expires_in: hours.map(|h| Duration::from_secs(h.clamp(1, 168) * 3600)),
            created_by: w.agent.as_deref().map(|a| format!("agent:{a}")).unwrap_or_else(|| "agent".into()),
        };
        Ok(match self.store.write(req).await {
            Ok(WriteOutcome::Rejected(e)) => json!({"ok": false, "error": e}),
            Ok(WriteOutcome::Superseded { old, new }) => {
                json!({"ok": true, "outcome": "superseded", "uuid": new, "replaced": old})
            }
            Ok(WriteOutcome::NeedsConfirmation { existing, note }) => json!({
                "ok": true,
                "outcome": "needs_confirmation",
                "uuid": note,
                "existing": existing,
                "hint": "L'utilisateur avait dit autre chose : demande-lui confirmation avant de remplacer (memory_write source=user_said)."
            }),
            Ok(o) => json!({"ok": true, "outcome": o.label(), "uuid": o.uuid()}),
            Err(e) => json!({"ok": false, "error": e.to_string()}),
        })
    }
}

pub struct MemoryForgetTool {
    pub store: Arc<dyn MemoryStore>,
}

#[async_trait]
impl Tool for MemoryForgetTool {
    fn name(&self) -> &str {
        "memory_forget"
    }

    fn description(&self) -> &str {
        "Oublie (ou corrige en oubliant) une entrée de mémoire. À appeler quand l'utilisateur dit qu'une info est fausse ou obsolète, ou demande d'oublier."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "uuid":   { "type": "string", "description": "UUID de l'entrée (via memory_search)" },
                "key":    { "type": "string", "description": "Alternative à uuid : clé canonique" },
                "scope":  { "type": "string", "enum": ["user", "project", "agent"], "description": "Requis avec key" },
                "reason": { "type": "string", "maxLength": 300 }
            },
            "anyOf": [ { "required": ["uuid"] }, { "required": ["key", "scope"] } ]
        })
    }

    async fn execute(&self, args: Value) -> Result<Value> {
        let w = who(&args);
        let Some(user) = w.user.clone() else { return Ok(no_user()) };
        if watcher(&w.role) {
            return Ok(json!({"ok": false, "error": format!("le rôle {} ne peut pas oublier de souvenirs", w.role)}));
        }
        let target = if let Some(uuid) = s(&args, "uuid") {
            // Seulement ce que ce fil peut lire (pas la mémoire d'un autre projet).
            match self.store.get(&user, &uuid).await {
                Ok(Some(item)) if readable_scopes(&w).contains(&item.scope) => ForgetTarget::Uuid(uuid),
                Ok(_) => return Ok(json!({"ok": false, "error": "souvenir introuvable dans ce contexte"})),
                Err(e) => return Ok(json!({"ok": false, "error": e.to_string()})),
            }
        } else if let (Some(key), Some(scope)) = (s(&args, "key"), s(&args, "scope")) {
            match scope_of(&scope, &w) {
                Ok(sc) => ForgetTarget::Key { scope: sc, key },
                Err(e) => return Ok(json!({"ok": false, "error": e})),
            }
        } else {
            return Ok(json!({"ok": false, "error": "uuid, ou key + scope, requis"}));
        };
        Ok(match self.store.forget(&user, target, s(&args, "reason")).await {
            Ok(0) => json!({"ok": false, "error": "rien à oublier (déjà oublié ou introuvable)"}),
            Ok(n) => json!({"ok": true, "forgotten": n}),
            Err(e) => json!({"ok": false, "error": e.to_string()}),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use devforge_memory::InMemoryStore;

    fn ctx_args(extra: Value, role: &str, kind: &str) -> Value {
        let mut v = json!({
            "user_uuid": "u1", "project_uuid": "p1", "caller_agent_uuid": "a1",
            "caller_agent_role": role, "caller_agent_kind": kind
        });
        for (k, val) in extra.as_object().unwrap() {
            v[k] = val.clone();
        }
        v
    }

    fn tools() -> (MemorySearchTool, MemoryWriteTool, MemoryForgetTool) {
        let store: Arc<dyn MemoryStore> = Arc::new(InMemoryStore::new());
        (
            MemorySearchTool { store: store.clone() },
            MemoryWriteTool { store: store.clone() },
            MemoryForgetTool { store },
        )
    }

    #[tokio::test]
    async fn remember_correct_forget_cycle() {
        let (search, write, forget) = tools();
        // « Retiens que je préfère des réponses courtes »
        let r = write
            .execute(ctx_args(json!({"content": "Préfère des réponses courtes.", "scope": "user", "tier": "profile", "kind": "preference", "key": "pref.reply.length", "source": "user_said"}), "coordinator", "required"))
            .await
            .unwrap();
        assert_eq!(r["outcome"], "inserted", "{r}");
        // Visible depuis un autre projet / fil.
        let mut other = ctx_args(json!({"query": "réponses courtes"}), "coordinator", "required");
        other["project_uuid"] = json!("p2");
        other["caller_agent_uuid"] = json!("a2");
        let found = search.execute(other).await.unwrap();
        assert_eq!(found["count"], 1, "{found}");
        // « En fait je préfère des réponses détaillées » → supersede.
        let r = write
            .execute(ctx_args(json!({"content": "Préfère des réponses détaillées.", "scope": "user", "tier": "profile", "kind": "preference", "key": "pref.reply.length", "source": "user_said"}), "coordinator", "required"))
            .await
            .unwrap();
        assert_eq!(r["outcome"], "superseded");
        // « Oublie ça »
        let f = forget
            .execute(ctx_args(json!({"key": "pref.reply.length", "scope": "user"}), "coordinator", "required"))
            .await
            .unwrap();
        assert_eq!(f["forgotten"], 1);
        let found = search.execute(ctx_args(json!({"query": "réponses"}), "coordinator", "required")).await.unwrap();
        assert_eq!(found["count"], 0);
    }

    #[tokio::test]
    async fn secrets_are_refused() {
        let (_, write, _) = tools();
        let r = write
            .execute(ctx_args(json!({"content": "le token GitHub est ghp_xxx…", "scope": "user", "tier": "profile", "kind": "fact"}), "coordinator", "required"))
            .await
            .unwrap();
        assert_eq!(r, json!({"ok": false, "error": "secret détecté — non enregistré"}));
    }

    #[tokio::test]
    async fn role_rules() {
        let (_, write, forget) = tools();
        let profile = json!({"content": "Le runner principal est sur le NAS.", "scope": "project", "tier": "profile", "kind": "infra"});
        let r = write.execute(ctx_args(profile.clone(), "runner", "required")).await.unwrap();
        assert_eq!(r["ok"], false);
        let mut log = profile.clone();
        log["tier"] = json!("log");
        assert_eq!(write.execute(ctx_args(log, "crons", "required")).await.unwrap()["ok"], true);
        let f = forget.execute(ctx_args(json!({"key": "x.y.z", "scope": "user"}), "actions", "required")).await.unwrap();
        assert_eq!(f["ok"], false);
        // Sous-agent : portée user seulement en journal.
        let user_profile = json!({"content": "Préfère le tutoiement.", "scope": "user", "tier": "profile", "kind": "preference"});
        assert_eq!(write.execute(ctx_args(user_profile, "worker", "subagent")).await.unwrap()["ok"], false);
    }

    #[tokio::test]
    async fn observed_profile_is_inferred_and_needs_user() {
        let (search, write, _) = tools();
        write
            .execute(ctx_args(json!({"content": "Le site est en Astro.", "scope": "project", "tier": "profile", "kind": "fact"}), "coordinator", "required"))
            .await
            .unwrap();
        let found = search.execute(ctx_args(json!({"query": "astro"}), "coordinator", "required")).await.unwrap();
        assert!(found["items"][0]["confidence"].as_f64().unwrap() < 1.0);
        let mut anon = ctx_args(json!({"query": "astro"}), "coordinator", "required");
        anon.as_object_mut().unwrap().remove("user_uuid");
        assert_eq!(search.execute(anon).await.unwrap()["ok"], false);
    }

    #[tokio::test]
    async fn cannot_forget_another_projects_memory_by_uuid() {
        let (_, write, forget) = tools();
        let r = write
            .execute(ctx_args(json!({"content": "Décision p1 : branche dev.", "scope": "project", "tier": "log", "kind": "decision"}), "coordinator", "required"))
            .await
            .unwrap();
        let uuid = r["uuid"].as_str().unwrap().to_string();
        let mut other = ctx_args(json!({"uuid": uuid}), "coordinator", "required");
        other["project_uuid"] = json!("p2");
        assert_eq!(forget.execute(other).await.unwrap()["ok"], false);
    }
}
