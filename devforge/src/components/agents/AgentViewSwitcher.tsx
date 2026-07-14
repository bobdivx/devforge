import { MessageSquare, Zap } from 'lucide-preact';

type ViewMode = 'chat' | 'runs';

type Props = {
    mode: ViewMode;
    onChange: (mode: ViewMode) => void;
    runsActive?: boolean;
    runsCount?: number;
    sessionsCount?: number;
};

function tabClass(active: boolean): string {
    if (active) {
        return 'bg-primary text-primary-content shadow-sm ring-1 ring-primary/30';
    }

    return 'border border-base-300/80 bg-base-200/70 text-base-content hover:bg-base-200';
}

export function AgentViewSwitcher({ mode, onChange, runsActive = false, runsCount, sessionsCount }: Props) {
    return (
        <div
            class="sticky top-0 z-20 shrink-0 border-b border-base-300 bg-base-200/95 px-3 py-3 backdrop-blur-sm sm:px-4"
            role="tablist"
            aria-label="Mode agent"
        >
            <div class="mx-auto flex w-full max-w-3xl gap-1.5 rounded-xl border border-base-300 bg-base-100 p-1 shadow-sm">
                <button
                    class={`flex min-w-0 flex-1 flex-col items-stretch justify-center rounded-lg px-2.5 py-2 text-start transition-all sm:px-3 ${tabClass(mode === 'chat')}`}
                    type="button"
                    role="tab"
                    aria-selected={mode === 'chat'}
                    onClick={() => onChange('chat')}
                >
                    <span class="flex min-w-0 items-center gap-2">
                        <MessageSquare class="size-4 shrink-0 opacity-90" aria-hidden />
                        <span class="truncate text-sm font-semibold">Conversation</span>
                        {typeof sessionsCount === 'number' && sessionsCount > 0 && (
                            <span class={`badge badge-xs shrink-0 border-0 ${mode === 'chat' ? 'bg-primary-content/20 text-primary-content' : 'bg-base-300 text-base-content/70'}`}>
                                {sessionsCount}
                            </span>
                        )}
                    </span>
                    <span class={`mt-0.5 hidden truncate text-[11px] sm:block ${mode === 'chat' ? 'text-primary-content/75' : 'text-base-content/55'}`}>
                        Discuter avec l&apos;agent
                    </span>
                </button>

                <button
                    class={`flex min-w-0 flex-1 flex-col items-stretch justify-center rounded-lg px-2.5 py-2 text-start transition-all sm:px-3 ${tabClass(mode === 'runs')}`}
                    type="button"
                    role="tab"
                    aria-selected={mode === 'runs'}
                    onClick={() => onChange('runs')}
                >
                    <span class="flex min-w-0 items-center gap-2">
                        <span class="relative flex shrink-0 items-center">
                            <Zap class="size-4 opacity-90" aria-hidden />
                            {runsActive && (
                                <span class="absolute -end-0.5 -top-0.5 size-2 rounded-full bg-success ring-2 ring-base-100" />
                            )}
                        </span>
                        <span class="min-w-0 flex-1 truncate text-sm font-semibold">Exécutions</span>
                        {typeof runsCount === 'number' && runsCount > 0 && (
                            <span class={`badge badge-xs shrink-0 border-0 ${mode === 'runs' ? 'bg-primary-content/20 text-primary-content' : 'bg-base-300 text-base-content/70'}`}>
                                {runsCount}
                            </span>
                        )}
                    </span>
                    <span class={`mt-0.5 hidden truncate text-[11px] sm:block ${mode === 'runs' ? 'text-primary-content/75' : 'text-base-content/55'}`}>
                        {runsActive ? 'En cours · webhook, manuel…' : 'Webhook, manuel, planifié'}
                    </span>
                </button>
            </div>
        </div>
    );
}
