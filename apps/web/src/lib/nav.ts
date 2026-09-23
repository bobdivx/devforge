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

const PROJECT_PRIMARY_KEYS = ['overview', 'workspace', 'deployments', 'agents', 'domains'] as const;
const PROJECT_MORE_KEYS = ['git', 'actions', 'database', 'env', 'backups', 'settings'] as const;

function projectNavItems(uuid: string, opts?: { workspace?: boolean }): NavItem[] {
  const base = `/app/projects/view?uuid=${encodeURIComponent(uuid)}`;
  const items: NavItem[] = [
    { href: `${base}&tab=overview`, label: 'Aperçu', key: 'overview' },
    { href: `${base}&tab=workspace`, label: 'Workspace', key: 'workspace', beta: true },
    { href: `${base}&tab=deployments`, label: 'Déploiements', key: 'deployments' },
    { href: `${base}&tab=agents`, label: 'Agents', key: 'agents' },
    { href: `${base}&tab=domains`, label: 'Domaines', key: 'domains' },
    { href: `${base}&tab=git`, label: 'Git', key: 'git' },
    { href: `${base}&tab=actions`, label: 'Actions', key: 'actions' },
    { href: `${base}&tab=database`, label: 'Base de données', key: 'database' },
    { href: `${base}&tab=env`, label: 'Env', key: 'env' },
    { href: `${base}&tab=backups`, label: 'Sauvegardes', key: 'backups' },
    { href: `${base}&tab=settings`, label: 'Paramètres', key: 'settings' },
  ];
  if (opts?.workspace === false) return items.filter((item) => item.key !== 'workspace');
  return items;
}

/** Tous les onglets projet (compat). */
export function projectNav(uuid: string, opts?: { workspace?: boolean }): NavItem[] {
  return projectNavItems(uuid, opts);
}

/** Onglets primaires visibles dans la barre projet. */
export function projectNavPrimary(uuid: string, opts?: { workspace?: boolean }): NavItem[] {
  const keys = new Set<string>(PROJECT_PRIMARY_KEYS);
  return projectNavItems(uuid, opts).filter((item) => keys.has(item.key));
}

/** Onglets secondaires — menu « Plus ». */
export function projectNavMore(uuid: string, opts?: { workspace?: boolean }): NavItem[] {
  const keys = new Set<string>(PROJECT_MORE_KEYS);
  return projectNavItems(uuid, opts).filter((item) => keys.has(item.key));
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
