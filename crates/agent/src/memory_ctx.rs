//! Chargement de la mémoire au début d'un run (P3-05) : bloc profil + souvenirs datés.

use crate::AgentChatContext;
use devforge_memory::{rules, MemoryStore, Scope, SearchReq, Tier};

/// Fenêtre du pré-chargement du journal.
const RECALL_DAYS: i64 = 90;
const RECALL_LIMIT: usize = 5;

fn log_prompt() -> bool {
    std::env::var("DEVFORGE_LOG_PROMPT").map(|v| v == "1").unwrap_or(false)
}

/// Portées lisibles par ce fil.
pub fn readable_scopes(ctx: &AgentChatContext) -> Vec<Scope> {
    let mut v = vec![Scope::User];
    if let Some(p) = ctx.project_uuid.as_deref().filter(|p| !p.is_empty()) {
        v.push(Scope::Project(p.to_string()));
    }
    if let Some(a) = ctx.agent_uuid.as_deref().filter(|a| !a.is_empty()) {
        v.push(Scope::Agent(a.to_string()));
    }
    v
}

/// Mots requis pour qu'un souvenir soit jugé pertinent (évite le bruit d'un mot commun).
pub fn recall_min_match(message: &str) -> usize {
    match rules::query_terms(message).len() {
        0..=2 => 1,
        _ => 2,
    }
}

/// `(bloc MÉMOIRE, bloc souvenirs)` ; rien sans utilisateur connu. Les erreurs de base
/// n'empêchent jamais le run (journalisées).
pub async fn load_blocks(
    store: &dyn MemoryStore,
    ctx: &AgentChatContext,
    message: &str,
) -> (Option<String>, Option<String>) {
    let Some(user) = ctx.user_uuid.as_deref().filter(|u| !u.is_empty()) else {
        return (None, None);
    };
    let started = std::time::Instant::now();
    let profile = match store
        .profile(user, ctx.project_uuid.as_deref(), ctx.agent_uuid.as_deref())
        .await
    {
        Ok(items) => Some(rules::profile_block(&items, chrono::Utc::now()).text),
        Err(e) => {
            tracing::warn!(error = %e, "mémoire : profil illisible");
            None
        }
    };
    let recall = if rules::query_terms(message).is_empty() {
        None
    } else {
        let req = SearchReq {
            scopes: readable_scopes(ctx),
            tiers: vec![Tier::Log],
            since: Some(chrono::Utc::now() - chrono::Duration::days(RECALL_DAYS)),
            limit: RECALL_LIMIT,
            min_match: recall_min_match(message),
            ..SearchReq::new(&message.chars().take(500).collect::<String>())
        };
        match store.search(user, &req).await {
            Ok(items) => rules::recall_block(&items),
            Err(e) => {
                tracing::warn!(error = %e, "mémoire : pré-chargement impossible");
                None
            }
        }
    };
    let elapsed_ms = started.elapsed().as_millis() as u64;
    tracing::debug!(elapsed_ms, recall = recall.is_some(), "mémoire chargée");
    if log_prompt() {
        tracing::info!(
            agent = ctx.agent_uuid.as_deref().unwrap_or(""),
            elapsed_ms,
            profile = profile.as_deref().unwrap_or(""),
            recall = recall.as_deref().unwrap_or(""),
            "DEVFORGE_LOG_PROMPT : bloc mémoire"
        );
    }
    (profile, recall)
}
