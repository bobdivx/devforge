import type { ComponentChildren } from 'preact';
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
        return 'border-primary bg-primary text-primary-content shadow-sm';
    }

    return 'border-base-300/80 bg-base-200/70 text-base-content hover:bg-base-200';
}

function badgeClass(active: boolean): string {
    return active
        ? 'bg-primary-content/20 text-primary-content'
        : 'bg-base-300 text-base-content/70';
}

function formatCountLabel(label: string, count?: number): string {
    if (typeof count === 'number' && count > 0) {
        return `${label} (${count})`;
    }

    return label;
}

type TabButtonProps = {
    active: boolean;
    icon: ComponentChildren;
    label: string;
    subtitle: string;
    count?: number;
    showIndicator?: boolean;
    onClick: () => void;
};

function TabButton({ active, icon, label, subtitle, count, showIndicator = false, onClick }: TabButtonProps) {
    const ariaLabel = typeof count === 'number' && count > 0 ? `${label}, ${count}` : label;

    return (
        <button
            class={`grid w-full min-w-0 grid-cols-[1rem_minmax(0,1fr)_auto] grid-rows-[1.25rem_1.125rem] items-center gap-x-2 rounded-lg border px-3 py-2.5 transition-colors ${tabClass(active)}`}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={ariaLabel}
            onClick={onClick}
        >
            <span class="relative col-start-1 row-start-1 flex size-3.5 sm:size-4 items-center justify-center self-center">
                {icon}
                {showIndicator && (
                    <span class="absolute -end-0.5 -top-0.5 size-2 rounded-full bg-success ring-2 ring-base-100" />
                )}
            </span>
            <span class="col-start-2 row-start-1 truncate text-xs sm:text-sm font-semibold leading-tight">{label}</span>
            {typeof count === 'number' && count > 0 && (
                <span
                    aria-hidden="true"
                    class={`badge badge-xs col-start-3 row-start-1 shrink-0 justify-self-end border-0 ${badgeClass(active)}`}
                >
                    {count}
                </span>
            )}
            <span
                aria-hidden="true"
                class={`col-span-2 col-start-2 row-start-2 min-w-0 truncate text-[11px] leading-tight ${
                    active ? 'text-primary-content/75' : 'text-base-content/55'
                }`}
            >
                {subtitle}
            </span>
        </button>
    );
}

export function AgentViewSwitcher({ mode, onChange, runsActive = false, runsCount, sessionsCount }: Props) {
    const runsSubtitle = runsActive ? 'En cours · webhook, manuel…' : 'Webhook, manuel, planifié';

    return (
        <div class="shrink-0 border-b border-base-300 bg-base-200/95 px-3 py-2.5 sm:px-4 sm:py-3">
            <label class="form-control w-full sm:hidden">
                <span class="sr-only">Mode agent</span>
                <select
                    class="select select-bordered select-sm w-full"
                    value={mode}
                    aria-label="Choisir le mode de vue"
                    onChange={(event) => onChange(event.currentTarget.value as ViewMode)}
                >
                    <option value="chat">{formatCountLabel('Conversation', sessionsCount)}</option>
                    <option value="runs">
                        {formatCountLabel(`Exécutions${runsActive ? ' · en cours' : ''}`, runsCount)}
                    </option>
                </select>
            </label>

            <div
                class="hidden w-full grid-cols-2 gap-1.5 rounded-xl border border-base-300 bg-base-100 p-1 shadow-sm sm:grid"
                role="tablist"
                aria-label="Mode agent"
            >
                <TabButton
                    active={mode === 'chat'}
                    icon={<MessageSquare class="size-3.5 sm:size-4 opacity-90" aria-hidden />}
                    label="Conversation"
                    subtitle="Discuter avec l'agent"
                    count={sessionsCount}
                    onClick={() => onChange('chat')}
                />
                <TabButton
                    active={mode === 'runs'}
                    icon={<Zap class="size-3.5 sm:size-4 opacity-90" aria-hidden />}
                    label="Exécutions"
                    subtitle={runsSubtitle}
                    count={runsCount}
                    showIndicator={runsActive}
                    onClick={() => onChange('runs')}
                />
            </div>
        </div>
    );
}
