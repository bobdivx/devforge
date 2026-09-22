use sqlx::SqlitePool;

pub async fn migrate(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            slug TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL DEFAULT 'ready',
            git_repository TEXT,
            git_branch TEXT DEFAULT 'main',
            server_id TEXT,
            workdir TEXT,
            test_command TEXT,
            production_url TEXT,
            workspace_uuid TEXT NOT NULL DEFAULT '',
            build_pack TEXT NOT NULL DEFAULT 'nixpacks',
            port INTEGER NOT NULL DEFAULT 3000,
            is_static INTEGER NOT NULL DEFAULT 0,
            publish_directory TEXT,
            base_directory TEXT NOT NULL DEFAULT '/',
            docker_compose_location TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        "#,
    )
    .execute(pool)
    .await?;

    // Legacy DBs created before workspace_uuid / plan / build fields.
    let _ = sqlx::query(
        "ALTER TABLE projects ADD COLUMN workspace_uuid TEXT NOT NULL DEFAULT ''",
    )
    .execute(pool)
    .await;

    for (col, def) in [
        ("build_pack", "TEXT NOT NULL DEFAULT 'nixpacks'"),
        ("port", "INTEGER NOT NULL DEFAULT 3000"),
        ("is_static", "INTEGER NOT NULL DEFAULT 0"),
        ("publish_directory", "TEXT"),
        ("base_directory", "TEXT NOT NULL DEFAULT '/'"),
        ("docker_compose_location", "TEXT"),
        ("is_sso_protected", "INTEGER"),
        ("has_own_user_system", "INTEGER"),
        ("auto_deploy", "INTEGER NOT NULL DEFAULT 1"),
    ] {
        let sql = format!("ALTER TABLE projects ADD COLUMN {col} {def}");
        let _ = sqlx::query(&sql).execute(pool).await;
    }

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS deployments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT NOT NULL UNIQUE,
            project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            status TEXT NOT NULL DEFAULT 'queued',
            git_sha TEXT,
            git_message TEXT,
            logs TEXT,
            finished_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        "#,
    )
    .execute(pool)
    .await?;

    for (col, def) in [
        ("error_summary", "TEXT"),
        ("error_hint", "TEXT"),
        ("live_revision_sha", "TEXT"),
    ] {
        let sql = format!("ALTER TABLE deployments ADD COLUMN {col} {def}");
        let _ = sqlx::query(&sql).execute(pool).await;
    }

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS project_env_vars (
            project_uuid TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            secret INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (project_uuid, key)
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS project_oidc_clients (
            project_uuid TEXT PRIMARY KEY,
            client_id TEXT NOT NULL,
            client_secret TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS project_agents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT NOT NULL UNIQUE,
            project_uuid TEXT NOT NULL,
            name TEXT NOT NULL,
            role TEXT NOT NULL,
            kind TEXT NOT NULL,
            parent_agent_uuid TEXT,
            status TEXT NOT NULL DEFAULT 'idle',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS agent_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT NOT NULL UNIQUE,
            project_uuid TEXT NOT NULL,
            agent_uuid TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            tool_calls_json TEXT NOT NULL DEFAULT '[]',
            provider TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_agent_messages_agent ON agent_messages(agent_uuid, id)",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS agent_runs (
            uuid TEXT PRIMARY KEY,
            project_uuid TEXT NOT NULL,
            agent_uuid TEXT NOT NULL,
            message_uuid TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL,
            error TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status, created_at)",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS agent_conversation_shares (
            token TEXT PRIMARY KEY,
            project_uuid TEXT NOT NULL,
            agent_uuid TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_agent_shares_agent ON agent_conversation_shares(agent_uuid)",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT NOT NULL UNIQUE,
            email TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS teams (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            slug TEXT NOT NULL UNIQUE,
            show_boarding INTEGER NOT NULL DEFAULT 0,
            plan TEXT NOT NULL DEFAULT 'free',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        "#,
    )
    .execute(pool)
    .await?;

    let _ = sqlx::query("ALTER TABLE teams ADD COLUMN plan TEXT NOT NULL DEFAULT 'free'")
        .execute(pool)
        .await;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS team_members (
            team_uuid TEXT NOT NULL,
            user_uuid TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'owner',
            created_at TEXT NOT NULL,
            PRIMARY KEY (team_uuid, user_uuid)
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_uuid TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS api_tokens (
            id TEXT PRIMARY KEY,
            user_uuid TEXT NOT NULL,
            name TEXT NOT NULL,
            token_hash TEXT NOT NULL UNIQUE,
            token_prefix TEXT NOT NULL,
            abilities TEXT NOT NULL DEFAULT 'read,write',
            last_used_at TEXT,
            expires_at TEXT,
            created_at TEXT NOT NULL
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS instance_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            instance_name TEXT NOT NULL DEFAULT '',
            instance_url TEXT NOT NULL DEFAULT '',
            wildcard_domain TEXT NOT NULL DEFAULT '',
            github_token TEXT NOT NULL DEFAULT '',
            ssh_host TEXT NOT NULL DEFAULT '',
            ssh_user TEXT NOT NULL DEFAULT 'root',
            llm_provider TEXT NOT NULL DEFAULT 'auto',
            llm_api_key TEXT NOT NULL DEFAULT '',
            llm_model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
            llm_base_url TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL
        );
        "#,
    )
    .execute(pool)
    .await?;

    let settings: Option<(i64,)> =
        sqlx::query_as("SELECT id FROM instance_settings WHERE id = 1")
            .fetch_optional(pool)
            .await?;
    if settings.is_none() {
        let now = chrono::Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO instance_settings (id, instance_name, instance_url, wildcard_domain, github_token, ssh_host, ssh_user, updated_at) VALUES (1, '', '', '', '', '', 'root', ?)",
        )
        .bind(&now)
        .execute(pool)
        .await?;
    }

    for (col, def) in [
        ("llm_provider", "TEXT NOT NULL DEFAULT 'auto'"),
        ("llm_api_key", "TEXT NOT NULL DEFAULT ''"),
        ("llm_model", "TEXT NOT NULL DEFAULT 'gpt-4o-mini'"),
        ("llm_base_url", "TEXT NOT NULL DEFAULT ''"),
        ("backup_s3_enabled", "INTEGER NOT NULL DEFAULT 0"),
        ("backup_s3_name", "TEXT NOT NULL DEFAULT 'S3 backups'"),
        ("backup_s3_key", "TEXT NOT NULL DEFAULT ''"),
        ("backup_s3_secret", "TEXT NOT NULL DEFAULT ''"),
        ("backup_s3_bucket", "TEXT NOT NULL DEFAULT ''"),
        ("backup_s3_region", "TEXT NOT NULL DEFAULT 'fr-par'"),
        ("backup_s3_endpoint", "TEXT NOT NULL DEFAULT ''"),
        ("backup_auto_enabled", "INTEGER NOT NULL DEFAULT 1"),
        ("backup_auto_interval_hours", "INTEGER NOT NULL DEFAULT 24"),
        ("backup_auto_retention_count", "INTEGER NOT NULL DEFAULT 7"),
        ("sso_protect_apps_by_default", "INTEGER NOT NULL DEFAULT 1"),
        ("sso_forward_auth_address", "TEXT NOT NULL DEFAULT ''"),
        ("sso_hide_local_login", "INTEGER NOT NULL DEFAULT 0"),
        ("sso_pocket_id_url", "TEXT NOT NULL DEFAULT ''"),
        ("sso_oauth2_proxy_url", "TEXT NOT NULL DEFAULT ''"),
        ("sso_apps_client_id", "TEXT NOT NULL DEFAULT ''"),
        ("sso_apps_client_secret", "TEXT NOT NULL DEFAULT ''"),
        ("sso_pocket_id_api_token", "TEXT NOT NULL DEFAULT ''"),
        ("sso_oidc_provider", "TEXT NOT NULL DEFAULT 'generic'"),
        ("sso_enable_platform_login", "INTEGER NOT NULL DEFAULT 0"),
        ("dns_provider", "TEXT NOT NULL DEFAULT ''"),
        ("porkbun_api_key", "TEXT NOT NULL DEFAULT ''"),
        ("porkbun_secret", "TEXT NOT NULL DEFAULT ''"),
        ("porkbun_zone", "TEXT NOT NULL DEFAULT ''"),
        ("cloudflare_api_token", "TEXT NOT NULL DEFAULT ''"),
        ("placement_auto", "INTEGER NOT NULL DEFAULT 1"),
    ] {
        let sql = format!("ALTER TABLE instance_settings ADD COLUMN {col} {def}");
        let _ = sqlx::query(&sql).execute(pool).await;
    }

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS instance_backups (
            id TEXT PRIMARY KEY,
            storage_key TEXT NOT NULL,
            size_bytes INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'completed',
            message TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        );
        "#,
    )
    .execute(pool)
    .await?;

    purge_demo_data(pool).await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS mcp_servers (
            id TEXT PRIMARY KEY,
            workspace_uuid TEXT NOT NULL DEFAULT '',
            name TEXT NOT NULL,
            url TEXT NOT NULL DEFAULT '',
            enabled INTEGER NOT NULL DEFAULT 1,
            catalog_id TEXT,
            headers_json TEXT NOT NULL DEFAULT '{}',
            meta_json TEXT NOT NULL DEFAULT '{}',
            secrets_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        "#,
    )
    .execute(pool)
    .await?;

    // Colonnes OAuth pour authentification distante
    for (col, def) in [
        ("oauth_access_token", "TEXT NOT NULL DEFAULT ''"),
        ("oauth_refresh_token", "TEXT NOT NULL DEFAULT ''"),
        ("oauth_expires_at", "TEXT NOT NULL DEFAULT ''"),
        ("oauth_scopes", "TEXT NOT NULL DEFAULT ''"),
    ] {
        let sql = format!("ALTER TABLE mcp_servers ADD COLUMN {col} {def}");
        let _ = sqlx::query(&sql).execute(pool).await;
    }

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS mcp_oauth_pending (
            state TEXT PRIMARY KEY,
            server_id TEXT NOT NULL,
            workspace_uuid TEXT NOT NULL,
            code_verifier TEXT NOT NULL,
            redirect_uri TEXT NOT NULL,
            auth_url TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            token_endpoint TEXT NOT NULL DEFAULT ''
        );
        "#,
    )
    .execute(pool)
    .await?;
    
    // Migration : ajouter token_endpoint si manquant
    let _ = sqlx::query("ALTER TABLE mcp_oauth_pending ADD COLUMN token_endpoint TEXT NOT NULL DEFAULT ''")
        .execute(pool)
        .await;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS llm_providers (
            id TEXT PRIMARY KEY,
            catalog_id TEXT NOT NULL DEFAULT '',
            name TEXT NOT NULL,
            provider TEXT NOT NULL,
            api_key TEXT NOT NULL DEFAULT '',
            base_url TEXT NOT NULL DEFAULT '',
            model TEXT NOT NULL DEFAULT 'auto',
            is_default INTEGER NOT NULL DEFAULT 0,
            enabled INTEGER NOT NULL DEFAULT 1,
            priority INTEGER NOT NULL DEFAULT 100,
            healthy INTEGER NOT NULL DEFAULT 1,
            last_probe_at TEXT NOT NULL DEFAULT '',
            last_probe_error TEXT NOT NULL DEFAULT '',
            resolved_model TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        "#,
    )
    .execute(pool)
    .await?;

    // Migration douce si table déjà créée sans priority
    let _ = sqlx::query(
        "ALTER TABLE llm_providers ADD COLUMN priority INTEGER NOT NULL DEFAULT 100",
    )
    .execute(pool)
    .await;

    // Health probe (cloud + local) — ne désactive pas `enabled`, filtre la chaîne.
    let _ = sqlx::query(
        "ALTER TABLE llm_providers ADD COLUMN healthy INTEGER NOT NULL DEFAULT 1",
    )
    .execute(pool)
    .await;
    let _ = sqlx::query("ALTER TABLE llm_providers ADD COLUMN last_probe_at TEXT NOT NULL DEFAULT ''")
        .execute(pool)
        .await;
    let _ = sqlx::query(
        "ALTER TABLE llm_providers ADD COLUMN last_probe_error TEXT NOT NULL DEFAULT ''",
    )
    .execute(pool)
    .await;
    let _ = sqlx::query(
        "ALTER TABLE llm_providers ADD COLUMN resolved_model TEXT NOT NULL DEFAULT ''",
    )
    .execute(pool)
    .await;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS project_resource_links (
            id TEXT PRIMARY KEY,
            project_uuid TEXT NOT NULL,
            provider TEXT NOT NULL,
            server_id TEXT NOT NULL,
            resource_id TEXT NOT NULL,
            resource_name TEXT NOT NULL,
            meta_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            UNIQUE(project_uuid, provider, resource_id)
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS project_ports (
            id TEXT PRIMARY KEY,
            project_uuid TEXT NOT NULL,
            container_port INTEGER NOT NULL,
            public_port INTEGER,
            protocol TEXT NOT NULL DEFAULT 'tcp',
            public INTEGER NOT NULL DEFAULT 1
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS project_domains (
            id TEXT PRIMARY KEY,
            project_uuid TEXT NOT NULL,
            fqdn TEXT NOT NULL,
            tls INTEGER NOT NULL DEFAULT 1,
            status TEXT NOT NULL DEFAULT 'active'
        );
        "#,
    )
    .execute(pool)
    .await?;

        sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS project_proxy_routes (
            id TEXT PRIMARY KEY,
            project_uuid TEXT NOT NULL,
            host TEXT NOT NULL,
            path_prefix TEXT NOT NULL DEFAULT '/',
            target_port INTEGER NOT NULL,
            https_redirect INTEGER NOT NULL DEFAULT 1
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS project_crons (
            id TEXT PRIMARY KEY,
            project_uuid TEXT NOT NULL,
            name TEXT NOT NULL,
            cron_expression TEXT NOT NULL,
            command TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            timezone TEXT,
            last_status TEXT,
            last_run_at TEXT,
            next_run_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS project_cron_runs (
            id TEXT PRIMARY KEY,
            cron_id TEXT NOT NULL,
            project_uuid TEXT NOT NULL,
            status TEXT NOT NULL,
            output TEXT,
            exit_code INTEGER,
            started_at TEXT NOT NULL,
            finished_at TEXT
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_cron_runs_cron ON project_cron_runs(cron_id, started_at DESC)")
        .execute(pool)
        .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS oidc_states (
            state TEXT PRIMARY KEY,
            nonce TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            code_verifier TEXT NOT NULL DEFAULT ''
        );
        "#,
    )
    .execute(pool)
    .await?;

    let _ = sqlx::query(
        "ALTER TABLE oidc_states ADD COLUMN code_verifier TEXT NOT NULL DEFAULT ''",
    )
    .execute(pool)
    .await;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS managed_runners (
            id TEXT PRIMARY KEY,
            server_id TEXT NOT NULL DEFAULT 'default',
            container_name TEXT NOT NULL,
            runner_name TEXT NOT NULL,
            owner TEXT NOT NULL,
            repo TEXT NOT NULL,
            repo_url TEXT NOT NULL,
            image TEXT NOT NULL,
            labels TEXT NOT NULL DEFAULT 'self-hosted,devforge',
            network_mode TEXT NOT NULL DEFAULT 'bridge',
            timezone TEXT NOT NULL DEFAULT 'UTC',
            replace_existing INTEGER NOT NULL DEFAULT 1,
            pull_image INTEGER NOT NULL DEFAULT 1,
            volumes_json TEXT NOT NULL DEFAULT '[]',
            extra_env_json TEXT NOT NULL DEFAULT '[]',
            auth_mode TEXT NOT NULL DEFAULT 'registration',
            enabled INTEGER NOT NULL DEFAULT 1,
            project_uuid TEXT,
            live_state TEXT NOT NULL DEFAULT 'pending',
            live_status TEXT NOT NULL DEFAULT '',
            container_id TEXT,
            github_status TEXT,
            github_busy INTEGER,
            github_runner_id INTEGER,
            last_synced_at TEXT,
            last_error TEXT,
            op_status TEXT NOT NULL DEFAULT 'idle',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(server_id, container_name)
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS cluster_local (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            role TEXT NOT NULL DEFAULT 'leader',
            leader_url TEXT NOT NULL DEFAULT '',
            node_id TEXT NOT NULL DEFAULT 'default',
            node_secret TEXT NOT NULL DEFAULT '',
            node_name TEXT NOT NULL DEFAULT 'Leader',
            advertise_url TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS cluster_nodes (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'worker',
            advertise_url TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'offline',
            os TEXT NOT NULL DEFAULT '',
            arch TEXT NOT NULL DEFAULT '',
            capabilities_json TEXT NOT NULL DEFAULT '[]',
            ssh_host TEXT,
            ssh_user TEXT,
            ssh_port INTEGER,
            last_seen_at TEXT,
            last_error TEXT,
            drained INTEGER NOT NULL DEFAULT 0,
            metrics_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        "#,
    )
    .execute(pool)
    .await?;

    let _ = sqlx::query(
        "ALTER TABLE cluster_local ADD COLUMN advertise_url TEXT NOT NULL DEFAULT ''",
    )
    .execute(pool)
    .await;
    let _ = sqlx::query(
        "ALTER TABLE cluster_local ADD COLUMN acting_leader INTEGER NOT NULL DEFAULT 0",
    )
    .execute(pool)
    .await;
    let _ = sqlx::query(
        "ALTER TABLE cluster_local ADD COLUMN preferred_leader_id TEXT NOT NULL DEFAULT 'default'",
    )
    .execute(pool)
    .await;
    let _ = sqlx::query(
        "ALTER TABLE cluster_local ADD COLUMN preferred_leader_url TEXT NOT NULL DEFAULT ''",
    )
    .execute(pool)
    .await;
    let _ = sqlx::query(
        "ALTER TABLE cluster_local ADD COLUMN failover_secret TEXT NOT NULL DEFAULT ''",
    )
    .execute(pool)
    .await;
    let _ = sqlx::query(
        "ALTER TABLE cluster_local ADD COLUMN snapshot_generation INTEGER NOT NULL DEFAULT 0",
    )
    .execute(pool)
    .await;
    let _ = sqlx::query(
        "ALTER TABLE cluster_nodes ADD COLUMN drained INTEGER NOT NULL DEFAULT 0",
    )
    .execute(pool)
    .await;
    let _ = sqlx::query(
        "ALTER TABLE cluster_nodes ADD COLUMN metrics_json TEXT NOT NULL DEFAULT '{}'",
    )
    .execute(pool)
    .await;
    let _ = sqlx::query(
        "ALTER TABLE cluster_nodes ADD COLUMN ingress_host TEXT NOT NULL DEFAULT ''",
    )
    .execute(pool)
    .await;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS cluster_join_tokens (
            id TEXT PRIMARY KEY,
            token_hash TEXT NOT NULL UNIQUE,
            expires_at TEXT NOT NULL,
            revoked_at TEXT,
            created_by TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS cluster_node_secrets (
            node_id TEXT PRIMARY KEY,
            secret TEXT NOT NULL,
            secret_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        "#,
    )
    .execute(pool)
    .await?;

    let local: Option<(i64,)> = sqlx::query_as("SELECT id FROM cluster_local WHERE id = 1")
        .fetch_optional(pool)
        .await?;
    if local.is_none() {
        let now = chrono::Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO cluster_local (id, role, leader_url, node_id, node_secret, node_name, updated_at) VALUES (1, 'leader', '', 'default', '', 'Leader', ?)",
        )
        .bind(&now)
        .execute(pool)
        .await?;
    }

    Ok(())
}

/// Remove leftover demo fixtures from earlier greenfield seeds.
pub async fn purge_demo_data(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let demo_uuid = "uji97r70f1jaq9m7l9btm61d";
    let project_id: Option<(i64,)> =
        sqlx::query_as("SELECT id FROM projects WHERE uuid = ? OR slug = 'demo-app' LIMIT 1")
            .bind(demo_uuid)
            .fetch_optional(pool)
            .await?;
    if let Some((id,)) = project_id {
        sqlx::query("DELETE FROM deployments WHERE project_id = ?")
            .bind(id)
            .execute(pool)
            .await?;
        sqlx::query("DELETE FROM project_env_vars WHERE project_uuid = ?")
            .bind(demo_uuid)
            .execute(pool)
            .await?;
        sqlx::query("DELETE FROM project_agents WHERE project_uuid = ?")
            .bind(demo_uuid)
            .execute(pool)
            .await?;
        sqlx::query("DELETE FROM agent_messages WHERE project_uuid = ?")
            .bind(demo_uuid)
            .execute(pool)
            .await?;
        sqlx::query("DELETE FROM projects WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await?;
    }
    sqlx::query("DELETE FROM projects WHERE name = 'Demo App' OR slug LIKE 'demo-%'")
        .execute(pool)
        .await?;
    Ok(())
}

/// Agents obligatoires créés avec chaque project.
pub async fn seed_required_agents(pool: &SqlitePool, project_uuid: &str) -> Result<(), sqlx::Error> {
    let count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM project_agents WHERE project_uuid = ? AND kind = 'required'",
    )
    .bind(project_uuid)
    .fetch_one(pool)
    .await?;
    if count.0 > 0 {
        return Ok(());
    }

    let now = chrono::Utc::now().to_rfc3339();
    let required = [("Ops", "ops"), ("Deploy", "deploy"), ("Reviewer", "reviewer")];
    for (name, role) in required {
        let uuid = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            r#"INSERT INTO project_agents (
                uuid, project_uuid, name, role, kind, parent_agent_uuid, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'required', NULL, 'idle', ?, ?)"#,
        )
        .bind(&uuid)
        .bind(project_uuid)
        .bind(name)
        .bind(role)
        .bind(&now)
        .bind(&now)
        .execute(pool)
        .await?;
    }
    Ok(())
}
