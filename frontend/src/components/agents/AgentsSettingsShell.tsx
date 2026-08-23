import { Brain, KeyRound, Layers3, Puzzle, ServerCog, Sparkles } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import {
    AGENTS_SETTINGS_SECTIONS,
    type AgentsSettingsSectionId,
} from '../../lib/agents-settings-sections';

const ICONS: Record<AgentsSettingsSectionId, typeof KeyRound> = {
    providers: KeyRound,
    models: Sparkles,
    instructions: Layers3,
    memory: Brain,
    mcp: Puzzle,
    advanced: ServerCog,
};

type Props = {
    active: AgentsSettingsSectionId;
    onChange: (id: AgentsSettingsSectionId) => void;
    children: ComponentChildren;
};

export function AgentsSettingsShell({ active, onChange, children }: Props) {
    const groups: Array<'core' | 'data' | 'system'> = ['core', 'data', 'system'];
    const groupLabels = {
        core: 'Modèles',
        data: 'Contexte',
        system: 'Système',
    } as const;

    return (
        <div class="grid min-h-[28rem] gap-2.5 sm:gap-3 md:gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
            <aside class="rounded-2xl border border-base-300/80 bg-base-100 p-2 lg:sticky lg:top-4 lg:self-start">
                <nav class="grid gap-3" aria-label="Sections paramètres AI">
                    {groups.map((group) => {
                        const items = AGENTS_SETTINGS_SECTIONS.filter((section) => section.group === group);
                        return (
                            <div key={group} class="grid gap-1">
                                <p class="px-2.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-base-content/40">
                                    {groupLabels[group]}
                                </p>
                                {items.map((section) => {
                                    const Icon = ICONS[section.id];
                                    const isActive = active === section.id;
                                    return (
                                        <button
                                            key={section.id}
                                            type="button"
                                            class={`flex items-start gap-2.5 rounded-xl px-2.5 py-2 text-start transition ${
                                                isActive
                                                    ? 'bg-info/15 text-info'
                                                    : 'text-base-content/75 hover:bg-base-200/80'
                                            }`}
                                            aria-current={isActive ? 'page' : undefined}
                                            onClick={() => onChange(section.id)}
                                        >
                                            <Icon class="mt-0.5 size-3.5 sm:size-4 shrink-0 opacity-80" aria-hidden />
                                            <span class="min-w-0">
                                                <span class="block text-xs sm:text-sm font-medium leading-tight">{section.label}</span>
                                                <span class="mt-0.5 block text-[11px] leading-snug text-base-content/50">
                                                    {section.description}
                                                </span>
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        );
                    })}
                </nav>
            </aside>
            <div class="min-w-0">{children}</div>
        </div>
    );
}
