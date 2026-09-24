use async_trait::async_trait;
use devforge_shared::{Result, Tool};
use serde_json::{json, Value};
use sqlx::PgPool;
use std::path::Path;
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

/// Commandes shell allowlistées dans le workdir projet (pas de shell libre).
pub struct RunWorkdirCommandTool {
    pub pool: Arc<PgPool>,
}

const ALLOWED_BINS: &[&str] = &[
    "npm", "pnpm", "yarn", "bun", "node", "npx", "astro", "tsc", "vite", "eslint", "prettier",
];

const BLOCKED_TOKENS: &[&str] = &[
    ";", "&&", "||", "|", "`", "$(", "${", ">", "<", "\n", "\r", "sudo", "rm ", "rm\t", "chmod",
    "chown", "curl", "wget", "ssh", "scp", "/bin/", "/usr/bin/", "../",
];

fn validate_command(raw: &str) -> std::result::Result<Vec<String>, String> {
    let cmd = raw.trim();
    if cmd.is_empty() {
        return Err("command vide".into());
    }
    if cmd.len() > 400 {
        return Err("command trop longue (max 400)".into());
    }
    let lower = cmd.to_ascii_lowercase();
    for bad in BLOCKED_TOKENS {
        if lower.contains(bad) {
            return Err(format!("token interdit dans la commande : {bad}"));
        }
    }
    let parts = shell_words_split(cmd);
    if parts.is_empty() {
        return Err("command invalide".into());
    }
    let bin = parts[0].as_str();
    let bin_base = Path::new(bin)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(bin);
    if !ALLOWED_BINS.iter().any(|b| *b == bin_base) {
        return Err(format!(
            "binaire non autorisé « {bin_base} ». Allowlist : {}",
            ALLOWED_BINS.join(", ")
        ));
    }
    if matches!(bin_base, "npm" | "pnpm" | "yarn" | "bun") {
        let joined = parts.join(" ").to_ascii_lowercase();
        if joined.contains("publish") || joined.contains("login") || joined.contains("adduser") {
            return Err("commande package-manager sensible interdite".into());
        }
    }
    Ok(parts)
}

fn shell_words_split(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_single = false;
    let mut in_double = false;
    for c in s.chars() {
        match c {
            '\'' if !in_double => in_single = !in_single,
            '"' if !in_single => in_double = !in_double,
            ' ' | '\t' if !in_single && !in_double => {
                if !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                }
            }
            _ => cur.push(c),
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

#[async_trait]
impl Tool for RunWorkdirCommandTool {
    fn name(&self) -> &str {
        "run_workdir_command"
    }

    fn description(&self) -> &str {
        "Exécute une commande allowlistée dans le workdir du projet (npm/pnpm/yarn/bun/node/npx/astro/tsc/vite…).\n\
         PAS de shell libre, PAS de MCP workdir. Pour la preview utilise start_local_preview (npm install inclus).\n\
         Exemples : `npm run build`, `npx tsc --noEmit`, `npm test`."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_uuid": { "type": "string" },
                "command": {
                    "type": "string",
                    "description": "Commande allowlistée, ex. npm run build"
                },
                "timeout_secs": {
                    "type": "integer",
                    "description": "Timeout secondes (défaut 120, max 300)"
                }
            },
            "required": ["project_uuid", "command"]
        })
    }

    async fn execute(&self, arguments: Value) -> Result<Value> {
        let project_uuid = arguments
            .get("project_uuid")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let command_raw = arguments
            .get("command")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let timeout = arguments
            .get("timeout_secs")
            .and_then(|v| v.as_u64())
            .unwrap_or(120)
            .clamp(5, 300);

        if project_uuid.is_empty() {
            return Ok(json!({"ok": false, "error": "project_uuid requis"}));
        }

        let parts = match validate_command(command_raw) {
            Ok(p) => p,
            Err(e) => {
                return Ok(json!({
                    "ok": false,
                    "error": e,
                    "hint": "Utilise npm/pnpm/yarn/node/npx/astro… sans pipes ni redirections. Pour la preview : start_local_preview."
                }));
            }
        };

        let project: Option<(String, Option<String>)> = sqlx::query_as(
            "SELECT uuid, workdir FROM projects WHERE uuid = $1",
        )
        .bind(project_uuid)
        .fetch_optional(self.pool.as_ref())
        .await
        .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;

        let Some((uuid, workdir_opt)) = project else {
            return Ok(json!({
                "ok": false,
                "error": format!("Projet introuvable : {project_uuid}")
            }));
        };

        let mut workdir_raw = workdir_opt.as_deref().unwrap_or("").trim().to_string();
        if workdir_raw.is_empty() {
            workdir_raw = format!("/data/devforge/applications/{uuid}");
        }
        let workdir = devforge_deploy::resolve_project_workdir(&workdir_raw, &uuid);
        let workdir_path = Path::new(&workdir);
        if !workdir_path.exists() {
            return Ok(json!({
                "ok": false,
                "error": format!("Workdir introuvable : {workdir}"),
            }));
        }

        let bin = parts[0].clone();
        let args = parts[1..].to_vec();
        let wd = workdir.clone();
        let joined = parts.join(" ");

        let run = tokio::time::timeout(
            Duration::from_secs(timeout),
            tokio::task::spawn_blocking(move || {
                Command::new(&bin)
                    .args(&args)
                    .current_dir(&wd)
                    .env("CI", "true")
                    .output()
            }),
        )
        .await;

        let output = match run {
            Ok(Ok(Ok(o))) => o,
            Ok(Ok(Err(e))) => {
                return Ok(json!({
                    "ok": false,
                    "error": format!("échec spawn : {e}"),
                    "command": joined,
                    "workdir": workdir,
                }));
            }
            Ok(Err(e)) => {
                return Ok(json!({
                    "ok": false,
                    "error": format!("join error : {e}"),
                    "command": joined,
                    "workdir": workdir,
                }));
            }
            Err(_) => {
                return Ok(json!({
                    "ok": false,
                    "error": format!("timeout après {timeout}s"),
                    "command": joined,
                    "workdir": workdir,
                }));
            }
        };

        let code = output.status.code().unwrap_or(-1);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let trim = |s: &str| -> String {
            let t: String = s.chars().take(8000).collect();
            if s.chars().count() > 8000 {
                format!("{t}\n… (tronqué)")
            } else {
                t
            }
        };
        let combined = format!("{stdout}{stderr}");

        Ok(json!({
            "ok": output.status.success(),
            "command": joined,
            "workdir": workdir,
            "exit_code": code,
            "stdout": trim(&stdout),
            "stderr": trim(&stderr),
            "logs_tail": trim(&combined),
            "message": if output.status.success() {
                format!("✓ `{joined}` exit {code}")
            } else {
                format!("✗ `{joined}` exit {code}")
            }
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_npm_run_build() {
        let p = validate_command("npm run build").unwrap();
        assert_eq!(p[0], "npm");
    }

    #[test]
    fn blocks_pipe() {
        assert!(validate_command("npm run build | cat").is_err());
    }

    #[test]
    fn blocks_curl() {
        assert!(validate_command("curl https://x").is_err());
    }
}
