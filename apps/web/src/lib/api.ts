import { getToken, setToken, type Bootstrap } from './auth';

const SERVER_BASE =
  import.meta.env.PUBLIC_SERVER_URL ??
  import.meta.env.PUBLIC_API_URL ??
  'http://127.0.0.1:8000/api/v1';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${SERVER_BASE}${path}`, {
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = text || res.statusText;
    try {
      const j = JSON.parse(text);
      if (j.error) msg = j.error;
    } catch {
      /* keep */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}


export type ProjectSync = {
  state:
    | 'up_to_date'
    | 'behind'
    | 'ahead'
    | 'deploying'
    | 'error'
    | 'no_deploy'
    | 'no_git'
    | 'unknown'
    | string;
  behind_by?: number;
  deployed_sha?: string | null;
  head_sha?: string | null;
  error?: string | null;
};

export type Project = {
  uuid: string;
  name: string;
  slug: string;
  status: string;
  git_repository?: string | null;
  git_branch?: string | null;
  production_url?: string | null;
  workdir?: string | null;
  test_command?: string | null;
  server_id?: string | null;
  build_pack?: string;
  port?: number;
  is_static?: number | boolean;
  /** null/undefined = auto ; 0/false = off ; 1/true = on */
  is_sso_protected?: number | boolean | null;
  has_own_user_system?: number | boolean | null;
  publish_directory?: string | null;
  base_directory?: string | null;
  docker_compose_location?: string | null;
  created_at?: string;
  updated_at?: string;
  deploy?: {
    status?: string | null;
    sha?: string | null;
    message?: string | null;
  };
  sync?: ProjectSync;
};

export type LlmProviderRow = {
  id: string;
  catalog_id: string;
  name: string;
  provider: string;
  base_url: string;
  model: string;
  is_default: boolean;
  enabled: boolean;
  priority: number;
  has_api_key: boolean;
  key_hint: string;
  healthy?: boolean;
  last_probe_at?: string;
  last_probe_error?: string;
  resolved_model?: string;
  in_chain?: boolean;
};

export type Deployment = {
  uuid: string;
  status: string;
  git_sha?: string | null;
  git_message?: string | null;
  logs?: string | null;
  created_at?: string;
};

export type ProjectAgent = {
  uuid: string;
  project_uuid: string;
  name: string;
  role: string;
  kind: string;
  parent_agent_uuid?: string | null;
  status: string;
};

export const api = {
  bootstrap: () => request<Bootstrap>('/bootstrap'),
  register: async (body: {
    name: string;
    email: string;
    password: string;
    team_name?: string;
  }) => {
    const r = await request<{
      ok: boolean;
      token: string;
      onboarding?: { required: boolean };
    }>('/auth/register', { method: 'POST', body: JSON.stringify(body) });
    setToken(r.token);
    return r;
  },
  login: async (body: { email: string; password: string }) => {
    const r = await request<{
      ok: boolean;
      token: string;
      onboarding?: { required: boolean };
    }>('/auth/login', { method: 'POST', body: JSON.stringify(body) });
    setToken(r.token);
    return r;
  },
  logout: async () => {
    try {
      await request('/auth/logout', { method: 'POST', body: '{}' });
    } finally {
      setToken(null);
    }
  },
  me: () =>
    request<{
      ok: boolean;
      user: { uuid: string; name: string; email: string };
      team?: { name: string; show_boarding: boolean };
    }>('/me'),
  saveOnboarding: (body: Record<string, string | undefined>) =>
    request<{ ok: boolean; steps: Bootstrap['onboarding']['steps'] }>('/onboarding', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  completeOnboarding: () =>
    request<{ ok: boolean; redirect?: string }>('/onboarding/complete', {
      method: 'POST',
      body: '{}',
    }),
  sshStatus: () =>
    request<{
      ok: boolean;
      executor: string;
      local_docker: boolean;
      ssh_host: string;
      ssh_user: string;
      key_path: string;
      key_exists: boolean;
      public_key?: string | null;
    }>('/settings/ssh'),
  saveSsh: (body: { ssh_host?: string; ssh_user?: string }) =>
    request<{ ok: boolean; ssh_host: string; ssh_user: string }>('/settings/ssh', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  generateSshKey: () =>
    request<{
      ok: boolean;
      created: boolean;
      key_path: string;
      public_key: string;
      hint?: string;
    }>('/settings/ssh/generate-key', { method: 'POST', body: '{}' }),
  adminOverview: () =>
    request<{
      ok: boolean;
      stats: {
        workspaces: number;
        users: number;
        plan_free: number;
        plan_pro: number;
        projects: number;
      };
      workspaces: Array<{
        uuid: string;
        name: string;
        slug: string;
        plan: string;
        created_at: string;
        project_count: number;
        owner: { uuid: string; email: string; name: string; role: string };
      }>;
    }>('/admin/overview'),
  adminUpdateWorkspace: (uuid: string, body: { plan: string }) =>
    request<{ ok: boolean; uuid: string; plan: string }>(
      `/admin/workspaces/${encodeURIComponent(uuid)}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),
  health: () =>
    request<{
      ok: boolean;
      version?: string;
      backends?: {
        executor?: string;
        github?: string;
        storage?: string;
        database?: string;
        llm?: string;
        update?: string;
      };
    }>('/health'),
  projects: () => request<{ data: Project[] }>('/projects'),
  project: async (uuid: string) => {
    const res = await request<{ data: Project | { project: Project; deployments: Deployment[] } }>(
      '/projects/' + uuid,
    );
    const data = res.data;
    if (data && typeof data === 'object' && 'project' in data) {
      return { data: (data as { project: Project }).project };
    }
    return { data: data as Project };
  },
  createProject: (body: Partial<Project> & { name: string; is_static?: boolean; port?: number }) =>
    request<{ data: Project }>('/projects', { method: 'POST', body: JSON.stringify(body) }),
  deployments: (projectUuid: string) =>
    request<{ data: Deployment[] }>(`/projects/${projectUuid}/deployments`),
  createDeployment: (projectUuid: string, body?: { git_message?: string }) =>
    request<{ data: Deployment; ok?: boolean }>(`/projects/${projectUuid}/deployments`, {
      method: 'POST',
      body: JSON.stringify(body ?? { git_message: 'Manual deploy' }),
    }),
  deployment: (uuid: string) => request<{ data: Deployment }>(`/deployments/${uuid}`),
  deploymentLogs: (uuid: string) =>
    request<{ data: { logs?: string; status?: string } } | { logs?: string }>(
      `/deployments/${uuid}/logs`,
    ),
  projectAgents: (projectUuid: string) =>
    request<{ data: ProjectAgent[] }>(`/projects/${projectUuid}/agents`),
  agentMessages: (projectUuid: string, agentUuid: string) =>
    request<{
      data: Array<{
        uuid: string;
        role: string;
        content: string;
        provider?: string;
        tool_calls_json?: string;
        created_at: string;
      }>;
    }>(`/projects/${projectUuid}/agents/${agentUuid}/messages`),
  clearAgentMessages: (projectUuid: string, agentUuid: string) =>
    request<{ ok: boolean }>(`/projects/${projectUuid}/agents/${agentUuid}/messages`, {
      method: 'DELETE',
    }),
  llmStatus: () =>
    request<{
      mode: string;
      provider: string;
      model: string;
      base_url: string;
      has_key: boolean;
      key_hint: string;
    }>('/llm/status'),
  llmConnect: (body: {
    provider?: string;
    api_key?: string;
    model?: string;
    base_url?: string;
  }) =>
    request<{ ok: boolean; mode: string; provider: string; model: string }>('/llm/connect', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  llmDisconnect: () =>
    request<{ ok: boolean; mode: string }>('/llm/connect', { method: 'DELETE' }),
  llmModels: (body: { provider?: string; api_key?: string; base_url?: string }) =>
    request<{ ok: boolean; base_url: string; models: string[] }>('/llm/models', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  llmCatalog: () =>
    request<{
      data: Array<{
        id: string;
        name: string;
        description: string;
        category: string;
        docs_url?: string | null;
        default_url?: string | null;
        provider: string;
        fields: Array<{
          key: string;
          label: string;
          placeholder?: string | null;
          secret: boolean;
          required: boolean;
          help?: string | null;
        }>;
        popular: boolean;
        icon_domain?: string | null;
      }>;
    }>('/llm/catalog'),
  llmProviders: () =>
    request<{
      data: LlmProviderRow[];
      active_mode: string;
    }>('/llm/providers'),
  llmUpsertProvider: (body: {
    id?: string;
    catalog_id?: string;
    name?: string;
    provider?: string;
    api_key?: string;
    base_url?: string;
    model?: string;
    is_default?: boolean;
    fields?: Record<string, string>;
  }) =>
    request<{ data: LlmProviderRow; active_mode: string }>('/llm/providers', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  llmDeleteProvider: (id: string) =>
    request<{ ok: boolean }>(`/llm/providers/${id}`, { method: 'DELETE' }),
  llmTestProvider: (id: string) =>
    request<{
      ok: boolean;
      message: string;
      resolved_model?: string;
      latency_ms?: number;
      active_mode?: string;
    }>(`/llm/providers/${id}/test`, {
      method: 'POST',
      body: '{}',
    }),
  llmProbeProviders: () =>
    request<{
      ok: boolean;
      healthy: number;
      total: number;
      active_mode: string;
      results: Array<{
        id: string;
        name: string;
        ok: boolean;
        skipped?: boolean;
        message?: string;
        error?: string | null;
        resolved_model?: string;
      }>;
    }>('/llm/providers/probe', { method: 'POST', body: '{}' }),
  llmActivateProvider: (id: string) =>
    request<{ ok: boolean; active_mode: string }>(`/llm/providers/${id}/activate`, {
      method: 'POST',
      body: '{}',
    }),
  llmReorderProviders: (ordered_ids: string[]) =>
    request<{ ok: boolean; active_mode: string }>('/llm/providers/reorder', {
      method: 'POST',
      body: JSON.stringify({ ordered_ids }),
    }),
  createProjectAgent: (
    projectUuid: string,
    body: {
      name: string;
      role?: string;
      kind?: string;
      parent_agent_uuid?: string;
    },
  ) =>
    request<{ data: ProjectAgent }>(`/projects/${projectUuid}/agents`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  agentChat: (
    message: string,
    extra?: {
      tool?: string;
      arguments?: Record<string, unknown>;
      project_uuid?: string;
      agent_uuid?: string;
    },
  ) =>
    request<{ data: { reply: string; tool_calls: unknown[]; provider?: string } }>('/agent/chat', {
      method: 'POST',
      body: JSON.stringify({ message, ...extra }),
    }),
  agentTools: () => request<{ data: Array<{ name: string; description: string }> }>('/agent/tools'),
  lifecycle: (projectUuid: string, action: string) =>
    request<{ ok?: boolean; phase?: string; output?: string; error?: string }>(
      `/projects/${projectUuid}/lifecycle/${action}`,
      { method: 'POST', body: '{}' },
    ),
  storageBuckets: () =>
    request<{ ok: boolean; mode?: string; buckets: Array<{ name: string; region: string }> }>(
      '/storage/buckets',
    ),
  storageObjects: (bucket: string) =>
    request<{
      ok: boolean;
      objects: Array<{ key: string; size_bytes: number; content_type: string; etag: string }>;
    }>(`/storage/buckets/${encodeURIComponent(bucket)}/objects`),
  putStorageObject: (
    bucket: string,
    body: { key: string; size_bytes?: number; content_type?: string },
  ) =>
    request<{ ok: boolean }>(`/storage/buckets/${encodeURIComponent(bucket)}/objects`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  backups: (projectUuid: string) =>
    request<{
      ok: boolean;
      backups: Array<{
        id: string;
        kind: string;
        status: string;
        size_bytes: number;
        storage_key?: string | null;
        message: string;
        created_at: string;
      }>;
    }>(`/projects/${projectUuid}/backups`),
  createBackup: (projectUuid: string, kind?: string) =>
    request<{ ok: boolean; backup: { id: string; status: string; message: string } }>(
      `/projects/${projectUuid}/backups`,
      { method: 'POST', body: JSON.stringify({ kind }) },
    ),
  restorePreview: (projectUuid: string, backupId: string) =>
    request<{ ok: boolean; steps?: string[]; note?: string }>(
      `/projects/${projectUuid}/backups/${backupId}/restore-preview`,
      { method: 'POST', body: '{}' },
    ),
  updateProject: (
    uuid: string,
    body: Partial<Project> & {
      is_static?: boolean;
      port?: number;
      sso_protection?: 'auto' | 'on' | 'off';
      has_own_user_system?: boolean;
    },
  ) =>
    request<{ data: Project }>(`/projects/${uuid}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteProject: (uuid: string) =>
    request<{ ok: boolean; deleted: string }>(`/projects/${uuid}`, { method: 'DELETE' }),
  envList: (projectUuid: string) =>
    request<{ data: Array<{ key: string; value: string; secret: boolean }> }>(
      `/projects/${projectUuid}/env`,
    ),
  envGet: (projectUuid: string, key: string) =>
    request<{ data: { key: string; value: string; secret: boolean } }>(
      `/projects/${projectUuid}/env/${encodeURIComponent(key)}`,
    ),
  envUpsert: (
    projectUuid: string,
    body: { key: string; value: string; secret?: boolean },
  ) =>
    request<{ data: { key: string; value: string; secret: boolean } }>(
      `/projects/${projectUuid}/env`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  envDelete: (projectUuid: string, key: string) =>
    request<{ ok: boolean }>(`/projects/${projectUuid}/env/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    }),
  envImport: (projectUuid: string, content: string, overwrite = true) =>
    request<{ ok: boolean; imported: number; skipped: number }>(
      `/projects/${projectUuid}/env/import`,
      { method: 'POST', body: JSON.stringify({ content, overwrite }) },
    ),
  domains: (projectUuid: string) =>
    request<{
      data?: Array<{
        id: string;
        fqdn: string;
        tls: boolean;
        status: string;
        is_primary?: boolean;
      }>;
      domains?: Array<{
        id: string;
        fqdn: string;
        tls: boolean;
        status: string;
        is_primary?: boolean;
      }>;
      primary_fqdn?: string | null;
      production_url?: string | null;
    }>(`/projects/${projectUuid}/domains`),
  attachDomain: (
    projectUuid: string,
    body: { fqdn: string; tls?: boolean; primary?: boolean },
  ) =>
    request(`/projects/${projectUuid}/domains`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  setPrimaryDomain: (projectUuid: string, id: string) =>
    request<{ ok: boolean; primary_fqdn: string; production_url: string }>(
      `/projects/${projectUuid}/domains/${encodeURIComponent(id)}/primary`,
      { method: 'POST', body: '{}' },
    ),
  setPrimaryDomainFqdn: (projectUuid: string, fqdn: string) =>
    request<{ ok: boolean; primary_fqdn: string; production_url: string }>(
      `/projects/${projectUuid}/domains/primary`,
      { method: 'POST', body: JSON.stringify({ fqdn }) },
    ),
  detachDomain: (projectUuid: string, id: string) =>
    request(`/projects/${projectUuid}/domains/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  ports: (projectUuid: string) => request(`/projects/${projectUuid}/ports`),
  upsertPort: (
    projectUuid: string,
    body: {
      container_port: number;
      public_port?: number;
      protocol?: string;
      public?: boolean;
    },
  ) =>
    request(`/projects/${projectUuid}/ports`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  githubStatus: () =>
    request<{
      ok: boolean;
      connected: boolean;
      mode: string;
      user: { login: string; name?: string | null; html_url?: string; avatar_url?: string | null } | null;
      hint?: string;
    }>('/github/status'),
  githubConnect: (token: string) =>
    request<{
      ok: boolean;
      connected: boolean;
      mode: string;
      user: { login: string; name?: string | null; html_url?: string };
    }>('/github/connect', { method: 'POST', body: JSON.stringify({ token }) }),
  githubDisconnect: () =>
    request<{ ok: boolean; connected: boolean }>('/github/connect', { method: 'DELETE' }),
  githubRepos: () =>
    request<{
      data: Array<{
        full_name: string;
        name: string;
        owner: string;
        private: boolean;
        default_branch: string;
        html_url: string;
        description?: string | null;
      }>;
    }>('/github/repos'),
  githubBranches: (owner: string, repo: string) =>
    request<{
      data: Array<{ name: string; protected: boolean; commit_sha: string }>;
    }>(`/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`),
  githubDetect: (body: { owner: string; repo: string; branch?: string }) =>
    request<{
      ok: boolean;
      detection: {
        framework: string;
        label: string;
        confidence: number;
        build_pack: string;
        port: number;
        is_static: boolean;
        publish_directory?: string | null;
        base_directory: string;
        docker_compose_location?: string | null;
        test_command?: string | null;
        hints: string[];
        evidence: string[];
      };
    }>('/github/detect', { method: 'POST', body: JSON.stringify(body) }),
  projectDetect: (uuid: string, body?: { apply?: boolean; from_github?: boolean }) =>
    request<{
      ok: boolean;
      source: string;
      applied: boolean;
      detection: {
        framework: string;
        label: string;
        confidence: number;
        build_pack: string;
        port: number;
        is_static: boolean;
        publish_directory?: string | null;
        base_directory: string;
        docker_compose_location?: string | null;
        test_command?: string | null;
        hints: string[];
        evidence: string[];
      };
      project: Project;
    }>(`/projects/${uuid}/detect`, {
      method: 'POST',
      body: JSON.stringify(body ?? { apply: true, from_github: true }),
    }),
  mcpCatalog: () =>
    request<{
      data: Array<{
        id: string;
        name: string;
        description: string;
        category: string;
        docs_url?: string | null;
        default_url?: string | null;
        fields: Array<{
          key: string;
          label: string;
          placeholder?: string | null;
          secret: boolean;
          required: boolean;
          help?: string | null;
        }>;
        resource_kind?: string | null;
        popular: boolean;
        setup_notes?: string | null;
      }>;
    }>('/mcp/catalog'),
  listTokens: () =>
    request<{
      data: Array<{
        id: string;
        name: string;
        token_prefix: string;
        abilities: string[];
        last_used_at?: string | null;
        expires_at?: string | null;
        created_at: string;
      }>;
    }>('/tokens'),
  createToken: (body: {
    name: string;
    abilities?: string[];
    expires_in_days?: number | null;
  }) =>
    request<{
      data: {
        id: string;
        name: string;
        token: string;
        token_prefix: string;
        abilities: string[];
        expires_at?: string | null;
        created_at: string;
        hint?: string;
      };
    }>('/tokens', { method: 'POST', body: JSON.stringify(body) }),
  revokeToken: (id: string) =>
    request<{ ok: boolean }>(`/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  mcpServers: () =>
    request<{
      data: Array<{
        id: string;
        name: string;
        url: string;
        enabled: boolean;
        catalog_id?: string | null;
        meta: Record<string, string>;
        has_secrets: boolean;
        secret_keys: string[];
      }>;
    }>('/mcp/servers'),
  mcpUpsert: (body: {
    id?: string;
    catalog_id?: string;
    name?: string;
    url?: string;
    enabled?: boolean;
    fields?: Record<string, string>;
  }) =>
    request<{ data: { id: string; name: string; catalog_id?: string | null } }>('/mcp/servers', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  mcpDelete: (id: string) =>
    request<{ ok: boolean }>(`/mcp/servers/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  mcpTools: (id: string) =>
    request<{ data: Array<{ name: string; description: string }> }>(
      `/mcp/servers/${encodeURIComponent(id)}/tools`,
    ),
  mcpResources: (id: string) =>
    request<{
      ok: boolean;
      kind: string;
      provider: string;
      data: Array<{
        name: string;
        db_id?: string | null;
        hostname: string;
        regions: string[];
      }>;
    }>(`/mcp/servers/${encodeURIComponent(id)}/resources`),
  projectResources: (projectUuid: string) =>
    request<{
      data: Array<{
        id: string;
        provider: string;
        server_id: string;
        resource_id: string;
        resource_name: string;
        meta: Record<string, unknown>;
        created_at: string;
      }>;
    }>(`/projects/${projectUuid}/resources`),
  linkProjectResource: (
    projectUuid: string,
    body: {
      server_id: string;
      resource_id: string;
      resource_name?: string;
      hostname?: string;
    },
  ) =>
    request<{
      ok: boolean;
      provider: string;
      database: string;
      hostname: string;
      env_keys: string[];
    }>(`/projects/${projectUuid}/resources`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  unlinkProjectResource: (projectUuid: string, linkId: string) =>
    request<{ ok: boolean }>(
      `/projects/${projectUuid}/resources/${encodeURIComponent(linkId)}`,
      { method: 'DELETE' },
    ),
  updateCheck: () =>
    request<{
      data: {
        current: string;
        latest?: string | null;
        latest_name?: string | null;
        latest_url?: string | null;
        update_available: boolean;
        can_apply?: boolean;
        channel: string;
        mode: string;
        repo: string;
        message: string;
      };
      job?: {
        id: string;
        target_version: string;
        status: string;
        steps: Array<{ id: string; label: string; status: string; detail: string }>;
        message: string;
        wait_path?: string;
      } | null;
    }>('/update/check'),
  updateStatus: () =>
    request<{
      data: {
        id: string;
        target_version: string;
        status: string;
        steps: Array<{ id: string; label: string; status: string; detail: string }>;
        message: string;
        wait_path?: string;
      } | null;
      version: string;
      mode: string;
    }>('/update/status'),
  updateStart: (body?: { target_version?: string }) =>
    request<{
      ok: boolean;
      data: {
        id: string;
        target_version: string;
        status: string;
        steps: Array<{ id: string; label: string; status: string; detail: string }>;
        message: string;
        wait_path?: string;
      };
    }>('/update/start', {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),

  ssoGet: () =>
    request<{
      ok: boolean;
      config: {
        provider: string;
        issuer_url: string;
        protect_apps_by_default: boolean;
        forward_auth_address: string;
        hide_local_login: boolean;
        pocket_id_url: string;
        oauth2_proxy_url: string;
        apps_client_id: string;
        apps_client_secret_set: boolean;
        pocket_id_api_token_set: boolean;
        forward_auth_configured: boolean;
        oidc_configured: boolean;
        middleware_name: string;
      };
    }>('/settings/sso'),
  ssoSave: (body: {
    provider?: 'generic' | 'pocket_id' | string;
    issuer_url?: string;
    protect_apps_by_default?: boolean;
    forward_auth_address?: string;
    hide_local_login?: boolean;
    pocket_id_url?: string;
    oauth2_proxy_url?: string;
    apps_client_id?: string;
    apps_client_secret?: string;
    pocket_id_api_token?: string;
    provision?: boolean;
    rotate_secret?: boolean;
  }) =>
    request<{
      ok: boolean;
      config: {
        provider: string;
        issuer_url: string;
        protect_apps_by_default: boolean;
        forward_auth_address: string;
        hide_local_login: boolean;
        pocket_id_url: string;
        oauth2_proxy_url: string;
        apps_client_id: string;
        apps_client_secret_set: boolean;
        pocket_id_api_token_set: boolean;
        forward_auth_configured: boolean;
        oidc_configured: boolean;
        middleware_name: string;
      };
      provision?: {
        ok?: boolean;
        created_client?: boolean;
        created_secret?: boolean;
        callback_urls?: string[];
      } | null;
    }>('/settings/sso', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  backupS3Get: () =>
    request<{
      ok: boolean;
      mode?: string;
      config: {
        enabled: boolean;
        name: string;
        key_set: boolean;
        key_masked?: string | null;
        secret_set: boolean;
        bucket: string;
        region: string;
        endpoint: string;
        ready: boolean;
      };
    }>('/settings/backup-s3'),
  backupS3Save: (body: {
    enabled?: boolean;
    name?: string;
    key?: string;
    secret?: string;
    bucket?: string;
    region?: string;
    endpoint?: string;
    test?: boolean;
  }) =>
    request<{
      ok: boolean;
      mode?: string;
      config: {
        enabled: boolean;
        name: string;
        key_set: boolean;
        key_masked?: string | null;
        secret_set: boolean;
        bucket: string;
        region: string;
        endpoint: string;
        ready: boolean;
      };
    }>('/settings/backup-s3', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  backupS3Test: (body: {
    key?: string;
    secret?: string;
    bucket?: string;
    region?: string;
    endpoint?: string;
  }) =>
    request<{ ok: boolean; message?: string }>('/settings/backup-s3/test', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  instanceBackups: () =>
    request<{
      ok: boolean;
      ready?: boolean;
      mode?: string;
      backups: Array<{
        id: string;
        storage_key: string;
        size_bytes: number;
        status: string;
        message: string;
        created_at: string;
      }>;
    }>('/instance/backups'),
  instanceBackupCreate: () =>
    request<{
      ok: boolean;
      backup?: {
        id: string;
        storage_key: string;
        size_bytes: number;
        status: string;
        message: string;
        created_at: string;
      };
    }>('/instance/backups', { method: 'POST', body: '{}' }),
  instanceBackupsRemote: (body?: {
    use_inline?: boolean;
    key?: string;
    secret?: string;
    bucket?: string;
    region?: string;
    endpoint?: string;
  }) =>
    request<{
      ok: boolean;
      objects: Array<{ key: string; size_bytes: number; updated_at?: string }>;
    }>('/instance/backups/remote', {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),
  instanceBackupRestore: (body: {
    storage_key: string;
    use_inline?: boolean;
    key?: string;
    secret?: string;
    bucket?: string;
    region?: string;
    endpoint?: string;
  }) =>
    request<{
      ok: boolean;
      restart_required?: boolean;
      message?: string;
      path?: string;
      size_bytes?: number;
    }>('/instance/backups/restore', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // —— GitHub Runners ——
  runnersList: () =>
    request<{ ok: boolean; runners: ManagedRunner[] }>('/runners'),
  runnersGet: (id: string) =>
    request<{ ok: boolean; runner: ManagedRunner; environment: Array<{ key: string; value: string }> }>(
      `/runners/${encodeURIComponent(id)}`,
    ),
  runnersCreate: (body: CreateRunnerBody) =>
    request<{ ok: boolean; accepted?: boolean; message?: string; runner: ManagedRunner }>('/runners', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  runnersAction: (id: string, action: 'start' | 'stop' | 'restart' | 'recreate') =>
    request<{ ok: boolean; accepted?: boolean; message?: string; runner: ManagedRunner }>(
      `/runners/${encodeURIComponent(id)}/${action}`,
      { method: 'POST', body: '{}' },
    ),
  runnersDelete: (id: string) =>
    request<{ ok: boolean; message?: string }>(`/runners/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  runnersLogs: (id: string, lines = 200) =>
    request<{ ok: boolean; logs: RunnerLogs }>(
      `/runners/${encodeURIComponent(id)}/logs?lines=${lines}`,
    ),
  runnersJobs: (id: string) =>
    request<{ ok: boolean; jobs: RunnerJob[] }>(`/runners/${encodeURIComponent(id)}/jobs`),
    runnersSync: () => request<{ ok: boolean; changed: number }>('/runners/sync', { method: 'POST', body: '{}' }),

  projectActions: (uuid: string) =>
    request<{
      ok: boolean;
      available: boolean;
      reason?: string;
      owner?: string;
      repo?: string;
      branch?: string;
      has_workflows?: boolean;
      needs_patch?: boolean;
      workflows?: Array<{
        name: string;
        path: string;
        uses_devforge: boolean;
        runs_on: string[];
        skipped_dynamic: boolean;
      }>;
      runs?: Array<{
        id: number;
        name: string;
        status: string;
        conclusion?: string | null;
        html_url: string;
        branch?: string | null;
      }>;
      runners?: ManagedRunner[];
    }>(`/projects/${encodeURIComponent(uuid)}/actions`),
  projectActionsEnsureRunner: (
    uuid: string,
    body?: { runner_name?: string; image?: string; labels?: string },
  ) =>
    request<{
      ok: boolean;
      created: boolean;
      message?: string;
      runner?: ManagedRunner;
    }>(`/projects/${encodeURIComponent(uuid)}/actions/ensure-runner`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),
  projectActionsUseDevforge: (uuid: string, dry_run = false) =>
    request<{
      ok: boolean;
      dry_run?: boolean;
      message?: string;
      branch?: string;
      owner?: string;
      repo?: string;
      next_step?: string | null;
      commit_urls?: string[];
      patched?: Array<{
        path: string;
        changes: number;
        sha?: string;
        commit_sha?: string | null;
        html_url?: string | null;
        dry_run?: boolean;
      }>;
      skipped?: Array<{ path: string; reason: string }>;
    }>(`/projects/${encodeURIComponent(uuid)}/actions/use-devforge-runners`, {
      method: 'POST',
      body: JSON.stringify({ dry_run }),
    }),

  projectGit: (uuid: string) =>
    request<{
      ok: boolean;
      available: boolean;
      reason?: string;
      owner?: string;
      repo?: string;
      branch?: string;
      repo_url?: string;
      sync?: ProjectSync & {
        commits?: Array<{
          sha: string;
          message: string;
          author?: string | null;
          date?: string | null;
          html_url?: string | null;
        }>;
        html_url?: string | null;
        error?: string;
        ahead_by_remote?: number;
      };
      workdir?: {
        available: boolean;
        dirty: boolean;
        files?: Array<{ status: string; path: string }>;
        head?: string | null;
        note?: string | null;
        reason?: string;
      };
    }>(`/projects/${encodeURIComponent(uuid)}/git`),

  projectGitDiscard: (uuid: string) =>
    request<{ ok: boolean; message?: string; output?: string }>(
      `/projects/${encodeURIComponent(uuid)}/git/discard`,
      { method: 'POST', body: JSON.stringify({ confirm: true }) },
    ),
};

export type ManagedRunner = {
  id: string;
  server_id: string;
  container_name: string;
  runner_name: string;
  owner: string;
  repo: string;
  repo_url: string;
  image: string;
  labels: string;
  network_mode: string;
  timezone: string;
  replace_existing: boolean;
  pull_image: boolean;
  volumes: string[];
  extra_env: Array<{ key: string; value: string }>;
  auth_mode: string;
  enabled: boolean;
  project_uuid?: string | null;
  live_state: string;
  live_status: string;
  container_id?: string | null;
  github_status?: string | null;
  github_busy?: boolean | null;
  github_runner_id?: number | null;
  last_synced_at?: string | null;
  last_error?: string | null;
  op_status: string;
  created_at: string;
  updated_at: string;
};

export type CreateRunnerBody = {
  owner: string;
  repo: string;
  runner_name: string;
  container_name?: string;
  labels?: string;
  image?: string;
  network_mode?: string;
  timezone?: string;
  replace_existing?: boolean;
  pull_image?: boolean;
  volumes?: string[];
  extra_env?: Array<{ key: string; value: string }>;
  auth_mode?: string;
  project_uuid?: string;
};

export type RunnerLogs = {
  available: boolean;
  reason?: string | null;
  message?: string | null;
  container: string;
  container_status?: string | null;
  line_count: number;
  items: Array<{ cursor: number; message: string }>;
  runner_version?: string | null;
};

export type RunnerJob = {
  run_id: number;
  run_name: string;
  run_status: string;
  run_conclusion?: string | null;
  run_url: string;
  job_id?: number | null;
  job_name?: string | null;
  job_status?: string | null;
  job_conclusion?: string | null;
  runner_name?: string | null;
};

export function runnersEventsUrl(): string {
  const base = SERVER_BASE.replace(/\/$/, '');
  const token = getToken();
  const url = `${base}/runners/events`;
  // EventSource cannot set Authorization header — pass token as query if needed.
  // Prefer cookie-less Bearer via query only when required; server uses Authorization header.
  // Fall back: open with fetch stream is harder — we pass token as `access_token` query.
  return token ? `${url}?access_token=${encodeURIComponent(token)}` : url;
}
