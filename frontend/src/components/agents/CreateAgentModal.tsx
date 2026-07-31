import { ChevronLeft, Sparkles } from 'lucide-preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Agent, AgentInput, AgentType, AiProviderConfig } from '../../lib/domain-api';
import { domainApi } from '../../lib/domain-api';
import { isEventOnlyAgentType, eventTriggerLabel } from '../../lib/agent-triggers';
import {
    agentPresets,
    categoryLabels,
    defaultScheduleForType,
    presetForType,
    subAgentPresetsForParent,
    type AgentPreset,
    type AgentPresetCategory,
    type SubAgentPreset,
} from '../../lib/agent-presets';
import { AgentAvatar } from './AgentAvatar';
import { AgentProviderModelFields } from './AgentProviderModelFields';
import { Modal } from '../ui/Modal';

const avatarColors = [
    '#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444',
    '#8b5cf6', '#06b6d4', '#84cc16', '#f97316',
];

type Step = 'pick' | 'details';

type Props = {
    open: boolean;
    onClose: () => void;
    onCreated: (agent?: Agent) => void;
    /** Si fourni, crée un sous-agent permanent lié à ce parent. */
    parentAgent?: Agent | null;
};

function emptyForm(type: AgentType = 'deployment', parentId?: number | null): AgentInput {
    return {
        type,
        name: '',
        description: '',
        avatar_color: avatarColors[0],
        schedule_minutes: defaultScheduleForType(type),
        provider_config_id: null,
        fallback_provider_config_id: null,
        preferred_model: null,
        parent_agent_id: parentId ?? null,
        is_active: true,
    };
}

export function CreateAgentModal({ open, onClose, onCreated, parentAgent = null }: Props) {
    const isSubAgent = Boolean(parentAgent?.id);
    const [step, setStep] = useState<Step>('pick');
    const [providers, setProviders] = useState<AiProviderConfig[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [selectedSubPresetId, setSelectedSubPresetId] = useState<string | null>(null);
    const [form, setForm] = useState<AgentInput>(() => emptyForm('deployment', parentAgent?.id));

    const subPresets = useMemo(
        () => (parentAgent ? subAgentPresetsForParent(parentAgent.type) : []),
        [parentAgent],
    );

    const presetsByCategory = useMemo(() => {
        const groups: Record<AgentPresetCategory, AgentPreset[]> = {
            reactive: [],
            watch: [],
            manual: [],
        };
        for (const preset of agentPresets) {
            groups[preset.category].push(preset);
        }

        return groups;
    }, []);

    useEffect(() => {
        if (!open) {
            return;
        }

        setStep('pick');
        setError(null);
        setShowAdvanced(false);
        setSelectedSubPresetId(null);
        setForm(emptyForm(isSubAgent ? (parentAgent?.type ?? 'debug') : 'deployment', parentAgent?.id ?? null));
        domainApi.aiProviders().then((r) => setProviders(r.data)).catch(() => {});
    }, [open, isSubAgent, parentAgent?.id, parentAgent?.type]);

    const applyPreset = (preset: AgentPreset) => {
        setForm({
            ...form,
            type: preset.type,
            name: form.name.trim() ? form.name : preset.suggestedName,
            description: form.description?.trim() ? form.description : preset.description,
            schedule_minutes: isEventOnlyAgentType(preset.type) ? 0 : preset.defaultScheduleMinutes,
            parent_agent_id: parentAgent?.id ?? null,
            avatar_color: form.avatar_color || avatarColors[0],
        });
        setStep('details');
    };

    const applySubPreset = (preset: SubAgentPreset) => {
        setSelectedSubPresetId(preset.id);
        setForm({
            ...form,
            type: preset.type,
            name: preset.suggestedName,
            description: preset.description,
            schedule_minutes: 0,
            parent_agent_id: parentAgent?.id ?? null,
        });
        setStep('details');
    };

    const handleSubmit = async (e: Event) => {
        e.preventDefault();
        if (!form.name.trim()) {
            return;
        }

        setSubmitting(true);
        setError(null);
        try {
            const payload: AgentInput = {
                ...form,
                name: form.name.trim(),
                schedule_minutes: isSubAgent || isEventOnlyAgentType(form.type) ? 0 : form.schedule_minutes,
                parent_agent_id: parentAgent?.id ?? null,
            };
            const response = await domainApi.createAgent(payload);
            onCreated(response.data);
            onClose();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Erreur lors de la création.');
        } finally {
            setSubmitting(false);
        }
    };

    const title = isSubAgent
        ? `Sous-agent pour ${parentAgent?.name ?? 'parent'}`
        : step === 'pick'
            ? 'Nouvel agent'
            : 'Personnaliser l’agent';

    return (
        <Modal
            open={open}
            title={title}
            onClose={onClose}
            size={step === 'pick' ? 'xl' : 'lg'}
            footer={(
                <>
                    {step === 'details' ? (
                        <button class="btn btn-ghost btn-sm" type="button" onClick={() => setStep('pick')}>
                            <ChevronLeft class="size-3.5" aria-hidden />
                            Retour
                        </button>
                    ) : (
                        <button class="btn btn-ghost btn-sm" type="button" onClick={onClose}>Annuler</button>
                    )}
                    {step === 'details' && (
                        <button
                            class="btn btn-primary btn-sm"
                            type="submit"
                            form="create-agent-form"
                            disabled={submitting || !form.name.trim()}
                        >
                            {submitting && <span class="loading loading-spinner loading-xs" />}
                            {isSubAgent ? 'Créer le sous-agent' : 'Créer l’agent'}
                        </button>
                    )}
                </>
            )}
        >
            {step === 'pick' && !isSubAgent && (
                <div class="grid max-h-[min(70vh,36rem)] gap-4 overflow-y-auto pr-1">
                    <p class="text-xs text-base-content/60">
                        Choisissez un rôle. Les agents réactifs démarrent sur événement ; les autres peuvent être planifiés.
                    </p>
                    {(Object.keys(presetsByCategory) as AgentPresetCategory[]).map((category) => {
                        const items = presetsByCategory[category];
                        if (items.length === 0) {
                            return null;
                        }

                        return (
                            <section key={category} class="grid gap-2">
                                <h3 class="text-[11px] font-semibold uppercase tracking-wide text-base-content/45">
                                    {categoryLabels[category]}
                                </h3>
                                <div class="grid gap-2 sm:grid-cols-2">
                                    {items.map((preset) => (
                                        <button
                                            key={preset.type}
                                            type="button"
                                            class="flex items-start gap-3 rounded-xl border border-base-300 bg-base-100 p-3 text-left transition hover:border-primary/40 hover:bg-primary/5"
                                            onClick={() => applyPreset(preset)}
                                        >
                                            <AgentAvatar type={preset.type} color={avatarColors[0]} name={preset.label} size="sm" />
                                            <span class="min-w-0 flex-1">
                                                <span class="flex items-center gap-1.5 text-xs font-semibold">
                                                    {preset.label}
                                                    {preset.recommended && (
                                                        <span class="badge badge-primary badge-xs gap-0.5">
                                                            <Sparkles class="size-2.5" aria-hidden />
                                                            reco
                                                        </span>
                                                    )}
                                                </span>
                                                <span class="mt-0.5 block text-[11px] text-base-content/60">{preset.description}</span>
                                                <span class="mt-1 block text-[10px] text-primary/80">{preset.triggerHint}</span>
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </section>
                        );
                    })}
                </div>
            )}

            {step === 'pick' && isSubAgent && (
                <div class="grid gap-3">
                    <p class="rounded-md border border-base-300 bg-base-200/40 px-3 py-2 text-[11px] text-base-content/65">
                        Les missions créent aussi des sous-tâches éphémères automatiquement.
                        Ici vous ajoutez un spécialiste <strong>permanent</strong> que le parent peut appeler via délégation.
                    </p>
                    <div class="grid gap-2 sm:grid-cols-2">
                        {subPresets.map((preset) => (
                            <button
                                key={preset.id}
                                type="button"
                                class={`flex items-start gap-3 rounded-xl border p-3 text-left transition hover:border-primary/40 hover:bg-primary/5 ${
                                    selectedSubPresetId === preset.id ? 'border-primary bg-primary/5' : 'border-base-300'
                                }`}
                                onClick={() => applySubPreset(preset)}
                            >
                                <AgentAvatar type={preset.type} color={parentAgent?.avatar_color ?? avatarColors[0]} name={preset.label} size="sm" />
                                <span class="min-w-0">
                                    <span class="block text-xs font-semibold">{preset.label}</span>
                                    <span class="mt-0.5 block text-[11px] text-base-content/60">{preset.description}</span>
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {step === 'details' && (
                <form id="create-agent-form" class="grid gap-4" onSubmit={handleSubmit}>
                    <div class="flex items-center gap-3 rounded-xl border border-base-300 bg-base-200/30 px-3 py-2">
                        <AgentAvatar type={form.type} color={form.avatar_color ?? avatarColors[0]} name={form.name || 'Agent'} size="sm" />
                        <div class="min-w-0">
                            <p class="text-xs font-semibold">{presetForType(form.type)?.label ?? form.type}</p>
                            <p class="text-[11px] text-base-content/60">
                                {isSubAgent
                                    ? 'Déclenché uniquement par délégation du parent'
                                    : (eventTriggerLabel(form.type) ?? presetForType(form.type)?.triggerHint)}
                            </p>
                        </div>
                    </div>

                    <div class="grid gap-1.5">
                        <label class="text-xs font-medium" for="agent-name">Nom *</label>
                        <input
                            id="agent-name"
                            class="input input-bordered input-sm w-full"
                            type="text"
                            required
                            value={form.name}
                            onInput={(e) => setForm({ ...form, name: (e.target as HTMLInputElement).value })}
                        />
                    </div>

                    <div class="grid gap-1.5">
                        <label class="text-xs font-medium" for="agent-desc">Description</label>
                        <textarea
                            id="agent-desc"
                            class="textarea textarea-bordered textarea-sm w-full resize-none"
                            rows={2}
                            value={form.description ?? ''}
                            onInput={(e) => setForm({ ...form, description: (e.target as HTMLTextAreaElement).value })}
                        />
                    </div>

                    <div class="grid gap-1.5">
                        <span class="text-xs font-medium">Couleur</span>
                        <div class="flex flex-wrap gap-2">
                            {avatarColors.map((color) => (
                                <button
                                    key={color}
                                    type="button"
                                    class={`size-6 rounded-full transition-transform hover:scale-110 ${form.avatar_color === color ? 'ring-2 ring-primary ring-offset-2 ring-offset-base-100 scale-110' : ''}`}
                                    style={{ backgroundColor: color }}
                                    onClick={() => setForm({ ...form, avatar_color: color })}
                                    aria-label={`Couleur ${color}`}
                                    aria-pressed={form.avatar_color === color}
                                />
                            ))}
                        </div>
                    </div>

                    {!isSubAgent && !isEventOnlyAgentType(form.type) && (
                        <div class="grid gap-1.5">
                            <label class="text-xs font-medium" for="agent-schedule">Quand travaille-t-il ?</label>
                            <select
                                id="agent-schedule"
                                class="select select-bordered select-sm w-full"
                                value={form.schedule_minutes ?? 0}
                                onChange={(e) => setForm({ ...form, schedule_minutes: Number((e.target as HTMLSelectElement).value) })}
                            >
                                <option value={0}>Manuel uniquement</option>
                                <option value={10}>Toutes les 10 min</option>
                                <option value={15}>Toutes les 15 min</option>
                                <option value={30}>Toutes les 30 min</option>
                                <option value={60}>Toutes les heures</option>
                                <option value={120}>Toutes les 2 heures</option>
                                <option value={360}>Toutes les 6 heures</option>
                                <option value={1440}>Une fois par jour</option>
                            </select>
                        </div>
                    )}

                    <button
                        class="btn btn-ghost btn-xs justify-self-start px-0 text-base-content/55"
                        type="button"
                        onClick={() => setShowAdvanced((v) => !v)}
                    >
                        {showAdvanced ? 'Masquer les options avancées' : 'Options avancées (LLM)'}
                    </button>

                    {showAdvanced && (
                        <div class="grid gap-3 rounded-lg border border-base-300 p-3">
                            <AgentProviderModelFields
                                providers={providers}
                                providerConfigId={form.provider_config_id}
                                fallbackProviderConfigId={form.fallback_provider_config_id}
                                preferredModel={form.preferred_model}
                                onProviderChange={(id) => setForm({ ...form, provider_config_id: id, preferred_model: null })}
                                onFallbackChange={(id) => setForm({ ...form, fallback_provider_config_id: id })}
                                onPreferredModelChange={(model) => setForm({ ...form, preferred_model: model })}
                            />
                            {providers.length === 0 && (
                                <p class="text-[11px] text-warning">
                                    Aucun provider configuré. Ajoutez-en un dans Paramètres → Intelligence Artificielle.
                                </p>
                            )}
                        </div>
                    )}

                    {error && (
                        <p class="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">{error}</p>
                    )}
                </form>
            )}
        </Modal>
    );
}
