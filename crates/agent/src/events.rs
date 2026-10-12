//! Contrat d'événements serveur ↔ front (P2-01) : libellés humains des outils, résumé d'une
//! ligne, jalons de progression (P2-03) et accusé de réception immédiat.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// État d'un jalon (« Build », « Preview locale »…).
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum MilestoneStatus {
    #[default]
    Running,
    Done,
    Failed,
}

/// Taille max d'un résultat d'outil envoyé au front pendant le run (le complet reste en base).
pub const UI_RESULT_BUDGET: usize = 16_000;

fn arg<'a>(args: &'a Value, key: &str) -> &'a str {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .unwrap_or("")
}

fn clip(s: &str, max: usize) -> String {
    let one_line = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if one_line.chars().count() <= max {
        one_line
    } else {
        format!(
            "{}…",
            one_line
                .chars()
                .take(max.saturating_sub(1))
                .collect::<String>()
        )
    }
}

/// Libellé humain d'un appel d'outil (miroir de `headerLabel` côté front).
pub fn tool_label(name: &str, args: &Value) -> String {
    let path = arg(args, "path");
    match name {
        "read_project_file" | "read_github_file" => {
            if path.is_empty() {
                "Lecture d'un fichier".into()
            } else {
                format!("Lecture de {path}")
            }
        }
        "list_project_files" => "Liste des fichiers".into(),
        "write_project_file" => {
            let p = if path.is_empty() { "un fichier" } else { path };
            if arg(args, "mode") == "github" {
                format!("Écriture de {p} sur GitHub")
            } else {
                format!("Écriture de {p}")
            }
        }
        "run_workdir_command" => {
            let c = arg(args, "command");
            if c.is_empty() {
                "Commande".into()
            } else {
                clip(c, 60)
            }
        }
        "run_application_tests" => "Tests".into(),
        "start_local_preview" => "Preview locale".into(),
        "stop_local_preview" => "Arrêt de la preview".into(),
        "local_preview_status" => "État de la preview".into(),
        "trigger_deploy" => "Déploiement".into(),
        "delegate_task" => {
            let t = arg(args, "title");
            if t.is_empty() {
                "Délégation à un worker".into()
            } else {
                format!("Délégation « {} »", clip(t, 50))
            }
        }
        "cancel_deployment" => "Annulation du déploiement".into(),
        "list_deployments" => "Liste des déploiements".into(),
        "get_deployment_logs" => "Logs de déploiement".into(),
        "http_smoke" => {
            let u = arg(args, "url");
            if u.is_empty() {
                "Smoke HTTP".into()
            } else {
                format!("Smoke HTTP {}", clip(u, 60))
            }
        }
        "sync_workdir_to_github" => "Envoi sur GitHub".into(),
        "create_github_fix" => {
            let t = arg(args, "pr_title");
            if t.is_empty() {
                "Pull request".into()
            } else {
                format!("Pull request « {} »", clip(t, 50))
            }
        }
        "publish_to_github" => "Publication GitHub".into(),
        "create_github_repo" => "Création du dépôt GitHub".into(),
        "propose_plan" => "Plan".into(),
        "ask_user" => "Question".into(),
        "create_routine" => "Routine programmée".into(),
        "list_routines" => "Routines".into(),
        "delete_routine" => "Routine supprimée".into(),
        "get_project" => "Lecture du projet".into(),
        "list_projects" => "Liste des projets".into(),
        "list_env_vars" => "Variables d'environnement".into(),
        "upsert_env_var" => {
            let k = arg(args, "key");
            if k.is_empty() {
                "Variable d'environnement".into()
            } else {
                format!("Variable {k}")
            }
        }
        "review_project_security" => "Revue sécurité".into(),
        "mcp_call_tool" => {
            let t = args
                .get("tool")
                .or_else(|| args.get("tool_name"))
                .or_else(|| args.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if t.is_empty() {
                "Outil MCP".into()
            } else {
                format!("MCP {t}")
            }
        }
        other => other.replace('_', " "),
    }
}

/// Durée lisible : « 40 ms », « 12 s », « 1 min 05 s ».
pub fn fmt_elapsed(ms: u64) -> String {
    if ms < 1_000 {
        format!("{ms} ms")
    } else if ms < 60_000 {
        format!("{} s", (ms + 500) / 1_000)
    } else {
        let s = ms / 1_000;
        format!("{} min {:02} s", s / 60, s % 60)
    }
}

fn exit_code(result: &Value) -> Option<i64> {
    result
        .get("exit_code")
        .or_else(|| result.get("code"))
        .and_then(|v| v.as_i64())
}

/// Succès « métier » : commande à code ≠ 0, preview non joignable = échec.
pub fn effective_ok(name: &str, ok: bool, result: &Value) -> bool {
    if !ok {
        return false;
    }
    match name {
        "run_workdir_command" | "run_application_tests" => {
            exit_code(result).map(|c| c == 0).unwrap_or(true)
        }
        "start_local_preview" => result.get("public_ok").and_then(|v| v.as_bool()) != Some(false),
        _ => true,
    }
}

fn error_line(result: &Value) -> String {
    for k in ["error", "message_fr", "message", "stderr", "reason", "hint"] {
        if let Some(s) = result.get(k).and_then(|v| v.as_str()) {
            let line = s
                .lines()
                .map(str::trim)
                .rfind(|l| !l.is_empty())
                .unwrap_or("");
            // Erreurs npm : la ligne « ERR! code … » est la plus parlante.
            let npm = s
                .lines()
                .map(str::trim)
                .find(|l| l.contains("ERR!") || l.contains("error TS") || l.starts_with("error"));
            let pick = npm.unwrap_or(line);
            if !pick.is_empty() {
                return clip(pick, 80);
            }
        }
    }
    "échec".into()
}

/// Résumé d'une ligne : « ✓ build OK · 12 s », « ✗ npm install : ERESOLVE… ».
pub fn tool_summary(name: &str, args: &Value, ok: bool, result: &Value, elapsed_ms: u64) -> String {
    let label = tool_label(name, args);
    if effective_ok(name, ok, result) {
        let what = if name == "run_workdir_command" {
            let c = arg(args, "command").to_lowercase();
            if c.contains("test") {
                "tests OK".to_string()
            } else if c.contains("build") {
                "build OK".to_string()
            } else {
                label
            }
        } else {
            label
        };
        format!("✓ {what} · {}", fmt_elapsed(elapsed_ms))
    } else {
        format!("✗ {label} : {}", error_line(result))
    }
}

/// Résultat borné pour l'affichage en direct (16 Ko). Le résultat complet arrive avec `Reply`.
pub fn for_ui(name: &str, args: &Value, result: &Value) -> Value {
    let full = serde_json::to_string(result).unwrap_or_default();
    if full.len() <= UI_RESULT_BUDGET {
        return result.clone();
    }
    let shrunk = crate::truncate::for_model(name, args, result, UI_RESULT_BUDGET);
    let mut v: Value = serde_json::from_str(&shrunk)
        .unwrap_or_else(|_| serde_json::json!({ "ok": result.get("ok") }));
    if let Some(o) = v.as_object_mut() {
        o.insert("truncated".into(), Value::Bool(true));
    }
    v
}

pub const MILESTONE_FILES: &str = "Modification des fichiers";

/// Jalon associé à un outil (transitions significatives seulement, pas chaque outil).
pub fn milestone_for(name: &str, args: &Value) -> Option<&'static str> {
    match name {
        "write_project_file" if arg(args, "mode") != "github" => Some(MILESTONE_FILES),
        "run_workdir_command" => {
            let c = arg(args, "command").to_lowercase();
            if c.contains("test") {
                Some("Tests")
            } else if c.contains("build") {
                Some("Build")
            } else if c.contains("install") || c.contains("npm ci") {
                Some("Installation")
            } else {
                None
            }
        }
        "run_application_tests" => Some("Tests"),
        "start_local_preview" => Some("Preview locale"),
        "sync_workdir_to_github" | "create_github_fix" | "publish_to_github" => Some("Publication"),
        "trigger_deploy" => Some("Déploiement"),
        "http_smoke" => Some("Vérification en ligne"),
        "delegate_task" => Some("Délégation"),
        _ => None,
    }
}

/// Suivi des jalons d'un run : ne renvoie que les transitions à émettre.
#[derive(Default, Debug)]
pub struct MilestoneTracker {
    states: Vec<(&'static str, MilestoneStatus)>,
}

impl MilestoneTracker {
    fn get(&self, label: &str) -> Option<MilestoneStatus> {
        self.states
            .iter()
            .find(|(l, _)| *l == label)
            .map(|(_, s)| *s)
    }

    fn set(
        &mut self,
        label: &'static str,
        st: MilestoneStatus,
        out: &mut Vec<(&'static str, MilestoneStatus)>,
    ) {
        if self.get(label) == Some(st) {
            return;
        }
        if let Some(e) = self.states.iter_mut().find(|(l, _)| *l == label) {
            e.1 = st;
        } else {
            self.states.push((label, st));
        }
        out.push((label, st));
    }

    /// Un outil va s'exécuter (déjà autorisé).
    pub fn on_tool_start(
        &mut self,
        name: &str,
        args: &Value,
    ) -> Vec<(&'static str, MilestoneStatus)> {
        let mut out = Vec::new();
        let m = milestone_for(name, args);
        // Fin des écritures : le premier outil qui n'écrit pas clôt « Modification des fichiers ».
        if m != Some(MILESTONE_FILES)
            && self.get(MILESTONE_FILES) == Some(MilestoneStatus::Running)
            && name != "read_project_file"
            && name != "list_project_files"
        {
            self.set(MILESTONE_FILES, MilestoneStatus::Done, &mut out);
        }
        if let Some(m) = m {
            self.set(m, MilestoneStatus::Running, &mut out);
        }
        out
    }

    pub fn on_tool_done(
        &mut self,
        name: &str,
        args: &Value,
        ok: bool,
        result: &Value,
    ) -> Vec<(&'static str, MilestoneStatus)> {
        let mut out = Vec::new();
        if let Some(m) = milestone_for(name, args) {
            if m != MILESTONE_FILES {
                let st = if effective_ok(name, ok, result) {
                    MilestoneStatus::Done
                } else {
                    MilestoneStatus::Failed
                };
                self.set(m, st, &mut out);
            }
        }
        out
    }

    /// Fin du run : ce qui tourne encore est terminé.
    pub fn finish(&mut self) -> Vec<(&'static str, MilestoneStatus)> {
        let mut out = Vec::new();
        let running: Vec<&'static str> = self
            .states
            .iter()
            .filter(|(_, s)| *s == MilestoneStatus::Running)
            .map(|(l, _)| *l)
            .collect();
        for l in running {
            self.set(l, MilestoneStatus::Done, &mut out);
        }
        out
    }
}

const CONTINUE_WORDS: &[&str] = &[
    "go",
    "oui",
    "ok",
    "okay",
    "continue",
    "continuer",
    "vas-y",
    "vas y",
    "on y va",
    "valide",
    "d'accord",
    "dac",
    "publication validée",
    "yes",
];

const QUESTION_STARTS: &[&str] = &[
    "où ",
    "ou en",
    "pourquoi",
    "comment",
    "quel",
    "quelle",
    "quels",
    "quelles",
    "est-ce",
    "combien",
    "qui ",
    "quand",
    "qu'est",
    "que ",
    "c'est quoi",
    "y a-t-il",
    "peux-tu me dire",
    "as-tu",
];

const ACTION_VERBS: &[&str] = &[
    "corrige",
    "ajoute",
    "déploie",
    "deploie",
    "améliore",
    "ameliore",
    "crée",
    "cree",
    "fais",
    "mets",
    "change",
    "supprime",
    "enlève",
    "enleve",
    "répare",
    "repare",
    "lance",
    "publie",
    "modifie",
    "refais",
    "installe",
    "remplace",
    "renomme",
    "implémente",
    "implemente",
    "construis",
    "génère",
    "genere",
    "écris",
    "ecris",
    "ouvre",
    "pousse",
    "mets à jour",
    "optimise",
    "traduis",
    "rends",
    "passe",
    "retire",
    "fix",
];

/// Accusé de réception immédiat (règles, pas de LLM, < 1 ms).
pub fn ack_for(message: &str) -> &'static str {
    let m = message.trim().to_lowercase();
    let bare = m.trim_end_matches(['.', '!', ' ']);
    if CONTINUE_WORDS.iter().any(|w| {
        bare == *w
            || bare.starts_with(&format!("{w},"))
            || bare.starts_with(&format!("{w} ")) && bare.len() < 40
    }) {
        return "Je continue.";
    }
    let first = m
        .split_whitespace()
        .next()
        .unwrap_or("")
        .trim_matches(|c: char| !c.is_alphanumeric() && c != '\'' && c != '-');
    if ACTION_VERBS
        .iter()
        .any(|v| first == *v || m.starts_with(&format!("{v} ")))
    {
        return "C'est noté, je m'en occupe.";
    }
    if m.ends_with('?') || QUESTION_STARTS.iter().any(|q| m.starts_with(q)) {
        return "Je regarde.";
    }
    if ACTION_VERBS.iter().any(|v| m.contains(&format!(" {v} "))) {
        return "C'est noté, je m'en occupe.";
    }
    "Je regarde."
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn ack_table() {
        let cases = [
            ("Où en est le projet ?", "Je regarde."),
            ("pourquoi le build a échoué", "Je regarde."),
            ("La preview marche ?", "Je regarde."),
            (
                "Corrige le contraste du menu",
                "C'est noté, je m'en occupe.",
            ),
            ("ajoute un footer", "C'est noté, je m'en occupe."),
            ("Déploie la dernière version", "C'est noté, je m'en occupe."),
            ("Améliore le design en local", "C'est noté, je m'en occupe."),
            ("go", "Je continue."),
            ("Oui !", "Je continue."),
            ("Continuer", "Je continue."),
            ("Publication validée, continue.", "Je continue."),
            ("ok vas-y", "Je continue."),
        ];
        for (msg, want) in cases {
            assert_eq!(ack_for(msg), want, "{msg}");
        }
    }

    #[test]
    fn labels_and_summaries() {
        assert_eq!(
            tool_label("read_project_file", &json!({"path": "src/app.ts"})),
            "Lecture de src/app.ts"
        );
        assert_eq!(
            tool_label("run_workdir_command", &json!({"command": "npm run build"})),
            "npm run build"
        );
        assert_eq!(
            tool_label("http_smoke", &json!({"url": "https://x.dev"})),
            "Smoke HTTP https://x.dev"
        );
        assert_eq!(
            tool_summary(
                "run_workdir_command",
                &json!({"command": "npm run build"}),
                true,
                &json!({"ok": true, "exit_code": 0}),
                12_300
            ),
            "✓ build OK · 12 s"
        );
        let s = tool_summary(
            "run_workdir_command",
            &json!({"command": "npm install"}),
            true,
            &json!({"ok": true, "exit_code": 1, "stderr": "npm ERR! code ERESOLVE\nnpm ERR! blah"}),
            900,
        );
        assert_eq!(s, "✗ npm install : npm ERR! code ERESOLVE");
        assert_eq!(fmt_elapsed(65_000), "1 min 05 s");
    }

    #[test]
    fn milestones_fix_the_build_scenario() {
        let mut t = MilestoneTracker::default();
        let w = json!({"path": "src/a.ts", "mode": "local"});
        let mut ev = t.on_tool_start("write_project_file", &w);
        ev.extend(t.on_tool_done("write_project_file", &w, true, &json!({"ok": true})));
        ev.extend(t.on_tool_start("write_project_file", &w)); // pas de doublon
        let b = json!({"command": "npm run build"});
        ev.extend(t.on_tool_start("run_workdir_command", &b));
        ev.extend(t.on_tool_done(
            "run_workdir_command",
            &b,
            true,
            &json!({"ok": true, "exit_code": 0}),
        ));
        let p = json!({});
        ev.extend(t.on_tool_start("start_local_preview", &p));
        ev.extend(t.on_tool_done(
            "start_local_preview",
            &p,
            true,
            &json!({"ok": true, "public_ok": false}),
        ));
        ev.extend(t.finish());
        use MilestoneStatus::*;
        assert_eq!(
            ev,
            vec![
                (MILESTONE_FILES, Running),
                (MILESTONE_FILES, Done),
                ("Build", Running),
                ("Build", Done),
                ("Preview locale", Running),
                ("Preview locale", Failed),
            ]
        );
        assert_eq!(milestone_for("get_project", &p), None);
        assert_eq!(
            milestone_for("write_project_file", &json!({"mode": "github"})),
            None
        );
    }

    #[test]
    fn ui_result_is_bounded() {
        let big = "x".repeat(100_000);
        let v = for_ui(
            "run_workdir_command",
            &json!({}),
            &json!({"ok": true, "stdout": big}),
        );
        assert!(serde_json::to_string(&v).unwrap().len() <= UI_RESULT_BUDGET + 200);
        assert_eq!(v["truncated"], true);
    }
}
