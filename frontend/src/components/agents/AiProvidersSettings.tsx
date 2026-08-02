import { CheckCircle, Pencil, Plus, RefreshCw, Trash2, Wifi, XCircle } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { ActionToolbar } from '../ui/ActionToolbar';
import { HiddenUsernameField } from '../ui/HiddenUsernameField';
import type { AiProviderConfig, LlmModelOption, LlmProvider } from '../../lib/domain-api';
import { domainApi } from '../../lib/domain-api';
import { AUTO_MODEL_VALUE, CUSTOM_MODEL_VALUE, formatModelLabel, isAutoModel, modelSelectValue } from '../../lib/llm-models';
import { useApiQuery } from '../../lib/use-api-query';
import { useTeamContext } from '../../lib/team-context';

const providerDefaults: Record<LlmProvider, { needsKey: boolean; needsUrl: boolean; defaultUrl: string }> = {
    gemini: {
        needsKey: true,
        needsUrl: false,
        defaultUrl: '',
    },
    ollama: {
        needsKey: false,
        needsUrl: true,
        defaultUrl: 'http://localhost:11434',
    },
    openai: {
        needsKey: true,
        needsUrl: true,
        defaultUrl: 'https://api.openai.com/v1',
    },
    openrouter: {
        needsKey: true,
        needsUrl: true,
        defaultUrl: 'https://openrouter.ai/api/v1',
    },
    anthropic: {
        needsKey: true,
        needsUrl: true,
        defaultUrl: 'https://api.anthropic.com/v1',
    },
};

type NewProviderForm = {
    provider: LlmProvider;
    name: string;
    api_key: string;
    base_url: string;
    model: string;
    is_default: boolean;
};

const emptyForm = (): NewProviderForm => ({
    provider: 'gemini',
    name: '',
    api_key: '',
    base_url: providerDefaults.gemini.defaultUrl || 'http://localhost:11434',
    model: AUTO_MODEL_VALUE,
    is_default: false,
});

function canDiscoverModels(
    form: NewProviderForm,
    existing?: Pick<AiProviderConfig, 'has_api_key'> | null,
): boolean {
    const info = providerDefaults[form.provider];

    if (info.needsKey) {
        if (form.api_key.trim().length >= 8) {
            return true;
        }

        return existing?.has_api_key === true;
    }

    if (info.needsUrl) {
        return form.base_url.trim().length > 0;
    }

    return true;
}

export function AiProvidersSettings() {
    const { agentsEnabled } = useTeamContext();
    const query = useApiQuery(agentsEnabled ? 'ai-providers' : null, () => domainApi.aiProviders());
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [form, setForm] = useState<NewProviderForm>(emptyForm());
    const [availableModels, setAvailableModels] = useState<LlmModelOption[]>([]);
    const [modelsLoading, setModelsLoading] = useState(false);
    const [modelsError, setModelsError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [testResults, setTestResults] = useState<Record<number, {
        success: boolean;
        message: string;
        models_available?: string[];
        models_working?: string[];
        models_failed?: Array<{ id: string; error: string | null }>;
        recommended?: string[];
        lines?: string[];
    } | null>>({});
    const [testing, setTesting] = useState<Record<number, boolean>>({});
    const [deleting, setDeleting] = useState<Record<number, boolean>>({});

    const providers = query.data?.data ?? [];
    const editingProvider = editingId ? providers.find((provider) => provider.id === editingId) ?? null : null;
    const isEditing = editingId !== null;

    const closeForm = () => {
        setShowForm(false);
        setEditingId(null);
        setForm(emptyForm());
        setAvailableModels([]);
        setModelsError(null);
    };

    const openCreateForm = () => {
        setEditingId(null);
        setForm(emptyForm());
        setAvailableModels([]);
        setModelsError(null);
        setShowForm(true);
    };

    const openEditForm = (provider: AiProviderConfig) => {
        setEditingId(provider.id);
        setForm({
            provider: provider.provider,
            name: provider.name,
            api_key: '',
            base_url: provider.base_url ?? 'http://localhost:11434',
            model: provider.model,
            is_default: provider.is_default,
        });
        setAvailableModels([]);
        setModelsError(null);
        setShowForm(true);
    };

    const loadModels = async (currentForm: NewProviderForm, providerId?: number | null) => {
        const existing = providerId ? providers.find((provider) => provider.id === providerId) ?? null : null;

        if (! canDiscoverModels(currentForm, existing)) {
            setAvailableModels([]);
            setModelsError(null);
            return;
        }

        setModelsLoading(true);
        setModelsError(null);

        try {
            const result = await domainApi.discoverAiProviderModels({
                provider: currentForm.provider,
                ...(currentForm.api_key ? { api_key: currentForm.api_key } : {}),
                ...(currentForm.base_url.trim() ? { base_url: currentForm.base_url } : {}),
                ...(providerId ? { provider_id: providerId } : {}),
            });

            const models = result.data.models;
            setAvailableModels(models);

            setForm((previous) => {
                if (isAutoModel(previous.model)) {
                    return previous;
                }

                if (models.length === 0) {
                    return previous;
                }

                if (models.some((model) => model.id === previous.model)) {
                    return previous;
                }

                return { ...previous, model: models[0].id };
            });
        } catch (error) {
            setAvailableModels([]);
            setModelsError(error instanceof Error ? error.message : 'Impossible de charger les modèles.');
        } finally {
            setModelsLoading(false);
        }
    };

    useEffect(() => {
        if (! showForm || ! canDiscoverModels(form, editingProvider)) {
            return;
        }

        const timer = window.setTimeout(() => {
            void loadModels(form, editingId);
        }, 400);

        return () => window.clearTimeout(timer);
    }, [showForm, editingId, form.provider, form.api_key, form.base_url]);

    const handleSubmit = async (e: Event) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            if (isEditing && editingId) {
                await domainApi.updateAiProvider(editingId, {
                    name: form.name,
                    model: form.model,
                    ...(form.provider === 'ollama' ? { base_url: form.base_url || null } : {}),
                    is_default: form.is_default,
                    ...(form.api_key ? { api_key: form.api_key } : {}),
                });
            } else {
                await domainApi.createAiProvider({
                    provider: form.provider,
                    name: form.name,
                    model: form.model,
                    ...(form.provider === 'ollama' ? { base_url: form.base_url || null } : {}),
                    is_default: form.is_default,
                    ...(form.api_key ? { api_key: form.api_key } : {}),
                } as Parameters<typeof domainApi.createAiProvider>[0]);
            }
            await query.reload();
            closeForm();
        } catch {
            // ignore
        } finally {
            setSubmitting(false);
        }
    };

    const handleTest = async (id: number) => {
        setTesting((prev) => ({ ...prev, [id]: true }));
        setTestResults((prev) => ({ ...prev, [id]: null }));
        try {
            const result = await domainApi.testAiProvider(id);
            setTestResults((prev) => ({ ...prev, [id]: result.data }));
        } finally {
            setTesting((prev) => ({ ...prev, [id]: false }));
        }
    };

    const handleDelete = async (id: number) => {
        if (! confirm('Supprimer ce provider ?')) {
            return;
        }
        setDeleting((prev) => ({ ...prev, [id]: true }));
        try {
            await domainApi.deleteAiProvider(id);
            await query.reload();
        } finally {
            setDeleting((prev) => ({ ...prev, [id]: false }));
        }
    };

    const handleSetDefault = async (id: number) => {
        await domainApi.updateAiProvider(id, { is_default: true });
        await query.reload();
    };

    const providerInfo = providerDefaults[form.provider];
    const modelSelect = modelSelectValue(form.model, availableModels);
    const showCustomModel = modelSelect === CUSTOM_MODEL_VALUE;

    return (
        <div class="grid gap-4">
            <div class="toolbar-row">
                <div>
                    <h3 class="text-sm font-semibold">Providers LLM</h3>
                    <p class="text-xs text-base-content/60">
                        Gemini, Ollama, etc. Plusieurs Ollama possibles (ex. PC 3090 + NAS A2000) = un provider par URL.
                    </p>
                </div>
                <div class="card-toolbar w-full sm:w-auto">
                    <button class="btn btn-primary btn-sm w-full sm:w-auto" type="button" onClick={openCreateForm}>
                        <Plus class="size-3.5" aria-hidden />
                        Ajouter
                    </button>
                </div>
            </div>

            {providers.length === 0 && ! showForm && (
                <div class="rounded-xl border border-dashed border-base-300 py-10 text-center">
                    <p class="text-xs text-base-content/50">Aucun provider configuré.</p>
                </div>
            )}

            {providers.length > 0 && (
                <ul class="divide-y divide-base-300 rounded-xl border border-base-300 bg-base-100">
                    {providers.map((provider) => (
                        <li key={provider.id} class="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-3">
                            <div class="min-w-0 flex-1">
                                <div class="flex items-center gap-2">
                                    <p class="text-sm font-medium">{provider.name}</p>
                                    {provider.is_default && (
                                        <span class="badge badge-xs border-primary/30 bg-primary/10 text-primary">Défaut</span>
                                    )}
                                </div>
                                <p class="text-[11px] text-base-content/50">
                                    {provider.provider} · {formatModelLabel(provider.model, provider.model_label)}
                                    {provider.base_url && ` · ${provider.base_url}`}
                                    {provider.has_api_key && ' · Clé API configurée'}
                                </p>
                                {testResults[provider.id] && (
                                    <div class={`mt-1 space-y-1 text-[11px] ${testResults[provider.id]!.success ? 'text-success' : 'text-error'}`}>
                                        <div class="flex items-center gap-1">
                                            {testResults[provider.id]!.success
                                                ? <CheckCircle class="size-3" aria-hidden />
                                                : <XCircle class="size-3" aria-hidden />}
                                            <span>{testResults[provider.id]!.message}</span>
                                        </div>
                                        {(testResults[provider.id]!.models_working?.length ?? 0) > 0 && (
                                            <p class="text-base-content/60">
                                                OK : {testResults[provider.id]!.models_working!.join(', ')}
                                            </p>
                                        )}
                                        {(testResults[provider.id]!.models_failed?.length ?? 0) > 0 && (
                                            <p class="text-error/80">
                                                KO : {testResults[provider.id]!.models_failed!
                                                    .map((row) => row.id)
                                                    .join(', ')}
                                            </p>
                                        )}
                                        {(testResults[provider.id]!.recommended?.length ?? 0) > 0 && (
                                            <p class="text-base-content/60">
                                                Recommandés : {testResults[provider.id]!.recommended!.slice(0, 4).join(', ')}
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                            <ActionToolbar class="shrink-0">
                                <button
                                    class="btn btn-ghost btn-xs"
                                    type="button"
                                    title="Modifier"
                                    disabled={showForm && editingId === provider.id}
                                    onClick={() => openEditForm(provider)}
                                >
                                    <Pencil class="size-3.5" aria-hidden />
                                </button>
                                {! provider.is_default && (
                                    <button
                                        class="btn btn-ghost btn-xs text-[11px]"
                                        type="button"
                                        onClick={() => void handleSetDefault(provider.id)}
                                    >
                                        Par défaut
                                    </button>
                                )}
                                <button
                                    class="btn btn-ghost btn-xs"
                                    type="button"
                                    title="Tester la connexion"
                                    disabled={testing[provider.id]}
                                    onClick={() => void handleTest(provider.id)}
                                >
                                    {testing[provider.id]
                                        ? <span class="loading loading-spinner loading-xs" />
                                        : <Wifi class="size-3.5" aria-hidden />}
                                </button>
                                <button
                                    class="btn btn-ghost btn-xs text-error"
                                    type="button"
                                    title="Supprimer"
                                    disabled={deleting[provider.id]}
                                    onClick={() => void handleDelete(provider.id)}
                                >
                                    <Trash2 class="size-3.5" aria-hidden />
                                </button>
                            </ActionToolbar>
                        </li>
                    ))}
                </ul>
            )}

            {showForm && (
                <form class="rounded-xl border border-primary/30 bg-base-100 p-4" onSubmit={handleSubmit}>
                    <HiddenUsernameField />
                    <h4 class="mb-4 text-sm font-semibold">{isEditing ? 'Modifier le provider' : 'Nouveau provider'}</h4>
                    <div class="grid gap-3 sm:grid-cols-2">
                        <label class="grid gap-1 text-xs">
                            <span class="font-medium">Type de provider</span>
                            <select
                                class="select select-bordered select-sm"
                                value={form.provider}
                                disabled={isEditing}
                                onChange={(e) => {
                                    const provider = (e.target as HTMLSelectElement).value as LlmProvider;
                                    setForm({
                                        ...form,
                                        provider,
                                        model: AUTO_MODEL_VALUE,
                                        base_url: providerDefaults[provider].defaultUrl
                                            || (provider === 'ollama' ? 'http://localhost:11434' : form.base_url),
                                    });
                                    setAvailableModels([]);
                                    setModelsError(null);
                                }}
                            >
                                <option value="gemini">Gemini (Google)</option>
                                <option value="ollama">Ollama (local)</option>
                                <option value="openai">OpenAI</option>
                                <option value="openrouter">OpenRouter</option>
                                <option value="anthropic">Anthropic</option>
                            </select>
                        </label>

                        <label class="grid gap-1 text-xs">
                            <span class="font-medium">Nom</span>
                            <input
                                class="input input-bordered input-sm"
                                type="text"
                                required
                                placeholder="ex. Gemini Pro Équipe"
                                value={form.name}
                                onInput={(e) => setForm({ ...form, name: (e.target as HTMLInputElement).value })}
                            />
                        </label>

                        {providerInfo.needsKey && (
                            <label class="grid gap-1 text-xs sm:col-span-2">
                                <span class="font-medium">Clé API</span>
                                <input
                                    class="input input-bordered input-sm"
                                    type="password"
                                    required={! isEditing}
                                    autoComplete="new-password"
                                    placeholder={isEditing && editingProvider?.has_api_key
                                        ? 'Laisser vide pour conserver la clé actuelle'
                                        : 'sk-… / AIza…'}
                                    value={form.api_key}
                                    onInput={(e) => setForm({ ...form, api_key: (e.target as HTMLInputElement).value })}
                                />
                                <span class="text-[11px] text-base-content/50">
                                    {isEditing && editingProvider?.has_api_key
                                        ? 'La clé enregistrée reste active tant que vous ne saisissez pas une nouvelle valeur.'
                                        : 'Les modèles disponibles seront chargés automatiquement depuis l\'API du provider.'}
                                </span>
                            </label>
                        )}

                        {providerInfo.needsUrl && (
                            <label class="grid gap-1 text-xs sm:col-span-2">
                                <span class="font-medium">URL Ollama</span>
                                <input
                                    class="input input-bordered input-sm"
                                    type="url"
                                    required
                                    placeholder="http://host.docker.internal:11434"
                                    value={form.base_url}
                                    onInput={(e) => setForm({ ...form, base_url: (e.target as HTMLInputElement).value })}
                                />
                                <span class="text-[11px] text-base-content/50">
                                    URL publique OK (ex. https://ollama.briseteia.me). En local Docker : IP hôte ou{' '}
                                    <code class="text-[10px]">host.docker.internal</code>, pas{' '}
                                    <code class="text-[10px]">localhost</code>.
                                </span>
                            </label>
                        )}

                        <label class="grid gap-1 text-xs sm:col-span-2">
                            <span class="flex items-center justify-between font-medium">
                                <span>Modèle</span>
                                <button
                                    class="btn btn-ghost btn-xs gap-1"
                                    type="button"
                                    disabled={modelsLoading || ! canDiscoverModels(form, editingProvider)}
                                    onClick={() => void loadModels(form, editingId)}
                                >
                                    {modelsLoading
                                        ? <span class="loading loading-spinner loading-xs" />
                                        : <RefreshCw class="size-3" aria-hidden />}
                                    Actualiser
                                </button>
                            </span>
                            <select
                                class="select select-bordered select-sm"
                                value={modelSelect}
                                disabled={modelsLoading && ! isAutoModel(form.model)}
                                onChange={(e) => {
                                    const value = (e.target as HTMLSelectElement).value;
                                    if (value === AUTO_MODEL_VALUE) {
                                        setForm({ ...form, model: AUTO_MODEL_VALUE });
                                        return;
                                    }
                                    if (value === CUSTOM_MODEL_VALUE) {
                                        setForm({ ...form, model: '' });
                                        return;
                                    }
                                    setForm({ ...form, model: value });
                                }}
                            >
                                <option value={AUTO_MODEL_VALUE}>Auto (recommandé)</option>
                                {availableModels.length === 0 && ! isAutoModel(form.model) && (
                                    <option value="">
                                        {canDiscoverModels(form, editingProvider)
                                            ? (modelsLoading ? 'Chargement des modèles…' : 'Aucun modèle chargé')
                                            : (form.provider === 'gemini'
                                                ? 'Saisissez d’abord la clé API'
                                                : 'Saisissez d’abord l’URL Ollama')}
                                    </option>
                                )}
                                {availableModels.map((model) => (
                                    <option key={model.id} value={model.id}>
                                        {model.label}
                                        {model.description ? ` — ${model.description.slice(0, 60)}` : ''}
                                    </option>
                                ))}
                                <option value={CUSTOM_MODEL_VALUE}>Autre modèle (saisie manuelle)</option>
                            </select>
                            <p class="text-[11px] text-base-content/50">
                                Auto choisit le meilleur modèle disponible pour ce provider, comme dans Cursor.
                            </p>
                            {modelsError && (
                                <span class="text-[11px] text-error">{modelsError}</span>
                            )}
                            {showCustomModel && (
                                <input
                                    class="input input-bordered input-sm mt-1"
                                    type="text"
                                    required
                                    placeholder="ex. gemini-2.5-flash"
                                    value={form.model}
                                    onInput={(e) => setForm({ ...form, model: (e.target as HTMLInputElement).value })}
                                />
                            )}
                        </label>

                        <label class="flex items-center gap-2 text-xs sm:col-span-2">
                            <input
                                class="checkbox checkbox-sm"
                                type="checkbox"
                                checked={form.is_default}
                                onChange={(e) => setForm({ ...form, is_default: (e.target as HTMLInputElement).checked })}
                            />
                            <span>Définir comme provider par défaut pour les nouveaux agents</span>
                        </label>
                    </div>

                    <div class="form-actions mt-4">
                        <button class="btn btn-ghost btn-sm" type="button" onClick={closeForm}>Annuler</button>
                        <button class="btn btn-primary btn-sm" type="submit" disabled={submitting || (! isAutoModel(form.model) && ! form.model)}>
                            {submitting && <span class="loading loading-spinner loading-xs" />}
                            {isEditing ? 'Enregistrer' : 'Ajouter le provider'}
                        </button>
                    </div>
                </form>
            )}
        </div>
    );
}
