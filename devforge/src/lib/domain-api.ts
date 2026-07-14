import { apiFetch, apiUploadWithProgress, ApiError, ensureCsrfCookie, type UploadProgressHandler } from './api-client';

const API_BASE = '/api/devforge/v1';

export type ApiResponse<T> = { data: T };
export type ApiListResponse<T> = ApiResponse<T[]> & { meta?: Record<string, number | string> };

export type Overview = {
    counts: {
        projects: number;
        environments: number;
        shared_variables: number;
        private_keys: number;
        members: number;
    };
    recent_projects: Project[];
    health: {
        score: number;
        total_resources: number;
        running: number;
        degraded: number;
        stopped: number;
    };
    resource_statuses: ResourceStatuses;
    recent_deployments: Deployment[];
    agent_activity: Array<{
        uuid: string;
        status: AgentRunStatus;
        trigger: AgentTrigger;
        summary: string | null;
        created_at: string | null;
        agent: { uuid: string; name: string; type: AgentType; avatar_color: string } | null;
    }>;
    agents_summary: { total: number; active: number; running: number } | null;
};

export type Environment = {
    id: number;
    uuid: string;
    project_id: number;
    name: string;
    description: string | null;
    created_at: string;
    updated_at: string;
};

export type Project = {
    id: number;
    uuid: string;
    name: string;
    description: string | null;
    created_at: string;
    updated_at: string;
    environments?: Environment[];
};

export type ProjectInput = {
    name: string;
    description: string;
};

export type CoreResourceType = 'servers' | 'applications' | 'databases' | 'services';
export type CoreAction = 'start' | 'stop' | 'restart' | 'deploy';

export type CoreActionResult = {
    resource_uuid: string;
    resource_type: string;
    action: CoreAction;
    queued?: boolean;
    completed?: boolean;
    deployment_uuid?: string;
    message?: string;
};

export type CoreResource = {
    uuid: string;
    type: 'server' | 'application' | 'database' | 'service';
    name: string;
    description: string | null;
    status: string | {
        reachable: boolean;
        usable: boolean;
        validating: boolean;
    };
    engine?: string;
    engine_label?: string;
    connected_applications?: Array<{
        application_uuid: string;
        application_name: string;
        env_key?: string;
        is_runtime?: boolean;
        is_buildtime?: boolean;
        updated_at?: string | null;
    }>;
    configuration: Record<string, unknown>;
    actions: CoreAction[];
    created_at: string | null;
    updated_at: string | null;
};

export type Deployment = {
    uuid: string;
    status: string;
    pull_request_id: number;
    commit: string | null;
    commit_message: string | null;
    force_rebuild: boolean;
    rollback: boolean;
    created_at: string | null;
    updated_at: string | null;
    finished_at: string | null;
    application: { uuid: string; name: string };
};

export type DeploymentLog = {
    cursor: number;
    timestamp: string | null;
    stream: 'stdout' | 'stderr';
    message: string;
    command: boolean;
};

export type DeploymentLogs = {
    items: DeploymentLog[];
    next_cursor: number;
    complete: boolean;
};

export type DeploymentSubagentRun = {
    uuid: string;
    status: string;
    reason: string | null;
    output: string | null;
    error: string | null;
    started_at: string | null;
    finished_at: string | null;
    child_agent: {
        uuid: string;
        name: string;
        type: AgentType;
        avatar_color: string;
    } | null;
    child_run: {
        uuid: string;
        status: AgentRunStatus;
        summary: string | null;
    } | null;
};

export type DeploymentAgentRun = {
    uuid: string;
    status: AgentRunStatus;
    trigger: AgentTrigger;
    summary: string | null;
    actions_taken: Array<{
        tool: string;
        uuid: string;
        type: string;
        action: string;
        reason: string;
        at: string;
        deployment_uuid?: string;
        queued?: boolean;
    }>;
    iterations: number;
    tokens_used: number;
    duration_seconds: number | null;
    started_at: string | null;
    finished_at: string | null;
    created_at: string;
    event_context: Record<string, unknown> | null;
    metadata?: Record<string, unknown>;
    subagent_runs?: DeploymentSubagentRun[];
    logs?: string | null;
    agent: {
        uuid: string;
        name: string;
        type: AgentType;
        avatar_color: string;
    } | null;
};

export type DeploymentMonitoringDiagnostics = {
    eligible_agents_count: number;
    active_agents_count: number;
    agents_with_provider_count: number;
    agents_busy_count: number;
    team_has_llm_provider: boolean;
    blockers: Array<{ code: string; message: string }>;
};

export type DeploymentMonitoring = {
    deployment: Deployment;
    agent_runs: DeploymentAgentRun[];
    redeployments: Deployment[];
    agents: {
        enabled: boolean;
        auto_fix_deployments: boolean;
        monitor_build: boolean;
        webhook_build: boolean;
    };
    diagnostics: DeploymentMonitoringDiagnostics;
    catch_up_triggered?: boolean;
};

export type ResourceStatus = {
    uuid: string;
    name: string;
    type: string;
    status: string;
    reachable?: boolean;
    usable?: boolean;
    updated_at: string | null;
};

export type ResourceStatuses = Record<CoreResourceType, ResourceStatus[]>;

export type Profile = {
    id: number;
    name: string;
    email: string;
    email_verified: boolean;
    two_factor_enabled: boolean;
};

export type Team = {
    id: number;
    name: string;
    description: string | null;
    personal_team: boolean;
    role: string;
};

export type TeamMember = {
    id: number;
    name: string;
    email: string;
    role: string;
};

export type TeamInvitation = {
    id: number;
    email: string;
    role: string;
    via: 'email' | 'link';
    link: string | null;
    created_at: string | null;
};

export type InstanceSettings = {
    instance: {
        instance_name: string;
        fqdn: string | null;
        instance_timezone: string;
        public_ipv4: string | null;
        public_ipv6: string | null;
        public_port_min: number | null;
        public_port_max: number | null;
        helper_version: string | null;
        dev_helper_version: string | null;
        next_channel: string | null;
    };
    advanced: {
        is_registration_enabled: boolean;
        do_not_track: boolean;
        is_dns_validation_enabled: boolean;
        custom_dns_servers: string | null;
        is_api_enabled: boolean;
        allowed_ips: string | null;
        is_sponsorship_popup_enabled: boolean;
        disable_two_step_confirmation: boolean;
        is_wire_navigate_enabled: boolean;
        is_mcp_server_enabled: boolean;
    };
    email: {
        smtp_enabled: boolean;
        smtp_from_address: string | null;
        smtp_from_name: string | null;
        smtp_recipients: string | null;
        smtp_host: string | null;
        smtp_port: number | null;
        smtp_encryption: string | null;
        smtp_username: string | null;
        smtp_password: boolean;
        smtp_timeout: number | null;
        resend_enabled: boolean;
        resend_api_key: boolean;
    };
    updates: {
        is_auto_update_enabled: boolean;
        auto_update_frequency: string | null;
        update_check_frequency: string | null;
        new_version_available: boolean;
    };
};

export type OauthProviderSettings = {
    id: number;
    provider: string;
    enabled: boolean;
    client_id: string | null;
    client_secret: string | null;
    redirect_uri: string | null;
    tenant: string | null;
    base_url: string | null;
};

export type TerminalConfig = {
    enabled: boolean;
    websocket_url: string;
    connection: {
        protocol: string;
        host: string;
        port: number | null;
        path: string;
    };
    auth: {
        method: string;
        endpoint: string;
        allowed_ips_endpoint: string;
        credentials: string;
    };
    permissions: {
        access: boolean;
        connect_server: boolean;
        connect_container: boolean;
        execute_commands: boolean;
    };
    targets: Array<{ uuid: string; name: string; type: string }>;
};

export type NotificationChannel = {
    channel: string;
    enabled: boolean;
    events: Record<string, boolean>;
};

export type SharedVariable = {
    id: number;
    key: string;
    scope: string;
    project_id: number | null;
    environment_id: number | null;
    server_id: number | null;
    project_uuid?: string | null;
    environment_uuid?: string | null;
    server_uuid?: string | null;
    project_name?: string | null;
    environment_name?: string | null;
    server_name?: string | null;
    comment: string | null;
    is_multiline: boolean;
    is_literal: boolean;
    is_shown_once: boolean;
    value: '********' | null;
    value_locked?: boolean;
};

export type SharedVariableInput = {
    key: string;
    value?: string | null;
    scope: 'team' | 'project' | 'environment' | 'server';
    comment?: string | null;
    is_multiline?: boolean;
    is_literal?: boolean;
    is_shown_once?: boolean;
    project_uuid?: string | null;
    environment_uuid?: string | null;
    server_uuid?: string | null;
};

export type SharedVariableUpdateInput = {
    key?: string;
    value?: string | null;
    comment?: string | null;
    is_multiline?: boolean;
    is_literal?: boolean;
};

export type SharedVariables = Record<'team' | 'project' | 'environment' | 'server', SharedVariable[]>;

export type AgentType = 'debug' | 'tech-watch' | 'github' | 'devforge' | 'deployment' | 'security';
export type AgentStatus = 'idle' | 'running' | 'error' | 'paused';
export type AgentRunStatus = 'pending' | 'running' | 'completed' | 'failed';
export type AgentTrigger = 'scheduled' | 'manual' | 'event' | 'chat' | 'ephemeral' | 'delegation';

export type AgentChatMessage = {
    uuid: string;
    role: 'user' | 'assistant';
    content: string;
    metadata: Record<string, unknown> | null;
    run_uuid: string | null;
    session_uuid?: string | null;
    created_at: string;
};

export type AgentChatSession = {
    uuid: string;
    title: string;
    is_legacy: boolean;
    last_message_at: string | null;
    created_at: string;
};
export type LlmProvider = 'gemini' | 'ollama';

export type LlmModelOption = {
    id: string;
    label: string;
    description?: string | null;
};

export type AiProviderConfig = {
    id: number;
    provider: LlmProvider;
    name: string;
    model: string;
    model_label?: string;
    base_url: string | null;
    has_api_key: boolean;
    is_default: boolean;
    created_at: string;
};

export type AgentModelRouting = {
    tier: 'light' | 'standard' | 'heavy';
    tier_label: string;
    model_label: string;
    reason: string;
    display: string;
};

export type AgentEphemeralTask = {
    run_uuid: string;
    goal: string;
    tier: string;
    tier_label: string;
    model_label: string;
    display: string;
    status: string;
    summary: string | null;
};

export type AgentRunMetadata = {
    model_routing?: AgentModelRouting;
    ephemeral?: boolean;
    parent_run_uuid?: string | null;
    ephemeral_tasks?: AgentEphemeralTask[];
};

export type AgentRun = {
    uuid: string;
    status: AgentRunStatus;
    trigger: AgentTrigger;
    summary: string | null;
    actions_taken: Array<{ tool: string; uuid: string; type: string; action: string; reason: string; at: string }>;
    tokens_used: number;
    iterations: number;
    duration_seconds: number | null;
    metadata?: AgentRunMetadata;
    started_at: string | null;
    finished_at: string | null;
    created_at: string;
    logs?: string | null;
};

export type AgentTriggerMode = 'manual' | 'schedule' | 'webhook';

export type Agent = {
    uuid: string;
    type: AgentType;
    name: string;
    description: string | null;
    avatar_color: string;
    system_prompt: string | null;
    schedule_minutes: number;
    trigger_mode: AgentTriggerMode;
    is_active: boolean;
    status: AgentStatus;
    last_run_at: string | null;
    provider: { id: number; name: string; provider: LlmProvider; model: string; model_label?: string } | null;
    fallback_provider: { id: number; name: string; provider: LlmProvider; model: string; model_label?: string } | null;
    parent_agent_id: number | null;
    resource_uuid: string | null;
    sub_agents_count: number;
    latest_run: (Omit<AgentRun, 'logs' | 'actions_taken' | 'duration_seconds'> & { metadata?: AgentRunMetadata }) | null;
    default_directives?: string;
    autonomous_playbook?: string[];
    created_at: string;
};

export type AgentInput = {
    type: AgentType;
    name: string;
    description?: string;
    avatar_color?: string;
    system_prompt?: string;
    provider_config_id?: number | null;
    fallback_provider_config_id?: number | null;
    parent_agent_id?: number | null;
    resource_uuid?: string | null;
    schedule_minutes?: number;
    is_active?: boolean;
};

export type SecurityKey = {
    id: number;
    uuid: string;
    name: string;
    description: string | null;
    fingerprint: string | null;
    is_git_related: boolean;
    private_key: '********';
    created_at: string;
};

export type GithubAppSummary = {
    uuid: string;
    name: string;
    organization: string | null;
    html_url: string | null;
    is_system_wide: boolean;
};

export type GithubRepository = {
    id: number;
    name: string;
    full_name: string;
    owner: string;
    private: boolean;
    html_url: string;
    default_branch: string;
    description: string | null;
};

export type GithubBranch = {
    name: string;
    protected: boolean;
};

export type DeploymentDestination = {
    uuid: string;
    name: string;
    type: 'standalone' | 'swarm';
};

export type DeploymentTarget = {
    uuid: string;
    name: string;
    reachable: boolean;
    usable: boolean;
    destinations: DeploymentDestination[];
};

export type DestinationSummary = {
    uuid: string;
    name: string;
    type: 'standalone' | 'swarm';
    network: string;
    server: {
        uuid: string;
        name: string;
    };
    resource_count: number;
};

export type DestinationDetail = DestinationSummary & {
    server: {
        uuid: string;
        name: string;
        ip: string | null;
    };
    has_attached_resources: boolean;
    supports_resources_page: boolean;
};

export type DestinationInput = {
    server_uuid: string;
    network: string;
    name?: string | null;
    type?: 'standalone' | 'swarm';
};

export type DestinationUpdateInput = {
    name?: string;
    network?: string;
};

export type DestinationResource = {
    uuid: string;
    type: 'application' | 'service' | 'database';
    name: string;
    project: string | null;
    environment: string | null;
};

export type TagSummary = {
    name: string;
    applications_count: number;
    services_count: number;
};

export type TagDetail = {
    name: string;
    webhook_url: string;
    applications_count: number;
    services_count: number;
    applications: Array<{
        uuid: string;
        name: string;
        fqdn: string | null;
        status: string | null;
    }>;
    services: Array<{
        uuid: string;
        name: string;
        status: string | null;
    }>;
};

export type TagRedeployResult = {
    tag: string;
    applications_queued: number;
    services_queued: number;
    results: Array<{
        resource_type: 'application' | 'service';
        uuid: string;
        name: string;
        queued?: boolean;
        message?: string;
        error?: string;
    }>;
};

export type CreateApplicationInput = {
    project_uuid: string;
    environment_uuid: string;
    destination_uuid: string;
    github_app_uuid: string;
    git_repository: string;
    repository_id?: number;
    git_branch: string;
    build_pack: 'nixpacks' | 'railpack' | 'static' | 'dockerfile' | 'dockercompose';
    ports_exposes?: number;
    name?: string;
    instant_deploy?: boolean;
};

export type DatabaseEngine = 'postgresql' | 'redis' | 'mongodb' | 'mysql' | 'mariadb' | 'keydb' | 'dragonfly' | 'clickhouse' | 'libsql';

export type CreateDatabaseInput = {
    engine: DatabaseEngine;
    project_uuid: string;
    environment_uuid: string;
    destination_uuid: string;
    name?: string;
    image?: string;
    instant_deploy?: boolean;
    application_uuid?: string;
    env_key?: string;
    application_instant_deploy?: boolean;
    migrate_from_remote?: boolean;
};

export type S3Storage = {
    uuid: string;
    name: string;
    description: string | null;
    region: string;
    bucket: string;
    endpoint: string;
    is_usable: boolean;
    scheduled_backups_count: number;
    created_at: string | null;
    updated_at: string | null;
};

export type S3StorageInput = {
    name: string;
    description?: string;
    region: string;
    key: string;
    secret: string;
    bucket: string;
    endpoint: string;
};

export type DatabaseBackupRetention = {
    amount: number;
    days: number;
    max_storage_gb: number;
};

export type DatabaseBackupExecution = {
    uuid: string;
    status: string;
    message: string | null;
    size: number;
    filename: string | null;
    database_name: string | null;
    s3_uploaded: boolean | null;
    created_at: string | null;
    finished_at: string | null;
};

export type DatabaseBackup = {
    uuid: string;
    enabled: boolean;
    frequency: string;
    save_s3: boolean;
    disable_local_backup: boolean;
    dump_all: boolean;
    databases_to_backup: string | null;
    timeout: number;
    s3_storage: { uuid: string; name: string } | null;
    retention: {
        local: DatabaseBackupRetention;
        s3: DatabaseBackupRetention;
    };
    latest_execution: DatabaseBackupExecution | null;
    created_at: string | null;
    updated_at: string | null;
};

export type DatabaseBackupInput = {
    frequency: string;
    enabled?: boolean;
    save_s3?: boolean;
    disable_local_backup?: boolean;
    dump_all?: boolean;
    backup_now?: boolean;
    s3_storage_uuid?: string | null;
    databases_to_backup?: string | null;
    database_backup_retention_amount_locally?: number;
    database_backup_retention_days_locally?: number;
    database_backup_retention_max_storage_locally?: number;
    database_backup_retention_amount_s3?: number;
    database_backup_retention_days_s3?: number;
    database_backup_retention_max_storage_s3?: number;
    timeout?: number;
};

export type LinkableDatabase = {
    uuid: string;
    name: string;
    engine: DatabaseEngine;
    status: string;
    default_env_key: string;
    connected_applications: Array<{
        application_uuid: string;
        application_name: string;
    }>;
    is_linkable: boolean;
};

export type ApplicationDatabaseConnection = {
    database_uuid: string;
    env_keys: string[];
    is_runtime: boolean;
    is_buildtime: boolean;
    updated_at: string | null;
};

export type DatabaseApplicationConnection = {
    application_uuid: string;
    application_name: string;
    env_key: string;
    is_runtime: boolean;
    is_buildtime: boolean;
    updated_at: string | null;
};

export type TursoMigrationCandidate = {
    available: boolean;
    source_url: string | null;
    env_keys: string[];
};

export type ConnectDatabaseInput = {
    database_uuid: string;
    env_key?: string;
    is_runtime?: boolean;
    is_buildtime?: boolean;
    instant_deploy?: boolean;
    migrate_from_remote?: boolean;
};

export type ApplicationEnvironmentVariable = {
    uuid: string;
    key: string;
    value: string | null;
    has_value: boolean;
    is_revealable: boolean;
    comment: string | null;
    is_preview: boolean;
    is_runtime: boolean;
    is_buildtime: boolean;
    is_multiline: boolean;
    is_literal: boolean;
    is_shown_once: boolean;
    is_shared: boolean;
    is_coolify: boolean;
    is_buildpack_control: boolean;
    is_editable: boolean;
    updated_at: string | null;
};

export type ApplicationEnvironmentVariables = {
    production: ApplicationEnvironmentVariable[];
    preview: ApplicationEnvironmentVariable[];
};

export type ApplicationEnvironmentVariableInput = {
    key: string;
    value?: string | null;
    comment?: string | null;
    is_preview?: boolean;
    is_runtime?: boolean;
    is_buildtime?: boolean;
    is_multiline?: boolean;
    is_literal?: boolean;
    is_shown_once?: boolean;
};

export type ApplicationEnvironmentVariableUpdateInput = Partial<
    Omit<ApplicationEnvironmentVariableInput, 'key' | 'is_preview'>
>;

export type ConnectDatabaseResult = {
    application_uuid: string;
    database_uuid: string;
    database_name: string;
    engine: DatabaseEngine;
    env_key: string;
    env_keys?: string[];
    env_uuid: string;
    is_runtime: boolean;
    is_buildtime: boolean;
    created: boolean;
    deployment: {
        queued: boolean;
        deployment_uuid: string;
        message: string;
    } | null;
    migration?: {
        performed: boolean;
        message: string;
    } | null;
};

export type LibsqlCredentials = {
    auth_user: string;
    auth_token: string;
    internal_url: string;
    external_url: string | null;
    turso_database_url: string;
    turso_database_url_external: string | null;
    turso_auth_token: string;
    libsql_url: string;
    is_public: boolean;
    public_port: number | null;
    env_profiles: {
        turso: Record<string, string>;
        turso_remote: Record<string, string> | null;
        libsql_url: Record<string, string>;
    };
};

export type LibsqlAccessUpdateInput = {
    enabled: boolean;
    public_port?: number;
    redeploy_applications?: boolean;
};

export type LibsqlAccessUpdateResult = LibsqlCredentials & {
    synced_applications: Array<{ uuid: string; name: string }>;
    redeployments_queued: number;
};

export type DatabaseImportSqlResult = {
    restarted: boolean;
    message: string;
    format?: 'sql' | 'db';
};

export type DatabaseExplorerTable = {
    name: string;
    row_count: number | null;
};

export type DatabaseExplorerOverview = {
    available: boolean;
    table_count: number;
    tables: DatabaseExplorerTable[];
    message?: string;
};

export type DatabaseTablePreview = {
    table: string;
    columns: string[];
    rows: Array<Record<string, unknown>>;
    row_count: number;
    truncated: boolean;
};

export type ApplicationLogLine = {
    cursor: number;
    message: string;
};

export type ApplicationLogs = {
    available: boolean;
    reason: 'server_unavailable' | 'not_running' | 'container_not_running' | null;
    message: string | null;
    container: string | null;
    container_status: string | null;
    line_count: number;
    items: ApplicationLogLine[];
};

export type RealtimeMetadata = {
    transport: {
        driver: string;
        key: string;
        host: string;
        port: number | string;
        scheme: string;
        auth_endpoint: string;
    };
    polling: {
        deployment_logs: boolean;
        resource_status: boolean;
        recommended_interval_ms: number;
    };
};

async function mutate<T>(path: string, init: RequestInit): Promise<T> {
    await ensureCsrfCookie();
    return apiFetch<T>(`${API_BASE}${path}`, init);
}

export const domainApi = {
    overview: () => apiFetch<ApiResponse<Overview>>(`${API_BASE}/overview`),
    projects: () => apiFetch<ApiResponse<Project[]>>(`${API_BASE}/projects`),
    project: (uuid: string) => apiFetch<ApiResponse<Project>>(`${API_BASE}/projects/${encodeURIComponent(uuid)}`),
    createProject: (input: ProjectInput) => mutate<ApiResponse<Project>>('/projects', {
        method: 'POST',
        body: JSON.stringify(input),
    }),
    updateProject: (uuid: string, input: ProjectInput) => mutate<ApiResponse<Project>>(`/projects/${encodeURIComponent(uuid)}`, {
        method: 'PUT',
        body: JSON.stringify(input),
    }),
    deleteProject: (uuid: string) => mutate<void>(`/projects/${encodeURIComponent(uuid)}`, { method: 'DELETE' }),
    environments: (projectUuid: string) => apiFetch<ApiResponse<Environment[]>>(`${API_BASE}/projects/${encodeURIComponent(projectUuid)}/environments`),
    createEnvironment: (projectUuid: string, input: ProjectInput) => mutate<ApiResponse<Environment>>(`/projects/${encodeURIComponent(projectUuid)}/environments`, {
        method: 'POST',
        body: JSON.stringify(input),
    }),
    updateEnvironment: (projectUuid: string, uuid: string, input: ProjectInput) => mutate<ApiResponse<Environment>>(`/projects/${encodeURIComponent(projectUuid)}/environments/${encodeURIComponent(uuid)}`, {
        method: 'PUT',
        body: JSON.stringify(input),
    }),
    deleteEnvironment: (projectUuid: string, uuid: string) => mutate<void>(`/projects/${encodeURIComponent(projectUuid)}/environments/${encodeURIComponent(uuid)}`, { method: 'DELETE' }),
    coreResources: (type?: CoreResourceType) => apiFetch<ApiListResponse<CoreResource>>(`${API_BASE}/core/${type ?? 'resources'}`),
    coreResource: (type: CoreResourceType, uuid: string) => apiFetch<ApiResponse<CoreResource>>(`${API_BASE}/core/${type}/${encodeURIComponent(uuid)}`),
    coreAction: (type: Exclude<CoreResourceType, 'servers'>, uuid: string, action: CoreAction) => mutate<ApiResponse<CoreActionResult>>(`/core/${type}/${encodeURIComponent(uuid)}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ action }),
    }),
    deployments: (page = 1, applicationUuid?: string, perPage = 25) => {
        const params = new URLSearchParams({
            page: String(page),
            per_page: String(perPage),
        });
        if (applicationUuid) {
            params.set('application_uuid', applicationUuid);
        }

        return apiFetch<ApiListResponse<Deployment>>(`${API_BASE}/deployments?${params.toString()}`);
    },
    deployment: (uuid: string) => apiFetch<ApiResponse<Deployment>>(`${API_BASE}/deployments/${encodeURIComponent(uuid)}`),
    deploymentLogs: (uuid: string, after = 0) => apiFetch<ApiResponse<DeploymentLogs>>(`${API_BASE}/deployments/${encodeURIComponent(uuid)}/logs?after=${after}`),
    deploymentMonitoring: (uuid: string) => apiFetch<ApiResponse<DeploymentMonitoring>>(`${API_BASE}/deployments/${encodeURIComponent(uuid)}/monitoring`),
    statuses: () => apiFetch<ApiResponse<ResourceStatuses>>(`${API_BASE}/resources/status`),
    realtime: () => apiFetch<ApiResponse<RealtimeMetadata>>(`${API_BASE}/realtime`),
    profile: () => apiFetch<ApiResponse<Profile>>(`${API_BASE}/profile`),
    updateProfile: (input: Pick<Profile, 'name' | 'email'>) => mutate<ApiResponse<Profile>>('/profile', {
        method: 'PUT',
        body: JSON.stringify(input),
    }),
    teams: () => apiFetch<ApiResponse<Team[]>>(`${API_BASE}/teams`),
    currentTeam: () => apiFetch<ApiResponse<Team>>(`${API_BASE}/teams/current`),
    updateCurrentTeam: (input: Pick<Team, 'name' | 'description'>) => mutate<ApiResponse<Team>>('/teams/current', {
        method: 'PUT',
        body: JSON.stringify(input),
    }),
    members: () => apiFetch<ApiResponse<TeamMember[]>>(`${API_BASE}/teams/current/members`),
    updateTeamMember: (userId: number, role: string) => mutate<ApiResponse<TeamMember>>(
        `/teams/current/members/${userId}`,
        {
            method: 'PUT',
            body: JSON.stringify({ role }),
        },
    ),
    removeTeamMember: (userId: number) => mutate<void>(`/teams/current/members/${userId}`, {
        method: 'DELETE',
    }),
    teamInvitations: () => apiFetch<ApiResponse<TeamInvitation[]>>(`${API_BASE}/teams/current/invitations`),
    createTeamInvitation: (input: { email: string; role: string; via: 'email' | 'link' }) => mutate<ApiResponse<TeamInvitation>>(
        '/teams/current/invitations',
        {
            method: 'POST',
            body: JSON.stringify(input),
        },
    ),
    revokeTeamInvitation: (invitationId: number) => mutate<void>(
        `/teams/current/invitations/${invitationId}`,
        { method: 'DELETE' },
    ),
    settings: () => apiFetch<ApiResponse<InstanceSettings>>(`${API_BASE}/settings`),
    oauthSettings: () => apiFetch<ApiResponse<OauthProviderSettings[]>>(`${API_BASE}/settings/oauth`),
    terminalConfig: () => apiFetch<ApiResponse<TerminalConfig>>(`${API_BASE}/terminal/config`),
    notifications: () => apiFetch<ApiResponse<NotificationChannel[]>>(`${API_BASE}/notifications`),
    updateNotificationChannel: (channel: string, input: { events: Record<string, boolean>; enabled?: boolean }) => mutate<ApiResponse<NotificationChannel>>(
        `/notifications/${encodeURIComponent(channel)}`,
        {
            method: 'PUT',
            body: JSON.stringify(input),
        },
    ),
    sharedVariables: () => apiFetch<ApiResponse<SharedVariables>>(`${API_BASE}/shared-variables`),
    createSharedVariable: (input: SharedVariableInput) => mutate<ApiResponse<SharedVariable>>('/shared-variables', {
        method: 'POST',
        body: JSON.stringify(input),
    }),
    updateSharedVariable: (id: number, input: SharedVariableUpdateInput) => mutate<ApiResponse<SharedVariable>>(
        `/shared-variables/${id}`,
        {
            method: 'PUT',
            body: JSON.stringify(input),
        },
    ),
    deleteSharedVariable: (id: number) => mutate<void>(`/shared-variables/${id}`, {
        method: 'DELETE',
    }),
    securityKeys: () => apiFetch<ApiResponse<SecurityKey[]>>(`${API_BASE}/security/keys`),

    deploymentTargets: () => apiFetch<ApiResponse<DeploymentTarget[]>>(`${API_BASE}/deployment-targets`),
    destinations: () => apiFetch<ApiResponse<DestinationSummary[]>>(`${API_BASE}/destinations`),
    createDestination: (input: DestinationInput) => mutate<ApiResponse<DestinationDetail>>('/destinations', {
        method: 'POST',
        body: JSON.stringify(input),
    }),
    destination: (destinationUuid: string) => apiFetch<ApiResponse<DestinationDetail>>(`${API_BASE}/destinations/${encodeURIComponent(destinationUuid)}`),
    updateDestination: (destinationUuid: string, input: DestinationUpdateInput) => mutate<ApiResponse<DestinationDetail>>(
        `/destinations/${encodeURIComponent(destinationUuid)}`,
        {
            method: 'PUT',
            body: JSON.stringify(input),
        },
    ),
    deleteDestination: (destinationUuid: string) => mutate<void>(
        `/destinations/${encodeURIComponent(destinationUuid)}`,
        { method: 'DELETE' },
    ),
    destinationResources: (destinationUuid: string) => apiFetch<ApiResponse<DestinationResource[]>>(`${API_BASE}/destinations/${encodeURIComponent(destinationUuid)}/resources`),
    tags: () => apiFetch<ApiResponse<TagSummary[]>>(`${API_BASE}/tags`),
    createTag: (name: string) => mutate<ApiResponse<TagSummary>>('/tags', {
        method: 'POST',
        body: JSON.stringify({ name }),
    }),
    tag: (tagName: string) => apiFetch<ApiResponse<TagDetail>>(`${API_BASE}/tags/${encodeURIComponent(tagName)}`),
    deleteTag: (tagName: string) => mutate<void>(
        `/tags/${encodeURIComponent(tagName)}`,
        { method: 'DELETE' },
    ),
    redeployTag: (tagName: string, force = false) => mutate<ApiResponse<TagRedeployResult>>(
        `/tags/${encodeURIComponent(tagName)}/redeploy`,
        {
            method: 'POST',
            body: JSON.stringify({ force }),
        },
    ),
    githubApps: () => apiFetch<ApiResponse<GithubAppSummary[]>>(`${API_BASE}/github/apps`),
    githubRepositories: (githubAppUuid: string) => apiFetch<ApiResponse<GithubRepository[]>>(`${API_BASE}/github/apps/${encodeURIComponent(githubAppUuid)}/repositories`),
    githubBranches: (githubAppUuid: string, owner: string, repo: string) => apiFetch<ApiResponse<GithubBranch[]>>(`${API_BASE}/github/apps/${encodeURIComponent(githubAppUuid)}/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`),
    createApplication: (input: CreateApplicationInput) => mutate<ApiResponse<CoreResource>>('/applications', {
        method: 'POST',
        body: JSON.stringify(input),
    }),
    linkableDatabases: (applicationUuid: string) => apiFetch<ApiResponse<LinkableDatabase[]> & {
        meta: {
            connections: ApplicationDatabaseConnection[];
            turso_migration: TursoMigrationCandidate | null;
        };
    }>(
        `${API_BASE}/applications/${encodeURIComponent(applicationUuid)}/linkable-databases`,
    ),
    connectDatabase: (applicationUuid: string, input: ConnectDatabaseInput) => mutate<ApiResponse<ConnectDatabaseResult>>(
        `/applications/${encodeURIComponent(applicationUuid)}/connect-database`,
        {
            method: 'POST',
            body: JSON.stringify(input),
        },
    ),
    applicationLogs: (applicationUuid: string, lines = 200) => apiFetch<ApiResponse<ApplicationLogs>>(
        `${API_BASE}/applications/${encodeURIComponent(applicationUuid)}/logs?lines=${lines}`,
    ),
    applicationEnvironmentVariables: (applicationUuid: string) => apiFetch<ApiResponse<ApplicationEnvironmentVariables>>(
        `${API_BASE}/applications/${encodeURIComponent(applicationUuid)}/environment-variables`,
    ),
    createApplicationEnvironmentVariable: (
        applicationUuid: string,
        input: ApplicationEnvironmentVariableInput,
    ) => mutate<ApiResponse<ApplicationEnvironmentVariable>>(
        `/applications/${encodeURIComponent(applicationUuid)}/environment-variables`,
        {
            method: 'POST',
            body: JSON.stringify(input),
        },
    ),
    updateApplicationEnvironmentVariable: (
        applicationUuid: string,
        envUuid: string,
        input: ApplicationEnvironmentVariableUpdateInput,
    ) => mutate<ApiResponse<ApplicationEnvironmentVariable>>(
        `/applications/${encodeURIComponent(applicationUuid)}/environment-variables/${encodeURIComponent(envUuid)}`,
        {
            method: 'PUT',
            body: JSON.stringify(input),
        },
    ),
    deleteApplicationEnvironmentVariable: (applicationUuid: string, envUuid: string) => mutate<{ message: string }>(
        `/applications/${encodeURIComponent(applicationUuid)}/environment-variables/${encodeURIComponent(envUuid)}`,
        { method: 'DELETE' },
    ),
    revealApplicationEnvironmentVariable: (applicationUuid: string, envUuid: string) => apiFetch<ApiResponse<{
        uuid: string;
        value: string | null;
    }>>(
        `${API_BASE}/applications/${encodeURIComponent(applicationUuid)}/environment-variables/${encodeURIComponent(envUuid)}/reveal`,
    ),
    createDatabase: (input: CreateDatabaseInput) => mutate<ApiResponse<CoreResource>>('/databases', {
        method: 'POST',
        body: JSON.stringify(input),
    }),
    databaseConnections: (databaseUuid: string) => apiFetch<ApiResponse<DatabaseApplicationConnection[]>>(
        `${API_BASE}/databases/${encodeURIComponent(databaseUuid)}/connections`,
    ),
    deleteDatabase: (databaseUuid: string) => mutate<ApiResponse<{ queued: boolean; message: string }>>(
        `/databases/${encodeURIComponent(databaseUuid)}`,
        { method: 'DELETE' },
    ),
    libsqlCredentials: (databaseUuid: string) => apiFetch<ApiResponse<LibsqlCredentials>>(
        `${API_BASE}/databases/${encodeURIComponent(databaseUuid)}/credentials`,
    ),
    regenerateLibsqlToken: (databaseUuid: string, redeployApplications = true) => mutate<ApiResponse<LibsqlAccessUpdateResult>>(
        `/databases/${encodeURIComponent(databaseUuid)}/regenerate-token`,
        {
            method: 'POST',
            body: JSON.stringify({ redeploy_applications: redeployApplications }),
        },
    ),
    updateLibsqlPublicAccess: (databaseUuid: string, input: LibsqlAccessUpdateInput) => mutate<ApiResponse<LibsqlAccessUpdateResult>>(
        `/databases/${encodeURIComponent(databaseUuid)}/public-access`,
        { method: 'PUT', body: JSON.stringify(input) },
    ),
    exportDatabaseSql: async (databaseUuid: string, filename: string): Promise<void> => {
        await ensureCsrfCookie();
        const response = await fetch(
            `${API_BASE}/databases/${encodeURIComponent(databaseUuid)}/export-sql`,
            {
                credentials: 'include',
                headers: { Accept: 'application/sql, application/octet-stream, */*' },
            },
        );

        if (!response.ok) {
            const contentType = response.headers.get('content-type') ?? '';
            const payload = contentType.includes('application/json')
                ? await response.json()
                : await response.text();
            throw new ApiError(response.status, payload);
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
    },
    importDatabaseSql: async (
        databaseUuid: string,
        file: File,
        options?: { onUploadProgress?: UploadProgressHandler },
    ) => {
        const formData = new FormData();
        formData.append('file', file);

        return apiUploadWithProgress<ApiResponse<DatabaseImportSqlResult>>(
            `${API_BASE}/databases/${encodeURIComponent(databaseUuid)}/import-sql`,
            formData,
            options?.onUploadProgress,
        );
    },
    databaseExplorer: (databaseUuid: string) => apiFetch<ApiResponse<DatabaseExplorerOverview>>(
        `${API_BASE}/databases/${encodeURIComponent(databaseUuid)}/explorer`,
    ),
    databaseExplorerTable: (databaseUuid: string, table: string, limit = 50) => apiFetch<ApiResponse<DatabaseTablePreview>>(
        `${API_BASE}/databases/${encodeURIComponent(databaseUuid)}/explorer/tables/${encodeURIComponent(table)}?limit=${limit}`,
    ),

    s3Storages: () => apiFetch<ApiResponse<S3Storage[]>>(`${API_BASE}/s3-storages`),
    s3Storage: (storageUuid: string) => apiFetch<ApiResponse<S3Storage>>(`${API_BASE}/s3-storages/${encodeURIComponent(storageUuid)}`),
    createS3Storage: (input: S3StorageInput) => mutate<ApiResponse<S3Storage>>('/s3-storages', {
        method: 'POST',
        body: JSON.stringify(input),
    }),
    updateS3Storage: (uuid: string, input: Partial<S3StorageInput>) => mutate<ApiResponse<S3Storage>>(
        `/s3-storages/${encodeURIComponent(uuid)}`,
        { method: 'PUT', body: JSON.stringify(input) },
    ),
    deleteS3Storage: (uuid: string) => mutate<void>(`/s3-storages/${encodeURIComponent(uuid)}`, { method: 'DELETE' }),
    testS3Storage: (uuid: string) => mutate<ApiResponse<{ success: boolean; message: string; storage: S3Storage }>>(
        `/s3-storages/${encodeURIComponent(uuid)}/test`,
        { method: 'POST' },
    ),

    databaseBackups: (databaseUuid: string) => apiFetch<ApiResponse<DatabaseBackup[]> & { meta: { supports_backups: boolean } }>(
        `${API_BASE}/databases/${encodeURIComponent(databaseUuid)}/backups`,
    ),
    createDatabaseBackup: (databaseUuid: string, input: DatabaseBackupInput) => mutate<ApiResponse<DatabaseBackup>>(
        `/databases/${encodeURIComponent(databaseUuid)}/backups`,
        { method: 'POST', body: JSON.stringify(input) },
    ),
    updateDatabaseBackup: (databaseUuid: string, backupUuid: string, input: Partial<DatabaseBackupInput>) => mutate<ApiResponse<DatabaseBackup>>(
        `/databases/${encodeURIComponent(databaseUuid)}/backups/${encodeURIComponent(backupUuid)}`,
        { method: 'PUT', body: JSON.stringify(input) },
    ),
    deleteDatabaseBackup: (databaseUuid: string, backupUuid: string, deleteS3 = false) => mutate<void>(
        `/databases/${encodeURIComponent(databaseUuid)}/backups/${encodeURIComponent(backupUuid)}?delete_s3=${deleteS3 ? '1' : '0'}`,
        { method: 'DELETE' },
    ),
    runDatabaseBackup: (databaseUuid: string, backupUuid: string) => mutate<ApiResponse<{ queued: boolean; message: string }>>(
        `/databases/${encodeURIComponent(databaseUuid)}/backups/${encodeURIComponent(backupUuid)}/run`,
        { method: 'POST' },
    ),
    databaseBackupExecutions: (databaseUuid: string, backupUuid: string) => apiFetch<ApiResponse<DatabaseBackupExecution[]>>(
        `${API_BASE}/databases/${encodeURIComponent(databaseUuid)}/backups/${encodeURIComponent(backupUuid)}/executions`,
    ),
    deleteDatabaseBackupExecution: (databaseUuid: string, backupUuid: string, executionUuid: string, deleteS3 = false) => mutate<void>(
        `/databases/${encodeURIComponent(databaseUuid)}/backups/${encodeURIComponent(backupUuid)}/executions/${encodeURIComponent(executionUuid)}?delete_s3=${deleteS3 ? '1' : '0'}`,
        { method: 'DELETE' },
    ),

    // Agents IA
    agents: () => apiFetch<ApiListResponse<Agent>>(`${API_BASE}/agents`),
    agent: (uuid: string) => apiFetch<ApiResponse<Agent>>(`${API_BASE}/agents/${encodeURIComponent(uuid)}`),
    createAgent: (input: AgentInput) => mutate<ApiResponse<Agent>>('/agents', {
        method: 'POST',
        body: JSON.stringify(input),
    }),
    updateAgent: (uuid: string, input: Partial<AgentInput> & { status?: 'idle' | 'paused' }) => mutate<ApiResponse<Agent>>(`/agents/${encodeURIComponent(uuid)}`, {
        method: 'PUT',
        body: JSON.stringify(input),
    }),
    deleteAgent: (uuid: string) => mutate<void>(`/agents/${encodeURIComponent(uuid)}`, { method: 'DELETE' }),
    runAgent: (uuid: string) => mutate<ApiResponse<{ queued: boolean; agent_uuid: string; run_uuid: string; status: AgentStatus }>>(`/agents/${encodeURIComponent(uuid)}/run`, { method: 'POST' }),
    agentMessages: (uuid: string, sessionUuid?: string) => {
        const query = sessionUuid ? `?session_uuid=${encodeURIComponent(sessionUuid)}` : '';
        return apiFetch<ApiListResponse<AgentChatMessage>>(`${API_BASE}/agents/${encodeURIComponent(uuid)}/messages${query}`);
    },
    sendAgentMessage: (uuid: string, content: string, sessionUuid?: string) => mutate<ApiResponse<{ user: AgentChatMessage; run_uuid: string; session_uuid: string; status: 'pending' }>>(`/agents/${encodeURIComponent(uuid)}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content, session_uuid: sessionUuid }),
    }),
    agentSessions: (uuid: string) => apiFetch<ApiListResponse<AgentChatSession>>(`${API_BASE}/agents/${encodeURIComponent(uuid)}/sessions`),
    createAgentSession: (uuid: string, title?: string) => mutate<ApiResponse<AgentChatSession>>(`/agents/${encodeURIComponent(uuid)}/sessions`, {
        method: 'POST',
        body: JSON.stringify({ title }),
    }),
    activateAgentSession: (uuid: string, sessionUuid: string) => mutate<ApiResponse<AgentChatSession>>(`/agents/${encodeURIComponent(uuid)}/sessions/${encodeURIComponent(sessionUuid)}/activate`, {
        method: 'POST',
    }),
    updateAgentSession: (uuid: string, sessionUuid: string, title: string) => mutate<ApiResponse<AgentChatSession>>(`/agents/${encodeURIComponent(uuid)}/sessions/${encodeURIComponent(sessionUuid)}`, {
        method: 'PATCH',
        body: JSON.stringify({ title }),
    }),
    agentSessionMessages: (uuid: string, sessionUuid: string) => apiFetch<ApiListResponse<AgentChatMessage>>(`${API_BASE}/agents/${encodeURIComponent(uuid)}/sessions/${encodeURIComponent(sessionUuid)}/messages`),
    sendAgentSessionMessage: (uuid: string, sessionUuid: string, content: string) => mutate<ApiResponse<{ user: AgentChatMessage; run_uuid: string; session_uuid: string; status: 'pending' }>>(`/agents/${encodeURIComponent(uuid)}/sessions/${encodeURIComponent(sessionUuid)}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content }),
    }),
    agentRuns: (agentUuid: string, page = 1) => apiFetch<ApiListResponse<AgentRun>>(`${API_BASE}/agents/${encodeURIComponent(agentUuid)}/runs?page=${page}`),
    agentRun: (agentUuid: string, runUuid: string) => apiFetch<ApiResponse<AgentRun>>(`${API_BASE}/agents/${encodeURIComponent(agentUuid)}/runs/${encodeURIComponent(runUuid)}`),

    // Providers IA
    aiProviders: () => apiFetch<ApiResponse<AiProviderConfig[]>>(`${API_BASE}/ai/providers`),
    createAiProvider: (input: Omit<AiProviderConfig, 'id' | 'has_api_key' | 'created_at'> & { api_key?: string }) => mutate<ApiResponse<AiProviderConfig>>('/ai/providers', {
        method: 'POST',
        body: JSON.stringify(input),
    }),
    updateAiProvider: (id: number, input: Partial<Omit<AiProviderConfig, 'id' | 'created_at'> & { api_key?: string }>) => mutate<ApiResponse<AiProviderConfig>>(`/ai/providers/${id}`, {
        method: 'PUT',
        body: JSON.stringify(input),
    }),
    deleteAiProvider: (id: number) => mutate<void>(`/ai/providers/${id}`, { method: 'DELETE' }),
    testAiProvider: (id: number) => mutate<ApiResponse<{ success: boolean; message: string }>>(`/ai/providers/${id}/test`, { method: 'POST' }),
    discoverAiProviderModels: (input: {
        provider: LlmProvider;
        api_key?: string;
        base_url?: string | null;
        provider_id?: number;
    }) => mutate<ApiResponse<{ models: LlmModelOption[] }>>('/ai/providers/models', {
        method: 'POST',
        body: JSON.stringify(input),
    }),
};
