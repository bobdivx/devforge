import { Database, ExternalLink, Github, KeyRound, Plug, RefreshCw, Trash2 } from 'lucide-preact';
import { useMemo, useState } from 'preact/hooks';
import { PageHeader } from '../../components/PageHeader';
import { ConnectGithubButton, FinishGithubInstallButton } from '../../components/github/ConnectGithubButton';
import { SharedVariablesPanel } from '../../components/shared-variables/SharedVariablesPanel';
import { DevForgeMcpTokenCard } from '../../components/sources/DevForgeMcpTokenCard';
import { DataState } from '../../components/ui/DataState';
import { FilterBar } from '../../components/ui/FilterBar';
import { Modal } from '../../components/ui/Modal';
import { StatusBadge } from '../../components/ui/StatusBadge';
import type { BootstrapPermissions } from '../../lib/bootstrap';
import {
    CONNEXION_STATUS_LABEL,
    CONNEXION_STATUS_TONE,
    type ConnexionId,
    type ConnexionStatus,
    isTursoKey,
    matchesConnexionQuery,
    requestsForConnexion,
    resolveConnexionStatus,
    teamHasDefinedKey,
} from '../../lib/connexions-catalog';
import { domainApi, type AgentKeyRequest, type GithubAppSummary } from '../../lib/domain-api';
import { isGithubAppInstalled } from '../../lib/onboarding-github';
import { applicationPath } from '../../lib/routing/routes';
import { useApiQuery } from '../../lib/use-api-query';

type ConnexionsPageProps = {
    legacyBaseUrl?: string;
    githubAppUuid?: string | null;
    permissions?: BootstrapPermissions;
};

type CatalogItem = {
    id: ConnexionId;
    title: string;
    description: string;
    icon: typeof Github;
    status: ConnexionStatus;
};

function accountLabel(app: GithubAppSummary): string {
    if (app.account_login) {
        return `@${app.account_login}`;
    }

    if (app.display_name) {
        return app.display_name;
    }

    return app.name;
}

function accountSubtitle(app: GithubAppSummary): string {
    const parts: string[] = [];
    if (app.account_type === 'Organization') {
        parts.push('Organisation GitHub');
    } else if (app.account_type === 'User') {
        parts.push('Compte GitHub');
    }
    parts.push(`App technique · ${app.name}`);
    return parts.join(' · ');
}

function ServiceCard({ item, onOpen }: { item: CatalogItem; onOpen: () => void }) {
    const Icon = item.icon;

    return (
        <button
            class="min-w-0 rounded-2xl border border-base-300/70 bg-base-100 p-5 text-start shadow-sm transition hover:border-primary/40 hover:shadow-md"
            type="button"
            onClick={onOpen}
        >
            <div class="flex items-start gap-3">
                <div class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon class="size-5" aria-hidden />
                </div>
                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                        <h2 class="truncate text-sm sm:text-base font-semibold">{item.title}</h2>
                        <StatusBadge
                            label={CONNEXION_STATUS_LABEL[item.status]}
                            tone={CONNEXION_STATUS_TONE[item.status]}
                        />
                    </div>
                    <p class="mt-1 line-clamp-2 text-sm text-base-content/60">
                        {item.description}
                    </p>
                    <p class="mt-3 text-xs text-base-content/45">
                        {item.status === 'agent_request'
                            ? 'Un agent attend une valeur pour continuer.'
                            : item.status === 'connected'
                                ? 'Prêt à l’emploi pour l’équipe.'
                                : 'Ouvrir pour connecter ou coller la valeur manquante.'}
                    </p>
                </div>
            </div>
        </button>
    );
}

function AgentRequestForm({
    request,
    draft,
    saving,
    onDraftChange,
    onSubmit,
}: {
    request: AgentKeyRequest;
    draft: string;
    saving: boolean;
    onDraftChange: (value: string) => void;
    onSubmit: () => void;
}) {
    return (
        <form
            class="grid gap-2 rounded-xl border border-warning/30 bg-warning/5 p-3"
            onSubmit={(event) => {
                event.preventDefault();
                onSubmit();
            }}
        >
            <div class="flex flex-wrap items-center gap-2 text-sm">
                <span class="font-semibold">{request.agent?.name ?? request.agent_name ?? 'Agent'}</span>
                <span class="text-xs text-base-content/60">a besoin de</span>
                <code class="font-mono text-xs">{request.key_name}</code>
            </div>
            {request.application_name && (
                <p class="text-xs text-base-content/70">
                    Pour l’application{' '}
                    <a class="font-medium underline hover:text-primary" href={applicationPath(request.application_uuid ?? '')}>
                        {request.application_name}
                    </a>
                </p>
            )}
            {request.reason && <p class="text-xs text-base-content/70">{request.reason}</p>}
            <div class="flex flex-col gap-2 sm:flex-row">
                <input
                    class="input input-sm input-bordered min-w-0 flex-1 font-mono"
                    type="password"
                    autocomplete="off"
                    placeholder={`Valeur pour ${request.key_name}`}
                    value={draft}
                    onInput={(event) => onDraftChange((event.target as HTMLInputElement).value)}
                />
                <button class="btn btn-primary btn-sm" type="submit" disabled={saving || !draft.trim()}>
                    <KeyRound class="size-3.5" aria-hidden />
                    Fournir
                </button>
            </div>
        </form>
    );
}

export function ConnexionsPage({ permissions }: ConnexionsPageProps) {
    const apps = useApiQuery('github-apps', () => domainApi.githubApps());
    const agentRequests = useApiQuery('agent-key-requests', () => domainApi.agentKeyRequests());
    const sharedVariables = useApiQuery('shared-variables', () => domainApi.sharedVariables());
    const apiTokens = useApiQuery('security-api-tokens', () => domainApi.apiTokens());

    const [query, setQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [openId, setOpenId] = useState<ConnexionId | null>(null);
    const [tokenDrafts, setTokenDrafts] = useState<Record<string, string>>({});
    const [requestDrafts, setRequestDrafts] = useState<Record<string, string>>({});
    const [savingUuid, setSavingUuid] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const listedApps = apps.data?.data ?? [];
    const pendingApps = listedApps.filter((app) => !isGithubAppInstalled(app));
    const installedApps = listedApps.filter(isGithubAppInstalled);
    const teamVariables = sharedVariables.data?.data?.team ?? [];
    const requestRows = agentRequests.data?.data ?? [];

    const githubRequests = useMemo(() => requestsForConnexion(requestRows, 'github'), [requestRows]);
    const tursoRequests = useMemo(() => requestsForConnexion(requestRows, 'turso'), [requestRows]);
    const teamRequests = useMemo(() => requestsForConnexion(requestRows, 'team'), [requestRows]);

    const catalog = useMemo<CatalogItem[]>(() => {
        const githubInstalled = installedApps.length > 0;
        const tursoConfigured = teamHasDefinedKey(teamVariables, isTursoKey);
        const teamKeysConfigured = teamVariables.length > 0;
        const mcpConfigured = (apiTokens.data?.data ?? []).length > 0;
        const common = { requests: requestRows, githubInstalled, tursoConfigured, teamKeysConfigured, mcpConfigured };

        return [
            {
                id: 'github',
                title: 'GitHub',
                description: 'Reliez un compte GitHub pour déployer vos dépôts et gérer le token Packages.',
                icon: Github,
                status: resolveConnexionStatus({ id: 'github', ...common }),
            },
            {
                id: 'turso',
                title: 'Turso / bases',
                description: 'URL Turso ou DATABASE_URL pour les agents et les applications Astro DB.',
                icon: Database,
                status: resolveConnexionStatus({ id: 'turso', ...common }),
            },
            {
                id: 'team',
                title: 'Clés d’équipe',
                description: 'Variables et secrets partagés (OpenAI, Stripe…) accessibles par l’équipe et les agents.',
                icon: KeyRound,
                status: resolveConnexionStatus({ id: 'team', ...common }),
            },
            {
                id: 'mcp',
                title: 'MCP DevForge',
                description: 'Jetons API pour Cursor, l’API REST et le serveur MCP DevForge.',
                icon: Plug,
                status: resolveConnexionStatus({ id: 'mcp', ...common }),
            },
        ];
    }, [apiTokens.data, installedApps.length, requestRows, teamVariables]);

    const filtered = useMemo(() => catalog.filter((item) => {
        if (statusFilter && item.status !== statusFilter) {
            return false;
        }

        return matchesConnexionQuery(query, item);
    }), [catalog, query, statusFilter]);

    const loading = apps.loading || agentRequests.loading || sharedVariables.loading || apiTokens.loading;
    const loadError = apps.error ?? agentRequests.error ?? sharedVariables.error ?? apiTokens.error;

    async function reloadAll() {
        await Promise.all([
            apps.reload(),
            agentRequests.reload(),
            sharedVariables.reload(),
            apiTokens.reload(),
        ]);
    }

    async function savePackagesToken(app: GithubAppSummary, clear = false) {
        setSavingUuid(app.uuid);
        setFeedback(null);
        setError(null);
        try {
            const token = clear ? null : (tokenDrafts[app.uuid] ?? '').trim();
            if (!clear && !token) {
                setError('Colle un PAT GitHub (read:packages) avant d’enregistrer.');
                return;
            }
            const result = await domainApi.updateGithubPackagesToken(app.uuid, token);
            setFeedback(result.message ?? (clear ? 'Token supprimé.' : 'Token enregistré.'));
            setTokenDrafts((current) => ({ ...current, [app.uuid]: '' }));
            await apps.reload();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Enregistrement impossible.');
        } finally {
            setSavingUuid(null);
        }
    }

    async function fulfillAgentRequest(uuid: string) {
        const value = (requestDrafts[uuid] ?? '').trim();
        if (!value) {
            return;
        }

        setSavingUuid(uuid);
        setFeedback(null);
        setError(null);
        try {
            const result = await domainApi.fulfillAgentKeyRequest(uuid, value);
            setFeedback(result.message);
            setRequestDrafts((current) => ({ ...current, [uuid]: '' }));
            await agentRequests.reload();
            await sharedVariables.reload();
            window.dispatchEvent(new CustomEvent('devforge-reload-shared-variables'));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Enregistrement impossible.');
        } finally {
            setSavingUuid(null);
        }
    }

    const openItem = catalog.find((item) => item.id === openId) ?? null;

    return (
        <>
            <PageHeader
                eyebrow="Intégrations"
                title="Connexions"
                description="Catalogue d’intégrations : GitHub, Turso, clés d’équipe et MCP DevForge."
                actions={(
                    <button class="btn btn-ghost btn-sm" type="button" onClick={() => void reloadAll()}>
                        <RefreshCw class="size-3.5" aria-hidden />
                        Actualiser
                    </button>
                )}
            />
            {(feedback || error) && (
                <p class={`mb-3 text-sm ${error ? 'text-error' : 'text-success'}`} role="status">{error ?? feedback}</p>
            )}
            <div class="mb-4">
                <FilterBar
                    query={query}
                    placeholder="Rechercher une intégration…"
                    onQueryChange={setQuery}
                    sort={statusFilter}
                    sortOptions={[
                        { value: '', label: 'Tous les statuts' },
                        { value: 'agent_request', label: 'Demande agent' },
                        { value: 'needs_setup', label: 'À configurer' },
                        { value: 'connected', label: 'Branché' },
                    ]}
                    onSortChange={setStatusFilter}
                />
            </div>
            <DataState
                loading={loading}
                error={loadError}
                empty={filtered.length === 0}
                emptyMessage="Aucune intégration ne correspond à cette recherche."
                onRetry={() => void reloadAll()}
            >
                <div class="grid gap-2.5 sm:gap-3 md:gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {filtered.map((item) => (
                        <ServiceCard key={item.id} item={item} onOpen={() => setOpenId(item.id)} />
                    ))}
                </div>
            </DataState>

            <Modal
                title={openItem?.title ?? 'Connexion'}
                open={openId !== null}
                onClose={() => setOpenId(null)}
                size={openId === 'team' || openId === 'mcp' ? 'xl' : 'lg'}
            >
                {openId === 'github' && (
                    <div class="grid gap-3">
                        <p class="text-sm text-base-content/65">
                            Connectez GitHub pour autoriser DevForge à lire vos dépôts. Le PAT Packages est optionnel.
                        </p>
                        {githubRequests.map((request) => (
                            <AgentRequestForm
                                key={request.uuid}
                                request={request}
                                draft={requestDrafts[request.uuid] ?? ''}
                                saving={savingUuid === request.uuid}
                                onDraftChange={(value) => setRequestDrafts((current) => ({ ...current, [request.uuid]: value }))}
                                onSubmit={() => void fulfillAgentRequest(request.uuid)}
                            />
                        ))}
                        {pendingApps.length > 0 && (
                            <div class="grid gap-2 rounded-xl border border-base-300/70 p-3">
                                <p class="text-sm text-base-content/70">
                                    L’app {pendingApps[0].display_name ?? pendingApps[0].name} est créée, mais pas encore installée sur le compte.
                                </p>
                                <FinishGithubInstallButton app={pendingApps[0]} returnTo="applications" size="sm" onError={setError} />
                            </div>
                        )}
                        {installedApps.length === 0 && pendingApps.length === 0 && (
                            <ConnectGithubButton
                                returnTo="applications"
                                label="Relancer la configuration GitHub"
                                size="sm"
                                onError={setError}
                            />
                        )}
                        {installedApps.map((app) => (
                            <div key={app.uuid} class="grid gap-2 rounded-xl border border-base-300/70 p-3">
                                <div class="flex flex-wrap items-center justify-between gap-2">
                                    <div class="min-w-0">
                                        <p class="font-medium">{accountLabel(app)}</p>
                                        <p class="text-xs text-base-content/55">{accountSubtitle(app)}</p>
                                    </div>
                                    <StatusBadge
                                        label={app.has_packages_token ? 'PAT enregistré' : 'PAT optionnel'}
                                        tone={app.has_packages_token ? 'success' : 'neutral'}
                                    />
                                </div>
                                <div class="flex flex-wrap gap-2">
                                    {app.account_html_url && (
                                        <a class="btn btn-ghost btn-xs" href={app.account_html_url} target="_blank" rel="noreferrer">
                                            <ExternalLink class="size-3.5" aria-hidden />
                                            Profil
                                        </a>
                                    )}
                                    {app.html_url && (
                                        <a class="btn btn-ghost btn-xs" href={app.html_url} target="_blank" rel="noreferrer">
                                            <ExternalLink class="size-3.5" aria-hidden />
                                            App
                                        </a>
                                    )}
                                </div>
                                <form
                                    class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
                                    onSubmit={(event) => {
                                        event.preventDefault();
                                        void savePackagesToken(app);
                                    }}
                                >
                                    <label class="grid gap-1 text-sm">
                                        <span class="text-xs font-medium">Token Packages (read:packages)</span>
                                        <input
                                            class="input input-sm input-bordered font-mono"
                                            type="password"
                                            autocomplete="off"
                                            placeholder="ghp_… (PAT read:packages)"
                                            value={tokenDrafts[app.uuid] ?? ''}
                                            onInput={(event) => {
                                                const value = (event.target as HTMLInputElement).value;
                                                setTokenDrafts((current) => ({ ...current, [app.uuid]: value }));
                                            }}
                                        />
                                    </label>
                                    <div class="flex gap-2">
                                        <button class="btn btn-primary btn-sm" type="submit" disabled={savingUuid === app.uuid}>
                                            <KeyRound class="size-3.5" aria-hidden />
                                            Enregistrer
                                        </button>
                                        <button
                                            class="btn btn-ghost btn-sm text-error"
                                            type="button"
                                            disabled={!app.has_packages_token || savingUuid === app.uuid}
                                            onClick={() => void savePackagesToken(app, true)}
                                        >
                                            <Trash2 class="size-3.5" aria-hidden />
                                            Effacer
                                        </button>
                                    </div>
                                </form>
                            </div>
                        ))}
                    </div>
                )}

                {openId === 'turso' && (
                    <div class="grid gap-3">
                        <p class="text-sm text-base-content/65">
                            Collez l’URL Turso ou une DATABASE_URL. Les alias (ASTRO_DB_REMOTE_URL, TURSO_DATABASE_URL…) sont regroupés ici.
                        </p>
                        {tursoRequests.length === 0 ? (
                            <p class="text-sm text-base-content/55">
                                Aucune demande agent en attente. Ajoutez une clé d’équipe depuis la carte « Clés d’équipe » si besoin.
                            </p>
                        ) : tursoRequests.map((request) => (
                            <AgentRequestForm
                                key={request.uuid}
                                request={request}
                                draft={requestDrafts[request.uuid] ?? ''}
                                saving={savingUuid === request.uuid}
                                onDraftChange={(value) => setRequestDrafts((current) => ({ ...current, [request.uuid]: value }))}
                                onSubmit={() => void fulfillAgentRequest(request.uuid)}
                            />
                        ))}
                    </div>
                )}

                {openId === 'team' && (
                    <div class="grid gap-3">
                        {teamRequests.map((request) => (
                            <AgentRequestForm
                                key={request.uuid}
                                request={request}
                                draft={requestDrafts[request.uuid] ?? ''}
                                saving={savingUuid === request.uuid}
                                onDraftChange={(value) => setRequestDrafts((current) => ({ ...current, [request.uuid]: value }))}
                                onSubmit={() => void fulfillAgentRequest(request.uuid)}
                            />
                        ))}
                        <SharedVariablesPanel
                            path="team"
                            forceScope="team"
                            embedded
                            canManage={permissions?.manage_team ?? false}
                        />
                    </div>
                )}

                {openId === 'mcp' && <DevForgeMcpTokenCard embedded />}
            </Modal>
        </>
    );
}

/** @deprecated Prefer ConnexionsPage — alias pour compatibilité imports. */
export const GithubPage = ConnexionsPage;
/** @deprecated Prefer ConnexionsPage — alias pour compatibilité imports. */
export const SourcesPage = ConnexionsPage;
