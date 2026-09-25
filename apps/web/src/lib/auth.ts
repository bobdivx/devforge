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

const RETURN_TO_KEY = 'devforge_return_to';
const RETURN_TO_TTL_MS = 15 * 60 * 1000;

/** Mémorise une page interne où revenir après la connexion (ex. consentement OAuth). */
export function setReturnTo(path: string) {
  if (typeof window === 'undefined') return;
  if (!path.startsWith('/') || path.startsWith('//')) return;
  localStorage.setItem(RETURN_TO_KEY, JSON.stringify({ path, at: Date.now() }));
}

/** Page de retour en attente (sans la consommer). */
export function peekReturnTo(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(RETURN_TO_KEY);
    if (!raw) return null;
    const { path, at } = JSON.parse(raw) as { path: string; at: number };
    if (Date.now() - at > RETURN_TO_TTL_MS || !path.startsWith('/') || path.startsWith('//')) {
      localStorage.removeItem(RETURN_TO_KEY);
      return null;
    }
    return path;
  } catch {
    localStorage.removeItem(RETURN_TO_KEY);
    return null;
  }
}

/** Consomme la page de retour en attente. */
export function takeReturnTo(): string | null {
  const path = peekReturnTo();
  if (typeof window !== 'undefined') localStorage.removeItem(RETURN_TO_KEY);
  return path;
}
