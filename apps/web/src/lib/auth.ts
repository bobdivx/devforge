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
    github_connected: boolean;
    ssh_host: string;
    ssh_user: string;
  };
  sso?: {
    enabled: boolean;
    oidc_configured: boolean;
    hide_local_login: boolean;
    provider: string;
    issuer_url: string;
  };
};
