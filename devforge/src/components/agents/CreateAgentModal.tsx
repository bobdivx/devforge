import { X } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import type { AgentInput, AgentType, AiProviderConfig } from '../../lib/domain-api';
import { domainApi } from '../../lib/domain-api';
import { isEventOnlyAgentType } from '../../lib/agent-triggers';

const agentTypes: { value: AgentType; label: string; description: string }[] = [
    { value: 'debug', label: 'Débogage', description: 'Analyse les logs et erreurs de déploiement' },
    { value: 'deployment', label: 'Déploiement', description: 'Surveille chaque build et corrige les déploiements échoués' },
    { value: 'tech-watch', label: 'Veille Tech', description: 'Détecte les mises à jour et configurations obsolètes' },
    { value: 'github', label: 'GitHub', description: 'Surveille les PR et branches' },
    { value: 'devforge', label: 'DevForge', description: 'Surveille chaque build (webhook ou manuel) et analyse la plateforme' },
    { value: 'security', label: 'Sécurité', description: 'Inspecte les configurations et signale les risques' },
];

const avatarColors = [
    '#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444',
    '#8b5cf6', '#06b6d4', '#84cc16', '#f97316',
];

const defaultSchedules = [
    { label: 'Manuel uniquement', value: 0 },
    { label: 'Toutes les 10 min', value: 10 },
    { label: 'Toutes les 15 min', value: 15 },
    { label: 'Toutes les 30 min', value: 30 },
    { label: 'Toutes les heures', value: 60 },
    { label: 'Toutes les 2 heures', value: 120 },
    { label: 'Toutes les 6 heures', value: 360 },
    { label: 'Une fois par jour', value: 1440 },
];

type Props = {
    open: boolean;
    onClose: () => void;
    onCreated: () => void;
};

export function CreateAgentModal({ open, onClose, onCreated }: Props) {
    const [providers, setProviders] = useState<AiProviderConfig[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [form, setForm] = useState<AgentInput>({
        type: 'debug',
        name: '',
        description: '',
        avatar_color: avatarColors[0],
        schedule_minutes: 15,
        provider_config_id: null,
        fallback_provider_config_id: null,
        is_active: true,
    });

    useEffect(() => {
        if (open) {
            domainApi.aiProviders().then((r) => setProviders(r.data)).catch(() => {});
        }
    }, [open]);

    const handleSubmit = async (e: Event) => {
        e.preventDefault();
        if (!form.name.trim()) {
            return;
        }
        setSubmitting(true);
        setError(null);
        try {
            await domainApi.createAgent(form);
            onCreated();
            onClose();
            setForm({
                type: 'debug',
                name: '',
                description: '',
                avatar_color: avatarColors[0],
                schedule_minutes: 15,
                provider_config_id: null,
                is_active: true,
            });
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Erreur lors de la création.');
        } finally {
            setSubmitting(false);
        }
    };

    if (!open) {
        return null;
    }

    return (
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal aria-label="Créer un agent">
            <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
            <div class="relative z-10 w-full max-w-lg rounded-xl border border-base-300 bg-base-100 shadow-2xl">
                <div class="flex items-center justify-between border-b border-base-300 px-5 py-4">
                    <h2 class="text-sm font-semibold">Créer un agent IA</h2>
                    <button class="btn btn-ghost btn-sm btn-square" type="button" onClick={onClose}>
                        <X class="size-4" aria-hidden />
                    </button>
                </div>

                <form onSubmit={handleSubmit}>
                    <div class="grid gap-4 p-5">
                        <div class="grid gap-1.5">
                            <label class="text-xs font-medium" for="agent-type">Type d'agent</label>
                            <select
                                id="agent-type"
                                class="select select-bordered select-sm w-full"
                                value={form.type}
                                onChange={(e) => {
                                    const type = (e.target as HTMLSelectElement).value as AgentType;
                                    setForm({
                                        ...form,
                                        type,
                                        schedule_minutes: isEventOnlyAgentType(type) ? 0 : form.schedule_minutes,
                                    });
                                }}
                            >
                                {agentTypes.map(({ value, label, description }) => (
                                    <option key={value} value={value}>{label} — {description}</option>
                                ))}
                            </select>
                        </div>

                        <div class="grid gap-1.5">
                            <label class="text-xs font-medium" for="agent-name">Nom de l'agent *</label>
                            <input
                                id="agent-name"
                                class="input input-bordered input-sm w-full"
                                type="text"
                                placeholder="ex. Debug Production"
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
                                placeholder="Décrivez le rôle de cet agent…"
                                value={form.description}
                                onInput={(e) => setForm({ ...form, description: (e.target as HTMLTextAreaElement).value })}
                            />
                        </div>

                        <div class="grid gap-1.5">
                            <label class="text-xs font-medium">Couleur d'avatar</label>
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

                        <div class="grid gap-1.5">
                            <label class="text-xs font-medium" for="agent-provider">Provider LLM</label>
                            <select
                                id="agent-provider"
                                class="select select-bordered select-sm w-full"
                                value={form.provider_config_id ?? ''}
                                onChange={(e) => {
                                    const v = (e.target as HTMLSelectElement).value;
                                    setForm({ ...form, provider_config_id: v ? Number(v) : null });
                                }}
                            >
                                <option value="">Auto (provider par défaut de l&apos;équipe)</option>
                                {providers.map((p) => (
                                    <option key={p.id} value={p.id}>{p.name} ({p.provider})</option>
                                ))}
                            </select>
                            <p class="text-[11px] text-base-content/50">
                                Le modèle est choisi automatiquement (mode Auto), comme dans Cursor. Configurez les providers dans Paramètres → Intelligence Artificielle.
                            </p>
                            {providers.length === 0 && (
                                <p class="text-[11px] text-warning">
                                    Aucun provider configuré. Ajoutez-en un dans Paramètres → Intelligence Artificielle.
                                </p>
                            )}
                        </div>

                        <div class="grid gap-1.5">
                            <label class="text-xs font-medium" for="agent-fallback-provider">Provider de secours (optionnel)</label>
                            <select
                                id="agent-fallback-provider"
                                class="select select-bordered select-sm w-full"
                                value={form.fallback_provider_config_id ?? ''}
                                onChange={(e) => {
                                    const v = (e.target as HTMLSelectElement).value;
                                    setForm({ ...form, fallback_provider_config_id: v ? Number(v) : null });
                                }}
                            >
                                <option value="">Automatique (autre provider de l&apos;équipe)</option>
                                {providers
                                    .filter((p) => p.id !== form.provider_config_id)
                                    .map((p) => (
                                        <option key={p.id} value={p.id}>{p.name} ({p.provider})</option>
                                    ))}
                            </select>
                            <p class="text-[11px] text-base-content/50">
                                Si Gemini est surchargé (503), l&apos;agent bascule vers ce provider ou vers Ollama s&apos;il est configuré.
                            </p>
                        </div>

                        {isEventOnlyAgentType(form.type) ? (
                            <div class="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-[11px] text-base-content/70">
                                Déclenché automatiquement à chaque <strong>build webhook</strong> (push Git, etc.). Pas de minuteur.
                            </div>
                        ) : (
                            <div class="grid gap-1.5">
                                <label class="text-xs font-medium" for="agent-schedule">Planification</label>
                                <select
                                    id="agent-schedule"
                                    class="select select-bordered select-sm w-full"
                                    value={form.schedule_minutes}
                                    onChange={(e) => setForm({ ...form, schedule_minutes: Number((e.target as HTMLSelectElement).value) })}
                                >
                                    {defaultSchedules.map(({ label, value }) => (
                                        <option key={value} value={value}>{label}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {error && (
                            <p class="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">{error}</p>
                        )}
                    </div>

                    <div class="form-actions border-t border-base-300 px-5 py-4">
                        <button class="btn btn-ghost btn-sm" type="button" onClick={onClose}>Annuler</button>
                        <button
                            class="btn btn-primary btn-sm"
                            type="submit"
                            disabled={submitting || !form.name.trim()}
                        >
                            {submitting && <span class="loading loading-spinner loading-xs" />}
                            Créer l'agent
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
