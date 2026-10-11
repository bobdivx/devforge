//! Scénarios des règles (P3-02/P3-03), joués sur le store en mémoire ET sur Postgres :
//! les deux implémentations doivent se comporter pareil.

use devforge_memory::{
    rules, secrets, ForgetTarget, InMemoryStore, ListReq, MemoryStore, PgMemoryStore, Scope, SearchReq, Tier,
    WriteOutcome, WriteReq,
};
use std::time::Duration;

const U: &str = "user-1";
const OTHER: &str = "user-2";

/// Contenus très différents (pas de quasi-doublon entre deux notes).
fn uuid_like(i: usize) -> String {
    const WORDS: &[&str] = &["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet"];
    format!("{} {} {}", WORDS[i % 10], WORDS[(i / 10) % 10].repeat(i % 3 + 1), i * 7919)
}

fn said(scope: Scope, tier: Tier, kind: &str, key: Option<&str>, content: &str) -> WriteReq {
    let mut r = WriteReq::new(U, scope, tier, kind, content);
    r.key = key.map(str::to_string);
    r.source = "user_said".into();
    r
}

async fn scenario_key_dedup_and_supersede(store: &dyn MemoryStore) {
    let r = said(Scope::User, Tier::Profile, "infra", Some("infra.machine.demeter.address"), "Le worker Demeter répond sur http://10.1.0.88:8000.");
    let WriteOutcome::Inserted(first) = store.write(r.clone()).await.unwrap() else { panic!("insert") };
    // Même contenu (casse/espaces) : rafraîchi, pas de doublon.
    let mut same = r.clone();
    same.content = "le worker  Demeter répond sur http://10.1.0.88:8000.".into();
    assert_eq!(store.write(same).await.unwrap(), WriteOutcome::Updated(first.clone()));
    // « En fait Demeter est sur 10.1.0.89 » : le plus récent gagne.
    let mut newer = r.clone();
    newer.content = "Le worker Demeter répond sur http://10.1.0.89:8000.".into();
    let WriteOutcome::Superseded { old, new } = store.write(newer).await.unwrap() else { panic!("supersede") };
    assert_eq!(old, first);
    let profile = store.profile(U, None, None).await.unwrap();
    assert_eq!(profile.len(), 1);
    assert_eq!(profile[0].uuid, new);
    assert!(profile[0].content.contains("10.1.0.89"));
    let hist = store.history(U, &new).await.unwrap();
    assert_eq!(hist.len(), 1);
    assert_eq!(hist[0].uuid, first);
    assert_eq!(hist[0].superseded_by.as_deref(), Some(new.as_str()));
}

async fn scenario_user_said_exception(store: &dyn MemoryStore) {
    let r = said(Scope::User, Tier::Profile, "preference", Some("pref.reply.length"), "Préfère des réponses courtes.");
    let WriteOutcome::Inserted(first) = store.write(r.clone()).await.unwrap() else { panic!() };
    let mut observed = r.clone();
    observed.source = "observed".into();
    observed.content = "Préfère des réponses détaillées.".into();
    let out = store.write(observed).await.unwrap();
    let WriteOutcome::NeedsConfirmation { existing, note } = out else { panic!("attendu note à confirmer : {out:?}") };
    assert_eq!(existing, first);
    // L'original n'est pas remplacé ; une note « à confirmer » existe.
    let p = store.profile(U, None, None).await.unwrap();
    assert!(p.iter().any(|i| i.uuid == first && i.superseded_by.is_none()));
    let found = store.search(U, &SearchReq { tiers: vec![Tier::Note], ..SearchReq::new("changement") }).await.unwrap();
    assert!(found.iter().any(|i| i.uuid == note && i.content.contains("à confirmer")), "{found:?}");
}

async fn scenario_near_duplicates_without_key(store: &dyn MemoryStore) {
    let a = said(Scope::Project("p1".into()), Tier::Log, "decision", None, "Déploiements sur la branche dev pour popcornn");
    let WriteOutcome::Inserted(id) = store.write(a.clone()).await.unwrap() else { panic!() };
    let mut b = a.clone();
    b.content = "Déploiements sur la branche dev pour popcornn.".into();
    assert_eq!(store.write(b).await.unwrap(), WriteOutcome::Updated(id));
    let mut c = a.clone();
    c.content = "Le build passe par npm ci".into();
    assert!(matches!(store.write(c).await.unwrap(), WriteOutcome::Inserted(_)));
}

async fn scenario_cross_project_and_scopes(store: &dyn MemoryStore) {
    store.write(said(Scope::User, Tier::Profile, "preference", Some("pref.reply.style"), "Accusé de réception puis travail.")).await.unwrap();
    store.write(said(Scope::Project("p1".into()), Tier::Profile, "fact", None, "Projet p1 : app Astro.")).await.unwrap();
    store.write(said(Scope::Agent("a1".into()), Tier::Profile, "fact", None, "Fil a1 : lockfile.")).await.unwrap();
    // Un autre projet voit le profil utilisateur, pas celui de p1 ni de l'agent a1.
    let other = store.profile(U, Some("p2"), Some("a2")).await.unwrap();
    assert!(other.iter().any(|i| i.content.contains("Accusé de réception")));
    assert!(!other.iter().any(|i| i.content.contains("p1") || i.content.contains("a1")));
    let mine = store.profile(U, Some("p1"), Some("a1")).await.unwrap();
    assert_eq!(mine.len(), 3);
    // Un autre utilisateur ne voit rien.
    assert!(store.profile(OTHER, Some("p1"), Some("a1")).await.unwrap().is_empty());
    assert!(store.search(OTHER, &SearchReq::new("lockfile")).await.unwrap().is_empty());
    // Recherche limitée aux portées demandées.
    let scoped = store
        .search(U, &SearchReq { scopes: vec![Scope::User, Scope::Project("p2".into())], ..SearchReq::new("lockfile") })
        .await
        .unwrap();
    assert!(scoped.is_empty());
}

async fn scenario_forget(store: &dyn MemoryStore) {
    let r = said(Scope::User, Tier::Profile, "preference", Some("pref.lang"), "Répond en français.");
    let WriteOutcome::Inserted(id) = store.write(r).await.unwrap() else { panic!() };
    assert_eq!(store.forget(OTHER, ForgetTarget::Uuid(id.clone()), None).await.unwrap(), 0);
    assert_eq!(
        store.forget(U, ForgetTarget::Key { scope: Scope::User, key: "pref.lang".into() }, Some("obsolète".into())).await.unwrap(),
        1
    );
    assert!(store.profile(U, None, None).await.unwrap().iter().all(|i| i.uuid != id));
    assert!(store.get(U, &id).await.unwrap().is_none());
}

async fn scenario_notes(store: &dyn MemoryStore) {
    let mut n = said(Scope::Agent("a9".into()), Tier::Note, "context", None, "Déjà tenté : npm ci");
    n.expires_in = Some(Duration::from_secs(3600));
    let WriteOutcome::Inserted(_) = store.write(n.clone()).await.unwrap() else { panic!() };
    for i in 0..25 {
        let mut x = n.clone();
        x.content = format!("hypothèse {i} : {}", uuid_like(i));
        store.write(x).await.unwrap();
    }
    let p = store.profile(U, None, Some("a9")).await.unwrap();
    let notes = p.iter().filter(|i| i.tier == Tier::Note).count();
    assert_eq!(notes, rules::MAX_LIVE_NOTES);
    assert!(p.iter().all(|i| i.expires_at.is_some()));
}

async fn scenario_secret_rejected(store: &dyn MemoryStore) {
    let r = said(Scope::User, Tier::Profile, "fact", None, "le token GitHub est ghp_abcdefghijklmnopqrstuvwxyz0123456789");
    assert_eq!(store.write(r).await.unwrap(), WriteOutcome::Rejected(secrets::REJECTED_MESSAGE.into()));
    assert!(store.search(U, &SearchReq::new("token")).await.unwrap().is_empty());
}

async fn scenario_search_fts_and_fallback(store: &dyn MemoryStore) {
    let mut log = said(Scope::Project("esp".into()), Tier::Log, "incident", Some("wake.cause.abc123"), "package-lock.json désynchronisé : npm ci exit 1 (3 occurrences, dernière action : escalade)");
    log.source = "system".into();
    store.write(log).await.unwrap();
    let hits = store.search(U, &SearchReq::new("lockfile package-lock")).await.unwrap();
    assert!(hits.iter().any(|i| i.content.contains("package-lock")), "{hits:?}");
    let hits = store.search(U, &SearchReq::new("désynchronisé")).await.unwrap();
    assert_eq!(hits.len(), 1);
    // Requête longue en langage naturel : repli mots-clés.
    let hits = store
        .search(U, &SearchReq { min_match: 2, ..SearchReq::new("pourquoi npm ci est désynchronisé ?") })
        .await
        .unwrap();
    assert!(!hits.is_empty());
}

async fn scenario_ui_ops(store: &dyn MemoryStore) {
    let WriteOutcome::Inserted(id) = store
        .write(said(Scope::User, Tier::Profile, "fact", None, "Machine principale : NAS ZimaOS."))
        .await
        .unwrap()
    else {
        panic!()
    };
    assert!(store.set_pinned(U, &id, true).await.unwrap());
    assert!(!store.set_pinned(OTHER, &id, true).await.unwrap());
    let WriteOutcome::Superseded { new, .. } = store.correct(U, &id, "Machine principale : NAS ZimaOS (10.1.0.10).").await.unwrap() else {
        panic!()
    };
    let item = store.get(U, &new).await.unwrap().unwrap();
    assert!(item.pinned, "l'épingle suit la correction");
    assert_eq!(item.source, "user_said");
    let listed = store.list(U, &ListReq { tier: Some(Tier::Profile), ..Default::default() }).await.unwrap();
    assert_eq!(listed[0].uuid, new);
    assert!(store.correct(OTHER, &new, "x").await.is_err());
    let rejected = store.correct(U, &new, "mot de passe=Hunter2!x").await.unwrap();
    assert!(matches!(rejected, WriteOutcome::Rejected(_)));
    assert!(store.erase_all(U).await.unwrap() >= 2);
    assert!(store.list(U, &ListReq::default()).await.unwrap().is_empty());
}

async fn scenario_purge(store: &dyn MemoryStore) {
    let mut n = said(Scope::Agent("a5".into()), Tier::Note, "todo", None, "Relancer la preview demain");
    n.expires_in = Some(Duration::from_secs(3600));
    store.write(n).await.unwrap();
    let s = store.stats().await.unwrap();
    assert!(s.note >= 1);
}

macro_rules! both {
    ($name:ident, $scenario:ident) => {
        mod $name {
            use super::*;
            #[tokio::test]
            async fn in_memory() {
                $scenario(&InMemoryStore::new()).await;
            }
            #[tokio::test]
            async fn postgres() {
                let pool = devforge_database::ephemeral_pg().await;
                devforge_memory::migrate(&pool).await.unwrap();
                $scenario(&PgMemoryStore::new(pool)).await;
            }
        }
    };
}

both!(key_dedup_and_supersede, scenario_key_dedup_and_supersede);
both!(user_said_exception, scenario_user_said_exception);
both!(near_duplicates_without_key, scenario_near_duplicates_without_key);
both!(cross_project_and_scopes, scenario_cross_project_and_scopes);
both!(forget, scenario_forget);
both!(notes, scenario_notes);
both!(secret_rejected, scenario_secret_rejected);
both!(search_fts_and_fallback, scenario_search_fts_and_fallback);
both!(ui_ops, scenario_ui_ops);
both!(purge_stats, scenario_purge);

#[tokio::test]
async fn migration_is_idempotent_and_works_without_trgm() {
    let pool = devforge_database::ephemeral_pg().await;
    devforge_memory::migrate(&pool).await.unwrap();
    devforge_memory::migrate(&pool).await.unwrap();
    // Sans pg_trgm : dédup par égalité normalisée.
    let store = PgMemoryStore::without_trgm(pool.clone());
    let a = said(Scope::User, Tier::Log, "fact", None, "Un fait  Simple");
    let WriteOutcome::Inserted(id) = store.write(a.clone()).await.unwrap() else { panic!() };
    let mut b = a.clone();
    b.content = "un fait simple".into();
    assert_eq!(store.write(b).await.unwrap(), WriteOutcome::Updated(id));
    let mut c = a.clone();
    c.content = "Un fait simple.".into();
    assert!(matches!(store.write(c).await.unwrap(), WriteOutcome::Inserted(_)));
}

#[tokio::test]
async fn expired_notes_are_purged() {
    let pool = devforge_database::ephemeral_pg().await;
    devforge_memory::migrate(&pool).await.unwrap();
    let store = PgMemoryStore::new(pool.clone());
    let mut n = said(Scope::Agent("a".into()), Tier::Note, "context", None, "note courte");
    n.expires_in = Some(Duration::from_secs(3600));
    let WriteOutcome::Inserted(id) = store.write(n).await.unwrap() else { panic!() };
    sqlx::query("UPDATE agent_memories SET expires_at = now() - interval '1 minute' WHERE uuid = $1")
        .bind(&id)
        .execute(&pool)
        .await
        .unwrap();
    assert!(store.profile(U, None, Some("a")).await.unwrap().is_empty());
    assert_eq!(store.purge_expired().await.unwrap(), 1);
    assert_eq!(store.purge_expired().await.unwrap(), 0);
    let mem = InMemoryStore::new();
    let mut n = said(Scope::Agent("a".into()), Tier::Note, "context", None, "note");
    n.expires_in = Some(Duration::from_secs(3600));
    let WriteOutcome::Inserted(id) = mem.write(n).await.unwrap() else { panic!() };
    mem.set_expires_at(&id, chrono::Utc::now() - chrono::Duration::minutes(1));
    assert_eq!(mem.purge_expired().await.unwrap(), 1);
}

#[tokio::test]
async fn env_secret_values_are_rejected() {
    let pool = devforge_database::ephemeral_pg().await;
    devforge_memory::migrate(&pool).await.unwrap();
    sqlx::query("CREATE TABLE IF NOT EXISTS project_env_vars (project_uuid TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, secret BIGINT NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, PRIMARY KEY (project_uuid, key))")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO project_env_vars VALUES ('p1', 'DB_PASS', 'correcthorse', 1, '')")
        .execute(&pool)
        .await
        .unwrap();
    let store = PgMemoryStore::new(pool);
    let mut r = said(Scope::User, Tier::Log, "fact", None, "la base utilise correcthorse");
    r.project_uuid = Some("p1".into());
    assert!(matches!(store.write(r).await.unwrap(), WriteOutcome::Rejected(_)));
}
