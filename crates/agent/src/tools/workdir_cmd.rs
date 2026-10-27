use async_trait::async_trait;
use devforge_shared::{Result, Tool};
use serde_json::{json, Value};
use sqlx::PgPool;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

/// Commandes shell allowlistées dans le workdir projet (pas de shell libre).
pub struct RunWorkdirCommandTool {
    pub pool: Arc<PgPool>,
}

const ALLOWED_BINS: &[&str] = &[
    "npm", "pnpm", "yarn", "bun", "node", "npx", "astro", "tsc", "vite", "eslint", "prettier",
    "git", "cat", "grep",
];

/// Sous-commandes git en lecture seule (diagnostic).
const GIT_READ_ONLY: &[&str] = &[
    "status",
    "diff",
    "log",
    "show",
    "blame",
    "ls-files",
    "rev-parse",
    "branch",
    "grep",
];

/// Lecture seule pour le diagnostic : git (sous-commandes sûres), cat, grep. Jamais de fichiers secrets.
fn validate_read_only(bin: &str, parts: &[String]) -> std::result::Result<(), String> {
    for a in &parts[1..] {
        let l = a.to_ascii_lowercase();
        if a.starts_with('/')
            || a.starts_with('~')
            || l.contains("..")
            || l.contains(".env")
            || l.contains("secret")
            || l.contains(".git/")
        {
            return Err(format!("argument interdit en lecture : {a}"));
        }
    }
    if bin == "git" {
        let sub = parts.get(1).map(|s| s.as_str()).unwrap_or("");
        if !GIT_READ_ONLY.contains(&sub) {
            return Err(format!(
                "git : seules les sous-commandes en lecture sont permises ({})",
                GIT_READ_ONLY.join(", ")
            ));
        }
        if parts.iter().any(|p| {
            p == "-c"
                || p.starts_with("--output")
                || p == "-D"
                || p == "-d"
                || p == "-m"
                || p == "-M"
                || p.starts_with("--set")
                || p.starts_with("--delete")
        }) {
            return Err("git : option d'écriture interdite".into());
        }
    }
    Ok(())
}

const BLOCKED_TOKENS: &[&str] = &[
    ";",
    "&&",
    "||",
    "|",
    "`",
    "$(",
    "${",
    ">",
    "<",
    "\n",
    "\r",
    "sudo",
    "rm ",
    "rm\t",
    "chmod",
    "chown",
    "curl",
    "wget",
    "ssh",
    "scp",
    "/bin/",
    "/usr/bin/",
    "../",
];

fn validate_command(raw: &str) -> std::result::Result<Vec<String>, String> {
    let cmd = raw.trim();
    if cmd.is_empty() {
        return Err("command vide".into());
    }
    if cmd.len() > 400 {
        return Err("command trop longue (max 400)".into());
    }
    let parts = shell_words_split(cmd);
    if parts.is_empty() {
        return Err("command invalide".into());
    }
    for part in &parts {
        let lower = part.to_ascii_lowercase();
        for bad in BLOCKED_TOKENS {
            let bad_trimmed = bad.trim();
            // Block if the token exactly matches the trimmed bad token OR if it contains the full bad token.
            if lower == bad_trimmed || lower.contains(bad) {
                return Err(format!("token interdit dans la commande : {bad_trimmed}"));
            }
        }
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
    if matches!(bin_base, "git" | "cat" | "grep") {
        validate_read_only(bin_base, &parts)?;
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

        let project: Option<(String, Option<String>)> =
            sqlx::query_as("SELECT uuid, workdir FROM projects WHERE uuid = $1")
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

        // P4-05 : processus tué (avec ses enfants) au timeout ou à l'annulation du run
        // (le futur est abandonné → `KillGroupOnDrop`).
        let run =
            tokio::time::timeout(Duration::from_secs(timeout), run_killable(&bin, &args, &wd))
                .await;
        let run = run.map(Ok::<_, std::io::Error>);
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
                    "error": format!("erreur : {e}"),
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
    fn read_only_diagnosis() {
        assert!(validate_command("git status").is_ok());
        assert!(validate_command("git log --oneline -5").is_ok());
        assert!(validate_command("cat src/main.ts").is_ok());
        assert!(validate_command("grep -rn TURSO src").is_ok());
        assert!(validate_command("git push").is_err());
        assert!(validate_command("git -c x=y status").is_err());
        assert!(validate_command("cat .env").is_err());
        assert!(validate_command("cat /etc/passwd").is_err());
        assert!(validate_command("cat \"..\"/\"..\"/etc/passwd").is_err());
        assert!(validate_command("git branch -D main").is_err());
    }

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

    #[test]
    fn blocks_obfuscated_commands() {
        assert!(validate_command("npm run \"s\"udo").is_err());
        assert!(validate_command("cat \"..\"/\"..\"/etc/passwd").is_err());
    }
}

/// Tue le groupe de processus (npm et ses scripts enfants) si le futur est abandonné.
struct KillGroupOnDrop {
    #[cfg_attr(not(unix), allow(dead_code))]
    pid: Option<u32>,
    done: bool,
}

impl Drop for KillGroupOnDrop {
    fn drop(&mut self) {
        if self.done {
            return;
        }
        #[cfg(unix)]
        if let Some(pid) = self.pid {
            // SAFETY: killpg sur le groupe créé pour ce seul enfant (process_group(0)).
            unsafe {
                libc::killpg(pid as libc::pid_t, libc::SIGKILL);
            }
        }
    }
}

pub(crate) async fn run_killable(
    bin: &str,
    args: &[String],
    wd: &str,
) -> std::io::Result<std::process::Output> {
    let mut cmd = tokio::process::Command::new(bin);
    cmd.args(args)
        .current_dir(wd)
        .env("CI", "true")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    cmd.process_group(0);
    let child = cmd.spawn()?;
    let mut guard = KillGroupOnDrop {
        pid: child.id(),
        done: false,
    };
    let out = child.wait_with_output().await;
    guard.done = true;
    out
}

#[cfg(all(test, unix))]
mod kill_tests {
    use super::*;

    #[tokio::test]
    async fn dropping_the_future_kills_the_process_group() {
        let dir = std::env::temp_dir();
        let marker = dir.join(format!("df-kill-{}", std::process::id()));
        let _ = std::fs::remove_file(&marker);
        let script = format!("sleep 2; touch {}", marker.display());
        let argv = ["-c".to_string(), script];
        let fut = run_killable("sh", &argv, dir.to_str().unwrap());
        let r = tokio::time::timeout(Duration::from_millis(300), fut).await;
        assert!(r.is_err(), "doit être interrompu");
        tokio::time::sleep(Duration::from_millis(2500)).await;
        assert!(
            !marker.exists(),
            "le processus enfant a été tué avant d'écrire"
        );
    }
}
