//! Règles pures de la mémoire (P3-02), partagées par `InMemoryStore` et `PgMemoryStore`.

use crate::{secrets, MemoryItem, Scope, Tier, WriteReq, KINDS};
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use std::collections::HashSet;
use std::time::Duration;

/// Budget du bloc profil injecté à chaque tour.
pub const PROFILE_BUDGET: usize = 1500;
/// Notes injectées au plus (portée de l'agent courant).
pub const MAX_INJECTED_NOTES: usize = 5;
/// Notes vivantes conservées par portée ; au-delà, les plus anciennes sont oubliées.
pub const MAX_LIVE_NOTES: usize = 20;
/// Seuil de quasi-doublon (similarité trigrammes).
pub const SIMILARITY: f32 = 0.85;
pub const DEFAULT_NOTE_TTL: Duration = Duration::from_secs(72 * 3600);
pub const MAX_NOTE_TTL: Duration = Duration::from_secs(7 * 24 * 3600);
/// Confiance d'un fait de profil déduit par un agent (non confirmé).
pub const OBSERVED_PROFILE_CONFIDENCE: f32 = 0.7;
pub const MAX_CONTENT: usize = 2000;

/// `lower(trim(collapse_spaces(content)))`.
pub fn normalize(content: &str) -> String {
    content
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

pub fn valid_key(key: &str) -> bool {
    (3..=120).contains(&key.len())
        && key
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '_' | '.' | '-'))
}

/// Validation commune ; `Err` = message français pour l'agent / l'UI.
pub fn validate(req: &WriteReq, known_secret_values: &[String]) -> Result<(), String> {
    let content = req.content.trim();
    if content.is_empty() {
        return Err("contenu vide".into());
    }
    if content.chars().count() > MAX_CONTENT {
        return Err(format!("contenu trop long (max {MAX_CONTENT} caractères)"));
    }
    if !KINDS.contains(&req.kind.as_str()) {
        return Err(format!(
            "kind inconnu : {} (attendu : {})",
            req.kind,
            KINDS.join(", ")
        ));
    }
    if let Some(key) = &req.key {
        if !valid_key(key) {
            return Err("clé invalide (a-z, 0-9, « _ . - », 3 à 120 caractères)".into());
        }
    }
    if req.user_uuid.trim().is_empty() {
        return Err("utilisateur inconnu : mémoire indisponible".into());
    }
    secrets::check(content, known_secret_values)?;
    if let Some(k) = &req.key {
        secrets::check(k, known_secret_values)?;
    }
    Ok(())
}

/// Confiance effective : un fait de profil « observé » par un agent est marqué déduit.
pub fn effective_confidence(req: &WriteReq) -> f32 {
    let c = req.confidence.clamp(0.0, 1.0);
    if req.tier == Tier::Profile && req.source == "observed" && req.created_by != "user" {
        c.min(OBSERVED_PROFILE_CONFIDENCE)
    } else {
        c
    }
}

/// Expiration : obligatoire pour une note (72 h par défaut, 1 h min., 7 j max.).
pub fn expires_at(req: &WriteReq, now: DateTime<Utc>) -> Option<DateTime<Utc>> {
    match req.tier {
        Tier::Note => {
            let ttl = req
                .expires_in
                .unwrap_or(DEFAULT_NOTE_TTL)
                .clamp(Duration::from_secs(3600), MAX_NOTE_TTL);
            Some(now + ChronoDuration::from_std(ttl).unwrap_or(ChronoDuration::hours(72)))
        }
        _ => None,
    }
}

/// Ce qui existe déjà pour (portée, clé).
#[derive(Debug, Clone)]
pub struct Existing {
    pub uuid: String,
    pub content_norm: String,
    pub source: String,
    pub confidence: f32,
}

#[derive(Debug, Clone, PartialEq)]
pub enum KeyDecision {
    /// Même contenu : rafraîchir `updated_at`, `confidence = max(…)`.
    Refresh { confidence: f32 },
    /// Le plus récent gagne.
    Supersede,
    /// Exception : fait dit par l'utilisateur vs observation incertaine → note « à confirmer ».
    Confirm { note: String },
}

pub fn decide_key(existing: &Existing, req: &WriteReq, confidence: f32) -> KeyDecision {
    let norm = normalize(&req.content);
    if existing.content_norm == norm {
        return KeyDecision::Refresh {
            confidence: existing.confidence.max(confidence),
        };
    }
    if existing.source == "user_said" && req.source == "observed" && confidence < 1.0 {
        return KeyDecision::Confirm {
            note: format!("Possible changement : {} (à confirmer)", req.content.trim()),
        };
    }
    KeyDecision::Supersede
}

/// Requête de la note « à confirmer » créée par l'exception `user_said`.
pub fn confirmation_note(req: &WriteReq, note: String) -> WriteReq {
    WriteReq {
        tier: Tier::Note,
        kind: "context".into(),
        key: None,
        content: note,
        expires_in: Some(MAX_NOTE_TTL),
        ..req.clone()
    }
}

fn trigrams(s: &str) -> HashSet<String> {
    // Même découpage que pg_trgm : mots alphanumériques, préfixés de 2 espaces, suffixés d'1.
    let mut out = HashSet::new();
    for word in s
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
    {
        let padded: Vec<char> = format!("  {} ", word.to_lowercase()).chars().collect();
        for w in padded.windows(3) {
            out.insert(w.iter().collect());
        }
    }
    out
}

/// Similarité trigrammes (équivalent de `similarity()` de pg_trgm).
pub fn similarity(a: &str, b: &str) -> f32 {
    let (ta, tb) = (trigrams(a), trigrams(b));
    if ta.is_empty() && tb.is_empty() {
        return 1.0;
    }
    let inter = ta.intersection(&tb).count() as f32;
    let union = (ta.len() + tb.len()) as f32 - inter;
    if union == 0.0 {
        0.0
    } else {
        inter / union
    }
}

pub fn fmt_date(d: DateTime<Utc>) -> String {
    d.format("%d/%m/%Y").to_string()
}

fn fmt_day(d: DateTime<Utc>) -> String {
    d.format("%d/%m").to_string()
}

fn one_line(s: &str, max: usize) -> String {
    let flat = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= max {
        flat
    } else {
        let cut: String = flat.chars().take(max.saturating_sub(1)).collect();
        format!("{cut}…")
    }
}

fn scope_label(item: &MemoryItem) -> String {
    let base = match item.scope {
        Scope::User => "utilisateur",
        Scope::Project(_) => "projet",
        Scope::Agent(_) => "agent",
    };
    match item.kind.as_str() {
        "infra" => format!("{base}·infra"),
        "preference" => format!("{base}·préférence"),
        _ => base.to_string(),
    }
}

/// Tri d'injection du profil : épinglés, puis utilisateur → projet → agent, puis plus récents.
pub fn sort_profile(items: &mut [MemoryItem]) {
    items.sort_by(|a, b| {
        b.pinned
            .cmp(&a.pinned)
            .then(a.scope.rank().cmp(&b.scope.rank()))
            .then(b.updated_at.cmp(&a.updated_at))
    });
}

/// Résultat de la construction du bloc profil.
#[derive(Debug, Clone, PartialEq)]
pub struct ProfileBlock {
    pub text: String,
    /// Entrées de profil coupées par le budget (avertissement / consolidation dans l'UI).
    pub dropped: usize,
}

pub const MEMORY_HEADER: &str =
    "MÉMOIRE (faits connus, le plus récent fait foi ; dis-le si une info te semble obsolète) :";

pub const MEMORY_RULES: &str = "Avant de demander une info à l'utilisateur, cherche-la avec memory_search. Quand il t'apprend un fait durable ou te corrige, enregistre-le (memory_write) ou oublie l'ancien (memory_forget). Jamais de secret en mémoire.";

/// Bloc `MÉMOIRE` (P3-05) : profil (budget 1 500 car.) puis notes non expirées (max 5).
/// Toujours présent (avec les règles d'usage) pour que l'agent pense à la mémoire.
pub fn profile_block(items: &[MemoryItem], now: DateTime<Utc>) -> ProfileBlock {
    let mut profile: Vec<MemoryItem> = items
        .iter()
        .filter(|i| i.tier == Tier::Profile && i.superseded_by.is_none())
        .cloned()
        .collect();
    sort_profile(&mut profile);
    let mut lines = Vec::new();
    let mut used = 0usize;
    let mut dropped = 0usize;
    for item in &profile {
        let mut line = format!("[{}] {}", scope_label(item), one_line(&item.content, 300));
        if item.kind == "infra" {
            line.push_str(&format!(" (maj {})", fmt_date(item.updated_at)));
        }
        if item.confidence < 1.0 {
            line.push_str(" (déduit, à confirmer si important)");
        }
        let len = line.chars().count() + 1;
        if used + len > PROFILE_BUDGET {
            dropped += 1;
            continue;
        }
        used += len;
        lines.push(line);
    }
    if dropped > 0 {
        tracing::warn!(
            dropped,
            budget = PROFILE_BUDGET,
            "mémoire : profil au-delà du budget, consolidation conseillée"
        );
    }
    let mut notes: Vec<&MemoryItem> = items
        .iter()
        .filter(|i| i.tier == Tier::Note && i.superseded_by.is_none())
        .filter(|i| i.expires_at.map(|e| e > now).unwrap_or(false))
        .collect();
    notes.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    for n in notes.into_iter().take(MAX_INJECTED_NOTES) {
        let exp = n.expires_at.map(fmt_day).unwrap_or_default();
        lines.push(format!(
            "[notes] (expire {exp}) {}",
            one_line(&n.content, 200)
        ));
    }
    let body = if lines.is_empty() {
        "(rien d'enregistré pour l'instant)".to_string()
    } else {
        lines.join("\n")
    };
    ProfileBlock {
        text: format!("{MEMORY_HEADER}\n{body}\n{MEMORY_RULES}"),
        dropped,
    }
}

/// Bloc « Souvenirs possiblement utiles (datés) » (pré-chargement du journal).
pub fn recall_block(items: &[MemoryItem]) -> Option<String> {
    if items.is_empty() {
        return None;
    }
    let lines: Vec<String> = items
        .iter()
        .map(|i| {
            format!(
                "- [{}] {}",
                fmt_date(i.created_at),
                one_line(&i.content, 280)
            )
        })
        .collect();
    Some(format!(
        "Souvenirs possiblement utiles (datés, vérifie avant de t'y fier) :\n{}",
        lines.join("\n")
    ))
}

/// Mots significatifs d'une requête (repli ILIKE et recherche en mémoire).
pub fn query_terms(query: &str) -> Vec<String> {
    const STOP: &[&str] = &[
        "les", "des", "une", "est", "que", "qui", "pour", "dans", "sur", "avec", "pas", "the",
        "and", "quel", "quelle", "mon", "mes", "ton", "tes", "son", "ses", "aux", "par", "ce",
        "cette", "ces", "du", "de", "la", "le", "un", "et", "ou", "à", "en",
    ];
    normalize(query)
        .split(|c: char| !c.is_alphanumeric() && c != '.' && c != '_' && c != '-')
        .map(|w| w.trim_matches(|c: char| c == '.' || c == '-' || c == '_'))
        .filter(|w| w.chars().count() >= 3 && !STOP.contains(w))
        .map(str::to_string)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(scope: Scope, tier: Tier, kind: &str, content: &str, mins_ago: i64) -> MemoryItem {
        let now = Utc::now();
        MemoryItem {
            uuid: uuid::Uuid::new_v4().to_string(),
            scope,
            project_uuid: None,
            tier,
            kind: kind.into(),
            key: None,
            content: content.into(),
            source: "user_said".into(),
            confidence: 1.0,
            pinned: false,
            created_by: "user".into(),
            created_at: now - ChronoDuration::minutes(mins_ago),
            updated_at: now - ChronoDuration::minutes(mins_ago),
            expires_at: if tier == Tier::Note {
                Some(now + ChronoDuration::hours(10))
            } else {
                None
            },
            superseded_by: None,
        }
    }

    #[test]
    fn normalize_collapses_and_lowercases() {
        assert_eq!(normalize("  Le  Worker\tDemeter \n"), "le worker demeter");
    }

    #[test]
    fn similarity_matches_near_duplicates() {
        assert!(
            similarity(
                "préfère des réponses courtes",
                "préfère des réponses courtes."
            ) > SIMILARITY
        );
        assert!(similarity("préfère des réponses courtes", "déploie sur la branche dev") < 0.3);
    }

    #[test]
    fn profile_block_orders_user_project_agent_and_formats_dates() {
        let mut infra = item(
            Scope::User,
            Tier::Profile,
            "infra",
            "Worker Demeter : http://10.1.0.88:8000",
            5,
        );
        infra.updated_at = "2026-10-10T08:00:00Z".parse().unwrap();
        let items = vec![
            item(
                Scope::Agent("a".into()),
                Tier::Profile,
                "fact",
                "Fil dédié au lockfile",
                1,
            ),
            item(
                Scope::Project("p".into()),
                Tier::Profile,
                "decision",
                "Branche dev pour popcornn",
                2,
            ),
            infra,
            item(
                Scope::User,
                Tier::Profile,
                "preference",
                "Réponses courtes",
                30,
            ),
            item(
                Scope::Agent("a".into()),
                Tier::Note,
                "context",
                "Lockfile poussé sur fix/lockfile",
                3,
            ),
        ];
        let b = profile_block(&items, Utc::now()).text;
        let pos = |s: &str| b.find(s).unwrap_or_else(|| panic!("{s} absent de {b}"));
        assert!(b.starts_with(MEMORY_HEADER));
        assert!(pos("[utilisateur·infra] Worker Demeter") < pos("[projet] Branche dev"));
        assert!(pos("[utilisateur·préférence] Réponses courtes") < pos("[projet]"));
        assert!(pos("[projet]") < pos("[agent] Fil dédié"));
        assert!(pos("[agent]") < pos("[notes]"));
        assert!(b.contains("(maj 10/10/2026)"));
        assert!(b.contains(MEMORY_RULES));
    }

    #[test]
    fn profile_block_respects_budget_and_pins_first() {
        let mut items: Vec<MemoryItem> = (0..30)
            .map(|i| {
                item(
                    Scope::User,
                    Tier::Profile,
                    "fact",
                    &format!("fait numéro {i} {}", "x".repeat(80)),
                    i,
                )
            })
            .collect();
        let mut pinned = item(
            Scope::Agent("a".into()),
            Tier::Profile,
            "fact",
            "ÉPINGLÉ",
            999,
        );
        pinned.pinned = true;
        items.push(pinned);
        let b = profile_block(&items, Utc::now());
        let profile_part: String = b
            .text
            .lines()
            .filter(|l| l.starts_with('['))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(profile_part.chars().count() <= PROFILE_BUDGET);
        assert!(b.dropped > 0);
        assert!(b.text.lines().nth(1).unwrap().contains("ÉPINGLÉ"));
    }

    #[test]
    fn expired_notes_are_not_injected_and_capped() {
        let mut items: Vec<MemoryItem> = (0..8)
            .map(|i| {
                item(
                    Scope::Agent("a".into()),
                    Tier::Note,
                    "context",
                    &format!("note {i}"),
                    i,
                )
            })
            .collect();
        items[0].expires_at = Some(Utc::now() - ChronoDuration::minutes(1));
        let b = profile_block(&items, Utc::now()).text;
        assert!(!b.contains("note 0"));
        assert_eq!(b.matches("[notes]").count(), MAX_INJECTED_NOTES);
    }

    #[test]
    fn empty_memory_still_reminds_the_rules() {
        let b = profile_block(&[], Utc::now()).text;
        assert!(b.contains("rien d'enregistré"));
        assert!(b.contains("memory_search"));
    }

    #[test]
    fn note_expiry_is_clamped() {
        let now = Utc::now();
        let mut req = WriteReq::new("u", Scope::User, Tier::Note, "context", "x");
        assert_eq!(expires_at(&req, now), Some(now + ChronoDuration::hours(72)));
        req.expires_in = Some(Duration::from_secs(30 * 24 * 3600));
        assert_eq!(expires_at(&req, now), Some(now + ChronoDuration::days(7)));
        req.tier = Tier::Log;
        assert_eq!(expires_at(&req, now), None);
    }

    #[test]
    fn observed_profile_is_marked_inferred() {
        let mut req = WriteReq::new("u", Scope::User, Tier::Profile, "fact", "x");
        assert_eq!(effective_confidence(&req), OBSERVED_PROFILE_CONFIDENCE);
        req.source = "user_said".into();
        assert_eq!(effective_confidence(&req), 1.0);
    }

    #[test]
    fn validation_rejects_bad_input_and_secrets() {
        let mut req = WriteReq::new(
            "u",
            Scope::User,
            Tier::Log,
            "fact",
            "le token GitHub est ghp_xxx…",
        );
        assert_eq!(validate(&req, &[]).unwrap_err(), secrets::REJECTED_MESSAGE);
        req.content = "ok".into();
        req.kind = "nope".into();
        assert!(validate(&req, &[]).is_err());
        req.kind = "fact".into();
        req.key = Some("Bad Key".into());
        assert!(validate(&req, &[]).is_err());
        req.key = Some("infra.machine.demeter.address".into());
        assert!(validate(&req, &[]).is_ok());
    }

    #[test]
    fn query_terms_drop_stop_words() {
        assert_eq!(
            query_terms("Quelle est l'adresse du worker Demeter ?"),
            vec!["adresse", "worker", "demeter"]
        );
    }
}
