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
    /// `command` (docker exec) | `agent` (routine exécutée par un agent, P5-05).
    #[sqlx(default)]
    pub kind: Option<String>,
    #[sqlx(default)]
    pub agent_uuid: Option<String>,
    #[sqlx(default)]
    pub prompt: Option<String>,
    /// `user` | `agent:<uuid>`.
    #[sqlx(default)]
    pub created_by: Option<String>,
    /// `always` | `on_change` | `on_failure`.
    #[sqlx(default)]
    pub notify: Option<String>,
    #[sqlx(default)]
    pub last_summary_hash: Option<String>,
}

impl ProjectCron {
    pub fn is_agent_routine(&self) -> bool {
        self.kind.as_deref() == Some("agent")
    }
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
    schedule
        .upcoming(tz)
        .next()
        .map(|dt| dt.with_timezone(&Utc))
}

/// Fuseau IANA connu (ex. « Europe/Paris »).
pub fn timezone_is_known(tz: &str) -> bool {
    tz.parse::<chrono_tz::Tz>().is_ok()
}

/// Plus petit écart (minutes) entre deux déclenchements sur les ~200 prochains (fréquence réelle).
pub fn min_interval_minutes(expr: &str) -> Option<i64> {
    let normalized = normalize_cron_expression(expr);
    let schedule = cron::Schedule::from_str(&normalized).ok()?;
    let times: Vec<DateTime<Utc>> = schedule.upcoming(Utc).take(200).collect();
    times.windows(2).map(|w| (w[1] - w[0]).num_minutes()).min()
}

/// Expression à 5 champs exactement (minute heure jour mois jour-semaine).
pub fn is_five_fields(expr: &str) -> bool {
    expr.split_whitespace().count() == 5
}

/// Faut-il poster le résultat d'une routine dans le fil ? (`on_change` : seulement si le résumé change.)
pub fn should_notify(
    notify: &str,
    previous_hash: Option<&str>,
    new_hash: &str,
    failed: bool,
) -> bool {
    match notify {
        "always" => true,
        "on_failure" => failed,
        // on_change (défaut) : premier passage, ou résultat différent du précédent.
        _ => previous_hash != Some(new_hash),
    }
}

/// Empreinte stable d'un résumé (chiffres et horodatages ignorés : « 200 en 120 ms » ≈ « 200 en 98 ms »).
pub fn summary_hash(summary: &str) -> String {
    let mut digits_folded = String::with_capacity(summary.len());
    for c in summary.to_lowercase().chars() {
        if c.is_ascii_digit() {
            if !digits_folded.ends_with('#') {
                digits_folded.push('#');
            }
        } else {
            digits_folded.push(c);
        }
    }
    let norm: String = digits_folded
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    // FNV-1a 64 bits : suffisant pour comparer deux résumés successifs.
    let mut h: u64 = 0xcbf29ce484222325;
    for b in norm.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
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
    fn on_change_logic() {
        let a = summary_hash("OK : popcornn.app répond 200 en 120 ms");
        let b = summary_hash("OK : popcornn.app répond 200 en 98 ms");
        let c = summary_hash("ÉCHEC : popcornn.app répond 502");
        assert_eq!(a, b, "les chiffres ne comptent pas");
        assert_ne!(a, c);
        assert!(
            should_notify("on_change", None, &a, false),
            "premier passage"
        );
        assert!(!should_notify("on_change", Some(&a), &b, false));
        assert!(should_notify("on_change", Some(&a), &c, true));
        assert!(!should_notify("on_failure", None, &a, false));
        assert!(should_notify("on_failure", Some(&a), &a, true));
        assert!(should_notify("always", Some(&a), &a, false));
    }

    #[test]
    fn min_interval() {
        assert_eq!(min_interval_minutes("*/15 * * * *"), Some(15));
        assert_eq!(min_interval_minutes("*/5 * * * *"), Some(5));
        assert_eq!(min_interval_minutes("0 8 * * *"), Some(24 * 60));
        assert_eq!(min_interval_minutes("0,10 8 * * *"), Some(10));
        assert!(min_interval_minutes("nope").is_none());
    }

    #[test]
    fn test_next_run_time() {
        let expr = "*/5 * * * *";
        let next = next_run_time(expr, None);
        assert!(next.is_some());
    }
}
