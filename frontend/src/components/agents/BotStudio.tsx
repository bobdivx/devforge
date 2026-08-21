import { Search } from 'lucide-preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Agent, AgentInput, AgentType, AiProviderConfig } from '../../lib/domain-api';
import { domainApi } from '../../lib/domain-api';
import { ApiError } from '../../lib/api-client';
import { isEventOnlyAgentType } from '../../lib/agent-triggers';
import { applySchedulePreset } from '../../lib/agent-schedule-presets';
import { defaultScheduleForType, subAgentPresetsForParent } from '../../lib/agent-presets';
import {
    BOT_AVATAR_COLORS,
    BOT_SHAPES,
    type BotShape,
} from '../../lib/bot-character';
import {
    BOT_MISSIONS,
    BOT_SUGGESTIONS,
    BOT_TOOLS,
    filterBotTools,
    hasCompletedToolsOnboarding,
    loadSelectedTools,
    saveSelectedTools,
    scheduleForMission,
    type BotMission,
    type BotSuggestion,
} from '../../lib/bot-studio';
import { BotCharacter } from './BotCharacter';

type Step = 'missions' | 'tools' | 'character';

type Props = {
    open: boolean;
    onClose: () => void;
    onCreated: (agent?: Agent) => void;
    parentAgent?: Agent | null;
    variant?: 'overlay' | 'page';
    userName?: string;
};

function emptyForm(type: AgentType = 'deployment', parentId?: number | null): AgentInput {
    return {
        type,
        name: '',
        description: '',
        avatar_color: BOT_AVATAR_COLORS[6],
        avatar_shape: 'circle',
        schedule_minutes: defaultScheduleForType(type),
        provider_config_id: null,
        fallback_provider_config_id: null,
        preferred_model: null,
        parent_agent_id: parentId ?? null,
        is_active: true,
    };
}

function applySuggestion(form: AgentInput, suggestion: BotSuggestion, parentId?: number | null): AgentInput {
    const schedule = suggestion.schedulePreset
        ? applySchedulePreset(suggestion.schedulePreset)
        : isEventOnlyAgentType(suggestion.type)
            ? { schedule_minutes: 0, schedule_cron: null as string | null }
            : { schedule_minutes: defaultScheduleForType(suggestion.type), schedule_cron: null as string | null };

    return {
        ...form,
        type: suggestion.type,
        name: suggestion.name,
        description: suggestion.description,
        avatar_color: suggestion.color,
        avatar_shape: suggestion.shape,
        schedule_minutes: schedule.schedule_minutes,
        schedule_cron: schedule.schedule_cron,
        parent_agent_id: parentId ?? null,
    };
}

function applyMission(form: AgentInput, mission: BotMission, parentId?: number | null): AgentInput {
    const schedule = scheduleForMission(mission);

    return {
        ...form,
        type: mission.type,
        name: mission.name,
        description: mission.description,
        avatar_color: mission.color,
        avatar_shape: mission.shape,
        schedule_minutes: schedule.schedule_minutes,
        schedule_cron: schedule.schedule_cron,
        parent_agent_id: parentId ?? null,
    };
}

export function BotStudio({
    open,
    onClose,
    onCreated,
    parentAgent = null,
    variant = 'overlay',
    userName = 'Vous',
}: Props) {
    const isSubAgent = Boolean(parentAgent?.id);
    const [step, setStep] = useState<Step>('missions');
    const [form, setForm] = useState<AgentInput>(() => emptyForm('deployment', parentAgent?.id));
    const [tools, setTools] = useState<string[]>([]);
    const [toolQuery, setToolQuery] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [providers, setProviders] = useState<AiProviderConfig[]>([]);

    const visibleTools = useMemo(() => filterBotTools(BOT_TOOLS, toolQuery), [toolQuery]);
    const subPresets = useMemo(
        () => (parentAgent ? subAgentPresetsForParent(parentAgent.type) : []),
        [parentAgent],
    );

    useEffect(() => {
        if (!open) {
            return;
        }

        const selected = loadSelectedTools();
        setTools(selected);
        setToolQuery('');
        setError(null);
        setForm(emptyForm(isSubAgent ? (parentAgent?.type ?? 'debug') : 'deployment', parentAgent?.id ?? null));

        if (isSubAgent) {
            setStep('character');
        } else if (variant === 'page' || !hasCompletedToolsOnboarding()) {
            setStep('missions');
        } else {
            setStep('missions');
        }

        domainApi.aiProviders().then((response) => setProviders(response.data)).catch(() => {});
    }, [open, isSubAgent, parentAgent?.id, parentAgent?.type, variant]);

    useEffect(() => {
        if (!open || variant !== 'overlay') {
            return;
        }

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [open, variant, onClose]);

    if (!open) {
        return null;
    }

    const goFromMission = (mission: BotMission) => {
        setForm(applyMission(form, mission, parentAgent?.id));
        setStep(hasCompletedToolsOnboarding() ? 'character' : 'tools');
    };

    const goToCharacter = () => {
        saveSelectedTools(tools);
        setStep('character');
    };

    const handleSubmit = async (event?: Event) => {
        event?.preventDefault();
        if (!form.name.trim()) {
            return;
        }

        setSubmitting(true);
        setError(null);
        try {
            const payload: AgentInput = {
                ...form,
                name: form.name.trim(),
                avatar_shape: form.avatar_shape ?? 'circle',
                schedule_minutes: isSubAgent || isEventOnlyAgentType(form.type) ? 0 : form.schedule_minutes,
                schedule_cron: isSubAgent || isEventOnlyAgentType(form.type) ? null : (form.schedule_cron ?? null),
                parent_agent_id: parentAgent?.id ?? null,
            };
            const response = await domainApi.createAgent(payload);
            onCreated(response.data);
            if (variant === 'overlay') {
                onClose();
            }
        } catch (err: unknown) {
            const message = err instanceof ApiError || err instanceof Error ? err.message : 'Erreur lors de la création.';
            setError(message);
        } finally {
            setSubmitting(false);
        }
    };

    const titleId = 'bot-studio-title';
    const shellClass = variant === 'overlay'
        ? 'fixed inset-0 z-50 overflow-y-auto bg-base-200 text-base-content'
        : 'min-h-[calc(100vh-8rem)] rounded-2xl border border-base-300/60 bg-base-200 text-base-content';

    return (
        <div
            class={shellClass}
            role={variant === 'overlay' ? 'dialog' : undefined}
            aria-modal={variant === 'overlay' ? 'true' : undefined}
            aria-labelledby={titleId}
        >
            {step === 'missions' && (
                <section class="mx-auto grid min-h-full max-w-3xl place-items-center gap-10 px-4 py-12">
                    <div class="relative h-72 w-72 sm:h-80 sm:w-80">
                        {BOT_MISSIONS.map((mission, index) => {
                            const position = index === 0
                                ? 'left-1/2 top-0 -translate-x-1/2'
                                : index === 1
                                    ? 'bottom-2 left-0'
                                    : 'bottom-2 right-0';

                            return (
                                <button
                                    key={mission.id}
                                    type="button"
                                    class={`absolute flex flex-col items-center gap-3 ${position}`}
                                    aria-label={mission.label}
                                    onClick={() => goFromMission(mission)}
                                >
                                    <BotCharacter
                                        name={mission.name}
                                        color={mission.color}
                                        shape={mission.shape}
                                        type={mission.type}
                                        size="xl"
                                        delay={mission.delay}
                                        tuft={index === 0}
                                        decorative
                                    />
                                    <span class="rounded-full bg-base-300/90 px-3 py-1.5 text-xs font-medium text-base-content shadow-sm">
                                        {mission.label}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                    <div class="grid gap-3 text-center">
                        <h1 id={titleId} class="text-2xl font-semibold tracking-tight sm:text-3xl">
                            Donnez une mission à chaque Bot
                        </h1>
                        <p class="mx-auto max-w-md text-sm text-base-content/60">
                            Choisissez un collègue. Il travaille sur vos serveurs, 24/7, et ne vous interrompt que pour une décision.
                        </p>
                    </div>
                    {variant === 'overlay' && (
                        <button class="btn btn-ghost btn-sm rounded-full" type="button" onClick={onClose}>
                            Annuler
                        </button>
                    )}
                </section>
            )}

            {step === 'tools' && (
                <section class="mx-auto grid min-h-full max-w-2xl content-center gap-8 px-4 py-10">
                    <div class="flex justify-center gap-6">
                        {BOT_MISSIONS.map((mission) => (
                            <BotCharacter
                                key={mission.id}
                                name={mission.name}
                                color={mission.color}
                                shape={mission.shape}
                                type={mission.type}
                                size="md"
                                delay={mission.delay}
                                decorative
                            />
                        ))}
                    </div>
                    <div class="grid gap-2 text-center">
                        <h1 id={titleId} class="text-2xl font-semibold tracking-tight sm:text-3xl">
                            Qu&apos;utilisez-vous au quotidien&nbsp;?
                        </h1>
                        <p class="text-sm text-base-content/55">Les Bots s&apos;appuient sur ces outils pour finir le travail.</p>
                    </div>
                    <label class="input input-bordered mx-auto flex h-12 w-full max-w-md items-center gap-2 rounded-full bg-base-300/70">
                        <Search class="size-4 opacity-50" aria-hidden />
                        <input
                            class="grow bg-transparent"
                            type="search"
                            placeholder="Rechercher"
                            value={toolQuery}
                            onInput={(event) => setToolQuery((event.target as HTMLInputElement).value)}
                        />
                    </label>
                    <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        {visibleTools.map((tool) => {
                            const selected = tools.includes(tool.id);
                            return (
                                <button
                                    key={tool.id}
                                    type="button"
                                    disabled={tool.comingSoon}
                                    aria-pressed={selected}
                                    class={`flex h-12 items-center justify-start gap-2 rounded-2xl border px-3 text-left text-sm transition ${
                                        tool.comingSoon
                                            ? 'cursor-not-allowed border-base-300/50 bg-base-300/20 text-base-content/35'
                                            : selected
                                                ? 'border-primary bg-primary/15 text-base-content'
                                                : 'border-base-300 bg-base-300/40 text-base-content hover:border-primary/40'
                                    }`}
                                    onClick={() => {
                                        if (tool.comingSoon) {
                                            return;
                                        }
                                        setTools((current) => (
                                            current.includes(tool.id)
                                                ? current.filter((id) => id !== tool.id)
                                                : [...current, tool.id]
                                        ));
                                    }}
                                >
                                    <span class="grid size-7 place-items-center rounded-lg bg-base-100/70 text-[11px] font-semibold">
                                        {tool.label.slice(0, 2)}
                                    </span>
                                    <span class="min-w-0">
                                        <span class="block truncate font-medium">{tool.label}</span>
                                        <span class="block truncate text-[10px] text-base-content/50">{tool.comingSoon ? 'Bientôt' : tool.hint}</span>
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                    <div class="mx-auto grid w-full max-w-sm gap-2">
                        <button class="btn btn-primary h-12 min-h-12 rounded-full" type="button" onClick={goToCharacter}>
                            Suivant
                        </button>
                        <button class="btn btn-ghost h-12 min-h-12 rounded-full bg-base-300/70" type="button" onClick={() => setStep('missions')}>
                            Retour
                        </button>
                    </div>
                </section>
            )}

            {step === 'character' && (
                <div class="grid min-h-full lg:grid-cols-[16rem_minmax(0,1fr)]">
                    <aside class="hidden flex-col gap-6 border-r border-base-300/70 p-5 lg:flex">
                        <button
                            class="flex items-center gap-3 rounded-2xl bg-base-300/60 px-3 py-2.5 text-left"
                            type="button"
                            onClick={() => {
                                if (!isSubAgent) {
                                    setStep('missions');
                                }
                            }}
                        >
                            <BotCharacter
                                name={form.name || 'Nouveau Bot'}
                                color={form.avatar_color}
                                shape={form.avatar_shape}
                                type={form.type}
                                size="sm"
                                animate={false}
                                decorative
                            />
                            <span class="text-sm font-medium">
                                {isSubAgent ? 'Nouveau sous-agent' : 'Créer votre premier Bot'}
                            </span>
                        </button>
                        <p class="px-1 text-xs text-base-content/45">Aucune conversation pour l&apos;instant</p>
                        <div class="mt-auto flex items-center gap-3 px-1">
                            <span class="grid size-8 place-items-center rounded-full bg-amber-400 text-xs font-bold text-neutral">
                                {userName.slice(0, 1).toUpperCase()}
                            </span>
                            <span class="truncate text-sm font-medium">{userName}</span>
                        </div>
                    </aside>

                    <section class="grid content-start gap-8 px-4 py-10 sm:px-8">
                        <div class="grid justify-items-center gap-5">
                            <BotCharacter
                                name={form.name || 'Nouveau Bot'}
                                color={form.avatar_color}
                                shape={form.avatar_shape}
                                type={form.type}
                                size="hero"
                                tuft
                            />
                            <div class="flex flex-wrap justify-center gap-2">
                                {BOT_AVATAR_COLORS.map((color) => (
                                    <button
                                        key={color}
                                        type="button"
                                        class={`size-7 rounded-full transition ${form.avatar_color === color ? 'ring-2 ring-base-content ring-offset-2 ring-offset-base-200 scale-110' : 'hover:scale-110'}`}
                                        style={{ backgroundColor: color }}
                                        aria-label={`Couleur ${color}`}
                                        aria-pressed={form.avatar_color === color}
                                        onClick={() => setForm({ ...form, avatar_color: color })}
                                    />
                                ))}
                            </div>
                            <div class="flex flex-wrap justify-center gap-2">
                                {BOT_SHAPES.map((shape) => (
                                    <button
                                        key={shape}
                                        type="button"
                                        class={`grid size-11 place-items-center rounded-xl border transition ${
                                            form.avatar_shape === shape
                                                ? 'border-base-content/40 bg-base-300'
                                                : 'border-transparent hover:bg-base-300/60'
                                        }`}
                                        aria-label={`Forme ${shape}`}
                                        aria-pressed={form.avatar_shape === shape}
                                        onClick={() => setForm({ ...form, avatar_shape: shape as BotShape })}
                                    >
                                        <BotCharacter
                                            name={form.name || 'Bot'}
                                            color={form.avatar_color}
                                            shape={shape}
                                            type={form.type}
                                            size="sm"
                                            animate={false}
                                            tuft={false}
                                            decorative
                                        />
                                    </button>
                                ))}
                            </div>
                            <label class="grid w-full max-w-sm gap-1.5 text-center">
                                <span class="text-xs font-medium text-base-content/55">Nom</span>
                                <input
                                    class="input input-bordered h-12 rounded-2xl bg-base-300/50 text-center text-sm"
                                    type="text"
                                    value={form.name}
                                    placeholder="Nouveau Bot"
                                    onInput={(event) => setForm({ ...form, name: (event.target as HTMLInputElement).value })}
                                />
                            </label>
                            {error && (
                                <p class="w-full max-w-sm rounded-xl border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">{error}</p>
                            )}
                            <button
                                class="btn btn-primary h-12 min-h-12 w-full max-w-sm rounded-full disabled:opacity-40"
                                type="button"
                                disabled={submitting || !form.name.trim()}
                                onClick={() => void handleSubmit()}
                            >
                                {submitting ? 'Création…' : 'Commencer'}
                            </button>
                            {!isSubAgent && (
                                <button class="btn btn-ghost btn-sm rounded-full" type="button" onClick={() => setStep(hasCompletedToolsOnboarding() ? 'missions' : 'tools')}>
                                    Retour
                                </button>
                            )}
                            {isSubAgent && variant === 'overlay' && (
                                <button class="btn btn-ghost btn-sm rounded-full" type="button" onClick={onClose}>
                                    Annuler
                                </button>
                            )}
                            {providers.length === 0 && (
                                <p class="max-w-sm text-center text-[11px] text-warning">
                                    Aucun provider LLM configuré. Ajoutez-en un dans Paramètres → Intelligence Artificielle.
                                </p>
                            )}
                        </div>

                        {isSubAgent ? (
                            <div class="mx-auto grid w-full max-w-3xl gap-3">
                                <h2 class="text-sm font-medium text-base-content/60">Spécialistes</h2>
                                <div class="grid gap-2 sm:grid-cols-3">
                                    {subPresets.map((preset) => (
                                        <button
                                            key={preset.id}
                                            type="button"
                                            class="flex items-center gap-3 rounded-2xl border border-base-300 bg-base-100/40 px-3 py-3 text-left hover:border-primary/40"
                                            onClick={() => setForm({
                                                ...form,
                                                type: preset.type,
                                                name: preset.suggestedName,
                                                description: preset.description,
                                            })}
                                        >
                                            <BotCharacter name={preset.suggestedName} color={form.avatar_color} type={preset.type} size="sm" animate={false} decorative />
                                            <span class="min-w-0">
                                                <span class="block truncate text-sm font-medium">{preset.label}</span>
                                                <span class="block truncate text-[11px] text-base-content/55">{preset.description}</span>
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div class="mx-auto grid w-full max-w-3xl gap-3">
                                <h2 class="text-sm font-medium text-base-content/60">Suggestions</h2>
                                <div class="grid gap-2 sm:grid-cols-3">
                                    {BOT_SUGGESTIONS.map((suggestion) => (
                                        <button
                                            key={suggestion.id}
                                            type="button"
                                            class="flex items-start gap-3 rounded-2xl border border-base-300 bg-base-100/40 px-3 py-3 text-left hover:border-primary/40"
                                            onClick={() => setForm(applySuggestion(form, suggestion, parentAgent?.id))}
                                        >
                                            <BotCharacter
                                                name={suggestion.name}
                                                color={suggestion.color}
                                                shape={suggestion.shape}
                                                type={suggestion.type}
                                                size="md"
                                                tuft
                                                decorative
                                            />
                                            <span class="min-w-0">
                                                <span class="block truncate text-sm font-medium">{suggestion.name}</span>
                                                <span class="mt-0.5 block text-[11px] leading-snug text-base-content/55">{suggestion.description}</span>
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </section>
                </div>
            )}
        </div>
    );
}
