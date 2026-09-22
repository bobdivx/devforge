//! Instances PostgreSQL des projets : un conteneur par base, sur le nœud de la forge.
//! Déplacer le projet copie le dump vers le nœud cible avant de changer `server_id`.

use chrono::Utc;
use devforge_cluster::{NodeRole, NodeStatus};
use devforge_database::{
    apply_sql_shell, drop_shell, dump_shell, ensure_published_shell, plan_sqlite_file,
    promote_standby_shell, provision_shell, resolve_sqlite_source, standby_shell, wait_shell,
    PgInstance,
};
use devforge_env::EnvVar;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::cluster_routes::normalize_server_id;
use crate::state::{AppState, Project};

const DUMP_LIMIT: usize = 480_000;

pub async fn provision_project_postgres(
    state: &AppState,
    project: &Project,
    name: &str,
    migrate_sqlite: bool,
) -> Result<Value, String> {
    let inst = PgInstance::create(name)?;
    let server = normalize_server_id(project.server_id.as_deref().unwrap_or(""));
    exec_ok(
        state,
        &server,
        &provision_shell(&inst)?,
        180,
        "démarrage postgres",
    )
    .await?;
    exec_ok(state, &server, &wait_shell(&inst)?, 50, "attente postgres").await?;

    let migration = if migrate_sqlite {
        migrate_sqlite_into(state, project, &inst, &server).await?
    } else {
        json!({ "skipped": true })
    };

    state
        .env
        .upsert(
            &project.uuid,
            EnvVar {
                key: "DATABASE_URL".into(),
                value: inst.database_url(),
                secret: true,
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    let link_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let meta = json!({
        "container": inst.container,
        "volume": inst.volume,
        "user": inst.user,
        "password": inst.password,
        "database": inst.database,
        "image": "postgres:16-alpine",
        "host_port": inst.host_port,
        "replication_password": inst.replication_password,
    });
    sqlx::query(
        r#"
        INSERT INTO project_resource_links
            (id, project_uuid, provider, server_id, resource_id, resource_name, meta_json, created_at)
        VALUES ($1, $2, 'postgres', $3, $4, $5, $6, $7)
        "#,
    )
    .bind(&link_id)
    .bind(&project.uuid)
    .bind(&server)
    .bind(&inst.container)
    .bind(name.trim())
    .bind(meta.to_string())
    .bind(&now)
    .execute(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(json!({
        "ok": true,
        "id": link_id,
        "container": inst.container,
        "database": inst.database,
        "server_id": server,
        "env_keys": ["DATABASE_URL"],
        "migration": migration,
    }))
}

pub async fn destroy_project_postgres(
    state: &AppState,
    project: &Project,
    link_id: &str,
) -> Result<Value, String> {
    let row = load_link(state, &project.uuid, link_id).await?;
    let inst = instance_from_meta(&row.meta)?;
    let server = normalize_server_id(&row.server_id);
    let drop_res = state
        .deploy
        .exec(&server, "", &drop_shell(&inst)?, 40)
        .await
        .map_err(|e| e.to_string())?;
    if !drop_res.ok {
        tracing::warn!(
            output = %drop_res.output,
            "suppression du conteneur postgres incomplète"
        );
    }
    sqlx::query("DELETE FROM project_resource_links WHERE id = $1 AND project_uuid = $2")
        .bind(link_id)
        .bind(&project.uuid)
        .execute(&state.pool)
        .await
        .map_err(|e| e.to_string())?;

    if let Ok(Some(var)) = state.env.get(&project.uuid, "DATABASE_URL").await {
        if var.value.contains(&inst.container) {
            let _ = state.env.delete(&project.uuid, "DATABASE_URL").await;
        }
    }
    Ok(json!({ "ok": true, "container": inst.container }))
}

/// Copie chaque instance PostgreSQL du projet de `from` vers `to`.
/// Les conteneurs source restent en place : [`retire_postgres_sources`] après
/// la mise à jour de `projects.server_id`, pour ne pas perdre le volume si
/// cette mise à jour échoue.
pub async fn relocate_project_postgres(
    state: &AppState,
    project_uuid: &str,
    from: &str,
    to: &str,
) -> Result<Vec<PgInstance>, String> {
    let from = normalize_server_id(from);
    let to = normalize_server_id(to);
    if from == to {
        return Ok(Vec::new());
    }
    let links = list_postgres_links(state, project_uuid).await?;
    let mut copied = Vec::new();
    for link in links {
        let inst = instance_from_meta(&link.meta)?;
        let dump = exec_ok(state, &from, &dump_shell(&inst)?, 120, "pg_dump").await?;
        if dump.len() >= DUMP_LIMIT {
            return Err(format!(
                "dump de {} trop volumineux pour le transfert entre nœuds",
                inst.container
            ));
        }
        exec_ok(state, &to, &provision_shell(&inst)?, 180, "postgres cible").await?;
        exec_ok(
            state,
            &to,
            &wait_shell(&inst)?,
            50,
            "attente postgres cible",
        )
        .await?;
        exec_ok(
            state,
            &to,
            &apply_sql_shell(&inst, &dump)?,
            120,
            "restauration",
        )
        .await?;
        sqlx::query("UPDATE project_resource_links SET server_id = $1 WHERE id = $2")
            .bind(&to)
            .bind(&link.id)
            .execute(&state.pool)
            .await
            .map_err(|e| e.to_string())?;
        copied.push(inst);
    }
    Ok(copied)
}

/// Maintient une réplique physique de chaque base projet sur un autre nœud.
pub async fn sync_standbys(state: &AppState) {
    let Ok(local) = state.cluster.local().await else {
        return;
    };
    if local.writes_fenced || local.role != NodeRole::Leader {
        return;
    }
    let Ok(nodes) = state.cluster.list_nodes().await else {
        return;
    };
    let rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT id, server_id, meta_json FROM project_resource_links WHERE provider = 'postgres'",
    )
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();
    for (id, server_id, meta_json) in rows {
        let meta: Value = serde_json::from_str(&meta_json).unwrap_or(json!({}));
        if let Err(e) = sync_one_standby(state, &local.node_id, &nodes, &id, &server_id, meta).await
        {
            tracing::warn!(link = %id, error = %e, "réplique postgres projet");
        }
    }
}

pub fn spawn_standby_loop(state: AppState) {
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(25)).await;
        loop {
            sync_standbys(&state).await;
            tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        }
    });
}

/// Le nœud primaire est injoignable. La réplique déjà en place est promue ou copiée.
pub async fn recover_offline_postgres(
    state: &AppState,
    project_uuid: &str,
    target: &str,
) -> Result<(), String> {
    let links = list_postgres_links(state, project_uuid).await?;
    if links.is_empty() {
        return Ok(());
    }
    let local_id = state
        .cluster
        .local()
        .await
        .map(|l| l.node_id)
        .unwrap_or_default();
    let target = normalize_server_id(target);
    for link in links {
        let standby = link
            .meta
            .get("standby_server_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if standby.is_empty() {
            return Err("pas de réplique sur un nœud vivant".into());
        }
        let inst = instance_from_meta(&link.meta)?;
        let standby_id = normalize_server_id(&standby);
        if standby_id == target {
            exec_ok(
                state,
                &target,
                &promote_standby_shell(&inst)?,
                120,
                "promotion réplique",
            )
            .await?;
            let mut meta = link.meta.clone();
            meta["volume"] = json!(inst.standby_volume());
            meta["standby_server_id"] = json!("");
            save_link(state, &link.id, &target, &meta).await?;
            continue;
        }
        let dump = if standby_id == normalize_server_id(&local_id) {
            dump_standby_local(&inst).await?
        } else {
            let mut ha = inst.clone();
            ha.container = inst.standby_container();
            exec_ok(
                state,
                &standby_id,
                &dump_shell(&ha)?,
                180,
                "pg_dump réplique",
            )
            .await?
        };
        if dump.len() >= 32_000_000 {
            return Err(format!("dump de {} trop volumineux", inst.container));
        }
        exec_ok(
            state,
            &target,
            &provision_shell(&inst)?,
            180,
            "postgres cible",
        )
        .await?;
        exec_ok(
            state,
            &target,
            &wait_shell(&inst)?,
            50,
            "attente postgres cible",
        )
        .await?;
        exec_ok(
            state,
            &target,
            &apply_sql_shell(&inst, &dump)?,
            180,
            "restauration",
        )
        .await?;
        let mut meta = link.meta.clone();
        meta["standby_server_id"] = json!("");
        save_link(state, &link.id, &target, &meta).await?;
    }
    Ok(())
}

pub async fn retire_postgres_sources(state: &AppState, server_id: &str, instances: &[PgInstance]) {
    let server = normalize_server_id(server_id);
    for inst in instances {
        let Ok(cmd) = drop_shell(inst) else {
            continue;
        };
        match state.deploy.exec(&server, "", &cmd, 40).await {
            Ok(res) if res.ok => {}
            Ok(res) => tracing::warn!(
                container = %inst.container,
                output = %res.output,
                "instance postgres source encore présente après copie"
            ),
            Err(e) => tracing::warn!(
                container = %inst.container,
                error = %e,
                "retrait de l'instance postgres source impossible"
            ),
        }
    }
}

async fn migrate_sqlite_into(
    state: &AppState,
    project: &Project,
    inst: &PgInstance,
    server: &str,
) -> Result<Value, String> {
    let url = state
        .env
        .get(&project.uuid, "DATABASE_URL")
        .await
        .ok()
        .flatten()
        .map(|v| v.value);
    let workdir = project.workdir.as_deref().map(std::path::Path::new);
    let Some(path) = resolve_sqlite_source(workdir, url.as_deref()) else {
        return Ok(json!({
            "skipped": true,
            "reason": "aucun fichier SQLite (DATABASE_URL ou data/app.db)"
        }));
    };
    let plan = plan_sqlite_file(&path).await?;
    if plan.tables == 0 {
        return Ok(json!({
            "file": plan.source,
            "tables": 0,
            "rows": 0
        }));
    }
    exec_ok(
        state,
        server,
        &apply_sql_shell(inst, &plan.sql)?,
        120,
        "import sqlite",
    )
    .await?;
    Ok(json!({
        "file": plan.source,
        "tables": plan.tables,
        "rows": plan.rows
    }))
}

struct PgLink {
    id: String,
    server_id: String,
    meta: Value,
}

async fn load_link(state: &AppState, project_uuid: &str, link_id: &str) -> Result<PgLink, String> {
    let row: Option<(String, String, String, String)> = sqlx::query_as(
        r#"SELECT id, server_id, provider, meta_json
           FROM project_resource_links
           WHERE id = $1 AND project_uuid = $2"#,
    )
    .bind(link_id)
    .bind(project_uuid)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| e.to_string())?;
    let Some((id, server_id, provider, meta_json)) = row else {
        return Err("instance introuvable".into());
    };
    if provider != "postgres" {
        return Err("ce lien n'est pas une instance PostgreSQL".into());
    }
    let meta: Value = serde_json::from_str(&meta_json).unwrap_or(json!({}));
    Ok(PgLink {
        id,
        server_id,
        meta,
    })
}

async fn list_postgres_links(state: &AppState, project_uuid: &str) -> Result<Vec<PgLink>, String> {
    let rows: Vec<(String, String, String)> = sqlx::query_as(
        r#"SELECT id, server_id, meta_json
           FROM project_resource_links
           WHERE project_uuid = $1 AND provider = 'postgres'
           ORDER BY created_at"#,
    )
    .bind(project_uuid)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|(id, server_id, meta_json)| PgLink {
            id,
            server_id,
            meta: serde_json::from_str(&meta_json).unwrap_or(json!({})),
        })
        .collect())
}

async fn sync_one_standby(
    state: &AppState,
    local_id: &str,
    nodes: &[devforge_cluster::ClusterNode],
    link_id: &str,
    server_id: &str,
    mut meta: Value,
) -> Result<(), String> {
    let mut inst = instance_from_meta(&meta)?;
    if inst.host_port == 0 || inst.replication_password.is_empty() {
        let fresh = PgInstance::create(&inst.database)?;
        inst.host_port = fresh.host_port;
        inst.replication_password = fresh.replication_password;
    }
    let primary = normalize_server_id(server_id);
    exec_ok(
        state,
        &primary,
        &ensure_published_shell(&inst)?,
        180,
        "publication postgres",
    )
    .await?;
    meta["host_port"] = json!(inst.host_port);
    meta["replication_password"] = json!(inst.replication_password);
    let Some(replica) = pick_replica(&primary, local_id, nodes) else {
        save_link(state, link_id, &primary, &meta).await?;
        return Ok(());
    };
    let host = nodes
        .iter()
        .find(|n| normalize_server_id(&n.id) == primary)
        .and_then(|n| crate::control_pg::advertise_host(&n.advertise_url))
        .ok_or_else(|| "url du primaire injoignable".to_string())?;
    if replica != primary && devforge_cluster::is_loopback_advertise_url(&format!("http://{host}"))
    {
        save_link(state, link_id, &primary, &meta).await?;
        return Err("url du primaire en loopback, réplique impossible".into());
    }
    exec_ok(
        state,
        &replica,
        &standby_shell(&inst, &host)?,
        180,
        "réplique projet",
    )
    .await?;
    meta["standby_server_id"] = json!(replica);
    save_link(state, link_id, &primary, &meta).await
}

fn pick_replica(
    primary: &str,
    local_id: &str,
    nodes: &[devforge_cluster::ClusterNode],
) -> Option<String> {
    let local = normalize_server_id(local_id);
    if normalize_server_id(primary) != local {
        return Some(local);
    }
    nodes
        .iter()
        .filter(|n| n.role == NodeRole::Worker)
        .filter(|n| n.status == NodeStatus::Online)
        .filter(|n| !n.drained)
        .filter(|n| !n.advertise_url.trim().is_empty())
        .filter(|n| !devforge_cluster::is_loopback_advertise_url(&n.advertise_url))
        .min_by(|a, b| a.id.cmp(&b.id))
        .map(|n| n.id.clone())
}

async fn save_link(
    state: &AppState,
    id: &str,
    server_id: &str,
    meta: &Value,
) -> Result<(), String> {
    sqlx::query("UPDATE project_resource_links SET server_id = $1, meta_json = $2 WHERE id = $3")
        .bind(server_id)
        .bind(meta.to_string())
        .bind(id)
        .execute(&state.pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

async fn dump_standby_local(inst: &PgInstance) -> Result<String, String> {
    let out = tokio::process::Command::new("docker")
        .args([
            "exec",
            &inst.standby_container(),
            "pg_dump",
            "-U",
            &inst.user,
            "--no-owner",
            "--no-acl",
            "--clean",
            "--if-exists",
            &inst.database,
        ])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!(
            "pg_dump réplique : {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    String::from_utf8(out.stdout).map_err(|e| e.to_string())
}

fn instance_from_meta(meta: &Value) -> Result<PgInstance, String> {
    let container = meta_str(meta, "container")?;
    let volume = meta
        .get("volume")
        .and_then(|v| v.as_str())
        .unwrap_or(container)
        .to_string();
    let port = meta.get("host_port").and_then(|v| v.as_u64()).unwrap_or(0) as u16;
    let repl = meta
        .get("replication_password")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    PgInstance::resume(
        container,
        &volume,
        meta_str(meta, "user")?,
        meta_str(meta, "password")?,
        meta_str(meta, "database")?,
    )?
    .with_replication(port, repl)
}

fn meta_str<'a>(meta: &'a Value, key: &str) -> Result<&'a str, String> {
    meta.get(key)
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("métadonnées postgres incomplètes ({key})"))
}

async fn exec_ok(
    state: &AppState,
    server: &str,
    command: &str,
    timeout: u64,
    step: &str,
) -> Result<String, String> {
    let res = state
        .deploy
        .exec(server, "", command, timeout)
        .await
        .map_err(|e| format!("{step} : {e}"))?;
    if !res.ok {
        let detail = res.output.trim();
        let detail = if detail.is_empty() {
            format!("code {}", res.exit_code)
        } else {
            detail.chars().take(2000).collect()
        };
        return Err(format!("{step} : {detail}"));
    }
    Ok(res.output)
}
