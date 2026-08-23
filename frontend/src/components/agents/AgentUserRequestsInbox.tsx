import { Bot, KeyRound } from 'lucide-preact';
import { useState } from 'preact/hooks';
import type { AgentKeyRequest } from '../../lib/domain-api';
import { domainApi } from '../../lib/domain-api';
import { ApiError } from '../../lib/api-client';
import { useApiQuery } from '../../lib/use-api-query';
import { useTeamContext } from '../../lib/team-context';

export function AgentUserRequestsInbox() {
    const { agentsEnabled } = useTeamContext();
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [savingUuid, setSavingUuid] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<string | null>(null);

    const query = useApiQuery(
        agentsEnabled ? 'agent-key-requests-inbox' : null,
        () => domainApi.agentKeyRequests({ status: 'pending' }),
    );

    const requests = query.data?.data ?? [];
    const pendingCount = query.data?.meta?.pending_count ?? requests.length;

    const fulfill = async (req: AgentKeyRequest) => {
        const value = (drafts[req.uuid] ?? '').trim();
        const kind = req.kind ?? 'secret';
        if (kind !== 'confirm' && !value) {
            return;
        }

        setSavingUuid(req.uuid);
        setError(null);
        setFeedback(null);
        try {
            const result = await domainApi.fulfillAgentKeyRequest(req.uuid, value, {
                scope: req.resource_uuid ? 'application' : 'shared',
                confirmed: kind === 'confirm' ? true : undefined,
            });
            setFeedback(result.message);
            setDrafts((current) => ({ ...current, [req.uuid]: '' }));
            await query.reload({ silent: true });
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Enregistrement impossible.');
        } finally {
            setSavingUuid(null);
        }
    };

    if (!agentsEnabled || pendingCount === 0) {
        return null;
    }

    return (
        <section id="agent-user-requests-inbox" class="mb-5 min-w-0 overflow-hidden rounded-xl border border-warning/40 bg-warning/5 p-3 sm:p-4">
            <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div class="min-w-0">
                    <h3 class="text-xs sm:text-sm font-semibold">
                        Actions requises
                        <span class="badge badge-warning badge-sm ml-2">{pendingCount}</span>
                    </h3>
                    <p class="text-xs text-base-content/60">
                        Clés, tokens ou confirmations demandés par les agents (la valeur n’est pas renvoyée au modèle).
                    </p>
                </div>
            </div>

            {error && <p class="mb-2 text-xs text-error">{error}</p>}
            {feedback && <p class="mb-2 text-xs text-success">{feedback}</p>}

            <ul class="grid gap-3">
                {requests.map((req) => (
                    <li key={req.uuid} class="rounded-lg border border-base-300 bg-base-100 p-3">
                        <div class="mb-2 flex flex-wrap items-center gap-2 text-sm">
                            <Bot class="size-3.5 sm:size-4 text-primary" aria-hidden />
                            <span class="font-medium">{req.agent_name ?? req.agent?.name ?? 'Agent'}</span>
                            <span class="text-base-content/55">demande</span>
                            <code class="rounded bg-base-200 px-1.5 py-0.5 font-mono text-xs">{req.key_name}</code>
                            {req.kind && <span class="badge badge-ghost badge-xs">{req.kind}</span>}
                        </div>
                        {req.reason && <p class="mb-2 text-xs text-base-content/65">{req.reason}</p>}
                        {(req.kind ?? 'secret') === 'confirm' ? (
                            <button
                                class="btn btn-primary btn-sm"
                                type="button"
                                disabled={savingUuid === req.uuid}
                                onClick={() => void fulfill(req)}
                            >
                                Confirmer
                            </button>
                        ) : (
                            <div class="flex min-w-0 flex-wrap gap-2">
                                <input
                                    class="input input-bordered input-sm min-w-0 flex-1 basis-full font-mono sm:basis-auto sm:min-w-[12rem]"
                                    type="password"
                                    placeholder={`Valeur pour ${req.key_name}`}
                                    value={drafts[req.uuid] ?? ''}
                                    onInput={(e) => setDrafts((cur) => ({
                                        ...cur,
                                        [req.uuid]: (e.target as HTMLInputElement).value,
                                    }))}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') void fulfill(req);
                                    }}
                                />
                                <button
                                    class="btn btn-primary btn-sm"
                                    type="button"
                                    disabled={savingUuid === req.uuid || !(drafts[req.uuid]?.trim())}
                                    onClick={() => void fulfill(req)}
                                >
                                    <KeyRound class="size-3.5" aria-hidden />
                                    Fournir
                                </button>
                            </div>
                        )}
                    </li>
                ))}
            </ul>
        </section>
    );
}
