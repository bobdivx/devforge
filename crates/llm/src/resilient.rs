//! Fallback chain: try providers in priority order until one succeeds.
//! Chaque fournisseur a droit à quelques nouveaux essais sur 429 / 5xx / timeout (P1-09).

use async_trait::async_trait;
use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use crate::errors::{classify, LlmErrorKind};
use crate::{err, AssistantTurn, ChatRequest, LlmProvider, Result};

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
        Self { base: Duration::from_millis(600), max_delay: Duration::from_secs(8) }
    }
}

impl RetryPolicy {
    /// `min(retry_after | base·2^n, max)` avec ±20 % de gigue.
    pub fn delay(&self, kind: &LlmErrorKind, attempt: u32) -> Duration {
        let raw = match kind {
            LlmErrorKind::RateLimited { retry_after: Some(d) } => *d,
            _ => self.base.saturating_mul(1u32 << attempt.min(8)),
        };
        let capped = raw.min(self.max_delay);
        let jitter = (uuid::Uuid::new_v4().as_bytes()[0] as f64 / 255.0) * 0.4 - 0.2; // [-0.2, 0.2]
        let ms = (capped.as_millis() as f64 * (1.0 + jitter)).max(0.0) as u64;
        Duration::from_millis(ms).min(self.max_delay)
    }
}

/// Tries each provider in order. On error (or empty content without tools), falls through.
pub struct ResilientLlmProvider {
    chain: Vec<ChainEntry>,
    policy: RetryPolicy,
}

impl ResilientLlmProvider {
    pub fn new(chain: Vec<ChainEntry>) -> Self {
        Self { chain, policy: RetryPolicy::default() }
    }

    pub fn with_policy(mut self, policy: RetryPolicy) -> Self {
        self.policy = policy;
        self
    }

    pub fn labels(&self) -> Vec<String> {
        self.chain.iter().map(|e| e.label.clone()).collect()
    }

    /// Un fournisseur, avec ses nouveaux essais.
    async fn chat_with_retries(&self, entry: &ChainEntry, req: &ChatRequest) -> Result<AssistantTurn> {
        let mut attempt: u32 = 0;
        loop {
            match entry.provider.chat(req.clone()).await {
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
                    notify(match kind {
                        LlmErrorKind::RateLimited { .. } => "Modèle saturé, nouvel essai…".to_string(),
                        LlmErrorKind::Timeout => "Le modèle tarde, nouvel essai…".to_string(),
                        _ => "Modèle indisponible, nouvel essai…".to_string(),
                    });
                    tokio::time::sleep(delay).await;
                    attempt += 1;
                }
            }
        }
    }
}

#[async_trait]
impl LlmProvider for ResilientLlmProvider {
    fn name(&self) -> &str {
        "resilient"
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
        Err(err(format!(
            "tous les providers ont échoué — {}",
            if errors.is_empty() {
                "chaîne vide".into()
            } else {
                errors.join(" | ")
            }
        )))
    }
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
            Arc::new(Self { script: Mutex::new(items.into()), calls: Mutex::new(0) })
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
                Some(Ok(c)) => Ok(AssistantTurn { content: c.into(), tool_calls: vec![], finish_reason: "stop".into() }),
                Some(Err(m)) => Err(err(m)),
                None => Err(err("LLM 500 Internal Server Error: fin du script")),
            }
        }
    }

    fn req() -> ChatRequest {
        ChatRequest { messages: vec![], tools: vec![], temperature: 0.0 }
    }

    fn chain(a: Arc<Scripted>, b: Arc<Scripted>) -> ResilientLlmProvider {
        ResilientLlmProvider::new(vec![
            ChainEntry { label: "a".into(), provider: a },
            ChainEntry { label: "b".into(), provider: b },
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
        assert!(waited >= Duration::from_millis(480) && waited <= Duration::from_millis(720), "{waited:?}");
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
        let a = Scripted::new(vec![Err("LLM 429 Too Many Requests (retry-after=30s): x"), Ok("ok")]);
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
