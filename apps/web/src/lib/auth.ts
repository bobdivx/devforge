const TOKEN_KEY = 'devforge_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export type Bootstrap = {
  ok: boolean;
  needs_setup: boolean;
  allow_register?: boolean;
  authenticated: boolean;
  user?: { uuid: string; email: string; name: string; role: string } | null;
  team?: {
    uuid: string;
    name: string;
    slug: string;
    show_boarding: boolean;
    plan?: string;
  } | null;
  workspace?: {
    uuid: string;
    name: string;
    slug: string;
    show_boarding: boolean;
    plan?: string;
  } | null;
  /** Interrupteurs bêta de l’instance. Absents = activés. */
  features?: {
    workspace: boolean;
    agent_builder: boolean;
  };
  onboarding: {
    required: boolean;
    steps: {
      account: boolean;
      instance: boolean;
      domain: boolean;
      github: boolean;
      server: boolean;
    };
  };
  settings: {
    instance_name: string;
    instance_url: string;
    wildcard_domain: string;
    wildcard_own?: string;
    wildcard_fallback?: string;
    github_connected: boolean;
    ssh_host?: string;
    ssh_user?: string;
    dns?: {
      provider: string;
      zone: string;
      configured: boolean;
      token_set?: boolean;
    };
  };
    sso?: {
    enabled: boolean;
    oidc_configured: boolean;
    hide_local_login: boolean;
    provider: string;
    issuer_url: string;
  };
  cluster?: {
    role: 'leader' | 'worker';
    leader_url?: string;
    node_id?: string;
    node_name?: string;
  };
};
