import { Bot, ExternalLink } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { AgentChatPanel } from '../agents/AgentChatPanel';
import { waitForChatReply } from '../../lib/agent-chat-stream';
import {
    applicationAgentSessionTitle,
    pickApplicationChatAgentPreferringSession,
} from '../../lib/application-agent-chat';
import { agentDetailPath } from '../../lib/agent-routes';
import { ApiError } from '../../lib/api-client';
import {
    domainApi,
    type Agent,
    type AgentChatAttachment,
    type AgentChatMessage,
    type AgentChatSession,
    type AgentChatStep,
    type CoreResource,
} from '../../lib/domain-api';

type Props = {
    application: CoreResource;
};

export function ApplicationAgentChatCard({ application }: Props) {
    const [agent, setAgent] = useState<Agent | null>(null);
    const [session, setSession] = useState<AgentChatSession | null>(null);
    const [messages, setMessages] = useState<AgentChatMessage[]>([]);
    const [loading, setLoading] = useState(true);
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
    const [setupMessage, setSetupMessage] = useState<string | null>(null);

    const sessionTitle = applicationAgentSessionTitle(application.name);

    const resetLiveProgress = () => {
        setActiveRunUuid(null);
        setActiveSubagentCount(0);
        setLiveSteps([]);
        setLiveAssistantText(null);
        setStopping(false);
    };

    useEffect(() => {
        let cancelled = false;

        const bootstrap = async () => {
            setLoading(true);
            setError(null);
            setSetupMessage(null);
            setAgent(null);
            setSession(null);
            setMessages([]);

            try {
                const agentsResponse = await domainApi.agents();
                if (cancelled) {
                    return;
                }

                const candidates = agentsResponse.data.filter((item) => {
                    if (!item.is_active || !item.provider) {
                        return false;
                    }
                    if (!['deployment', 'devforge', 'debug'].includes(item.type)) {
                        return false;
                    }
                    if (item.resource_uuid && item.resource_uuid !== application.uuid) {
                        return false;
                    }
                    return true;
                });

                const withTitle = new Set<string>();
                await Promise.all(candidates.map(async (candidate) => {
                    try {
                        const sessionsResponse = await domainApi.agentSessions(candidate.uuid);
                        if (sessionsResponse.data.some((item) => item.title === sessionTitle)) {
                            withTitle.add(candidate.uuid);
                        }
                    } catch {
                        // Ignorer un agent inaccessible.
                    }
                }));

                if (cancelled) {
                    return;
                }

                const selected = pickApplicationChatAgentPreferringSession(
                    agentsResponse.data,
                    application.uuid,
                    sessionTitle,
                    withTitle,
                );
                if (!selected) {
                    setSetupMessage(
                        'Aucun agent IA actif (deployment / devforge / debug) avec provider LLM. '
                        + 'Créez-en un dans Agents pour la correction automatique et ce chat.',
                    );
                    return;
                }

                setAgent(selected);

                const sessionsResponse = await domainApi.agentSessions(selected.uuid);
                if (cancelled) {
                    return;
                }

                let active = sessionsResponse.data.find((item) => item.title === sessionTitle) ?? null;
                if (!active) {
                    const created = await domainApi.createAgentSession(selected.uuid, sessionTitle);
                    active = created.data;
                } else {
                    await domainApi.activateAgentSession(selected.uuid, active.uuid);
                }

                if (cancelled) {
                    return;
                }

                setSession(active);
                setChatMode(active.chat_mode ?? 'build');
                const history = await domainApi.agentSessionMessages(selected.uuid, active.uuid);
                if (!cancelled) {
                    setMessages(history.data);
                }
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof ApiError ? err.message : 'Impossible de préparer le chat.');
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        void bootstrap();

        return () => {
            cancelled = true;
        };
    }, [application.uuid, application.name, sessionTitle]);

    // Poll pour les messages auto (échecs deploy / rapports agent) hors envoi manuel.
    useEffect(() => {
        if (!agent || !session || sending || loading) {
            return;
        }

        let cancelled = false;

        const refresh = async () => {
            try {
                const history = await domainApi.agentSessionMessages(agent.uuid, session.uuid);
                if (!cancelled) {
                    setMessages(history.data);
                }
            } catch {
                // Ignorer les erreurs de polling silencieuses.
            }
        };

        const id = window.setInterval(() => {
            void refresh();
        }, 4000);

        return () => {
            cancelled = true;
            window.clearInterval(id);
        };
    }, [agent, session, sending, loading]);

    const handleSend = async (content: string) => {
        if (!agent || !session || sending) {
            return;
        }

        const trimmed = content.trim();
        if (!trimmed && attachments.length === 0) {
            return;
        }

        const optimisticUser: AgentChatMessage = {
            uuid: `local-${Date.now()}`,
            role: 'user',
            content: trimmed || '(captures jointes)',
            metadata: null,
            run_uuid: null,
            session_uuid: session.uuid,
            created_at: new Date().toISOString(),
        };

        setSending(true);
        setError(null);
        setDraft('');
        resetLiveProgress();
        const pendingAttachments = attachments;
        setAttachments([]);
        setMessages((current) => [...current, optimisticUser]);

        try {
            const response = await domainApi.sendAgentSessionMessage(
                agent.uuid,
                session.uuid,
                trimmed || 'Voir les captures jointes.',
                {
                    application_uuid: application.uuid,
                    chat_mode: chatMode,
                    ...(pendingAttachments.length > 0 ? { attachments: pendingAttachments } : {}),
                },
            );

            setMessages((current) => [
                ...current.filter((message) => message.uuid !== optimisticUser.uuid),
                response.data.user,
            ]);
            setSession((current) => current ? { ...current, chat_mode: chatMode } : current);
            setActiveRunUuid(response.data.run_uuid);

            await waitForChatReply(
                agent.uuid,
                response.data.run_uuid,
                session.uuid,
                (nextMessages) => setMessages(nextMessages),
                undefined,
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
        } catch (err) {
            setMessages((current) => current.filter((message) => message.uuid !== optimisticUser.uuid));
            setError(err instanceof ApiError ? err.message : 'Échec de l\'envoi du message.');
            setDraft(trimmed);
            setAttachments(pendingAttachments);
        } finally {
            setSending(false);
            resetLiveProgress();
        }
    };

    const stopRun = async () => {
        if (!agent || !activeRunUuid || stopping) {
            return;
        }
        setStopping(true);
        setError(null);
        try {
            await domainApi.cancelAgentRun(agent.uuid, activeRunUuid, 'Arrêt demandé depuis le chat application.');
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Impossible d\'arrêter le run.');
            setStopping(false);
        }
    };

    const resolveApproval = async (messageUuid: string, decision: 'approve' | 'deny') => {
        if (!agent || !session || sending || approvingMessageUuid) {
            return;
        }

        setApprovingMessageUuid(messageUuid);
        setSending(true);
        setError(null);
        resetLiveProgress();

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

            setActiveRunUuid(response.data.run_uuid);
            await waitForChatReply(
                agent.uuid,
                response.data.run_uuid,
                session.uuid,
                (nextMessages) => setMessages(nextMessages),
                undefined,
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
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Impossible d\'enregistrer la décision.');
        } finally {
            setApprovingMessageUuid(null);
            setSending(false);
            resetLiveProgress();
        }
    };

    return (
        <section class="min-w-0 overflow-hidden rounded-2xl border border-base-300/70 bg-base-100 shadow-sm">
            <div class="flex items-center justify-between gap-3 border-b border-base-300/70 px-3 py-3 sm:px-5 sm:py-4">
                <div class="min-w-0">
                    <p class="inline-flex items-center gap-2 text-sm font-semibold">
                        <Bot class="size-4 shrink-0 text-primary" aria-hidden />
                        <span class="truncate">Chat</span>
                    </p>
                    <p class="mt-0.5 truncate text-xs text-base-content/50">
                        {agent ? agent.name : application.name}
                        {agent?.provider ? ` · ${agent.provider.model}` : ''}
                    </p>
                </div>
                {agent && (
                    <a
                        class="btn btn-ghost btn-sm shrink-0 gap-1.5 rounded-full border border-base-300/80 px-2.5 sm:px-3"
                        href={agentDetailPath(agent.uuid, { view: 'chat', session: session?.uuid })}
                        title="Ouvrir l’agent"
                    >
                        <span class="hidden sm:inline">Ouvrir</span>
                        <ExternalLink class="size-3.5" aria-hidden />
                    </a>
                )}
            </div>

            <div class="flex h-[min(28rem,70dvh)] min-h-[18rem] flex-col sm:h-[30rem]">
                {loading && (
                    <div class="flex flex-1 items-center justify-center gap-2 text-xs text-base-content/50">
                        <span class="loading loading-spinner loading-sm" />
                        Préparation…
                    </div>
                )}

                {!loading && setupMessage && (
                    <div class="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center sm:px-6">
                        <p class="text-sm text-base-content/70">{setupMessage}</p>
                        <a class="btn btn-primary btn-sm rounded-full" href="/agents">
                            Configurer un agent
                        </a>
                    </div>
                )}

                {!loading && !setupMessage && agent && session && (
                    <AgentChatPanel
                        agent={agent}
                        session={session}
                        messages={messages}
                        loading={false}
                        sending={sending}
                        error={error}
                        draft={draft}
                        onDraftChange={setDraft}
                        onSend={(content) => void handleSend(content)}
                        onStop={() => void stopRun()}
                        stopping={stopping}
                        onResolveApproval={(messageUuid, decision) => void resolveApproval(messageUuid, decision)}
                        approvingMessageUuid={approvingMessageUuid}
                        chatMode={chatMode}
                        onChatModeChange={(mode) => {
                            setChatMode(mode);
                            void domainApi.updateAgentSession(agent.uuid, session.uuid, { chat_mode: mode })
                                .then((response) => setSession(response.data))
                                .catch(() => {});
                        }}
                        attachments={attachments}
                        onAttachmentsChange={setAttachments}
                        activeSubagentCount={activeSubagentCount}
                        liveSteps={liveSteps}
                        liveAssistantText={liveAssistantText}
                        placeholder="Écrire un message…"
                        hideSessionHeader
                    />
                )}

                {!loading && !setupMessage && agent && !session && (
                    <div class="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center sm:px-6">
                        <p class="text-sm text-error" role="alert">
                            {error ?? 'Impossible de préparer la conversation.'}
                        </p>
                    </div>
                )}
            </div>
        </section>
    );
}
