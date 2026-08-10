import {
    RefreshCw,
    Play,
    Square,
    RotateCcw,
    Terminal,
    Plus,
    Trash2,
    Link2,
    ExternalLink,
    AlertTriangle,
} from 'lucide-preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { PageHeader } from '../../components/PageHeader';
import { Card } from '../../components/ui/Card';
import { DataState } from '../../components/ui/DataState';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { ActionToolbar } from '../../components/ui/ActionToolbar';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { CreateRunnerModal, type CreateRunnerPrefill } from '../../components/runners/CreateRunnerModal';
import {
    domainApi,
    type GithubRunner,
    type GithubRunnerAction,
} from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';
import { navigateTo } from '../../lib/use-navigate';
import { applicationPath } from '../../lib/application-tabs';
import {
    appsWithoutRunners,
    applicationsWithGit,
    coherenceLabel,
    coherenceTone,
    dockerActionAvailability,
    linkableApplications,
    linkedAppsForRunner,
    runnerCoherence,
    runnerRepoKey,
    runnerRoleLabel,
    type LinkedApplication,
    type RunnerCoherence,
} from '../../lib/runners/runner-coherence';

type ListFilter = 'all' | 'linked' | 'orphan' | 'gaps';

function runnerStateTone(state: string): 'success' | 'warning' | 'neutral' | 'error' {
    const normalized = state.toLowerCase();
    if (normalized === 'running' || normalized === 'online') {
        return 'success';
    }
    if (normalized === 'busy' || normalized === 'restarting' || normalized === 'created' || normalized === 'paused') {
        return 'warning';
    }
    if (normalized === 'exited' || normalized === 'dead' || normalized === 'offline') {
        return 'error';
    }
    return 'neutral';
}

function githubStatusLabel(runner: GithubRunner): string | null {
    if (!runner.github_status) {
        return null;
    }

    if (runner.github_status === 'busy' || runner.github_busy) {
        return 'busy';
    }

    return runner.github_status;
}

function runnerRepoLabel(runner: GithubRunner): string {
    return runnerRepoKey(runner) ?? 'Repo non détecté';
}

function actionLabel(action: GithubRunnerAction): string {
    return ({
        start: 'Démarrer',
        stop: 'Arrêter',
        restart: 'Redémarrer',
    })[action];
}

function filterLabel(filter: ListFilter, counts: Record<ListFilter, number>): string {
    const labels: Record<ListFilter, string> = {
        all: `Tous (${counts.all})`,
        linked: `Liés (${counts.linked})`,
        orphan: `Sans app (${counts.orphan})`,
        gaps: `Apps sans runner (${counts.gaps})`,
    };
    return labels[filter];
}

export function RunnersPage() {
    const runners = useApiQuery('github-runners', () => domainApi.githubRunners());
    const applications = useApiQuery('github-runners-apps', () => domainApi.coreResources('applications'));
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [listFilter, setListFilter] = useState<ListFilter>('all');
    const [lines, setLines] = useState(200);
    const [actionBusy, setActionBusy] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [logsRefreshing, setLogsRefreshing] = useState(false);
    const [createOpen, setCreateOpen] = useState(false);
    const [createPrefill, setCreatePrefill] = useState<CreateRunnerPrefill | null>(null);
    const [feedback, setFeedback] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pendingAction, setPendingAction] = useState<{
        runner: GithubRunner;
        action: GithubRunnerAction;
    } | null>(null);
    const [pendingDelete, setPendingDelete] = useState<GithubRunner | null>(null);
    const [logsEnabled, setLogsEnabled] = useState(false);
    const [detailEnabled, setDetailEnabled] = useState(false);
    const [linkAppUuid, setLinkAppUuid] = useState('');
    const [linkRole, setLinkRole] = useState('frontend');
    const [linkBusy, setLinkBusy] = useState(false);
    const logsEndRef = useRef<HTMLDivElement | null>(null);
    const stickLogsToBottom = useRef(true);

    const items = runners.data?.data ?? [];
    const linkedApps = useMemo(
        () => applicationsWithGit(applications.data?.data ?? []),
        [applications.data],
    );
    const gaps = useMemo(
        () => appsWithoutRunners(linkedApps, items),
        [linkedApps, items],
    );

    const runnerMeta = useMemo(() => {
        const map = new Map<string, {
            apps: LinkedApplication[];
            coherence: RunnerCoherence;
        }>();

        for (const runner of items) {
            const apps = linkedAppsForRunner(runner, linkedApps);
            map.set(runner.id, {
                apps,
                coherence: runnerCoherence(runner, apps),
            });
        }

        return map;
    }, [items, linkedApps]);

    const counts = useMemo(() => {
        let linked = 0;
        let orphan = 0;
        for (const meta of runnerMeta.values()) {
            if (meta.coherence === 'linked') {
                linked += 1;
            } else {
                orphan += 1;
            }
        }

        return {
            all: items.length,
            linked,
            orphan,
            gaps: gaps.length,
        } satisfies Record<ListFilter, number>;
    }, [items.length, runnerMeta, gaps.length]);

    const filteredRunners = useMemo(() => {
        if (listFilter === 'all') {
            return items;
        }
        if (listFilter === 'linked') {
            return items.filter((runner) => runnerMeta.get(runner.id)?.coherence === 'linked');
        }
        if (listFilter === 'orphan') {
            return items.filter((runner) => runnerMeta.get(runner.id)?.coherence !== 'linked');
        }
        return [];
    }, [items, listFilter, runnerMeta]);

    const selected = useMemo(
        () => filteredRunners.find((runner) => runner.id === selectedId)
            ?? items.find((runner) => runner.id === selectedId)
            ?? filteredRunners[0]
            ?? null,
        [filteredRunners, items, selectedId],
    );

    useEffect(() => {
        if (listFilter === 'gaps') {
            return;
        }
        if (!selectedId && filteredRunners[0]) {
            setSelectedId(filteredRunners[0].id);
        }
        if (selectedId && filteredRunners.length > 0 && !filteredRunners.some((runner) => runner.id === selectedId)) {
            setSelectedId(filteredRunners[0]?.id ?? null);
        }
    }, [filteredRunners, selectedId, listFilter]);

    // Stagger detail / logs so the list can paint before heavier SSH calls.
    useEffect(() => {
        setDetailEnabled(false);
        setLogsEnabled(false);
        if (!selected || listFilter === 'gaps') {
            return;
        }

        const detailTimer = window.setTimeout(() => setDetailEnabled(true), 150);
        const logsTimer = window.setTimeout(() => setLogsEnabled(true), 600);

        return () => {
            window.clearTimeout(detailTimer);
            window.clearTimeout(logsTimer);
        };
    }, [selected?.id, listFilter]);

    const detail = useApiQuery(
        detailEnabled && selected && listFilter !== 'gaps'
            ? `github-runner:${selected.server_uuid}:${selected.name}`
            : null,
        () => domainApi.githubRunner(selected!.server_uuid, selected!.name),
    );

    const logs = useApiQuery(
        logsEnabled && selected && listFilter !== 'gaps'
            ? `github-runner-logs:${selected.server_uuid}:${selected.name}:${lines}`
            : null,
        () => domainApi.githubRunnerLogs(selected!.server_uuid, selected!.name, lines),
    );

    const logsReloadRef = useRef(logs.reload);
    const detailReloadRef = useRef(detail.reload);
    logsReloadRef.current = logs.reload;
    detailReloadRef.current = detail.reload;

    useEffect(() => {
        if (!selected || listFilter === 'gaps' || !logsEnabled) {
            return;
        }

        const interval = window.setInterval(() => {
            setLogsRefreshing(true);
            void logsReloadRef.current({ silent: true }).finally(() => setLogsRefreshing(false));
        }, 15_000);

        return () => window.clearInterval(interval);
    }, [selected?.id, lines, listFilter, logsEnabled]);

    useEffect(() => {
        if (stickLogsToBottom.current) {
            logsEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    }, [logs.data?.data?.items?.length, selected?.id]);

    async function refreshAll() {
        setRefreshing(true);
        setFeedback(null);
        setError(null);
        try {
            await Promise.all([
                runners.reload({ silent: true }),
                applications.reload({ silent: true }),
                selected ? detail.reload({ silent: true }) : Promise.resolve(),
                selected ? logs.reload({ silent: true }) : Promise.resolve(),
            ]);
        } finally {
            setRefreshing(false);
        }
    }

    async function runAction(runner: GithubRunner, action: GithubRunnerAction) {
        setActionBusy(true);
        setFeedback(null);
        setError(null);
        try {
            const result = await domainApi.githubRunnerAction(runner.server_uuid, runner.name, action);
            setFeedback(result.message ?? result.data.message);
            await runners.reload({ silent: true });
            if (selected?.id === runner.id) {
                await Promise.all([detail.reload({ silent: true }), logs.reload({ silent: true })]);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Action impossible.');
        } finally {
            setActionBusy(false);
            setPendingAction(null);
        }
    }

    async function runDelete(runner: GithubRunner) {
        setActionBusy(true);
        setFeedback(null);
        setError(null);
        try {
            const result = await domainApi.deleteGithubRunner(runner.server_uuid, runner.name);
            setFeedback(result.message ?? 'Runner supprimé.');
            setSelectedId(null);
            await runners.reload({ silent: true });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Suppression impossible.');
        } finally {
            setActionBusy(false);
            setPendingDelete(null);
        }
    }

    async function attachSelectedApp() {
        if (!selected || !linkAppUuid) {
            return;
        }
        setLinkBusy(true);
        setFeedback(null);
        setError(null);
        try {
            const result = await domainApi.attachGithubRunnerApplication(selected.server_uuid, selected.name, {
                application_uuid: linkAppUuid,
                role: linkRole || null,
            });
            setFeedback(result.message ?? 'Runner lié.');
            setLinkAppUuid('');
            await Promise.all([
                runners.reload({ silent: true }),
                detailEnabled ? detail.reload({ silent: true }) : Promise.resolve(),
            ]);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Liaison impossible.');
        } finally {
            setLinkBusy(false);
        }
    }

    async function detachLinkedApp(applicationUuid: string) {
        if (!selected) {
            return;
        }
        setLinkBusy(true);
        setFeedback(null);
        setError(null);
        try {
            const result = await domainApi.detachGithubRunnerApplication(
                selected.server_uuid,
                selected.name,
                applicationUuid,
            );
            setFeedback(result.message ?? 'Lien supprimé.');
            await Promise.all([
                runners.reload({ silent: true }),
                detailEnabled ? detail.reload({ silent: true }) : Promise.resolve(),
            ]);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Suppression du lien impossible.');
        } finally {
            setLinkBusy(false);
        }
    }

    function openCreate(prefill?: CreateRunnerPrefill | null) {
        setCreatePrefill(prefill ?? null);
        setCreateOpen(true);
    }

    const detailRunner = detail.data?.data ?? selected;
    const logData = logs.data?.data;
    const detailGithub = detailRunner ? githubStatusLabel(detailRunner) : null;
    const selectedMeta = selected ? runnerMeta.get(selected.id) : null;
    const attachCandidates = useMemo(
        () => linkableApplications(linkedApps, selectedMeta?.apps ?? []),
        [linkedApps, selectedMeta?.apps],
    );
    const actions = dockerActionAvailability(detailRunner?.state ?? selected?.state);
    const pageLoading = runners.loading && !runners.data;

    return (
        <>
            <PageHeader
                title="Runners GitHub"
                description="Liez vos runners self-hosted aux applications DevForge, suivez la cohérence Docker ↔ GitHub, et pilotez les conteneurs."
                eyebrow="CI / CD"
                actions={(
                    <>
                        <button class="btn btn-primary btn-sm" type="button" onClick={() => openCreate()}>
                            <Plus class="size-3.5" aria-hidden />
                            Nouveau runner
                        </button>
                        <button
                            class="btn btn-ghost btn-sm"
                            type="button"
                            disabled={refreshing}
                            onClick={() => void refreshAll()}
                        >
                            {refreshing
                                ? <span class="loading loading-spinner loading-xs" aria-hidden />
                                : <RefreshCw class="size-3.5" aria-hidden />}
                            Actualiser
                        </button>
                    </>
                )}
            />

            {(feedback || error) && (
                <p class={`mb-3 rounded-xl border px-3 py-2 text-xs ${error ? 'border-error/30 bg-error/10 text-error' : 'border-success/30 bg-success/10 text-success'}`}>
                    {error ?? feedback}
                </p>
            )}

            <div class="mb-4 flex flex-wrap gap-2">
                {(['all', 'linked', 'orphan', 'gaps'] as ListFilter[]).map((filter) => (
                    <button
                        key={filter}
                        type="button"
                        class={`btn btn-sm ${listFilter === filter ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => setListFilter(filter)}
                    >
                        {filterLabel(filter, counts)}
                    </button>
                ))}
            </div>

            <DataState
                loading={pageLoading}
                error={(runners.error && !runners.data) || (applications.error && !applications.data)
                    ? (runners.error ?? applications.error)
                    : null}
                onRetry={() => void refreshAll()}
            >
                <div class="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
                    <Card
                        title={listFilter === 'gaps' ? 'Applications' : 'Runners'}
                        eyebrow={listFilter === 'gaps'
                            ? `${gaps.length} sans runner`
                            : `${filteredRunners.length} affiché(s)`}
                    >
                        {listFilter === 'gaps' ? (
                            gaps.length === 0 ? (
                                <p class="text-xs text-base-content/55">
                                    Toutes les apps Git ont au moins un runner détecté.
                                </p>
                            ) : (
                                <ul class="divide-y divide-base-300">
                                    {gaps.map((app) => (
                                        <li key={app.uuid} class="flex flex-col gap-2 px-1 py-3">
                                            <div class="flex items-start justify-between gap-2">
                                                <div class="min-w-0">
                                                    <p class="truncate text-sm font-medium">{app.name}</p>
                                                    <p class="truncate font-mono text-[11px] text-base-content/45">{app.repo_key}</p>
                                                </div>
                                                <StatusBadge label="sans runner" tone="warning" />
                                            </div>
                                            <div class="flex flex-wrap gap-2">
                                                <button
                                                    type="button"
                                                    class="btn btn-primary btn-xs"
                                                    onClick={() => openCreate({
                                                        owner: app.repo_key.split('/')[0],
                                                        repo: app.repo_key.split('/')[1],
                                                        runner_name: `devforge-runner-${app.repo_key.split('/')[1]}`.slice(0, 64),
                                                        image: 'myoung34/github-runner:latest',
                                                    })}
                                                >
                                                    <Plus class="size-3" aria-hidden />
                                                    Créer un runner
                                                </button>
                                                <button
                                                    type="button"
                                                    class="btn btn-ghost btn-xs"
                                                    onClick={() => navigateTo(applicationPath(app.uuid))}
                                                >
                                                    <ExternalLink class="size-3" aria-hidden />
                                                    Ouvrir l’app
                                                </button>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )
                        ) : filteredRunners.length === 0 ? (
                            <p class="text-xs text-base-content/55">
                                Aucun runner dans ce filtre. Créez-en un ou changez de vue.
                            </p>
                        ) : (
                            <ul class="divide-y divide-base-300">
                                {filteredRunners.map((runner) => {
                                    const active = selected?.id === runner.id;
                                    const gh = githubStatusLabel(runner);
                                    const meta = runnerMeta.get(runner.id);
                                    const apps = meta?.apps ?? [];
                                    const coherence = meta?.coherence ?? 'unsynced';

                                    return (
                                        <li key={runner.id}>
                                            <button
                                                type="button"
                                                class={`flex w-full flex-col gap-1.5 px-1 py-3 text-start transition-colors ${active ? 'bg-primary/5 text-primary' : 'hover:bg-base-200/60'}`}
                                                onClick={() => setSelectedId(runner.id)}
                                            >
                                                <span class="flex items-center justify-between gap-2">
                                                    <span class="truncate text-sm font-medium">{runner.name}</span>
                                                    <span class="flex shrink-0 gap-1">
                                                        {gh && <StatusBadge label={gh} tone={runnerStateTone(gh)} />}
                                                        <StatusBadge label={runner.state || 'unknown'} tone={runnerStateTone(runner.state)} />
                                                    </span>
                                                </span>
                                                <span class="truncate text-[11px] text-base-content/45">
                                                    {runner.server_name} · {runnerRepoLabel(runner)}
                                                </span>
                                                <span class="flex flex-wrap items-center gap-1">
                                                    <StatusBadge
                                                        label={coherenceLabel(coherence)}
                                                        tone={coherenceTone(coherence)}
                                                    />
                                                    {apps.slice(0, 2).map((app) => (
                                                        <span
                                                            key={app.uuid}
                                                            class="inline-flex max-w-[9rem] items-center gap-1 truncate rounded-full border border-base-300/80 bg-base-200/50 px-2 py-0.5 text-[10px] text-base-content/70"
                                                        >
                                                            <Link2 class="size-2.5 shrink-0" aria-hidden />
                                                            {app.name}
                                                        </span>
                                                    ))}
                                                    {apps.length > 2 && (
                                                        <span class="text-[10px] text-base-content/45">+{apps.length - 2}</span>
                                                    )}
                                                </span>
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </Card>

                    <div class="grid gap-4">
                        {listFilter === 'gaps' ? (
                            <Card title="Cohérence CI">
                                <p class="text-sm text-base-content/60">
                                    Ces applications Git n’ont aucun runner Docker détecté sur vos serveurs.
                                    Créez un runner pour chaque dépôt afin que les workflows self-hosted puissent tourner.
                                </p>
                                {gaps.length > 0 && (
                                    <p class="mt-3 flex items-start gap-2 text-xs text-warning">
                                        <AlertTriangle class="mt-0.5 size-3.5 shrink-0" aria-hidden />
                                        {gaps.length} application{gaps.length > 1 ? 's' : ''} sans runner.
                                    </p>
                                )}
                            </Card>
                        ) : !selected ? (
                            <Card title="Détail">
                                <p class="text-sm text-base-content/55">Sélectionnez un runner pour voir ses logs et actions.</p>
                            </Card>
                        ) : (
                            <>
                                <Card title={detailRunner?.name ?? selected.name} eyebrow={detailRunner?.server_name ?? selected.server_name}>
                                    <ActionToolbar class="mb-4">
                                        <button
                                            class="btn btn-ghost btn-sm"
                                            type="button"
                                            disabled={actionBusy || !actions.canStart}
                                            title={actions.canStart ? 'Démarrer le conteneur' : 'Déjà en cours d’exécution'}
                                            onClick={() => setPendingAction({ runner: selected, action: 'start' })}
                                        >
                                            <Play class="size-3.5" aria-hidden />
                                            Démarrer
                                        </button>
                                        <button
                                            class="btn btn-ghost btn-sm"
                                            type="button"
                                            disabled={actionBusy || !actions.canStop}
                                            title={actions.canStop ? 'Arrêter le conteneur' : 'Le conteneur n’est pas démarré'}
                                            onClick={() => setPendingAction({ runner: selected, action: 'stop' })}
                                        >
                                            <Square class="size-3.5" aria-hidden />
                                            Arrêter
                                        </button>
                                        <button
                                            class="btn btn-ghost btn-sm"
                                            type="button"
                                            disabled={actionBusy || !actions.canRestart}
                                            onClick={() => setPendingAction({ runner: selected, action: 'restart' })}
                                        >
                                            <RotateCcw class="size-3.5" aria-hidden />
                                            Redémarrer
                                        </button>
                                        <button
                                            class="btn btn-ghost btn-sm text-error"
                                            type="button"
                                            disabled={actionBusy}
                                            onClick={() => setPendingDelete(selected)}
                                        >
                                            <Trash2 class="size-3.5" aria-hidden />
                                            Supprimer
                                        </button>
                                    </ActionToolbar>

                                    <DataState
                                        loading={detail.loading && !detail.data}
                                        error={detail.error && !detail.data ? detail.error : null}
                                        onRetry={() => void detail.reload()}
                                    >
                                        <dl class="grid gap-3 text-xs sm:grid-cols-2">
                                            <div>
                                                <dt class="text-base-content/45">Docker</dt>
                                                <dd class="mt-1">
                                                    <StatusBadge
                                                        label={detailRunner?.status || detailRunner?.state || 'unknown'}
                                                        tone={runnerStateTone(detailRunner?.state ?? '')}
                                                    />
                                                </dd>
                                            </div>
                                            <div>
                                                <dt class="text-base-content/45">GitHub Actions</dt>
                                                <dd class="mt-1">
                                                    {detailGithub
                                                        ? <StatusBadge label={detailGithub} tone={runnerStateTone(detailGithub)} />
                                                        : <span class="text-base-content/45">Non synchronisé</span>}
                                                </dd>
                                            </div>
                                            <div>
                                                <dt class="text-base-content/45">Cohérence</dt>
                                                <dd class="mt-1">
                                                    <StatusBadge
                                                        label={coherenceLabel(selectedMeta?.coherence ?? 'unsynced')}
                                                        tone={coherenceTone(selectedMeta?.coherence ?? 'unsynced')}
                                                    />
                                                </dd>
                                            </div>
                                            <div>
                                                <dt class="text-base-content/45">Dépôt</dt>
                                                <dd class="mt-1 break-all font-mono text-[11px]">{runnerRepoLabel(detailRunner ?? selected)}</dd>
                                            </div>
                                            <div>
                                                <dt class="text-base-content/45">Image</dt>
                                                <dd class="mt-1 break-all font-mono text-[11px]">{detailRunner?.image || '—'}</dd>
                                            </div>
                                            <div>
                                                <dt class="text-base-content/45">Nom GitHub</dt>
                                                <dd class="mt-1 font-mono text-[11px]">{detailRunner?.runner_name || '—'}</dd>
                                            </div>
                                        </dl>

                                        <div class="mt-4">
                                            <p class="mb-2 text-[11px] font-semibold uppercase tracking-widest text-base-content/40">
                                                Applications liées
                                            </p>
                                            <p class="mb-3 text-xs text-base-content/55">
                                                Une app peut avoir plusieurs runners (frontend, backend, desktop…).
                                                Le match auto par dépôt reste actif ; vous pouvez aussi lier manuellement.
                                            </p>
                                            {(selectedMeta?.apps.length ?? 0) === 0 ? (
                                                <p class="rounded-xl border border-warning/25 bg-warning/5 px-3 py-2 text-xs text-base-content/65">
                                                    Aucune application liée. Reliez manuellement ci-dessous, ou créez une app
                                                    avec le même <code class="text-[11px]">git_repository</code>.
                                                </p>
                                            ) : (
                                                <ul class="grid gap-2">
                                                    {selectedMeta!.apps.map((app) => (
                                                        <li key={app.uuid} class="flex items-stretch gap-2">
                                                            <button
                                                                type="button"
                                                                class="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-xl border border-base-300/70 bg-base-200/30 px-3 py-2 text-start transition-colors hover:border-primary/40 hover:bg-primary/5"
                                                                onClick={() => navigateTo(applicationPath(app.uuid))}
                                                            >
                                                                <span class="min-w-0">
                                                                    <span class="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                                                                        <Link2 class="size-3.5 shrink-0 text-primary" aria-hidden />
                                                                        <span class="truncate">{app.name}</span>
                                                                        {runnerRoleLabel(app.role) && (
                                                                            <StatusBadge label={runnerRoleLabel(app.role)!} tone="neutral" />
                                                                        )}
                                                                        <StatusBadge
                                                                            label={app.link_source === 'manual' ? 'manuel' : 'auto'}
                                                                            tone={app.link_source === 'manual' ? 'success' : 'neutral'}
                                                                        />
                                                                    </span>
                                                                    <span class="mt-0.5 block truncate font-mono text-[11px] text-base-content/45">
                                                                        {app.repo_key || 'repo non défini'}
                                                                        {app.git_branch ? ` · ${app.git_branch}` : ''}
                                                                    </span>
                                                                </span>
                                                                <StatusBadge
                                                                    label={app.status.split(':')[0] || app.status}
                                                                    tone={runnerStateTone(app.status.split(':')[0] || '')}
                                                                />
                                                            </button>
                                                            {app.link_source === 'manual' && (
                                                                <button
                                                                    type="button"
                                                                    class="btn btn-ghost btn-sm text-error"
                                                                    disabled={linkBusy}
                                                                    title="Retirer le lien manuel"
                                                                    onClick={() => void detachLinkedApp(app.uuid)}
                                                                >
                                                                    <Trash2 class="size-3.5" aria-hidden />
                                                                </button>
                                                            )}
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}

                                            <div class="mt-3 grid gap-2 rounded-xl border border-base-300/70 bg-base-200/20 p-3 sm:grid-cols-[1fr_8rem_auto]">
                                                <label class="grid gap-1 text-xs">
                                                    <span class="text-base-content/45">Lier une application</span>
                                                    <select
                                                        class="select select-bordered select-sm w-full"
                                                        value={linkAppUuid}
                                                        onChange={(event) => setLinkAppUuid((event.target as HTMLSelectElement).value)}
                                                    >
                                                        <option value="">Choisir…</option>
                                                        {attachCandidates.map((app) => (
                                                            <option key={app.uuid} value={app.uuid}>
                                                                {app.name} ({app.repo_key})
                                                            </option>
                                                        ))}
                                                    </select>
                                                </label>
                                                <label class="grid gap-1 text-xs">
                                                    <span class="text-base-content/45">Rôle</span>
                                                    <select
                                                        class="select select-bordered select-sm w-full"
                                                        value={linkRole}
                                                        onChange={(event) => setLinkRole((event.target as HTMLSelectElement).value)}
                                                    >
                                                        <option value="frontend">Frontend</option>
                                                        <option value="backend">Backend</option>
                                                        <option value="desktop">Desktop</option>
                                                        <option value="ci">CI</option>
                                                        <option value="other">Autre</option>
                                                    </select>
                                                </label>
                                                <div class="flex items-end">
                                                    <button
                                                        type="button"
                                                        class="btn btn-primary btn-sm w-full"
                                                        disabled={linkBusy || !linkAppUuid}
                                                        onClick={() => void attachSelectedApp()}
                                                    >
                                                        <Link2 class="size-3.5" aria-hidden />
                                                        Lier
                                                    </button>
                                                </div>
                                            </div>
                                        </div>

                                        {(detailRunner?.environment?.length ?? 0) > 0 && (
                                            <div class="mt-4">
                                                <p class="mb-2 text-[11px] font-semibold uppercase tracking-widest text-base-content/40">Variables</p>
                                                <ul class="max-h-40 overflow-auto rounded-xl border border-base-300 bg-base-200/40 p-3 font-mono text-[11px]">
                                                    {detailRunner!.environment!.map((entry) => (
                                                        <li key={entry.key} class="flex gap-2 py-0.5">
                                                            <span class="shrink-0 text-base-content/50">{entry.key}=</span>
                                                            <span class="break-all">{entry.value}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                    </DataState>
                                </Card>

                                <section class="rounded-2xl border border-base-300/70 bg-base-100 shadow-sm">
                                    <div class="toolbar-row border-b border-base-300/70 px-5 py-4">
                                        <div class="flex items-center gap-2">
                                            <Terminal class="size-4 text-base-content/45" aria-hidden />
                                            <div>
                                                <p class="text-sm font-semibold">Logs</p>
                                                <p class="text-xs text-base-content/50">
                                                    {logsRefreshing ? 'Mise à jour…' : 'stdout / stderr · refresh auto 15s'}
                                                </p>
                                            </div>
                                        </div>
                                        <div class="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                                            <label class="flex items-center gap-2 text-xs">
                                                <span class="text-base-content/45">Lignes</span>
                                                <select
                                                    class="select select-bordered select-sm w-full sm:w-auto"
                                                    value={lines}
                                                    onChange={(event) => setLines(Number((event.target as HTMLSelectElement).value))}
                                                >
                                                    {[100, 200, 500].map((option) => (
                                                        <option key={option} value={option}>{option}</option>
                                                    ))}
                                                </select>
                                            </label>
                                            <button
                                                class="btn btn-ghost btn-sm"
                                                type="button"
                                                disabled={logsRefreshing}
                                                onClick={() => {
                                                    setLogsRefreshing(true);
                                                    void logs.reload({ silent: true }).finally(() => setLogsRefreshing(false));
                                                }}
                                            >
                                                {logsRefreshing
                                                    ? <span class="loading loading-spinner loading-xs" aria-hidden />
                                                    : <RefreshCw class="size-3.5" aria-hidden />}
                                                Actualiser
                                            </button>
                                        </div>
                                    </div>
                                    <div class="p-5">
                                        <DataState
                                            loading={logs.loading && !logs.data}
                                            error={logs.error && !logs.data ? logs.error : null}
                                            onRetry={() => void logs.reload()}
                                        >
                                            {logData ? (
                                                <>
                                                    {!logData.available && (
                                                        <p class="mb-3 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                                                            {logData.message ?? 'Logs indisponibles.'}
                                                        </p>
                                                    )}
                                                    <div
                                                        class={`max-h-[28rem] overflow-auto rounded-xl border border-base-300 bg-black p-3 font-mono text-[11px] leading-5 text-zinc-200 transition-opacity ${logsRefreshing ? 'opacity-80' : 'opacity-100'}`}
                                                        onScroll={(event) => {
                                                            const el = event.currentTarget;
                                                            stickLogsToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
                                                        }}
                                                    >
                                                        {logData.items.length === 0 ? (
                                                            <p class="text-zinc-500">Aucune ligne de log.</p>
                                                        ) : logData.items.map((line) => (
                                                            <div key={line.cursor}>
                                                                <span class="me-2 select-none text-zinc-600">{line.cursor}</span>
                                                                {line.message}
                                                            </div>
                                                        ))}
                                                        <div ref={logsEndRef} />
                                                    </div>
                                                </>
                                            ) : (
                                                <div class="flex min-h-24 items-center justify-center gap-2 text-xs text-base-content/55">
                                                    <span class="loading loading-spinner loading-xs text-primary" aria-hidden />
                                                    Chargement des logs…
                                                </div>
                                            )}
                                        </DataState>
                                    </div>
                                </section>
                            </>
                        )}
                    </div>
                </div>
            </DataState>

            <ConfirmDialog
                open={pendingAction !== null}
                title={pendingAction ? `${actionLabel(pendingAction.action)} ${pendingAction.runner.name}` : ''}
                message={pendingAction
                    ? `Confirmer l’action « ${pendingAction.action} » sur le runner ${pendingAction.runner.name} (${pendingAction.runner.server_name}).`
                    : ''}
                confirmLabel={pendingAction ? actionLabel(pendingAction.action) : 'Confirmer'}
                tone={pendingAction?.action === 'stop' ? 'danger' : 'primary'}
                loading={actionBusy}
                onCancel={() => setPendingAction(null)}
                onConfirm={() => {
                    if (pendingAction) {
                        void runAction(pendingAction.runner, pendingAction.action);
                    }
                }}
            />

            <ConfirmDialog
                open={pendingDelete !== null}
                title={pendingDelete ? `Supprimer ${pendingDelete.name}` : ''}
                message={pendingDelete
                    ? `Supprimer définitivement le conteneur ${pendingDelete.name} sur ${pendingDelete.server_name} ?`
                    : ''}
                confirmLabel="Supprimer"
                tone="danger"
                loading={actionBusy}
                onCancel={() => setPendingDelete(null)}
                onConfirm={() => {
                    if (pendingDelete) {
                        void runDelete(pendingDelete);
                    }
                }}
            />

            <CreateRunnerModal
                open={createOpen}
                prefill={createPrefill}
                onClose={() => {
                    setCreateOpen(false);
                    setCreatePrefill(null);
                }}
                onCreated={() => {
                    setFeedback('Runner créé.');
                    setListFilter('all');
                    void runners.reload({ silent: true });
                    void applications.reload({ silent: true });
                }}
            />
        </>
    );
}
