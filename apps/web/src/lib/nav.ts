export type NavItem = { href: string; label: string; key: string; beta?: boolean };

/** Navigation produit, visible pour chaque compte. */
const USER_NAV: NavItem[] = [
  { href: '/app', label: 'Apps', key: 'home' },
  { href: '/app/mcp', label: 'MCP', key: 'mcp' },
  { href: '/app/tokens', label: 'Tokens', key: 'tokens' },
  { href: '/app/team', label: 'Compte', key: 'team' },
  { href: '/app/settings', label: 'Paramètres', key: 'settings' },
];

/** Infra et opérateur — `instance_admin` uniquement. */
const ADMIN_NAV: NavItem[] = [
  { href: '/app', label: 'Apps', key: 'home' },
  { href: '/app/runners', label: 'Runners', key: 'runners' },
  { href: '/app/cluster', label: 'Cluster', key: 'cluster' },
  { href: '/app/mcp', label: 'MCP', key: 'mcp' },
  { href: '/app/tokens', label: 'Tokens', key: 'tokens' },
  { href: '/app/team', label: 'Compte', key: 'team' },
  { href: '/app/settings', label: 'Paramètres', key: 'settings' },
  { href: '/app/admin', label: 'Admin', key: 'admin' },
];

/** Nav du worker : pas d’UI produit, uniquement la fiche nœud. */
export const WORKER_NAV: NavItem[] = [{ href: '/app/node', label: 'Nœud', key: 'node' }];

export function globalNavForRole(role?: string | null): NavItem[] {
  if (role === 'instance_admin') return ADMIN_NAV;
  return USER_NAV;
}

/**
 * Barre du bas mobile.
 * Utilisateur : Apps · Plus · Compte.
 * Admin : Apps · Plus · Runners.
 * Le sheet « Plus » porte le reste, sans recopier ces entrées.
 */
export function mobileBottomNav(role?: string | null): NavItem[] {
  if (role === 'instance_admin') {
    return [
      { href: '/app', label: 'Apps', key: 'home' },
      { href: '#plus', label: 'Plus', key: 'plus' },
      { href: '/app/runners', label: 'Runners', key: 'runners' },
    ];
  }
  return [
    { href: '/app', label: 'Apps', key: 'home' },
    { href: '#plus', label: 'Plus', key: 'plus' },
    { href: '/app/team', label: 'Compte', key: 'team' },
  ];
}

/** Entrées du sheet mobile qui ne sont pas déjà dans la barre du bas. */
export function mobileSheetNav(role?: string | null): NavItem[] {
  const bottom = new Set(mobileBottomNav(role).map((item) => item.key));
  return globalNavForRole(role).filter((item) => !bottom.has(item.key));
}

export function projectNav(uuid: string, opts?: { workspace?: boolean }): NavItem[] {
  const base = `/app/projects/view?uuid=${encodeURIComponent(uuid)}`;
  const items: NavItem[] = [
    { href: `${base}&tab=overview`, label: 'Overview', key: 'overview' },
    { href: `${base}&tab=workspace`, label: 'Workspace', key: 'workspace', beta: true },
    { href: `${base}&tab=deployments`, label: 'Deployments', key: 'deployments' },
    { href: `${base}&tab=git`, label: 'Git', key: 'git' },
    { href: `${base}&tab=actions`, label: 'Actions', key: 'actions' },
    { href: `${base}&tab=agents`, label: 'Agents', key: 'agents' },
    { href: `${base}&tab=domains`, label: 'Domains', key: 'domains' },
    { href: `${base}&tab=database`, label: 'Database', key: 'database' },
    { href: `${base}&tab=env`, label: 'Env', key: 'env' },
    { href: `${base}&tab=backups`, label: 'Backups', key: 'backups' },
    { href: `${base}&tab=settings`, label: 'Settings', key: 'settings' },
  ];
  if (opts?.workspace === false) return items.filter((item) => item.key !== 'workspace');
  return items;
}

/** Sous-nav Settings. Les comptes voient domaine, GitHub et LLM ; le reste est admin. */
export const SETTINGS_NAV: NavItem[] = [
  { href: '/app/settings', label: 'Général', key: 'general' },
  { href: '/app/settings?tab=domaine', label: 'Domaine', key: 'domaine' },
  { href: '/app/settings?tab=github', label: 'GitHub', key: 'github' },
  { href: '/app/settings?tab=serveur', label: 'Serveur', key: 'serveur' },
  { href: '/app/settings?tab=llm', label: 'Agents / LLM', key: 'llm' },
  { href: '/app/settings?tab=sso', label: 'SSO / OIDC', key: 'sso' },
  { href: '/app/settings?tab=backup', label: 'Sauvegardes', key: 'backup' },
  { href: '/app/settings?tab=postgres', label: 'Postgres', key: 'postgres' },
  { href: '/app/settings?tab=update', label: 'Mise à jour', key: 'update' },
];

const USER_SETTINGS_KEYS = new Set(['domaine', 'github', 'llm']);

export function settingsNavForRole(role?: string | null): NavItem[] {
  if (role === 'instance_admin') return SETTINGS_NAV;
  return SETTINGS_NAV.filter((item) => USER_SETTINGS_KEYS.has(item.key));
}

export function projectAgentsHref(uuid: string): string {
  return `/app/projects/view?uuid=${encodeURIComponent(uuid)}&tab=agents`;
}
