import { Menu, MessageSquarePlus, RefreshCw, X } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import type { Agent, AgentChatAttachment, AgentChatMessage, AgentChatSession, AgentChatStep, AgentModelRouting } from '../../lib/domain-api';
import { domainApi } from '../../lib/domain-api';
import { ApiError } from '../../lib/api-client';
import { agentDetailSessionUuid, shouldOpenAgentSettings, syncAgentDetailQuery } from '../../lib/agent-routes';
import { waitForChatReply } from '../../lib/agent-chat-stream';
import { AgentChatPanel } from './AgentChatPanel';
import { SessionHistoryList } from './SessionHistoryList';

type Props = {
    agent: Agent;
    initialSessionUuid?: string | null;
    onAgentUpdated: () => void;
    onRoutingChange?: (routing: AgentModelRouting | null) => void;
    userName?: string;
    onOpenPlugins?: () => void;
};

export function AgentConversationView({
    agent,
    initialSessionUuid = null,
    onAgentUpdated,
    onRoutingChange,
    userName,
    onOpenPlugins,
}: Props) {
    const [sessions, setSessions] = useState<AgentChatSession[]>([]);
    const [selectedSessionUuid, setSelectedSessionUuid] = useState<string | null>(initialSessionUuid);
    const [activeSession, setActiveSession] = useState<AgentChatSession | null>(null);
    const [messages, setMessages] = useState<AgentChatMessage[]>([]);
    const [loadingSessions, setLoadingSessions] = useState(true);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [creating, setCreating] = useState(false);
    const [deletingUuid, setDeletingUuid] = useState<string | null>(null);
    const [sending, setSending] = useState(false);
    const [stopping, setStopping] = useState(false);
    const [activeRunUuid, setActiveRunUuid] = useState<string | null>(null);
    const [activeSubagentCount, setActiveSubagentCount] = useState(0);
    const [liveSteps, setLiveSteps] = useState<AgentChatStep[]>([]);
    const [liveAssistantText, setLiveAssistantText] = useState<string | null>(null);
    const [approvingMessageUuid, setApprovingMessageUuid] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [draft, setDraft] = useState('');
    const [chatMode, setChatMode] = useState<'plan' | 'build' | 'debug'>('build');
    const [attachments, setAttachments] = useState<AgentChatAttachment[]>([]);
    const [sessionsDrawerOpen, setSessionsDrawerOpen] = useState(false);

    const resetLiveProgress = () => {
        setActiveRunUuid(null);
        setActiveSubagentCount(0);
        setLiveSteps([]);
        setLiveAssistantText(null);
        setStopping(false);
    };

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
        setChatMode(session.chat_mode ?? 'build');
        syncSessionQuery(session.uuid);
        setDraft('');
        setSessionsDrawerOpen(false); // Fermer le drawer après sélection

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

    const handleDelete = async (sessionUuid: string) => {
        const session = sessions.find((item) => item.uuid === sessionUuid);
        if (!session) {
            return;
        }

        const label = session.title?.trim() || 'cette conversation';
        const confirmLabel = session.is_legacy
            ? `Supprimer « ${label} » (session partagée) ? Les messages seront effacés.`
            : `Supprimer « ${label} » ? Les messages seront effacés.`;
        if (!window.confirm(confirmLabel)) {
            return;
        }

        setDeletingUuid(sessionUuid);
        setError(null);

        try {
            const response = await domainApi.deleteAgentSession(agent.uuid, sessionUuid);
            const remaining = sessions.filter((item) => item.uuid !== sessionUuid);
            setSessions(remaining);

            if (selectedSessionUuid !== sessionUuid) {
                return;
            }

            const nextUuid = response.meta.active_session_uuid;
            const next = nextUuid
                ? remaining.find((item) => item.uuid === nextUuid) ?? remaining[0] ?? null
                : remaining[0] ?? null;

            if (next) {
                await selectSession(next);
            } else {
                setSelectedSessionUuid(null);
                setActiveSession(null);
                setMessages([]);
                syncSessionQuery(null);
            }
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Impossible de supprimer la conversation.');
        } finally {
            setDeletingUuid(null);
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
        if ((!trimmed && attachments.length === 0) || sending || !agent.provider || !activeSession) {
            return;
        }

        setSending(true);
        setError(null);
        setDraft('');
        resetLiveProgress();
        const pendingAttachments = attachments;
        setAttachments([]);

        const optimisticUser: AgentChatMessage = {
            uuid: `pending-${Date.now()}`,
            role: 'user',
            content: trimmed || '(captures jointes)',
            metadata: null,
            run_uuid: null,
            created_at: new Date().toISOString(),
        };
        setMessages((current) => [...current.filter((m) => m.uuid !== 'welcome'), optimisticUser]);

        try {
            const response = await domainApi.sendAgentSessionMessage(agent.uuid, activeSession.uuid, trimmed || 'Voir les captures jointes.', {
                chat_mode: chatMode,
                ...(pendingAttachments.length > 0 ? { attachments: pendingAttachments } : {}),
            });
            setMessages((current) => [
                ...current.filter((m) => m.uuid !== optimisticUser.uuid),
                response.data.user,
            ]);
            setActiveSession((current) => current ? { ...current, chat_mode: chatMode } : current);
            setActiveRunUuid(response.data.run_uuid);

            await waitForChatReply(
                agent.uuid,
                response.data.run_uuid,
                activeSession.uuid,
                (nextMessages) => {
                    setMessages(nextMessages);
                    void refreshSessions();
                },
                (routing) => onRoutingChange?.(routing),
                (progress) => {
                    setActiveSubagentCount(progress.active_subagent_count ?? 0);
                    if (Array.isArray(progress.steps)) {
                        setLiveSteps(progress.steps);
                    }
                    if (typeof progress.live_assistant_text === 'string' && progress.live_assistant_text.trim() !== '') {
                        setLiveAssistantText(progress.live_assistant_text);
                    } else if (typeof progress.summary === 'string' && progress.summary.trim() !== '') {
                        setLiveAssistantText(progress.summary);
                    }
                },
            );
            onAgentUpdated();
        } catch (err) {
            setMessages((current) => current.filter((m) => m.uuid !== optimisticUser.uuid));
            setError(err instanceof ApiError ? err.message : 'Échec de l\'envoi du message.');
            setDraft(trimmed);
            setAttachments(pendingAttachments);
        } finally {
            setSending(false);
            resetLiveProgress();
        }
    };

    const stopRun = async () => {
        if (!activeRunUuid || stopping) {
            return;
        }
        setStopping(true);
        setError(null);
        try {
            await domainApi.cancelAgentRun(agent.uuid, activeRunUuid, 'Arrêt demandé depuis le chat.');
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Impossible d\'arrêter le run.');
            setStopping(false);
        }
    };

    const resolveApproval = async (messageUuid: string, decision: 'approve' | 'deny', remember?: boolean) => {
        if (!activeSession || sending || approvingMessageUuid) {
            return;
        }

        setApprovingMessageUuid(messageUuid);
        setSending(true);
        setError(null);

        try {
            const response = await domainApi.resolveAgentToolApproval(agent.uuid, messageUuid, decision, remember);
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

            setActiveRunUuid(response.data.run_uuid);
            await waitForChatReply(
                agent.uuid,
                response.data.run_uuid,
                activeSession.uuid,
                (nextMessages) => {
                    setMessages(nextMessages);
                    void refreshSessions();
                },
                (routing) => onRoutingChange?.(routing),
                (progress) => {
                    setActiveSubagentCount(progress.active_subagent_count ?? 0);
                    if (Array.isArray(progress.steps)) {
                        setLiveSteps(progress.steps);
                    }
                    if (typeof progress.live_assistant_text === 'string' && progress.live_assistant_text.trim() !== '') {
                        setLiveAssistantText(progress.live_assistant_text);
                    }
                },
            );
            onAgentUpdated();
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Impossible d\'enregistrer la décision.');
        } finally {
            setApprovingMessageUuid(null);
            setSending(false);
            resetLiveProgress();
        }
    };

    return (
        <div class="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
            {/* Desktop sidebar - visible uniquement sur lg+ */}
            <aside class="hidden shrink-0 flex-col border-e border-base-300 bg-base-200/20 lg:flex lg:w-72 lg:max-w-[40%]">
                <div class="flex shrink-0 items-center justify-end gap-1 px-3 pt-3">
                    <button
                        class="btn btn-ghost btn-sm btn-square size-8 sm:size-9 min-h-8 sm:min-h-9 p-0"
                        type="button"
                        title="Actualiser"
                        onClick={() => void refreshSessions()}
                        disabled={loadingSessions}
                    >
                        <RefreshCw class="size-4" aria-hidden />
                    </button>
                    <button
                        class="btn btn-primary btn-sm gap-1.5 px-2.5"
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
                {loadingSessions ? (
                    <div class="flex flex-1 items-center justify-center px-3 sm:px-4 py-10 text-xs text-base-content/50">
                        <span class="loading loading-spinner loading-sm me-2" />
                        Chargement des sessions…
                    </div>
                ) : (
                    <SessionHistoryList
                        agent={agent}
                        sessions={sessions}
                        selectedUuid={selectedSessionUuid}
                        onSelect={handleSelectUuid}
                        onDelete={(uuid) => void handleDelete(uuid)}
                        deletingUuid={deletingUuid}
                        userName={userName}
                        onOpenPlugins={onOpenPlugins}
                    />
                )}
            </aside>

            {/* Mobile drawer - overlay avec backdrop */}
            {sessionsDrawerOpen && (
                <div class="fixed inset-0 z-50 lg:hidden">
                    <button
                        class="absolute inset-0 bg-black/50"
                        type="button"
                        aria-label="Fermer"
                        onClick={() => setSessionsDrawerOpen(false)}
                    />
                    <aside class="absolute inset-y-0 start-0 flex w-full max-w-sm flex-col overflow-hidden border-e border-base-300 bg-base-100 shadow-xl">
                        <div class="flex shrink-0 items-center justify-between border-b border-base-300 px-3 py-2.5">
                            <span class="text-xs sm:text-sm font-semibold">Conversations</span>
                            <button
                                class="btn btn-ghost btn-sm btn-square size-8 sm:size-9 min-h-8 sm:min-h-9 p-0"
                                type="button"
                                onClick={() => setSessionsDrawerOpen(false)}
                            >
                                <X class="size-4" aria-hidden />
                            </button>
                        </div>
                        <div class="flex shrink-0 items-center justify-end gap-1 px-3 pt-2 pb-2">
                            <button
                                class="btn btn-ghost btn-sm btn-square size-8 sm:size-9 min-h-8 sm:min-h-9 p-0"
                                type="button"
                                title="Actualiser"
                                onClick={() => void refreshSessions()}
                                disabled={loadingSessions}
                            >
                                <RefreshCw class="size-4" aria-hidden />
                            </button>
                            <button
                                class="btn btn-primary btn-sm gap-1.5 px-2.5"
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
                        {loadingSessions ? (
                            <div class="flex flex-1 items-center justify-center px-3 sm:px-4 py-10 text-xs text-base-content/50">
                                <span class="loading loading-spinner loading-sm me-2" />
                                Chargement…
                            </div>
                        ) : (
                            <SessionHistoryList
                                agent={agent}
                                sessions={sessions}
                                selectedUuid={selectedSessionUuid}
                                onSelect={handleSelectUuid}
                                onDelete={(uuid) => void handleDelete(uuid)}
                                deletingUuid={deletingUuid}
                                userName={userName}
                                onOpenPlugins={onOpenPlugins}
                            />
                        )}
                    </aside>
                </div>
            )}

            <div class="flex min-h-0 min-w-0 flex-1 flex-col bg-base-100">
                {/* Mobile: bouton menu pour ouvrir le drawer */}
                <div class="flex shrink-0 items-center justify-between border-b border-base-300 bg-base-100 px-3 py-2 lg:hidden">
                    <button
                        class="btn btn-ghost btn-sm gap-1.5 px-2.5"
                        type="button"
                        onClick={() => setSessionsDrawerOpen(true)}
                    >
                        <Menu class="size-4" aria-hidden />
                        Conversations ({sessions.length})
                    </button>
                    <button
                        class="btn btn-primary btn-sm btn-square size-8 sm:size-9 min-h-8 sm:min-h-9 p-0"
                        type="button"
                        title="Nouvelle conversation"
                        disabled={creating}
                        onClick={() => void handleCreate()}
                    >
                        {creating
                            ? <span class="loading loading-spinner loading-sm" aria-hidden />
                            : <MessageSquarePlus class="size-4" aria-hidden />}
                    </button>
                </div>

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
                        onStop={() => void stopRun()}
                        stopping={stopping}
                        onResolveApproval={(messageUuid, decision, remember) => void resolveApproval(messageUuid, decision, remember)}
                        approvingMessageUuid={approvingMessageUuid}
                        hideSessionHeader
                        userName={userName}
                        chatMode={chatMode}
                        onChatModeChange={(mode) => {
                            setChatMode(mode);
                            if (activeSession) {
                                void domainApi.updateAgentSession(agent.uuid, activeSession.uuid, { chat_mode: mode })
                                    .then((response) => {
                                        setActiveSession(response.data);
                                        setSessions((current) => current.map((item) => (
                                            item.uuid === response.data.uuid ? response.data : item
                                        )));
                                    })
                                    .catch(() => {});
                            }
                        }}
                        attachments={attachments}
                        onAttachmentsChange={setAttachments}
                        activeSubagentCount={activeSubagentCount}
                        liveSteps={liveSteps}
                        liveAssistantText={liveAssistantText}
                        activeRoutingProvider={agent.provider?.provider ?? null}
                    />
            </div>
        </div>
    );
}
