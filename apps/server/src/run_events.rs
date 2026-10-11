//! P4-01 / P4-02 : événements de run persistés (`agent_run_events`) et diffusion live reprenable.
//!
//! Chaque run (chat, réveil, worker) reçoit ses `AgentEvent` sur un canal ; une tâche « sink »
//! les numérote (`seq`), agrège les `Delta` par fenêtres de 150 ms, les écrit en base par lots
//! (250 ms ou 20 événements) et les publie aux abonnés SSE. Un abonné reçoit d'abord l'historique
//! `seq > after` puis le direct, sans trou ni doublon : l'historique en mémoire et l'abonnement
//! sont pris sous le même verrou que la publication.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use devforge_agent::{AgentEvent, AgentProgressTx, CancellationToken};
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::PgPool;
use tokio::sync::{broadcast, mpsc};

/// Fenêtre d'agrégation des morceaux de texte streamés.
pub const DELTA_WINDOW: Duration = Duration::from_millis(150);
/// Écriture en base : toutes les 250 ms ou par lots de 20.
pub const FLUSH_EVERY: Duration = Duration::from_millis(250);
pub const FLUSH_BATCH: usize = 20;
/// Rétention des événements.
pub const RETENTION_DAYS: i64 = 14;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct RunEvent {
    pub seq: i64,
    #[serde(rename = "type")]
    pub ty: String,
    pub payload: Value,
}

#[derive(Debug, Clone)]
pub enum Live {
    Ev(RunEvent),
    End,
}

struct Channel {
    buffer: Vec<RunEvent>,
    tx: broadcast::Sender<Live>,
    cancel: CancellationToken,
}

static HUB: LazyLock<Mutex<HashMap<String, Channel>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

pub async fn migrate(pool: &PgPool) -> Result<(), sqlx::Error> {
    for sql in [
        r#"CREATE TABLE IF NOT EXISTS agent_run_events (
            run_uuid   TEXT NOT NULL,
            seq        INT  NOT NULL,
            agent_uuid TEXT NOT NULL,
            type       TEXT NOT NULL,
            payload    JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (run_uuid, seq)
        )"#,
        "CREATE INDEX IF NOT EXISTS idx_run_events_agent ON agent_run_events (agent_uuid, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_run_events_created ON agent_run_events (created_at)",
        "ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS parent_run_uuid TEXT NULL",
        "ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'chat'",
        "ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS title TEXT NULL",
        "ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS progress JSONB NULL",
        "ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS cancel_requested BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS summary TEXT NULL",
        "CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_status ON agent_runs (agent_uuid, status)",
        "CREATE INDEX IF NOT EXISTS idx_agent_runs_project_kind ON agent_runs (project_uuid, kind, status)",
    ] {
        sqlx::query(sql).execute(pool).await?;
    }
    Ok(())
}

/// Statuts terminaux d'un run.
pub fn is_terminal(status: &str) -> bool {
    matches!(status, "completed" | "failed" | "cancelled")
}

/// Ouvre (ou retrouve) le canal live d'un run.
fn open(run_uuid: &str) -> CancellationToken {
    let mut hub = HUB.lock().unwrap();
    hub.entry(run_uuid.to_string())
        .or_insert_with(|| Channel {
            buffer: Vec::new(),
            tx: broadcast::channel(1024).0,
            cancel: CancellationToken::new(),
        })
        .cancel
        .clone()
}

fn publish(run_uuid: &str, ev: RunEvent) {
    let mut hub = HUB.lock().unwrap();
    if let Some(ch) = hub.get_mut(run_uuid) {
        ch.buffer.push(ev.clone());
        let _ = ch.tx.send(Live::Ev(ev));
    }
}

fn close(run_uuid: &str) {
    let mut hub = HUB.lock().unwrap();
    if let Some(ch) = hub.remove(run_uuid) {
        let _ = ch.tx.send(Live::End);
    }
}

pub fn is_live(run_uuid: &str) -> bool {
    HUB.lock().unwrap().contains_key(run_uuid)
}

/// Historique en mémoire (`seq > after`) + abonnement, pris atomiquement.
pub fn subscribe_live(run_uuid: &str, after: i64) -> Option<(Vec<RunEvent>, broadcast::Receiver<Live>)> {
    let hub = HUB.lock().unwrap();
    let ch = hub.get(run_uuid)?;
    let past = ch.buffer.iter().filter(|e| e.seq > after).cloned().collect();
    Some((past, ch.tx.subscribe()))
}

/// Annule un run exécuté sur ce nœud. `false` si le run n'est pas actif ici.
pub fn cancel_local(run_uuid: &str) -> bool {
    match HUB.lock().unwrap().get(run_uuid) {
        Some(ch) => {
            ch.cancel.cancel();
            true
        }
        None => false,
    }
}

/// Événement prêt à stocker : `Reply` voit ses résultats d'outils bornés (16 Ko chacun).
pub fn to_payload(ev: &AgentEvent) -> (String, Value) {
    let mut v = serde_json::to_value(ev).unwrap_or_else(|_| json!({}));
    let ty = v.get("type").and_then(|t| t.as_str()).unwrap_or("unknown").to_string();
    if let AgentEvent::Reply { tool_calls, .. } = ev {
        let bounded: Vec<Value> = tool_calls
            .iter()
            .map(|c| {
                json!({
                    "id": c.id,
                    "name": c.name,
                    "arguments": c.arguments,
                    "result": devforge_agent::events::for_ui(&c.name, &c.arguments, &c.result),
                })
            })
            .collect();
        v["tool_calls"] = Value::Array(bounded);
    }
    (ty, v)
}

/// Accumulateur pur (testable) : numérotation, agrégation des deltas, jalons courants.
#[derive(Default)]
pub struct Sequencer {
    pub next_seq: i64,
    delta: Option<(String, usize, Instant)>,
    milestones: Vec<(String, Value)>,
    pub progress_dirty: bool,
}

impl Sequencer {
    pub fn starting_at(next_seq: i64) -> Self {
        Self { next_seq, ..Default::default() }
    }

    fn make(&mut self, ty: String, payload: Value) -> RunEvent {
        let ev = RunEvent { seq: self.next_seq, ty, payload };
        self.next_seq += 1;
        ev
    }

    /// Delta en attente → un seul événement agrégé.
    pub fn flush_delta(&mut self) -> Option<RunEvent> {
        let (text, round, _) = self.delta.take()?;
        let payload = json!({"type": "delta", "text": text, "round": round});
        Some(self.make("delta".into(), payload))
    }

    /// Delta en attente depuis plus que la fenêtre ?
    pub fn delta_due(&self, now: Instant) -> bool {
        self.delta.as_ref().is_some_and(|(_, _, t)| now.duration_since(*t) >= DELTA_WINDOW)
    }

    /// Événements à émettre pour cet `AgentEvent` (0, 1 ou 2 : delta en attente + événement).
    pub fn push(&mut self, ev: &AgentEvent, now: Instant) -> Vec<RunEvent> {
        if let AgentEvent::Delta { text, round } = ev {
            match &mut self.delta {
                Some((buf, r, _)) if r == round => {
                    buf.push_str(text);
                    return Vec::new();
                }
                _ => {
                    let prev = self.flush_delta();
                    self.delta = Some((text.clone(), *round, now));
                    return prev.into_iter().collect();
                }
            }
        }
        let mut out: Vec<RunEvent> = self.flush_delta().into_iter().collect();
        if let AgentEvent::Milestone { label, status } = ev {
            let st = serde_json::to_value(status).unwrap_or(json!("running"));
            match self.milestones.iter_mut().find(|(l, _)| l == label) {
                Some(m) => m.1 = st,
                None => self.milestones.push((label.clone(), st)),
            }
            self.progress_dirty = true;
        }
        let (ty, payload) = to_payload(ev);
        out.push(self.make(ty, payload));
        out
    }

    pub fn progress(&self) -> Value {
        Value::Array(self.milestones.iter().map(|(l, s)| json!({"label": l, "status": s})).collect())
    }
}

async fn write_batch(pool: &PgPool, run_uuid: &str, agent_uuid: &str, rows: &mut Vec<RunEvent>) {
    if rows.is_empty() {
        return;
    }
    let mut qb = sqlx::QueryBuilder::<sqlx::Postgres>::new(
        "INSERT INTO agent_run_events (run_uuid, seq, agent_uuid, type, payload) ",
    );
    qb.push_values(rows.iter(), |mut b, e| {
        b.push_bind(run_uuid)
            .push_bind(e.seq as i32)
            .push_bind(agent_uuid)
            .push_bind(&e.ty)
            .push_bind(e.payload.to_string())
            .push_unseparated("::jsonb");
    });
    qb.push(" ON CONFLICT (run_uuid, seq) DO NOTHING");
    if let Err(e) = qb.build().execute(pool).await {
        tracing::warn!(error = %e, run_uuid, "événements de run non écrits");
    }
    rows.clear();
}

async fn last_seq(pool: &PgPool, run_uuid: &str) -> i64 {
    sqlx::query_scalar::<_, Option<i32>>("SELECT MAX(seq) FROM agent_run_events WHERE run_uuid = $1")
        .bind(run_uuid)
        .fetch_one(pool)
        .await
        .ok()
        .flatten()
        .map(|s| s as i64)
        .unwrap_or(0)
}

/// Canal d'un run : à passer comme `progress` à l'agent ; jeton d'annulation partagé.
pub struct RunHandle {
    pub tx: AgentProgressTx,
    pub cancel: CancellationToken,
}

/// Démarre la tâche sink d'un run. Le canal live existe dès le retour (abonnement possible).
/// Le sink se termine quand tous les émetteurs (`tx`) sont abandonnés.
pub async fn start(pool: &PgPool, run_uuid: &str, agent_uuid: &str) -> RunHandle {
    let cancel = open(run_uuid);
    // Run repris après un redémarrage : la numérotation continue.
    let mut seq = Sequencer::starting_at(last_seq(pool, run_uuid).await + 1);
    let (tx, mut rx) = mpsc::unbounded_channel::<AgentEvent>();
    let pool = pool.clone();
    let run = run_uuid.to_string();
    let agent = agent_uuid.to_string();
    let cancel_watch = cancel.clone();
    tokio::spawn(async move {
        let mut rows: Vec<RunEvent> = Vec::new();
        let mut last_flush = Instant::now();
        let mut tick = tokio::time::interval(Duration::from_millis(50));
        let mut ticks: u32 = 0;
        loop {
            tokio::select! {
                ev = rx.recv() => match ev {
                    Some(ev) => {
                        for e in seq.push(&ev, Instant::now()) {
                            publish(&run, e.clone());
                            rows.push(e);
                        }
                    }
                    None => break,
                },
                _ = tick.tick() => {
                    ticks = ticks.wrapping_add(1);
                    if seq.delta_due(Instant::now()) {
                        if let Some(e) = seq.flush_delta() {
                            publish(&run, e.clone());
                            rows.push(e);
                        }
                    }
                    // Annulation demandée depuis un autre nœud : relue en base chaque seconde.
                    if ticks % 20 == 0 && !cancel_watch.is_cancelled() {
                        let asked: Option<bool> = sqlx::query_scalar("SELECT cancel_requested FROM agent_runs WHERE uuid = $1")
                            .bind(&run).fetch_optional(&pool).await.ok().flatten();
                        if asked == Some(true) {
                            cancel_watch.cancel();
                        }
                    }
                }
            }
            if rows.len() >= FLUSH_BATCH || (!rows.is_empty() && last_flush.elapsed() >= FLUSH_EVERY) {
                write_batch(&pool, &run, &agent, &mut rows).await;
                last_flush = Instant::now();
                if seq.progress_dirty {
                    seq.progress_dirty = false;
                    let _ = sqlx::query("UPDATE agent_runs SET progress = $1::jsonb WHERE uuid = $2")
                        .bind(seq.progress().to_string())
                        .bind(&run)
                        .execute(&pool)
                        .await;
                }
            }
        }
        if let Some(e) = seq.flush_delta() {
            publish(&run, e.clone());
            rows.push(e);
        }
        write_batch(&pool, &run, &agent, &mut rows).await;
        if seq.progress_dirty {
            let _ = sqlx::query("UPDATE agent_runs SET progress = $1::jsonb WHERE uuid = $2")
                .bind(seq.progress().to_string())
                .bind(&run)
                .execute(&pool)
                .await;
        }
        close(&run);
    });
    RunHandle { tx, cancel }
}

pub async fn history(pool: &PgPool, run_uuid: &str, after: i64) -> Vec<RunEvent> {
    sqlx::query_as::<_, (i32, String, String)>(
        "SELECT seq, type, payload::text FROM agent_run_events WHERE run_uuid = $1 AND seq > $2 ORDER BY seq ASC LIMIT 5000",
    )
    .bind(run_uuid)
    .bind(after as i32)
    .fetch_all(pool)
    .await
    .unwrap_or_default()
    .into_iter()
    .map(|(seq, ty, payload)| RunEvent { seq: seq as i64, ty, payload: serde_json::from_str(&payload).unwrap_or(Value::Null) })
    .collect()
}

pub async fn run_status(pool: &PgPool, run_uuid: &str) -> Option<String> {
    sqlx::query_scalar("SELECT status FROM agent_runs WHERE uuid = $1")
        .bind(run_uuid)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
}

/// Ce qu'un abonné SSE reçoit.
#[derive(Debug, Clone, PartialEq)]
pub enum Out {
    Event(RunEvent),
    Done(String),
}

/// Flux d'un run pour un abonné : historique `seq > after` puis direct, termine par `Done`.
/// S'arrête dès que le client part (envoi impossible).
pub fn follow(pool: PgPool, run_uuid: String, after: i64) -> mpsc::Receiver<Out> {
    let (tx, rx) = mpsc::channel::<Out>(256);
    tokio::spawn(async move {
        let mut last = after;
        loop {
            // 1. Run actif sur ce nœud : mémoire + direct.
            if let Some((past, mut live)) = subscribe_live(&run_uuid, last) {
                // Ce qui précède le tampon mémoire (run repris après redémarrage) vient de la base.
                if let Some(first) = past.first() {
                    if first.seq > last + 1 {
                        for e in history(&pool, &run_uuid, last).await.into_iter().filter(|e| e.seq < first.seq) {
                            last = e.seq;
                            if tx.send(Out::Event(e)).await.is_err() {
                                return;
                            }
                        }
                    }
                }
                for e in past {
                    if e.seq > last {
                        last = e.seq;
                        if tx.send(Out::Event(e)).await.is_err() {
                            return;
                        }
                    }
                }
                loop {
                    match live.recv().await {
                        Ok(Live::Ev(e)) => {
                            if e.seq > last {
                                last = e.seq;
                                if tx.send(Out::Event(e)).await.is_err() {
                                    return;
                                }
                            }
                        }
                        Ok(Live::End) | Err(broadcast::error::RecvError::Closed) => break,
                        // Abonné trop lent : on repart de la base.
                        Err(broadcast::error::RecvError::Lagged(_)) => break,
                    }
                }
            }
            // 2. Base : rattrapage, puis fin si le run est terminé.
            let rows = history(&pool, &run_uuid, last).await;
            for e in rows {
                last = e.seq;
                if tx.send(Out::Event(e)).await.is_err() {
                    return;
                }
            }
            let status = run_status(&pool, &run_uuid).await.unwrap_or_else(|| "failed".into());
            if is_terminal(&status) && !is_live(&run_uuid) {
                // Dernier rattrapage (écriture finale du sink).
                for e in history(&pool, &run_uuid, last).await {
                    if tx.send(Out::Event(e)).await.is_err() {
                        return;
                    }
                }
                let _ = tx.send(Out::Done(status)).await;
                return;
            }
            if is_live(&run_uuid) {
                continue;
            }
            // Run en attente, ou exécuté par un autre nœud : on relit la base.
            if tx.is_closed() {
                return;
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    });
    rx
}

/// Purge des événements de plus de 14 jours.
pub async fn purge(pool: &PgPool) -> u64 {
    sqlx::query("DELETE FROM agent_run_events WHERE created_at < now() - make_interval(days => $1)")
        .bind(RETENTION_DAYS as i32)
        .execute(pool)
        .await
        .map(|r| r.rows_affected())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use devforge_agent::MilestoneStatus;

    #[test]
    fn deltas_of_a_window_are_merged_and_order_is_kept() {
        let mut s = Sequencer::starting_at(1);
        let t = Instant::now();
        assert!(s.push(&AgentEvent::Delta { text: "Bon".into(), round: 1 }, t).is_empty());
        assert!(s.push(&AgentEvent::Delta { text: "jour".into(), round: 1 }, t).is_empty());
        assert!(!s.delta_due(t));
        assert!(s.delta_due(t + DELTA_WINDOW));
        let out = s.push(&AgentEvent::Milestone { label: "Build".into(), status: MilestoneStatus::Running }, t);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].seq, 1);
        assert_eq!(out[0].payload["text"], "Bonjour");
        assert_eq!(out[1].seq, 2);
        assert_eq!(out[1].ty, "milestone");
        assert_eq!(s.progress(), json!([{"label": "Build", "status": "running"}]));
        // Un autre tour de texte ferme le précédent.
        s.push(&AgentEvent::Delta { text: "a".into(), round: 2 }, t);
        let out = s.push(&AgentEvent::Delta { text: "b".into(), round: 3 }, t);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].payload["round"], 2);
    }

    #[test]
    fn reply_payload_is_bounded() {
        let big = "x".repeat(40_000);
        let ev = AgentEvent::Reply {
            content: "ok".into(),
            provider: "p".into(),
            tool_calls: vec![devforge_agent::ToolCallRecord {
                id: "1".into(),
                name: "run_workdir_command".into(),
                arguments: json!({"command": "npm run build"}),
                result: json!({"ok": true, "stdout": big}),
            }],
        };
        let (ty, v) = to_payload(&ev);
        assert_eq!(ty, "reply");
        assert!(v.to_string().len() < 20_000, "{}", v.to_string().len());
    }

    async fn pool() -> PgPool {
        let pool = devforge_database::ephemeral_pg().await;
        sqlx::query(
            r#"CREATE TABLE agent_runs (uuid TEXT PRIMARY KEY, project_uuid TEXT NOT NULL, agent_uuid TEXT NOT NULL,
               message_uuid TEXT NOT NULL UNIQUE, status TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        migrate(&pool).await.unwrap();
        migrate(&pool).await.unwrap();
        sqlx::query("INSERT INTO agent_runs (uuid, project_uuid, agent_uuid, message_uuid, status, created_at, updated_at) VALUES ('run-1','p','a','m','running','t','t')")
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    async fn collect(mut rx: mpsc::Receiver<Out>) -> (Vec<i64>, Option<String>) {
        let mut seqs = Vec::new();
        let mut done = None;
        while let Some(o) = tokio::time::timeout(Duration::from_secs(10), rx.recv()).await.expect("flux bloqué") {
            match o {
                Out::Event(e) => seqs.push(e.seq),
                Out::Done(s) => {
                    done = Some(s);
                    break;
                }
            }
        }
        (seqs, done)
    }

    #[tokio::test]
    async fn thirty_events_are_persisted_in_order_and_replayed_then_live() {
        let pool = pool().await;
        let h = start(&pool, "run-1", "a").await;
        // Abonné présent dès le début (comme la réponse SSE de /agent/chat).
        let early = follow(pool.clone(), "run-1".into(), 0);
        for i in 0..15 {
            h.tx.send(AgentEvent::Thinking { round: i, label: format!("t{i}"), detail: String::new() }).unwrap();
        }
        tokio::time::sleep(Duration::from_millis(400)).await;
        // Abonné tardif qui reprend après seq=5 (reconnexion Last-Event-ID).
        let late = follow(pool.clone(), "run-1".into(), 5);
        for i in 15..30 {
            h.tx.send(AgentEvent::Thinking { round: i, label: format!("t{i}"), detail: String::new() }).unwrap();
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
        sqlx::query("UPDATE agent_runs SET status = 'completed' WHERE uuid = 'run-1'").execute(&pool).await.unwrap();
        drop(h);
        let (a, da) = collect(early).await;
        let (b, db) = collect(late).await;
        assert_eq!(a, (1..=30).collect::<Vec<_>>());
        assert_eq!(b, (6..=30).collect::<Vec<_>>());
        assert_eq!(da.as_deref(), Some("completed"));
        assert_eq!(db.as_deref(), Some("completed"));
        // Relecture complète et ordonnée depuis la base, une fois le run fini.
        let rows = history(&pool, "run-1", 0).await;
        assert_eq!(rows.iter().map(|e| e.seq).collect::<Vec<_>>(), (1..=30).collect::<Vec<_>>());
        assert_eq!(rows[29].payload["label"], "t29");
        let (c, dc) = collect(follow(pool.clone(), "run-1".into(), 28)).await;
        assert_eq!(c, vec![29, 30]);
        assert_eq!(dc.as_deref(), Some("completed"));
        assert!(!is_live("run-1"));
    }

    #[tokio::test]
    async fn a_resumed_run_continues_numbering() {
        let pool = pool().await;
        let h = start(&pool, "run-1", "a").await;
        h.tx.send(AgentEvent::Ack { text: "ok".into() }).unwrap();
        drop(h);
        tokio::time::sleep(Duration::from_millis(300)).await;
        let h = start(&pool, "run-1", "a").await;
        h.tx.send(AgentEvent::Ack { text: "encore".into() }).unwrap();
        drop(h);
        tokio::time::sleep(Duration::from_millis(300)).await;
        let rows = history(&pool, "run-1", 0).await;
        assert_eq!(rows.iter().map(|e| e.seq).collect::<Vec<_>>(), vec![1, 2]);
    }

    #[tokio::test]
    async fn cancel_is_local_and_from_the_database() {
        let pool = pool().await;
        let h = start(&pool, "run-1", "a").await;
        assert!(cancel_local("run-1"));
        assert!(h.cancel.is_cancelled());
        assert!(!cancel_local("inconnu"));
        drop(h);
        tokio::time::sleep(Duration::from_millis(200)).await;
        // Autre nœud : drapeau en base relu par le sink.
        let h = start(&pool, "run-1", "a").await;
        sqlx::query("UPDATE agent_runs SET cancel_requested = TRUE WHERE uuid = 'run-1'").execute(&pool).await.unwrap();
        tokio::time::timeout(Duration::from_secs(3), h.cancel.cancelled()).await.expect("annulation relue");
    }
}
