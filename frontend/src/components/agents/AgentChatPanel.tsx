import {
    Bot,
    Check,
    CheckCircle2,
    Circle,
    GitBranch,
    Loader2,
    Send,
    Square,
    Wrench,
    X,
    XCircle,
} from 'lucide-preact';
import { useEffect, useRef } from 'preact/hooks';
import type { Agent, AgentChatAttachment, AgentChatMessage, AgentChatSession, AgentChatStep, AgentModelRouting } from '../../lib/domain-api';
import { isPendingToolApproval, parsePendingToolApproval } from '../../lib/agent-pending-approval';
import { isPendingPlan, parsePendingPlan } from '../../lib/agent-pending-plan';
import {
    sanitizeAssistantContent,
    stepsCompletion,
    toolDisplayLabel,
} from '../../lib/agent-chat-display';
import { AgentErrorAlert } from './AgentErrorAlert';
import { CaptureToolbar } from './CaptureToolbar';

function formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function renderContent(content: string) {
    return content
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br />');
}

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
    onResolveApproval?: (messageUuid: string, decision: 'approve' | 'deny') => void;
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
    /** Nombre de leafs async en cours (spawn + yield). */
    activeSubagentCount?: number;
    /** Progression live pendant l’envoi (SSE). */
    liveSteps?: AgentChatStep[];
    liveAssistantText?: string | null;
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
    activeSubagentCount = 0,
    liveSteps = [],
    liveAssistantText = null,
}: Props) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

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

            <AgentErrorAlert agent={agent} compact />

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
                    <div class="mx-auto flex w-full max-w-3xl flex-col gap-3 sm:gap-4">
                        {messages.map((message) => {
                            const pending = parsePendingToolApproval(message.metadata);
                            const needsApproval = isPendingToolApproval(message.metadata);
                            const pendingPlan = parsePendingPlan(message.metadata);
                            const needsPlanApproval = isPendingPlan(message.metadata);
                            const resolving = approvingMessageUuid === message.uuid;
                            const isUser = message.role === 'user';
                            const steps = parseMessageSteps(message.metadata);
                            const statusBadge = problemStatusBadge(message.metadata);
                            const displayContent = isUser
                                ? message.content
                                : sanitizeAssistantContent(message.content, steps);
                            const showApprovalChrome = needsApproval || needsPlanApproval;

                            return (
                                <article
                                    key={message.uuid}
                                    class={`flex gap-2 sm:gap-3 ${isUser ? 'flex-row-reverse' : ''}`}
                                >
                                    <div
                                        class={`mt-0.5 hidden size-7 shrink-0 place-items-center rounded-lg sm:grid ${
                                            isUser ? 'bg-primary/15 text-primary' : 'bg-base-300 text-base-content/70'
                                        }`}
                                        aria-hidden
                                    >
                                        {isUser
                                            ? <span class="text-[10px] font-bold">Vous</span>
                                            : <Bot class="size-3.5" />}
                                    </div>
                                    <div class={`min-w-0 max-w-[min(100%,28rem)] flex-1 sm:max-w-[90%] ${isUser ? 'ml-auto text-end' : ''}`}>
                                        {isUser ? (
                                            <div class="rounded-2xl bg-primary px-3 py-2 text-sm leading-relaxed text-primary-content sm:px-3.5 sm:py-2.5">
                                                <div
                                                    class="prose prose-sm max-w-none break-words text-start text-inherit [&_strong]:font-semibold"
                                                    dangerouslySetInnerHTML={{ __html: renderContent(displayContent) }}
                                                />
                                            </div>
                                        ) : (
                                            <div class="grid gap-2 text-start">
                                                {statusBadge && (
                                                    <span class={`w-fit rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusBadge.className}`}>
                                                        {statusBadge.label}
                                                    </span>
                                                )}
                                                {steps.length > 0 && (
                                                    <IdeActionsCard steps={steps} title="Actions" />
                                                )}
                                                {(displayContent !== '' || showApprovalChrome) && (
                                                    <div
                                                        class={`rounded-2xl px-3 py-2 text-sm leading-relaxed sm:px-3.5 sm:py-2.5 ${
                                                            showApprovalChrome
                                                                ? 'border border-warning/40 bg-warning/10 text-base-content'
                                                                : 'border border-base-300 bg-base-200/60 text-base-content'
                                                        }`}
                                                    >
                                                        {displayContent !== '' && (
                                                            <div
                                                                class="prose prose-sm max-w-none break-words text-start text-inherit [&_strong]:font-semibold"
                                                                dangerouslySetInnerHTML={{ __html: renderContent(displayContent) }}
                                                            />
                                                        )}
                                                        {pendingPlan && needsPlanApproval && onResolveApproval && (
                                                            <div class={`grid gap-2 text-start ${displayContent !== '' ? 'mt-3 border-t border-warning/25 pt-3' : ''}`}>
                                                                <p class="text-[11px] font-semibold text-base-content">
                                                                    Plan : {pendingPlan.title}
                                                                </p>
                                                                {pendingPlan.summary && (
                                                                    <p class="text-[11px] text-base-content/70">{pendingPlan.summary}</p>
                                                                )}
                                                                {pendingPlan.steps.length > 0 && (
                                                                    <ol class="list-decimal space-y-1 ps-4 text-[11px] text-base-content/75">
                                                                        {pendingPlan.steps.map((step, index) => (
                                                                            <li key={step.id ?? `${index}-${step.action}`}>
                                                                                {step.action}
                                                                                {step.tool ? (
                                                                                    <span class="text-base-content/45"> · {step.tool}</span>
                                                                                ) : null}
                                                                                {step.risk ? (
                                                                                    <span class="text-base-content/45"> · {step.risk}</span>
                                                                                ) : null}
                                                                            </li>
                                                                        ))}
                                                                    </ol>
                                                                )}
                                                                <div class="grid gap-2 sm:flex sm:flex-wrap sm:items-center">
                                                                    <button
                                                                        type="button"
                                                                        class="btn btn-success btn-sm w-full gap-1 sm:btn-xs sm:w-auto"
                                                                        disabled={sending || resolving}
                                                                        onClick={() => onResolveApproval(message.uuid, 'approve')}
                                                                    >
                                                                        {resolving
                                                                            ? <span class="loading loading-spinner loading-xs" aria-hidden />
                                                                            : <Check class="size-3.5" aria-hidden />}
                                                                        Approuver le plan
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        class="btn btn-ghost btn-sm w-full gap-1 border border-base-300 sm:btn-xs sm:w-auto"
                                                                        disabled={sending || resolving}
                                                                        onClick={() => onResolveApproval(message.uuid, 'deny')}
                                                                    >
                                                                        <X class="size-3.5" aria-hidden />
                                                                        Refuser
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        )}
                                                        {pending && needsApproval && onResolveApproval && (
                                                            <div class={`grid gap-2 text-start ${displayContent !== '' ? 'mt-3 border-t border-warning/25 pt-3' : ''}`}>
                                                                <p class="text-[11px] text-base-content/65">
                                                                    Outil <span class="font-semibold text-base-content">{pending.tool}</span>
                                                                    {pending.reason ? ` — ${pending.reason}` : ''}
                                                                </p>
                                                                {pending.diff_preview && (
                                                                    <div class="grid gap-1 rounded-lg border border-base-300 bg-base-100/80 p-2 text-start">
                                                                        <p class="text-[10px] font-medium text-base-content/70">
                                                                            {pending.diff_preview.path}
                                                                            {pending.diff_preview.is_new_file
                                                                                ? ' · nouveau fichier'
                                                                                : ` · +${pending.diff_preview.lines_added} / -${pending.diff_preview.lines_removed}`}
                                                                        </p>
                                                                        {pending.diff_preview.read_error && (
                                                                            <p class="text-[10px] text-warning">{pending.diff_preview.read_error}</p>
                                                                        )}
                                                                        <pre class="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-base-300/40 p-2 font-mono text-[10px] leading-relaxed text-base-content/85">{pending.diff_preview.diff}</pre>
                                                                    </div>
                                                                )}
                                                                <div class="grid gap-2 sm:flex sm:flex-wrap sm:items-center">
                                                                <button
                                                                    type="button"
                                                                    class="btn btn-success btn-sm w-full gap-1 sm:btn-xs sm:w-auto"
                                                                    disabled={sending || resolving}
                                                                    onClick={() => onResolveApproval(message.uuid, 'approve')}
                                                                >
                                                                    {resolving
                                                                        ? <span class="loading loading-spinner loading-xs" aria-hidden />
                                                                        : <Check class="size-3.5" aria-hidden />}
                                                                    Approuver
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    class="btn btn-ghost btn-sm w-full gap-1 border border-base-300 sm:btn-xs sm:w-auto"
                                                                    disabled={sending || resolving}
                                                                    onClick={() => onResolveApproval(message.uuid, 'deny')}
                                                                >
                                                                    <X class="size-3.5" aria-hidden />
                                                                    Refuser
                                                                </button>
                                                                </div>
                                                            </div>
                                                        )}
                                                        {pending?.resolved && (
                                                            <p class="mt-2 text-start text-[11px] text-base-content/50">
                                                                {pending.resolved === 'approved' ? 'Approuvé' : 'Refusé'}
                                                            </p>
                                                        )}
                                                        {pendingPlan?.resolved && (
                                                            <p class="mt-2 text-start text-[11px] text-base-content/50">
                                                                {pendingPlan.resolved === 'approved' ? 'Plan approuvé' : 'Plan refusé'}
                                                            </p>
                                                        )}
                                                    </div>
                                                )}
                                                {steps.length > 0 && displayContent === '' && !showApprovalChrome && (
                                                    <p class="px-1 text-[11px] text-base-content/45">
                                                        {stepsCompletion(steps).done === steps.length
                                                            ? 'Terminé.'
                                                            : 'Intervention enregistrée.'}
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                        <time class="mt-1 block text-[10px] text-base-content/40" datetime={message.created_at}>
                                            {formatTime(message.created_at)}
                                        </time>
                                    </div>
                                </article>
                            );
                        })}

                        {sending && (
                            <article class="flex gap-2 sm:gap-3">
                                <div class="mt-0.5 hidden size-7 shrink-0 place-items-center rounded-lg bg-base-300 text-base-content/70 sm:grid">
                                    <Bot class="size-3.5" aria-hidden />
                                </div>
                                <div class="min-w-0 max-w-[min(100%,28rem)] flex-1 space-y-2 sm:max-w-[90%]">
                                    <IdeActionsCard
                                        steps={liveSteps}
                                        running
                                        title={activeSubagentCount > 0 ? 'Équipe en cours' : 'Exécution'}
                                    />
                                    {liveAssistantText && (
                                        <div class="rounded-2xl border border-base-300 bg-base-200/60 px-3 py-2 text-sm leading-relaxed text-base-content/80 sm:px-3.5 sm:py-2.5">
                                            <div
                                                class="prose prose-sm max-w-none break-words text-start text-inherit [&_strong]:font-semibold"
                                                dangerouslySetInnerHTML={{ __html: renderContent(sanitizeAssistantContent(liveAssistantText, liveSteps)) }}
                                            />
                                            <span class="mt-1 inline-block animate-pulse text-[10px] text-base-content/40">en cours…</span>
                                        </div>
                                    )}
                                </div>
                            </article>
                        )}
                    </div>
                )}
            </div>

            {showSuggestions && (
                <div class="shrink-0 border-t border-base-300 px-3 py-2.5 sm:px-4 sm:py-3">
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

            <div class="shrink-0 border-t border-base-300 bg-base-100 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4">
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
                <div class="mx-auto flex max-w-3xl flex-col gap-2">
                    {onChatModeChange && (
                        <div class="flex flex-wrap gap-1 px-0.5" role="group" aria-label="Mode agent">
                            {([
                                ['plan', 'Planifier'],
                                ['build', 'Construire'],
                                ['debug', 'Déboguer'],
                            ] as const).map(([value, label]) => (
                                <button
                                    key={value}
                                    type="button"
                                    class={`btn btn-xs ${chatMode === value ? 'btn-primary' : 'btn-ghost'}`}
                                    disabled={sending}
                                    onClick={() => onChatModeChange(value)}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    )}
                    {onAttachmentsChange && (
                        <CaptureToolbar
                            attachments={attachments}
                            onChange={onAttachmentsChange}
                            disabled={sending || !agent.provider}
                        />
                    )}
                    <div class="flex items-end gap-2 rounded-2xl border border-base-300 bg-base-200/50 p-1.5 focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/15 sm:p-2">
                    <textarea
                        ref={textareaRef}
                        class="max-h-40 min-h-[2.75rem] flex-1 resize-none bg-transparent px-2.5 py-2 text-base outline-none placeholder:text-base-content/40 sm:min-h-[2.5rem] sm:text-sm"
                        placeholder={placeholder}
                        rows={1}
                        value={draft}
                        disabled={sending || !agent.provider}
                        onInput={(event) => onDraftChange((event.target as HTMLTextAreaElement).value)}
                        onKeyDown={handleKeyDown}
                    />
                    <button
                        type="button"
                        class={`btn btn-sm size-10 shrink-0 rounded-xl p-0 ${sending ? 'btn-error' : 'btn-primary'}`}
                        disabled={
                            stopping
                            || !agent.provider
                            || (!sending && draft.trim() === '' && attachments.length === 0)
                        }
                        aria-label={sending ? 'Arrêter' : 'Envoyer'}
                        title={sending ? 'Arrêter le run' : 'Envoyer'}
                        onClick={() => {
                            if (sending) {
                                onStop?.();
                                return;
                            }
                            onSend(draft);
                        }}
                    >
                        {stopping
                            ? <Loader2 class="size-4 animate-spin" aria-hidden />
                            : sending
                                ? <Square class="size-4" aria-hidden />
                                : <Send class="size-4" aria-hidden />}
                    </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export { waitForChatReply } from '../../lib/agent-chat-stream';
