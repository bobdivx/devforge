import { ArrowLeft, Bot, PanelRightOpen, Send, Settings2, Square } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { AgentAvatar } from './AgentAvatar';
import { AgentErrorAlert } from './AgentErrorAlert';
import { AgentSettingsPanel } from './AgentSettingsPanel';
import { AgentStatusBadge } from './AgentStatusBadge';
import type { Agent, AgentChatMessage } from '../../lib/domain-api';
import { domainApi } from '../../lib/domain-api';
import { ApiError } from '../../lib/api-client';
import { shouldOpenAgentSettings, syncAgentSettingsQueryParam } from '../../lib/agent-routes';
import { formatAgentProviderDisplay } from '../../lib/llm-models';

type Props = {
    agent: Agent;
    onBack: (event: MouseEvent) => void;
    onAgentUpdated: () => void;
};

const suggestions = [
    'Quel est l\'état de mes ressources ?',
    'Y a-t-il des déploiements en échec ?',
    'Analyse les logs du dernier déploiement',
    'Liste mes serveurs et leur statut',
];

function formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function renderContent(content: string) {
    return content
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br />');
}

export function AgentChatView({ agent, onBack, onAgentUpdated }: Props) {
    const [messages, setMessages] = useState<AgentChatMessage[]>([]);
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [draft, setDraft] = useState('');
    const [settingsOpen, setSettingsOpen] = useState(() => shouldOpenAgentSettings(window.location.search));

    const toggleSettings = (open: boolean) => {
        setSettingsOpen(open);
        syncAgentSettingsQueryParam(open);
    };
    const scrollRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const loadMessages = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await domainApi.agentMessages(agent.uuid);
            setMessages(response.data);
            if (response.meta?.degraded) {
                setError('Le chat est en mode dégradé : relancez le déploiement DevForge pour activer l\'historique.');
            }
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Impossible de charger la conversation.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadMessages();
    }, [agent.uuid]);

    useEffect(() => {
        setSettingsOpen(shouldOpenAgentSettings(window.location.search));
    }, [agent.uuid]);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, [messages, sending]);

    const waitForChatReply = async (runUuid: string): Promise<void> => {
        for (let attempt = 0; attempt < 120; attempt += 1) {
            await new Promise((resolve) => window.setTimeout(resolve, 1500));

            const run = await domainApi.agentRun(agent.uuid, runUuid);
            if (run.data.status === 'failed') {
                throw new ApiError(502, { message: run.data.summary ?? 'La réponse de l\'agent a échoué.' });
            }

            if (run.data.status !== 'completed') {
                continue;
            }

            const response = await domainApi.agentMessages(agent.uuid);
            setMessages(response.data);
            onAgentUpdated();

            return;
        }

        throw new ApiError(504, { message: 'Délai dépassé en attendant la réponse de l\'agent.' });
    };

    const sendMessage = async (content: string) => {
        const trimmed = content.trim();
        if (!trimmed || sending || !agent.provider) {
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
            const response = await domainApi.sendAgentMessage(agent.uuid, trimmed);
            setMessages((current) => [
                ...current.filter((m) => m.uuid !== optimisticUser.uuid),
                response.data.user,
            ]);
            await waitForChatReply(response.data.run_uuid);
        } catch (err) {
            setMessages((current) => current.filter((m) => m.uuid !== optimisticUser.uuid));
            setError(err instanceof ApiError ? err.message : 'Échec de l\'envoi du message.');
            setDraft(trimmed);
        } finally {
            setSending(false);
            textareaRef.current?.focus();
        }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void sendMessage(draft);
        }
    };

    const showSuggestions = messages.length <= 1 && !sending && !loading;

    return (
        <div class="flex h-[calc(100dvh-4.5rem)] min-h-[32rem] flex-col overflow-hidden rounded-xl border border-base-300 bg-base-100">
            {/* Header style IDE */}
            <header class="flex shrink-0 items-center gap-3 border-b border-base-300 px-4 py-3">
                <button
                    class="btn btn-ghost btn-sm btn-square"
                    type="button"
                    title="Retour aux agents"
                    onClick={onBack}
                >
                    <ArrowLeft class="size-4" aria-hidden />
                </button>
                <AgentAvatar type={agent.type} color={agent.avatar_color} name={agent.name} />
                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                        <h1 class="truncate text-sm font-semibold">{agent.name}</h1>
                        <AgentStatusBadge status={agent.status} />
                    </div>
                    <p class="truncate text-[11px] text-base-content/50">
                        {agent.provider
                            ? formatAgentProviderDisplay(agent.provider.provider)
                            : 'Auto (provider par défaut)'}
                    </p>
                </div>
                <button
                    class={`btn btn-ghost btn-sm btn-square ${settingsOpen ? 'bg-base-300' : ''}`}
                    type="button"
                    title="Configuration"
                    onClick={() => toggleSettings(!settingsOpen)}
                >
                    <Settings2 class="size-4" aria-hidden />
                </button>
            </header>

            <div class="flex min-h-0 flex-1">
                {/* Zone chat principale */}
                <div class="flex min-w-0 flex-1 flex-col">
                    <AgentErrorAlert agent={agent} compact />

                    <div ref={scrollRef} class="flex-1 overflow-y-auto px-4 py-4">
                        {loading ? (
                            <div class="flex h-full items-center justify-center text-xs text-base-content/50">
                                <span class="loading loading-spinner loading-sm me-2" />
                                Chargement de la conversation…
                            </div>
                        ) : (
                            <div class="mx-auto flex max-w-3xl flex-col gap-4">
                                {messages.map((message) => (
                                    <article
                                        key={message.uuid}
                                        class={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
                                    >
                                        <div class={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg ${message.role === 'user' ? 'bg-primary/15 text-primary' : 'bg-base-300 text-base-content/70'}`}>
                                            {message.role === 'user'
                                                ? <span class="text-[10px] font-bold">Vous</span>
                                                : <Bot class="size-3.5" aria-hidden />}
                                        </div>
                                        <div class={`max-w-[85%] ${message.role === 'user' ? 'text-end' : ''}`}>
                                            <div
                                                class={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                                                    message.role === 'user'
                                                        ? 'bg-primary text-primary-content'
                                                        : 'border border-base-300 bg-base-200/60 text-base-content'
                                                }`}
                                            >
                                                <div
                                                    class="prose prose-sm max-w-none text-inherit [&_strong]:font-semibold"
                                                    dangerouslySetInnerHTML={{ __html: renderContent(message.content) }}
                                                />
                                            </div>
                                            <time class="mt-1 block text-[10px] text-base-content/40" datetime={message.created_at}>
                                                {formatTime(message.created_at)}
                                            </time>
                                        </div>
                                    </article>
                                ))}

                                {sending && (
                                    <article class="flex gap-3">
                                        <div class="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-base-300 text-base-content/70">
                                            <Bot class="size-3.5" aria-hidden />
                                        </div>
                                        <div class="rounded-2xl border border-base-300 bg-base-200/60 px-3.5 py-2.5">
                                            <span class="loading loading-dots loading-sm text-base-content/50" />
                                        </div>
                                    </article>
                                )}
                            </div>
                        )}
                    </div>

                    {showSuggestions && (
                        <div class="shrink-0 border-t border-base-300 px-4 py-3">
                            <p class="mb-2 text-[11px] font-medium text-base-content/50">Suggestions</p>
                            <div class="flex flex-wrap gap-2">
                                {suggestions.map((suggestion) => (
                                    <button
                                        key={suggestion}
                                        class="btn btn-ghost btn-xs h-auto min-h-7 whitespace-normal rounded-full border border-base-300 px-3 py-1 text-left text-[11px] font-normal"
                                        type="button"
                                        disabled={!agent.provider}
                                        onClick={() => void sendMessage(suggestion)}
                                    >
                                        {suggestion}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Composer style Cursor */}
                    <div class="shrink-0 border-t border-base-300 p-4">
                        {error && (
                            <p class="mb-2 rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-xs text-error" role="alert">
                                {error}
                            </p>
                        )}
                        {!agent.provider && (
                            <p class="mb-2 text-xs text-warning">
                                Configurez un provider LLM dans les paramètres pour discuter avec cet agent.
                            </p>
                        )}
                        <div class="mx-auto flex max-w-3xl items-end gap-2 rounded-xl border border-base-300 bg-base-200/50 p-2 focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/20">
                            <textarea
                                ref={textareaRef}
                                class="max-h-40 min-h-[2.5rem] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-base-content/40"
                                placeholder="Posez une question à l'agent… (Entrée pour envoyer, Maj+Entrée pour nouvelle ligne)"
                                rows={1}
                                disabled={sending || !agent.provider}
                                value={draft}
                                onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
                                onKeyDown={handleKeyDown}
                            />
                            <button
                                class="btn btn-primary btn-sm btn-square shrink-0"
                                type="button"
                                title={sending ? 'En cours…' : 'Envoyer'}
                                disabled={sending || !draft.trim() || !agent.provider}
                                onClick={() => void sendMessage(draft)}
                            >
                                {sending
                                    ? <Square class="size-3.5" aria-hidden />
                                    : <Send class="size-3.5" aria-hidden />}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Panneau latéral configuration */}
                {settingsOpen && (
                    <aside class="hidden w-80 shrink-0 overflow-y-auto border-s border-base-300 bg-base-200/30 lg:block">
                        <AgentSettingsPanel agent={agent} onUpdated={onAgentUpdated} onClose={() => toggleSettings(false)} />
                    </aside>
                )}
            </div>

            {/* Panneau mobile */}
            {settingsOpen && (
                <div class="fixed inset-0 z-50 lg:hidden">
                    <button class="absolute inset-0 bg-black/50" type="button" aria-label="Fermer" onClick={() => toggleSettings(false)} />
                    <aside class="absolute inset-y-0 end-0 w-full max-w-sm overflow-y-auto border-s border-base-300 bg-base-100 shadow-xl">
                        <div class="flex items-center justify-between border-b border-base-300 px-4 py-3">
                            <span class="text-sm font-semibold">Configuration</span>
                            <button class="btn btn-ghost btn-sm btn-square" type="button" onClick={() => toggleSettings(false)}>
                                <PanelRightOpen class="size-4" aria-hidden />
                            </button>
                        </div>
                        <AgentSettingsPanel agent={agent} onUpdated={onAgentUpdated} onClose={() => toggleSettings(false)} />
                    </aside>
                </div>
            )}
        </div>
    );
}
