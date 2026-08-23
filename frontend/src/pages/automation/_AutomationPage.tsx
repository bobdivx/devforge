import { CalendarClock, Plus, RefreshCw } from 'lucide-preact';
import { useMemo, useState } from 'preact/hooks';
import { PageHeader } from '../../components/PageHeader';
import { Card } from '../../components/ui/Card';
import { DataState } from '../../components/ui/DataState';
import { AgentStatusBadge } from '../../components/agents/AgentStatusBadge';
import { ApiError } from '../../lib/api-client';
import {
    DEFAULT_AUTOMATION_INSTRUCTIONS,
    DEFAULT_AUTOMATION_NAME,
    DEFAULT_AUTOMATION_PRESET_ID,
    defaultAutomationInput,
    selectScheduledAutomations,
} from '../../lib/agent-automations';
import { agentDetailPath } from '../../lib/agent-routes';
import { AGENT_SCHEDULE_PRESETS, applySchedulePreset } from '../../lib/agent-schedule-presets';
import { scheduleLabel } from '../../lib/agent-triggers';
import { domainApi, type Agent } from '../../lib/domain-api';
import { routeHref } from '../../lib/routes';
import { useApiQuery } from '../../lib/use-api-query';
import { useNavigate } from '../../lib/use-navigate';
import { useTeamContext } from '../../lib/team-context';

export function AutomationPage() {
    const { agentsEnabled } = useTeamContext();
    const onNavigate = useNavigate();
    const query = useApiQuery(agentsEnabled ? 'agents' : null, () => domainApi.agents());
    const automations = useMemo(
        () => selectScheduledAutomations(query.data?.data ?? []),
        [query.data?.data],
    );

    const [name, setName] = useState(DEFAULT_AUTOMATION_NAME);
    const [presetId, setPresetId] = useState(DEFAULT_AUTOMATION_PRESET_ID);
    const [instructions, setInstructions] = useState(DEFAULT_AUTOMATION_INSTRUCTIONS);
    const [showForm, setShowForm] = useState(false);
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const [togglingUuid, setTogglingUuid] = useState<string | null>(null);

    const formVisible = showForm || automations.length === 0;

    if (!agentsEnabled) {
        return (
            <>
                <PageHeader title="Automations" description="Fonctionnalité désactivée sur cette instance." eyebrow="Indisponible" />
                <Card title="Agents désactivés">
                    <p class="text-sm text-base-content/65">
                        Activez <code class="text-xs">DEVFORGE_AGENTS_ENABLED=true</code> pour planifier des automations.
                    </p>
                </Card>
            </>
        );
    }

    const handleCreate = async () => {
        if (!name.trim() || !instructions.trim()) {
            return;
        }

        setSaving(true);
        setFormError(null);

        try {
            const schedule = applySchedulePreset(presetId);
            const created = await domainApi.createAgent(defaultAutomationInput({
                name: name.trim(),
                system_prompt: instructions.trim(),
                schedule_minutes: schedule.schedule_minutes,
                schedule_cron: schedule.schedule_cron,
            }));

            await domainApi.createAgentStandingOrder({
                title: name.trim(),
                body: instructions.trim(),
                agent_uuid: created.data.uuid,
                triggers: ['heartbeat', 'cron'],
            }).catch(() => undefined);

            setShowForm(false);
            setName(DEFAULT_AUTOMATION_NAME);
            setPresetId(DEFAULT_AUTOMATION_PRESET_ID);
            setInstructions(DEFAULT_AUTOMATION_INSTRUCTIONS);
            await query.reload();
        } catch (error) {
            setFormError(error instanceof ApiError ? error.message : 'Impossible de créer l’automation.');
        } finally {
            setSaving(false);
        }
    };

    const handleToggle = async (agent: Agent) => {
        setTogglingUuid(agent.uuid);
        try {
            await domainApi.updateAgent(agent.uuid, { is_active: !agent.is_active });
            await query.reload({ silent: true });
        } finally {
            setTogglingUuid(null);
        }
    };

    return (
        <div class="grid min-w-0 gap-5">
            <PageHeader
                title="Automations"
                description="Agents planifiés : déclencheur, instructions, mémoire. Les crons d’applications restent dans Tâches planifiées."
                actions={(
                    <>
                        <button class="btn btn-ghost btn-sm" type="button" onClick={() => void query.reload()}>
                            <RefreshCw class="size-3.5" aria-hidden />
                            Actualiser
                        </button>
                        <button class="btn btn-primary btn-sm" type="button" onClick={() => setShowForm(true)}>
                            <Plus class="size-3.5" aria-hidden />
                            Nouvelle automation
                        </button>
                    </>
                )}
            />

            <DataState loading={query.loading} error={query.error} onRetry={() => void query.reload()}>
                {automations.length > 0 && (
                    <ul class="grid gap-3">
                        {automations.map((agent) => {
                            const detailPath = agentDetailPath(agent.uuid, { settings: true });

                            return (
                                <li key={agent.uuid} class="rounded-2xl border border-base-300/70 bg-base-100 p-5 shadow-sm">
                                    <div class="flex flex-col gap-2 sm:gap-3 sm:flex-row sm:items-start sm:justify-between">
                                        <div class="min-w-0 grid gap-1">
                                            <div class="flex flex-wrap items-center gap-2">
                                                <h2 class="text-sm sm:text-base font-semibold">{agent.name}</h2>
                                                <AgentStatusBadge status={agent.status} />
                                            </div>
                                            <p class="text-xs text-base-content/60">{scheduleLabel(agent)}</p>
                                            {agent.description && (
                                                <p class="text-sm text-base-content/70">{agent.description}</p>
                                            )}
                                        </div>
                                        <div class="flex shrink-0 items-center gap-2">
                                            <label class="flex cursor-pointer items-center gap-2 text-sm">
                                                <span class="text-base-content/60">{agent.is_active ? 'Active' : 'Pause'}</span>
                                                <input
                                                    type="checkbox"
                                                    class="toggle toggle-success toggle-sm"
                                                    checked={agent.is_active}
                                                    disabled={togglingUuid === agent.uuid}
                                                    onChange={() => void handleToggle(agent)}
                                                    aria-label={`Activer ${agent.name}`}
                                                />
                                            </label>
                                            <a
                                                class="btn btn-ghost btn-sm"
                                                href={routeHref(detailPath)}
                                                onClick={(event) => onNavigate(event, detailPath)}
                                            >
                                                Ouvrir
                                            </a>
                                        </div>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}

                {formVisible && (
                    <Card title={automations.length === 0 ? 'Créer la première automation' : 'Nouvelle automation'} eyebrow="Planifié">
                        <div class="grid gap-3">
                            {formError && <p class="text-sm text-error">{formError}</p>}
                            <label class="grid gap-1 text-sm">
                                <span class="font-medium">Nom</span>
                                <input
                                    class="input input-bordered input-sm"
                                    value={name}
                                    onInput={(event) => setName((event.target as HTMLInputElement).value)}
                                />
                            </label>
                            <label class="grid gap-1 text-sm">
                                <span class="font-medium">Déclencheur</span>
                                <select
                                    class="select select-bordered select-sm"
                                    value={presetId}
                                    onChange={(event) => setPresetId((event.target as HTMLSelectElement).value)}
                                >
                                    {AGENT_SCHEDULE_PRESETS.filter((preset) => preset.id !== 'manual').map((preset) => (
                                        <option key={preset.id} value={preset.id}>
                                            {preset.label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label class="grid gap-1 text-sm">
                                <span class="font-medium">Instructions</span>
                                <textarea
                                    class="textarea textarea-bordered text-sm"
                                    rows={8}
                                    value={instructions}
                                    onInput={(event) => setInstructions((event.target as HTMLTextAreaElement).value)}
                                />
                            </label>
                            <p class="text-xs text-base-content/55">
                                Mémoire et outils de l’agent sont activés à l’enregistrement. Pas de merge automatique.
                            </p>
                            <div class="flex flex-wrap gap-2">
                                <button class="btn btn-primary btn-sm" type="button" disabled={saving} onClick={() => void handleCreate()}>
                                    <Plus class="size-3.5" aria-hidden />
                                    {saving ? 'Création…' : 'Créer l’automation'}
                                </button>
                                {automations.length > 0 && (
                                    <button class="btn btn-ghost btn-sm" type="button" onClick={() => setShowForm(false)}>
                                        Annuler
                                    </button>
                                )}
                            </div>
                        </div>
                    </Card>
                )}
            </DataState>

            <Card title="Tâches planifiées">
                <p class="text-sm text-base-content/65">
                    Crons d’applications, sauvegardes et nettoyages Docker.
                </p>
                <a
                    class="btn btn-outline btn-sm mt-3 gap-1.5"
                    href={routeHref('/scheduled-tasks')}
                    onClick={(event) => onNavigate(event, '/scheduled-tasks')}
                >
                    <CalendarClock class="size-3.5" aria-hidden />
                    Ouvrir les tâches planifiées
                </a>
            </Card>
        </div>
    );
}
