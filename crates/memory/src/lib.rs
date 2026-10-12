//! Mémoire durable partagée des agents (P3) : profil, journal daté, notes courtes.
//!
//! - `rules` : règles pures (normalisation, dédup, notes, budget du profil, blocs de prompt).
//! - `secrets` : filtre de secrets (rien de sensible n'est jamais enregistré).
//! - `store` : `MemoryStore` (trait), `InMemoryStore` (tests) et `PgMemoryStore` (Postgres).

pub mod rules;
pub mod secrets;
pub mod store;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::time::Duration;

pub use store::{migrate, InMemoryStore, MemoryStore, PgMemoryStore};

pub type Result<T> = std::result::Result<T, MemoryError>;

#[derive(Debug)]
pub enum MemoryError {
    Invalid(String),
    NotFound,
    Db(String),
}

impl std::fmt::Display for MemoryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MemoryError::Invalid(m) => write!(f, "{m}"),
            MemoryError::NotFound => write!(f, "souvenir introuvable"),
            MemoryError::Db(m) => write!(f, "base de données : {m}"),
        }
    }
}

impl std::error::Error for MemoryError {}

impl From<sqlx::Error> for MemoryError {
    fn from(e: sqlx::Error) -> Self {
        MemoryError::Db(e.to_string())
    }
}

/// Portée d'un souvenir : tous les agents de l'utilisateur, ceux d'un projet, ou un seul fil.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "scope", content = "id", rename_all = "snake_case")]
pub enum Scope {
    User,
    Project(String),
    Agent(String),
}

impl Scope {
    pub fn name(&self) -> &'static str {
        match self {
            Scope::User => "user",
            Scope::Project(_) => "project",
            Scope::Agent(_) => "agent",
        }
    }

    /// Ordre d'injection : utilisateur → projet → agent.
    pub fn rank(&self) -> u8 {
        match self {
            Scope::User => 0,
            Scope::Project(_) => 1,
            Scope::Agent(_) => 2,
        }
    }

    pub fn project_id(&self) -> Option<&str> {
        match self {
            Scope::Project(p) => Some(p),
            _ => None,
        }
    }

    pub fn agent_id(&self) -> Option<&str> {
        match self {
            Scope::Agent(a) => Some(a),
            _ => None,
        }
    }

    /// Construit une portée depuis les colonnes SQL / les arguments d'outil.
    pub fn from_parts(
        name: &str,
        project_uuid: Option<&str>,
        agent_uuid: Option<&str>,
    ) -> Option<Scope> {
        let nz = |s: Option<&str>| {
            s.map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
        };
        match name {
            "user" => Some(Scope::User),
            "project" => nz(project_uuid).map(Scope::Project),
            "agent" => nz(agent_uuid).map(Scope::Agent),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Tier {
    Profile,
    Log,
    Note,
}

impl Tier {
    pub fn as_str(&self) -> &'static str {
        match self {
            Tier::Profile => "profile",
            Tier::Log => "log",
            Tier::Note => "note",
        }
    }

    pub fn parse(s: &str) -> Option<Tier> {
        match s {
            "profile" => Some(Tier::Profile),
            "log" => Some(Tier::Log),
            "note" => Some(Tier::Note),
            _ => None,
        }
    }
}

pub const KINDS: &[&str] = &[
    "fact",
    "preference",
    "infra",
    "decision",
    "incident",
    "todo",
    "context",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MemoryItem {
    pub uuid: String,
    pub scope: Scope,
    /// Projet de rattachement (portée projet, ou fil d'un projet).
    pub project_uuid: Option<String>,
    pub tier: Tier,
    pub kind: String,
    pub key: Option<String>,
    pub content: String,
    pub source: String,
    pub confidence: f32,
    pub pinned: bool,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
    pub superseded_by: Option<String>,
}

#[derive(Debug, Clone)]
pub struct WriteReq {
    pub user_uuid: String,
    pub scope: Scope,
    /// Projet de rattachement pour la portée `agent` (filtres UI). Ignoré sinon.
    pub project_uuid: Option<String>,
    pub tier: Tier,
    pub kind: String,
    pub key: Option<String>,
    pub content: String,
    pub source: String,
    pub source_ref: Option<String>,
    pub confidence: f32,
    pub expires_in: Option<Duration>,
    pub created_by: String,
}

impl WriteReq {
    /// Requête minimale ; les autres champs ont des valeurs raisonnables.
    pub fn new(user_uuid: &str, scope: Scope, tier: Tier, kind: &str, content: &str) -> Self {
        Self {
            user_uuid: user_uuid.to_string(),
            scope,
            project_uuid: None,
            tier,
            kind: kind.to_string(),
            key: None,
            content: content.to_string(),
            source: "observed".into(),
            source_ref: None,
            confidence: 1.0,
            expires_in: None,
            created_by: "agent".into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WriteOutcome {
    Inserted(String),
    /// Même contenu : on rafraîchit la date (pas de doublon).
    Updated(String),
    /// Le plus récent gagne : l'ancienne entrée pointe vers la nouvelle.
    Superseded {
        old: String,
        new: String,
    },
    /// Fait déclaré par l'utilisateur contredit par une observation incertaine :
    /// rien n'est remplacé, une note « à confirmer » est créée.
    NeedsConfirmation {
        existing: String,
        note: String,
    },
    Rejected(String),
}

impl WriteOutcome {
    pub fn label(&self) -> &'static str {
        match self {
            WriteOutcome::Inserted(_) => "inserted",
            WriteOutcome::Updated(_) => "updated",
            WriteOutcome::Superseded { .. } => "superseded",
            WriteOutcome::NeedsConfirmation { .. } => "needs_confirmation",
            WriteOutcome::Rejected(_) => "rejected",
        }
    }

    pub fn uuid(&self) -> Option<&str> {
        match self {
            WriteOutcome::Inserted(u) | WriteOutcome::Updated(u) => Some(u),
            WriteOutcome::Superseded { new, .. } => Some(new),
            WriteOutcome::NeedsConfirmation { note, .. } => Some(note),
            WriteOutcome::Rejected(_) => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct SearchReq {
    pub query: String,
    /// Portées autorisées (vide = toutes les portées de l'utilisateur).
    pub scopes: Vec<Scope>,
    pub tiers: Vec<Tier>,
    pub kinds: Vec<String>,
    pub since: Option<DateTime<Utc>>,
    /// ≤ 20.
    pub limit: usize,
    pub include_superseded: bool,
    /// Repli sans plein texte : nombre minimal de mots trouvés (0 ou 1 = au moins un).
    pub min_match: usize,
}

impl SearchReq {
    pub fn new(query: &str) -> Self {
        Self {
            query: query.to_string(),
            scopes: vec![],
            tiers: vec![],
            kinds: vec![],
            since: None,
            limit: 8,
            include_superseded: false,
            min_match: 1,
        }
    }
}

#[derive(Debug, Clone)]
pub enum ForgetTarget {
    Uuid(String),
    Key { scope: Scope, key: String },
}

/// Liste pour l'UI « Réglages → Mémoire ».
#[derive(Debug, Clone, Default)]
pub struct ListReq {
    pub scope: Option<String>,
    pub tier: Option<Tier>,
    pub query: Option<String>,
    pub project_uuid: Option<String>,
    pub include_superseded: bool,
    pub limit: usize,
    pub offset: usize,
}

/// Compteurs (observabilité, P3-08).
#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
pub struct MemoryStats {
    pub profile: i64,
    pub log: i64,
    pub note: i64,
    pub superseded: i64,
    pub deleted: i64,
}
