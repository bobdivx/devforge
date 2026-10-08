/**
 * Classification des variables d'environnement projet.
 * Les clés injectées par DevForge (SSO/OIDC, Turso, Postgres) sont regroupées
 * à part ; le reste reste « personnalisé ».
 */

export type EnvGroupId = 'auth' | 'database' | 'runtime' | 'other';

export type EnvGroupMeta = {
  id: EnvGroupId;
  label: string;
  description: string;
};

export const ENV_GROUP_ORDER: EnvGroupMeta[] = [
  {
    id: 'auth',
    label: 'Authentification',
    description: 'OIDC / SSO injectés par DevForge',
  },
  {
    id: 'database',
    label: 'Base de données',
    description: 'Turso, Postgres ou SQLite provisionnés',
  },
  {
    id: 'runtime',
    label: 'Runtime',
    description: 'URL d’app, hôtes et réglages de déploiement',
  },
  {
    id: 'other',
    label: 'Autres',
    description: 'Variables plateforme non classées',
  },
];

/** Clés exactes injectées par DevForge (SSO, DB, runtime). */
const MANAGED_EXACT = new Set([
  // Auth / OIDC (sso.rs)
  'OIDC_ISSUER',
  'OIDC_ISSUER_URL',
  'OIDC_DISCOVERY_URL',
  'OIDC_CLIENT_ID',
  'OIDC_CLIENT_SECRET',
  'OIDC_SCOPES',
  'OIDC_PROVIDER',
  'OIDC_REDIRECT_URI',
  'POCKET_ID_URL',
  'AUTH_POCKET_ID_ID',
  'AUTH_POCKET_ID_ISSUER',
  'AUTH_POCKET_ID_SECRET',
  'AUTH_POCKET_ID_REDIRECT_URI',
  'AUTH_URL',
  'NEXTAUTH_URL',
  'AUTH_TRUST_HOST',
  'AUTH_SECRET',
  'NEXTAUTH_SECRET',
  // Database (Turso / Postgres)
  'TURSO_DATABASE_URL',
  'TURSO_AUTH_TOKEN',
  'TURSO_DATABASE_URL_AUTH',
  'DATABASE_URL',
  'LIBSQL_URL',
  'POSTGRES_URL',
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DB',
  'PGHOST',
  'PGPORT',
  'PGUSER',
  'PGPASSWORD',
  'PGDATABASE',
]);

const AUTH_PREFIXES = ['OIDC_', 'AUTH_', 'NEXTAUTH_', 'POCKET_ID_'] as const;
const DB_PREFIXES = ['TURSO_', 'POSTGRES_', 'MYSQL_', 'REDIS_', 'LIBSQL_', 'DATABASE_'] as const;
const PG_LIBPQ = new Set([
  'PGHOST',
  'PGPORT',
  'PGUSER',
  'PGPASSWORD',
  'PGDATABASE',
  'PGSSLMODE',
]);
const RUNTIME_EXACT = new Set([
  'APP_URL',
  'PUBLIC_URL',
  'BASE_URL',
  'PORT',
  'HOST',
  'NODE_ENV',
]);

function isDatabaseKey(k: string): boolean {
  return DB_PREFIXES.some((p) => k.startsWith(p)) || PG_LIBPQ.has(k) || k === 'DATABASE_URL';
}

export function isDevforgeManagedKey(key: string): boolean {
  const k = key.trim();
  if (!k) return false;
  if (MANAGED_EXACT.has(k)) return true;
  if (AUTH_PREFIXES.some((p) => k.startsWith(p))) return true;
  if (isDatabaseKey(k)) return true;
  return false;
}

export function classifyEnvKey(key: string): EnvGroupId {
  const k = key.trim();
  if (RUNTIME_EXACT.has(k)) return 'runtime';
  if (AUTH_PREFIXES.some((p) => k.startsWith(p)) || k === 'POCKET_ID_URL') {
    return 'auth';
  }
  if (isDatabaseKey(k)) return 'database';
  if (isDevforgeManagedKey(k)) return 'other';
  return 'other';
}

export type EnvRowLike = { key: string };

export type PartitionedEnv<T extends EnvRowLike> = {
  custom: T[];
  managed: T[];
  managedByGroup: Array<EnvGroupMeta & { rows: T[] }>;
};

function sortByKey<T extends EnvRowLike>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.key.localeCompare(b.key, undefined, { sensitivity: 'base' }));
}

/** Sépare custom / DevForge et regroupe les gérées par type (sinon tri alpha). */
export function partitionEnvRows<T extends EnvRowLike>(rows: T[]): PartitionedEnv<T> {
  const custom: T[] = [];
  const managed: T[] = [];
  for (const row of rows) {
    if (isDevforgeManagedKey(row.key)) managed.push(row);
    else custom.push(row);
  }

  const buckets = new Map<EnvGroupId, T[]>();
  for (const meta of ENV_GROUP_ORDER) buckets.set(meta.id, []);
  for (const row of managed) {
    const id = classifyEnvKey(row.key);
    buckets.get(id)!.push(row);
  }

  const managedByGroup = ENV_GROUP_ORDER.map((meta) => ({
    ...meta,
    rows: sortByKey(buckets.get(meta.id) ?? []),
  })).filter((g) => g.rows.length > 0);

  return {
    custom: sortByKey(custom),
    managed: sortByKey(managed),
    managedByGroup,
  };
}
