import { Bot, Send, Square } from 'lucide-preact';
import { useEffect, useRef } from 'preact/hooks';
import type { Agent, AgentChatMessage, AgentChatSession, AgentModelRouting } from '../../lib/domain-api';
import { domainApi } from '../../lib/domain-api';
import { ApiError } from '../../lib/api-client';
import { AgentErrorAlert } from './AgentErrorAlert';

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

type Props = {
    agent: Agent;
    session: AgentChatSession | null;
    messages: AgentChatMessage[];
    loading: boolean;
    sending: boolean;
    error: string | null;
    draft: string;
    onDraftChange: (value: string) => void;
    onSend: (content: string) => void;
    onRoutingChange?: (routing: AgentModelRouting | null) => void;
};

export function AgentChatPanel({
    agent,
    session,
    messages,
    loading,
    sending,
    error,
    draft,
    onDraftChange,
    onSend,
}: Props) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, [messages, sending, session?.uuid]);

    useEffect(() => {
        if (session) {
            textareaRef.current?.focus();
        }
    }, [session?.uuid]);

    const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            onSend(draft);
        }
    };

    const showSuggestions = session && messages.length <= 1 && !sending && !loading;

    if (!session) {
        return (
            <div class="flex h-full min-h-[16rem] flex-col items-center justify-center gap-4 px-6 py-12 text-center">
                <div class="grid size-14 place-items-center rounded-2xl border border-base-300 bg-base-200/60 text-base-content/40">
                    <Bot class="size-7" aria-hidden />
                </div>
                <div class="max-w-sm">
                    <p class="text-sm font-semibold text-base-content/85">Sélectionnez une conversation</p>
                    <p class="mt-1.5 text-xs leading-relaxed text-base-content/50">
                        Choisissez une session dans la liste ou créez-en une nouvelle pour reprendre le fil.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div class="flex min-h-0 flex-1 flex-col">
            <div class="shrink-0 border-b border-base-300 bg-base-100 px-4 py-2.5">
                <p class="truncate text-sm font-semibold text-base-content">{session.title}</p>
                <p class="mt-0.5 text-[11px] text-base-content/50">
                    {session.is_legacy ? 'Session partagée · ' : ''}
                    {messages.length} message{messages.length > 1 ? 's' : ''}
                </p>
            </div>

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
                                onClick={() => onSend(suggestion)}
                            >
                                {suggestion}
                            </button>
                        ))}
                    </div>
                </div>
            )}

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
                        onInput={(e) => onDraftChange((e.target as HTMLTextAreaElement).value)}
                        onKeyDown={handleKeyDown}
                    />
                    <button
                        class="btn btn-primary btn-sm btn-square shrink-0"
                        type="button"
                        title={sending ? 'En cours…' : 'Envoyer'}
                        disabled={sending || !draft.trim() || !agent.provider}
                        onClick={() => onSend(draft)}
                    >
                        {sending
                            ? <Square class="size-3.5" aria-hidden />
                            : <Send class="size-3.5" aria-hidden />}
                    </button>
                </div>
            </div>
        </div>
    );
}

export async function waitForChatReply(
    agentUuid: string,
    runUuid: string,
    sessionUuid: string,
    onMessages: (messages: AgentChatMessage[]) => void,
    onRouting?: (routing: AgentModelRouting) => void,
): Promise<void> {
    for (let attempt = 0; attempt < 120; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1500));

        const run = await domainApi.agentRun(agentUuid, runUuid);
        if (run.data.metadata?.model_routing) {
            onRouting?.(run.data.metadata.model_routing);
        }
        if (run.data.status === 'failed') {
            throw new ApiError(502, { message: run.data.summary ?? 'La réponse de l\'agent a échoué.' });
        }

        if (run.data.status !== 'completed') {
            continue;
        }

        const response = await domainApi.agentSessionMessages(agentUuid, sessionUuid);
        onMessages(response.data);

        return;
    }

    throw new ApiError(504, { message: 'Délai dépassé en attendant la réponse de l\'agent.' });
}
