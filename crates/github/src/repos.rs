//! P6-01 — Dépôts accessibles à une installation (`GET /installation/repositories`).

use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstallationRepo {
    pub id: i64,
    pub full_name: String,
    pub private: bool,
    pub default_branch: Option<String>,
}

pub fn parse_page(v: &Value) -> Vec<InstallationRepo> {
    v.get("repositories")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|r| {
            Some(InstallationRepo {
                id: r.get("id")?.as_i64()?,
                full_name: r.get("full_name")?.as_str()?.to_string(),
                private: r.get("private").and_then(Value::as_bool).unwrap_or(false),
                default_branch: r
                    .get("default_branch")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            })
        })
        .collect()
}

/// Toutes les pages (`per_page=100`, 50 pages max). Aucun token dans les erreurs.
pub async fn list_installation_repos(
    api: &str,
    token: &str,
) -> Result<Vec<InstallationRepo>, String> {
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .unwrap_or_default();
    let base = api.trim_end_matches('/');
    let mut out = Vec::new();
    for page in 1..=50u32 {
        let res = http
            .get(format!(
                "{base}/installation/repositories?per_page=100&page={page}"
            ))
            .bearer_auth(token)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .header("User-Agent", "devforge-server/2")
            .send()
            .await
            .map_err(|e| format!("GitHub injoignable : {}", e.without_url()))?;
        let status = res.status();
        if !status.is_success() {
            return Err(format!("GitHub a répondu {}", status.as_u16()));
        }
        let v: Value = res
            .json()
            .await
            .map_err(|_| "réponse GitHub illisible".to_string())?;
        let batch = parse_page(&v);
        let total = v.get("total_count").and_then(Value::as_u64);
        let n = batch.len();
        out.extend(batch);
        if n < 100 || total.is_some_and(|t| out.len() as u64 >= t) {
            break;
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn page(start: i64, n: i64) -> Value {
        let repos: Vec<Value> = (start..start + n)
            .map(|i| json!({"id": i, "full_name": format!("o/r{i}"), "private": i % 2 == 0, "default_branch": "main"}))
            .collect();
        json!({"total_count": 130, "repositories": repos})
    }

    #[tokio::test]
    async fn paginates_two_pages() {
        let gh = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/installation/repositories"))
            .and(query_param("page", "1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(page(1, 100)))
            .expect(1)
            .mount(&gh)
            .await;
        Mock::given(method("GET"))
            .and(path("/installation/repositories"))
            .and(query_param("page", "2"))
            .respond_with(ResponseTemplate::new(200).set_body_json(page(101, 30)))
            .expect(1)
            .mount(&gh)
            .await;
        let all = list_installation_repos(&gh.uri(), "ghs_x").await.unwrap();
        assert_eq!(all.len(), 130);
        assert_eq!(all[129].full_name, "o/r130");
        assert!(all[1].private);
    }

    #[tokio::test]
    async fn error_has_no_token() {
        let gh = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(401))
            .mount(&gh)
            .await;
        let e = list_installation_repos(&gh.uri(), "ghs_secret123")
            .await
            .unwrap_err();
        assert!(!e.contains("ghs_secret123"));
    }
}
