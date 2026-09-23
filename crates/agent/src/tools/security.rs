//! Revue sécurité bornée : secrets masqués, dépendances, motifs statiques, en-têtes du projet.
//! Pas un pentest. Aucun exploit, aucun secret en clair dans le résultat.

use async_trait::async_trait;
use devforge_shared::{Result, Tool};
use regex::Regex;
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::PgPool;
use std::path::{Path, PathBuf};
use std::sync::Arc;

const SKIP_DIR_NAMES: &[&str] = &[
    ".git",
    "node_modules",
    "dist",
    "build",
    "target",
    ".astro",
    ".next",
    ".vercel",
    ".cache",
    "vendor",
    "__pycache__",
];
const LOCKFILES: &[&str] = &[
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "cargo.lock",
    "bun.lock",
    "bun.lockb",
];
const STATIC_EXT: &[&str] = &[
    "js", "jsx", "mjs", "cjs", "ts", "tsx", "vue", "svelte", "astro", "html", "htm", "php", "py",
    "rb",
];
const MAX_FILES: usize = 400;
const MAX_FILE_BYTES: u64 = 256_000;
const MAX_FINDINGS: usize = 40;

#[derive(Debug, Clone, Serialize)]
struct Finding {
    severity: String,
    category: String,
    rule: String,
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    line: Option<usize>,
    message: String,
}

struct SecretRule {
    rule: &'static str,
    severity: &'static str,
    message: &'static str,
    pattern: Regex,
}

pub struct ReviewProjectSecurityTool {
    pub pool: Arc<PgPool>,
}

#[async_trait]
impl Tool for ReviewProjectSecurityTool {
    fn name(&self) -> &str {
        "review_project_security"
    }

    fn description(&self) -> &str {
        "Revue sécurité STATIQUE du projet, uniquement sur demande explicite.\n\
         Couvre : secrets dans le workdir (valeurs masquées), manifests de dépendances, \
         motifs risqués dans le code, en-têtes HTTP du projet (URL de prod et preview).\n\
         Ce n'est pas un pentest : pas d'exploit, pas de scan d'URL arbitraire.\n\
         Paramètre : project_uuid (injecté)."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_uuid": {
                    "type": "string",
                    "description": "UUID du projet (injecté automatiquement)"
                }
            },
            "required": ["project_uuid"]
        })
    }

    async fn execute(&self, arguments: Value) -> Result<Value> {
        let project_uuid = arguments
            .get("project_uuid")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        if project_uuid.is_empty() {
            return Ok(json!({"ok": false, "error": "project_uuid requis"}));
        }

        let project: Option<(String, Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT uuid, workdir, production_url FROM projects WHERE uuid = $1",
        )
        .bind(project_uuid)
        .fetch_optional(self.pool.as_ref())
        .await
        .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;

        let Some((uuid, workdir_opt, production_url)) = project else {
            return Ok(json!({
                "ok": false,
                "error": format!("Projet introuvable : {project_uuid}")
            }));
        };

        let workdir_raw = workdir_opt.as_deref().unwrap_or("").trim();
        if workdir_raw.is_empty() {
            return Ok(json!({
                "ok": false,
                "error": "Le projet n'a pas de workdir configuré."
            }));
        }

        let workdir = devforge_deploy::resolve_project_workdir(workdir_raw, &uuid);
        let root = PathBuf::from(&workdir);
        if !root.is_dir() {
            return Ok(json!({
                "ok": false,
                "error": format!("Workdir introuvable : {workdir}")
            }));
        }

        let mut report = scan_tree(&root);
        let mut headers_checked: Vec<String> = Vec::new();
        let mut header_notes: Vec<String> = Vec::new();

        if let Some(url) = production_url.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            push_header_check(&mut report, &mut headers_checked, &mut header_notes, url).await;
        }
        match preview_url(self.pool.as_ref(), &uuid).await {
            Ok(Some(url)) => {
                push_header_check(&mut report, &mut headers_checked, &mut header_notes, &url).await;
            }
            Ok(None) => {}
            Err(e) => header_notes.push(format!("preview : {e}")),
        }

        sort_and_cap(&mut report);
        let (high, medium, low) = tally(&report.findings);

        Ok(json!({
            "ok": true,
            "kind": "static_review",
            "workdir": workdir,
            "files_scanned": report.files_scanned,
            "truncated": report.truncated,
            "headers_checked": headers_checked,
            "header_notes": header_notes,
            "summary": { "high": high, "medium": medium, "low": low, "total": report.findings.len() },
            "findings": report.findings,
            "note": "Revue statique bornée. Les secrets sont masqués. Ce n'est pas un pentest : ne décris pas comment exploiter un finding."
        }))
    }
}

struct ScanReport {
    files_scanned: usize,
    truncated: bool,
    findings: Vec<Finding>,
}

fn scan_tree(root: &Path) -> ScanReport {
    let mut files = Vec::new();
    let mut truncated = false;
    collect(&root, &root, &mut files, &mut truncated);
    let gitignore = std::fs::read_to_string(root.join(".gitignore")).unwrap_or_default();
    let env_ignored = gitignore_covers_env(&gitignore);
    let rules = secret_rules();
    let mut findings = Vec::new();

    for path in &files {
        if findings.len() >= MAX_FINDINGS {
            truncated = true;
            break;
        }
        let rel = path
            .strip_prefix(root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        if is_env_file(&name) {
            let (severity, message) = if env_ignored {
                (
                    "low",
                    "Fichier d'environnement présent sur le disque et couvert par .gitignore. Les valeurs ne sont pas lues.",
                )
            } else {
                (
                    "high",
                    "Fichier d'environnement présent et non exclu par .gitignore. Ne le versionne pas. Les valeurs ne sont pas lues.",
                )
            };
            findings.push(Finding {
                severity: severity.into(),
                category: "secret".into(),
                rule: "env_file".into(),
                path: rel,
                line: None,
                message: message.into(),
            });
            continue;
        }

        if LOCKFILES.iter().any(|n| name.eq_ignore_ascii_case(n)) {
            continue;
        }

        let meta = match std::fs::metadata(path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.len() > MAX_FILE_BYTES {
            truncated = true;
            continue;
        }
        let bytes = match std::fs::read(path) {
            Ok(b) => b,
            Err(_) => continue,
        };
        if bytes.contains(&0) {
            continue;
        }
        let text = String::from_utf8_lossy(&bytes);

        if name == "package.json" {
            scan_package_json(&rel, path, &text, &mut findings);
        } else if name.eq_ignore_ascii_case("Cargo.toml") {
            scan_cargo_toml(&rel, &text, &mut findings);
        } else if name == "requirements.txt" {
            scan_requirements(&rel, &text, &mut findings);
        }

        if !is_minified(&text) {
            scan_secrets(&rel, &text, &rules, &mut findings);
            if has_static_ext(&name) {
                scan_static(&rel, &text, &mut findings);
            }
        }
    }

    ScanReport {
        files_scanned: files.len(),
        truncated,
        findings,
    }
}

fn collect(root: &Path, current: &Path, out: &mut Vec<PathBuf>, truncated: &mut bool) {
    if out.len() >= MAX_FILES {
        *truncated = true;
        return;
    }
    let Ok(entries) = std::fs::read_dir(current) else {
        return;
    };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        if out.len() >= MAX_FILES {
            *truncated = true;
            break;
        }
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if SKIP_DIR_NAMES.iter().any(|d| name_str.eq_ignore_ascii_case(d)) {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            collect(root, &path, out, truncated);
        } else if path.is_file() {
            out.push(path);
        }
    }
}

fn secret_rules() -> Vec<SecretRule> {
    let compile = |p: &str| Regex::new(p).expect("regex secret");
    vec![
        SecretRule {
            rule: "aws_access_key",
            severity: "high",
            message: "Jeton AWS détecté (masqué). Retire-le du dépôt et fais-le tourner.",
            pattern: compile(r"\bAKIA[0-9A-Z]{16}\b"),
        },
        SecretRule {
            rule: "github_token",
            severity: "high",
            message: "Jeton GitHub détecté (masqué). Retire-le du dépôt et révoque-le.",
            pattern: compile(r"\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{20,}\b"),
        },
        SecretRule {
            rule: "openai_key",
            severity: "high",
            message: "Clé API détectée (masquée). Retire-la du dépôt et fais-la tourner.",
            pattern: compile(r"\bsk-[A-Za-z0-9]{20,}\b"),
        },
        SecretRule {
            rule: "stripe_live",
            severity: "high",
            message: "Clé Stripe live détectée (masquée). Retire-la du dépôt et fais-la tourner.",
            pattern: compile(r"\bsk_live_[A-Za-z0-9]{8,}\b"),
        },
        SecretRule {
            rule: "slack_token",
            severity: "high",
            message: "Jeton Slack détecté (masqué). Retire-le du dépôt et révoque-le.",
            pattern: compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b"),
        },
        SecretRule {
            rule: "private_key",
            severity: "high",
            message: "Clé privée détectée (masquée). Retire-la du dépôt et fais-la tourner.",
            pattern: compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
        },
    ]
}

fn scan_secrets(rel: &str, text: &str, rules: &[SecretRule], findings: &mut Vec<Finding>) {
    for (idx, line) in text.lines().enumerate() {
        if findings.len() >= MAX_FINDINGS {
            return;
        }
        if looks_like_placeholder(line) {
            continue;
        }
        for rule in rules {
            if findings.len() >= MAX_FINDINGS {
                return;
            }
            let Some(m) = rule.pattern.find(line) else {
                continue;
            };
            if is_known_example(m.as_str()) {
                continue;
            }
            if findings.iter().any(|f| {
                f.rule == rule.rule && f.path == rel && f.line == Some(idx + 1)
            }) {
                continue;
            }
            findings.push(Finding {
                severity: rule.severity.into(),
                category: "secret".into(),
                rule: rule.rule.into(),
                path: rel.into(),
                line: Some(idx + 1),
                message: rule.message.into(),
            });
        }
    }
}

fn looks_like_placeholder(line: &str) -> bool {
    let lower = line.to_lowercase();
    [
        "changeme",
        "placeholder",
        "your-api",
        "your_api",
        "your-token",
        "<token>",
        "xxxx",
        "sk-…",
        "sk-...",
    ]
    .iter()
    .any(|n| lower.contains(n))
}

fn is_known_example(value: &str) -> bool {
    value.contains("EXAMPLE")
        || value.contains("example")
        || value == "AKIAIOSFODNN7EXAMPLE"
}

fn scan_static(rel: &str, text: &str, findings: &mut Vec<Finding>) {
    const RULES: &[(&str, &str, &str, &str)] = &[
        (
            "eval",
            "high",
            "eval(",
            "eval exécute du code construit à l'exécution. Remplace-le par un appel explicite.",
        ),
        (
            "function_ctor",
            "high",
            "new Function(",
            "Le constructeur Function exécute une chaîne comme du code. Remplace-le par une fonction écrite dans le source.",
        ),
        (
            "dangerous_html",
            "medium",
            "dangerouslySetInnerHTML",
            "HTML injecté sans échappement. N'y passe que du contenu déjà assaini.",
        ),
        (
            "inner_html",
            "medium",
            ".innerHTML",
            "innerHTML interprète du HTML. Préfère textContent ou un échappement.",
        ),
        (
            "document_write",
            "medium",
            "document.write(",
            "document.write injecte du HTML dans la page. Préfère le DOM ou un template échappé.",
        ),
        (
            "cors_star",
            "medium",
            "Access-Control-Allow-Origin",
            "En-tête CORS présent dans le source. Vérifie que l'origine n'est pas ouverte à tout le monde.",
        ),
    ];
    for (idx, line) in text.lines().enumerate() {
        if findings.len() >= MAX_FINDINGS {
            return;
        }
        for (rule, severity, needle, message) in RULES {
            if !line.contains(needle) {
                continue;
            }
            if *rule == "cors_star" && !line.contains('*') {
                continue;
            }
            findings.push(Finding {
                severity: (*severity).into(),
                category: "static".into(),
                rule: (*rule).into(),
                path: rel.into(),
                line: Some(idx + 1),
                message: (*message).into(),
            });
        }
    }
}

fn scan_package_json(rel: &str, abs: &Path, text: &str, findings: &mut Vec<Finding>) {
    let Ok(value) = serde_json::from_str::<Value>(text) else {
        return;
    };
    if let Some(scripts) = value.get("scripts").and_then(|v| v.as_object()) {
        for name in ["preinstall", "install", "postinstall"] {
            if scripts.get(name).and_then(|v| v.as_str()).is_some() {
                findings.push(Finding {
                    severity: "medium".into(),
                    category: "dependency".into(),
                    rule: "npm_install_script".into(),
                    path: rel.into(),
                    line: None,
                    message: format!(
                        "Le script npm « {name} » s'exécute à l'installation. Vérifie qu'il vient d'une source de confiance."
                    ),
                });
            }
        }
    }
    for key in ["dependencies", "devDependencies", "optionalDependencies"] {
        let Some(deps) = value.get(key).and_then(|v| v.as_object()) else {
            continue;
        };
        for (name, spec) in deps {
            let Some(spec) = spec.as_str() else { continue };
            let risky = spec.starts_with("git+")
                || spec.starts_with("github:")
                || spec.starts_with("http://")
                || spec.starts_with("https://")
                || spec == "*"
                || spec == "latest"
                || spec.is_empty();
            if !risky {
                continue;
            }
            let detail = if spec.contains('@') || spec.contains("://") {
                "pointe vers une source distante".to_string()
            } else {
                format!("n'est pas épinglée ({spec})")
            };
            findings.push(Finding {
                severity: "medium".into(),
                category: "dependency".into(),
                rule: "unpinned_or_remote_dep".into(),
                path: rel.into(),
                line: None,
                message: format!("Dépendance « {name} » {detail}. Épingle une version de registre."),
            });
        }
    }
    let has_lock = abs.parent().is_some_and(|dir| {
        ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"]
            .iter()
            .any(|name| dir.join(name).is_file())
    });
    if !has_lock {
        findings.push(Finding {
            severity: "low".into(),
            category: "dependency".into(),
            rule: "missing_lockfile".into(),
            path: rel.into(),
            line: None,
            message: "Aucun lockfile npm à côté de package.json. Épingle les versions installées.".into(),
        });
    }
}

fn scan_cargo_toml(rel: &str, text: &str, findings: &mut Vec<Finding>) {
    for (idx, line) in text.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') {
            continue;
        }
        if trimmed.contains("git =") || trimmed.contains("git=") {
            findings.push(Finding {
                severity: "medium".into(),
                category: "dependency".into(),
                rule: "cargo_git_dep".into(),
                path: rel.into(),
                line: Some(idx + 1),
                message: "Dépendance Cargo via git. Épingle un rev.".into(),
            });
        }
    }
}

fn scan_requirements(rel: &str, text: &str, findings: &mut Vec<Finding>) {
    for (idx, line) in text.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with('-') {
            continue;
        }
        if trimmed.contains("git+") {
            findings.push(Finding {
                severity: "medium".into(),
                category: "dependency".into(),
                rule: "python_remote_dep".into(),
                path: rel.into(),
                line: Some(idx + 1),
                message: "Dépendance Python distante. Épingle un commit ou une version de registre.".into(),
            });
            continue;
        }
        let pinned = trimmed.contains("==") || trimmed.contains("~=") || trimmed.contains("@");
        if !pinned {
            let name = trimmed.split(['>', '<', '!', ' ']).next().unwrap_or(trimmed);
            findings.push(Finding {
                severity: "low".into(),
                category: "dependency".into(),
                rule: "python_unpinned".into(),
                path: rel.into(),
                line: Some(idx + 1),
                message: format!("« {name} » n'est pas épinglé dans requirements.txt."),
            });
        }
    }
}

fn has_static_ext(name: &str) -> bool {
    let ext = name.rsplit('.').next().unwrap_or("");
    STATIC_EXT.iter().any(|e| ext.eq_ignore_ascii_case(e))
}

fn is_minified(text: &str) -> bool {
    text.lines().any(|l| l.len() > 2_000)
}

fn is_env_file(name: &str) -> bool {
    if name == ".env" || name.starts_with(".env.") {
        let lower = name.to_lowercase();
        return !lower.contains("example")
            && !lower.contains("sample")
            && !lower.contains("template");
    }
    false
}

fn gitignore_covers_env(gitignore: &str) -> bool {
    gitignore.lines().any(|line| {
        let t = line.trim();
        !t.is_empty() && !t.starts_with('#') && t.contains(".env")
    })
}

fn assess_security_headers(url: &str, headers: &[(String, String)]) -> Vec<Finding> {
    let has = |name: &str| {
        headers
            .iter()
            .any(|(k, _)| k.eq_ignore_ascii_case(name))
    };
    let value_of = |name: &str| {
        headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    };
    let mut out = Vec::new();
    let https = url.starts_with("https://");
    if https && !has("strict-transport-security") {
        out.push(header_finding(
            url,
            "medium",
            "hsts",
            "Strict-Transport-Security est absent sur une réponse HTTPS.",
        ));
    }
    if !has("content-security-policy") {
        out.push(header_finding(
            url,
            "medium",
            "csp",
            "Content-Security-Policy est absente.",
        ));
    }
    if !has("x-content-type-options") {
        out.push(header_finding(
            url,
            "low",
            "nosniff",
            "X-Content-Type-Options est absent.",
        ));
    }
    let csp = value_of("content-security-policy").unwrap_or("");
    if !has("x-frame-options") && !csp.to_lowercase().contains("frame-ancestors") {
        out.push(header_finding(
            url,
            "low",
            "frame",
            "Ni X-Frame-Options ni frame-ancestors : la page peut être embarquée.",
        ));
    }
    if !has("referrer-policy") {
        out.push(header_finding(
            url,
            "low",
            "referrer",
            "Referrer-Policy est absente.",
        ));
    }
    out
}

fn header_finding(url: &str, severity: &str, rule: &str, message: &str) -> Finding {
    Finding {
        severity: severity.into(),
        category: "headers".into(),
        rule: rule.into(),
        path: url.into(),
        line: None,
        message: message.into(),
    }
}

async fn push_header_check(
    report: &mut ScanReport,
    checked: &mut Vec<String>,
    notes: &mut Vec<String>,
    url: &str,
) {
    let url = url.trim();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        notes.push(format!("{url} ignorée (schéma non http)"));
        return;
    }
    match fetch_headers(url).await {
        Ok(pairs) => {
            checked.push(url.to_string());
            report.findings.extend(assess_security_headers(url, &pairs));
        }
        Err(e) => notes.push(format!("{url} : {e}")),
    }
}

async fn fetch_headers(url: &str) -> std::result::Result<Vec<(String, String)>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .user_agent("DevForge-Agent/2.0")
        .build()
        .map_err(|e| e.to_string())?;
    let response = client.get(url).send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    if status.is_redirection() {
        return Err("redirection non suivie — en-têtes non évalués".into());
    }
    if !status.is_success() {
        return Err(format!("HTTP {status}"));
    }
    Ok(response
        .headers()
        .iter()
        .map(|(k, v)| (k.as_str().to_string(), v.to_str().unwrap_or("").to_string()))
        .collect())
}

async fn preview_url(pool: &PgPool, project_uuid: &str) -> std::result::Result<Option<String>, String> {
    let domain: Option<(String,)> =
        sqlx::query_as("SELECT wildcard_domain FROM instance_settings WHERE id = 1")
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?;
    let Some((domain,)) = domain else {
        return Ok(None);
    };
    let domain = domain.trim().trim_start_matches('.').to_lowercase();
    if domain.is_empty() {
        return Ok(None);
    }
    let short: String = project_uuid.chars().take(8).collect();
    Ok(Some(format!("https://dev-{short}.{domain}")))
}

fn sort_and_cap(report: &mut ScanReport) {
    report.findings.sort_by(|a, b| {
        severity_rank(&a.severity)
            .cmp(&severity_rank(&b.severity))
            .then(a.path.cmp(&b.path))
            .then(a.line.cmp(&b.line))
    });
    if report.findings.len() > MAX_FINDINGS {
        report.findings.truncate(MAX_FINDINGS);
        report.truncated = true;
    }
}

fn severity_rank(s: &str) -> u8 {
    match s {
        "high" => 0,
        "medium" => 1,
        _ => 2,
    }
}

fn tally(findings: &[Finding]) -> (usize, usize, usize) {
    let mut high = 0;
    let mut medium = 0;
    let mut low = 0;
    for f in findings {
        match f.severity.as_str() {
            "high" => high += 1,
            "medium" => medium += 1,
            _ => low += 1,
        }
    }
    (high, medium, low)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_redacts_secrets_and_flags_deps_and_sinks() {
        let dir = std::env::temp_dir().join(format!(
            "devforge-sec-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("src")).unwrap();
        let token = "ghp_abcdefghijklmnopqrstuvwxyz123456";
        std::fs::write(
            dir.join("src/app.js"),
            format!("const k = '{token}';\neval(input);\n"),
        )
        .unwrap();
        std::fs::write(
            dir.join("package.json"),
            r#"{"scripts":{"postinstall":"node setup.js"},"dependencies":{"leftpad":"*"}}"#,
        )
        .unwrap();
        std::fs::write(dir.join(".env"), "SECRET=supersecretvalue\n").unwrap();
        std::fs::write(
            dir.join("src/example.js"),
            "const demo = 'AKIAIOSFODNN7EXAMPLE';\n",
        )
        .unwrap();

        let report = scan_tree(&dir);
        let dumped = serde_json::to_string(&report.findings).unwrap();
        assert!(!dumped.contains(token), "le jeton ne doit pas sortir");
        assert!(
            !dumped.contains("supersecretvalue"),
            "le .env ne doit pas être lu"
        );
        assert!(
            !dumped.contains("AKIAIOSFODNN7EXAMPLE"),
            "la clé d'exemple AWS est ignorée"
        );
        assert!(report.findings.iter().any(|f| f.rule == "github_token"));
        assert!(report.findings.iter().any(|f| f.rule == "env_file" && f.severity == "high"));
        assert!(report.findings.iter().any(|f| f.rule == "eval"));
        assert!(report.findings.iter().any(|f| f.rule == "npm_install_script"));
        assert!(report.findings.iter().any(|f| f.rule == "unpinned_or_remote_dep"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn headers_report_missing_defenses() {
        let findings = assess_security_headers(
            "https://app.example.test",
            &[("content-type".into(), "text/html".into())],
        );
        let rules: Vec<_> = findings.iter().map(|f| f.rule.as_str()).collect();
        assert!(rules.contains(&"hsts"));
        assert!(rules.contains(&"csp"));
        assert!(rules.contains(&"nosniff"));
        assert!(rules.contains(&"frame"));
        assert!(rules.contains(&"referrer"));
        let dumped = serde_json::to_string(&findings).unwrap();
        assert!(!dumped.to_lowercase().contains("payload"));
    }

    #[test]
    fn remote_dep_spec_is_not_echoed() {
        let dir = std::env::temp_dir().join(format!("devforge-sec-url-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("package.json"),
            r#"{"dependencies":{"pkg":"git+https://user:s3cret-token@github.com/org/pkg.git"}}"#,
        )
        .unwrap();
        let report = scan_tree(&dir);
        let dumped = serde_json::to_string(&report.findings).unwrap();
        assert!(!dumped.contains("s3cret-token"));
        assert!(report
            .findings
            .iter()
            .any(|f| f.rule == "unpinned_or_remote_dep"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
