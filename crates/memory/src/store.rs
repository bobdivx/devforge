//! Stockage de la mémoire : trait `MemoryStore`, implémentation Postgres et implémentation
//! en mémoire (tests unitaires des règles, sans base).

use crate::rules::{self, Existing, KeyDecision};
use crate::{
    ForgetTarget, ListReq, MemoryError, MemoryItem, MemoryStats, Result, Scope, SearchReq, Tier, WriteOutcome,
    WriteReq,
};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use std::sync::Mutex;

pub const MAX_SEARCH: usize = 20;
pub const MAX_LIST: usize = 50;

#[async_trait]
pub trait MemoryStore: Send + Sync {
    async fn write(&self, req: WriteReq) -> Result<WriteOutcome>;
    async fn search(&self, user_uuid: &str, q: &SearchReq) -> Result<Vec<MemoryItem>>;
    async fn forget(&self, user_uuid: &str, target: ForgetTarget, reason: Option<String>) -> Result<usize>;
    /// Profil (portées user → project → agent) + notes vivantes de l'agent courant.
    async fn profile(&self, user_uuid: &str, project_uuid: Option<&str>, agent_uuid: Option<&str>)
        -> Result<Vec<MemoryItem>>;
    async fn purge_expired(&self) -> Result<u64>;

    // --- UI « Réglages → Mémoire » (P3-07) ---
    async fn list(&self, user_uuid: &str, req: &ListReq) -> Result<Vec<MemoryItem>>;
    async fn get(&self, user_uuid: &str, uuid: &str) -> Result<Option<MemoryItem>>;
    /// Versions remplacées par `uuid` (la plus récente d'abord).
    async fn history(&self, user_uuid: &str, uuid: &str) -> Result<Vec<MemoryItem>>;
    /// Correction par l'utilisateur : nouvelle version, l'ancienne pointe vers elle.
    async fn correct(&self, user_uuid: &str, uuid: &str, content: &str) -> Result<WriteOutcome>;
    async fn set_pinned(&self, user_uuid: &str, uuid: &str, pinned: bool) -> Result<bool>;
    /// Purge physique (« Tout effacer »).
    async fn erase_all(&self, user_uuid: &str) -> Result<u64>;
    async fn stats(&self) -> Result<MemoryStats>;
}

fn live_now(item: &MemoryItem, now: DateTime<Utc>) -> bool {
    item.expires_at.map(|e| e > now).unwrap_or(true)
}

fn clamp_limit(n: usize, max: usize) -> usize {
    if n == 0 {
        8.min(max)
    } else {
        n.min(max)
    }
}

/// Requête de correction à partir de l'entrée existante.
fn correction_req(user_uuid: &str, old: &MemoryItem, content: &str) -> WriteReq {
    WriteReq {
        user_uuid: user_uuid.to_string(),
        scope: old.scope.clone(),
        project_uuid: old.project_uuid.clone(),
        tier: old.tier,
        kind: old.kind.clone(),
        key: old.key.clone(),
        content: content.to_string(),
        source: "user_said".into(),
        source_ref: None,
        confidence: 1.0,
        expires_in: old
            .expires_at
            .and_then(|e| (e - Utc::now()).to_std().ok())
            .filter(|_| old.tier == Tier::Note),
        created_by: "user".into(),
    }
}

// ---------------------------------------------------------------------------------------------
// En mémoire (tests)
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct Row {
    user_uuid: String,
    item: MemoryItem,
    content_norm: String,
    deleted: bool,
}

/// Store en mémoire : mêmes règles que Postgres (tests unitaires sans base).
#[derive(Default)]
pub struct InMemoryStore {
    rows: Mutex<Vec<Row>>,
    /// Valeurs d'env « secrètes » simulées.
    pub secret_values: Vec<String>,
}

impl InMemoryStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// Accès direct (tests) : toutes les lignes, supprimées comprises.
    pub fn all(&self) -> Vec<(MemoryItem, bool)> {
        self.rows.lock().unwrap().iter().map(|r| (r.item.clone(), r.deleted)).collect()
    }

    /// Fait vieillir une entrée (tests d'expiration).
    pub fn set_expires_at(&self, uuid: &str, at: DateTime<Utc>) {
        if let Some(r) = self.rows.lock().unwrap().iter_mut().find(|r| r.item.uuid == uuid) {
            r.item.expires_at = Some(at);
        }
    }

    fn same_scope(row: &Row, user: &str, scope: &Scope) -> bool {
        row.user_uuid == user && &row.item.scope == scope
    }

    fn insert_row(rows: &mut Vec<Row>, req: &WriteReq, confidence: f32, now: DateTime<Utc>) -> String {
        let uuid = uuid::Uuid::new_v4().to_string();
        let project_uuid = match &req.scope {
            Scope::Project(p) => Some(p.clone()),
            Scope::Agent(_) => req.project_uuid.clone(),
            Scope::User => None,
        };
        rows.push(Row {
            user_uuid: req.user_uuid.clone(),
            content_norm: rules::normalize(&req.content),
            deleted: false,
            item: MemoryItem {
                uuid: uuid.clone(),
                scope: req.scope.clone(),
                project_uuid,
                tier: req.tier,
                kind: req.kind.clone(),
                key: req.key.clone(),
                content: req.content.trim().to_string(),
                source: req.source.clone(),
                confidence,
                pinned: false,
                created_by: req.created_by.clone(),
                created_at: now,
                updated_at: now,
                expires_at: rules::expires_at(req, now),
                superseded_by: None,
            },
        });
        if req.tier == Tier::Note {
            let mut notes: Vec<usize> = rows
                .iter()
                .enumerate()
                .filter(|(_, r)| {
                    Self::same_scope(r, &req.user_uuid, &req.scope)
                        && r.item.tier == Tier::Note
                        && !r.deleted
                        && r.item.superseded_by.is_none()
                })
                .map(|(i, _)| i)
                .collect();
            notes.sort_by(|a, b| rows[*b].item.updated_at.cmp(&rows[*a].item.updated_at).then(b.cmp(a)));
            for i in notes.into_iter().skip(rules::MAX_LIVE_NOTES) {
                rows[i].deleted = true;
            }
        }
        uuid
    }

    fn write_sync(&self, req: WriteReq) -> WriteOutcome {
        if let Err(e) = rules::validate(&req, &self.secret_values) {
            return WriteOutcome::Rejected(e);
        }
        let confidence = rules::effective_confidence(&req);
        let now = Utc::now();
        let mut rows = self.rows.lock().unwrap();
        if let Some(key) = &req.key {
            let found = rows.iter().position(|r| {
                Self::same_scope(r, &req.user_uuid, &req.scope)
                    && r.item.key.as_deref() == Some(key)
                    && !r.deleted
                    && r.item.superseded_by.is_none()
            });
            if let Some(i) = found {
                let ex = Existing {
                    uuid: rows[i].item.uuid.clone(),
                    content_norm: rows[i].content_norm.clone(),
                    source: rows[i].item.source.clone(),
                    confidence: rows[i].item.confidence,
                };
                return match rules::decide_key(&ex, &req, confidence) {
                    KeyDecision::Refresh { confidence } => {
                        rows[i].item.updated_at = now;
                        rows[i].item.confidence = confidence;
                        if req.tier == Tier::Note {
                            rows[i].item.expires_at = rules::expires_at(&req, now);
                        }
                        WriteOutcome::Updated(ex.uuid)
                    }
                    KeyDecision::Supersede => {
                        let new = Self::insert_row(&mut rows, &req, confidence, now);
                        if let Some(old) = rows.iter_mut().find(|r| r.item.uuid == ex.uuid) {
                            old.item.superseded_by = Some(new.clone());
                            old.item.updated_at = now;
                        }
                        WriteOutcome::Superseded { old: ex.uuid, new }
                    }
                    KeyDecision::Confirm { note } => {
                        let note_req = rules::confirmation_note(&req, note);
                        let c = rules::effective_confidence(&note_req);
                        let note = Self::insert_row(&mut rows, &note_req, c, now);
                        WriteOutcome::NeedsConfirmation { existing: ex.uuid, note }
                    }
                };
            }
        } else {
            let norm = rules::normalize(&req.content);
            let dup = rows.iter_mut().find(|r| {
                Self::same_scope(r, &req.user_uuid, &req.scope)
                    && r.item.tier == req.tier
                    && !r.deleted
                    && r.item.superseded_by.is_none()
                    && live_now(&r.item, now)
                    && rules::similarity(&r.content_norm, &norm) >= rules::SIMILARITY
            });
            if let Some(r) = dup {
                r.item.updated_at = now;
                r.item.confidence = r.item.confidence.max(confidence);
                return WriteOutcome::Updated(r.item.uuid.clone());
            }
        }
        WriteOutcome::Inserted(Self::insert_row(&mut rows, &req, confidence, now))
    }
}

fn scope_allowed(scopes: &[Scope], s: &Scope) -> bool {
    scopes.is_empty() || scopes.contains(s)
}

#[async_trait]
impl MemoryStore for InMemoryStore {
    async fn write(&self, req: WriteReq) -> Result<WriteOutcome> {
        Ok(self.write_sync(req))
    }

    async fn search(&self, user_uuid: &str, q: &SearchReq) -> Result<Vec<MemoryItem>> {
        let now = Utc::now();
        let terms = rules::query_terms(&q.query);
        let min = q_min_match(q, terms.len());
        let rows = self.rows.lock().unwrap();
        let mut hits: Vec<(usize, MemoryItem)> = rows
            .iter()
            .filter(|r| r.user_uuid == user_uuid && !r.deleted)
            .filter(|r| q.include_superseded || r.item.superseded_by.is_none())
            .filter(|r| live_now(&r.item, now))
            .filter(|r| scope_allowed(&q.scopes, &r.item.scope))
            .filter(|r| q.tiers.is_empty() || q.tiers.contains(&r.item.tier))
            .filter(|r| q.kinds.is_empty() || q.kinds.contains(&r.item.kind))
            .filter(|r| q.since.map(|s| r.item.created_at >= s).unwrap_or(true))
            .map(|r| {
                let hay = format!("{} {}", r.item.key.as_deref().unwrap_or(""), r.content_norm);
                (terms.iter().filter(|t| hay.contains(t.as_str())).count(), r.item.clone())
            })
            .filter(|(score, _)| terms.is_empty() || *score >= min)
            .collect();
        hits.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.updated_at.cmp(&a.1.updated_at)));
        Ok(hits.into_iter().take(clamp_limit(q.limit, MAX_SEARCH)).map(|(_, i)| i).collect())
    }

    async fn forget(&self, user_uuid: &str, target: ForgetTarget, _reason: Option<String>) -> Result<usize> {
        let mut rows = self.rows.lock().unwrap();
        let mut n = 0;
        for r in rows.iter_mut().filter(|r| r.user_uuid == user_uuid && !r.deleted) {
            let hit = match &target {
                ForgetTarget::Uuid(u) => &r.item.uuid == u,
                ForgetTarget::Key { scope, key } => {
                    &r.item.scope == scope && r.item.key.as_deref() == Some(key) && r.item.superseded_by.is_none()
                }
            };
            if hit {
                r.deleted = true;
                n += 1;
            }
        }
        Ok(n)
    }

    async fn profile(
        &self,
        user_uuid: &str,
        project_uuid: Option<&str>,
        agent_uuid: Option<&str>,
    ) -> Result<Vec<MemoryItem>> {
        let now = Utc::now();
        let rows = self.rows.lock().unwrap();
        Ok(rows
            .iter()
            .filter(|r| r.user_uuid == user_uuid && !r.deleted && r.item.superseded_by.is_none())
            .filter(|r| match (&r.item.tier, &r.item.scope) {
                (Tier::Profile, Scope::User) => true,
                (Tier::Profile, Scope::Project(p)) => Some(p.as_str()) == project_uuid,
                (Tier::Profile, Scope::Agent(a)) => Some(a.as_str()) == agent_uuid,
                (Tier::Note, Scope::Agent(a)) => Some(a.as_str()) == agent_uuid && live_now(&r.item, now),
                _ => false,
            })
            .map(|r| r.item.clone())
            .collect())
    }

    async fn purge_expired(&self) -> Result<u64> {
        let now = Utc::now();
        let mut rows = self.rows.lock().unwrap();
        let mut n = 0;
        for r in rows.iter_mut().filter(|r| !r.deleted && !live_now(&r.item, now)) {
            r.deleted = true;
            n += 1;
        }
        Ok(n)
    }

    async fn list(&self, user_uuid: &str, req: &ListReq) -> Result<Vec<MemoryItem>> {
        let now = Utc::now();
        let q = req.query.as_deref().map(rules::normalize).filter(|s| !s.is_empty());
        let rows = self.rows.lock().unwrap();
        let mut out: Vec<MemoryItem> = rows
            .iter()
            .filter(|r| r.user_uuid == user_uuid && !r.deleted && live_now(&r.item, now))
            .filter(|r| req.include_superseded || r.item.superseded_by.is_none())
            .filter(|r| req.scope.as_deref().map(|s| r.item.scope.name() == s).unwrap_or(true))
            .filter(|r| req.tier.map(|t| r.item.tier == t).unwrap_or(true))
            .filter(|r| req.project_uuid.as_deref().map(|p| r.item.project_uuid.as_deref() == Some(p)).unwrap_or(true))
            .filter(|r| q.as_deref().map(|q| r.content_norm.contains(q)).unwrap_or(true))
            .map(|r| r.item.clone())
            .collect();
        out.sort_by(|a, b| b.pinned.cmp(&a.pinned).then(b.updated_at.cmp(&a.updated_at)));
        Ok(out.into_iter().skip(req.offset).take(clamp_limit(req.limit, MAX_LIST)).collect())
    }

    async fn get(&self, user_uuid: &str, uuid: &str) -> Result<Option<MemoryItem>> {
        let rows = self.rows.lock().unwrap();
        Ok(rows
            .iter()
            .find(|r| r.user_uuid == user_uuid && !r.deleted && r.item.uuid == uuid)
            .map(|r| r.item.clone()))
    }

    async fn history(&self, user_uuid: &str, uuid: &str) -> Result<Vec<MemoryItem>> {
        let rows = self.rows.lock().unwrap();
        let mut out = Vec::new();
        let mut cur = uuid.to_string();
        for _ in 0..20 {
            match rows
                .iter()
                .find(|r| r.user_uuid == user_uuid && r.item.superseded_by.as_deref() == Some(cur.as_str()))
            {
                Some(r) => {
                    cur = r.item.uuid.clone();
                    out.push(r.item.clone());
                }
                None => break,
            }
        }
        Ok(out)
    }

    async fn correct(&self, user_uuid: &str, uuid: &str, content: &str) -> Result<WriteOutcome> {
        let old = self.get(user_uuid, uuid).await?.ok_or(MemoryError::NotFound)?;
        let req = correction_req(user_uuid, &old, content);
        if let Err(e) = rules::validate(&req, &self.secret_values) {
            return Ok(WriteOutcome::Rejected(e));
        }
        if rules::normalize(content) == rules::normalize(&old.content) {
            return Ok(WriteOutcome::Updated(old.uuid));
        }
        let now = Utc::now();
        let mut rows = self.rows.lock().unwrap();
        let new = Self::insert_row(&mut rows, &req, 1.0, now);
        if let Some(r) = rows.iter_mut().find(|r| r.item.uuid == old.uuid) {
            r.item.superseded_by = Some(new.clone());
            r.item.updated_at = now;
        }
        if let Some(r) = rows.iter_mut().find(|r| r.item.uuid == new) {
            r.item.pinned = old.pinned;
        }
        Ok(WriteOutcome::Superseded { old: old.uuid, new })
    }

    async fn set_pinned(&self, user_uuid: &str, uuid: &str, pinned: bool) -> Result<bool> {
        let mut rows = self.rows.lock().unwrap();
        match rows.iter_mut().find(|r| r.user_uuid == user_uuid && !r.deleted && r.item.uuid == uuid) {
            Some(r) => {
                r.item.pinned = pinned;
                Ok(true)
            }
            None => Ok(false),
        }
    }

    async fn erase_all(&self, user_uuid: &str) -> Result<u64> {
        let mut rows = self.rows.lock().unwrap();
        let before = rows.len();
        rows.retain(|r| r.user_uuid != user_uuid);
        Ok((before - rows.len()) as u64)
    }

    async fn stats(&self) -> Result<MemoryStats> {
        let rows = self.rows.lock().unwrap();
        let mut s = MemoryStats::default();
        for r in rows.iter() {
            if r.deleted {
                s.deleted += 1;
            } else if r.item.superseded_by.is_some() {
                s.superseded += 1;
            } else {
                match r.item.tier {
                    Tier::Profile => s.profile += 1,
                    Tier::Log => s.log += 1,
                    Tier::Note => s.note += 1,
                }
            }
        }
        Ok(s)
    }
}

/// Nombre minimal de mots de la requête qui doivent correspondre (repli sans FTS).
fn q_min_match(q: &SearchReq, terms: usize) -> usize {
    if q.min_match == 0 {
        1
    } else {
        q.min_match.min(terms.max(1))
    }
}

// ---------------------------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------------------------

/// Migration idempotente (P3-01). `pg_trgm` est facultatif (droits) : sans lui, la dédup sans
/// clé se fait par égalité normalisée.
pub async fn migrate(pool: &PgPool) -> std::result::Result<(), sqlx::Error> {
    if let Err(e) = sqlx::query("CREATE EXTENSION IF NOT EXISTS pg_trgm").execute(pool).await {
        tracing::info!(error = %e, "pg_trgm indisponible : dédup mémoire par égalité normalisée");
    }
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS agent_memories (
            id            BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            uuid          TEXT NOT NULL UNIQUE,
            user_uuid     TEXT NOT NULL,
            scope         TEXT NOT NULL CHECK (scope IN ('user','project','agent')),
            project_uuid  TEXT NULL,
            agent_uuid    TEXT NULL,
            tier          TEXT NOT NULL CHECK (tier IN ('profile','log','note')),
            kind          TEXT NOT NULL CHECK (kind IN ('fact','preference','infra','decision','incident','todo','context')),
            key           TEXT NULL,
            content       TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
            content_norm  TEXT NOT NULL,
            source        TEXT NOT NULL DEFAULT 'observed',
            source_ref    TEXT NULL,
            confidence    REAL NOT NULL DEFAULT 1.0,
            pinned        BOOLEAN NOT NULL DEFAULT FALSE,
            created_by    TEXT NOT NULL DEFAULT 'agent',
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            expires_at    TIMESTAMPTZ NULL,
            superseded_by TEXT NULL REFERENCES agent_memories(uuid) DEFERRABLE INITIALLY DEFERRED,
            deleted_at    TIMESTAMPTZ NULL,
            tsv           tsvector GENERATED ALWAYS AS (
                            setweight(to_tsvector('simple', coalesce(key,'')), 'A') ||
                            setweight(to_tsvector('french', content), 'B')
                          ) STORED,
            CHECK ((scope = 'user') OR (scope = 'project' AND project_uuid IS NOT NULL) OR (scope = 'agent' AND agent_uuid IS NOT NULL)),
            CHECK (tier <> 'note' OR expires_at IS NOT NULL)
        )
        "#,
    )
    .execute(pool)
    .await?;
    for ddl in [
        "CREATE INDEX IF NOT EXISTS idx_mem_profile ON agent_memories (user_uuid, scope, project_uuid, agent_uuid) WHERE tier = 'profile' AND deleted_at IS NULL AND superseded_by IS NULL",
        "CREATE INDEX IF NOT EXISTS idx_mem_tsv ON agent_memories USING GIN (tsv)",
        "CREATE INDEX IF NOT EXISTS idx_mem_log_time ON agent_memories (user_uuid, project_uuid, created_at DESC) WHERE tier = 'log' AND deleted_at IS NULL",
        "CREATE INDEX IF NOT EXISTS idx_mem_expiry ON agent_memories (expires_at) WHERE expires_at IS NOT NULL AND deleted_at IS NULL",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_mem_live_key ON agent_memories (user_uuid, scope, coalesce(project_uuid,''), coalesce(agent_uuid,''), key) WHERE key IS NOT NULL AND deleted_at IS NULL AND superseded_by IS NULL",
        "CREATE INDEX IF NOT EXISTS idx_mem_note_agent ON agent_memories (agent_uuid, updated_at DESC) WHERE tier = 'note' AND deleted_at IS NULL AND superseded_by IS NULL",
    ] {
        sqlx::query(ddl).execute(pool).await?;
    }
    if let Err(e) = sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_mem_trgm ON agent_memories USING GIN (content_norm gin_trgm_ops)",
    )
    .execute(pool)
    .await
    {
        tracing::debug!(error = %e, "index trigrammes mémoire non créé");
    }
    Ok(())
}

const COLS: &str = "uuid, scope, project_uuid, agent_uuid, tier, kind, key, content, source, confidence, pinned, created_by, created_at, updated_at, expires_at, superseded_by";

#[derive(sqlx::FromRow)]
struct PgRow {
    uuid: String,
    scope: String,
    project_uuid: Option<String>,
    agent_uuid: Option<String>,
    tier: String,
    kind: String,
    key: Option<String>,
    content: String,
    source: String,
    confidence: f32,
    pinned: bool,
    created_by: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    expires_at: Option<DateTime<Utc>>,
    superseded_by: Option<String>,
}

impl PgRow {
    fn into_item(self) -> Option<MemoryItem> {
        Some(MemoryItem {
            scope: Scope::from_parts(&self.scope, self.project_uuid.as_deref(), self.agent_uuid.as_deref())?,
            tier: Tier::parse(&self.tier)?,
            uuid: self.uuid,
            project_uuid: self.project_uuid,
            kind: self.kind,
            key: self.key,
            content: self.content,
            source: self.source,
            confidence: self.confidence,
            pinned: self.pinned,
            created_by: self.created_by,
            created_at: self.created_at,
            updated_at: self.updated_at,
            expires_at: self.expires_at,
            superseded_by: self.superseded_by,
        })
    }
}

fn items(rows: Vec<PgRow>) -> Vec<MemoryItem> {
    rows.into_iter().filter_map(PgRow::into_item).collect()
}

/// Colonnes (project_uuid, agent_uuid) stockées pour une requête.
fn scope_cols(req: &WriteReq) -> (Option<String>, Option<String>) {
    match &req.scope {
        Scope::User => (None, None),
        Scope::Project(p) => (Some(p.clone()), None),
        Scope::Agent(a) => (req.project_uuid.clone().filter(|p| !p.is_empty()), Some(a.clone())),
    }
}

pub struct PgMemoryStore {
    pool: PgPool,
    trgm: tokio::sync::OnceCell<bool>,
}

impl PgMemoryStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool, trgm: tokio::sync::OnceCell::new() }
    }

    /// Force l'absence de pg_trgm (tests du repli).
    pub fn without_trgm(pool: PgPool) -> Self {
        let trgm = tokio::sync::OnceCell::new();
        let _ = trgm.set(false);
        Self { pool, trgm }
    }

    async fn has_trgm(&self) -> bool {
        *self
            .trgm
            .get_or_init(|| async {
                sqlx::query_scalar::<_, bool>("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm')")
                    .fetch_one(&self.pool)
                    .await
                    .unwrap_or(false)
            })
            .await
    }

    /// Valeurs exactes des variables d'env marquées secrètes du projet concerné.
    async fn secret_values(&self, req: &WriteReq) -> Vec<String> {
        let project = req.scope.project_id().map(str::to_string).or_else(|| req.project_uuid.clone());
        let Some(project) = project.filter(|p| !p.is_empty()) else { return vec![] };
        sqlx::query_scalar::<_, String>(
            "SELECT value FROM project_env_vars WHERE project_uuid = $1 AND secret <> 0",
        )
        .bind(&project)
        .fetch_all(&self.pool)
        .await
        .unwrap_or_default()
    }

    async fn insert(
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        uuid: &str,
        req: &WriteReq,
        confidence: f32,
        now: DateTime<Utc>,
    ) -> std::result::Result<(), sqlx::Error> {
        let (project, agent) = scope_cols(req);
        sqlx::query(
            r#"INSERT INTO agent_memories
                 (uuid, user_uuid, scope, project_uuid, agent_uuid, tier, kind, key, content, content_norm,
                  source, source_ref, confidence, created_by, created_at, updated_at, expires_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15,$16)"#,
        )
        .bind(uuid)
        .bind(&req.user_uuid)
        .bind(req.scope.name())
        .bind(&project)
        .bind(&agent)
        .bind(req.tier.as_str())
        .bind(&req.kind)
        .bind(&req.key)
        .bind(req.content.trim())
        .bind(rules::normalize(&req.content))
        .bind(&req.source)
        .bind(&req.source_ref)
        .bind(confidence)
        .bind(&req.created_by)
        .bind(now)
        .bind(rules::expires_at(req, now))
        .execute(&mut **tx)
        .await?;
        if req.tier == Tier::Note {
            sqlx::query(
                r#"UPDATE agent_memories SET deleted_at = now() WHERE uuid IN (
                     SELECT uuid FROM agent_memories
                     WHERE user_uuid = $1 AND scope = $2 AND coalesce(project_uuid,'') = $3 AND coalesce(agent_uuid,'') = $4
                       AND tier = 'note' AND deleted_at IS NULL AND superseded_by IS NULL
                     ORDER BY updated_at DESC, id DESC OFFSET $5)"#,
            )
            .bind(&req.user_uuid)
            .bind(req.scope.name())
            .bind(project.unwrap_or_default())
            .bind(agent.unwrap_or_default())
            .bind(rules::MAX_LIVE_NOTES as i64)
            .execute(&mut **tx)
            .await?;
        }
        Ok(())
    }

    async fn write_inner(&self, req: &WriteReq) -> Result<WriteOutcome> {
        let confidence = rules::effective_confidence(req);
        let now = Utc::now();
        let (project, agent) = scope_cols(req);
        let mut tx = self.pool.begin().await?;
        if let Some(key) = &req.key {
            let ex: Option<(String, String, String, f32)> = sqlx::query_as(
                r#"SELECT uuid, content_norm, source, confidence FROM agent_memories
                   WHERE user_uuid = $1 AND scope = $2 AND coalesce(project_uuid,'') = $3 AND coalesce(agent_uuid,'') = $4
                     AND key = $5 AND deleted_at IS NULL AND superseded_by IS NULL
                   FOR UPDATE"#,
            )
            .bind(&req.user_uuid)
            .bind(req.scope.name())
            .bind(project.clone().unwrap_or_default())
            .bind(agent.clone().unwrap_or_default())
            .bind(key)
            .fetch_optional(&mut *tx)
            .await?;
            if let Some((uuid, content_norm, source, conf)) = ex {
                let existing = Existing { uuid: uuid.clone(), content_norm, source, confidence: conf };
                let out = match rules::decide_key(&existing, req, confidence) {
                    KeyDecision::Refresh { confidence } => {
                        sqlx::query(
                            "UPDATE agent_memories SET updated_at = $2, confidence = $3, expires_at = COALESCE($4, expires_at) WHERE uuid = $1",
                        )
                        .bind(&uuid)
                        .bind(now)
                        .bind(confidence)
                        .bind(rules::expires_at(req, now))
                        .execute(&mut *tx)
                        .await?;
                        WriteOutcome::Updated(uuid)
                    }
                    KeyDecision::Supersede => {
                        let new = uuid::Uuid::new_v4().to_string();
                        // L'ancienne sort de l'index unique avant l'insertion (FK différée).
                        sqlx::query("UPDATE agent_memories SET superseded_by = $2, updated_at = $3 WHERE uuid = $1")
                            .bind(&uuid)
                            .bind(&new)
                            .bind(now)
                            .execute(&mut *tx)
                            .await?;
                        Self::insert(&mut tx, &new, req, confidence, now).await?;
                        WriteOutcome::Superseded { old: uuid, new }
                    }
                    KeyDecision::Confirm { note } => {
                        let note_req = rules::confirmation_note(req, note);
                        let c = rules::effective_confidence(&note_req);
                        let new = uuid::Uuid::new_v4().to_string();
                        Self::insert(&mut tx, &new, &note_req, c, now).await?;
                        WriteOutcome::NeedsConfirmation { existing: uuid, note: new }
                    }
                };
                tx.commit().await?;
                return Ok(out);
            }
        } else {
            let norm = rules::normalize(&req.content);
            let base = r#"SELECT uuid FROM agent_memories
                   WHERE user_uuid = $1 AND scope = $2 AND coalesce(project_uuid,'') = $3 AND coalesce(agent_uuid,'') = $4
                     AND tier = $5 AND deleted_at IS NULL AND superseded_by IS NULL
                     AND (expires_at IS NULL OR expires_at > now())"#;
            let sql = if self.has_trgm().await {
                format!("{base} AND similarity(content_norm, $6) >= {} ORDER BY similarity(content_norm, $6) DESC LIMIT 1", rules::SIMILARITY)
            } else {
                format!("{base} AND content_norm = $6 LIMIT 1")
            };
            let dup: Option<String> = sqlx::query_scalar(&sql)
                .bind(&req.user_uuid)
                .bind(req.scope.name())
                .bind(project.clone().unwrap_or_default())
                .bind(agent.clone().unwrap_or_default())
                .bind(req.tier.as_str())
                .bind(&norm)
                .fetch_optional(&mut *tx)
                .await?;
            if let Some(uuid) = dup {
                sqlx::query(
                    "UPDATE agent_memories SET updated_at = $2, confidence = GREATEST(confidence, $3) WHERE uuid = $1",
                )
                .bind(&uuid)
                .bind(now)
                .bind(confidence)
                .execute(&mut *tx)
                .await?;
                tx.commit().await?;
                return Ok(WriteOutcome::Updated(uuid));
            }
        }
        let new = uuid::Uuid::new_v4().to_string();
        Self::insert(&mut tx, &new, req, confidence, now).await?;
        tx.commit().await?;
        Ok(WriteOutcome::Inserted(new))
    }
}

fn scope_filter_params(scopes: &[Scope]) -> (bool, bool, Vec<String>, Vec<String>) {
    let all = scopes.is_empty();
    let user = scopes.iter().any(|s| matches!(s, Scope::User));
    let projects = scopes.iter().filter_map(|s| s.project_id().map(str::to_string)).collect();
    let agents = scopes.iter().filter_map(|s| s.agent_id().map(str::to_string)).collect();
    (all, user, projects, agents)
}

const SEARCH_WHERE: &str = r#"user_uuid = $1 AND deleted_at IS NULL
      AND ($2 OR (scope = 'user' AND $3) OR (scope = 'project' AND project_uuid = ANY($4)) OR (scope = 'agent' AND agent_uuid = ANY($5)))
      AND (cardinality($6::text[]) = 0 OR tier = ANY($6))
      AND (cardinality($7::text[]) = 0 OR kind = ANY($7))
      AND ($8::timestamptz IS NULL OR created_at >= $8)
      AND ($9 OR superseded_by IS NULL)
      AND (expires_at IS NULL OR expires_at > now())"#;

#[async_trait]
impl MemoryStore for PgMemoryStore {
    async fn write(&self, req: WriteReq) -> Result<WriteOutcome> {
        let known = self.secret_values(&req).await;
        if let Err(e) = rules::validate(&req, &known) {
            return Ok(WriteOutcome::Rejected(e));
        }
        match self.write_inner(&req).await {
            // Course sur l'index unique (même clé écrite en parallèle) : on rejoue une fois.
            Err(MemoryError::Db(e)) if e.contains("uq_mem_live_key") => self.write_inner(&req).await,
            other => other,
        }
    }

    async fn search(&self, user_uuid: &str, q: &SearchReq) -> Result<Vec<MemoryItem>> {
        let (all, user, projects, agents) = scope_filter_params(&q.scopes);
        let tiers: Vec<String> = q.tiers.iter().map(|t| t.as_str().to_string()).collect();
        let limit = clamp_limit(q.limit, MAX_SEARCH) as i64;
        let query = q.query.trim();
        if !query.is_empty() {
            let sql = format!(
                r#"SELECT {COLS} FROM agent_memories,
                     LATERAL (SELECT websearch_to_tsquery('french', $10) || websearch_to_tsquery('simple', $10) AS tq) q
                   WHERE {SEARCH_WHERE} AND tsv @@ q.tq
                   ORDER BY ts_rank_cd(tsv, q.tq) DESC, updated_at DESC LIMIT $11"#
            );
            let rows: Vec<PgRow> = sqlx::query_as(&sql)
                .bind(user_uuid)
                .bind(all)
                .bind(user)
                .bind(&projects)
                .bind(&agents)
                .bind(&tiers)
                .bind(&q.kinds)
                .bind(q.since)
                .bind(q.include_superseded)
                .bind(query)
                .bind(limit)
                .fetch_all(&self.pool)
                .await?;
            if !rows.is_empty() {
                return Ok(items(rows));
            }
        }
        // Repli : mots-clés en ILIKE, classés par nombre de mots trouvés.
        let terms = rules::query_terms(query);
        if !query.is_empty() && terms.is_empty() {
            return Ok(vec![]);
        }
        let patterns: Vec<String> = terms
            .iter()
            .map(|t| format!("%{}%", t.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")))
            .collect();
        let min = q_min_match(q, terms.len()) as i64;
        let sql = format!(
            r#"SELECT {COLS} FROM (
                 SELECT *, (SELECT count(*) FROM unnest($10::text[]) p WHERE content_norm ILIKE p OR coalesce(key,'') ILIKE p) AS hits
                 FROM agent_memories WHERE {SEARCH_WHERE}
               ) m
               WHERE cardinality($10::text[]) = 0 OR hits >= $12
               ORDER BY hits DESC, updated_at DESC LIMIT $11"#
        );
        let rows: Vec<PgRow> = sqlx::query_as(&sql)
            .bind(user_uuid)
            .bind(all)
            .bind(user)
            .bind(&projects)
            .bind(&agents)
            .bind(&tiers)
            .bind(&q.kinds)
            .bind(q.since)
            .bind(q.include_superseded)
            .bind(&patterns)
            .bind(limit)
            .bind(min)
            .fetch_all(&self.pool)
            .await?;
        Ok(items(rows))
    }

    async fn forget(&self, user_uuid: &str, target: ForgetTarget, reason: Option<String>) -> Result<usize> {
        let res = match &target {
            ForgetTarget::Uuid(u) => {
                sqlx::query(
                    "UPDATE agent_memories SET deleted_at = now() WHERE user_uuid = $1 AND uuid = $2 AND deleted_at IS NULL",
                )
                .bind(user_uuid)
                .bind(u)
                .execute(&self.pool)
                .await?
            }
            ForgetTarget::Key { scope, key } => {
                sqlx::query(
                    r#"UPDATE agent_memories SET deleted_at = now()
                       WHERE user_uuid = $1 AND scope = $2 AND key = $3 AND deleted_at IS NULL AND superseded_by IS NULL
                         AND ($2 = 'user' OR ($2 = 'project' AND project_uuid = $4) OR ($2 = 'agent' AND agent_uuid = $5))"#,
                )
                .bind(user_uuid)
                .bind(scope.name())
                .bind(key)
                .bind(scope.project_id())
                .bind(scope.agent_id())
                .execute(&self.pool)
                .await?
            }
        };
        let n = res.rows_affected() as usize;
        tracing::info!(user_uuid, forgotten = n, reason = reason.as_deref().unwrap_or(""), "mémoire : oubli");
        Ok(n)
    }

    async fn profile(
        &self,
        user_uuid: &str,
        project_uuid: Option<&str>,
        agent_uuid: Option<&str>,
    ) -> Result<Vec<MemoryItem>> {
        let sql = format!(
            r#"SELECT {COLS} FROM agent_memories
               WHERE user_uuid = $1 AND deleted_at IS NULL AND superseded_by IS NULL
                 AND ((tier = 'profile' AND (scope = 'user' OR (scope = 'project' AND project_uuid = $2) OR (scope = 'agent' AND agent_uuid = $3)))
                   OR (tier = 'note' AND scope = 'agent' AND agent_uuid = $3 AND expires_at > now()))
               ORDER BY pinned DESC, updated_at DESC LIMIT 200"#
        );
        let rows: Vec<PgRow> = sqlx::query_as(&sql)
            .bind(user_uuid)
            .bind(project_uuid)
            .bind(agent_uuid)
            .fetch_all(&self.pool)
            .await?;
        Ok(items(rows))
    }

    async fn purge_expired(&self) -> Result<u64> {
        let res = sqlx::query(
            "UPDATE agent_memories SET deleted_at = now() WHERE expires_at IS NOT NULL AND expires_at <= now() AND deleted_at IS NULL",
        )
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected())
    }

    async fn list(&self, user_uuid: &str, req: &ListReq) -> Result<Vec<MemoryItem>> {
        let q = req.query.as_deref().map(rules::normalize).filter(|s| !s.is_empty());
        let pattern = q.map(|q| format!("%{}%", q.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")));
        let sql = format!(
            r#"SELECT {COLS} FROM agent_memories
               WHERE user_uuid = $1 AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > now())
                 AND ($2 OR superseded_by IS NULL)
                 AND ($3::text IS NULL OR scope = $3)
                 AND ($4::text IS NULL OR tier = $4)
                 AND ($5::text IS NULL OR project_uuid = $5)
                 AND ($6::text IS NULL OR content_norm ILIKE $6 OR coalesce(key,'') ILIKE $6)
               ORDER BY pinned DESC, updated_at DESC LIMIT $7 OFFSET $8"#
        );
        let rows: Vec<PgRow> = sqlx::query_as(&sql)
            .bind(user_uuid)
            .bind(req.include_superseded)
            .bind(req.scope.as_deref().filter(|s| !s.is_empty()))
            .bind(req.tier.map(|t| t.as_str()))
            .bind(req.project_uuid.as_deref().filter(|s| !s.is_empty()))
            .bind(pattern)
            .bind(clamp_limit(req.limit, MAX_LIST) as i64)
            .bind(req.offset as i64)
            .fetch_all(&self.pool)
            .await?;
        Ok(items(rows))
    }

    async fn get(&self, user_uuid: &str, uuid: &str) -> Result<Option<MemoryItem>> {
        let sql = format!("SELECT {COLS} FROM agent_memories WHERE user_uuid = $1 AND uuid = $2 AND deleted_at IS NULL");
        let row: Option<PgRow> = sqlx::query_as(&sql).bind(user_uuid).bind(uuid).fetch_optional(&self.pool).await?;
        Ok(row.and_then(PgRow::into_item))
    }

    async fn history(&self, user_uuid: &str, uuid: &str) -> Result<Vec<MemoryItem>> {
        let sql = format!(
            r#"WITH RECURSIVE chain AS (
                 SELECT m.*, 1 AS depth FROM agent_memories m WHERE m.user_uuid = $1 AND m.superseded_by = $2
                 UNION ALL
                 SELECT m.*, c.depth + 1 FROM agent_memories m JOIN chain c ON m.superseded_by = c.uuid
                 WHERE m.user_uuid = $1 AND c.depth < 20
               )
               SELECT {COLS} FROM chain ORDER BY depth"#
        );
        let rows: Vec<PgRow> = sqlx::query_as(&sql).bind(user_uuid).bind(uuid).fetch_all(&self.pool).await?;
        Ok(items(rows))
    }

    async fn correct(&self, user_uuid: &str, uuid: &str, content: &str) -> Result<WriteOutcome> {
        let old = self.get(user_uuid, uuid).await?.ok_or(MemoryError::NotFound)?;
        let req = correction_req(user_uuid, &old, content);
        let known = self.secret_values(&req).await;
        if let Err(e) = rules::validate(&req, &known) {
            return Ok(WriteOutcome::Rejected(e));
        }
        if rules::normalize(content) == rules::normalize(&old.content) {
            return Ok(WriteOutcome::Updated(old.uuid));
        }
        let now = Utc::now();
        let new = uuid::Uuid::new_v4().to_string();
        let mut tx = self.pool.begin().await?;
        sqlx::query("UPDATE agent_memories SET superseded_by = $2, updated_at = $3 WHERE uuid = $1 AND user_uuid = $4")
            .bind(&old.uuid)
            .bind(&new)
            .bind(now)
            .bind(user_uuid)
            .execute(&mut *tx)
            .await?;
        Self::insert(&mut tx, &new, &req, 1.0, now).await?;
        sqlx::query("UPDATE agent_memories SET pinned = $2 WHERE uuid = $1")
            .bind(&new)
            .bind(old.pinned)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(WriteOutcome::Superseded { old: old.uuid, new })
    }

    async fn set_pinned(&self, user_uuid: &str, uuid: &str, pinned: bool) -> Result<bool> {
        let res = sqlx::query(
            "UPDATE agent_memories SET pinned = $3 WHERE user_uuid = $1 AND uuid = $2 AND deleted_at IS NULL",
        )
        .bind(user_uuid)
        .bind(uuid)
        .bind(pinned)
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected() > 0)
    }

    async fn erase_all(&self, user_uuid: &str) -> Result<u64> {
        let res = sqlx::query("DELETE FROM agent_memories WHERE user_uuid = $1")
            .bind(user_uuid)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected())
    }

    async fn stats(&self) -> Result<MemoryStats> {
        let row: (i64, i64, i64, i64, i64) = sqlx::query_as(
            r#"SELECT
                 count(*) FILTER (WHERE deleted_at IS NULL AND superseded_by IS NULL AND tier = 'profile'),
                 count(*) FILTER (WHERE deleted_at IS NULL AND superseded_by IS NULL AND tier = 'log'),
                 count(*) FILTER (WHERE deleted_at IS NULL AND superseded_by IS NULL AND tier = 'note'),
                 count(*) FILTER (WHERE deleted_at IS NULL AND superseded_by IS NOT NULL),
                 count(*) FILTER (WHERE deleted_at IS NOT NULL)
               FROM agent_memories"#,
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(MemoryStats { profile: row.0, log: row.1, note: row.2, superseded: row.3, deleted: row.4 })
    }
}
