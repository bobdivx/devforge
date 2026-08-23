import { Plus, Trash2 } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import type { Agent, AgentStandingOrder } from '../../lib/domain-api';
import { domainApi } from '../../lib/domain-api';
import { ApiError } from '../../lib/api-client';

type Props = {
    agent: Agent;
};

export function AgentStandingOrdersPanel({ agent }: Props) {
    const [rows, setRows] = useState<AgentStandingOrder[]>([]);
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const refresh = () => {
        domainApi.agentStandingOrders({
            agent_uuid: agent.uuid,
            resource_uuid: agent.resource_uuid ?? undefined,
        }).then((r) => setRows(r.data)).catch(() => setRows([]));
    };

    useEffect(() => {
        refresh();
    }, [agent.uuid, agent.resource_uuid]);

    const handleCreate = async () => {
        if (!title.trim() || !body.trim()) {
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await domainApi.createAgentStandingOrder({
                title: title.trim(),
                body: body.trim(),
                agent_uuid: agent.uuid,
                resource_uuid: agent.resource_uuid ?? undefined,
                triggers: ['deploy_failed', 'heartbeat', 'cron'],
            });
            setTitle('');
            setBody('');
            refresh();
        } catch (e) {
            setError(e instanceof ApiError ? e.message : 'Erreur standing order');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: number) => {
        await domainApi.deleteAgentStandingOrder(id).catch(() => {});
        refresh();
    };

    return (
        <div class="grid gap-2 rounded-xl border border-base-300 bg-base-200/30 p-3">
            <p class="text-xs font-semibold uppercase tracking-wide text-base-content/60">Standing orders</p>
            <p class="text-[11px] text-base-content/55">
                Politique permanente injectée dans le prompt (deploy, heartbeat, cron).
            </p>
            {error && <p class="text-xs text-error">{error}</p>}
            <ul class="grid gap-2">
                {rows.map((row) => (
                    <li key={row.id} class="rounded-lg border border-base-300 bg-base-100 px-3 py-2">
                        <div class="flex items-start justify-between gap-2">
                            <div class="min-w-0">
                                <p class="truncate text-xs sm:text-sm font-medium">{row.title}</p>
                                <p class="mt-0.5 line-clamp-3 whitespace-pre-wrap text-[11px] text-base-content/65">{row.body}</p>
                            </div>
                            <button class="btn btn-ghost btn-xs text-error" type="button" onClick={() => void handleDelete(row.id)} aria-label="Supprimer">
                                <Trash2 class="size-3.5" aria-hidden />
                            </button>
                        </div>
                    </li>
                ))}
            </ul>
            <label class="grid gap-1 text-xs">
                <span class="font-medium">Titre</span>
                <input class="input input-bordered input-sm" value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
            </label>
            <label class="grid gap-1 text-xs">
                <span class="font-medium">Corps</span>
                <textarea class="textarea textarea-bordered textarea-sm" rows={3} value={body} onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)} />
            </label>
            <button class="btn btn-outline btn-sm gap-1" type="button" disabled={saving} onClick={() => void handleCreate()}>
                <Plus class="size-3.5" aria-hidden />
                Ajouter
            </button>
        </div>
    );
}
