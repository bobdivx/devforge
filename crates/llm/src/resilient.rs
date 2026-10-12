//! Fallback chain: try providers in priority order until one succeeds.
//! Chaque fournisseur a droit à quelques nouveaux essais sur 429 / 5xx / timeout (P1-09).

use async_trait::async_trait;
use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use crate::errors::{classify, LlmErrorKind};
use crate::{err, AssistantTurn, ChatRequest, DeltaSink, LlmProvider, Result};
use std::sync::atomic::{AtomicBool, Ordering};

pub struct ChainEntry {
    pub label: String,
    pub provider: Arc<dyn LlmProvider>,
}

/// Rappel de progression (« Modèle saturé, nouvel essai… ») pendant un tour.
pub type RetryNotifier = Arc<dyn Fn(String) + Send + Sync>;

tokio::task_local! {
    static RETRY_NOTIFIER: RetryNotifier;
}

/// Exécute `fut` avec un rappel appelé à chaque nouvel essai LLM.
pub async fn with_retry_notifier<F: Future>(notifier: RetryNotifier, fut: F) -> F::Output {
    RETRY_NOTIFIER.scope(notifier, fut).await
}

fn notify(label: String) {
    let _ = RETRY_NOTIFIER.try_with(|n| n(label));
}

/// Politique de nouvel essai.
#[derive(Debug, Clone)]
pub struct RetryPolicy {
    pub base: Duration,
    pub max_delay: Duration,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            base: Duration::from_millis(600),
            max_delay: Duration::from_secs(8),
        }
    }
}

impl RetryPolicy {
    /// `min(retry_after | base·2^n, max)` avec ±20 % de gigue.
    pub fn delay(&self, kind: &LlmErrorKind, attempt: u32) -> Duration {
        let raw = match kind {
            LlmErrorKind::RateLimited {
                retry_after: Some(d),
            } => *d,
            _ => self.base.saturating_mul(1u32 << attempt.min(8)),
        };
        let capped = raw.min(self.max_delay);
        let jitter = (uuid::Uuid::new_v4().as_bytes()[0] as f64 / 255.0) * 0.4 - 0.2; // [-0.2, 0.2]
        let ms = (capped.as_millis() as f64 * (1.0 + jitter)).max(0.0) as u64;
        Duration::from_millis(ms).min(self.max_delay)
    }
}

/// Tries each provider in order. On error (or empty content without tools), falls through.
/// Requête adaptée au fournisseur : sans vision, les images deviennent « [image jointe : nom] ».
fn for_entry(entry: &ChainEntry, req: &ChatRequest) -> ChatRequest {
    let mut req = req.clone();
    if !entry.provider.supports_vision() {
        for m in &mut req.messages {
            if m.images.is_empty() {
                continue;
            }
            let names: Vec<String> = m
                .images
                .drain(..)
                .map(|i| format!("[image jointe : {}]", i.name))
                .collect();
            m.content = format!("{}\n{}", m.content, names.join("\n"));
        }
    }
    req
}

pub struct ResilientLlmProvider {
    chain: Vec<ChainEntry>,
    policy: RetryPolicy,
}

impl ResilientLlmProvider {
    pub fn new(chain: Vec<ChainEntry>) -> Self {
        Self {
            chain,
            policy: RetryPolicy::default(),
        }
    }

    pub fn with_policy(mut self, policy: RetryPolicy) -> Self {
        self.policy = policy;
        self
    }

    pub fn labels(&self) -> Vec<String> {
        self.chain.iter().map(|e| e.label.clone()).collect()
    }

    /// Un fournisseur, avec ses nouveaux essais.
    async fn chat_with_retries(
        &self,
        entry: &ChainEntry,
        req: &ChatRequest,
    ) -> Result<AssistantTurn> {
        let mut attempt: u32 = 0;
        loop {
            match entry.provider.chat(for_entry(entry, req)).await {
                Ok(turn) => return Ok(turn),
                Err(e) => {
                    let kind = classify(&e);
                    if attempt >= kind.max_retries() {
                        return Err(e);
                    }
                    let delay = self.policy.delay(&kind, attempt);
                    tracing::warn!(
                        provider = %entry.label,
                        error = %e,
                        ?kind,
                        attempt = attempt + 1,
                        delay_ms = delay.as_millis() as u64,
                        "LLM KO transitoire — nouvel essai"
                    );
                    notify(retry_label(&kind));
                    tokio::time::sleep(delay).await;
                    attempt += 1;
                }
            }
        }
    }

    /// Streaming avec nouveaux essais **tant qu'aucun texte n'a été émis** (sinon : doublons).
    async fn stream_with_retries(
        &self,
        entry: &ChainEntry,
        req: &ChatRequest,
        sink: &DeltaSink<'_>,
        emitted: &AtomicBool,
    ) -> Result<AssistantTurn> {
        let mut attempt: u32 = 0;
        loop {
            match entry
                .provider
                .chat_stream(for_entry(entry, req), sink)
                .await
            {
                Ok(turn) => return Ok(turn),
                Err(e) => {
                    let kind = classify(&e);
                    if emitted.load(Ordering::SeqCst) || attempt >= kind.max_retries() {
                        return Err(e);
                    }
                    let delay = self.policy.delay(&kind, attempt);
                    tracing::warn!(
                        provider = %entry.label,
                        error = %e,
                        ?kind,
                        attempt = attempt + 1,
                        delay_ms = delay.as_millis() as u64,
                        "LLM (stream) KO transitoire — nouvel essai"
                    );
                    notify(retry_label(&kind));
                    tokio::time::sleep(delay).await;
                    attempt += 1;
                }
            }
        }
    }
}

fn retry_label(kind: &LlmErrorKind) -> String {
    match kind {
        LlmErrorKind::RateLimited { .. } => "Modèle saturé, nouvel essai…".to_string(),
        LlmErrorKind::Timeout => "Le modèle tarde, nouvel essai…".to_string(),
        _ => "Modèle indisponible, nouvel essai…".to_string(),
    }
}

#[async_trait]
impl LlmProvider for ResilientLlmProvider {
    fn name(&self) -> &str {
        "resilient"
    }

    fn supports_vision(&self) -> bool {
        self.chain
            .first()
            .is_some_and(|e| e.provider.supports_vision())
    }

    async fn chat(&self, req: ChatRequest) -> Result<AssistantTurn> {
        if self.chain.is_empty() {
            return Err(err("aucun provider LLM dans la chaîne"));
        }
        let mut errors: Vec<String> = Vec::new();
        for (i, entry) in self.chain.iter().enumerate() {
            match self.chat_with_retries(entry, &req).await {
                Ok(turn) => {
                    let empty = turn.content.trim().is_empty() && turn.tool_calls.is_empty();
                    if empty && i + 1 < self.chain.len() {
                        tracing::warn!(
                            provider = %entry.label,
                            "réponse vide — fallback suivant"
                        );
                        errors.push(format!("{}: réponse vide", entry.label));
                        continue;
                    }
                    if i > 0 {
                        tracing::info!(provider = %entry.label, rank = i, "LLM fallback utilisé");
                    }
                    return Ok(turn);
                }
                Err(e) => {
                    tracing::warn!(
                        provider = %entry.label,
                        error = %e,
                        "LLM KO — fallback suivant"
                    );
                    if i + 1 < self.chain.len() {
                        notify("Bascule sur le modèle de secours…".to_string());
                    }
                    errors.push(format!("{}: {e}", entry.label));
                }
            }
        }
        Err(all_failed(&errors))
    }

    async fn chat_stream(
        &self,
        req: ChatRequest,
        on_delta: &DeltaSink<'_>,
    ) -> Result<AssistantTurn> {
        if self.chain.is_empty() {
            return Err(err("aucun provider LLM dans la chaîne"));
        }
        let emitted = AtomicBool::new(false);
        let sink = |d: &str| {
            emitted.store(true, Ordering::SeqCst);
            on_delta(d);
        };
        let mut errors: Vec<String> = Vec::new();
        for (i, entry) in self.chain.iter().enumerate() {
            match self.stream_with_retries(entry, &req, &sink, &emitted).await {
                Ok(turn) => {
                    let empty = turn.content.trim().is_empty() && turn.tool_calls.is_empty();
                    if empty && i + 1 < self.chain.len() && !emitted.load(Ordering::SeqCst) {
                        tracing::warn!(provider = %entry.label, "réponse vide — fallback suivant");
                        errors.push(format!("{}: réponse vide", entry.label));
                        continue;
                    }
                    if i > 0 {
                        tracing::info!(provider = %entry.label, rank = i, "LLM fallback utilisé");
                    }
                    return Ok(turn);
                }
                Err(e) => {
                    // Du texte est déjà parti vers l'utilisateur : pas de bascule (texte dupliqué).
                    if emitted.load(Ordering::SeqCst) {
                        tracing::warn!(provider = %entry.label, error = %e, "LLM KO après le premier morceau — pas de fallback");
                        return Err(e);
                    }
                    tracing::warn!(provider = %entry.label, error = %e, "LLM KO — fallback suivant");
                    if i + 1 < self.chain.len() {
                        notify("Bascule sur le modèle de secours…".to_string());
                    }
                    errors.push(format!("{}: {e}", entry.label));
                }
            }
        }
        Err(all_failed(&errors))
    }
}

fn all_failed(errors: &[String]) -> devforge_shared::DevForgeError {
    err(format!(
        "tous les providers ont échoué — {}",
        if errors.is_empty() {
            "chaîne vide".into()
        } else {
            errors.join(" | ")
        }
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::Mutex;

    /// Fournisseur scripté : chaque appel consomme une réponse (`Err(msg)` ou `Ok(contenu)`).
    struct Scripted {
        script: Mutex<VecDeque<std::result::Result<&'static str, &'static str>>>,
        calls: Mutex<u32>,
    }

    impl Scripted {
        fn new(items: Vec<std::result::Result<&'static str, &'static str>>) -> Arc<Self> {
            Arc::new(Self {
                script: Mutex::new(items.into()),
                calls: Mutex::new(0),
            })
        }
        fn calls(&self) -> u32 {
            *self.calls.lock().unwrap()
        }
    }

    #[async_trait]
    impl LlmProvider for Scripted {
        fn name(&self) -> &str {
            "scripted"
        }
        async fn chat(&self, _req: ChatRequest) -> Result<AssistantTurn> {
            *self.calls.lock().unwrap() += 1;
            match self.script.lock().unwrap().pop_front() {
                Some(Ok(c)) => Ok(AssistantTurn {
                    content: c.into(),
                    tool_calls: vec![],
                    finish_reason: "stop".into(),
                }),
                Some(Err(m)) => Err(err(m)),
                None => Err(err("LLM 500 Internal Server Error: fin du script")),
            }
        }
    }

    /// Fournisseur en streaming : émet `parts` puis renvoie `end` (Ok contenu complet / Err).
    struct Streamer {
        parts: Vec<&'static str>,
        end: std::result::Result<(), &'static str>,
        calls: Mutex<u32>,
    }

    #[async_trait]
    impl LlmProvider for Streamer {
        fn name(&self) -> &str {
            "streamer"
        }
        async fn chat(&self, _req: ChatRequest) -> Result<AssistantTurn> {
            Err(err("non utilisé"))
        }
        async fn chat_stream(
            &self,
            _req: ChatRequest,
            on_delta: &DeltaSink<'_>,
        ) -> Result<AssistantTurn> {
            *self.calls.lock().unwrap() += 1;
            for p in &self.parts {
                on_delta(p);
            }
            match self.end {
                Ok(()) => Ok(AssistantTurn {
                    content: self.parts.concat(),
                    tool_calls: vec![],
                    finish_reason: "stop".into(),
                }),
                Err(m) => Err(err(m)),
            }
        }
    }

    fn collect() -> (Arc<Mutex<Vec<String>>>, impl Fn(&str) + Send + Sync) {
        let seen = Arc::new(Mutex::new(Vec::<String>::new()));
        let s2 = seen.clone();
        (seen, move |d: &str| s2.lock().unwrap().push(d.to_string()))
    }

    #[tokio::test(start_paused = true)]
    async fn stream_error_before_first_delta_falls_back_without_duplicates() {
        let a = Arc::new(Streamer {
            parts: vec![],
            end: Err("LLM 401 Unauthorized: x"),
            calls: Mutex::new(0),
        });
        let b = Arc::new(Streamer {
            parts: vec!["Bon", "jour"],
            end: Ok(()),
            calls: Mutex::new(0),
        });
        let p = ResilientLlmProvider::new(vec![
            ChainEntry {
                label: "a".into(),
                provider: a.clone(),
            },
            ChainEntry {
                label: "b".into(),
                provider: b.clone(),
            },
        ]);
        let (seen, sink) = collect();
        let turn = p.chat_stream(req(), &sink).await.unwrap();
        assert_eq!(turn.content, "Bonjour");
        assert_eq!(seen.lock().unwrap().concat(), "Bonjour");
    }

    #[tokio::test(start_paused = true)]
    async fn stream_error_after_first_delta_is_returned_no_retry_no_fallback() {
        let a = Arc::new(Streamer {
            parts: vec!["Début"],
            end: Err("LLM 503 Service Unavailable: x"),
            calls: Mutex::new(0),
        });
        let b = Arc::new(Streamer {
            parts: vec!["secours"],
            end: Ok(()),
            calls: Mutex::new(0),
        });
        let p = ResilientLlmProvider::new(vec![
            ChainEntry {
                label: "a".into(),
                provider: a.clone(),
            },
            ChainEntry {
                label: "b".into(),
                provider: b.clone(),
            },
        ]);
        let (seen, sink) = collect();
        assert!(p.chat_stream(req(), &sink).await.is_err());
        assert_eq!(
            *a.calls.lock().unwrap(),
            1,
            "pas de nouvel essai après un morceau"
        );
        assert_eq!(
            *b.calls.lock().unwrap(),
            0,
            "pas de bascule après un morceau"
        );
        assert_eq!(seen.lock().unwrap().concat(), "Début");
    }

    #[tokio::test(start_paused = true)]
    async fn default_chat_stream_emits_one_delta() {
        let a = Scripted::new(vec![Ok("tout d'un bloc")]);
        let (seen, sink) = collect();
        let turn = a.chat_stream(req(), &sink).await.unwrap();
        assert_eq!(turn.content, "tout d'un bloc");
        assert_eq!(*seen.lock().unwrap(), vec!["tout d'un bloc".to_string()]);
    }

    fn req() -> ChatRequest {
        ChatRequest {
            messages: vec![],
            tools: vec![],
            temperature: 0.0,
        }
    }

    fn chain(a: Arc<Scripted>, b: Arc<Scripted>) -> ResilientLlmProvider {
        ResilientLlmProvider::new(vec![
            ChainEntry {
                label: "a".into(),
                provider: a,
            },
            ChainEntry {
                label: "b".into(),
                provider: b,
            },
        ])
    }

    #[tokio::test(start_paused = true)]
    async fn rate_limit_then_ok_stays_on_first_provider() {
        let a = Scripted::new(vec![Err("LLM 429 Too Many Requests: slow"), Ok("bonjour")]);
        let b = Scripted::new(vec![Ok("secours")]);
        let started = tokio::time::Instant::now();
        let turn = chain(a.clone(), b.clone()).chat(req()).await.unwrap();
        assert_eq!(turn.content, "bonjour");
        assert_eq!(a.calls(), 2);
        assert_eq!(b.calls(), 0);
        // base 600 ms ± 20 %
        let waited = started.elapsed();
        assert!(
            waited >= Duration::from_millis(480) && waited <= Duration::from_millis(720),
            "{waited:?}"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn three_server_errors_fall_back() {
        let a = Scripted::new(vec![
            Err("LLM 500 Internal Server Error: x"),
            Err("LLM 500 Internal Server Error: x"),
            Err("LLM 500 Internal Server Error: x"),
        ]);
        let b = Scripted::new(vec![Ok("secours")]);
        let turn = chain(a.clone(), b.clone()).chat(req()).await.unwrap();
        assert_eq!(turn.content, "secours");
        assert_eq!(a.calls(), 3);
        assert_eq!(b.calls(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn auth_error_switches_immediately() {
        let a = Scripted::new(vec![Err("LLM 401 Unauthorized: bad key")]);
        let b = Scripted::new(vec![Ok("secours")]);
        let started = tokio::time::Instant::now();
        let turn = chain(a.clone(), b.clone()).chat(req()).await.unwrap();
        assert_eq!(turn.content, "secours");
        assert_eq!(a.calls(), 1);
        assert_eq!(started.elapsed(), Duration::ZERO);
    }

    #[tokio::test(start_paused = true)]
    async fn retry_after_is_honoured_and_capped() {
        let a = Scripted::new(vec![
            Err("LLM 429 Too Many Requests (retry-after=30s): x"),
            Ok("ok"),
        ]);
        let b = Scripted::new(vec![]);
        let started = tokio::time::Instant::now();
        chain(a, b).chat(req()).await.unwrap();
        assert!(started.elapsed() <= Duration::from_secs(8));
        assert!(started.elapsed() >= Duration::from_millis(6_400));
    }

    #[tokio::test(start_paused = true)]
    async fn notifier_reports_retries() {
        let a = Scripted::new(vec![Err("LLM 503 Service Unavailable: x"), Ok("ok")]);
        let b = Scripted::new(vec![]);
        let seen = Arc::new(Mutex::new(Vec::<String>::new()));
        let s2 = seen.clone();
        let notifier: RetryNotifier = Arc::new(move |l| s2.lock().unwrap().push(l));
        let p = chain(a, b);
        with_retry_notifier(notifier, p.chat(req())).await.unwrap();
        assert_eq!(seen.lock().unwrap().len(), 1);
        assert!(seen.lock().unwrap()[0].contains("nouvel essai"));
    }
}
