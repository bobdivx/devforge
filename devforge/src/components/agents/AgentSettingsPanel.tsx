import { Play, Trash2 } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import type { Agent, AgentInput, AiProviderConfig } from '../../lib/domain-api';
import { domainApi } from '../../lib/domain-api';
import { isEventOnlyAgentType } from '../../lib/agent-triggers';
import { ApiError } from '../../lib/api-client';
import { navigateTo } from '../../lib/use-navigate';
import { ActionToolbar } from '../ui/ActionToolbar';
import { RunHistoryTable } from './RunHistoryTable';
import { AgentRunLog } from './AgentRunLog';

type Props = {
    agent: Agent;
    onUpdated: () => void;
    onClose: () => void;
};

export function AgentSettingsPanel({ agent, onUpdated, onClose }: Props) {
    const [providers, setProviders] = useState<AiProviderConfig[]>([]);
    const [form, setForm] = useState<Partial<AgentInput>>({});
    const [saving, setSaving] = useState(false);
    const [running, setRunning] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [runs, setRuns] = useState<Awaited<ReturnType<typeof domainApi.agentRuns>>['data']>([]);
    const [selectedRunUuid, setSelectedRunUuid] = useState<string | null>(null);
    const [selectedRun, setSelectedRun] = useState<Awaited<ReturnType<typeof domainApi.agentRun>>['data'] | null>(null);

    useEffect(() => {
        domainApi.aiProviders().then((r) => setProviders(r.data)).catch(() => {});
        domainApi.agentRuns(agent.uuid).then((r) => setRuns(r.data)).catch(() => {});
    }, [agent.uuid]);

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
        setRunning(true);
        try {
            await domainApi.runAgent(agent.uuid);
            onUpdated();
            const r = await domainApi.agentRuns(agent.uuid);
            setRuns(r.data);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Impossible de lancer l\'agent.');
        } finally {
            setRunning(false);
        }
    };

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

            <ActionToolbar>
                <button class="btn btn-primary btn-sm" type="button" disabled={running || !agent.provider} onClick={() => void handleRun()}>
                    {running ? <span class="loading loading-spinner loading-xs" /> : <Play class="size-3.5" aria-hidden />}
                    Lancer autonome
                </button>
                <button class="btn btn-error btn-sm btn-outline" type="button" disabled={deleting} onClick={() => void handleDelete()}>
                    <Trash2 class="size-3.5" aria-hidden />
                    Supprimer
                </button>
            </ActionToolbar>

            <div class="grid gap-3">
                <label class="grid gap-1 text-xs">
                    <span class="font-medium">Nom</span>
                    <input class="input input-bordered input-sm" type="text" value={form.name ?? ''} onInput={(e) => setForm({ ...form, name: (e.target as HTMLInputElement).value })} />
                </label>
                <label class="grid gap-1 text-xs">
                    <span class="font-medium">Provider principal</span>
                    <select class="select select-bordered select-sm" value={form.provider_config_id ?? ''} onChange={(e) => {
                        const v = (e.target as HTMLSelectElement).value;
                        setForm({ ...form, provider_config_id: v ? Number(v) : null });
                    }}
                    >
                        <option value="">Aucun</option>
                        {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
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
                    <span class="font-medium">Prompt système</span>
                    <textarea class="textarea textarea-bordered textarea-sm resize-y" rows={4} value={form.system_prompt ?? ''} onInput={(e) => setForm({ ...form, system_prompt: (e.target as HTMLTextAreaElement).value })} />
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
                    <div class="mt-3">
                        <AgentRunLog logs={selectedRun.logs} />
                    </div>
                )}
            </div>
        </div>
    );
}
