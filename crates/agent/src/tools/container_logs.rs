use async_trait::async_trait;
use devforge_deploy::runtime_logs::{
    RuntimeLogsOptions, RuntimeLogsParams, DEFAULT_MAX_BYTES, DEFAULT_TAIL, MAX_OUTPUT_BYTES,
    MAX_TAIL,
};
use devforge_deploy::DeployFacade;
use devforge_shared::{Result, Tool};
use serde_json::{json, Value};
use std::sync::Arc;

use crate::ProjectStore;

pub const GET_CONTAINER_LOGS: &str = "get_container_logs";

/// Logs d'exécution du conteneur d'un projet (lecture seule, secrets masqués).
/// Même code que `GET /api/v1/projects/{uuid}/runtime-logs`.
pub struct GetContainerLogsTool {
    pub deploy: Arc<DeployFacade>,
    pub store: Arc<dyn ProjectStore>,
}

fn arg_str<'a>(args: &'a Value, key: &str) -> Option<&'a str> {
    args.get(key).and_then(Value::as_str)
}

fn arg_u64(args: &Value, key: &str) -> Option<u64> {
    let v = args.get(key)?;
    v.as_u64()
        .or_else(|| v.as_i64().map(|n| n.max(0) as u64))
        .or_else(|| v.as_str().and_then(|s| s.trim().parse().ok()))
}

fn arg_bool(args: &Value, key: &str) -> Option<bool> {
    let v = args.get(key)?;
    v.as_bool().or_else(|| match v.as_str()?.trim() {
        "true" | "1" | "yes" => Some(true),
        "false" | "0" | "no" => Some(false),
        _ => None,
    })
}

/// Arguments outil → options validées (erreur lisible en français).
pub fn container_logs_options(args: &Value) -> std::result::Result<RuntimeLogsOptions, String> {
    RuntimeLogsOptions::from_params(&RuntimeLogsParams {
        tail: arg_u64(args, "tail"),
        since: arg_str(args, "since"),
        grep: arg_str(args, "grep"),
        level: arg_str(args, "level"),
        timestamps: arg_bool(args, "timestamps"),
        service: arg_str(args, "service"),
        max_bytes: arg_u64(args, "max_bytes"),
    })
}

#[async_trait]
impl Tool for GetContainerLogsTool {
    fn name(&self) -> &str {
        GET_CONTAINER_LOGS
    }

    fn description(&self) -> &str {
        "Lit les logs d'exécution (stdout + stderr) du conteneur en production d'un projet DevForge. \
         LECTURE SEULE : ne redémarre, ne modifie et ne déploie rien. \
         Les secrets sont masqués (jetons, en-têtes Authorization/Cookie, identifiants dans les URL, \
         paramètres ?token=/api_key=, variables *_PASSWORD/*_SECRET…). \
         Paramètres : project (UUID, slug ou nom du projet du workspace ; project_uuid accepté), \
         tail (lignes renvoyées, défaut 200, max 5000), \
         since (durée 30m / 2h / 1h30m / 1d, horodatage RFC 3339 ou epoch), \
         grep (texte, insensible à la casse ; cherché dans toute la fenêtre since, jusqu'à 100 000 lignes, puis tail sur les correspondances), \
         level (error | warn | info | debug : seuil minimal, d'après les mots-clés de niveau dans la ligne), \
         service (service annexe du projet, ex. redis → conteneur <app>-redis ; vide = l'app), \
         timestamps (horodatage Docker, défaut true), max_bytes (défaut 256 Kio, max 400 Kio). \
         Retour : logs, lines, bytes, truncated (true si la sortie a été coupée : réduis tail/since ou ajoute grep), container, query. \
         Exemple : {\"project\":\"popcornn\",\"since\":\"2h\",\"grep\":\"ffmpeg\",\"tail\":1000}."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project": {
                    "type": "string",
                    "description": "UUID, slug ou nom du projet (workspace courant)"
                },
                "project_uuid": {
                    "type": "string",
                    "description": "Alias de project (injecté automatiquement dans un fil projet)"
                },
                "tail": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": MAX_TAIL,
                    "description": format!("Lignes renvoyées (défaut {DEFAULT_TAIL}, max {MAX_TAIL})")
                },
                "since": {
                    "type": "string",
                    "description": "Depuis : durée (30m, 2h, 1h30m, 1d), RFC 3339 (2026-10-27T08:00:00Z) ou epoch"
                },
                "grep": {
                    "type": "string",
                    "maxLength": 200,
                    "description": "Filtre texte insensible à la casse (pas une regex)"
                },
                "level": {
                    "type": "string",
                    "enum": ["error", "warn", "info", "debug", "all"],
                    "description": "Niveau minimal (heuristique sur les mots-clés de la ligne)"
                },
                "service": {
                    "type": "string",
                    "description": "Service annexe (sidecar) du projet ; vide = conteneur de l'app"
                },
                "timestamps": {
                    "type": "boolean",
                    "description": "Préfixe horodaté Docker (défaut true)"
                },
                "max_bytes": {
                    "type": "integer",
                    "minimum": 1024,
                    "maximum": MAX_OUTPUT_BYTES,
                    "description": format!("Taille max de la sortie (défaut {DEFAULT_MAX_BYTES} octets)")
                }
            }
        })
    }

    async fn execute(&self, arguments: Value) -> Result<Value> {
        let uuid = arg_str(&arguments, "project_uuid")
            .or_else(|| arg_str(&arguments, "project"))
            .unwrap_or("")
            .trim()
            .to_string();
        if uuid.is_empty() {
            return Ok(json!({"ok": false, "error": "project (ou project_uuid) requis"}));
        }
        let opts = match container_logs_options(&arguments) {
            Ok(o) => o,
            Err(e) => return Ok(json!({"ok": false, "error": e})),
        };
        let Some(ctx) = self.store.resolve_project(&uuid).await? else {
            return Ok(json!({"ok": false, "error": format!("Projet introuvable : {uuid}")}));
        };
        let mut out = self.deploy.runtime_logs_with(&ctx, &opts).await;
        if let Some(obj) = out.as_object_mut() {
            obj.insert("project_uuid".into(), json!(ctx.project_uuid));
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn options_from_tool_arguments() {
        let o = container_logs_options(&json!({
            "tail": "1200", "since": "2h", "grep": "ffmpeg", "level": "warn",
            "service": "redis", "timestamps": false, "max_bytes": 2048
        }))
        .unwrap();
        assert_eq!(o.tail, 1200);
        assert_eq!(o.since.as_deref(), Some("7200s"));
        assert_eq!(o.grep.as_deref(), Some("ffmpeg"));
        assert!(!o.timestamps);
        assert_eq!(o.service.as_deref(), Some("redis"));
        assert_eq!(o.max_bytes, 2048);
        assert!(container_logs_options(&json!({"since": "demain"})).is_err());
        assert_eq!(
            container_logs_options(&json!({"tail": 99999}))
                .unwrap()
                .tail,
            MAX_TAIL
        );
    }

    struct OneProject;

    #[async_trait]
    impl ProjectStore for OneProject {
        async fn list_projects(&self) -> Result<Vec<Value>> {
            Ok(vec![])
        }
        async fn get_project(&self, _: &str) -> Result<Option<Value>> {
            Ok(None)
        }
        async fn resolve_project(
            &self,
            uuid: &str,
        ) -> Result<Option<devforge_shared::ProjectTestContext>> {
            Ok(
                (uuid == "proj-uuid-1234").then(|| devforge_shared::ProjectTestContext {
                    project_uuid: uuid.into(),
                    server_id: "srv".into(),
                    workdir: "/app".into(),
                    test_command: String::new(),
                    timeout: None,
                }),
            )
        }
        async fn deployment_logs(&self, _: &str) -> Result<Value> {
            Ok(json!({}))
        }
        async fn list_deployments(&self, _: &str) -> Result<Value> {
            Ok(json!({}))
        }
        async fn cancel_deployment(&self, _: &str) -> Result<Value> {
            Ok(json!({}))
        }
        async fn trigger_deploy(&self, _: &str, _: Option<String>, _: &str) -> Result<Value> {
            Ok(json!({}))
        }
    }

    fn registry(raw_logs: &str, args: &Value) -> crate::ToolRegistry {
        let opts = container_logs_options(args).unwrap();
        let cmd = devforge_deploy::runtime_logs::docker_logs_command("df-proj-uuid-12", &opts);
        let exec = devforge_deploy::StubRemoteExecutor::new().with_script(
            format!("srv|/app|{cmd}"),
            devforge_deploy::ExecResult {
                ok: true,
                exit_code: 0,
                output: raw_logs.into(),
            },
        );
        let mut reg = crate::ToolRegistry::new();
        reg.register(Arc::new(GetContainerLogsTool {
            deploy: Arc::new(DeployFacade::new(Arc::new(exec))),
            store: Arc::new(OneProject),
        }));
        reg
    }

    #[tokio::test]
    async fn tool_is_listed_for_mcp_clients_as_read_only() {
        let reg = registry("", &json!({}));
        let mcp = devforge_mcp::McpServerFacade::new();
        mcp.set_tools(reg.definitions()).await;
        let payload = mcp.tools_list_payload().await;
        let tool = payload["tools"]
            .as_array()
            .unwrap()
            .iter()
            .find(|t| t["name"] == GET_CONTAINER_LOGS)
            .expect("get_container_logs listé");
        let desc = tool["description"].as_str().unwrap();
        assert!(desc.contains("LECTURE SEULE"), "{desc}");
        assert!(desc.contains("masqués"), "{desc}");
        let props = &tool["inputSchema"]["properties"];
        for p in ["project", "tail", "since", "grep", "level", "service"] {
            assert!(props.get(p).is_some(), "paramètre {p} absent");
        }
        assert_eq!(props["tail"]["maximum"], MAX_TAIL);
    }

    #[tokio::test]
    async fn execute_masks_secrets_and_filters() {
        let args = json!({"project_uuid": "proj-uuid-1234", "grep": "play", "since": "30m"});
        let raw = "t1 play start Authorization: Bearer abcdefghijklmnopqrst\nt2 other\nt3 PLAY /v?api_key=K123 ok";
        let reg = registry(raw, &args);
        let out = reg.execute(GET_CONTAINER_LOGS, args).await.unwrap();
        assert_eq!(out["ok"], true, "{out}");
        let logs = out["logs"].as_str().unwrap();
        assert_eq!(out["lines"], 2, "{logs}");
        assert!(!logs.contains("abcdefghijklmnopqrst"), "{logs}");
        assert!(!logs.contains("K123"), "{logs}");
        assert_eq!(out["truncated"], false);
        assert_eq!(out["container"], "df-proj-uuid-12");
        assert_eq!(out["query"]["since"], "1800s");
    }

    #[tokio::test]
    async fn execute_rejects_unknown_project_and_bad_args() {
        let reg = registry("", &json!({}));
        let out = reg
            .execute(GET_CONTAINER_LOGS, json!({"project": "nope"}))
            .await
            .unwrap();
        assert_eq!(out["ok"], false);
        let out = reg
            .execute(
                GET_CONTAINER_LOGS,
                json!({"project": "proj-uuid-1234", "since": "hier"}),
            )
            .await
            .unwrap();
        assert_eq!(out["ok"], false);
        assert!(out["error"].as_str().unwrap().contains("since"));
    }
}
