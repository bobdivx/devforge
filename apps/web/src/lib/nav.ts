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
 * Barre du bas, sous le breakpoint desktop.
 * Apps · Agents · Paramètres pour tout le monde.
 * Le centre ouvre les agents lancés sur mobile ; tablette et desktop les ont dans le header.
 * Le compte est une tuile du hub Paramètres. Runners, MCP, Tokens et Admin passent
 * par la sidebar (desktop) ou le menu avatar (mobile et tablette).
 */
export function mobileBottomNav(_role?: string | null): NavItem[] {
  return [
    { href: '/app', label: 'Apps', key: 'home' },
    { href: '#agents', label: 'Agents', key: 'agents' },
    { href: '/app/settings', label: 'Paramètres', key: 'settings' },
  ];
}

/** Liens du menu avatar quand la sidebar est absente. Pas de Runners : trop rare sur mobile. */
export function mobileAvatarNav(role?: string | null): NavItem[] {
  const hidden = new Set(['home', 'team', 'settings', 'runners']);
  return globalNavForRole(role).filter((item) => !hidden.has(item.key));
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

/** Paramètres du compte. L'infra de l'instance est dans Admin. */
export const SETTINGS_NAV: NavItem[] = [
  { href: '/app/settings?tab=domaine', label: 'Domaine', key: 'domaine' },
  { href: '/app/settings?tab=github', label: 'GitHub', key: 'github' },
  { href: '/app/settings?tab=llm', label: 'Agents / LLM', key: 'llm' },
];

export function settingsNavForRole(_role?: string | null): NavItem[] {
  return SETTINGS_NAV;
}

export function projectAgentsHref(uuid: string): string {
  return `/app/projects/view?uuid=${encodeURIComponent(uuid)}&tab=agents`;
}
