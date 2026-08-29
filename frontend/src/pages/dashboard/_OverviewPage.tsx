import { ExternalLink, Play, RefreshCw, RotateCw, Search, Square } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { AgentAvatar } from '../../components/agents/AgentAvatar';
import { DataState } from '../../components/ui/DataState';
import { SkeletonCard } from '../../components/ui/Skeleton';
import { openCommandPalette } from '../../lib/command-palette';
import { domainApi, type CoreAction, type ResourceStatus } from '../../lib/domain-api';
import { dayGreeting, formatDashboardDate } from '../../lib/greeting';
import {
    pandaActionLabels,
    pandaAppActions,
    pandaAppDotClass,
    pandaAppState,
    pandaAppStateLabel,
} from '../../lib/pandaos-app-state';
import { agentDetailPath } from '../../lib/agent-routes';
import { applicationPath, routeHref } from '../../lib/routes';
import { useApiQuery } from '../../lib/use-api-query';
import { useNavigate } from '../../lib/use-navigate';

type OverviewPageProps = {
    userName?: string;
};

function AppStatusCard({
    application,
    acting,
    onNavigate,
    onAction,
}: {
    application: ResourceStatus;
    acting: CoreAction | null;
    onNavigate: (event: MouseEvent, path: string) => void;
    onAction: (application: ResourceStatus, action: CoreAction) => void;
}) {
    const state = pandaAppState(application.status);
    const actions = pandaAppActions(state);
    const href = applicationPath(application.uuid, 'agents');

    return (
        <article class="devforge-card flex min-w-0 flex-col gap-4 rounded-2xl border border-[#E5E7EB] bg-base-100 p-4">
            <a
                class="flex min-w-0 items-start justify-between gap-3"
                href={routeHref(href)}
                onClick={(event) => onNavigate(event, href)}
            >
                <div class="min-w-0">
                    <p class="truncate text-sm font-semibold">{application.name}</p>
                    <p class="mt-1 flex items-center gap-1.5 text-xs text-base-content/50">
                        <span class={`size-2 rounded-full ${pandaAppDotClass(state)}`} aria-hidden />
                        {pandaAppStateLabel(state)}
                    </p>
                </div>
            </a>
            <div class="mt-auto flex flex-wrap gap-1.5">
                {actions.map((action) => {
                    const Icon = action === 'start' ? Play : action === 'stop' ? Square : RotateCw;

                    return (
                        <button
                            key={action}
                            class="btn btn-ghost btn-xs border border-[#E5E7EB]"
                            type="button"
                            disabled={acting !== null}
                            onClick={() => onAction(application, action)}
                        >
                            <Icon class="size-3.5" aria-hidden />
                            {acting === action ? '…' : pandaActionLabels[action]}
                        </button>
                    );
                })}
                {state === 'running' && (
                    <a
                        class="btn btn-primary btn-xs"
                        href={routeHref(href)}
                        onClick={(event) => onNavigate(event, href)}
                    >
                        <ExternalLink class="size-3.5" aria-hidden />
                        Ouvrir
                    </a>
                )}
            </div>
        </article>
    );
}

export function OverviewPage({ userName = '' }: OverviewPageProps) {
    const onNavigate = useNavigate();
    const query = useApiQuery('overview', () => domainApi.overview());
    const overview = query.data?.data;
    const applications = overview?.resource_statuses.applications ?? [];
    const sessions = overview?.agent_activity ?? [];
    const [actingUuid, setActingUuid] = useState<string | null>(null);
    const [actingAction, setActingAction] = useState<CoreAction | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const greeting = dayGreeting(userName || 'toi');

    const runAction = async (application: ResourceStatus, action: CoreAction) => {
        setActingUuid(application.uuid);
        setActingAction(action);
        setActionError(null);

        try {
            await domainApi.coreAction('applications', application.uuid, action);
            await query.reload();
        } catch {
            setActionError(`Impossible d’${pandaActionLabels[action].toLowerCase()} « ${application.name} ».`);
        } finally {
            setActingUuid(null);
            setActingAction(null);
        }
    };

    return (
        <div class="mx-auto grid min-w-0 max-w-5xl gap-8">
            <header class="grid min-w-0 gap-2 pt-4 text-center sm:pt-8">
                <p class="text-xs font-medium uppercase tracking-[0.18em] text-base-content/40">
                    {formatDashboardDate()}
                </p>
                <h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">{greeting}</h1>
            </header>

            <button
                class="mx-auto flex w-full max-w-xl items-center gap-3 rounded-2xl border border-[#E5E7EB] bg-base-100 px-4 py-3 text-left shadow-sm transition hover:border-primary/40"
                type="button"
                onClick={() => openCommandPalette()}
            >
                <Search class="size-4 text-base-content/40" aria-hidden />
                <span class="flex-1 text-sm text-base-content/45">Rechercher une app, une commande…</span>
                <kbd class="hidden rounded-md border border-[#E5E7EB] px-1.5 py-0.5 text-[10px] text-base-content/45 sm:inline">
                    ⌘K
                </kbd>
            </button>

            {query.loading && (
                <div class="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {Array.from({ length: 3 }).map((_, index) => <SkeletonCard key={index} />)}
                </div>
            )}

            <DataState loading={false} error={query.error} onRetry={() => void query.reload()}>
                {overview && (
                    <div class="grid min-w-0 gap-8">
                        {sessions.length > 0 && (
                            <section class="grid min-w-0 gap-3">
                                <div class="flex items-end justify-between gap-3">
                                    <h2 class="text-sm font-semibold tracking-tight">Sessions récentes</h2>
                                    <a
                                        class="text-xs text-primary"
                                        href={routeHref('/agents')}
                                        onClick={(event) => onNavigate(event, '/agents')}
                                    >
                                        Voir tout
                                    </a>
                                </div>
                                <ul class="grid min-w-0 gap-2">
                                    {sessions.slice(0, 5).map((activity) => {
                                        const path = activity.agent?.uuid
                                            ? agentDetailPath(activity.agent.uuid)
                                            : '/agents';

                                        return (
                                            <li key={activity.uuid}>
                                                <a
                                                    class="flex min-w-0 items-center gap-3 rounded-2xl border border-[#E5E7EB] bg-base-100 px-3 py-2.5 transition hover:border-primary/30"
                                                    href={routeHref(path)}
                                                    onClick={(event) => onNavigate(event, path)}
                                                >
                                                    {activity.agent && (
                                                        <AgentAvatar
                                                            type={activity.agent.type}
                                                            color={activity.agent.avatar_color}
                                                            shape={activity.agent.avatar_shape}
                                                            name={activity.agent.name}
                                                            size="sm"
                                                            status={activity.status === 'failed' ? 'error' : activity.status === 'completed' ? 'idle' : 'running'}
                                                            animate={activity.status !== 'completed' && activity.status !== 'failed'}
                                                        />
                                                    )}
                                                    <div class="min-w-0 flex-1">
                                                        <p class="truncate text-sm font-medium">{activity.agent?.name ?? 'Agent'}</p>
                                                        <p class="line-clamp-2 break-words text-xs text-base-content/55">
                                                            {activity.summary || 'Exécution sans résumé'}
                                                        </p>
                                                    </div>
                                                </a>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </section>
                        )}

                        <section class="grid min-w-0 gap-3">
                            <div class="flex items-end justify-between gap-3">
                                <h2 class="text-sm font-semibold tracking-tight">Applications</h2>
                                <button
                                    class="btn btn-ghost btn-xs border border-[#E5E7EB]"
                                    type="button"
                                    onClick={() => void query.reload()}
                                >
                                    <RefreshCw class="size-3.5" aria-hidden />
                                    Actualiser
                                </button>
                            </div>

                            {actionError && (
                                <p class="rounded-xl border border-error/30 bg-error/10 px-3 py-2 text-xs text-error" role="alert">
                                    {actionError}
                                </p>
                            )}

                            {applications.length === 0 ? (
                                <div class="grid gap-3 rounded-2xl border border-dashed border-[#E5E7EB] bg-base-100 px-6 py-10 text-center">
                                    <p class="text-sm text-base-content/55">Aucune application dans cette équipe.</p>
                                    <a
                                        class="btn btn-primary btn-sm mx-auto"
                                        href={routeHref('/applications')}
                                        onClick={(event) => onNavigate(event, '/applications')}
                                    >
                                        Voir les applications
                                    </a>
                                </div>
                            ) : (
                                <div class="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                    {applications.map((application) => (
                                        <AppStatusCard
                                            key={application.uuid}
                                            application={application}
                                            acting={actingUuid === application.uuid ? actingAction : null}
                                            onNavigate={onNavigate}
                                            onAction={(app, action) => void runAction(app, action)}
                                        />
                                    ))}
                                </div>
                            )}
                        </section>
                    </div>
                )}
            </DataState>
        </div>
    );
}
