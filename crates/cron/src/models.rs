use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::str::FromStr;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ProjectCron {
    pub id: String,
    pub project_uuid: String,
    pub name: String,
    pub cron_expression: String,
    pub command: String,
    pub enabled: i64,
    pub timezone: Option<String>,
    pub last_status: Option<String>,
    pub last_run_at: Option<String>,
    pub next_run_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct CronRun {
    pub id: String,
    pub cron_id: String,
    pub project_uuid: String,
    pub status: String,
    pub output: Option<String>,
    pub exit_code: Option<i64>,
    pub started_at: String,
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateCronRequest {
    pub name: String,
    pub cron_expression: String,
    pub command: String,
    pub enabled: Option<bool>,
    pub timezone: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCronRequest {
    pub name: Option<String>,
    pub cron_expression: Option<String>,
    pub command: Option<String>,
    pub enabled: Option<bool>,
    pub timezone: Option<String>,
}

/// Normalise une expression cron 5-champs (Unix standard) vers 6-champs (avec secondes).
fn normalize_cron_expression(expr: &str) -> String {
    let fields: Vec<&str> = expr.trim().split_whitespace().collect();
    if fields.len() == 5 {
        format!("0 {}", expr)
    } else {
        expr.to_string()
    }
}

/// Valide une expression cron (format standard Unix 5 ou 6 champs).
pub fn validate_cron_expression(expr: &str) -> Result<(), String> {
    let normalized = normalize_cron_expression(expr);
    cron::Schedule::from_str(&normalized)
        .map(|_| ())
        .map_err(|e| format!("Expression cron invalide : {}", e))
}

/// Calcule le prochain instant d'exécution pour une expression cron donnée.
pub fn next_run_time(expr: &str, timezone: Option<&str>) -> Option<DateTime<Utc>> {
    let normalized = normalize_cron_expression(expr);
    let schedule = cron::Schedule::from_str(&normalized).ok()?;
    let tz = timezone
        .and_then(|tz_str| tz_str.parse::<chrono_tz::Tz>().ok())
        .unwrap_or(chrono_tz::UTC);
    
    let _now = Utc::now().with_timezone(&tz);
    schedule.upcoming(tz).next().map(|dt| dt.with_timezone(&Utc))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_cron_expression() {
        assert!(validate_cron_expression("*/5 * * * *").is_ok());
        assert!(validate_cron_expression("0 0 * * *").is_ok());
        assert!(validate_cron_expression("0 */2 * * *").is_ok());
        assert!(validate_cron_expression("invalid").is_err());
    }

    #[test]
    fn test_next_run_time() {
        let expr = "*/5 * * * *";
        let next = next_run_time(expr, None);
        assert!(next.is_some());
    }
}
