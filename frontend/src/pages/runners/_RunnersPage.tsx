import { RefreshCw, Play, Square, RotateCcw, Terminal, Plus } from 'lucide-preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { PageHeader } from '../../components/PageHeader';
import { Card } from '../../components/ui/Card';
import { DataState } from '../../components/ui/DataState';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { ActionToolbar } from '../../components/ui/ActionToolbar';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { CreateRunnerModal } from '../../components/runners/CreateRunnerModal';
import {
    domainApi,
    type GithubRunner,
    type GithubRunnerAction,
} from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';

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
    if (runner.github_repo) {
        return runner.github_repo;
    }

    if (!runner.repo_url) {
        return 'Repo non détecté';
    }

    try {
        const url = new URL(runner.repo_url);
        return url.pathname.replace(/^\//, '') || runner.repo_url;
    } catch {
        return runner.repo_url;
    }
}

function actionLabel(action: GithubRunnerAction): string {
    return ({
        start: 'Démarrer',
        stop: 'Arrêter',
        restart: 'Redémarrer',
    })[action];
}

export function RunnersPage() {
    const runners = useApiQuery('github-runners', () => domainApi.githubRunners());
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [lines, setLines] = useState(200);
    const [actionBusy, setActionBusy] = useState(false);
    const [createOpen, setCreateOpen] = useState(false);
    const [feedback, setFeedback] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pendingAction, setPendingAction] = useState<{
        runner: GithubRunner;
        action: GithubRunnerAction;
    } | null>(null);

    const items = runners.data?.data ?? [];
    const selected = useMemo(
        () => items.find((runner) => runner.id === selectedId) ?? items[0] ?? null,
        [items, selectedId],
    );

    useEffect(() => {
        if (!selectedId && items[0]) {
            setSelectedId(items[0].id);
        }
    }, [items, selectedId]);

    const detail = useApiQuery(
        selected ? `github-runner:${selected.server_uuid}:${selected.name}` : null,
        () => domainApi.githubRunner(selected!.server_uuid, selected!.name),
    );

    const logs = useApiQuery(
        selected ? `github-runner-logs:${selected.server_uuid}:${selected.name}:${lines}` : null,
        () => domainApi.githubRunnerLogs(selected!.server_uuid, selected!.name, lines),
    );

    useEffect(() => {
        if (!selected) {
            return;
        }

        const interval = window.setInterval(() => {
            void runners.reload({ silent: true });
            void logs.reload({ silent: true });
        }, 5000);

        return () => window.clearInterval(interval);
    }, [selected?.id, lines]);

    async function runAction(runner: GithubRunner, action: GithubRunnerAction) {
        setActionBusy(true);
        setFeedback(null);
        setError(null);
        try {
            const result = await domainApi.githubRunnerAction(runner.server_uuid, runner.name, action);
            setFeedback(result.message ?? result.data.message);
            await runners.reload();
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

    const detailRunner = detail.data?.data ?? selected;
    const logData = logs.data?.data;
    const detailGithub = detailRunner ? githubStatusLabel(detailRunner) : null;

    return (
        <>
            <PageHeader
                title="Runners GitHub"
                description="Conteneurs self-hosted, statut GitHub (online / busy / offline), logs et création de nouveaux runners."
                eyebrow="CI / CD"
                actions={(
                    <>
                        <button class="btn btn-primary btn-sm" type="button" onClick={() => setCreateOpen(true)}>
                            <Plus class="size-3.5" aria-hidden />
                            Nouveau runner
                        </button>
                        <button class="btn btn-ghost btn-sm" type="button" onClick={() => void runners.reload()}>
                            <RefreshCw class="size-3.5" aria-hidden />
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

            <div class="grid gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
                <Card title="Runners" eyebrow={`${items.length} détecté(s)`}>
                    <DataState loading={runners.loading} error={runners.error} onRetry={() => void runners.reload()}>
                        {items.length === 0 ? (
                            <p class="text-xs text-base-content/55">
                                Aucun runner détecté. Créez-en un, ou déployez des conteneurs
                                {' '}<code class="text-[11px]">github-runner</code> sur un serveur géré.
                            </p>
                        ) : (
                            <ul class="divide-y divide-base-300">
                                {items.map((runner) => {
                                    const active = selected?.id === runner.id;
                                    const gh = githubStatusLabel(runner);
                                    return (
                                        <li key={runner.id}>
                                            <button
                                                type="button"
                                                class={`flex w-full flex-col gap-1 px-1 py-3 text-start transition-colors ${active ? 'text-primary' : 'hover:bg-base-200/60'}`}
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
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </DataState>
                </Card>

                <div class="grid gap-4">
                    {!selected ? (
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
                                        disabled={actionBusy}
                                        onClick={() => setPendingAction({ runner: selected, action: 'start' })}
                                    >
                                        <Play class="size-3.5" aria-hidden />
                                        Démarrer
                                    </button>
                                    <button
                                        class="btn btn-ghost btn-sm"
                                        type="button"
                                        disabled={actionBusy}
                                        onClick={() => setPendingAction({ runner: selected, action: 'stop' })}
                                    >
                                        <Square class="size-3.5" aria-hidden />
                                        Arrêter
                                    </button>
                                    <button
                                        class="btn btn-ghost btn-sm"
                                        type="button"
                                        disabled={actionBusy}
                                        onClick={() => setPendingAction({ runner: selected, action: 'restart' })}
                                    >
                                        <RotateCcw class="size-3.5" aria-hidden />
                                        Redémarrer
                                    </button>
                                </ActionToolbar>

                                <DataState loading={detail.loading && !detail.data} error={detail.error} onRetry={() => void detail.reload()}>
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
                                            <dt class="text-base-content/45">Image</dt>
                                            <dd class="mt-1 break-all font-mono text-[11px]">{detailRunner?.image || '—'}</dd>
                                        </div>
                                        <div>
                                            <dt class="text-base-content/45">Dépôt</dt>
                                            <dd class="mt-1 break-all">{runnerRepoLabel(detailRunner ?? selected)}</dd>
                                        </div>
                                        <div>
                                            <dt class="text-base-content/45">Nom GitHub</dt>
                                            <dd class="mt-1 font-mono text-[11px]">{detailRunner?.runner_name || '—'}</dd>
                                        </div>
                                        <div>
                                            <dt class="text-base-content/45">Labels</dt>
                                            <dd class="mt-1">
                                                {(detailRunner?.github_labels?.length ?? 0) > 0
                                                    ? detailRunner!.github_labels!.join(', ')
                                                    : '—'}
                                            </dd>
                                        </div>
                                    </dl>

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
                                            <p class="text-xs text-base-content/50">stdout / stderr du conteneur</p>
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
                                        <button class="btn btn-ghost btn-sm" type="button" onClick={() => void logs.reload()}>
                                            <RefreshCw class="size-3.5" aria-hidden />
                                            Actualiser
                                        </button>
                                    </div>
                                </div>
                                <div class="p-5">
                                    <DataState loading={logs.loading && !logs.data} error={logs.error} onRetry={() => void logs.reload()}>
                                        {logData && (
                                            <>
                                                {!logData.available && (
                                                    <p class="mb-3 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                                                        {logData.message ?? 'Logs indisponibles.'}
                                                    </p>
                                                )}
                                                <div class="max-h-[28rem] overflow-auto rounded-xl border border-base-300 bg-black p-3 font-mono text-[11px] leading-5 text-zinc-200">
                                                    {logData.items.length === 0 ? (
                                                        <p class="text-zinc-500">Aucune ligne de log.</p>
                                                    ) : logData.items.map((line) => (
                                                        <div key={line.cursor}>
                                                            <span class="me-2 select-none text-zinc-600">{line.cursor}</span>
                                                            {line.message}
                                                        </div>
                                                    ))}
                                                </div>
                                            </>
                                        )}
                                    </DataState>
                                </div>
                            </section>
                        </>
                    )}
                </div>
            </div>

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

            <CreateRunnerModal
                open={createOpen}
                onClose={() => setCreateOpen(false)}
                onCreated={() => {
                    setFeedback('Runner créé.');
                    void runners.reload();
                }}
            />
        </>
    );
}
