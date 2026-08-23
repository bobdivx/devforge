import {
    Bot,
    Check,
    CheckCircle2,
    Circle,
    GitBranch,
    Loader2,
    Mic,
    Plus,
    Send,
    Square,
    Wrench,
    X,
    XCircle,
} from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Agent, AgentChatAttachment, AgentChatMessage, AgentChatSession, AgentChatStep, AgentModelRouting } from '../../lib/domain-api';
import { isPendingToolApproval, parsePendingToolApproval } from '../../lib/agent-pending-approval';
import { isPendingPlan, parsePendingPlan } from '../../lib/agent-pending-plan';
import { parseChoiceCard } from '../../lib/agent-choice-card';
import { chatDayStamp, isNewChatDay, renderChatHtml } from '../../lib/agent-chat-richtext';
import { botMoodFromStatus } from '../../lib/bot-character';
import {
    sanitizeAssistantContent,
    stepsCompletion,
    toolDisplayLabel,
} from '../../lib/agent-chat-display';
import { AgentErrorAlert } from './AgentErrorAlert';
import { BotCharacter } from './BotCharacter';
import { CaptureToolbar } from './CaptureToolbar';
import { ChatChoiceCardView } from './ChatChoiceCard';
import { ChatPermissionCard } from './ChatPermissionCard';

function problemStatusBadge(metadata: AgentChatMessage['metadata']): { label: string; className: string } | null {
    if (!metadata || typeof metadata !== 'object') {
        return null;
    }

    const status = typeof metadata.problem_status === 'string' ? metadata.problem_status : null;
    if (!status) {
        return null;
    }

    switch (status) {
        case 'error':
            return { label: 'État : erreur', className: 'border-error/30 bg-error/10 text-error' };
        case 'resolved':
            return { label: 'État : résolu', className: 'border-success/30 bg-success/10 text-success' };
        case 'partial':
            return { label: 'État : partiel', className: 'border-warning/30 bg-warning/10 text-warning' };
        case 'awaiting_user':
            return { label: 'État : action requise', className: 'border-warning/30 bg-warning/10 text-warning' };
        case 'investigating':
            return { label: 'État : en cours', className: 'border-info/30 bg-info/10 text-info' };
        case 'unresolved':
            return { label: 'État : non résolu', className: 'border-error/30 bg-error/10 text-error' };
        default:
            return { label: `État : ${status}`, className: 'border-base-300 bg-base-200 text-base-content/70' };
    }
}

function parseMessageSteps(metadata: AgentChatMessage['metadata']): AgentChatStep[] {
    if (!metadata || !Array.isArray(metadata.steps)) {
        return [];
    }

    return metadata.steps.filter((step): step is AgentChatStep => (
        typeof step === 'object'
        && step !== null
        && typeof (step as AgentChatStep).name === 'string'
    ));
}

function StepStatusIcon({ status }: { status: AgentChatStep['status'] }) {
    if (status === 'running') {
        return <Loader2 class="size-3.5 shrink-0 animate-spin text-info" aria-hidden />;
    }
    if (status === 'error') {
        return <XCircle class="size-3.5 shrink-0 text-error" aria-hidden />;
    }
    if (status === 'awaiting_approval') {
        return <Circle class="size-3.5 shrink-0 text-warning" aria-hidden />;
    }
    if (status === 'skipped') {
        return <Circle class="size-3.5 shrink-0 text-base-content/30" aria-hidden />;
    }

    return <CheckCircle2 class="size-3.5 shrink-0 text-success" aria-hidden />;
}

/** Carte style IDE (Cursor Build) : liste d’actions avec compteur terminé. */
function IdeActionsCard({
    steps,
    running = false,
    title = 'Actions',
}: {
    steps: AgentChatStep[];
    running?: boolean;
    title?: string;
}) {
    const { done, total } = stepsCompletion(steps);
    const allDone = !running && total > 0 && done === total;

    return (
        <section
            class="overflow-hidden rounded-xl border border-base-300/80 bg-base-100 text-start shadow-sm"
            aria-label={title}
        >
            <header class="flex items-center gap-2 border-b border-base-300/70 bg-base-200/50 px-3 py-2">
                <span class="h-4 w-0.5 shrink-0 rounded-full bg-info" aria-hidden />
                <span class="text-[11px] font-semibold uppercase tracking-wide text-base-content/55">{title}</span>
                <GitBranch class="size-3 text-base-content/35" aria-hidden />
                <span class="ms-auto inline-flex items-center gap-1 text-[11px] font-medium text-base-content/60">
                    {running ? (
                        <>
                            <Loader2 class="size-3 animate-spin" aria-hidden />
                            En cours…
                        </>
                    ) : (
                        <>
                            {allDone ? <CheckCircle2 class="size-3 text-success" aria-hidden /> : <Wrench class="size-3" aria-hidden />}
                            {done} / {total}
                        </>
                    )}
                </span>
            </header>
            {total > 0 ? (
                <ul class="divide-y divide-base-300/50">
                    {steps.map((step, index) => (
                        <li key={`${step.name}-${index}`} class="flex min-w-0 items-start gap-2.5 px-3 py-2">
                            <StepStatusIcon status={step.status} />
                            <div class="min-w-0 flex-1">
                                <p class="truncate text-[12px] font-medium text-base-content">
                                    {toolDisplayLabel(step.name)}
                                    <span class="ms-1.5 font-mono text-[10px] font-normal text-base-content/40">{step.name}</span>
                                </p>
                                {step.args_summary && (
                                    <p class="mt-0.5 truncate text-[11px] text-base-content/50">{step.args_summary}</p>
                                )}
                                {step.result_summary && (
                                    <p class={`mt-0.5 text-[11px] ${step.status === 'error' ? 'text-error' : 'text-base-content/55'}`}>
                                        {step.result_summary}
                                    </p>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
            ) : (
                <div class="flex items-center gap-2 px-3 py-3 text-[12px] text-base-content/50">
                    <Loader2 class="size-3.5 animate-spin" aria-hidden />
                    Préparation des outils…
                </div>
            )}
        </section>
    );
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
    onStop?: () => void;
    stopping?: boolean;
    onResolveApproval?: (messageUuid: string, decision: 'approve' | 'deny', remember?: boolean) => void;
    approvingMessageUuid?: string | null;
    onRoutingChange?: (routing: AgentModelRouting | null) => void;
    chatMode?: 'plan' | 'build' | 'debug';
    onChatModeChange?: (mode: 'plan' | 'build' | 'debug') => void;
    attachments?: AgentChatAttachment[];
    onAttachmentsChange?: (next: AgentChatAttachment[]) => void;
    /** Si fourni et non vide, affiche des suggestions au démarrage. */
    suggestions?: string[];
    placeholder?: string;
    hideSessionHeader?: boolean;
    userName?: string;
    /** Nombre de leafs async en cours (spawn + yield). */
    activeSubagentCount?: number;
    /** Progression live pendant l’envoi (SSE). */
    liveSteps?: AgentChatStep[];
    liveAssistantText?: string | null;
    /** Provider actif actuel (pour filtrer les erreurs non pertinentes) */
    activeRoutingProvider?: string | null;
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
    onStop,
    stopping = false,
    onResolveApproval,
    approvingMessageUuid = null,
    chatMode = 'build',
    onChatModeChange,
    attachments = [],
    onAttachmentsChange,
    suggestions = [],
    placeholder = 'Écrire un message…',
    hideSessionHeader = false,
    userName,
    activeSubagentCount = 0,
    liveSteps = [],
    liveAssistantText = null,
    activeRoutingProvider = null,
}: Props) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [captureOpen, setCaptureOpen] = useState(false);
    const [listening, setListening] = useState(false);
    const [choiceState, setChoiceState] = useState<Record<string, { selected?: string; dismissed?: boolean }>>({});
    const composerPlaceholder = placeholder === 'Écrire un message…'
        ? `Envoyer un message à ${agent.name}`
        : placeholder;

    const startDictation = () => {
        const ctor = (window as unknown as { webkitSpeechRecognition?: new () => {
            lang: string;
            interimResults: boolean;
            onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
            onend: (() => void) | null;
            onerror: (() => void) | null;
            start: () => void;
        } }).webkitSpeechRecognition;

        if (!ctor) {
            return;
        }

        const recognition = new ctor();
        recognition.lang = 'fr-FR';
        recognition.interimResults = false;
        setListening(true);
        recognition.onresult = (event) => {
            const transcript = Array.from(event.results).map((result) => result[0]?.transcript ?? '').join(' ');
            if (transcript.trim() !== '') {
                onDraftChange(draft === '' ? transcript : `${draft} ${transcript}`);
            }
        };
        recognition.onend = () => setListening(false);
        recognition.onerror = () => setListening(false);
        recognition.start();
    };

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, [messages, sending, session?.uuid, liveAssistantText, liveSteps.length, activeSubagentCount]);

    useEffect(() => {
        const el = textareaRef.current;
        if (!el) {
            return;
        }

        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    }, [draft]);

    const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            onSend(draft);
        }
    };

    const showSuggestions = Boolean(
        session
        && suggestions.length > 0
        && messages.length <= 1
        && !sending
        && !loading,
    );

    if (!session) {
        return (
            <div class="flex h-full min-h-[12rem] flex-col items-center justify-center gap-3 px-4 py-10 text-center sm:min-h-[16rem] sm:px-6">
                <div class="grid size-12 place-items-center rounded-2xl border border-base-300 bg-base-200/60 text-base-content/40">
                    <Bot class="size-6" aria-hidden />
                </div>
                <div class="max-w-xs">
                    <p class="text-sm font-semibold text-base-content/85">Aucune conversation</p>
                    <p class="mt-1 text-xs leading-relaxed text-base-content/50">
                        Choisissez ou créez une session pour discuter avec l’agent.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div class="flex min-h-0 min-w-0 flex-1 flex-col">
            {!hideSessionHeader && (
                <div class="shrink-0 border-b border-base-300 bg-base-100 px-3 py-2.5 sm:px-4">
                    <p class="truncate text-sm font-semibold text-base-content">{session.title}</p>
                    <p class="mt-0.5 text-[11px] text-base-content/50">
                        {session.is_legacy ? 'Session partagée · ' : ''}
                        {messages.length} message{messages.length > 1 ? 's' : ''}
                    </p>
                </div>
            )}

            <AgentErrorAlert agent={agent} compact activeProvider={activeRoutingProvider} />

            {activeSubagentCount > 0 && (
                <div class="shrink-0 border-b border-info/30 bg-info/10 px-3 py-2 text-xs text-info sm:px-4">
                    {activeSubagentCount} sous-tâche{activeSubagentCount > 1 ? 's' : ''} en cours — reprise automatique après review.
                </div>
            )}

            <div ref={scrollRef} class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4 sm:py-4">
                {loading ? (
                    <div class="flex h-full items-center justify-center text-xs text-base-content/50">
                        <span class="loading loading-spinner loading-sm me-2" />
                        Chargement…
                    </div>
                ) : messages.length === 0 && !sending ? (
                    <div class="flex h-full min-h-[8rem] flex-col items-center justify-center gap-2 px-2 text-center">
                        <Bot class="size-8 text-base-content/25" aria-hidden />
                        <p class="text-sm text-base-content/55">Posez votre question ci-dessous</p>
                    </div>
                ) : (
                    <div class="mx-auto flex w-full max-w-2xl flex-col gap-3 sm:gap-5">
                        {messages.map((message, index) => {
                            const pending = parsePendingToolApproval(message.metadata);
                            const needsApproval = isPendingToolApproval(message.metadata);
                            const pendingPlan = parsePendingPlan(message.metadata);
                            const needsPlanApproval = isPendingPlan(message.metadata);
                            const choiceCard = parseChoiceCard(message.metadata);
                            const choiceLocal = choiceState[message.uuid] ?? {};
                            const mergedChoice = choiceCard
                                ? {
                                    ...choiceCard,
                                    selected_id: choiceLocal.selected ?? choiceCard.selected_id,
                                    dismissed: choiceLocal.dismissed ?? choiceCard.dismissed,
                                }
                                : null;
                            const showChoice = Boolean(mergedChoice && !mergedChoice.dismissed);
                            const resolving = approvingMessageUuid === message.uuid;
                            const isUser = message.role === 'user';
                            const steps = parseMessageSteps(message.metadata);
                            const statusBadge = problemStatusBadge(message.metadata);
                            const displayContent = isUser
                                ? message.content
                                : sanitizeAssistantContent(message.content, steps);
                            const showDayStamp = isNewChatDay(index === 0 ? null : messages[index - 1]?.created_at ?? null, message.created_at);
                            const userInitials = (userName ?? 'Vous').trim().slice(0, 1).toUpperCase() || 'V';

                            return (
                                <article key={message.uuid} class="grid gap-3">
                                    {showDayStamp && (
                                        <p class="text-center text-[11px] font-medium text-base-content/40">
                                            {chatDayStamp(message.created_at)}
                                        </p>
                                    )}
                                    {isUser ? (
                                        <div class="ms-auto grid w-full max-w-[min(calc(100%-1rem),28rem)] justify-items-end gap-2">
                                            <div class="rounded-2xl bg-base-300/80 px-3 sm:px-3.5 py-2 sm:py-2.5 text-sm leading-relaxed">
                                                <div
                                                    class="break-words text-start [&_strong]:font-semibold"
                                                    dangerouslySetInnerHTML={{ __html: renderChatHtml(displayContent) }}
                                                />
                                            </div>
                                            <span class="grid size-8 place-items-center rounded-full bg-teal-500 text-xs font-bold text-neutral">
                                                {userInitials}
                                            </span>
                                        </div>
                                    ) : (
                                        <div class="grid w-full max-w-[min(calc(100%-1rem),34rem)] justify-items-start gap-2">
                                            {statusBadge && (
                                                <span class={`w-fit rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusBadge.className}`}>
                                                    {statusBadge.label}
                                                </span>
                                            )}
                                            {steps.length > 0 && (
                                                <IdeActionsCard steps={steps} title="Actions" />
                                            )}
                                            {displayContent !== '' && (
                                                <div class="rounded-2xl bg-base-300/70 px-3 sm:px-3.5 py-2 sm:py-2.5 text-sm leading-relaxed">
                                                    <div
                                                        class="break-words text-start [&_strong]:font-semibold"
                                                        dangerouslySetInnerHTML={{ __html: renderChatHtml(displayContent) }}
                                                    />
                                                </div>
                                            )}
                                            {showChoice && mergedChoice && (
                                                <ChatChoiceCardView
                                                    card={mergedChoice}
                                                    disabled={sending}
                                                    onSelect={(optionId, prompt) => {
                                                        setChoiceState((current) => ({
                                                            ...current,
                                                            [message.uuid]: { selected: optionId },
                                                        }));
                                                        onSend(prompt);
                                                    }}
                                                    onDismiss={() => setChoiceState((current) => ({
                                                        ...current,
                                                        [message.uuid]: { ...current[message.uuid], dismissed: true },
                                                    }))}
                                                />
                                            )}
                                            {pendingPlan && needsPlanApproval && onResolveApproval && (
                                                <div class="grid w-full gap-2 rounded-2xl border border-warning/35 bg-warning/10 px-3.5 py-3">
                                                    <p class="text-sm font-semibold">Plan : {pendingPlan.title}</p>
                                                    {pendingPlan.summary && (
                                                        <p class="text-xs text-base-content/70">{pendingPlan.summary}</p>
                                                    )}
                                                    {pendingPlan.steps.length > 0 && (
                                                        <ol class="list-decimal space-y-1 ps-4 text-xs text-base-content/75">
                                                            {pendingPlan.steps.map((step, stepIndex) => (
                                                                <li key={step.id ?? `${stepIndex}-${step.action}`}>
                                                                    {step.action}
                                                                    {step.tool ? <span class="text-base-content/45"> · {step.tool}</span> : null}
                                                                </li>
                                                            ))}
                                                        </ol>
                                                    )}
                                                    <div class="flex flex-wrap gap-2">
                                                        <button type="button" class="btn btn-primary btn-sm rounded-full" disabled={sending || resolving} onClick={() => onResolveApproval(message.uuid, 'approve')}>
                                                            {resolving ? <span class="loading loading-spinner loading-xs" /> : <Check class="size-3.5" aria-hidden />}
                                                            Approuver le plan
                                                        </button>
                                                        <button type="button" class="btn btn-ghost btn-sm rounded-full" disabled={sending || resolving} onClick={() => onResolveApproval(message.uuid, 'deny')}>
                                                            <X class="size-3.5" aria-hidden />
                                                            Refuser
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                            {pending && needsApproval && onResolveApproval && (
                                                <ChatPermissionCard
                                                    agentName={agent.name}
                                                    pending={pending}
                                                    disabled={sending}
                                                    resolving={resolving}
                                                    onApprove={(remember) => onResolveApproval(message.uuid, 'approve', remember)}
                                                    onDeny={() => onResolveApproval(message.uuid, 'deny')}
                                                />
                                            )}
                                            {(pending?.resolved || pendingPlan?.resolved) && (
                                                <p class="px-1 text-[11px] text-base-content/45">
                                                    {(pending?.resolved ?? pendingPlan?.resolved) === 'approved' ? 'Approuvé' : 'Refusé'}
                                                </p>
                                            )}
                                            <BotCharacter
                                                name={agent.name}
                                                color={agent.avatar_color}
                                                shape={agent.avatar_shape}
                                                type={agent.type}
                                                size="sm"
                                                mood={botMoodFromStatus(agent.status)}
                                                decorative
                                            />
                                        </div>
                                    )}
                                </article>
                            );
                        })}

                        {sending && (
                            <article class="grid w-full max-w-[min(calc(100%-1rem),34rem)] justify-items-start gap-2">
                                <IdeActionsCard
                                    steps={liveSteps}
                                    running
                                    title={activeSubagentCount > 0 ? 'Équipe en cours' : 'Exécution'}
                                />
                                {liveAssistantText && (
                                    <div class="rounded-2xl bg-base-300/70 px-3 sm:px-3.5 py-2 sm:py-2.5 text-sm leading-relaxed">
                                        <div
                                            class="break-words text-start [&_strong]:font-semibold"
                                            dangerouslySetInnerHTML={{ __html: renderChatHtml(sanitizeAssistantContent(liveAssistantText, liveSteps)) }}
                                        />
                                        <span class="mt-1 inline-block animate-pulse text-[10px] text-base-content/40">en cours…</span>
                                    </div>
                                )}
                                <BotCharacter
                                    name={agent.name}
                                    color={agent.avatar_color}
                                    shape={agent.avatar_shape}
                                    type={agent.type}
                                    size="sm"
                                    mood="working"
                                    decorative
                                />
                            </article>
                        )}
                    </div>
                )}
            </div>

            {showSuggestions && (
                <div class="shrink-0 border-t border-base-300 px-3 py-2.5 pb-safe sm:px-4 sm:py-3">
                    <div class="flex gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        {suggestions.map((suggestion) => (
                            <button
                                key={suggestion}
                                class="btn btn-ghost btn-xs h-auto min-h-8 shrink-0 whitespace-nowrap rounded-full border border-base-300 px-3 py-1.5 text-[11px] font-normal"
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

            <div class="agent-chat-composer shrink-0 bg-base-100 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4">
                {error && (
                    <p class="mb-2 rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-xs text-error" role="alert">
                        {error}
                    </p>
                )}
                {!agent.provider && (
                    <p class="mb-2 text-xs text-warning">
                        Configurez un provider LLM dans les paramètres pour discuter.
                    </p>
                )}
                <div class="mx-auto flex max-w-2xl flex-col gap-2">
                    {onChatModeChange && (
                        <div class="flex flex-wrap gap-1 px-0.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Mode agent">
                            {([
                                ['plan', 'Planifier'],
                                ['build', 'Construire'],
                                ['debug', 'Déboguer'],
                            ] as const).map(([value, label]) => (
                                <button
                                    key={value}
                                    type="button"
                                    class={`btn btn-xs rounded-full shrink-0 ${chatMode === value ? 'btn-primary' : 'btn-ghost'}`}
                                    disabled={sending}
                                    onClick={() => onChatModeChange(value)}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    )}
                    {onAttachmentsChange && (captureOpen || attachments.length > 0) && (
                        <CaptureToolbar
                            attachments={attachments}
                            onChange={onAttachmentsChange}
                            disabled={sending || !agent.provider}
                        />
                    )}
                    <div class="flex items-end gap-1.5 sm:gap-2">
                        {onAttachmentsChange && (
                            <button
                                type="button"
                                class={`btn btn-ghost btn-sm size-9 sm:size-10 min-h-9 sm:min-h-10 shrink-0 rounded-full p-0 ${captureOpen ? 'bg-base-300' : ''}`}
                                aria-label="Joindre une capture"
                                disabled={sending || !agent.provider}
                                onClick={() => setCaptureOpen((open) => !open)}
                            >
                                <Plus class="size-4 sm:size-5" aria-hidden />
                            </button>
                        )}
                        <div class="flex min-w-0 flex-1 items-end gap-1.5 sm:gap-2 rounded-full border border-base-300 bg-base-200/70 px-1.5 sm:px-2 py-1.5">
                            <textarea
                                ref={textareaRef}
                                class="max-h-32 min-h-[2.25rem] flex-1 resize-none bg-transparent px-1.5 sm:px-2 py-1.5 text-sm outline-none placeholder:text-base-content/40 placeholder:text-[10px] xs:placeholder:text-xs sm:placeholder:text-sm"
                                placeholder={composerPlaceholder}
                                rows={1}
                                value={draft}
                                disabled={sending || !agent.provider}
                                onInput={(event) => onDraftChange((event.target as HTMLTextAreaElement).value)}
                                onKeyDown={handleKeyDown}
                            />
                            {sending ? (
                                <button
                                    type="button"
                                    class="btn btn-error btn-sm size-9 min-h-9 shrink-0 rounded-full p-0"
                                    disabled={stopping}
                                    aria-label="Arrêter"
                                    onClick={() => onStop?.()}
                                >
                                    {stopping ? <Loader2 class="size-4 animate-spin" /> : <Square class="size-4" />}
                                </button>
                            ) : draft.trim() !== '' || attachments.length > 0 ? (
                                <button
                                    type="button"
                                    class="btn btn-primary btn-sm size-9 min-h-9 shrink-0 rounded-full p-0"
                                    disabled={!agent.provider}
                                    aria-label="Envoyer"
                                    onClick={() => onSend(draft)}
                                >
                                    <Send class="size-4" />
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    class={`btn btn-ghost btn-sm size-9 min-h-9 shrink-0 rounded-full p-0 ${listening ? 'text-error' : ''}`}
                                    aria-label="Dicter"
                                    disabled={!agent.provider}
                                    onClick={startDictation}
                                >
                                    <Mic class="size-4" aria-hidden />
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export { waitForChatReply } from '../../lib/agent-chat-stream';
