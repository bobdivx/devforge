import { Play, Trash2, CheckCircle2, Star } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import type { Agent, AgentInput, AiProviderConfig } from '../../lib/domain-api';
import { domainApi } from '../../lib/domain-api';
import { isEventOnlyAgentType, eventTriggerLabel } from '../../lib/agent-triggers';
import {
    AGENT_SCHEDULE_PRESETS,
    applySchedulePreset,
    matchSchedulePreset,
} from '../../lib/agent-schedule-presets';
import { ApiError } from '../../lib/api-client';
import { navigateTo } from '../../lib/use-navigate';
import { ActionToolbar } from '../ui/ActionToolbar';
import { RunHistoryTable } from './RunHistoryTable';
import { AgentRunLog } from './AgentRunLog';
import { AgentModelRoutingBadge } from './AgentModelRoutingBadge';
import { AgentRunProgress } from './AgentRunProgress';
import { AgentMemoryPanel } from './AgentMemoryPanel';
import { AgentSkillsPanel } from './AgentSkillsPanel';
import { AgentStandingOrdersPanel } from './AgentStandingOrdersPanel';
import { AgentSubAgentsPanel } from './AgentSubAgentsPanel';
import { AgentProviderModelFields } from './AgentProviderModelFields';
import { AgentTeamContributionsPanel } from './AgentTeamContributionsPanel';
import { useAgentRunTracker } from '../../lib/use-agent-run-tracker';
import { isInFlightAgentRunStatus, shouldTrackAgentLatestRun } from '../../lib/agent-run-tracker';

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
    const [primaryBusy, setPrimaryBusy] = useState(false);
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
        if (shouldTrackAgentLatestRun(agent.status, agent.latest_run, isTracking)) {
            trackExistingRun(agent.latest_run!.uuid);
        }
    }, [agent.status, agent.latest_run?.uuid, agent.latest_run?.status, isTracking, trackExistingRun]);

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
            schedule_cron: agent.schedule_cron ?? '',
            heartbeat_enabled: agent.heartbeat_enabled ?? false,
            provider_config_id: agent.provider?.id ?? null,
            fallback_provider_config_id: agent.fallback_provider?.id ?? null,
            preferred_model: agent.preferred_model ?? null,
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

    const isBusy = isTracking
        || (agent.status === 'running' && Boolean(agent.latest_run && isInFlightAgentRunStatus(agent.latest_run.status)));
    const showProgress = isTracking && activeRun && (activeRun.status === 'running' || activeRun.status === 'pending' || activeRun.status === 'waiting_for_subagents');
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

    const handleTogglePrimaryChat = async () => {
        setPrimaryBusy(true);
        setError(null);
        try {
            await domainApi.updateAgent(agent.uuid, {
                is_primary_chat: !agent.is_primary_chat,
            });
            onUpdated();
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Impossible de définir le chat principal.');
        } finally {
            setPrimaryBusy(false);
        }
    };

    return (
        <div class="grid gap-4 p-4">
            {error && <p class="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">{error}</p>}

            <label class="flex items-center justify-between gap-3 rounded-xl border border-base-300/70 px-3 py-2 text-sm">
                <span class="grid gap-0.5">
                    <span class="flex items-center gap-1.5 font-medium">
                        <Star class={`size-3.5 ${agent.is_primary_chat ? 'fill-current text-primary' : ''}`} aria-hidden />
                        Chat principal
                    </span>
                    <span class="text-xs font-normal text-base-content/55">
                        Ouvert depuis la sidebar Chat et le raccourci mobile.
                    </span>
                </span>
                <input
                    class="toggle toggle-sm shrink-0"
                    type="checkbox"
                    checked={Boolean(agent.is_primary_chat)}
                    disabled={primaryBusy}
                    onChange={() => void handleTogglePrimaryChat()}
                />
            </label>

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
                <button
                    class="btn btn-ghost btn-sm gap-1"
                    type="button"
                    disabled={isBusy}
                    onClick={() => void handleRun()}
                    aria-busy={isLaunching}
                    title="Forcer un run immédiat. L’autonomie vient du planning / cron / webhooks / missions, pas de ce bouton."
                >
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
                            Forcer un run
                        </>
                    )}
                </button>
                <button class="btn btn-error btn-sm btn-outline" type="button" disabled={deleting} onClick={() => void handleDelete()}>
                    <Trash2 class="size-3.5" aria-hidden />
                    Supprimer
                </button>
            </ActionToolbar>

            <AgentMemoryPanel agent={agent} />
            <AgentSkillsPanel agent={agent} />
            <AgentStandingOrdersPanel agent={agent} />
            <AgentSubAgentsPanel agent={agent} onUpdated={onUpdated} />

            <div class="grid gap-3">
                <label class="grid gap-1 text-xs">
                    <span class="font-medium">Nom</span>
                    <input class="input input-bordered input-sm" type="text" value={form.name ?? ''} onInput={(e) => setForm({ ...form, name: (e.target as HTMLInputElement).value })} />
                </label>
                <AgentProviderModelFields
                    providers={providers}
                    providerConfigId={form.provider_config_id}
                    fallbackProviderConfigId={form.fallback_provider_config_id}
                    preferredModel={form.preferred_model}
                    onProviderChange={(id) => setForm({ ...form, provider_config_id: id, preferred_model: null })}
                    onFallbackChange={(id) => setForm({ ...form, fallback_provider_config_id: id })}
                    onPreferredModelChange={(model) => setForm({ ...form, preferred_model: model })}
                />
                {isEventOnlyAgentType(agent.type) ? (
                    <p class="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-[11px] text-base-content/70">
                        {eventTriggerLabel(agent.type)}
                    </p>
                ) : (
                    <>
                        <p class="rounded-md border border-base-300 bg-base-200/40 px-3 py-2 text-[11px] text-base-content/70">
                            L’agent est autonome via cette planification (ou les missions / webhooks).
                            Le bouton « Forcer » ne sert qu’au debug ou à un passage immédiat.
                        </p>
                        <label class="grid gap-1 text-xs">
                            <span class="font-medium">Horaires de travail</span>
                            <select
                                class="select select-bordered select-sm"
                                value={matchSchedulePreset(form.schedule_minutes ?? 0, form.schedule_cron)}
                                onChange={(e) => {
                                    const presetId = (e.target as HTMLSelectElement).value;
                                    const next = applySchedulePreset(presetId);
                                    setForm({
                                        ...form,
                                        schedule_minutes: next.schedule_minutes,
                                        schedule_cron: next.schedule_cron ?? '',
                                    });
                                }}
                            >
                                {AGENT_SCHEDULE_PRESETS.map((preset) => (
                                    <option key={preset.id} value={preset.id}>{preset.label}</option>
                                ))}
                            </select>
                            {(() => {
                                const preset = AGENT_SCHEDULE_PRESETS.find(
                                    (row) => row.id === matchSchedulePreset(form.schedule_minutes ?? 0, form.schedule_cron),
                                );
                                return preset?.hint
                                    ? <span class="text-[11px] text-base-content/55">{preset.hint}</span>
                                    : null;
                            })()}
                        </label>
                        {matchSchedulePreset(form.schedule_minutes ?? 0, form.schedule_cron) === 'custom' && (
                            <>
                                <label class="grid gap-1 text-xs">
                                    <span class="font-medium">Intervalle (minutes, 0 = off)</span>
                                    <input
                                        class="input input-bordered input-sm"
                                        type="number"
                                        min="0"
                                        value={form.schedule_minutes ?? 0}
                                        onInput={(e) => setForm({
                                            ...form,
                                            schedule_minutes: Number((e.target as HTMLInputElement).value),
                                            schedule_cron: '',
                                        })}
                                    />
                                </label>
                                <label class="grid gap-1 text-xs">
                                    <span class="font-medium">Cron libre (prioritaire si renseigné)</span>
                                    <input
                                        class="input input-bordered input-sm font-mono"
                                        type="text"
                                        placeholder="0 9-18 * * 1-5"
                                        value={form.schedule_cron ?? ''}
                                        onInput={(e) => setForm({ ...form, schedule_cron: (e.target as HTMLInputElement).value })}
                                    />
                                </label>
                            </>
                        )}
                        <label class="flex items-center gap-2 text-xs">
                            <input
                                class="checkbox checkbox-sm"
                                type="checkbox"
                                checked={Boolean(form.heartbeat_enabled)}
                                onChange={(e) => setForm({ ...form, heartbeat_enabled: (e.target as HTMLInputElement).checked })}
                            />
                            <span class="font-medium">Heartbeats idle (santé / standing orders)</span>
                        </label>
                    </>
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
                        <AgentTeamContributionsPanel report={selectedRun.metadata?.team_report} />
                        {(selectedRun.metadata?.ephemeral_tasks?.length ?? 0) > 0 && !selectedRun.metadata?.team_report && (
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
                                                {task.role_slug && (
                                                    <span class="text-base-content/60">{task.role_slug}</span>
                                                )}
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
