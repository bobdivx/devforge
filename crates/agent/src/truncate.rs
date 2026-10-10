//! Troncature des résultats d'outils envoyés au modèle (P1-04).
//! Le résultat complet reste dans `ToolCallRecord` (UI, diffs) ; seul le message `tool` est réduit.

use serde_json::{Map, Value};

/// Budget par défaut (caractères) d'un résultat d'outil dans le contexte du modèle.
pub const TOOL_RESULT_BUDGET: usize = 8_000;
/// `read_project_file` : le modèle doit pouvoir lire le fichier.
pub const READ_FILE_BUDGET: usize = 12_000;
/// Lockfiles : jamais plus que ça.
pub const LOCKFILE_BUDGET: usize = 2_000;
/// Tableaux : au-delà, on garde les premiers éléments.
pub const MAX_ARRAY_ITEMS: usize = 50;

const LONG_TEXT_KEYS: &[&str] = &[
    "content", "logs", "logs_tail", "stdout", "stderr", "output", "unified_diff", "previous_content", "diff", "excerpt", "body",
];

/// Budget configurable : `DEVFORGE_TOOL_RESULT_BUDGET`.
pub fn budget_from_env() -> usize {
    std::env::var("DEVFORGE_TOOL_RESULT_BUDGET")
        .ok()
        .and_then(|v| v.trim().parse::<usize>().ok())
        .filter(|n| *n >= 1_000)
        .unwrap_or(TOOL_RESULT_BUDGET)
}

fn is_lockfile(path: &str) -> bool {
    let name = path.rsplit(['/', '\\']).next().unwrap_or(path).to_lowercase();
    name == "package-lock.json"
        || name == "npm-shrinkwrap.json"
        || name == "pnpm-lock.yaml"
        || name == "yarn.lock"
        || name.ends_with(".lock")
        || name == "bun.lockb"
}

fn tail_first(key: &str) -> bool {
    key.starts_with("logs") || key == "stderr" || key == "output" || key == "stdout"
}

/// Garde tête + queue avec un marqueur au milieu (coupe sur des frontières de caractères).
pub fn head_tail(s: &str, head: usize, tail: usize) -> String {
    let n = s.chars().count();
    if n <= head + tail {
        return s.to_string();
    }
    let h: String = s.chars().take(head).collect();
    let t: String = s.chars().skip(n - tail).collect();
    format!("{h}\n…[{} caractères omis]…\n{t}", n - head - tail)
}

struct Limits {
    head: usize,
    tail: usize,
    log_head: usize,
    log_tail: usize,
    other: usize,
}

impl Limits {
    fn level(level: u32) -> Self {
        let f = 1usize << level; // 1, 2, 4, 8…
        Limits {
            head: 2_000 / f,
            tail: 4_000 / f,
            log_head: 1_000 / f,
            log_tail: 5_000 / f,
            other: 4_000 / f,
        }
    }
}

fn shrink(v: &Value, key: &str, lim: &Limits, lockfile: bool) -> Value {
    match v {
        Value::String(s) => {
            let n = s.chars().count();
            if lockfile && (key == "content" || key == "previous_content" || key == "unified_diff") {
                return Value::String(head_tail(s, LOCKFILE_BUDGET / 2, LOCKFILE_BUDGET / 2 - 200));
            }
            if LONG_TEXT_KEYS.contains(&key) || key.starts_with("logs") {
                let (h, t) = if tail_first(key) { (lim.log_head, lim.log_tail) } else { (lim.head, lim.tail) };
                if n > h + t {
                    return Value::String(head_tail(s, h, t));
                }
            } else if n > lim.other {
                return Value::String(head_tail(s, lim.other / 2, lim.other / 2));
            }
            v.clone()
        }
        Value::Array(arr) => {
            let kept: Vec<Value> = arr.iter().take(MAX_ARRAY_ITEMS).map(|x| shrink(x, key, lim, lockfile)).collect();
            Value::Array(kept)
        }
        Value::Object(map) => {
            let mut out = Map::new();
            let child_lock = lockfile
                || map.get("path").and_then(|p| p.as_str()).map(is_lockfile).unwrap_or(false);
            for (k, x) in map {
                out.insert(k.clone(), shrink(x, k, lim, child_lock));
                if let Value::Array(arr) = x {
                    if arr.len() > MAX_ARRAY_ITEMS {
                        out.insert(format!("{k}_omitted"), Value::from(arr.len() - MAX_ARRAY_ITEMS));
                    }
                }
            }
            Value::Object(out)
        }
        _ => v.clone(),
    }
}

/// Texte à envoyer au modèle pour le résultat `result` de l'outil `tool`.
pub fn for_model(tool: &str, args: &Value, result: &Value, budget: usize) -> String {
    let full = serde_json::to_string(result).unwrap_or_else(|_| "{}".into());
    let lockfile = args.get("path").and_then(|p| p.as_str()).map(is_lockfile).unwrap_or(false)
        || result.get("path").and_then(|p| p.as_str()).map(is_lockfile).unwrap_or(false);

    // Lecture de fichier : jusqu'à 12 000 caractères intacts (sauf lockfile).
    if tool == "read_project_file" && !lockfile {
        let content_len = result.get("content").and_then(|c| c.as_str()).map(|c| c.chars().count()).unwrap_or(0);
        if content_len <= READ_FILE_BUDGET && full.chars().count() <= READ_FILE_BUDGET + 2_000 {
            return full;
        }
        let mut v = result.clone();
        if let Some(obj) = v.as_object_mut() {
            if let Some(c) = obj.get("content").and_then(|c| c.as_str()).map(str::to_string) {
                obj.insert("content".into(), Value::String(head_tail(&c, 4_000, 7_000)));
            }
            obj.insert("truncated".into(), Value::Bool(true));
            obj.insert(
                "hint".into(),
                Value::String("Fichier long : relis la partie utile avec offset (1re ligne) et limit (nb de lignes).".into()),
            );
        }
        return serde_json::to_string(&v).unwrap_or(full);
    }

    let has_big_array = has_array_over(result, MAX_ARRAY_ITEMS);
    if full.chars().count() <= budget && !lockfile && !has_big_array {
        return full;
    }
    for level in 0..5 {
        let lim = Limits::level(level);
        let v = shrink(result, "", &lim, lockfile);
        let s = serde_json::to_string(&v).unwrap_or_default();
        if s.chars().count() <= budget {
            return s;
        }
    }
    // Dernier recours : extrait textuel encapsulé (JSON valide).
    let excerpt = head_tail(&full, budget / 3, budget / 2);
    serde_json::json!({
        "ok": result.get("ok").cloned().unwrap_or(Value::Null),
        "truncated": true,
        "excerpt": excerpt
    })
    .to_string()
}

fn has_array_over(v: &Value, n: usize) -> bool {
    match v {
        Value::Array(a) => a.len() > n || a.iter().any(|x| has_array_over(x, n)),
        Value::Object(m) => m.values().any(|x| has_array_over(x, n)),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn long_logs_fit_budget_and_keep_last_line() {
        let mut logs = String::new();
        for i in 0..3_000 {
            logs.push_str(&format!("ligne de build numéro {i} ............\n"));
        }
        logs.push_str("npm ERR! code EUSAGE — dernière ligne");
        assert!(logs.len() > 90_000);
        let r = json!({"ok": false, "logs": logs, "status": "failed"});
        let out = for_model("get_deployment_logs", &json!({}), &r, TOOL_RESULT_BUDGET);
        assert!(out.chars().count() <= TOOL_RESULT_BUDGET, "{}", out.len());
        assert!(out.contains("dernière ligne"));
        assert!(out.contains("caractères omis"));
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["status"], "failed");
    }

    #[test]
    fn small_read_is_untouched() {
        let content = "x".repeat(5_000);
        let r = json!({"ok": true, "path": "src/index.astro", "content": content});
        let out = for_model("read_project_file", &json!({"path": "src/index.astro"}), &r, TOOL_RESULT_BUDGET);
        assert_eq!(out, serde_json::to_string(&r).unwrap());
    }

    #[test]
    fn long_read_is_flagged_with_hint() {
        let content = "y".repeat(40_000);
        let r = json!({"ok": true, "path": "src/big.ts", "content": content});
        let out = for_model("read_project_file", &json!({"path": "src/big.ts"}), &r, TOOL_RESULT_BUDGET);
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["truncated"], true);
        assert!(v["hint"].as_str().unwrap().contains("offset"));
        assert!(out.chars().count() < 13_000);
    }

    #[test]
    fn lockfile_never_exceeds_2000_chars_of_content() {
        let content = "{\"lockfileVersion\": 3}".repeat(5_000);
        let r = json!({"ok": true, "path": "package-lock.json", "content": content});
        let out = for_model("read_project_file", &json!({"path": "package-lock.json"}), &r, TOOL_RESULT_BUDGET);
        let v: Value = serde_json::from_str(&out).unwrap();
        assert!(v["content"].as_str().unwrap().chars().count() <= LOCKFILE_BUDGET + 60);
    }

    #[test]
    fn big_arrays_keep_50_and_count_omitted() {
        let items: Vec<Value> = (0..200).map(|i| json!({"path": format!("f{i}.ts")})).collect();
        let r = json!({"ok": true, "files": items});
        let out = for_model("list_project_files", &json!({}), &r, TOOL_RESULT_BUDGET);
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["files"].as_array().unwrap().len(), 50);
        assert_eq!(v["files_omitted"], 150);
    }

    #[test]
    fn small_results_pass_through() {
        let r = json!({"ok": true, "status": 200});
        assert_eq!(for_model("http_smoke", &json!({}), &r, TOOL_RESULT_BUDGET), r.to_string());
    }

    #[test]
    fn read_line_window_slices() {
        let text = (1..=10).map(|i| format!("l{i}")).collect::<Vec<_>>().join("\n");
        let v = crate::tools::read_line_window("a.txt", &text, Some(3), Some(2));
        assert_eq!(v["content"], "l3\nl4");
        assert_eq!(v["line_start"], 3);
        assert_eq!(v["line_end"], 4);
        assert_eq!(v["total_lines"], 10);
        assert_eq!(v["has_more"], true);
    }
}
