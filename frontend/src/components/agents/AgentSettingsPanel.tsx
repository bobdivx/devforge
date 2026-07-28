import { Play, Trash2, CheckCircle2 } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import type { Agent, AgentInput, AiProviderConfig } from '../../lib/domain-api';
import { domainApi } from '../../lib/domain-api';
import { isEventOnlyAgentType } from '../../lib/agent-triggers';
import { ApiError } from '../../lib/api-client';
import { navigateTo } from '../../lib/use-navigate';
import { ActionToolbar } from '../ui/ActionToolbar';
import { RunHistoryTable } from './RunHistoryTable';
import { AgentRunLog } from './AgentRunLog';
import { AgentModelRoutingBadge } from './AgentModelRoutingBadge';
import { AgentRunProgress } from './AgentRunProgress';
import { AgentMemoryPanel } from './AgentMemoryPanel';
import { useAgentRunTracker } from '../../lib/use-agent-run-tracker';

type Props = {
    agent: Agent;
    onUpdated: () => void;
    onClose: () => void;
};

export function AgentSettingsPanel({ agent, onUpdated, onClose }: Props) {
    const [providers, setProviders] = useState<AiProviderConfig[]>([]);
    const [form, setForm] = useState<Partial<AgentInput>>({});
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [runs, setRuns] = useState<Awaited<ReturnType<typeof domainApi.agentRuns>>['data']>([]);
    const [selectedRunUuid, setSelectedRunUuid] = useState<string | null>(null);
    const [selectedRun, setSelectedRun] = useState<Awaited<ReturnType<typeof domainApi.agentRun>>['data'] | null>(null);

    const refreshRuns = () => {
        domainApi.agentRuns(agent.uuid).then((r) => setRuns(r.data)).catch(() => {});
    };

    const {
        isLaunching,
        isTracking,
        activeRun,
        runError,
        outcome,
        launch,
        trackExistingRun,
    } = useAgentRunTracker(agent.uuid, {
        onPoll: refreshRuns,
        onComplete: () => {
            onUpdated();
            refreshRuns();
        },
    });

    useEffect(() => {
        domainApi.aiProviders().then((r) => setProviders(r.data)).catch(() => {});
        refreshRuns();
    }, [agent.uuid]);

    useEffect(() => {
        if (agent.status === 'running' && agent.latest_run?.uuid && !isTracking) {
            trackExistingRun(agent.latest_run.uuid);
        }
    }, [agent.status, agent.latest_run?.uuid, isTracking, trackExistingRun]);

    useEffect(() => {
        if (outcome === 'completed' && activeRun?.uuid) {
            setSelectedRunUuid(activeRun.uuid);
        }
    }, [outcome, activeRun?.uuid]);

    useEffect(() => {
        setForm({
            name: agent.name,
            description: agent.description ?? '',
            system_prompt: agent.system_prompt ?? '',
            schedule_minutes: agent.schedule_minutes,
            provider_config_id: agent.provider?.id ?? null,
            fallback_provider_config_id: agent.fallback_provider?.id ?? null,
        });
    }, [agent]);

    useEffect(() => {
        if (!selectedRunUuid) {
            return;
        }
        domainApi.agentRun(agent.uuid, selectedRunUuid)
            .then((r) => setSelectedRun(r.data))
            .catch(() => setSelectedRun(null));
    }, [selectedRunUuid, agent.uuid]);

    const handleSave = async () => {
        setSaving(true);
        setError(null);
        try {
            await domainApi.updateAgent(agent.uuid, form);
            onUpdated();
            onClose();
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Erreur de sauvegarde.');
        } finally {
            setSaving(false);
        }
    };

    const handleRun = async () => {
        setError(null);
        await launch();
    };

    const isBusy = isTracking || agent.status === 'running';
    const showProgress = isTracking && activeRun && (activeRun.status === 'running' || activeRun.status === 'pending');
    const runFeedback = runError ?? (outcome === 'failed' && activeRun?.summary ? activeRun.summary : null);

    const handleDelete = async () => {
        if (!confirm(`Supprimer l'agent "${agent.name}" ?`)) {
            return;
        }
        setDeleting(true);
        try {
            await domainApi.deleteAgent(agent.uuid);
            navigateTo('/agents');
        } finally {
            setDeleting(false);
        }
    };

    return (
        <div class="grid gap-4 p-4">
            {error && <p class="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">{error}</p>}

            {showProgress && activeRun && <AgentRunProgress run={activeRun} />}

            {outcome === 'completed' && !isTracking && (
                <p class="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs text-success" role="status">
                    <CheckCircle2 class="size-4 shrink-0" aria-hidden />
                    {activeRun?.summary?.trim() || 'Exécution terminée avec succès.'}
                </p>
            )}

            {runFeedback && (
                <p class="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-xs text-error" role="alert">
                    {runFeedback}
                </p>
            )}

            <ActionToolbar>
                <button class="btn btn-primary btn-sm gap-1" type="button" disabled={isBusy} onClick={() => void handleRun()} aria-busy={isLaunching}>
                    {isLaunching ? (
                        <>
                            <span class="loading loading-spinner loading-xs" aria-hidden />
                            Démarrage…
                        </>
                    ) : isBusy ? (
                        <>En cours</>
                    ) : (
                        <>
                            <Play class="size-3.5" aria-hidden />
                            Lancer autonome
                        </>
                    )}
                </button>
                <button class="btn btn-error btn-sm btn-outline" type="button" disabled={deleting} onClick={() => void handleDelete()}>
                    <Trash2 class="size-3.5" aria-hidden />
                    Supprimer
                </button>
            </ActionToolbar>

            <AgentMemoryPanel agent={agent} />

            <div class="grid gap-3">
                <label class="grid gap-1 text-xs">
                    <span class="font-medium">Nom</span>
                    <input class="input input-bordered input-sm" type="text" value={form.name ?? ''} onInput={(e) => setForm({ ...form, name: (e.target as HTMLInputElement).value })} />
                </label>
                <label class="grid gap-1 text-xs">
                    <span class="font-medium">Provider LLM</span>
                    <select class="select select-bordered select-sm" value={form.provider_config_id ?? ''} onChange={(e) => {
                        const v = (e.target as HTMLSelectElement).value;
                        setForm({ ...form, provider_config_id: v ? Number(v) : null });
                    }}
                    >
                        <option value="">Auto (provider par défaut)</option>
                        {providers.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.provider})</option>)}
                    </select>
                    <span class="text-[11px] text-base-content/50">Modèle en mode Auto — sélection automatique comme Cursor.</span>
                </label>
                <label class="grid gap-1 text-xs">
                    <span class="font-medium">Provider de secours</span>
                    <select class="select select-bordered select-sm" value={form.fallback_provider_config_id ?? ''} onChange={(e) => {
                        const v = (e.target as HTMLSelectElement).value;
                        setForm({ ...form, fallback_provider_config_id: v ? Number(v) : null });
                    }}
                    >
                        <option value="">Automatique</option>
                        {providers.filter((p) => p.id !== form.provider_config_id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                </label>
                {isEventOnlyAgentType(agent.type) ? (
                    <p class="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-[11px] text-base-content/70">
                        Cet agent DevForge se déclenche à chaque build webhook, pas via un minuteur.
                    </p>
                ) : (
                    <label class="grid gap-1 text-xs">
                        <span class="font-medium">Planification (min, 0 = manuel)</span>
                        <input class="input input-bordered input-sm" type="number" min="0" value={form.schedule_minutes ?? 0} onInput={(e) => setForm({ ...form, schedule_minutes: Number((e.target as HTMLInputElement).value) })} />
                    </label>
                )}
                <label class="grid gap-1 text-xs">
                    <span class="font-medium">Directives agent (prompt système)</span>
                    <textarea
                        class="textarea textarea-bordered textarea-sm resize-y font-mono text-[11px]"
                        rows={5}
                        placeholder="Directives personnalisées pour cet agent…"
                        value={form.system_prompt ?? ''}
                        onInput={(e) => setForm({ ...form, system_prompt: (e.target as HTMLTextAreaElement).value })}
                    />
                    {agent.autonomous_playbook && agent.autonomous_playbook.length > 0 && (
                        <div class="rounded-md border border-base-300 bg-base-200/40 px-3 py-2">
                            <p class="mb-1 text-[10px] font-semibold uppercase tracking-wide text-base-content/60">Playbook autonome (au lancement)</p>
                            <ol class="list-decimal space-y-0.5 pl-4 text-[11px] text-base-content/70">
                                {agent.autonomous_playbook.map((step) => <li key={step}>{step}</li>)}
                            </ol>
                        </div>
                    )}
                    {agent.default_directives && (
                        <button
                            class="btn btn-ghost btn-xs justify-start px-0 text-primary"
                            type="button"
                            onClick={() => setForm({ ...form, system_prompt: agent.default_directives ?? '' })}
                        >
                            Réinitialiser aux directives par défaut
                        </button>
                    )}
                </label>
                <button class="btn btn-primary btn-sm" type="button" disabled={saving} onClick={() => void handleSave()}>
                    {saving && <span class="loading loading-spinner loading-xs" />}
                    Sauvegarder
                </button>
            </div>

            <div class="border-t border-base-300 pt-4">
                <h3 class="mb-2 text-xs font-semibold">Exécutions autonomes</h3>
                <RunHistoryTable runs={runs} selectedUuid={selectedRunUuid} onSelect={setSelectedRunUuid} />
                {selectedRun && (
                    <div class="mt-3 space-y-3">
                        <AgentModelRoutingBadge routing={selectedRun.metadata?.model_routing} />
                        {(selectedRun.metadata?.ephemeral_tasks?.length ?? 0) > 0 && (
                            <div class="rounded-lg border border-base-300 bg-base-200/40 p-3">
                                <p class="mb-2 text-[11px] font-semibold uppercase tracking-wide text-base-content/50">
                                    Sous-tâches éphémères
                                </p>
                                <ul class="space-y-2">
                                    {selectedRun.metadata?.ephemeral_tasks?.map((task) => (
                                        <li key={task.run_uuid} class="text-xs">
                                            <div class="flex flex-wrap items-center gap-2">
                                                <AgentModelRoutingBadge routing={{
                                                    tier: task.tier as 'light' | 'standard' | 'heavy',
                                                    tier_label: task.tier_label,
                                                    model_label: task.model_label,
                                                    reason: task.goal,
                                                    display: task.display,
                                                }} compact ephemeral />
                                                <span class="text-base-content/50">{task.status}</span>
                                            </div>
                                            <p class="mt-1 text-base-content/70">{task.goal}</p>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        <AgentRunLog logs={selectedRun.logs} class="max-h-80" />
                    </div>
                )}
            </div>
        </div>
    );
}
