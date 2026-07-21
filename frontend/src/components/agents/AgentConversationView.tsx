import { MessageSquarePlus, RefreshCw } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import type { Agent, AgentChatMessage, AgentChatSession, AgentModelRouting } from '../../lib/domain-api';
import { domainApi } from '../../lib/domain-api';
import { ApiError } from '../../lib/api-client';
import { agentDetailSessionUuid, shouldOpenAgentSettings, syncAgentDetailQuery } from '../../lib/agent-routes';
import { AgentChatPanel, waitForChatReply } from './AgentChatPanel';
import { SessionHistoryList } from './SessionHistoryList';

type Props = {
    agent: Agent;
    initialSessionUuid?: string | null;
    onAgentUpdated: () => void;
    onRoutingChange?: (routing: AgentModelRouting | null) => void;
};

export function AgentConversationView({
    agent,
    initialSessionUuid = null,
    onAgentUpdated,
    onRoutingChange,
}: Props) {
    const [sessions, setSessions] = useState<AgentChatSession[]>([]);
    const [selectedSessionUuid, setSelectedSessionUuid] = useState<string | null>(initialSessionUuid);
    const [activeSession, setActiveSession] = useState<AgentChatSession | null>(null);
    const [messages, setMessages] = useState<AgentChatMessage[]>([]);
    const [loadingSessions, setLoadingSessions] = useState(true);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [creating, setCreating] = useState(false);
    const [sending, setSending] = useState(false);
    const [approvingMessageUuid, setApprovingMessageUuid] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [draft, setDraft] = useState('');

    const syncSessionQuery = (sessionUuid: string | null) => {
        syncAgentDetailQuery({
            settings: shouldOpenAgentSettings(window.location.search),
            view: 'chat',
            run: null,
            session: sessionUuid,
        });
    };

    const refreshSessions = async () => {
        const response = await domainApi.agentSessions(agent.uuid);
        setSessions(response.data);

        return response;
    };

    const loadMessages = async (sessionUuid: string) => {
        setLoadingMessages(true);
        setError(null);

        try {
            const response = await domainApi.agentSessionMessages(agent.uuid, sessionUuid);
            setMessages(response.data);
            if (response.meta?.degraded) {
                setError('Le chat est en mode dégradé : relancez le déploiement DevForge pour activer l\'historique.');
            }
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Impossible de charger la conversation.');
            setMessages([]);
        } finally {
            setLoadingMessages(false);
        }
    };

    const selectSession = async (session: AgentChatSession) => {
        setSelectedSessionUuid(session.uuid);
        setActiveSession(session);
        syncSessionQuery(session.uuid);
        setDraft('');

        try {
            await domainApi.activateAgentSession(agent.uuid, session.uuid);
            await loadMessages(session.uuid);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Impossible d\'activer cette session.');
        }
    };

    const handleSelectUuid = (sessionUuid: string) => {
        const session = sessions.find((item) => item.uuid === sessionUuid);
        if (session) {
            void selectSession(session);
        }
    };

    const handleCreate = async () => {
        setCreating(true);
        setError(null);

        try {
            const response = await domainApi.createAgentSession(agent.uuid);
            const session = response.data;
            setSessions((current) => [session, ...current]);
            setMessages([]);
            await selectSession(session);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Impossible de créer une session.');
        } finally {
            setCreating(false);
        }
    };

    useEffect(() => {
        setLoadingSessions(true);
        setError(null);

        refreshSessions()
            .then(async (response) => {
                const loaded = response.data;
                let preferred = initialSessionUuid
                    ?? agentDetailSessionUuid(window.location.search)
                    ?? response.meta?.active_session_uuid
                    ?? null;

                if (!preferred && loaded.length === 0) {
                    const created = await domainApi.createAgentSession(agent.uuid);
                    const session = created.data;
                    setSessions([session]);
                    await selectSession(session);
                    return;
                }

                if (!preferred) {
                    preferred = loaded[0]?.uuid ?? null;
                }

                const session = loaded.find((item) => item.uuid === preferred) ?? loaded[0] ?? null;
                if (session) {
                    await selectSession(session);
                }
            })
            .catch((err) => {
                setError(err instanceof ApiError ? err.message : 'Impossible de charger les sessions.');
            })
            .finally(() => setLoadingSessions(false));
    }, [agent.uuid]);

    useEffect(() => {
        if (!initialSessionUuid) {
            return;
        }

        const session = sessions.find((item) => item.uuid === initialSessionUuid);
        if (session && session.uuid !== activeSession?.uuid) {
            void selectSession(session);
        }
    }, [initialSessionUuid]);

    const sendMessage = async (content: string) => {
        const trimmed = content.trim();
        if (!trimmed || sending || !agent.provider || !activeSession) {
            return;
        }

        setSending(true);
        setError(null);
        setDraft('');

        const optimisticUser: AgentChatMessage = {
            uuid: `pending-${Date.now()}`,
            role: 'user',
            content: trimmed,
            metadata: null,
            run_uuid: null,
            created_at: new Date().toISOString(),
        };
        setMessages((current) => [...current.filter((m) => m.uuid !== 'welcome'), optimisticUser]);

        try {
            const response = await domainApi.sendAgentSessionMessage(agent.uuid, activeSession.uuid, trimmed);
            setMessages((current) => [
                ...current.filter((m) => m.uuid !== optimisticUser.uuid),
                response.data.user,
            ]);

            await waitForChatReply(
                agent.uuid,
                response.data.run_uuid,
                activeSession.uuid,
                (nextMessages) => {
                    setMessages(nextMessages);
                    void refreshSessions();
                },
                (routing) => onRoutingChange?.(routing),
            );
            onAgentUpdated();
        } catch (err) {
            setMessages((current) => current.filter((m) => m.uuid !== optimisticUser.uuid));
            setError(err instanceof ApiError ? err.message : 'Échec de l\'envoi du message.');
            setDraft(trimmed);
        } finally {
            setSending(false);
        }
    };

    const resolveApproval = async (messageUuid: string, decision: 'approve' | 'deny') => {
        if (!activeSession || sending || approvingMessageUuid) {
            return;
        }

        setApprovingMessageUuid(messageUuid);
        setSending(true);
        setError(null);

        try {
            const response = await domainApi.resolveAgentToolApproval(agent.uuid, messageUuid, decision);
            setMessages((current) => [
                ...current.map((message) => {
                    if (message.uuid !== messageUuid || !message.metadata) {
                        return message;
                    }

                    return {
                        ...message,
                        metadata: {
                            ...message.metadata,
                            pending_approval: {
                                ...(message.metadata.pending_approval as Record<string, unknown> | undefined),
                                resolved: decision === 'approve' ? 'approved' : 'denied',
                            },
                            pending_plan: message.metadata.pending_plan
                                ? {
                                    ...(message.metadata.pending_plan as Record<string, unknown>),
                                    resolved: decision === 'approve' ? 'approved' : 'denied',
                                }
                                : message.metadata.pending_plan,
                        },
                    };
                }),
                response.data.user,
            ]);

            await waitForChatReply(
                agent.uuid,
                response.data.run_uuid,
                activeSession.uuid,
                (nextMessages) => {
                    setMessages(nextMessages);
                    void refreshSessions();
                },
                (routing) => onRoutingChange?.(routing),
            );
            onAgentUpdated();
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Impossible d\'enregistrer la décision.');
        } finally {
            setApprovingMessageUuid(null);
            setSending(false);
        }
    };

    return (
        <div class="flex min-h-0 flex-1 flex-col">
            <div class="flex shrink-0 items-center justify-between gap-2 border-b border-base-300 bg-base-100 px-4 py-2.5">
                <p class="text-xs text-base-content/60">
                    Historique des conversations
                </p>
                <div class="flex items-center gap-1">
                    <button
                        class="btn btn-ghost btn-sm gap-2"
                        type="button"
                        onClick={() => void refreshSessions()}
                        disabled={loadingSessions}
                    >
                        <RefreshCw class="size-4" aria-hidden />
                        Actualiser
                    </button>
                    <button
                        class="btn btn-primary btn-sm gap-2"
                        type="button"
                        disabled={creating || loadingSessions}
                        onClick={() => void handleCreate()}
                    >
                        {creating
                            ? <span class="loading loading-spinner loading-sm" aria-hidden />
                            : <MessageSquarePlus class="size-4" aria-hidden />}
                        Nouvelle
                    </button>
                </div>
            </div>

            <div class="flex min-h-0 flex-1 flex-col lg:flex-row">
                <aside class="shrink-0 border-b border-base-300 bg-base-200/20 lg:w-80 lg:max-w-[40%] lg:border-b-0 lg:border-e lg:overflow-y-auto">
                    {loadingSessions ? (
                        <div class="flex items-center justify-center px-4 py-10 text-xs text-base-content/50">
                            <span class="loading loading-spinner loading-sm me-2" />
                            Chargement des sessions…
                        </div>
                    ) : (
                        <SessionHistoryList
                            sessions={sessions}
                            selectedUuid={selectedSessionUuid}
                            onSelect={handleSelectUuid}
                        />
                    )}
                </aside>

                <div class="flex min-h-0 min-w-0 flex-1 flex-col bg-base-100">
                    <AgentChatPanel
                        agent={agent}
                        session={activeSession}
                        messages={messages}
                        loading={loadingMessages}
                        sending={sending}
                        error={error}
                        draft={draft}
                        onDraftChange={setDraft}
                        onSend={(content) => void sendMessage(content)}
                        onResolveApproval={(messageUuid, decision) => void resolveApproval(messageUuid, decision)}
                        approvingMessageUuid={approvingMessageUuid}
                    />
                </div>
            </div>
        </div>
    );
}
