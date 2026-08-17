import type { BootstrapData } from '../bootstrap';
import { apiFetch, apiUploadWithProgress, ApiError, ensureCsrfCookie, type UploadProgressHandler } from './client';

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

export type ApplicationBootSequencePhase = 'waiting' | 'starting' | 'running' | 'failed' | 'skipped';

export type ApplicationBootSequenceItem = {
    uuid: string;
    name: string;
    order: number;
    phase: ApplicationBootSequencePhase;
    status: string;
    message: string | null;
    started_at: string | null;
    finished_at: string | null;
};

export type ApplicationBootSequence = {
    active: boolean;
    status: 'idle' | 'running' | 'completed' | string;
    started_at: string | null;
    finished_at: string | null;
    current_uuid: string | null;
    completed: number;
    total: number;
    poll_interval_ms: number;
    items: ApplicationBootSequenceItem[];
};

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
    application: { uuid: string; name: string } | null;
    is_debug_enabled: boolean;
};

export type TopologyNodeType =
    | 'hub'
    | 'application'
    | 'deployment'
    | 'production'
    | 'github'
    | 'repository'
    | 'agent'
    | 'intervention';

export type TopologyTone = 'primary' | 'success' | 'warning' | 'error' | 'info' | 'neutral';

export type TopologyNode = {
    id: string;
    type: TopologyNodeType;
    label: string;
    subtitle: string;
    tone: TopologyTone;
    status: string | null;
    href: string | null;
    meta: Record<string, unknown>;
};

export type TopologyEdge = {
    id: string;
    from: string;
    to: string;
    kind: string;
    label: string;
};

export type DeploymentTopology = {
    nodes: TopologyNode[];
    edges: TopologyEdge[];
    summary: {
        applications: number;
        deployments: number;
        production_urls: number;
        agents: number;
        interventions: number;
        github_connections: number;
        repositories: number;
        reachable_urls: number;
        agents_enabled: boolean;
    };
};

export type DeploymentLog = {
    cursor: number;
    timestamp: string | null;
    stream: 'stdout' | 'stderr';
    message: string;
    command: boolean;
    hidden: boolean;
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

export type DeploymentAgentCorrection = {
    outcome: string;
    diagnosis?: string | null;
    headline: string;
    source_scope: string;
    actions: Array<{
        kind: string;
        label?: string;
        detail?: string | null;
        commit_sha?: string | null;
        commit_url?: string | null;
        pr_url?: string | null;
        pr_number?: number | null;
        deployment_uuid?: string | null;
        ok?: boolean;
    }>;
    steps?: string[];
    pills: Array<{
        id: string;
        label: string;
        active: boolean;
        href?: string | null;
        detail?: string | null;
    }>;
    belongs_to_deployment_uuid?: string | null;
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
    correction?: DeploymentAgentCorrection | null;
    historical_for_other_attempt?: boolean;
    subagent_runs?: DeploymentSubagentRun[];
    linkage?: 'metadata' | 'logs' | 'direct' | 'context';
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
    eligible_agents?: Array<{ uuid: string; name: string; type: AgentType }>;
};

export type DeploymentDispatchPolicy = {
    max_runs_per_deployment: number;
    monitor_build_enabled: boolean;
    auto_fix_deployments: boolean;
    allowed_events: string[];
    skipped_events: Array<{ event: string; reason: string; detail?: string }>;
    build_monitoring_effective: boolean;
    summary: string | null;
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
    dispatch_policy?: DeploymentDispatchPolicy;
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
    force_password_reset?: boolean;
};

export type ProfilePasswordUpdateInput = {
    current_password: string;
    password: string;
    password_confirmation: string;
};

export type TwoFactorStatus = {
    two_factor_enabled: boolean;
    two_factor_confirmed: boolean;
    qr_code_svg: string | null;
    setup_key: string | null;
    recovery_codes: string[];
    message?: string;
};

export type SubscriptionStatus = {
    cloud_enabled: boolean;
    subscription_active: boolean;
    subscription_grace_period: boolean;
    already_subscribed: boolean;
    stripe_customer_id_set: boolean;
    can_manage: boolean;
    is_member: boolean;
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
        apps_wildcard_domain: string | null;
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
        agents: {
            dynamic_roles_enabled: boolean;
            role_model_routing: boolean;
            collab_enabled: boolean;
            code_sandbox_enabled: boolean;
            mcp_client_enabled: boolean;
            mcp_servers: Array<{
                id: string;
                url: string;
                label?: string;
                token_env?: string;
                timeout?: number;
            }>;
        };
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
        smtp_password_set: boolean;
        smtp_timeout: number | null;
        resend_enabled: boolean;
        resend_api_key_set: boolean;
    };
    updates: {
        is_auto_update_enabled: boolean;
        auto_update_frequency: string | null;
        update_check_frequency: string | null;
        new_version_available: boolean;
    };
};

export type InstanceGeneralUpdateInput = {
    fqdn?: string | null;
    apps_wildcard_domain?: string | null;
    instance_name?: string | null;
    instance_timezone?: string;
    public_ipv4?: string | null;
    public_ipv6?: string | null;
    public_port_min?: number;
    public_port_max?: number;
    dev_helper_version?: string | null;
    force_save_domains?: boolean;
};

export type InstanceAdvancedUpdateInput = {
    is_registration_enabled?: boolean;
    do_not_track?: boolean;
    is_dns_validation_enabled?: boolean;
    custom_dns_servers?: string | null;
    is_api_enabled?: boolean;
    allowed_ips?: string | null;
    is_sponsorship_popup_enabled?: boolean;
    disable_two_step_confirmation?: boolean;
    is_wire_navigate_enabled?: boolean;
    is_mcp_server_enabled?: boolean;
    agents?: {
        dynamic_roles_enabled?: boolean;
        role_model_routing?: boolean;
        collab_enabled?: boolean;
        code_sandbox_enabled?: boolean;
        mcp_client_enabled?: boolean;
        mcp_servers?: Array<{
            id: string;
            url: string;
            label?: string;
            token_env?: string;
            timeout?: number;
        }>;
    };
    confirmation_password?: string;
};

export type InstanceEmailUpdateInput = {
    smtp_enabled?: boolean;
    smtp_from_address?: string | null;
    smtp_from_name?: string | null;
    smtp_recipients?: string | null;
    smtp_host?: string | null;
    smtp_port?: number | null;
    smtp_encryption?: string | null;
    smtp_username?: string | null;
    smtp_password?: string | null;
    smtp_timeout?: number | null;
    resend_enabled?: boolean;
    resend_api_key?: string | null;
};

export type InstanceUpdatesUpdateInput = {
    is_auto_update_enabled?: boolean;
    auto_update_frequency?: string | null;
    update_check_frequency?: string | null;
};

export type InstanceBackupExecution = {
    id: number;
    uuid: string;
    status: string | null;
    message: string | null;
    size: number;
    filename: string | null;
    database_name: string | null;
    s3_uploaded: boolean | null;
    created_at: string | null;
    finished_at: string | null;
    download_url: string | null;
};

export type InstanceBackupS3Option = {
    uuid: string;
    name: string;
    is_usable: boolean;
    team_id: number;
};

export type InstanceBackupSettings = {
    database: {
        uuid: string;
        name: string;
        description: string | null;
        postgres_user: string;
        postgres_password?: string;
        postgres_db?: string | null;
        status: string;
    } | null;
    backup: {
        uuid: string;
        enabled: boolean;
        frequency: string;
        save_s3: boolean;
        disable_local_backup?: boolean;
        s3_storage: { uuid: string; name: string } | null;
        retention?: {
            local: { amount: number; days: number; max_storage_gb: number };
            s3: { amount: number; days: number; max_storage_gb: number };
        };
        latest_execution?: InstanceBackupExecution | null;
    } | null;
    executions: InstanceBackupExecution[];
    s3_storages: InstanceBackupS3Option[];
    is_server_functional: boolean;
    migration: {
        legacy_container_detected: boolean;
        container_candidates: string[];
        notes: string;
    };
    migrated?: boolean;
    message?: string;
};

export type InstanceBackupDatabaseUpdateInput = {
    name: string;
    description?: string | null;
    postgres_user: string;
    postgres_password?: string;
};

export type InstanceBackupScheduleUpdateInput = {
    enabled?: boolean;
    frequency?: string;
    save_s3?: boolean;
    s3_storage_uuid?: string | null;
    disable_local_backup?: boolean;
};

export type OauthProviderSettings = {
    id: number;
    provider: string;
    enabled: boolean;
    client_id: string | null;
    client_secret_set: boolean;
    redirect_uri: string | null;
    tenant: string | null;
    base_url: string | null;
};

export type OauthProviderUpdateInput = {
    enabled?: boolean;
    client_id?: string | null;
    client_secret?: string | null;
    redirect_uri?: string | null;
    tenant?: string | null;
    base_url?: string | null;
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

export type NotificationChannelCredentials = Record<string, string | number | boolean | null>;

export type NotificationChannel = {
    channel: string;
    enabled: boolean;
    events: Record<string, boolean>;
    credentials?: NotificationChannelCredentials;
};

export type NotificationChannelUpdateInput = {
    events?: Record<string, boolean>;
    enabled?: boolean;
    credentials?: NotificationChannelCredentials;
};

export type ScheduledJobExecutionLog = {
    id: number;
    type: 'task' | 'backup' | 'cleanup';
    status: string;
    resource_name: string;
    resource_type: string | null;
    server_name: string;
    server_id: number;
    team_id: number | null;
    created_at: string;
    finished_at: string | null;
    message: string | null;
    size: number | null;
};

export type ScheduledJobSkipLog = {
    timestamp: string;
    type: string;
    reason: string;
    team_id: number | null;
    context: Record<string, any>;
    link: string | null;
    resource_name: string | null;
};

export type ScheduledJobManagerRun = {
    timestamp: string;
    message: string;
    duration_ms: number | null;
    dispatched: number | null;
    skipped: number | null;
};

export type ScheduledJobDefinition = {
    id: number;
    uuid: string;
    type: 'task' | 'backup';
    name: string;
    command: string | null;
    frequency: string;
    enabled: boolean;
    resource_name: string;
    resource_type: string;
    resource_uuid?: string;
    project_name?: string;
    environment_name?: string;
    link: string | null;
};

export type ScheduledJobsData = {
    executions: ScheduledJobExecutionLog[];
    skips: {
        logs: ScheduledJobSkipLog[];
        totalCount: number;
        hasPrev: boolean;
        hasNext: boolean;
        currentPage: number;
    };
    managerRuns: ScheduledJobManagerRun[];
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

export type AgentType = 'debug' | 'tech-watch' | 'github' | 'github-actions' | 'devforge' | 'deployment' | 'security';
export type AgentStatus = 'idle' | 'running' | 'error' | 'paused';
export type AgentRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'awaiting_approval' | 'waiting_for_input' | 'waiting_for_subagents';
export type AgentTrigger = 'scheduled' | 'manual' | 'event' | 'chat' | 'ephemeral' | 'delegation';

export type AgentChatStep = {
    type: 'tool' | 'thinking';
    name: string;
    args_summary?: string;
    result_summary?: string;
    status?: 'done' | 'error' | 'skipped' | 'awaiting_approval' | 'running';
};

export type AgentChatMessage = {
    uuid: string;
    role: 'user' | 'assistant';
    content: string;
    metadata: (Record<string, unknown> & {
        steps?: AgentChatStep[];
        pending_approval?: Record<string, unknown>;
        pending_plan?: Record<string, unknown>;
        tokens_used?: number;
        iterations?: number;
    }) | null;
    run_uuid: string | null;
    session_uuid?: string | null;
    created_at: string;
};

export type AgentChatSession = {
    uuid: string;
    title: string;
    chat_mode?: 'plan' | 'build' | 'debug';
    is_legacy: boolean;
    last_message_at: string | null;
    created_at: string;
};

export type AgentMemory = {
    id: number;
    scope: 'agent' | 'shared' | 'project';
    content: string;
    tags: string[];
    resource_uuid: string | null;
    created_at: string | null;
};

export type AgentMissionKind = 'bug' | 'feature' | 'tech_watch' | 'github_pr' | 'ops' | 'other';
export type AgentMissionStatus = 'open' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
export type AgentMissionPriority = 'low' | 'normal' | 'high' | 'urgent';

export type AgentMissionTimelineEvent = {
    at: string | null;
    label: string;
};

export type AgentMission = {
    uuid: string;
    kind: AgentMissionKind | string;
    status: AgentMissionStatus | string;
    priority: AgentMissionPriority | string;
    title: string;
    description: string | null;
    source: string | null;
    resource_uuid: string | null;
    agent_id: number | null;
    agent_uuid?: string | null;
    agent_name?: string | null;
    agent_type?: string | null;
    assignee_agent_id: number | null;
    assignee_uuid?: string | null;
    assignee_name?: string | null;
    assignee_type?: string | null;
    blocked_reason?: string | null;
    run_uuid?: string | null;
    timeline?: AgentMissionTimelineEvent[];
    metadata: Record<string, unknown>;
    is_feature_delivery?: boolean;
    created_at: string | null;
    updated_at: string | null;
    completed_at: string | null;
};

export type FeatureDeliveryPreview = {
    uuid: string;
    pull_request_id: number;
    pull_request_html_url?: string | null;
    fqdn: string | null;
    status: string | null;
    is_running?: boolean;
};

export type FeatureDeliveryStatus = {
    workflow: string;
    awaiting: string;
    force_pull_request: boolean;
    application_uuid: string | null;
    application_name?: string | null;
    pull_request_number: number | null;
    pull_request_url: string | null;
    branch: string | null;
    preview: FeatureDeliveryPreview | null;
    preview_deployments_enabled: boolean;
    can_validate: boolean;
    run_uuid: string | null;
};

export type AgentChatAttachment = {
    type?: string;
    label?: string;
    url?: string;
    text?: string;
    selector?: string;
};

export type LlmProvider = 'gemini' | 'ollama' | 'openai' | 'openrouter' | 'anthropic';

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

export type OllamaGpuInfo = {
    index: number;
    name: string;
    memory_total_mib: number | null;
    memory_used_mib: number | null;
    memory_free_mib: number | null;
    utilization_percent: number | null;
    temperature_c: number | null;
};

export type OllamaHostInfo = {
    server_id: number | null;
    server_name: string | null;
    probed: boolean;
    cpu_cores: number | null;
    memory_total_bytes: number | null;
    memory_available_bytes: number | null;
    gpus: OllamaGpuInfo[];
    error: string | null;
};

export type OllamaModelInfo = {
    name: string;
    size: number | null;
    parameter_size: string | null;
    quantization: string | null;
    family: string | null;
    modified_at: string | null;
};

export type OllamaRunningModel = {
    name: string;
    size: number | null;
    size_vram: number | null;
    expires_at: string | null;
};

export type OllamaStatus = {
    reachable: boolean;
    base_url: string | null;
    provider_id?: number | null;
    provider_name?: string | null;
    version: string | null;
    models: OllamaModelInfo[];
    running: OllamaRunningModel[];
    host: OllamaHostInfo;
    error: string | null;
};

export type OllamaInstance = {
    id: number;
    name: string;
    base_url: string | null;
    resolved_base_url: string | null;
    is_default: boolean;
    model: string | null;
    reachable: boolean;
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
    contribution?: string | null;
    leaf_profile?: string | null;
    role_slug?: string | null;
    async?: boolean;
};

export type AgentTeamContribution = {
    role_slug: string | null;
    leaf_profile: string | null;
    run_uuid: string | null;
    status: string;
    tier: string | null;
    model_label: string | null;
    goal: string | null;
    contribution: string | null;
    tools_used: string[];
    risks: string[];
};

export type AgentTeamReport = {
    generated_at: string;
    leaf_count: number;
    succeeded: number;
    failed: number;
    roles: string[];
    contributions: AgentTeamContribution[];
    decisions: string[];
    risks: string[];
    markdown: string;
};

export type AgentRunPendingApproval = {
    status?: string;
    resolved?: string;
    tool?: string;
    reason?: string;
    rule_id?: string;
    approval_key?: string;
    diff_preview?: Record<string, unknown>;
};

export type AgentRunMetadata = {
    model_routing?: AgentModelRouting;
    ephemeral?: boolean;
    parent_run_uuid?: string | null;
    ephemeral_tasks?: AgentEphemeralTask[];
    team_report?: AgentTeamReport;
    orchestration?: 'pipeline' | 'collab' | string;
    speaker_selection?: 'auto' | 'round_robin' | string;
    collab_transcript?: Array<Record<string, unknown>>;
    pending_leaf_spawns?: Array<Record<string, unknown>>;
    subagent_role?: 'main' | 'orchestrator' | 'leaf' | string;
    spawn_depth?: number;
    pending_approval?: AgentRunPendingApproval;
    steps?: AgentChatStep[];
    todos?: Array<{ id: string; content: string; status: string }>;
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
    active_subagent_count?: number;
    live_assistant_text?: string | null;
    started_at: string | null;
    finished_at: string | null;
    created_at: string;
    logs?: string | null;
};

export type AgentTriggerMode = 'manual' | 'schedule' | 'webhook' | 'cron';

export type Agent = {
    id: number;
    uuid: string;
    type: AgentType;
    name: string;
    description: string | null;
    avatar_color: string;
    system_prompt: string | null;
    schedule_minutes: number;
    schedule_cron?: string | null;
    heartbeat_enabled?: boolean;
    last_heartbeat_at?: string | null;
    trigger_mode: AgentTriggerMode;
    event_trigger_label?: string | null;
    is_event_only?: boolean;
    is_active: boolean;
    status: AgentStatus;
    is_primary_chat?: boolean;
    llm_available?: boolean;
    last_run_at: string | null;
    provider: { id: number; name: string; provider: LlmProvider; model: string; model_label?: string; base_url?: string | null } | null;
    fallback_provider: { id: number; name: string; provider: LlmProvider; model: string; model_label?: string; base_url?: string | null } | null;
    preferred_model?: string | null;
    parent_agent_id: number | null;
    resource_uuid: string | null;
    sub_agents_count: number;
    sub_agents?: Array<{
        id: number;
        uuid: string;
        type: AgentType;
        name: string;
        avatar_color: string;
        status: AgentStatus;
        is_active: boolean;
    }>;
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
    preferred_model?: string | null;
    parent_agent_id?: number | null;
    resource_uuid?: string | null;
    schedule_minutes?: number;
    schedule_cron?: string | null;
    heartbeat_enabled?: boolean;
    is_active?: boolean;
    is_primary_chat?: boolean;
};

export type AgentStandingOrder = {
    id: number;
    title: string;
    scope: string;
    resource_uuid: string | null;
    agent_id: number | null;
    triggers: string[];
    approval_gates: string | null;
    escalation: string | null;
    body: string;
    priority: number;
    is_active: boolean;
    created_at: string | null;
    updated_at: string | null;
};

export type AgentSkill = {
    id: number;
    slug: string;
    name: string;
    description: string;
    body: string;
    tags: string[];
    agent_id: number | null;
    is_active: boolean;
    is_builtin: boolean;
    priority: number;
    created_at: string | null;
    updated_at: string | null;
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
    message?: string;
};

export type CloudInitScript = {
    id: number;
    name: string;
    script: string;
    created_at: string;
    updated_at: string;
    message?: string;
};

export type CloudInitScriptInput = {
    name: string;
    script: string;
};

export type SecurityKeyInput = {
    name?: string;
    description?: string | null;
    private_key: string;
};

export type SecurityKeyGenerateResult = {
    name: string;
    description: string;
    private_key: string;
    public_key: string;
};

export type ApiToken = {
    id: number;
    name: string;
    abilities: string[];
    team_id: number | null;
    last_used_at: string | null;
    expires_at: string | null;
    created_at: string | null;
    is_expired: boolean;
    plain_text_token?: string;
    message?: string;
};

export type ApiTokenMeta = {
    is_api_enabled: boolean;
    can_use_root: boolean;
    can_use_write: boolean;
};

export type ApiTokenInput = {
    name: string;
    abilities?: string[];
    expires_in_days?: number | null;
};

export type CloudProviderTokenSummary = {
    uuid: string;
    name: string;
    provider: 'hetzner' | 'digitalocean' | string;
    team_id: number;
    servers_count: number;
    created_at: string | null;
    updated_at: string | null;
    message?: string;
};

export type CloudProviderTokenInput = {
    provider: 'hetzner' | 'digitalocean';
    token: string;
    name: string;
};

export type CloudProviderTokenValidation = {
    valid: boolean;
    message: string;
};

export type GithubAppSummary = {
    uuid: string;
    name: string;
    display_name?: string;
    account_login?: string | null;
    account_type?: string | null;
    account_avatar_url?: string | null;
    account_html_url?: string | null;
    organization: string | null;
    html_url: string | null;
    is_system_wide: boolean;
    has_packages_token?: boolean;
    installation_id?: string | number | null;
};

export type GithubAppManifestLaunch = {
    action_url: string;
    manifest: Record<string, unknown>;
};

export type GithubAppSetupResult = {
    app: GithubAppSummary;
    launch: GithubAppManifestLaunch;
};

export type GithubRunnerLinkedApplication = {
    uuid: string;
    name: string;
    role?: string | null;
    link_source?: 'manual' | 'auto';
};

export type GithubRunner = {
    id: string;
    name: string;
    container_id: string;
    image: string;
    state: string;
    status: string;
    created: string;
    server_uuid: string;
    server_name: string;
    repo_url: string | null;
    runner_name: string;
    environment?: Array<{ key: string; value: string }>;
    github_status?: 'online' | 'offline' | 'busy' | string | null;
    github_busy?: boolean | null;
    github_runner_id?: number | null;
    github_labels?: string[];
    github_repo?: string | null;
    source?: 'docker' | 'github' | 'both' | 'managed';
    managed?: boolean;
    managed_uuid?: string | null;
    last_reconcile_error?: string | null;
    last_reconciled_at?: string | null;
    linked_applications?: GithubRunnerLinkedApplication[];
    runner_version?: string | null;
    node24_ready?: boolean | null;
    node24_min_version?: string;
    recommended_runner_version?: string;
};

export type GithubRunnerAction = 'start' | 'stop' | 'restart' | 'recreate';

export type GithubRunnerAuthMode = 'registration' | 'pat';

export type GithubRunnerCreateInput = {
    auth_mode?: GithubRunnerAuthMode;
    access_token?: string;
    use_saved_pat?: boolean;
    save_pat?: boolean;
    github_app_uuid?: string;
    owner: string;
    repo: string;
    server_uuid: string;
    runner_name: string;
    container_name?: string;
    labels?: string;
    image?: string;
    network_mode?: 'bridge' | 'host' | 'none';
    timezone?: string;
    replace_existing?: boolean;
    recreate?: boolean;
    pull_image?: boolean;
    volumes?: string[];
    extra_env?: Array<{ key: string; value: string }>;
    application_links?: Array<{ application_uuid: string; role?: string | null }>;
};

export type GithubRunnerActionResult = {
    ok: boolean;
    action: GithubRunnerAction;
    message: string;
    runner: GithubRunner;
};

export type GithubRunnerLogs = {
    available: boolean;
    reason: string | null;
    message: string | null;
    container: string | null;
    container_status: string | null;
    line_count: number;
    items: Array<{ cursor: number; message: string }>;
    runner_version?: string | null;
    node24_ready?: boolean | null;
    node24_min_version?: string;
    recommended_runner_version?: string;
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
    env_contents?: string;
    domains?: string;
};

export type ApplicationDomainRedirect = 'both' | 'www' | 'non-www';

export type ApplicationDomains = {
    domains: string[];
    managed_domain: string | null;
    fqdn: string | null;
    redirect: ApplicationDomainRedirect;
    wildcard_domain: string | null;
    build_pack: string | null;
    sslip_warning: boolean;
};

export type ApplicationReadinessStatus =
    | 'idle'
    | 'probing'
    | 'healthy'
    | 'recovering'
    | 'awaiting_user'
    | 'failed';

export type ApplicationReadinessStep = {
    rank: number;
    text: string;
    done?: boolean;
};

export type ApplicationReadinessIntervention = {
    uuid: string;
    title: string;
    summary: string | null;
    steps: ApplicationReadinessStep[];
    status: 'open' | 'acknowledged' | 'resolved' | 'cancelled';
    user_acknowledged_at: string | null;
    resolved_at: string | null;
};

export type ApplicationReadiness = {
    uuid: string | null;
    status: ApplicationReadinessStatus;
    autonomous_enabled: boolean;
    last_probe_at: string | null;
    last_probe_ok: boolean | null;
    last_probe_error: string | null;
    last_http_status: number | null;
    round: number;
    max_rounds: number;
    last_deployment_uuid: string | null;
    probe_url: string | null;
    intervention: ApplicationReadinessIntervention | null;
    degraded?: boolean;
};

export type ApplicationRuntimeSettings = {
    build_pack: string;
    is_static: boolean;
    start_command: string | null;
    install_command: string | null;
    build_command: string | null;
    ports_exposes: string;
    base_directory: string;
    publish_directory: string;
    detected_framework: string | null;
    health_check_enabled: boolean;
    health_check_type: string;
    health_check_path: string;
    health_check_port: string | null;
    supports_static_toggle: boolean;
};

export type ApplicationRuntimeSettingsDetection = {
    available: boolean;
    reason: string | null;
    sources: string[];
    suggestions: Partial<{
        is_static: boolean;
        ports_exposes: string;
        publish_directory: string;
        base_directory: string;
        start_command: string | null;
        build_command: string | null;
        install_command: string | null;
        health_check_enabled: boolean;
        health_check_path: string;
        health_check_port: string;
        framework: string;
        framework_label: string;
    }>;
    reasons: string[];
};

export type ApplicationRuntimeSettingsUpdateInput = Partial<{
    build_pack: string;
    is_static: boolean;
    start_command: string | null;
    install_command: string | null;
    build_command: string | null;
    ports_exposes: string;
    base_directory: string;
    publish_directory: string;
    detected_framework: string | null;
    health_check_enabled: boolean;
    health_check_type: string;
    health_check_path: string;
    health_check_port: string | null;
}>;

export type ApplicationDomainsUpdateInput = {
    domains?: string | null;
    redirect?: ApplicationDomainRedirect;
    force_domain_override?: boolean;
    redeploy?: boolean;
};

export type ApplicationDomainRedeploy = {
    queued: boolean;
    deployment_uuid: string | null;
    message: string;
};

export type DomainConflict = {
    domain?: string;
    resource_name?: string;
    resource_type?: string;
    message?: string;
};

export type ServerSettings = {
    uuid: string;
    name: string;
    wildcard_domain: string | null;
    advanced?: {
        concurrent_builds: number;
        dynamic_timeout: number;
        deployment_queue_limit: number;
        server_disk_usage_notification_threshold: number;
        server_disk_usage_check_frequency: string;
    };
    security?: {
        is_terminal_enabled: boolean;
    };
    swarm?: {
        is_swarm_manager: boolean;
        is_swarm_worker: boolean;
        deprecated?: boolean;
    };
    sentinel?: {
        is_sentinel_enabled: boolean;
        is_metrics_enabled: boolean;
        is_live: boolean;
        sentinel_token_set: boolean;
        sentinel_custom_url: string | null;
        sentinel_metrics_refresh_rate_seconds: number | null;
        sentinel_metrics_history_days: number | null;
        sentinel_push_interval_seconds: number | null;
    };
    proxy?: {
        type: string | null;
        status: string | null;
        redirect_enabled: boolean;
        redirect_url: string | null;
        generate_exact_labels: boolean;
        detected_traefik_version: string | null;
        config_out_of_sync: boolean;
    };
};

export type ServerSettingsUpdateInput = {
    wildcard_domain?: string | null;
    is_swarm_manager?: boolean;
    is_swarm_worker?: boolean;
    is_sentinel_enabled?: boolean;
    is_metrics_enabled?: boolean;
    sentinel_custom_url?: string | null;
    sentinel_metrics_refresh_rate_seconds?: number | null;
    sentinel_metrics_history_days?: number | null;
    sentinel_push_interval_seconds?: number | null;
    concurrent_builds?: number;
    dynamic_timeout?: number;
    deployment_queue_limit?: number;
    server_disk_usage_notification_threshold?: number;
    server_disk_usage_check_frequency?: string;
    is_terminal_enabled?: boolean;
    confirmation_password?: string;
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

export type ServerStorageCleanupSettings = {
    force_docker_cleanup: boolean;
    docker_cleanup_frequency: string;
    docker_cleanup_threshold: number;
    delete_unused_volumes: boolean;
    delete_unused_networks: boolean;
    disable_application_image_retention: boolean;
};

export type ServerStorageMonitoringSettings = {
    server_disk_usage_notification_threshold: number;
    server_disk_usage_check_frequency: string;
};

export type ServerStorageExecution = {
    id: number;
    status: string;
    message: string | null;
    cleanup_log: string | null;
    created_at: string | null;
    finished_at: string | null;
};

export type ServerStorageSummary = {
    uuid: string;
    name: string;
    description: string | null;
    status: {
        reachable: boolean;
        usable: boolean;
        functional: boolean;
    };
    disk_usage_percent: number | null;
    disk_partitions?: Record<string, number> | null;
    disk_alert_threshold: number;
    cleanup: ServerStorageCleanupSettings;
    monitoring: ServerStorageMonitoringSettings;
    last_cleanup: ServerStorageExecution | null;
    executions?: ServerStorageExecution[];
    docker_disk_report?: string | null;
};

export type ServerStorageMeta = {
    scheduler_healthy: boolean;
};

export type ServerFilesystemEntry = {
    name: string;
    type: 'file' | 'directory' | 'symlink' | 'other';
    size: number;
    permissions: string;
    modified_label: string;
    symlink_target: string | null;
};

export type ServerFilesystemListing = {
    path: string;
    parent_path: string | null;
    entries: ServerFilesystemEntry[];
    entry_count: number;
};

export type ServerFilesystemFile = {
    path: string;
    content: string;
    size: number;
    truncated: boolean;
    max_bytes: number;
};

export type ServerFilesystemSearch = {
    path: string;
    pattern: string;
    mode: 'name' | 'content';
    results: string[];
    result_count: number;
    truncated: boolean;
};

export type ServerFilesystemMeta = {
    default_path: string;
    read_max_bytes: number;
    write_max_bytes: number;
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
    /** Absent sur certains endpoints legacy : fallback = is_editable. */
    is_deletable?: boolean;
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
>

export type ApplicationEnvironmentVariableImportInput = {
    contents: string;
    is_preview?: boolean;
};

export type ApplicationEnvironmentVariableImportResult = {
    created: number;
    updated: number;
    skipped: Array<{ key: string; reason: string }>;
    variables: ApplicationEnvironmentVariables;
};;

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
    fqdn: string | null;
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
    linked_applications?: Array<{ uuid: string; name: string }>;
    env_variables_synced?: number;
    redeployments_queued?: number;
    downtime_required?: boolean;
    downtime_note?: string;
    payload_bytes?: number;
    estimated_transfer_chunks?: number;
    large_payload?: boolean;
    transfer_hint?: string;
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

export type DatabaseLogs = ApplicationLogs;

export type ApplicationWebhookProvider = {
    url: string | null;
    secret_set: boolean;
    configuration_url?: string | null;
};

export type ApplicationWebhooks = {
    deploy_webhook_url: string;
    manual_webhooks_available: boolean;
    uses_git_app: boolean;
    manual: {
        github: ApplicationWebhookProvider;
        gitlab: ApplicationWebhookProvider;
        bitbucket: ApplicationWebhookProvider;
        gitea: ApplicationWebhookProvider;
    } | null;
};

export type ApplicationScheduledTaskExecution = {
    uuid: string;
    status: string;
    message: string | null;
    started_at: string | null;
    finished_at: string | null;
    duration: number | string | null;
    retry_count: number;
    created_at: string | null;
};

export type ApplicationScheduledTask = {
    uuid: string;
    name: string;
    command: string;
    frequency: string;
    container: string | null;
    timeout: number;
    enabled: boolean;
    latest_execution: ApplicationScheduledTaskExecution | null;
    created_at: string | null;
    updated_at: string | null;
};

export type ApplicationScheduledTaskInput = {
    name?: string;
    command?: string;
    frequency?: string;
    container?: string | null;
    timeout?: number;
    enabled?: boolean;
};

export type ApplicationPreview = {
    uuid: string;
    pull_request_id: number;
    pull_request_html_url: string | null;
    fqdn: string | null;
    status: string | null;
    is_running: boolean;
    git_type: string | null;
    docker_registry_image_tag: string | null;
    last_online_at: string | null;
    created_at: string | null;
    updated_at: string | null;
};

export type ApplicationPreviewSettings = {
    is_preview_deployments_enabled: boolean;
    preview_url_template: string;
};

export type ApplicationStorage = {
    uuid: string;
    type: 'persistent' | 'file';
    name?: string | null;
    fs_path?: string | null;
    mount_path: string;
    host_path?: string | null;
    is_directory?: boolean;
    is_preview_suffix_enabled: boolean;
    has_content?: boolean;
    is_binary?: boolean;
    is_too_large?: boolean;
    read_only: boolean;
    created_at: string | null;
    updated_at: string | null;
};

export type ApplicationStoragesPayload = {
    compose_managed: boolean;
    is_swarm: boolean;
    storages: ApplicationStorage[];
};

export type ServiceStorage = ApplicationStorage;

export type ServiceStorageGroup = {
    child_uuid: string;
    child_name: string;
    child_type: 'application' | 'database';
    storages: ServiceStorage[];
};

export type ServiceStoragesPayload = {
    compose_managed: boolean;
    is_swarm: boolean;
    groups: ServiceStorageGroup[];
};

export type ApplicationStorageInput = {
    type: 'persistent' | 'file';
    name?: string;
    mount_path: string;
    host_path?: string | null;
    content?: string | null;
    is_directory?: boolean;
    fs_path?: string;
};

export type ApplicationStorageUpdateInput = {
    name?: string;
    mount_path?: string;
    host_path?: string | null;
    content?: string | null;
    is_preview_suffix_enabled?: boolean;
};

export type DatabaseHealthcheckSettings = {
    health_check_enabled: boolean;
    health_check_interval: number;
    health_check_timeout: number;
    health_check_retries: number;
    health_check_start_period: number;
    probe_label: string;
    restart_required: boolean;
    message?: string;
};

export type ApplicationResourceLimits = {
    limits_cpus: string | null;
    limits_cpuset: string | null;
    limits_cpu_shares: number;
    limits_memory: string;
    limits_memory_swap: string;
    limits_memory_reservation: string;
    limits_memory_swappiness: number;
    message?: string;
};

export type ApplicationAdvancedSettings = {
    disable_build_cache: boolean;
    inject_build_args_to_dockerfile: boolean;
    include_source_commit_in_build: boolean;
    skip_puppeteer_browser_download: boolean;
    is_consistent_container_name_enabled: boolean;
    is_auto_deploy_enabled: boolean;
    is_image_auto_update_enabled: boolean;
    is_git_submodules_enabled: boolean;
    is_git_lfs_enabled: boolean;
    is_git_shallow_clone_enabled: boolean;
    is_pr_deployments_public_enabled: boolean;
    is_force_https_enabled: boolean;
    is_gzip_enabled: boolean;
    is_stripprefix_enabled: boolean;
    is_log_drain_enabled: boolean;
    connect_to_docker_network: boolean;
    stop_grace_period: number | null;
    max_restart_count: number;
    capabilities: {
        git_based: boolean;
        dockercompose: boolean;
        dockerimage: boolean;
        log_drain_server: boolean;
    };
    message?: string;
};

export type ServiceSettings = {
    is_image_auto_update_enabled: boolean;
    message?: string;
};

export type ApplicationResourceOperations = {
    current_destination_uuid: string | null;
    current_environment_uuid: string | null;
    destinations: Array<{
        uuid: string;
        name: string;
        type: string;
        server: { uuid: string; name: string };
    }>;
    environments: Array<{
        uuid: string;
        name: string;
        project_uuid: string;
        project_name: string;
    }>;
};

export type ApplicationResourceOperationResult = {
    uuid: string;
    name: string;
    project_uuid: string | null;
    environment_uuid: string | null;
    message?: string;
};

export type ApplicationSourceInfo = {
    available: boolean;
    reason: string | null;
    git_repository: string | null;
    git_branch: string | null;
    git_commit_sha: string | null;
    base_directory: string;
    initial_path: string;
    owner: string | null;
    repo: string | null;
    github_app_uuid: string | null;
    github_app_name: string | null;
    html_url: string | null;
};

export type ApplicationGitSyncStatus = {
    available: boolean;
    reason: string | null;
    git_branch: string | null;
    git_repository: string | null;
    owner: string | null;
    repo: string | null;
    github_app_uuid: string | null;
    deployed_commit: string | null;
    deployed_commit_message: string | null;
    deployed_at: string | null;
    remote_head_sha: string | null;
    up_to_date: boolean | null;
    remote_error: string | null;
};

export type ApplicationSourceEntry = {
    name: string;
    path: string;
    type: 'file' | 'directory';
    size: number;
};

export type ApplicationSourceListing = {
    path: string;
    parent_path: string | null;
    entries: ApplicationSourceEntry[];
    entry_count: number;
    ref: string;
    repository: string;
};

export type ApplicationSourceFile = {
    path: string;
    content: string;
    size: number;
    truncated: boolean;
    sha: string | null;
    ref: string;
    repository: string;
};

export type ApplicationSourceWriteResult = {
    mode: 'direct' | 'pull_request';
    path: string;
    sha: string | null;
    commit_sha: string | null;
    commit_url: string | null;
    ref: string;
    branch: string;
    repository: string;
    size: number;
    pull_request_number?: number | null;
    pull_request_url?: string | null;
    redeploy?: {
        queued: boolean;
        deployment_uuid?: string | null;
        message?: string | null;
    } | null;
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

async function mutate<T>(path: string, init: RequestInit, timeoutMs = 20_000): Promise<T> {
    await ensureCsrfCookie();
    return apiFetch<T>(`${API_BASE}${path}`, init, timeoutMs);
}

/** SSH disk / Docker cleanup calls can exceed the default 20 s client timeout. */
const STORAGE_API_TIMEOUT_MS = 120_000;

export interface AgentKeyRequest {
    uuid: string;
    key_name: string;
    kind?: string;
    reason: string | null;
    status: string;
    resource_uuid?: string | null;
    mission_uuid?: string | null;
    agent_uuid?: string | null;
    agent_name?: string | null;
    agent_type?: string | null;
    agent?: {
        uuid?: string;
        name: string;
        type?: string;
    };
    created_at?: string | null;
    resolved_at?: string | null;
}

export const domainApi = {
    agentKeyRequests: (options?: { status?: string }) => {
        const params = new URLSearchParams();
        if (options?.status) params.set('status', options.status);
        const qs = params.toString();
        return apiFetch<{ data: AgentKeyRequest[]; meta?: { pending_count?: number } }>(
            `${API_BASE}/agent-key-requests${qs ? `?${qs}` : ''}`,
        );
    },
    fulfillAgentKeyRequest: (uuid: string, value: string, options?: { scope?: 'shared' | 'application'; confirmed?: boolean }) => mutate<{ message: string }>(`/agent-key-requests/${encodeURIComponent(uuid)}/fulfill`, {
        method: 'POST',
        body: JSON.stringify({
            value,
            scope: options?.scope,
            confirmed: options?.confirmed,
        }),
    }),
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
    applicationBootSequence: () => apiFetch<ApiResponse<ApplicationBootSequence>>(`${API_BASE}/core/applications/boot-sequence`),
    startApplicationBootSequence: () => mutate<ApiResponse<ApplicationBootSequence>>('/core/applications/boot-sequence/start', {
        method: 'POST',
        body: JSON.stringify({}),
    }),
    coreAction: (type: Exclude<CoreResourceType, 'servers'>, uuid: string, action: CoreAction, payload?: { force?: boolean }) => mutate<ApiResponse<CoreActionResult>>(`/core/${type}/${encodeURIComponent(uuid)}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ action, ...payload }),
    }),
    deployments: (page = 1, applicationUuid?: string, perPage = 25, options?: { status?: string; active?: boolean }) => {
        const params = new URLSearchParams({
            page: String(page),
            per_page: String(perPage),
        });
        if (applicationUuid) {
            params.set('application_uuid', applicationUuid);
        }
        if (options?.status) {
            params.set('status', options.status);
        }
        if (options?.active) {
            params.set('active', '1');
        }

        return apiFetch<ApiListResponse<Deployment>>(`${API_BASE}/deployments?${params.toString()}`);
    },
    deploymentTopology: () => apiFetch<ApiResponse<DeploymentTopology>>(`${API_BASE}/deployments/topology`),
    deployment: (uuid: string) => apiFetch<ApiResponse<Deployment>>(`${API_BASE}/deployments/${encodeURIComponent(uuid)}`),
    deploymentLogs: (uuid: string, after = 0) => apiFetch<ApiResponse<DeploymentLogs>>(`${API_BASE}/deployments/${encodeURIComponent(uuid)}/logs?after=${after}`),
    toggleDeploymentDebugLogs: (uuid: string, enabled?: boolean) => mutate<ApiResponse<{ is_debug_enabled: boolean }>>(
        `/deployments/${encodeURIComponent(uuid)}/debug-logs`,
        {
            method: 'PATCH',
            body: JSON.stringify(enabled === undefined ? {} : { enabled }),
        },
    ),
    deploymentMonitoring: (uuid: string) => apiFetch<ApiResponse<DeploymentMonitoring>>(`${API_BASE}/deployments/${encodeURIComponent(uuid)}/monitoring`),
    cancelDeployment: (uuid: string) => mutate<ApiResponse<Deployment>>(
        `/deployments/${encodeURIComponent(uuid)}/cancel`,
        { method: 'POST' },
    ),
    statuses: () => apiFetch<ApiResponse<ResourceStatuses>>(`${API_BASE}/resources/status`),
    realtime: () => apiFetch<ApiResponse<RealtimeMetadata>>(`${API_BASE}/realtime`),
    profile: () => apiFetch<ApiResponse<Profile>>(`${API_BASE}/profile`),
    updateProfile: (input: Pick<Profile, 'name' | 'email'>) => mutate<ApiResponse<Profile>>('/profile', {
        method: 'PUT',
        body: JSON.stringify(input),
    }),
    updateProfilePassword: (input: ProfilePasswordUpdateInput) => mutate<ApiResponse<{ message: string; force_password_reset: boolean }>>(
        '/profile/password',
        {
            method: 'PUT',
            body: JSON.stringify(input),
        },
    ),
    twoFactorStatus: () => apiFetch<ApiResponse<TwoFactorStatus>>(`${API_BASE}/profile/two-factor`),
    enableTwoFactor: (currentPassword: string) => mutate<ApiResponse<TwoFactorStatus>>('/profile/two-factor', {
        method: 'POST',
        body: JSON.stringify({ current_password: currentPassword }),
    }),
    confirmTwoFactor: (code: string) => mutate<ApiResponse<TwoFactorStatus>>('/profile/two-factor/confirm', {
        method: 'POST',
        body: JSON.stringify({ code }),
    }),
    disableTwoFactor: (currentPassword: string) => mutate<ApiResponse<TwoFactorStatus>>('/profile/two-factor', {
        method: 'DELETE',
        body: JSON.stringify({ current_password: currentPassword }),
    }),
    regenerateRecoveryCodes: (currentPassword: string) => mutate<ApiResponse<TwoFactorStatus>>(
        '/profile/two-factor/recovery-codes',
        {
            method: 'POST',
            body: JSON.stringify({ current_password: currentPassword }),
        },
    ),
    subscription: () => apiFetch<ApiResponse<SubscriptionStatus>>(`${API_BASE}/subscription`),
    subscriptionPortal: () => mutate<ApiResponse<{ url: string }>>('/subscription/portal', {
        method: 'POST',
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
    updateInstanceSettings: (input: InstanceGeneralUpdateInput) => mutate<ApiResponse<InstanceSettings>>(
        '/settings/instance',
        { method: 'PUT', body: JSON.stringify(input) },
    ),
    updateAdvancedSettings: (input: InstanceAdvancedUpdateInput) => mutate<ApiResponse<InstanceSettings>>(
        '/settings/advanced',
        { method: 'PUT', body: JSON.stringify(input) },
    ),
    updateEmailSettings: (input: InstanceEmailUpdateInput) => mutate<ApiResponse<InstanceSettings>>(
        '/settings/email',
        { method: 'PUT', body: JSON.stringify(input) },
    ),
    updateUpdatesSettings: (input: InstanceUpdatesUpdateInput) => mutate<ApiResponse<InstanceSettings>>(
        '/settings/updates',
        { method: 'PUT', body: JSON.stringify(input) },
    ),
    checkUpdatesSettings: () => mutate<ApiResponse<InstanceSettings>>('/settings/updates/check', {
        method: 'POST',
    }),
    instanceBackupSettings: () => apiFetch<ApiResponse<InstanceBackupSettings>>(`${API_BASE}/settings/backup`),
    initInstanceBackupSettings: (container?: string) => mutate<ApiResponse<InstanceBackupSettings>>('/settings/backup/init', {
        method: 'POST',
        body: JSON.stringify(container ? { container } : {}),
    }),
    updateInstanceBackupDatabase: (input: InstanceBackupDatabaseUpdateInput) => mutate<ApiResponse<InstanceBackupSettings>>(
        '/settings/backup/database',
        { method: 'PUT', body: JSON.stringify(input) },
    ),
    updateInstanceBackupSchedule: (input: InstanceBackupScheduleUpdateInput) => mutate<ApiResponse<InstanceBackupSettings>>(
        '/settings/backup/schedule',
        { method: 'PUT', body: JSON.stringify(input) },
    ),
    runInstanceBackup: () => mutate<ApiResponse<{ queued: boolean; backup_uuid: string; message: string }>>(
        '/settings/backup/run',
        { method: 'POST' },
    ),
    exportInstanceBackup: () => apiFetch<ApiResponse<{ execution_id: number; download_url: string; filename: string | null; created_at: string | null }>>(
        `${API_BASE}/settings/backup/export`,
    ),
    importInstanceBackup: async (file: File, fromCoolify = false, options?: { onUploadProgress?: UploadProgressHandler }) => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('from_coolify', fromCoolify ? '1' : '0');

        return apiUploadWithProgress<ApiResponse<{ imported: boolean; from_coolify: boolean; message: string }>>(
            `${API_BASE}/settings/backup/import`,
            formData,
            options?.onUploadProgress,
        );
    },
    migrateInstanceFromCoolify: () => mutate<ApiResponse<InstanceBackupSettings>>('/settings/backup/migrate-coolify', {
        method: 'POST',
    }),
    scheduledJobs: (type = 'all', date = 'last_24h', skip = 0) => apiFetch<ApiResponse<ScheduledJobsData>>(`${API_BASE}/settings/scheduled-jobs?type=${type}&date=${date}&skip=${skip}`),
    scheduledJobsDefinitions: () => apiFetch<ApiResponse<{ definitions: ScheduledJobDefinition[] }>>(`${API_BASE}/settings/scheduled-jobs/definitions`),
    oauthSettings: () => apiFetch<ApiResponse<OauthProviderSettings[]>>(`${API_BASE}/settings/oauth`),
    updateOauthSettings: (provider: string, input: OauthProviderUpdateInput) => mutate<ApiResponse<OauthProviderSettings>>(
        `/settings/oauth/${encodeURIComponent(provider)}`,
        { method: 'PUT', body: JSON.stringify(input) },
    ),
    terminalConfig: () => apiFetch<ApiResponse<TerminalConfig>>(`${API_BASE}/terminal/config`),
    createTerminalSession: (serverUuid: string) => mutate<ApiResponse<{ server_uuid: string; command: string }>>(
        '/terminal/session',
        {
            method: 'POST',
            body: JSON.stringify({ server_uuid: serverUuid }),
        },
    ),
    notifications: () => apiFetch<ApiResponse<NotificationChannel[]>>(`${API_BASE}/notifications`),
    updateNotificationChannel: (channel: string, input: NotificationChannelUpdateInput) => mutate<ApiResponse<NotificationChannel>>(
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
    createSecurityKey: (input: SecurityKeyInput) => mutate<ApiResponse<SecurityKey>>(
        '/security/keys',
        {
            method: 'POST',
            body: JSON.stringify(input),
        },
    ),
    updateSecurityKey: (keyUuid: string, input: Partial<SecurityKeyInput>) => mutate<ApiResponse<SecurityKey>>(
        `/security/keys/${encodeURIComponent(keyUuid)}`,
        {
            method: 'PUT',
            body: JSON.stringify(input),
        },
    ),
    deleteSecurityKey: (keyUuid: string) => mutate<{ message: string }>(
        `/security/keys/${encodeURIComponent(keyUuid)}`,
        { method: 'DELETE' },
    ),
    generateSecurityKey: (type: 'ed25519' | 'rsa' = 'ed25519') => mutate<ApiResponse<SecurityKeyGenerateResult>>(
        '/security/keys/generate',
        {
            method: 'POST',
            body: JSON.stringify({ type }),
        },
    ),
    apiTokens: () => apiFetch<ApiResponse<ApiToken[]> & { meta: ApiTokenMeta }>(
        `${API_BASE}/security/api-tokens`,
    ),
    createApiToken: (input: ApiTokenInput) => mutate<ApiResponse<ApiToken>>(
        '/security/api-tokens',
        {
            method: 'POST',
            body: JSON.stringify(input),
        },
    ),
    deleteApiToken: (tokenId: number) => mutate<{ message: string }>(
        `/security/api-tokens/${tokenId}`,
        { method: 'DELETE' },
    ),
    cloudTokens: () => apiFetch<ApiResponse<CloudProviderTokenSummary[]>>(
        `${API_BASE}/security/cloud-tokens`,
    ),
    createCloudToken: (input: CloudProviderTokenInput) => mutate<ApiResponse<CloudProviderTokenSummary>>(
        '/security/cloud-tokens',
        {
            method: 'POST',
            body: JSON.stringify(input),
        },
    ),
    updateCloudToken: (tokenUuid: string, input: { name: string }) => mutate<ApiResponse<CloudProviderTokenSummary>>(
        `/security/cloud-tokens/${encodeURIComponent(tokenUuid)}`,
        {
            method: 'PUT',
            body: JSON.stringify(input),
        },
    ),
    deleteCloudToken: (tokenUuid: string) => mutate<{ message: string }>(
        `/security/cloud-tokens/${encodeURIComponent(tokenUuid)}`,
        { method: 'DELETE' },
    ),
    validateCloudToken: (tokenUuid: string) => mutate<ApiResponse<CloudProviderTokenValidation>>(
        `/security/cloud-tokens/${encodeURIComponent(tokenUuid)}/validate`,
        { method: 'POST' },
    ),
    cloudInitScripts: () => apiFetch<ApiResponse<CloudInitScript[]>>(
        `${API_BASE}/security/cloud-init-scripts`,
    ),
    createCloudInitScript: (input: CloudInitScriptInput) => mutate<ApiResponse<CloudInitScript>>(
        '/security/cloud-init-scripts',
        {
            method: 'POST',
            body: JSON.stringify(input),
        },
    ),
    updateCloudInitScript: (scriptId: number, input: CloudInitScriptInput) => mutate<ApiResponse<CloudInitScript>>(
        `/security/cloud-init-scripts/${scriptId}`,
        {
            method: 'PUT',
            body: JSON.stringify(input),
        },
    ),
    deleteCloudInitScript: (scriptId: number) => mutate<{ message: string }>(
        `/security/cloud-init-scripts/${scriptId}`,
        { method: 'DELETE' },
    ),

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
    completeOnboarding: () => mutate<ApiResponse<BootstrapData> & { message?: string }>(
        '/onboarding/complete',
        { method: 'POST' },
    ),
    restartOnboarding: () => mutate<ApiResponse<BootstrapData> & { message?: string }>(
        '/onboarding/restart',
        { method: 'POST' },
    ),
    githubApps: () => apiFetch<ApiResponse<GithubAppSummary[]>>(`${API_BASE}/github/apps`),
    startGithubApp: (input: {
        name?: string;
        organization?: string;
        preview_deployments?: boolean;
        administration?: boolean;
        from_onboarding?: boolean;
        return_to?: 'applications' | 'onboarding';
    } = {}) => mutate<ApiResponse<GithubAppSetupResult>>('/github/apps', {
        method: 'POST',
        body: JSON.stringify(input),
    }),
    githubAppInstallUrl: (githubAppUuid: string, returnTo?: 'applications' | 'onboarding') => apiFetch<ApiResponse<{ url: string }>>(
        `${API_BASE}/github/apps/${encodeURIComponent(githubAppUuid)}/install-url${returnTo ? `?return_to=${encodeURIComponent(returnTo)}` : ''}`,
    ),
    updateGithubPackagesToken: (githubAppUuid: string, packagesToken: string | null) => mutate<ApiResponse<{
        uuid: string;
        name: string;
        has_packages_token: boolean;
    }> & { message?: string }>(
        `/github/apps/${encodeURIComponent(githubAppUuid)}/packages-token`,
        {
            method: 'PUT',
            body: JSON.stringify({ packages_token: packagesToken }),
        },
    ),
    githubRepositories: (githubAppUuid: string) => apiFetch<ApiResponse<GithubRepository[]>>(`${API_BASE}/github/apps/${encodeURIComponent(githubAppUuid)}/repositories`),
    githubBranches: (githubAppUuid: string, owner: string, repo: string) => apiFetch<ApiResponse<GithubBranch[]>>(`${API_BASE}/github/apps/${encodeURIComponent(githubAppUuid)}/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`),
    createGithubRunner: (input: GithubRunnerCreateInput) => mutate<ApiResponse<GithubRunner> & { message?: string }>(
        '/github/runners',
        {
            method: 'POST',
            body: JSON.stringify(input),
        },
        180_000,
    ),
    deleteGithubRunner: (serverUuid: string, containerName: string) => mutate<ApiResponse<{ ok: boolean; container: string }> & { message?: string }>(
        `/github/runners/${encodeURIComponent(serverUuid)}/${encodeURIComponent(containerName)}`,
        { method: 'DELETE' },
        45_000,
    ),
    attachGithubRunnerApplication: (
        serverUuid: string,
        containerName: string,
        input: { application_uuid: string; role?: string | null },
    ) => mutate<ApiResponse<GithubRunnerLinkedApplication> & { message?: string }>(
        `/github/runners/${encodeURIComponent(serverUuid)}/${encodeURIComponent(containerName)}/applications`,
        {
            method: 'POST',
            body: JSON.stringify(input),
        },
    ),
    detachGithubRunnerApplication: (serverUuid: string, containerName: string, applicationUuid: string) => mutate<ApiResponse<{ ok: boolean }> & { message?: string }>(
        `/github/runners/${encodeURIComponent(serverUuid)}/${encodeURIComponent(containerName)}/applications/${encodeURIComponent(applicationUuid)}`,
        { method: 'DELETE' },
    ),
    githubRunner: (serverUuid: string, containerName: string) => apiFetch<ApiResponse<GithubRunner>>(
        `${API_BASE}/github/runners/${encodeURIComponent(serverUuid)}/${encodeURIComponent(containerName)}`,
        {},
        45_000,
    ),
    githubRunnerLogs: (serverUuid: string, containerName: string, lines = 200) => apiFetch<ApiResponse<GithubRunnerLogs>>(
        `${API_BASE}/github/runners/${encodeURIComponent(serverUuid)}/${encodeURIComponent(containerName)}/logs?lines=${lines}`,
        {},
        45_000,
    ),
    githubRunnerAction: (serverUuid: string, containerName: string, action: GithubRunnerAction) => mutate<ApiResponse<GithubRunnerActionResult> & { message?: string }>(
        `/github/runners/${encodeURIComponent(serverUuid)}/${encodeURIComponent(containerName)}/${action}`,
        { method: 'POST' },
        action === 'recreate' ? 180_000 : 45_000,
    ),
    githubRunners: () => apiFetch<ApiResponse<GithubRunner[]>>(`${API_BASE}/github/runners`, {}, 45_000),
    createApplication: (input: CreateApplicationInput) => mutate<ApiResponse<CoreResource>>('/applications', {
        method: 'POST',
        body: JSON.stringify(input),
    }, 90_000),
    deleteApplication: (
        applicationUuid: string,
        input: {
            delete_volumes?: boolean;
            delete_connected_networks?: boolean;
            delete_configurations?: boolean;
            docker_cleanup?: boolean;
        } = {},
    ) => mutate<ApiResponse<{ queued: boolean; message: string }>>(
        `/applications/${encodeURIComponent(applicationUuid)}`,
        {
            method: 'DELETE',
            body: JSON.stringify(input),
        },
    ),
    applicationDomains: (applicationUuid: string) => apiFetch<ApiResponse<ApplicationDomains>>(
        `${API_BASE}/applications/${encodeURIComponent(applicationUuid)}/domains`,
    ),
    updateApplicationDomains: (
        applicationUuid: string,
        input: ApplicationDomainsUpdateInput,
    ) => mutate<ApiResponse<ApplicationDomains> & {
        meta?: {
            redeploy?: ApplicationDomainRedeploy | null;
        };
    }>(
        `/applications/${encodeURIComponent(applicationUuid)}/domains`,
        {
            method: 'PUT',
            body: JSON.stringify(input),
        },
    ),
    generateApplicationDomain: (
        applicationUuid: string,
        input: { redeploy?: boolean } = {},
    ) => mutate<ApiResponse<ApplicationDomains> & {
        meta?: {
            redeploy?: ApplicationDomainRedeploy | null;
        };
    }>(
        `/applications/${encodeURIComponent(applicationUuid)}/domains/generate`,
        {
            method: 'POST',
            body: JSON.stringify(input),
        },
    ),
    serverSettings: (serverUuid: string) => apiFetch<ApiResponse<ServerSettings>>(
        `${API_BASE}/servers/${encodeURIComponent(serverUuid)}/settings`,
    ),
    updateServerSettings: (
        serverUuid: string,
        input: ServerSettingsUpdateInput,
    ) => mutate<ApiResponse<ServerSettings>>(
        `/servers/${encodeURIComponent(serverUuid)}/settings`,
        {
            method: 'PUT',
            body: JSON.stringify(input),
        },
    ),
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
    resetApplicationDatabase: (
        applicationUuid: string,
        databaseUuid: string,
        redeploy = true,
    ) => mutate<ApiResponse<{
        database_uuid: string;
        database_name: string;
        reset: boolean;
        restarted: boolean;
        message: string;
        redeploy: {
            queued: boolean;
            deployment_uuid: string | null;
            message: string;
        } | null;
    }>>(
        `/applications/${encodeURIComponent(applicationUuid)}/databases/${encodeURIComponent(databaseUuid)}/reset`,
        {
            method: 'POST',
            body: JSON.stringify({ redeploy }),
        },
    ),
    applicationLogs: (applicationUuid: string, lines = 200) => apiFetch<ApiResponse<ApplicationLogs>>(
        `${API_BASE}/applications/${encodeURIComponent(applicationUuid)}/logs?lines=${lines}`,
    ),
    applicationWebhooks: (applicationUuid: string) => apiFetch<ApiResponse<ApplicationWebhooks>>(
        `${API_BASE}/applications/${encodeURIComponent(applicationUuid)}/webhooks`,
    ),
    updateApplicationWebhooks: (
        applicationUuid: string,
        input: Partial<{
            manual_webhook_secret_github: string | null;
            manual_webhook_secret_gitlab: string | null;
            manual_webhook_secret_bitbucket: string | null;
            manual_webhook_secret_gitea: string | null;
        }>,
    ) => mutate<ApiResponse<ApplicationWebhooks>>(
        `/applications/${encodeURIComponent(applicationUuid)}/webhooks`,
        {
            method: 'PUT',
            body: JSON.stringify(input),
        },
    ),
    applicationPreviews: (applicationUuid: string) => apiFetch<ApiResponse<ApplicationPreview[]>>(
        `${API_BASE}/applications/${encodeURIComponent(applicationUuid)}/previews`,
    ),
    applicationPreviewSettings: (applicationUuid: string) => apiFetch<ApiResponse<ApplicationPreviewSettings>>(
        `${API_BASE}/applications/${encodeURIComponent(applicationUuid)}/previews/settings`,
    ),
    updateApplicationPreviewSettings: (
        applicationUuid: string,
        input: Partial<ApplicationPreviewSettings>,
    ) => mutate<ApiResponse<ApplicationPreviewSettings>>(
        `/applications/${encodeURIComponent(applicationUuid)}/previews/settings`,
        {
            method: 'PUT',
            body: JSON.stringify(input),
        },
    ),
    deleteApplicationPreview: (applicationUuid: string, pullRequestId: number) => mutate<{
        message: string;
        pull_request_id: number;
    }>(
        `/applications/${encodeURIComponent(applicationUuid)}/previews/${encodeURIComponent(String(pullRequestId))}`,
        { method: 'DELETE' },
    ),
    applicationStorages: (applicationUuid: string) => apiFetch<ApiResponse<ApplicationStoragesPayload>>(
        `${API_BASE}/applications/${encodeURIComponent(applicationUuid)}/storages`,
    ),
    createApplicationStorage: (
        applicationUuid: string,
        input: ApplicationStorageInput,
    ) => mutate<ApiResponse<ApplicationStorage>>(
        `/applications/${encodeURIComponent(applicationUuid)}/storages`,
        {
            method: 'POST',
            body: JSON.stringify(input),
        },
    ),
    updateApplicationStorage: (
        applicationUuid: string,
        storageUuid: string,
        input: ApplicationStorageUpdateInput,
    ) => mutate<ApiResponse<ApplicationStorage>>(
        `/applications/${encodeURIComponent(applicationUuid)}/storages/${encodeURIComponent(storageUuid)}`,
        {
            method: 'PUT',
            body: JSON.stringify(input),
        },
    ),
    deleteApplicationStorage: (applicationUuid: string, storageUuid: string) => mutate<{ message: string }>(
        `/applications/${encodeURIComponent(applicationUuid)}/storages/${encodeURIComponent(storageUuid)}`,
        { method: 'DELETE' },
    ),
    resourceStorages: (
        resourceType: 'applications' | 'databases',
        resourceUuid: string,
    ) => apiFetch<ApiResponse<ApplicationStoragesPayload>>(
        `${API_BASE}/${resourceType}/${encodeURIComponent(resourceUuid)}/storages`,
    ),
    serviceStorages: (serviceUuid: string) => apiFetch<ApiResponse<ServiceStoragesPayload>>(
        `${API_BASE}/services/${encodeURIComponent(serviceUuid)}/storages`,
    ),
    serviceSettings: (serviceUuid: string) => apiFetch<ApiResponse<ServiceSettings>>(
        `${API_BASE}/services/${encodeURIComponent(serviceUuid)}/settings`,
    ),
    updateServiceSettings: (
        serviceUuid: string,
        input: Partial<Omit<ServiceSettings, 'message'>>,
    ) => mutate<ApiResponse<ServiceSettings>>(
        `/services/${encodeURIComponent(serviceUuid)}/settings`,
        {
            method: 'PUT',
            body: JSON.stringify(input),
        },
    ),
    createResourceStorage: (
        resourceType: 'applications' | 'databases',
        resourceUuid: string,
        input: ApplicationStorageInput,
    ) => mutate<ApiResponse<ApplicationStorage>>(
        `/${resourceType}/${encodeURIComponent(resourceUuid)}/storages`,
        {
            method: 'POST',
            body: JSON.stringify(input),
        },
    ),
    updateResourceStorage: (
        resourceType: 'applications' | 'databases',
        resourceUuid: string,
        storageUuid: string,
        input: ApplicationStorageUpdateInput,
    ) => mutate<ApiResponse<ApplicationStorage>>(
        `/${resourceType}/${encodeURIComponent(resourceUuid)}/storages/${encodeURIComponent(storageUuid)}`,
        {
            method: 'PUT',
            body: JSON.stringify(input),
        },
    ),
    deleteResourceStorage: (
        resourceType: 'applications' | 'databases',
        resourceUuid: string,
        storageUuid: string,
    ) => mutate<{ message: string }>(
        `/${resourceType}/${encodeURIComponent(resourceUuid)}/storages/${encodeURIComponent(storageUuid)}`,
        { method: 'DELETE' },
    ),
    databaseHealthcheck: (databaseUuid: string) => apiFetch<ApiResponse<DatabaseHealthcheckSettings>>(
        `${API_BASE}/databases/${encodeURIComponent(databaseUuid)}/healthcheck`,
    ),
    updateDatabaseHealthcheck: (
        databaseUuid: string,
        input: Partial<Omit<DatabaseHealthcheckSettings, 'probe_label' | 'restart_required' | 'message'>>,
    ) => mutate<ApiResponse<DatabaseHealthcheckSettings>>(
        `/databases/${encodeURIComponent(databaseUuid)}/healthcheck`,
        {
            method: 'PUT',
            body: JSON.stringify(input),
        },
    ),
    applicationResourceLimits: (applicationUuid: string) => apiFetch<ApiResponse<ApplicationResourceLimits>>(
        `${API_BASE}/applications/${encodeURIComponent(applicationUuid)}/resource-limits`,
    ),
    updateApplicationResourceLimits: (
        applicationUuid: string,
        input: Partial<Omit<ApplicationResourceLimits, 'message'>>,
    ) => mutate<ApiResponse<ApplicationResourceLimits>>(
        `/applications/${encodeURIComponent(applicationUuid)}/resource-limits`,
        {
            method: 'PUT',
            body: JSON.stringify(input),
        },
    ),
    applicationAdvancedSettings: (applicationUuid: string) => apiFetch<ApiResponse<ApplicationAdvancedSettings>>(
        `${API_BASE}/applications/${encodeURIComponent(applicationUuid)}/advanced`,
    ),
    updateApplicationAdvancedSettings: (
        applicationUuid: string,
        input: Partial<Omit<ApplicationAdvancedSettings, 'capabilities' | 'message'>>,
    ) => mutate<ApiResponse<ApplicationAdvancedSettings>>(
        `/applications/${encodeURIComponent(applicationUuid)}/advanced`,
        {
            method: 'PUT',
            body: JSON.stringify(input),
        },
    ),
    applicationResourceOperations: (applicationUuid: string) => apiFetch<ApiResponse<ApplicationResourceOperations>>(
        `${API_BASE}/applications/${encodeURIComponent(applicationUuid)}/resource-operations`,
    ),
    cloneApplication: (
        applicationUuid: string,
        input: { destination_uuid: string; clone_volume_data?: boolean },
    ) => mutate<ApiResponse<ApplicationResourceOperationResult>>(
        `/applications/${encodeURIComponent(applicationUuid)}/clone`,
        {
            method: 'POST',
            body: JSON.stringify(input),
        },
    ),
    moveApplication: (
        applicationUuid: string,
        input: { environment_uuid: string },
    ) => mutate<ApiResponse<ApplicationResourceOperationResult>>(
        `/applications/${encodeURIComponent(applicationUuid)}/move`,
        {
            method: 'PUT',
            body: JSON.stringify(input),
        },
    ),
    resourceScheduledTasks: (
        resourceType: 'applications' | 'services',
        resourceUuid: string,
    ) => apiFetch<ApiResponse<ApplicationScheduledTask[]>>(
        `${API_BASE}/${resourceType}/${encodeURIComponent(resourceUuid)}/scheduled-tasks`,
    ),
    createResourceScheduledTask: (
        resourceType: 'applications' | 'services',
        resourceUuid: string,
        input: ApplicationScheduledTaskInput,
    ) => mutate<ApiResponse<ApplicationScheduledTask>>(
        `/${resourceType}/${encodeURIComponent(resourceUuid)}/scheduled-tasks`,
        {
            method: 'POST',
            body: JSON.stringify(input),
        },
    ),
    updateResourceScheduledTask: (
        resourceType: 'applications' | 'services',
        resourceUuid: string,
        taskUuid: string,
        input: ApplicationScheduledTaskInput,
    ) => mutate<ApiResponse<ApplicationScheduledTask>>(
        `/${resourceType}/${encodeURIComponent(resourceUuid)}/scheduled-tasks/${encodeURIComponent(taskUuid)}`,
        {
            method: 'PUT',
            body: JSON.stringify(input),
        },
    ),
    deleteResourceScheduledTask: (
        resourceType: 'applications' | 'services',
        resourceUuid: string,
        taskUuid: string,
    ) => mutate<{ message: string }>(
        `/${resourceType}/${encodeURIComponent(resourceUuid)}/scheduled-tasks/${encodeURIComponent(taskUuid)}`,
        { method: 'DELETE' },
    ),
    resourceScheduledTaskExecutions: (
        resourceType: 'applications' | 'services',
        resourceUuid: string,
        taskUuid: string,
        limit = 20,
    ) => apiFetch<ApiResponse<ApplicationScheduledTaskExecution[]>>(
        `${API_BASE}/${resourceType}/${encodeURIComponent(resourceUuid)}/scheduled-tasks/${encodeURIComponent(taskUuid)}/executions?limit=${limit}`,
    ),
    runResourceScheduledTask: (
        resourceType: 'applications' | 'services',
        resourceUuid: string,
        taskUuid: string,
    ) => mutate<ApiResponse<{
        queued: boolean;
        task_uuid: string;
        message: string;
    }>>(
        `/${resourceType}/${encodeURIComponent(resourceUuid)}/scheduled-tasks/${encodeURIComponent(taskUuid)}/run`,
        { method: 'POST', body: JSON.stringify({}) },
    ),
    applicationScheduledTasks: (applicationUuid: string) => apiFetch<ApiResponse<ApplicationScheduledTask[]>>(
        `${API_BASE}/applications/${encodeURIComponent(applicationUuid)}/scheduled-tasks`,
    ),
    createApplicationScheduledTask: (
        applicationUuid: string,
        input: ApplicationScheduledTaskInput,
    ) => mutate<ApiResponse<ApplicationScheduledTask>>(
        `/applications/${encodeURIComponent(applicationUuid)}/scheduled-tasks`,
        {
            method: 'POST',
            body: JSON.stringify(input),
        },
    ),
    updateApplicationScheduledTask: (
        applicationUuid: string,
        taskUuid: string,
        input: ApplicationScheduledTaskInput,
    ) => mutate<ApiResponse<ApplicationScheduledTask>>(
        `/applications/${encodeURIComponent(applicationUuid)}/scheduled-tasks/${encodeURIComponent(taskUuid)}`,
        {
            method: 'PUT',
            body: JSON.stringify(input),
        },
    ),
    deleteApplicationScheduledTask: (applicationUuid: string, taskUuid: string) => mutate<{ message: string }>(
        `/applications/${encodeURIComponent(applicationUuid)}/scheduled-tasks/${encodeURIComponent(taskUuid)}`,
        { method: 'DELETE' },
    ),
    applicationScheduledTaskExecutions: (
        applicationUuid: string,
        taskUuid: string,
        limit = 20,
    ) => apiFetch<ApiResponse<ApplicationScheduledTaskExecution[]>>(
        `${API_BASE}/applications/${encodeURIComponent(applicationUuid)}/scheduled-tasks/${encodeURIComponent(taskUuid)}/executions?limit=${limit}`,
    ),
    runApplicationScheduledTask: (applicationUuid: string, taskUuid: string) => mutate<ApiResponse<{
        queued: boolean;
        task_uuid: string;
        message: string;
    }>>(
        `/applications/${encodeURIComponent(applicationUuid)}/scheduled-tasks/${encodeURIComponent(taskUuid)}/run`,
        { method: 'POST', body: JSON.stringify({}) },
    ),
    databaseLogs: (databaseUuid: string, lines = 200) => apiFetch<ApiResponse<DatabaseLogs>>(
        `${API_BASE}/databases/${encodeURIComponent(databaseUuid)}/logs?lines=${lines}`,
    ),
    resourceWebhooks: (resourceType: 'databases' | 'services', resourceUuid: string) => apiFetch<ApiResponse<{
        deploy_webhook_url: string;
    }>>(
        `${API_BASE}/${resourceType}/${encodeURIComponent(resourceUuid)}/webhooks`,
    ),
    resourceEnvironmentVariables: (
        resourceType: 'databases' | 'services',
        resourceUuid: string,
    ) => apiFetch<ApiResponse<ApplicationEnvironmentVariable[]>>(
        `${API_BASE}/${resourceType}/${encodeURIComponent(resourceUuid)}/environment-variables`,
    ),
    createResourceEnvironmentVariable: (
        resourceType: 'databases' | 'services',
        resourceUuid: string,
        input: ApplicationEnvironmentVariableInput,
    ) => mutate<ApiResponse<ApplicationEnvironmentVariable>>(
        `/${resourceType}/${encodeURIComponent(resourceUuid)}/environment-variables`,
        {
            method: 'POST',
            body: JSON.stringify(input),
        },
    ),
    updateResourceEnvironmentVariable: (
        resourceType: 'databases' | 'services',
        resourceUuid: string,
        envUuid: string,
        input: ApplicationEnvironmentVariableUpdateInput,
    ) => mutate<ApiResponse<ApplicationEnvironmentVariable>>(
        `/${resourceType}/${encodeURIComponent(resourceUuid)}/environment-variables/${encodeURIComponent(envUuid)}`,
        {
            method: 'PUT',
            body: JSON.stringify(input),
        },
    ),
    deleteResourceEnvironmentVariable: (
        resourceType: 'databases' | 'services',
        resourceUuid: string,
        envUuid: string,
    ) => mutate<{ message: string }>(
        `/${resourceType}/${encodeURIComponent(resourceUuid)}/environment-variables/${encodeURIComponent(envUuid)}`,
        { method: 'DELETE' },
    ),
    revealResourceEnvironmentVariable: (
        resourceType: 'databases' | 'services',
        resourceUuid: string,
        envUuid: string,
    ) => apiFetch<ApiResponse<{
        uuid: string;
        value: string | null;
    }>>(
        `${API_BASE}/${resourceType}/${encodeURIComponent(resourceUuid)}/environment-variables/${encodeURIComponent(envUuid)}/reveal`,
    ),
    databaseWebhooks: (databaseUuid: string) => apiFetch<ApiResponse<{ deploy_webhook_url: string }>>(
        `${API_BASE}/databases/${encodeURIComponent(databaseUuid)}/webhooks`,
    ),
    databaseEnvironmentVariables: (databaseUuid: string) => apiFetch<ApiResponse<ApplicationEnvironmentVariable[]>>(
        `${API_BASE}/databases/${encodeURIComponent(databaseUuid)}/environment-variables`,
    ),
    createDatabaseEnvironmentVariable: (
        databaseUuid: string,
        input: ApplicationEnvironmentVariableInput,
    ) => mutate<ApiResponse<ApplicationEnvironmentVariable>>(
        `/databases/${encodeURIComponent(databaseUuid)}/environment-variables`,
        {
            method: 'POST',
            body: JSON.stringify(input),
        },
    ),
    updateDatabaseEnvironmentVariable: (
        databaseUuid: string,
        envUuid: string,
        input: ApplicationEnvironmentVariableUpdateInput,
    ) => mutate<ApiResponse<ApplicationEnvironmentVariable>>(
        `/databases/${encodeURIComponent(databaseUuid)}/environment-variables/${encodeURIComponent(envUuid)}`,
        {
            method: 'PUT',
            body: JSON.stringify(input),
        },
    ),
    deleteDatabaseEnvironmentVariable: (databaseUuid: string, envUuid: string) => mutate<{ message: string }>(
        `/databases/${encodeURIComponent(databaseUuid)}/environment-variables/${encodeURIComponent(envUuid)}`,
        { method: 'DELETE' },
    ),
    revealDatabaseEnvironmentVariable: (databaseUuid: string, envUuid: string) => apiFetch<ApiResponse<{
        uuid: string;
        value: string | null;
    }>>(
        `${API_BASE}/databases/${encodeURIComponent(databaseUuid)}/environment-variables/${encodeURIComponent(envUuid)}/reveal`,
    ),
    applicationSourceInfo: (applicationUuid: string) => apiFetch<ApiResponse<ApplicationSourceInfo>>(
        `${API_BASE}/applications/${encodeURIComponent(applicationUuid)}/source`,
    ),
    applicationGitSync: (applicationUuid: string) => apiFetch<ApiResponse<ApplicationGitSyncStatus>>(
        `${API_BASE}/applications/${encodeURIComponent(applicationUuid)}/git-sync`,
    ),
    updateApplicationGitBranch: (applicationUuid: string, gitBranch: string) => mutate<ApiResponse<{
        ok: boolean;
        unchanged: boolean;
        application_uuid: string;
        git_branch: string;
        previous_git_branch: string;
        application: CoreResource;
    }>>(
        `/applications/${encodeURIComponent(applicationUuid)}/git-branch`,
        {
            method: 'PUT',
            body: JSON.stringify({ git_branch: gitBranch }),
        },
    ),
    listApplicationSourceDirectory: (applicationUuid: string, path?: string) => apiFetch<ApiResponse<ApplicationSourceListing>>(
        `${API_BASE}/applications/${encodeURIComponent(applicationUuid)}/source/list${path ? `?path=${encodeURIComponent(path)}` : ''}`,
    ),
    readApplicationSourceFile: (applicationUuid: string, path: string) => apiFetch<ApiResponse<ApplicationSourceFile>>(
        `${API_BASE}/applications/${encodeURIComponent(applicationUuid)}/source/read?path=${encodeURIComponent(path)}`,
    ),
    writeApplicationSourceFile: (
        applicationUuid: string,
        input: {
            path: string;
            content: string;
            commit_message: string;
            sha?: string | null;
            mode?: 'direct' | 'pull_request';
            redeploy?: boolean;
            branch_name?: string;
            pr_title?: string;
            pr_body?: string;
        },
    ) => mutate<ApiResponse<ApplicationSourceWriteResult>>(
        `/applications/${encodeURIComponent(applicationUuid)}/source/write`,
        {
            method: 'PUT',
            body: JSON.stringify(input),
        },
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
    importApplicationEnvironmentVariables: (
        applicationUuid: string,
        input: ApplicationEnvironmentVariableImportInput,
    ) => mutate<ApiResponse<ApplicationEnvironmentVariableImportResult>>(
        `/applications/${encodeURIComponent(applicationUuid)}/environment-variables/import`,
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
    updateApplication: (applicationUuid: string, input: { name: string }) => mutate<ApiResponse<CoreResource>>(
        `/applications/${encodeURIComponent(applicationUuid)}`,
        {
            method: 'PATCH',
            body: JSON.stringify(input),
        },
    ),
    revealApplicationEnvironmentVariable: (applicationUuid: string, envUuid: string) => apiFetch<ApiResponse<{
        uuid: string;
        value: string | null;
    }>>(
        `${API_BASE}/applications/${encodeURIComponent(applicationUuid)}/environment-variables/${encodeURIComponent(envUuid)}/reveal`,
    ),
    applicationRuntimeSettings: (applicationUuid: string) => apiFetch<ApiResponse<ApplicationRuntimeSettings>>(
        `${API_BASE}/applications/${encodeURIComponent(applicationUuid)}/runtime-settings`,
    ),
    detectApplicationRuntimeSettings: (applicationUuid: string) => mutate<ApiResponse<ApplicationRuntimeSettingsDetection>>(
        `/applications/${encodeURIComponent(applicationUuid)}/runtime-settings/detect`,
        { method: 'POST', body: '{}' },
    ),
    updateApplicationRuntimeSettings: (
        applicationUuid: string,
        input: ApplicationRuntimeSettingsUpdateInput & { redeploy?: boolean },
    ) => mutate<ApiResponse<ApplicationRuntimeSettings> & {
        meta?: {
            redeploy?: {
                queued: boolean;
                deployment_uuid: string | null;
                message: string;
            } | null;
        };
    }>(
        `/applications/${encodeURIComponent(applicationUuid)}/runtime-settings`,
        {
            method: 'PUT',
            body: JSON.stringify(input),
        },
    ),
    applicationReadiness: (applicationUuid: string) => apiFetch<ApiResponse<ApplicationReadiness>>(
        `${API_BASE}/applications/${encodeURIComponent(applicationUuid)}/readiness`,
    ),
    updateApplicationReadiness: (
        applicationUuid: string,
        input: { autonomous_enabled: boolean },
    ) => mutate<ApiResponse<ApplicationReadiness>>(
        `/applications/${encodeURIComponent(applicationUuid)}/readiness`,
        {
            method: 'PATCH',
            body: JSON.stringify(input),
        },
    ),
    probeApplicationReadiness: (applicationUuid: string) => mutate<ApiResponse<ApplicationReadiness> & {
        meta?: {
            probe_ok?: boolean;
            probe_url?: string | null;
            probe_status?: number | null;
            probe_error?: string | null;
        };
    }>(
        `/applications/${encodeURIComponent(applicationUuid)}/readiness/probe`,
        { method: 'POST' },
    ),
    acknowledgeApplicationReadinessIntervention: (
        applicationUuid: string,
        interventionUuid: string,
    ) => mutate<ApiResponse<ApplicationReadiness>>(
        `/applications/${encodeURIComponent(applicationUuid)}/readiness/interventions/${encodeURIComponent(interventionUuid)}/done`,
        { method: 'POST' },
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
    serverStorageOverview: (refreshDisk = false) => apiFetch<ApiResponse<ServerStorageSummary[]> & { meta: ServerStorageMeta }>(
        `${API_BASE}/server-storage${refreshDisk ? '?refresh_disk=1' : '?refresh_disk=0'}`,
        {},
        refreshDisk ? STORAGE_API_TIMEOUT_MS : 20_000,
    ),
    serverStorage: (
        serverUuid: string,
        refreshDisk = false,
        dockerReport = false,
    ) => {
        const params = new URLSearchParams();
        if (refreshDisk) {
            params.set('refresh_disk', '1');
        }
        if (dockerReport) {
            params.set('docker_report', '1');
        }
        const query = params.toString();

        return apiFetch<ApiResponse<ServerStorageSummary> & { meta: ServerStorageMeta }>(
            `${API_BASE}/server-storage/${encodeURIComponent(serverUuid)}${query ? `?${query}` : ''}`,
            {},
            dockerReport || refreshDisk ? STORAGE_API_TIMEOUT_MS : 30_000,
        );
    },
    refreshServerDiskUsage: (serverUuid: string) => mutate<ApiResponse<{ disk_usage_percent: number | null; disk_partitions?: Record<string, number> | null }>>(
        `/server-storage/${encodeURIComponent(serverUuid)}/disk`,
        { method: 'POST', body: JSON.stringify({}) },
        STORAGE_API_TIMEOUT_MS,
    ),
    serverStorageDiskBreakdown: (serverUuid: string) => apiFetch<ApiResponse<{ report: string | null }>>(
        `${API_BASE}/server-storage/${encodeURIComponent(serverUuid)}/disk-breakdown`,
        {},
        STORAGE_API_TIMEOUT_MS,
    ),
    updateServerStorage: (serverUuid: string, input: Partial<ServerStorageCleanupSettings & ServerStorageMonitoringSettings>) => mutate<ApiResponse<ServerStorageSummary> & { meta: ServerStorageMeta }>(
        `/server-storage/${encodeURIComponent(serverUuid)}`,
        { method: 'PUT', body: JSON.stringify(input) },
    ),
    runServerStorageCleanup: (
        serverUuid: string,
        input?: {
            delete_unused_volumes?: boolean;
            delete_unused_networks?: boolean;
            force_docker_cleanup?: boolean;
            disable_application_image_retention?: boolean;
            aggressive?: boolean;
        },
    ) => mutate<ApiResponse<{ queued: boolean; execution_id: number; aggressive?: boolean; message: string }>>(
        `/server-storage/${encodeURIComponent(serverUuid)}/cleanup`,
        { method: 'POST', body: JSON.stringify(input ?? {}) },
    ),
    serverFilesystemMeta: () => apiFetch<{ meta: ServerFilesystemMeta }>(`${API_BASE}/server-files/meta`),
    listServerDirectory: (serverUuid: string, path?: string) => apiFetch<ApiResponse<ServerFilesystemListing> & { meta: ServerFilesystemMeta }>(
        `${API_BASE}/server-files/${encodeURIComponent(serverUuid)}/list${path ? `?path=${encodeURIComponent(path)}` : ''}`,
    ),
    readServerFile: (serverUuid: string, path: string) => apiFetch<ApiResponse<ServerFilesystemFile> & { meta: ServerFilesystemMeta }>(
        `${API_BASE}/server-files/${encodeURIComponent(serverUuid)}/read?path=${encodeURIComponent(path)}`,
    ),
    writeServerFile: (serverUuid: string, path: string, content: string) => mutate<ApiResponse<{ path: string; bytes_written: number; message: string }> & { meta: ServerFilesystemMeta }>(
        `/server-files/${encodeURIComponent(serverUuid)}`,
        { method: 'PUT', body: JSON.stringify({ path, content }) },
    ),
    searchServerFiles: (
        serverUuid: string,
        input: { pattern: string; mode?: 'name' | 'content'; path?: string },
    ) => {
        const params = new URLSearchParams({ pattern: input.pattern });
        if (input.mode) {
            params.set('mode', input.mode);
        }
        if (input.path) {
            params.set('path', input.path);
        }

        return apiFetch<ApiResponse<ServerFilesystemSearch> & { meta: ServerFilesystemMeta }>(
            `${API_BASE}/server-files/${encodeURIComponent(serverUuid)}/search?${params.toString()}`,
        );
    },
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
    sendAgentMessage: (
        uuid: string,
        content: string,
        sessionUuid?: string,
        options?: { application_uuid?: string },
    ) => mutate<ApiResponse<{ user: AgentChatMessage; run_uuid: string; session_uuid: string; status: 'pending' }>>(`/agents/${encodeURIComponent(uuid)}/messages`, {
        method: 'POST',
        body: JSON.stringify({
            content,
            session_uuid: sessionUuid,
            ...(options?.application_uuid ? { application_uuid: options.application_uuid } : {}),
        }),
    }),
    agentSessions: (uuid: string) => apiFetch<ApiListResponse<AgentChatSession>>(`${API_BASE}/agents/${encodeURIComponent(uuid)}/sessions`),
    createAgentSession: (uuid: string, title?: string) => mutate<ApiResponse<AgentChatSession>>(`/agents/${encodeURIComponent(uuid)}/sessions`, {
        method: 'POST',
        body: JSON.stringify({ title }),
    }),
    activateAgentSession: (uuid: string, sessionUuid: string) => mutate<ApiResponse<AgentChatSession>>(`/agents/${encodeURIComponent(uuid)}/sessions/${encodeURIComponent(sessionUuid)}/activate`, {
        method: 'POST',
    }),
    updateAgentSession: (
        uuid: string,
        sessionUuid: string,
        payload: { title?: string; chat_mode?: 'plan' | 'build' | 'debug' } | string,
    ) => mutate<ApiResponse<AgentChatSession>>(`/agents/${encodeURIComponent(uuid)}/sessions/${encodeURIComponent(sessionUuid)}`, {
        method: 'PATCH',
        body: JSON.stringify(typeof payload === 'string' ? { title: payload } : payload),
    }),
    deleteAgentSession: (uuid: string, sessionUuid: string) => mutate<{
        ok: boolean;
        meta: {
            deleted_session_uuid: string;
            active_session_uuid: string | null;
            remaining_count: number;
        };
    }>(`/agents/${encodeURIComponent(uuid)}/sessions/${encodeURIComponent(sessionUuid)}`, {
        method: 'DELETE',
    }),
    agentSessionMessages: (uuid: string, sessionUuid: string) => apiFetch<ApiListResponse<AgentChatMessage>>(`${API_BASE}/agents/${encodeURIComponent(uuid)}/sessions/${encodeURIComponent(sessionUuid)}/messages`),
    sendAgentSessionMessage: (
        uuid: string,
        sessionUuid: string,
        content: string,
        options?: {
            application_uuid?: string;
            chat_mode?: 'plan' | 'build' | 'debug';
            attachments?: AgentChatAttachment[];
        },
    ) => mutate<ApiResponse<{ user: AgentChatMessage; run_uuid: string; session_uuid: string; status: 'pending' }>>(`/agents/${encodeURIComponent(uuid)}/sessions/${encodeURIComponent(sessionUuid)}/messages`, {
        method: 'POST',
        body: JSON.stringify({
            content,
            ...(options?.application_uuid ? { application_uuid: options.application_uuid } : {}),
            ...(options?.chat_mode ? { chat_mode: options.chat_mode } : {}),
            ...(options?.attachments?.length ? { attachments: options.attachments } : {}),
        }),
    }),
    resolveAgentToolApproval: (uuid: string, messageUuid: string, decision: 'approve' | 'deny') => mutate<ApiResponse<{
        user: AgentChatMessage;
        run_uuid: string;
        session_uuid: string | null;
        decision: 'approve' | 'deny';
        status: 'pending';
    }>>(`/agents/${encodeURIComponent(uuid)}/messages/${encodeURIComponent(messageUuid)}/approval`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
    }),
    agentMemories: (uuid: string, options?: { scope?: string; resource_uuid?: string; q?: string }) => {
        const params = new URLSearchParams();
        if (options?.scope) params.set('scope', options.scope);
        if (options?.resource_uuid) params.set('resource_uuid', options.resource_uuid);
        if (options?.q) params.set('q', options.q);
        const qs = params.toString();
        return apiFetch<ApiListResponse<AgentMemory>>(`${API_BASE}/agents/${encodeURIComponent(uuid)}/memories${qs ? `?${qs}` : ''}`);
    },
    createAgentMemory: (uuid: string, input: { content: string; scope?: string; resource_uuid?: string; tags?: string[] }) => mutate<ApiResponse<AgentMemory>>(`/agents/${encodeURIComponent(uuid)}/memories`, {
        method: 'POST',
        body: JSON.stringify(input),
    }),
    deleteAgentMemory: (uuid: string, memoryId: number) => mutate<{ data: { deleted: boolean } }>(`/agents/${encodeURIComponent(uuid)}/memories/${memoryId}`, {
        method: 'DELETE',
    }),
    clearAgentMemories: (uuid: string, scope: string) => mutate<{ data: { cleared: number; scope: string } }>(`/agents/${encodeURIComponent(uuid)}/memories/clear`, {
        method: 'POST',
        body: JSON.stringify({ scope }),
    }),
    resolveAgentRunApproval: (agentUuid: string, runUuid: string, decision: 'approve' | 'deny') => mutate<ApiResponse<{
        decision: 'approve' | 'deny';
        run: AgentRun;
        follow_up_run_uuid: string | null;
    }>>(`/agents/${encodeURIComponent(agentUuid)}/runs/${encodeURIComponent(runUuid)}/approval`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
    }),
    agentInstructions: (resourceUuid?: string) => {
        const qs = resourceUuid ? `?resource_uuid=${encodeURIComponent(resourceUuid)}` : '';
        return apiFetch<ApiResponse<{ org: string; personal: string; project: string }>>(`${API_BASE}/ai/instructions${qs}`);
    },
    updateAgentInstructions: (input: { org?: string; personal?: string; project?: string; resource_uuid?: string }) => mutate<ApiResponse<{ org: string; personal: string; project: string }>>('/ai/instructions', {
        method: 'PUT',
        body: JSON.stringify(input),
    }),
    agentStandingOrders: (options?: { resource_uuid?: string; agent_uuid?: string }) => {
        const params = new URLSearchParams();
        if (options?.resource_uuid) params.set('resource_uuid', options.resource_uuid);
        if (options?.agent_uuid) params.set('agent_uuid', options.agent_uuid);
        const qs = params.toString();
        return apiFetch<ApiListResponse<AgentStandingOrder>>(
            `${API_BASE}/ai/standing-orders${qs ? `?${qs}` : ''}`,
        );
    },
    createAgentStandingOrder: (input: {
        title: string;
        body: string;
        scope?: string;
        resource_uuid?: string;
        agent_uuid?: string;
        triggers?: string[];
        approval_gates?: string;
        escalation?: string;
        priority?: number;
        is_active?: boolean;
    }) => mutate<ApiResponse<AgentStandingOrder>>('/ai/standing-orders', {
        method: 'POST',
        body: JSON.stringify(input),
    }),
    updateAgentStandingOrder: (id: number, input: Partial<{
        title: string;
        body: string;
        scope: string;
        resource_uuid: string | null;
        triggers: string[];
        approval_gates: string | null;
        escalation: string | null;
        priority: number;
        is_active: boolean;
    }>) => mutate<ApiResponse<AgentStandingOrder>>(`/ai/standing-orders/${id}`, {
        method: 'PUT',
        body: JSON.stringify(input),
    }),
    deleteAgentStandingOrder: (id: number) => mutate<{ ok: boolean }>(`/ai/standing-orders/${id}`, {
        method: 'DELETE',
    }),
    agentSkills: (options?: { agent_uuid?: string; q?: string }) => {
        const params = new URLSearchParams();
        if (options?.agent_uuid) params.set('agent_uuid', options.agent_uuid);
        if (options?.q) params.set('q', options.q);
        const qs = params.toString();
        return apiFetch<ApiListResponse<AgentSkill>>(
            `${API_BASE}/ai/skills${qs ? `?${qs}` : ''}`,
        );
    },
    createAgentSkill: (input: {
        slug: string;
        name: string;
        description: string;
        body: string;
        tags?: string[];
        agent_uuid?: string;
        is_active?: boolean;
        priority?: number;
    }) => mutate<ApiResponse<AgentSkill>>('/ai/skills', {
        method: 'POST',
        body: JSON.stringify(input),
    }),
    updateAgentSkill: (id: number, input: Partial<{
        name: string;
        description: string;
        body: string;
        tags: string[];
        is_active: boolean;
        priority: number;
    }>) => mutate<ApiResponse<AgentSkill>>(`/ai/skills/${id}`, {
        method: 'PUT',
        body: JSON.stringify(input),
    }),
    deleteAgentSkill: (id: number) => mutate<{ ok: boolean }>(`/ai/skills/${id}`, {
        method: 'DELETE',
    }),
    agentMissions: (options?: { status?: string; kind?: string; q?: string; limit?: number }) => {
        const params = new URLSearchParams();
        if (options?.status) params.set('status', options.status);
        if (options?.kind) params.set('kind', options.kind);
        if (options?.q) params.set('q', options.q);
        if (options?.limit) params.set('limit', String(options.limit));
        const qs = params.toString();
        return apiFetch<ApiListResponse<AgentMission> & { meta?: { available?: boolean; kinds?: string[]; statuses?: string[] } }>(
            `${API_BASE}/ai/missions${qs ? `?${qs}` : ''}`,
        );
    },
    createAgentMission: (input: {
        title: string;
        description?: string;
        kind?: string;
        status?: string;
        priority?: string;
        resource_uuid?: string;
        assignee_agent_uuid?: string;
        assignee_type?: string;
    }) => mutate<ApiResponse<AgentMission>>('/ai/missions', {
        method: 'POST',
        body: JSON.stringify(input),
    }),
    updateAgentMission: (uuid: string, input: Partial<{
        title: string;
        description: string | null;
        kind: string;
        status: string;
        priority: string;
        resource_uuid: string | null;
        assignee_agent_uuid: string | null;
        assignee_type: string | null;
        blocked_reason: string | null;
    }>) => mutate<ApiResponse<AgentMission>>(`/ai/missions/${encodeURIComponent(uuid)}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
    }),
    bulkUpdateAgentMissions: (input: {
        from_status: 'open' | 'in_progress' | 'blocked';
        to_status: 'done' | 'cancelled' | 'open';
    }) => mutate<{
        ok: boolean;
        meta: {
            updated: number;
            from_status: string;
            to_status: string;
        };
    }>('/ai/missions/bulk-status', {
        method: 'POST',
        body: JSON.stringify(input),
    }),
    createApplicationFeatureRequest: (applicationUuid: string, input: {
        title: string;
        description?: string;
        priority?: string;
        dispatch_now?: boolean;
    }) => mutate<ApiResponse<{
        mission: AgentMission;
        dispatched: boolean;
        run_uuid: string | null;
        feature_delivery: FeatureDeliveryStatus;
    }>>(`/applications/${encodeURIComponent(applicationUuid)}/feature-requests`, {
        method: 'POST',
        body: JSON.stringify(input),
    }),
    missionDelivery: (uuid: string) => apiFetch<ApiResponse<{
        mission: AgentMission;
        feature_delivery: FeatureDeliveryStatus;
    }>>(`${API_BASE}/ai/missions/${encodeURIComponent(uuid)}/delivery`),
    validateMissionDelivery: (uuid: string, input?: { merge_method?: 'merge' | 'squash' | 'rebase' }) => mutate<ApiResponse<{
        ok: boolean;
        merged?: boolean;
        sha?: string | null;
        message?: string;
        pull_request_number?: number;
        pull_request_url?: string | null;
        mission: AgentMission;
        feature_delivery: FeatureDeliveryStatus;
    }>>(`/ai/missions/${encodeURIComponent(uuid)}/delivery/validate`, {
        method: 'POST',
        body: JSON.stringify(input ?? {}),
    }),
    requestMissionDeliveryChanges: (uuid: string, feedback: string) => mutate<ApiResponse<{
        ok: boolean;
        message?: string;
        mission: AgentMission;
        feature_delivery: FeatureDeliveryStatus;
    }>>(`/ai/missions/${encodeURIComponent(uuid)}/delivery/request-changes`, {
        method: 'POST',
        body: JSON.stringify({ feedback }),
    }),
    agentRuns: (agentUuid: string, page = 1) => apiFetch<ApiListResponse<AgentRun>>(`${API_BASE}/agents/${encodeURIComponent(agentUuid)}/runs?page=${page}`),
    agentRun: (agentUuid: string, runUuid: string) => apiFetch<ApiResponse<AgentRun>>(`${API_BASE}/agents/${encodeURIComponent(agentUuid)}/runs/${encodeURIComponent(runUuid)}`),
    cancelAgentRun: (agentUuid: string, runUuid: string, reason?: string) => mutate<ApiResponse<{
        cancelled: boolean;
        already_finished: boolean;
        run: AgentRun;
    }>>(`/agents/${encodeURIComponent(agentUuid)}/runs/${encodeURIComponent(runUuid)}/cancel`, {
        method: 'POST',
        body: JSON.stringify(reason ? { reason } : {}),
    }),

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
    testAiProvider: (id: number) => mutate<ApiResponse<{
        success: boolean;
        message: string;
        models_available?: string[];
        models_working?: string[];
        models_failed?: Array<{ id: string; error: string | null }>;
        recommended?: string[];
        lines?: string[];
    }>>(`/ai/providers/${id}/test`, { method: 'POST' }),
    discoverAiProviderModels: (input: {
        provider: LlmProvider;
        api_key?: string;
        base_url?: string | null;
        provider_id?: number;
    }) => mutate<ApiResponse<{ models: LlmModelOption[] }>>('/ai/providers/models', {
        method: 'POST',
        body: JSON.stringify(input),
    }),

    ollamaInstances: () => apiFetch<ApiResponse<OllamaInstance[]>>(`${API_BASE}/ai/ollama/instances`),
    ollamaStatus: (opts?: { baseUrl?: string | null; providerId?: number | null }) => {
        const params = new URLSearchParams();
        if (opts?.baseUrl) {
            params.set('base_url', opts.baseUrl);
        }
        if (opts?.providerId != null) {
            params.set('provider_id', String(opts.providerId));
        }
        const query = params.toString() ? `?${params.toString()}` : '';
        return apiFetch<ApiResponse<OllamaStatus>>(`${API_BASE}/ai/ollama${query}`);
    },
    ollamaPull: (input: { model: string; base_url?: string | null; provider_id?: number | null }) => mutate<ApiResponse<{ ok: boolean; model: string; status: string | null }>>('/ai/ollama/pull', {
        method: 'POST',
        body: JSON.stringify(input),
    }, 900_000),
    ollamaDeleteModel: (input: { model: string; base_url?: string | null; provider_id?: number | null }) => mutate<ApiResponse<{ ok: boolean; model: string }>>('/ai/ollama/models/delete', {
        method: 'POST',
        body: JSON.stringify(input),
    }),
    ollamaSetProviderModel: (input: { provider_id: number; model: string }) => mutate<ApiResponse<{ id: number; name: string; model: string; model_label: string }>>('/ai/ollama/provider-model', {
        method: 'PUT',
        body: JSON.stringify(input),
    }),
    ollamaAssignAgent: (input: { agent_uuid: string; provider_id: number; model?: string | null }) => mutate<ApiResponse<{
        agent_uuid: string;
        agent_name: string;
        provider_id: number;
        provider_name: string;
        preferred_model: string | null;
    }>>('/ai/ollama/assign-agent', {
        method: 'POST',
        body: JSON.stringify(input),
    }),
};
