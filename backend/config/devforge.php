<?php

$devforgeEnabled = env('DEVFORGE_ENABLED', true);

return [
    'enabled' => $devforgeEnabled,

    'agents_enabled' => env('DEVFORGE_AGENTS_ENABLED', $devforgeEnabled),

    /*
    | Auto-correction sur échec de déploiement / readiness.
    | Défaut true — l’agent deployment|devforge|debug est déclenché et
    | les outils mutatifs passent en ALLOW (pas d’awaiting_approval).
    */
    'agents_auto_fix_deployments' => env('DEVFORGE_AGENTS_AUTO_FIX_DEPLOYMENTS', true),

    'agents_auto_fallback' => env('DEVFORGE_AGENTS_AUTO_FALLBACK', true),

    /*
    | Probe providers (liste modèles + micro-chat) avant / pendant le routage Auto.
    | Cache ~5 min par config. Désactiver si le NAS est trop lent vers Google.
    */
    'agents_provider_probe' => env('DEVFORGE_AGENTS_PROVIDER_PROBE', true),

    'agents_github_pr_watch' => env('DEVFORGE_AGENTS_GITHUB_PR_WATCH', true),

    'agents_tech_watch' => env('DEVFORGE_AGENTS_TECH_WATCH', true),

    'agents_parallel_delegate_timeout' => (int) env('DEVFORGE_AGENTS_PARALLEL_DELEGATE_TIMEOUT', 600),

    /*
    |--------------------------------------------------------------------------
    | MCP DevForge (/mcp/devforge) — surface complète (reads + writes)
    |--------------------------------------------------------------------------
    |
    | Distinct du MCP lecture seule (/mcp). Expose les outils DevForge
    | + AgentToolkit core/GitHub (hors missions/todos/délégation). Défaut false
    | jusqu'à activation explicite. Requiert aussi is_mcp_server_enabled.
    |
    | Checklist NAS :
    | 1. Déployer DevForge + rebuild UI si besoin
    | 2. DEVFORGE_AGENTS_ENABLED=true, DEVFORGE_AGENTS_AUTO_FALLBACK=true
    | 3. DEVFORGE_MCP_ENABLED=true + activer MCP instance (UI / API)
    | 4. Token Sanctum team avec abilities read+write
    | 5. Smoke MCP tools/list → 40+ tools (list_resources, control_resource, …)
    | 6. Smoke get_deployment_logs puis fix_application_host_permissions
    |
    */
    'mcp_enabled' => env('DEVFORGE_MCP_ENABLED', false),

    /*
    | Canonical platform data directory (NAS/container).
    | Legacy installs may still use /data/coolify — bind-mount or symlink during cutover.
    */
    'data_dir' => env('DEVFORGE_DATA_DIR', env('COOLIFY_DATA_DIR', '/data/devforge')),

    /*
    |--------------------------------------------------------------------------
    | Sauvegardes S3 (instance + bases)
    |--------------------------------------------------------------------------
    |
    | Les identifiants vivent dans le .env (pas seulement en base) pour
    | survivre à une recréation de Postgres. `php artisan app:init` et
    | `php artisan devforge:ensure-s3-backup` synchronisent la destination
    | et activent save_s3 sur les plannings existants.
    |
    */
    'backup_s3' => [
        'enabled' => filter_var(env('DEVFORGE_BACKUP_S3_ENABLED', false), FILTER_VALIDATE_BOOLEAN),
        'attach_new_backups' => filter_var(env('DEVFORGE_BACKUP_S3_ATTACH_NEW', true), FILTER_VALIDATE_BOOLEAN),
        'name' => (string) env('DEVFORGE_BACKUP_S3_NAME', 'Scaleway backups'),
        'key' => (string) env('DEVFORGE_BACKUP_S3_KEY', ''),
        'secret' => (string) env('DEVFORGE_BACKUP_S3_SECRET', ''),
        'bucket' => (string) env('DEVFORGE_BACKUP_S3_BUCKET', 'devforge'),
        'region' => (string) env('DEVFORGE_BACKUP_S3_REGION', 'fr-par'),
        'endpoint' => (string) env('DEVFORGE_BACKUP_S3_ENDPOINT', 'https://s3.fr-par.scw.cloud'),
    ],

    /*
    |--------------------------------------------------------------------------
    | Séquence de démarrage des applications
    |--------------------------------------------------------------------------
    |
    | Au boot (ou quand beaucoup d’apps ne sont pas encore prêtes), DevForge
    | démarre les applications arrêtées une par une et expose la progression
    | à la page « Gérer Applications ».
    |
    */
    'application_boot_sequence' => [
        'enabled' => env('DEVFORGE_APPLICATION_BOOT_SEQUENCE', true),
        'window_seconds' => (int) env('DEVFORGE_APPLICATION_BOOT_SEQUENCE_WINDOW', 900),
        'item_timeout_seconds' => (int) env('DEVFORGE_APPLICATION_BOOT_SEQUENCE_ITEM_TIMEOUT', 300),
        'poll_interval_ms' => (int) env('DEVFORGE_APPLICATION_BOOT_SEQUENCE_POLL_MS', 2500),
    ],

    /*
    |--------------------------------------------------------------------------
    | Keep-alive applications
    |--------------------------------------------------------------------------
    |
    | Vérifie régulièrement que les applications censées tourner sont bien
    | démarrées. Un arrêt manuel (stop) désactive le redémarrage auto pour
    | cette app jusqu’au prochain start / « Démarrer toutes ».
    |
    */
    'application_keep_alive' => [
        'enabled' => env('DEVFORGE_APPLICATION_KEEP_ALIVE', true),
        'desired_ttl_seconds' => (int) env('DEVFORGE_APPLICATION_KEEP_ALIVE_TTL', 60 * 60 * 24 * 30),
    ],

    /*
    |--------------------------------------------------------------------------
    | Keep-alive bases de données
    |--------------------------------------------------------------------------
    |
    | Redémarre les bases standalone arrêtées involontairement (crash / host).
    | Un stop manuel désactive le redémarrage auto jusqu’au prochain start.
    | Les bases rattachées à une app encore en cours sont aussi relancées.
    |
    */
    'database_keep_alive' => [
        'enabled' => env('DEVFORGE_DATABASE_KEEP_ALIVE', true),
        'desired_ttl_seconds' => (int) env('DEVFORGE_DATABASE_KEEP_ALIVE_TTL', 60 * 60 * 24 * 30),
    ],

    'agents_monitor_build_enabled' => env(
        'DEVFORGE_AGENTS_MONITOR_BUILD_ENABLED',
        env('DEVFORGE_AGENTS_WEBHOOK_BUILD_ENABLED', true),
    ),

    /*
    |--------------------------------------------------------------------------
    | Agent permissions (porté depuis forge-permission-engine.ts)
    |--------------------------------------------------------------------------
    |
    | autonomous : accès total (défaut)
    | tiered     : lecture seule auto, destructif → approbation
    | plan_first : lectures + propose_plan libres ; mutations après approbation du plan
    |
    */
    'agents_permission_mode' => env('DEVFORGE_AGENTS_PERMISSION_MODE', 'autonomous'),

    'agents_permission_allowed_tools' => env('DEVFORGE_AGENTS_PERMISSION_ALLOWED_TOOLS', ''),

    'agents_permission_denied_tools' => env('DEVFORGE_AGENTS_PERMISSION_DENIED_TOOLS', ''),

    /*
    |--------------------------------------------------------------------------
    | Aperçu diff avant write_application_source (chat)
    |--------------------------------------------------------------------------
    |
    | En chat, bloque l'écriture Git jusqu'à approbation utilisateur avec diff.
    | Les runs event / harness autonomes ne sont pas concernés.
    |
    */
    'agents_chat_source_write_preview' => env('DEVFORGE_AGENTS_CHAT_SOURCE_WRITE_PREVIEW', true),

    'agents_max_iterations' => (int) env('DEVFORGE_AGENTS_MAX_ITERATIONS', 40),

    'agents_chat_max_iterations' => (int) env('DEVFORGE_AGENTS_CHAT_MAX_ITERATIONS', 40),

    /** Relances until-done (intention / explore-only) avant d'accepter une réponse texte. */
    'agents_chat_max_continue_nudges' => (int) env('DEVFORGE_AGENTS_CHAT_MAX_CONTINUE_NUDGES', 4),

    /** Si true : enqueue un run chat_continue quand une tâche actionnable reste inachevée. */
    'agents_chat_enqueue_long_tasks' => filter_var(
        env('DEVFORGE_AGENTS_CHAT_ENQUEUE_LONG_TASKS', true),
        FILTER_VALIDATE_BOOLEAN,
    ),

    /** Budget caractères pour la compaction du contexte chat LLM. */
    'agents_chat_context_max_chars' => (int) env('DEVFORGE_AGENTS_CHAT_CONTEXT_MAX_CHARS', 48000),

    /** Instructions organisation par défaut (fallback si table layers vide). */
    'agents_org_instructions' => (string) env('DEVFORGE_AGENTS_ORG_INSTRUCTIONS', ''),

    /** Clé Brave Search (optionnelle). Sinon DuckDuckGo Instant Answer. */
    'agents_web_search_brave_key' => (string) env('DEVFORGE_AGENTS_WEB_SEARCH_BRAVE_KEY', ''),

    'agents_max_concurrent_subagents' => (int) env('DEVFORGE_AGENTS_MAX_CONCURRENT_SUBAGENTS', 3),

    /** Profondeur max de spawn (0 = main, 1 = leaf, 2 = orchestrateur→implement→test). */
    'agents_max_spawn_depth' => (int) env('DEVFORGE_AGENTS_MAX_SPAWN_DEPTH', 2),

    /** P5.0 — génération dynamique de rôles (spawn_task auto_roles / roles[]). */
    'agents_dynamic_roles_enabled' => filter_var(
        env('DEVFORGE_AGENTS_DYNAMIC_ROLES_ENABLED', true),
        FILTER_VALIDATE_BOOLEAN,
    ),

    /** Cap de rôles dynamiques par spawn auto_roles / roles[]. */
    'agents_max_dynamic_roles' => (int) env('DEVFORGE_AGENTS_MAX_DYNAMIC_ROLES', 4),

    /** P5.1 — routage LLM (tier) selon role_slug / leaf_profile des leafs. */
    'agents_role_model_routing' => filter_var(
        env('DEVFORGE_AGENTS_ROLE_MODEL_ROUTING', true),
        FILTER_VALIDATE_BOOLEAN,
    ),

    /** P5.2 — mode collab (speaker selection), interdit sur deploy/CI. */
    'agents_collab_enabled' => filter_var(
        env('DEVFORGE_AGENTS_COLLAB_ENABLED', true),
        FILTER_VALIDATE_BOOLEAN,
    ),

    'agents_max_collab_rounds' => (int) env('DEVFORGE_AGENTS_MAX_COLLAB_ROUNDS', 8),

    'agents_collab_speaker_selection' => (string) env('DEVFORGE_AGENTS_COLLAB_SPEAKER_SELECTION', 'auto'),

    /** P5.4 — sandbox execute_code (Docker éphémère). Défaut on ; gérable en Paramètres. */
    'agents_code_sandbox_enabled' => filter_var(
        env('DEVFORGE_AGENTS_CODE_SANDBOX_ENABLED', true),
        FILTER_VALIDATE_BOOLEAN,
    ),
    'agents_code_sandbox_memory' => (string) env('DEVFORGE_AGENTS_CODE_SANDBOX_MEMORY', '256m'),
    'agents_code_sandbox_cpus' => (string) env('DEVFORGE_AGENTS_CODE_SANDBOX_CPUS', '0.5'),
    'agents_code_sandbox_user' => (string) env('DEVFORGE_AGENTS_CODE_SANDBOX_USER', '65534:65534'),
    'agents_code_sandbox_workdir' => (string) env('DEVFORGE_AGENTS_CODE_SANDBOX_WORKDIR', sys_get_temp_dir()),
    'agents_code_sandbox_image_php' => (string) env('DEVFORGE_AGENTS_CODE_SANDBOX_IMAGE_PHP', 'php:8.4-cli'),
    'agents_code_sandbox_image_node' => (string) env('DEVFORGE_AGENTS_CODE_SANDBOX_IMAGE_NODE', 'node:22-alpine'),
    'agents_code_sandbox_image_python' => (string) env('DEVFORGE_AGENTS_CODE_SANDBOX_IMAGE_PYTHON', 'python:3.12-alpine'),

    /** P6 — client MCP dans la boucle agent. Défaut on ; serveurs via Paramètres. */
    'agents_mcp_client_enabled' => filter_var(
        env('DEVFORGE_AGENTS_MCP_CLIENT_ENABLED', true),
        FILTER_VALIDATE_BOOLEAN,
    ),
    'agents_mcp_client_timeout' => (int) env('DEVFORGE_AGENTS_MCP_CLIENT_TIMEOUT', 30),
    /**
     * Liste JSON de serveurs MCP distants (fallback ops).
     * Préférer Paramètres avancés → agents_features.mcp_servers.
     * Exemple: [{"id":"docs","url":"https://example.com/mcp","token_env":"MCP_DOCS_TOKEN","label":"Docs"}]
     */
    'agents_mcp_servers' => json_decode((string) env('DEVFORGE_AGENTS_MCP_SERVERS', '[]'), true) ?: [],

    /** Cooldown entre deux dispatches mission_work pour la même mission (minutes). */
    'agents_mission_work_cooldown_minutes' => (int) env('DEVFORGE_AGENTS_MISSION_WORK_COOLDOWN_MINUTES', 10),

    /** Intervalle heartbeats agents (minutes). 0 = désactivé. */
    'agents_heartbeat_minutes' => (int) env('DEVFORGE_AGENTS_HEARTBEAT_MINUTES', 30),

    /*
    |--------------------------------------------------------------------------
    | Timeout queue des jobs agent (secondes)
    |--------------------------------------------------------------------------
    |
    | Doit rester inférieur à redis.retry_after (86400). Un timeout trop bas
    | (ex: 300s) tue le run avant la 1re itération LLM utile, puis le job
    | reste réservé jusqu'à retry_after → "attempted too many times" 24h plus tard.
    |
    */
    'agents_job_timeout' => (int) env('DEVFORGE_AGENTS_JOB_TIMEOUT', 1800),

    /*
    |--------------------------------------------------------------------------
    | Smart model routing (Auto → tier → modèle adapté)
    |--------------------------------------------------------------------------
    */
    'agents_smart_routing' => env('DEVFORGE_AGENTS_SMART_ROUTING', true),

    /*
    |--------------------------------------------------------------------------
    | Limite de runs agents par déploiement (quota LLM)
    |--------------------------------------------------------------------------
    |
    | 0 = illimité (comportement historique)
    | 1 = uniquement en cas d'échec (recommandé free tier Gemini)
    | 2 = échec + début de build
    | 3+ = échec + build + fin de build
    |
    */
    'agents_per_deployment_max_runs' => (int) env('DEVFORGE_AGENTS_PER_DEPLOYMENT_MAX_RUNS', 1),

    /*
    |--------------------------------------------------------------------------
    | Surveillance autonome post-deploy (readiness)
    |--------------------------------------------------------------------------
    */
    'readiness_enabled' => env('DEVFORGE_READINESS_ENABLED', true),

    'readiness_probe_delay_seconds' => (int) env('DEVFORGE_READINESS_PROBE_DELAY_SECONDS', 90),

    'readiness_probe_timeout_seconds' => (int) env('DEVFORGE_READINESS_PROBE_TIMEOUT_SECONDS', 10),

    'readiness_max_rounds' => (int) env('DEVFORGE_READINESS_MAX_ROUNDS', 5),

    'readiness_accept_insecure_tls' => env('DEVFORGE_READINESS_ACCEPT_INSECURE_TLS', true),

    'readiness_watchdog_minutes' => (int) env('DEVFORGE_READINESS_WATCHDOG_MINUTES', 3),

    /*
    |--------------------------------------------------------------------------
    | Stale agent recovery (déploiements / événements)
    |--------------------------------------------------------------------------
    |
    | Ollama est plus lent que Gemini : un run peut bloquer l'agent en "running"
    | et empêcher le déclenchement sur un nouveau déploiement.
    |
    */
    'agents_event_stale_seconds' => (int) env('DEVFORGE_AGENTS_EVENT_STALE_SECONDS', 90),

    'agents_pending_stale_seconds' => (int) env('DEVFORGE_AGENTS_PENDING_STALE_SECONDS', 45),

    /*
    |--------------------------------------------------------------------------
    | Error retention on agent cards (hours)
    |--------------------------------------------------------------------------
    |
    | After this many hours, a failed run no longer keeps the agent in "error"
    | status on the dashboard. Set to 0 to keep errors until the next success.
    |
    */
    'agents_error_retention_hours' => (int) env('DEVFORGE_AGENTS_ERROR_RETENTION_HOURS', 24),

    /*
    |--------------------------------------------------------------------------
    | Ollama URL for agents running inside Docker
    |--------------------------------------------------------------------------
    |
    | When a provider uses localhost:11434, DevForge rewrites it to this URL
    | so the API container can reach Ollama on the host.
    |
    */
    'ollama_url' => env('DEVFORGE_OLLAMA_URL', ''),

    /*
    | IP hôte pour joindre Ollama depuis le conteneur Docker (fallback auto).
    */
    'ollama_host_ip' => env('DEVFORGE_OLLAMA_HOST_IP', ''),

    /*
    |--------------------------------------------------------------------------
    | Livewire to DevForge migration matrix
    |--------------------------------------------------------------------------
    |
    | Every domain can be migrated independently. The legacy and DevForge
    | paths are intentionally explicit so changes on either side are reviewed
    | as contract changes rather than inferred from route names.
    |
    */
    'domains' => [
        'authentication' => [
            'enabled' => env('DEVFORGE_AUTHENTICATION_ENABLED', $devforgeEnabled),
            'routes' => [
                'auth.force-password-reset' => ['legacy' => '/force-password-reset', 'devforge' => '/force-password-reset'],
                'verify.email' => ['legacy' => '/verify', 'devforge' => '/verify'],
            ],
        ],
        'dashboard' => [
            'enabled' => env('DEVFORGE_DASHBOARD_ENABLED', $devforgeEnabled),
            'routes' => [
                'dashboard' => ['legacy' => '/', 'devforge' => '/'],
                'admin.index' => ['legacy' => '/admin', 'devforge' => '/admin'],
                'onboarding' => ['legacy' => '/onboarding', 'devforge' => '/onboarding'],
            ],
        ],
        'subscription' => [
            'enabled' => env('DEVFORGE_SUBSCRIPTION_ENABLED', $devforgeEnabled),
            'routes' => [
                'subscription.show' => ['legacy' => '/subscription', 'devforge' => '/subscription'],
                'subscription.index' => ['legacy' => '/subscription/new', 'devforge' => '/subscription/new'],
            ],
        ],
        'settings' => [
            'enabled' => env('DEVFORGE_SETTINGS_ENABLED', $devforgeEnabled),
            'routes' => [
                'settings.index' => ['legacy' => '/settings', 'devforge' => '/settings'],
                'settings.advanced' => ['legacy' => '/settings/advanced', 'devforge' => '/settings/advanced'],
                'settings.updates' => ['legacy' => '/settings/updates', 'devforge' => '/settings/updates'],
                'settings.backup' => ['legacy' => '/settings/backup', 'devforge' => '/settings/backup'],
                'settings.email' => ['legacy' => '/settings/email', 'devforge' => '/settings/email'],
                'settings.oauth' => ['legacy' => '/settings/oauth', 'devforge' => '/settings/oauth'],
                'settings.sso' => ['legacy' => '/settings/sso', 'devforge' => '/settings/sso'],
                'settings.scheduled-jobs' => ['legacy' => '/settings/scheduled-jobs', 'devforge' => '/settings/scheduled-jobs'],
            ],
        ],
        'profile' => [
            'enabled' => env('DEVFORGE_PROFILE_ENABLED', $devforgeEnabled),
            'routes' => [
                'profile' => ['legacy' => '/profile', 'devforge' => '/profile'],
                'profile.appearance' => ['legacy' => '/profile/appearance', 'devforge' => '/profile/appearance'],
            ],
        ],
        'tags' => [
            'enabled' => env('DEVFORGE_TAGS_ENABLED', $devforgeEnabled),
            'routes' => [
                'tags.show' => ['legacy' => '/tags/{tagName?}', 'devforge' => '/tags/{tagName?}'],
            ],
        ],
        'notifications' => [
            'enabled' => env('DEVFORGE_NOTIFICATIONS_ENABLED', $devforgeEnabled),
            'routes' => [
                'notifications.email' => ['legacy' => '/notifications/email', 'devforge' => '/notifications/email'],
                'notifications.telegram' => ['legacy' => '/notifications/telegram', 'devforge' => '/notifications/telegram'],
                'notifications.discord' => ['legacy' => '/notifications/discord', 'devforge' => '/notifications/discord'],
                'notifications.slack' => ['legacy' => '/notifications/slack', 'devforge' => '/notifications/slack'],
                'notifications.pushover' => ['legacy' => '/notifications/pushover', 'devforge' => '/notifications/pushover'],
                'notifications.webhook' => ['legacy' => '/notifications/webhook', 'devforge' => '/notifications/webhook'],
            ],
        ],
        'storage' => [
            'enabled' => env('DEVFORGE_STORAGE_ENABLED', $devforgeEnabled),
            'routes' => [
                'storage.index' => ['legacy' => '/storages', 'devforge' => '/storages'],
                'storage.show' => ['legacy' => '/storages/{storage_uuid}', 'devforge' => '/storages/{storage_uuid}'],
                'storage.resources' => ['legacy' => '/storages/{storage_uuid}/resources', 'devforge' => '/storages/{storage_uuid}/resources'],
            ],
        ],
        'shared-variables' => [
            'enabled' => env('DEVFORGE_SHARED_VARIABLES_ENABLED', $devforgeEnabled),
            'routes' => [
                'shared-variables.index' => ['legacy' => '/shared-variables', 'devforge' => '/shared-variables'],
                'shared-variables.team.index' => ['legacy' => '/shared-variables/team', 'devforge' => '/shared-variables/team'],
                'shared-variables.project.index' => ['legacy' => '/shared-variables/projects', 'devforge' => '/shared-variables/projects'],
                'shared-variables.project.show' => ['legacy' => '/shared-variables/project/{project_uuid}', 'devforge' => '/shared-variables/project/{project_uuid}'],
                'shared-variables.environment.index' => ['legacy' => '/shared-variables/environments', 'devforge' => '/shared-variables/environments'],
                'shared-variables.environment.show' => ['legacy' => '/shared-variables/environments/project/{project_uuid}/environment/{environment_uuid}', 'devforge' => '/shared-variables/environments/project/{project_uuid}/environment/{environment_uuid}'],
                'shared-variables.server.index' => ['legacy' => '/shared-variables/servers', 'devforge' => '/shared-variables/servers'],
                'shared-variables.server.show' => ['legacy' => '/shared-variables/server/{server_uuid}', 'devforge' => '/shared-variables/server/{server_uuid}'],
            ],
        ],
        'team' => [
            'enabled' => env('DEVFORGE_TEAM_ENABLED', $devforgeEnabled),
            'routes' => [
                'team.index' => ['legacy' => '/team', 'devforge' => '/team'],
                'team.member.index' => ['legacy' => '/team/members', 'devforge' => '/team/members'],
                'team.admin-view' => ['legacy' => '/team/admin', 'devforge' => '/team/admin'],
                'team.invitation.show' => ['legacy' => '/invitations/{uuid}', 'devforge' => '/invitations/{uuid}'],
            ],
        ],
        'terminal' => [
            'enabled' => env('DEVFORGE_TERMINAL_ENABLED', $devforgeEnabled),
            'routes' => [
                'terminal' => ['legacy' => '/terminal', 'devforge' => '/terminal'],
            ],
        ],
        'projects' => [
            'enabled' => env('DEVFORGE_PROJECTS_ENABLED', $devforgeEnabled),
            'routes' => [
                'project.index' => ['legacy' => '/projects', 'devforge' => '/projects'],
                'project.show' => ['legacy' => '/project/{project_uuid}', 'devforge' => '/project/{project_uuid}'],
                'project.edit' => ['legacy' => '/project/{project_uuid}/edit', 'devforge' => '/project/{project_uuid}/edit'],
                'project.resource.index' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}'],
                'project.clone-me' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/clone', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/clone'],
                'project.resource.create' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/new', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/new'],
                'project.environment.edit' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/edit', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/edit'],
            ],
        ],
        'applications' => [
            'enabled' => env('DEVFORGE_APPLICATIONS_ENABLED', $devforgeEnabled),
            'routes' => [
                'project.application.configuration' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}'],
                'project.application.swarm' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/swarm', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/swarm'],
                'project.application.advanced' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/advanced', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/advanced'],
                'project.application.environment-variables' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/environment-variables', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/environment-variables'],
                'project.application.persistent-storage' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/persistent-storage', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/persistent-storage'],
                'project.application.source' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/source', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/source'],
                'project.application.servers' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/servers', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/servers'],
                'project.application.scheduled-tasks.show' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/scheduled-tasks', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/scheduled-tasks'],
                'project.application.webhooks' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/webhooks', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/webhooks'],
                'project.application.preview-deployments' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/preview-deployments', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/preview-deployments'],
                'project.application.healthcheck' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/healthcheck', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/healthcheck'],
                'project.application.rollback' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/rollback', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/rollback'],
                'project.application.resource-limits' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/resource-limits', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/resource-limits'],
                'project.application.resource-operations' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/resource-operations', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/resource-operations'],
                'project.application.metrics' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/metrics', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/metrics'],
                'project.application.tags' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/tags', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/tags'],
                'project.application.danger' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/danger', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/danger'],
                'project.application.deployment.index' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/deployment', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/deployment'],
                'project.application.deployment.show' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/deployment/{deployment_uuid}', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/deployment/{deployment_uuid}'],
                'project.application.logs' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/logs', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/logs'],
                'project.application.command' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/terminal', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/terminal'],
                'project.application.scheduled-tasks' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/tasks/{task_uuid}', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/application/{application_uuid}/tasks/{task_uuid}'],
            ],
        ],
        'databases' => [
            'enabled' => env('DEVFORGE_DATABASES_ENABLED', $devforgeEnabled),
            'routes' => [
                'project.database.configuration' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/database/{database_uuid}', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/database/{database_uuid}'],
                'project.database.environment-variables' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/database/{database_uuid}/environment-variables', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/database/{database_uuid}/environment-variables'],
                'project.database.servers' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/database/{database_uuid}/servers', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/database/{database_uuid}/servers'],
                'project.database.import-backup' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/database/{database_uuid}/import-backup', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/database/{database_uuid}/import-backup'],
                'project.database.persistent-storage' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/database/{database_uuid}/persistent-storage', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/database/{database_uuid}/persistent-storage'],
                'project.database.healthcheck' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/database/{database_uuid}/healthcheck', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/database/{database_uuid}/healthcheck'],
                'project.database.webhooks' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/database/{database_uuid}/webhooks', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/database/{database_uuid}/webhooks'],
                'project.database.resource-limits' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/database/{database_uuid}/resource-limits', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/database/{database_uuid}/resource-limits'],
                'project.database.resource-operations' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/database/{database_uuid}/resource-operations', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/database/{database_uuid}/resource-operations'],
                'project.database.metrics' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/database/{database_uuid}/metrics', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/database/{database_uuid}/metrics'],
                'project.database.tags' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/database/{database_uuid}/tags', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/database/{database_uuid}/tags'],
                'project.database.danger' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/database/{database_uuid}/danger', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/database/{database_uuid}/danger'],
                'project.database.logs' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/database/{database_uuid}/logs', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/database/{database_uuid}/logs'],
                'project.database.command' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/database/{database_uuid}/terminal', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/database/{database_uuid}/terminal'],
                'project.database.backup.index' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/database/{database_uuid}/backups', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/database/{database_uuid}/backups'],
                'project.database.backup.execution' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/database/{database_uuid}/backups/{backup_uuid}', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/database/{database_uuid}/backups/{backup_uuid}'],
            ],
        ],
        'services' => [
            'enabled' => env('DEVFORGE_SERVICES_ENABLED', $devforgeEnabled),
            'routes' => [
                'project.service.configuration' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/service/{service_uuid}', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/service/{service_uuid}'],
                'project.service.logs' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/service/{service_uuid}/logs', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/service/{service_uuid}/logs'],
                'project.service.environment-variables' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/service/{service_uuid}/environment-variables', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/service/{service_uuid}/environment-variables'],
                'project.service.storages' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/service/{service_uuid}/storages', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/service/{service_uuid}/storages'],
                'project.service.scheduled-tasks.show' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/service/{service_uuid}/scheduled-tasks', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/service/{service_uuid}/scheduled-tasks'],
                'project.service.webhooks' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/service/{service_uuid}/webhooks', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/service/{service_uuid}/webhooks'],
                'project.service.resource-operations' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/service/{service_uuid}/resource-operations', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/service/{service_uuid}/resource-operations'],
                'project.service.tags' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/service/{service_uuid}/tags', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/service/{service_uuid}/tags'],
                'project.service.danger' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/service/{service_uuid}/danger', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/service/{service_uuid}/danger'],
                'project.service.command' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/service/{service_uuid}/terminal', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/service/{service_uuid}/terminal'],
                'project.service.database.backups' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/service/{service_uuid}/{stack_service_uuid}/backups', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/service/{service_uuid}/{stack_service_uuid}/backups'],
                'project.service.database.import' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/service/{service_uuid}/{stack_service_uuid}/import', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/service/{service_uuid}/{stack_service_uuid}/import'],
                'project.service.index.advanced' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/service/{service_uuid}/{stack_service_uuid}/advanced', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/service/{service_uuid}/{stack_service_uuid}/advanced'],
                'project.service.index' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/service/{service_uuid}/{stack_service_uuid}', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/service/{service_uuid}/{stack_service_uuid}'],
                'project.service.scheduled-tasks' => ['legacy' => '/project/{project_uuid}/environment/{environment_uuid}/service/{service_uuid}/tasks/{task_uuid}', 'devforge' => '/project/{project_uuid}/environment/{environment_uuid}/service/{service_uuid}/tasks/{task_uuid}'],
            ],
        ],
        'servers' => [
            'enabled' => env('DEVFORGE_SERVERS_ENABLED', $devforgeEnabled),
            'routes' => [
                'server.index' => ['legacy' => '/servers', 'devforge' => '/servers'],
                'server.show' => ['legacy' => '/server/{server_uuid}', 'devforge' => '/server/{server_uuid}'],
                'server.advanced' => ['legacy' => '/server/{server_uuid}/advanced', 'devforge' => '/server/{server_uuid}/advanced'],
                'server.swarm' => ['legacy' => '/server/{server_uuid}/swarm', 'devforge' => '/server/{server_uuid}/swarm'],
                'server.sentinel' => ['legacy' => '/server/{server_uuid}/sentinel', 'devforge' => '/server/{server_uuid}/sentinel'],
                'server.sentinel.logs' => ['legacy' => '/server/{server_uuid}/sentinel/logs', 'devforge' => '/server/{server_uuid}/sentinel/logs'],
                'server.private-key' => ['legacy' => '/server/{server_uuid}/private-key', 'devforge' => '/server/{server_uuid}/private-key'],
                'server.cloud-provider-token' => ['legacy' => '/server/{server_uuid}/cloud-provider-token', 'devforge' => '/server/{server_uuid}/cloud-provider-token'],
                'server.ca-certificate' => ['legacy' => '/server/{server_uuid}/ca-certificate', 'devforge' => '/server/{server_uuid}/ca-certificate'],
                'server.resources' => ['legacy' => '/server/{server_uuid}/resources', 'devforge' => '/server/{server_uuid}/resources'],
                'server.cloudflare-tunnel' => ['legacy' => '/server/{server_uuid}/cloudflare-tunnel', 'devforge' => '/server/{server_uuid}/cloudflare-tunnel'],
                'server.destinations' => ['legacy' => '/server/{server_uuid}/destinations', 'devforge' => '/server/{server_uuid}/destinations'],
                'server.log-drains' => ['legacy' => '/server/{server_uuid}/log-drains', 'devforge' => '/server/{server_uuid}/log-drains'],
                'server.metrics' => ['legacy' => '/server/{server_uuid}/metrics', 'devforge' => '/server/{server_uuid}/metrics'],
                'server.delete' => ['legacy' => '/server/{server_uuid}/danger', 'devforge' => '/server/{server_uuid}/danger'],
                'server.proxy' => ['legacy' => '/server/{server_uuid}/proxy', 'devforge' => '/server/{server_uuid}/proxy'],
                'server.proxy.dynamic-confs' => ['legacy' => '/server/{server_uuid}/proxy/dynamic', 'devforge' => '/server/{server_uuid}/proxy/dynamic'],
                'server.proxy.logs' => ['legacy' => '/server/{server_uuid}/proxy/logs', 'devforge' => '/server/{server_uuid}/proxy/logs'],
                'server.command' => ['legacy' => '/server/{server_uuid}/terminal', 'devforge' => '/server/{server_uuid}/terminal'],
                'server.docker-cleanup' => ['legacy' => '/server/{server_uuid}/docker-cleanup', 'devforge' => '/server/{server_uuid}/docker-cleanup'],
                'server.security.patches' => ['legacy' => '/server/{server_uuid}/security/patches', 'devforge' => '/server/{server_uuid}/security/patches'],
                'server.security.terminal-access' => ['legacy' => '/server/{server_uuid}/security/terminal-access', 'devforge' => '/server/{server_uuid}/security/terminal-access'],
            ],
        ],
        'destinations' => [
            'enabled' => env('DEVFORGE_DESTINATIONS_ENABLED', $devforgeEnabled),
            'routes' => [
                'destination.index' => ['legacy' => '/destinations', 'devforge' => '/destinations'],
                'destination.show' => ['legacy' => '/destination/{destination_uuid}', 'devforge' => '/destination/{destination_uuid}'],
                'destination.resources' => ['legacy' => '/destination/{destination_uuid}/resources', 'devforge' => '/destination/{destination_uuid}/resources'],
            ],
        ],
        'security' => [
            'enabled' => env('DEVFORGE_SECURITY_ENABLED', $devforgeEnabled),
            'routes' => [
                'security.private-key.index' => ['legacy' => '/security/private-key', 'devforge' => '/security/private-key'],
                'security.private-key.show' => ['legacy' => '/security/private-key/{private_key_uuid}', 'devforge' => '/security/private-key/{private_key_uuid}'],
                'security.cloud-tokens' => ['legacy' => '/security/cloud-tokens', 'devforge' => '/security/cloud-tokens'],
                'security.cloud-init-scripts' => ['legacy' => '/security/cloud-init-scripts', 'devforge' => '/security/cloud-init-scripts'],
                'security.api-tokens' => ['legacy' => '/security/api-tokens', 'devforge' => '/security/api-tokens'],
            ],
        ],
        'sources' => [
            'enabled' => env('DEVFORGE_SOURCES_ENABLED', $devforgeEnabled),
            'routes' => [
                'source.all' => ['legacy' => '/sources', 'devforge' => '/sources'],
                'source.github.show' => ['legacy' => '/source/github/{github_app_uuid}', 'devforge' => '/source/github/{github_app_uuid}'],
                'source.github.permissions' => ['legacy' => '/source/github/{github_app_uuid}/permissions', 'devforge' => '/source/github/{github_app_uuid}/permissions'],
                'source.github.resources' => ['legacy' => '/source/github/{github_app_uuid}/resources', 'devforge' => '/source/github/{github_app_uuid}/resources'],
            ],
        ],
    ],
];
