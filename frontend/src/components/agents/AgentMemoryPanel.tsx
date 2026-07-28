import { Trash2 } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import type { Agent, AgentMemory } from '../../lib/domain-api';
import { domainApi } from '../../lib/domain-api';
import { ApiError } from '../../lib/api-client';

type Props = {
    agent: Agent;
};

export function AgentMemoryPanel({ agent }: Props) {
    const [scope, setScope] = useState<'agent' | 'shared' | 'project'>('agent');
    const [items, setItems] = useState<AgentMemory[]>([]);
    const [draft, setDraft] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refresh = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await domainApi.agentMemories(agent.uuid, { scope });
            setItems(response.data);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Impossible de charger la mémoire.');
            setItems([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void refresh();
    }, [agent.uuid, scope]);

    const handleAdd = async () => {
        const content = draft.trim();
        if (!content) {
            return;
        }
        setError(null);
        try {
            await domainApi.createAgentMemory(agent.uuid, { content, scope });
            setDraft('');
            await refresh();
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Impossible d’ajouter.');
        }
    };

    const handleClear = async () => {
        if (!confirm(`Effacer toute la mémoire « ${scope} » ?`)) {
            return;
        }
        try {
            await domainApi.clearAgentMemories(agent.uuid, scope);
            await refresh();
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Impossible d’effacer.');
        }
    };

    const handleDelete = async (id: number) => {
        try {
            await domainApi.deleteAgentMemory(agent.uuid, id);
            setItems((current) => current.filter((item) => item.id !== id));
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Impossible de supprimer.');
        }
    };

    return (
        <section class="grid gap-3 rounded-xl border border-base-300 bg-base-200/20 p-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <h3 class="text-sm font-semibold">Mémoire agent</h3>
                <div class="flex gap-1">
                    {(['agent', 'shared', 'project'] as const).map((value) => (
                        <button
                            key={value}
                            type="button"
                            class={`btn btn-xs ${scope === value ? 'btn-primary' : 'btn-ghost'}`}
                            onClick={() => setScope(value)}
                        >
                            {value}
                        </button>
                    ))}
                </div>
            </div>

            {error && <p class="text-xs text-error">{error}</p>}

            <div class="flex gap-2">
                <textarea
                    class="textarea textarea-bordered textarea-sm min-h-[4rem] flex-1"
                    placeholder="Nouveau souvenir…"
                    value={draft}
                    onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
                />
                <div class="flex flex-col gap-1">
                    <button type="button" class="btn btn-primary btn-sm" onClick={() => void handleAdd()}>
                        Ajouter
                    </button>
                    <button type="button" class="btn btn-ghost btn-sm" onClick={() => void handleClear()}>
                        Clear
                    </button>
                </div>
            </div>

            {loading ? (
                <p class="text-xs text-base-content/50">Chargement…</p>
            ) : items.length === 0 ? (
                <p class="text-xs text-base-content/50">Aucun souvenir ({scope}).</p>
            ) : (
                <ul class="max-h-48 space-y-2 overflow-y-auto">
                    {items.map((item) => (
                        <li key={item.id} class="flex gap-2 rounded-lg border border-base-300/70 bg-base-100/40 px-2 py-1.5 text-xs">
                            <p class="min-w-0 flex-1 whitespace-pre-wrap">{item.content}</p>
                            <button
                                type="button"
                                class="btn btn-ghost btn-xs"
                                aria-label="Supprimer"
                                onClick={() => void handleDelete(item.id)}
                            >
                                <Trash2 class="size-3.5" aria-hidden />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
