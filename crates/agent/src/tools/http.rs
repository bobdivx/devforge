use async_trait::async_trait;
use devforge_shared::{Result, Tool};
use serde_json::{json, Value};
use std::time::{Duration, Instant};

pub struct HttpSmokeTool;

/// Erreur réseau transitoire (connexion, délai) : vaut un nouvel essai.
fn transient(e: &reqwest::Error) -> bool {
    e.is_connect() || e.is_timeout() || e.is_request()
}

/// GET avec un nouvel essai sur erreur réseau transitoire (outils HTTP sortants).
pub(crate) async fn get_with_retry(client: &reqwest::Client, url: &str) -> reqwest::Result<reqwest::Response> {
    match client.get(url).send().await {
        Err(e) if transient(&e) => {
            tokio::time::sleep(Duration::from_millis(800)).await;
            client.get(url).send().await
        }
        other => other,
    }
}

fn extract_title(body: &str) -> Option<String> {
    let lower = body.to_lowercase();
    let start = lower.find("<title")?;
    let open_end = lower[start..].find('>')? + start + 1;
    let close = lower[open_end..].find("</title>")? + open_end;
    let t = body.get(open_end..close)?.split_whitespace().collect::<Vec<_>>().join(" ");
    if t.is_empty() { None } else { Some(t.chars().take(160).collect()) }
}

/// GET avec suivi des redirections (reqwest : 10 max), 1 nouvel essai sur erreur réseau transitoire.
pub async fn smoke_url(url: &str, expect_text: Option<&str>) -> Value {
    smoke_url_with(url, expect_text, Duration::from_secs(10)).await
}

pub(crate) async fn smoke_url_with(url: &str, expect_text: Option<&str>, timeout: Duration) -> Value {
    let url = url.trim();
    if url.is_empty() || !(url.starts_with("http://") || url.starts_with("https://")) {
        return json!({"ok": false, "error": "URL invalide", "url": url});
    }
    let client = match reqwest::Client::builder()
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::limited(10))
        .user_agent("DevForge-Agent/2.0")
        .build()
    {
        Ok(c) => c,
        Err(e) => return json!({"ok": false, "error": e.to_string(), "url": url}),
    };
    let started = Instant::now();
    let mut attempt = 0;
    let res = loop {
        match client.get(url).send().await {
            Ok(r) => break Ok(r),
            Err(e) if attempt == 0 && transient(&e) => {
                attempt += 1;
                tokio::time::sleep(Duration::from_millis(800)).await;
            }
            Err(e) => break Err(e),
        }
    };
    match res {
        Ok(r) => {
            let status = r.status().as_u16();
            let final_url = r.url().to_string();
            let body = r.text().await.unwrap_or_default();
            let elapsed_ms = started.elapsed().as_millis() as u64;
            let excerpt: String = body.chars().take(500).collect();
            let status_ok = (200..400).contains(&status);
            let text_ok = expect_text.map(|t| body.contains(t));
            let mut out = json!({
                "ok": status_ok && text_ok.unwrap_or(true),
                "status": status,
                "url": url,
                "final_url": final_url,
                "elapsed_ms": elapsed_ms,
                "title": extract_title(&body),
                "excerpt": excerpt,
                "retried": attempt > 0
            });
            if let (Some(t), Some(found)) = (expect_text, text_ok) {
                out["expect_text"] = json!(t);
                out["expect_text_found"] = json!(found);
            }
            out
        }
        Err(e) => json!({
            "ok": false,
            "error": e.to_string(),
            "url": url,
            "elapsed_ms": started.elapsed().as_millis() as u64,
            "retried": attempt > 0
        }),
    }
}

#[async_trait]
impl Tool for HttpSmokeTool {
    fn name(&self) -> &str {
        "http_smoke"
    }
    fn description(&self) -> &str {
        "Smoke HTTP GET sur une URL publique : status (après redirections), titre de la page, durée, extrait. Option expect_text : texte attendu dans la page."
    }
    fn parameters(&self) -> Value {
        json!({
            "type":"object",
            "properties":{
                "url":{"type":"string"},
                "expect_text":{"type":"string","description":"Optionnel : texte qui doit apparaître dans la réponse"}
            },
            "required":["url"]
        })
    }
    async fn execute(&self, arguments: Value) -> Result<Value> {
        let url = arguments.get("url").and_then(|v| v.as_str()).unwrap_or("");
        let expect = arguments
            .get("expect_text")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty());
        Ok(smoke_url(url, expect).await)
    }
}

/// Décision post-déploiement (côté serveur, indépendante du LLM) :
/// `Some(diagnostic)` si l'URL publique est KO (5xx ou injoignable).
/// 401/403/404 : l'application répond (auth, API sans page d'accueil) → pas une panne.
pub fn post_deploy_verdict(smoke: &Value) -> Option<String> {
    match smoke.get("status").and_then(|v| v.as_u64()) {
        Some(s) if s >= 500 => Some(format!("Déployé mais l'URL répond {s}")),
        Some(_) => None,
        None => {
            let err = smoke.get("error").and_then(|v| v.as_str()).unwrap_or("injoignable");
            Some(format!("Déployé mais l'URL est injoignable ({})", err.chars().take(120).collect::<String>()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    async fn serve(status: &'static str, body: &'static str, delay: Duration) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            while let Ok((mut sock, _)) = listener.accept().await {
                let mut buf = [0u8; 2048];
                let _ = sock.read(&mut buf).await;
                tokio::time::sleep(delay).await;
                let resp = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = sock.write_all(resp.as_bytes()).await;
            }
        });
        format!("http://{addr}/")
    }

    #[tokio::test]
    async fn smoke_200_with_title_and_expect_text() {
        let url = serve("200 OK", "<html><head><title> Mon  site </title></head><body>Bonjour</body></html>", Duration::ZERO).await;
        let r = smoke_url(&url, Some("Bonjour")).await;
        assert_eq!(r["ok"], true, "{r}");
        assert_eq!(r["status"], 200);
        assert_eq!(r["title"], "Mon site");
        assert_eq!(r["expect_text_found"], true);
        assert!(r["elapsed_ms"].is_u64());
        assert!(post_deploy_verdict(&r).is_none());
        let missing = smoke_url(&url, Some("Absent")).await;
        assert_eq!(missing["ok"], false);
    }

    #[tokio::test]
    async fn smoke_502_is_a_post_deploy_failure() {
        let url = serve("502 Bad Gateway", "bad gateway", Duration::ZERO).await;
        let r = smoke_url(&url, None).await;
        assert_eq!(r["ok"], false);
        assert_eq!(r["status"], 502);
        assert_eq!(post_deploy_verdict(&r).as_deref(), Some("Déployé mais l'URL répond 502"));
    }

    #[tokio::test]
    async fn smoke_timeout_is_reported() {
        let url = serve("200 OK", "lent", Duration::from_secs(5)).await;
        let r = smoke_url_with(&url, None, Duration::from_millis(300)).await;
        assert_eq!(r["ok"], false, "{r}");
        assert!(r.get("status").is_none());
        assert!(post_deploy_verdict(&r).unwrap().contains("injoignable"));
    }

    #[test]
    fn verdict_tolerates_auth_pages() {
        assert!(post_deploy_verdict(&json!({"status": 401})).is_none());
        assert!(post_deploy_verdict(&json!({"status": 302})).is_none());
    }
}
