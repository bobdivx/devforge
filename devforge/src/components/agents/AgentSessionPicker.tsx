import { MessageSquarePlus, MessagesSquare } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { AgentChatSession } from '../../lib/domain-api';
import { domainApi } from '../../lib/domain-api';
import { ApiError } from '../../lib/api-client';

type Props = {
    agentUuid: string;
    activeSessionUuid: string | null;
    onSessionChange: (session: AgentChatSession) => void;
    onSessionsLoaded?: (sessions: AgentChatSession[]) => void;
};

function formatSessionLabel(session: AgentChatSession): string {
    if (session.last_message_at) {
        const date = new Date(session.last_message_at).toLocaleDateString('fr-FR', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
        });

        return `${session.title} · ${date}`;
    }

    return session.title;
}

export function AgentSessionPicker({ agentUuid, activeSessionUuid, onSessionChange, onSessionsLoaded }: Props) {
    const [sessions, setSessions] = useState<AgentChatSession[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [open, setOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    const loadSessions = async () => {
        setLoading(true);
        setError(null);

        try {
            const response = await domainApi.agentSessions(agentUuid);
            const loaded = response.data;
            setSessions(loaded);
            onSessionsLoaded?.(loaded);

            const activeUuid = response.meta?.active_session_uuid ?? null;

            if (loaded.length === 0) {
                const created = await domainApi.createAgentSession(agentUuid);
                const next = [created.data];
                setSessions(next);
                onSessionsLoaded?.(next);
                onSessionChange(created.data);
                return;
            }

            const selected = activeUuid
                ? loaded.find((session) => session.uuid === activeUuid) ?? loaded[0]
                : loaded[0];

            onSessionChange(selected);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Impossible de charger les sessions.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadSessions();
    }, [agentUuid]);

    useEffect(() => {
        const handleClick = (event: MouseEvent) => {
            if (!menuRef.current?.contains(event.target as Node)) {
                setOpen(false);
            }
        };

        document.addEventListener('click', handleClick);
        return () => document.removeEventListener('click', handleClick);
    }, []);

    const activeSession = sessions.find((session) => session.uuid === activeSessionUuid) ?? null;

    const handleCreate = async () => {
        setCreating(true);
        setError(null);

        try {
            const response = await domainApi.createAgentSession(agentUuid);
            const session = response.data;
            setSessions((current) => [session, ...current]);
            onSessionChange(session);
            setOpen(false);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Impossible de créer une session.');
        } finally {
            setCreating(false);
        }
    };

    const handleSelect = async (session: AgentChatSession) => {
        setError(null);
        setOpen(false);

        try {
            await domainApi.activateAgentSession(agentUuid, session.uuid);
            onSessionChange(session);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Impossible d\'activer cette session.');
        }
    };

    return (
        <div class="relative min-w-0" ref={menuRef}>
            <div class="flex items-center gap-1">
                <button
                    class="btn btn-ghost btn-xs max-w-[14rem] gap-1 truncate px-2 font-normal"
                    type="button"
                    title="Changer de conversation"
                    disabled={loading || creating}
                    onClick={() => setOpen((value) => !value)}
                >
                    <MessagesSquare class="size-3.5 shrink-0" aria-hidden />
                    <span class="truncate text-[11px]">
                        {loading ? 'Sessions…' : activeSession ? activeSession.title : 'Conversation'}
                    </span>
                </button>
                <button
                    class="btn btn-ghost btn-sm btn-square shrink-0"
                    type="button"
                    title="Nouvelle conversation"
                    disabled={loading || creating}
                    onClick={() => void handleCreate()}
                >
                    {creating
                        ? <span class="loading loading-spinner loading-sm" />
                        : <MessageSquarePlus class="size-4" aria-hidden />}
                </button>
            </div>

            {error && (
                <p class="absolute start-0 top-full z-20 mt-1 max-w-xs rounded-lg border border-error/30 bg-base-100 px-2 py-1 text-[10px] text-error shadow">
                    {error}
                </p>
            )}

            {open && sessions.length > 0 && (
                <div class="absolute start-0 top-full z-20 mt-1 w-72 overflow-hidden rounded-xl border border-base-300 bg-base-100 shadow-lg">
                    <div class="border-b border-base-300 px-3 py-2 text-[11px] font-medium text-base-content/60">
                        Conversations
                    </div>
                    <ul class="max-h-64 overflow-y-auto py-1">
                        {sessions.map((session) => (
                            <li key={session.uuid}>
                                <button
                                    class={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-start text-xs hover:bg-base-200 ${session.uuid === activeSessionUuid ? 'bg-primary/10 text-primary' : ''}`}
                                    type="button"
                                    onClick={() => void handleSelect(session)}
                                >
                                    <span class="font-medium">{session.title}</span>
                                    <span class="text-[10px] text-base-content/50">
                                        {formatSessionLabel(session)}
                                        {session.is_legacy ? ' · partagé' : ''}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
