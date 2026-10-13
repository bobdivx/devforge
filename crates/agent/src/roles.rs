//! Sous-ensembles d'outils par rôle d'agent (P1-05).
//! Moins d'outils exposés = moins d'erreurs de choix et moins de tokens.

/// Tous les outils du registre cœur (vérifié par test contre `build_core_registry`).
pub const ALL_TOOLS: &[&str] = &[
    "ask_user",
    "cancel_deployment",
    "create_github_fix",
    "create_github_repo",
    "create_project_agent",
    "create_routine",
    "delegate_task",
    "delete_routine",
    "get_deployment_logs",
    "get_project",
    "github_list_prs",
    "github_workflow_runs",
    "http_smoke",
    "list_agent_messages",
    "list_agent_tool_failures",
    "list_deployments",
    "list_env_vars",
    "list_project_agents",
    "list_project_files",
    "list_projects",
    "list_routines",
    "local_preview_status",
    "mcp_call_tool",
    "mcp_list_remote_tools",
    "mcp_list_servers",
    "memory_forget",
    "memory_search",
    "memory_write",
    "propose_plan",
    "publish_to_github",
    "read_github_file",
    "read_project_file",
    "review_project_security",
    "run_application_tests",
    "run_workdir_command",
    "sdd_loop",
    "start_local_preview",
    "stop_local_preview",
    "sync_workdir_to_github",
    "trigger_deploy",
    "upsert_env_var",
    "write_project_file",
];

/// Toujours disponibles : lecture du fil et mémoire durable. Les rôles de surveillance
/// (runner / actions / crons) n'écrivent qu'en journal et n'oublient rien : règle appliquée
/// dans l'outil (`tools/memory.rs`), les sous-agents n'écrivent en portée user qu'en journal.
pub const ALWAYS: &[&str] = &[
    "list_agent_messages",
    "memory_search",
    "memory_write",
    "memory_forget",
    "ask_user",
];

const WORKER: &[&str] = &[
    // workdir
    "list_project_files",
    "read_project_file",
    "write_project_file",
    "run_workdir_command",
    "start_local_preview",
    "stop_local_preview",
    "local_preview_status",
    "run_application_tests",
    "propose_plan",
    "sdd_loop",
    // lecture
    "get_project",
    "get_deployment_logs",
    "list_deployments",
    "http_smoke",
    "read_github_file",
    // distants (verrouillés par l'accord de publication)
    "create_github_fix",
    "sync_workdir_to_github",
    "publish_to_github",
    "create_github_repo",
    "trigger_deploy",
    "mcp_list_servers",
    "mcp_list_remote_tools",
    "mcp_call_tool",
];

const DEPLOY: &[&str] = &[
    "get_project",
    "list_deployments",
    "get_deployment_logs",
    "trigger_deploy",
    "cancel_deployment",
    "http_smoke",
    "github_workflow_runs",
    "list_project_files",
    "read_project_file",
    "run_workdir_command",
    "start_local_preview",
    "local_preview_status",
    "run_application_tests",
    "propose_plan",
    // auto-réparation : pousse le correctif (lockfile) après validation
    "write_project_file",
    "stop_local_preview",
    "sync_workdir_to_github",
    "publish_to_github",
    "create_github_repo",
];

/// Rustine (réparation) : diagnostique, corrige dans le dossier de travail, teste. Ne publie pas :
/// l'utilisateur applique la correction d'un bouton (« Appliquer »).
const REPAIR: &[&str] = &[
    "get_project",
    "list_deployments",
    "get_deployment_logs",
    "list_env_vars",
    "list_project_files",
    "read_project_file",
    "write_project_file",
    "run_workdir_command",
    "run_application_tests",
    "start_local_preview",
    "stop_local_preview",
    "local_preview_status",
    "http_smoke",
    "read_github_file",
];

const OPS: &[&str] = &[
    "create_routine",
    "list_routines",
    "delete_routine",
    "get_project",
    "get_deployment_logs",
    "list_deployments",
    "list_env_vars",
    "upsert_env_var",
    "http_smoke",
    "local_preview_status",
];

const REVIEWER: &[&str] = &[
    "review_project_security",
    "get_project",
    "github_list_prs",
    "github_workflow_runs",
    "read_project_file",
    "list_project_files",
    "read_github_file",
];

const WATCHER: &[&str] = &[
    "get_project",
    "github_workflow_runs",
    "github_list_prs",
    "http_smoke",
    "list_routines",
];

/// Liste des outils autorisés pour un rôle. `None` = tous (coordinateur, rôle inconnu absent).
pub fn tools_for_role(role: &str, kind: Option<&str>) -> Option<&'static [&'static str]> {
    if kind == Some("subagent") {
        return Some(WORKER);
    }
    match role {
        "coordinator" => None,
        "custom" | "worker" | "subagent" => Some(WORKER),
        "deploy" => Some(DEPLOY),
        "repair" => Some(REPAIR),
        "ops" => Some(OPS),
        "reviewer" => Some(REVIEWER),
        "runner" | "actions" | "crons" => Some(WATCHER),
        _ => Some(WORKER),
    }
}

/// Outil exposé à ce rôle ? (`review_project_security` côté coordinateur : sur demande seulement.)
pub fn role_allows(role: &str, kind: Option<&str>, tool: &str, security_review: bool) -> bool {
    // Un worker en arrière-plan ne pose pas de question (personne ne la verrait) : il conclut.
    if tool == "ask_user" && kind == Some("subagent") {
        return false;
    }
    if ALWAYS.contains(&tool) {
        return true;
    }
    match tools_for_role(role, kind) {
        None => tool != "review_project_security" || security_review,
        Some(list) => list.contains(&tool),
    }
}

pub fn role_refusal(role: &str, tool: &str) -> serde_json::Value {
    serde_json::json!({
        "ok": false,
        "code": "tool_not_available_for_role",
        "error": format!("Outil {tool} non disponible pour le rôle {role}. Délègue au Coordinateur.")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_listed_tool_exists() {
        for list in [WORKER, DEPLOY, OPS, REVIEWER, WATCHER] {
            for t in list {
                assert!(ALL_TOOLS.contains(t), "{t} absent de ALL_TOOLS");
            }
        }
    }

    #[test]
    fn ops_cannot_write_files() {
        assert!(!role_allows("ops", None, "write_project_file", false));
        assert!(!role_allows("ops", None, "create_github_fix", false));
        assert!(role_allows("ops", None, "http_smoke", false));
        assert!(role_allows("ops", None, "list_agent_messages", false));
    }

    #[test]
    fn coordinator_gets_everything_but_security_review_on_demand() {
        assert!(role_allows(
            "coordinator",
            None,
            "write_project_file",
            false
        ));
        assert!(!role_allows(
            "coordinator",
            None,
            "review_project_security",
            false
        ));
        assert!(role_allows(
            "coordinator",
            None,
            "review_project_security",
            true
        ));
    }

    #[test]
    fn subagent_kind_is_a_worker() {
        assert!(role_allows(
            "custom",
            Some("subagent"),
            "write_project_file",
            false
        ));
        assert!(!role_allows(
            "deploy",
            Some("subagent"),
            "upsert_env_var",
            false
        ));
    }

    #[test]
    fn ask_user_everywhere_but_background_workers() {
        for role in [
            "coordinator",
            "ops",
            "deploy",
            "reviewer",
            "custom",
            "runner",
        ] {
            assert!(role_allows(role, None, "ask_user", false), "{role}");
        }
        assert!(!role_allows("custom", Some("subagent"), "ask_user", false));
    }

    #[test]
    fn watchers_are_read_only() {
        for role in ["runner", "actions", "crons"] {
            assert!(!role_allows(role, None, "write_project_file", false));
            assert!(role_allows(role, None, "github_workflow_runs", false));
        }
    }
}
