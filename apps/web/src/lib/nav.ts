export type NavItem = { href: string; label: string; key: string };

/** Nav globale : pas d’entrée Agent — les agents vivent dans le project. */
export const GLOBAL_NAV: NavItem[] = [
  { href: '/app', label: 'Apps', key: 'home' },
  { href: '/app/runners', label: 'Runners', key: 'runners' },
  { href: '/app/mcp', label: 'MCP', key: 'mcp' },
  { href: '/app/tokens', label: 'Tokens', key: 'tokens' },
  { href: '/app/team', label: 'Compte', key: 'team' },
  { href: '/app/settings', label: 'Settings', key: 'settings' },
];

/** Visible uniquement pour `instance_admin` (opérateur SaaS). */
export const ADMIN_NAV_ITEM: NavItem = {
  href: '/app/admin',
  label: 'Admin',
  key: 'admin',
};

export function globalNavForRole(role?: string | null): NavItem[] {
  return GLOBAL_NAV;
}

/** Nav minimaliste pour la bottom bar mobile — uniquement Apps et Runners. */
export function mobileBottomNav(): NavItem[] {
  return GLOBAL_NAV.filter(item => item.key === 'home' || item.key === 'runners');
}

export function projectNav(uuid: string): NavItem[] {
  const base = `/app/projects/view?uuid=${encodeURIComponent(uuid)}`;
  return [
    { href: `${base}&tab=overview`, label: 'Overview', key: 'overview' },
    { href: `${base}&tab=workspace`, label: 'Workspace', key: 'workspace' },
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
}

/** Sous-nav Settings — affichée sous la nav globale, comme la nav projet. */
export const SETTINGS_NAV: NavItem[] = [
  { href: '/app/settings', label: 'Général', key: 'general' },
  { href: '/app/settings?tab=domaine', label: 'Domaine', key: 'domaine' },
  { href: '/app/settings?tab=github', label: 'GitHub', key: 'github' },
  { href: '/app/settings?tab=serveur', label: 'Serveur', key: 'serveur' },
  { href: '/app/settings?tab=llm', label: 'Agents / LLM', key: 'llm' },
  { href: '/app/settings?tab=sso', label: 'SSO / OIDC', key: 'sso' },
  { href: '/app/settings?tab=backup', label: 'Sauvegardes', key: 'backup' },
  { href: '/app/update', label: 'Mise à jour', key: 'update' },
];

export function projectAgentsHref(uuid: string): string {
  return `/app/projects/view?uuid=${encodeURIComponent(uuid)}&tab=agents`;
}
