import { CheckCircle2, Cpu, Loader2, Power, RefreshCw, Save, Server, Sparkles, Wifi, WifiOff, Zap } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import type { PinokioInstance, PinokioModelInfo, PinokioStatus } from '../../lib/domain-api';
import { domainApi } from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';
import { useTeamContext } from '../../lib/team-context';
import { ApiError } from '../../lib/api-client';

const DEFAULT_DEMETER_URL = 'http://10.1.0.88:10086';
const DEFAULT_DEMETER_NAME = 'Demeter';

function normalizeStudioUrl(raw: string): string {
    const trimmed = raw.trim().replace(/\/+$/, '');
    if (!trimmed) {
        return '';
    }
    if (!/^https?:\/\//i.test(trimmed)) {
        return `http://${trimmed}`;
    }
    return trimmed.replace(/\/v1$/i, '');
}

interface Props {
    defaultBaseUrl?: string;
    canManage?: boolean;
    onModelSelected?: (model: string) => void;
}

export function PinokioStudioManager({
    defaultBaseUrl = DEFAULT_DEMETER_URL,
    canManage = false,
    onModelSelected,
}: Props) {
    const { agentsEnabled } = useTeamContext();
    const instancesQuery = useApiQuery(
        agentsEnabled ? 'pinokio-instances' : null,
        () => domainApi.pinokioInstances(),
    );
    const instances = (instancesQuery.data?.data ?? []) as PinokioInstance[];

    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [nameDraft, setNameDraft] = useState(DEFAULT_DEMETER_NAME);
    const [urlDraft, setUrlDraft] = useState(defaultBaseUrl);
    const [status, setStatus] = useState<PinokioStatus | null>(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
    const [selectedContextSize, setSelectedContextSize] = useState<number>(65536);

    useEffect(() => {
        if (instances.length === 0) {
            setSelectedId(null);
            return;
        }
        if (selectedId != null && instances.some((i) => i.id === selectedId)) {
            return;
        }
        const preferred = instances.find((i) => i.is_default) ?? instances[0];
        setSelectedId(preferred.id);
    }, [instances, selectedId]);

    const selected = instances.find((i) => i.id === selectedId) ?? null;

    useEffect(() => {
        if (selected) {
            setNameDraft(selected.name || DEFAULT_DEMETER_NAME);
            setUrlDraft(selected.resolved_base_url || selected.base_url || defaultBaseUrl);
            return;
        }
        if (instances.length === 0) {
            setNameDraft(DEFAULT_DEMETER_NAME);
            setUrlDraft(defaultBaseUrl);
        }
    }, [selected?.id, selected?.base_url, selected?.resolved_base_url, selected?.name, instances.length, defaultBaseUrl]);

    const probeUrl = normalizeStudioUrl(urlDraft) || null;

    const fetchStatus = async (overrideUrl?: string | null) => {
        const target = normalizeStudioUrl(overrideUrl ?? urlDraft);
        if (!target) {
            setStatus({
                reachable: false,
                base_url: null,
                active_model: null,
                running: false,
                context_size: null,
                backend_mode: null,
                gpu: null,
                models: [],
                error: 'Indiquez l’URL du studio Pinokio (ex. http://10.1.0.88:10086).',
            });
            return;
        }
        setLoading(true);
        try {
            const res = await domainApi.pinokioStatus({
                baseUrl: target,
                providerId: selectedId,
            });
            setStatus(res.data);
            if (res.data.context_size) {
                setSelectedContextSize(res.data.context_size);
            }
        } catch (err: unknown) {
            setStatus({
                reachable: false,
                base_url: target,
                active_model: null,
                running: false,
                context_size: null,
                backend_mode: null,
                gpu: null,
                models: [],
                error: err instanceof ApiError ? err.message : 'Serveur injoignable',
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void fetchStatus();
    }, [probeUrl, selectedId]);

    const handleSaveConnection = async () => {
        if (!canManage) {
            return;
        }
        const url = normalizeStudioUrl(urlDraft);
        const name = nameDraft.trim() || DEFAULT_DEMETER_NAME;
        if (!url) {
            setMessage({ text: 'URL requise.', type: 'error' });
            return;
        }
        setSaving(true);
        setMessage(null);
        try {
            if (selectedId != null) {
                await domainApi.updateAiProvider(selectedId, {
                    name,
                    base_url: url,
                    model: selected?.model ?? 'auto',
                });
                setMessage({ text: `Connexion « ${name} » mise à jour.`, type: 'success' });
            } else {
                const created = await domainApi.createAiProvider({
                    provider: 'openai',
                    name,
                    base_url: url,
                    model: 'auto',
                    is_default: false,
                });
                setSelectedId(created.data.id);
                setMessage({ text: `Studio « ${name} » enregistré (provider OpenAI local).`, type: 'success' });
            }
            await instancesQuery.reload({ silent: true });
            await fetchStatus(url);
        } catch (err: unknown) {
            setMessage({
                text: err instanceof ApiError ? err.message : 'Enregistrement impossible.',
                type: 'error',
            });
        } finally {
            setSaving(false);
        }
    };

    const handleStartModel = async (model: PinokioModelInfo) => {
        if (!probeUrl) {
            return;
        }
        setActionLoading(model.filename);
        setMessage(null);
        try {
            const res = await domainApi.pinokioStartModel({
                model: model.filename,
                base_url: probeUrl,
                provider_id: selectedId,
                context_size: selectedContextSize,
                gpu_layers: -1,
                flash_attn: true,
                batch_size: 2048,
            });
            setMessage({ text: res.data.message || `Modèle ${model.name} chargé en VRAM !`, type: 'success' });
            onModelSelected?.(model.filename);
            await fetchStatus();
        } catch (err: unknown) {
            setMessage({
                text: err instanceof ApiError ? err.message : 'Erreur lors du chargement du modèle.',
                type: 'error',
            });
        } finally {
            setActionLoading(null);
        }
    };

    const handleStopModel = async () => {
        if (!probeUrl) {
            return;
        }
        setActionLoading('stop');
        setMessage(null);
        try {
            const res = await domainApi.pinokioStopModel({
                base_url: probeUrl,
                provider_id: selectedId,
            });
            setMessage({ text: res.data.message || 'Modèle déchargé. VRAM libérée !', type: 'success' });
            await fetchStatus();
        } catch (err: unknown) {
            setMessage({
                text: err instanceof ApiError ? err.message : 'Erreur lors de la mise en veille.',
                type: 'error',
            });
        } finally {
            setActionLoading(null);
        }
    };

    const refreshAll = async () => {
        await instancesQuery.reload({ silent: true });
        await fetchStatus();
    };

    const vramUsed = status?.gpu?.vram_used_gb ?? 0;
    const vramTotal = status?.gpu?.vram_total_gb ?? 24;
    const vramPercent = vramTotal > 0 ? Math.min(100, Math.round((vramUsed / vramTotal) * 100)) : 0;

    return (
        <div class="grid gap-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="flex items-center gap-2">
                    <div class="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Cpu class="size-5" />
                    </div>
                    <div>
                        <h3 class="text-sm font-bold text-base-content">Demeter / Pinokio</h3>
                        <p class="text-xs text-base-content/60">
                            Studio GGUF local (RTX 3090) — URL LAN, charge VRAM, swap de modèles.
                        </p>
                    </div>
                </div>

                <div class="flex items-center gap-2">
                    <div class="flex items-center gap-1.5 rounded-lg border border-base-300 bg-base-200/50 px-2.5 py-1 text-xs">
                        {status?.reachable ? (
                            <>
                                <Wifi class="size-3.5 text-success" />
                                <span class="font-medium text-success">En ligne</span>
                            </>
                        ) : (
                            <>
                                <WifiOff class="size-3.5 text-error" />
                                <span class="font-medium text-error">Hors ligne</span>
                            </>
                        )}
                    </div>
                    <button
                        type="button"
                        class="btn btn-ghost btn-xs gap-1"
                        onClick={() => void refreshAll()}
                        disabled={loading || instancesQuery.loading}
                    >
                        <RefreshCw class={`size-3.5 ${loading || instancesQuery.loading ? 'animate-spin' : ''}`} />
                        Tester
                    </button>
                </div>
            </div>

            {instances.length > 0 && (
                <div class="flex flex-wrap gap-2">
                    {instances.map((instance) => {
                        const active = instance.id === selectedId;
                        return (
                            <button
                                key={instance.id}
                                type="button"
                                class={`btn btn-sm gap-1.5 ${active ? 'btn-primary' : 'btn-ghost border border-base-300'}`}
                                onClick={() => setSelectedId(instance.id)}
                            >
                                <Server class="size-3.5" aria-hidden />
                                <span class="truncate max-w-[12rem]">{instance.name}</span>
                                {instance.is_default && <span class="badge badge-xs">défaut</span>}
                                <span
                                    class={`size-1.5 rounded-full ${instance.reachable ? 'bg-success' : 'bg-warning'}`}
                                    title={instance.reachable ? 'Joignable' : 'Injoignable'}
                                />
                            </button>
                        );
                    })}
                    {canManage && (
                        <button
                            type="button"
                            class="btn btn-sm btn-ghost border border-dashed border-base-300"
                            onClick={() => {
                                setSelectedId(null);
                                setNameDraft(DEFAULT_DEMETER_NAME);
                                setUrlDraft(defaultBaseUrl);
                                setStatus(null);
                            }}
                        >
                            + Nouvelle instance
                        </button>
                    )}
                </div>
            )}

            <section class="grid gap-3 rounded-xl border border-base-300 bg-base-100 p-3 sm:p-4">
                <h4 class="text-xs font-semibold uppercase tracking-wide text-base-content/55">
                    Connexion
                </h4>
                <div class="grid gap-3 sm:grid-cols-2">
                    <label class="grid gap-1 text-[11px]">
                        <span class="font-medium text-base-content/70">Nom</span>
                        <input
                            class="input input-bordered input-sm"
                            type="text"
                            value={nameDraft}
                            disabled={!canManage || saving}
                            placeholder="Demeter"
                            onInput={(e) => setNameDraft((e.target as HTMLInputElement).value)}
                        />
                    </label>
                    <label class="grid gap-1 text-[11px] sm:col-span-2">
                        <span class="font-medium text-base-content/70">URL Pinokio (LAN)</span>
                        <input
                            class="input input-bordered input-sm font-mono"
                            type="url"
                            value={urlDraft}
                            disabled={saving}
                            placeholder={DEFAULT_DEMETER_URL}
                            onInput={(e) => setUrlDraft((e.target as HTMLInputElement).value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    void fetchStatus();
                                }
                            }}
                        />
                        <span class="text-[10px] text-base-content/45">
                            Ex. <code class="text-[10px]">{DEFAULT_DEMETER_URL}</code>
                            {' '}— pas le tunnel Cloudflare. Clé API optionnelle (endpoint OpenAI-compatible local).
                        </span>
                    </label>
                </div>
                <div class="flex flex-wrap gap-2">
                    <button
                        type="button"
                        class="btn btn-ghost btn-sm gap-1"
                        disabled={loading || !urlDraft.trim()}
                        onClick={() => void fetchStatus()}
                    >
                        {loading ? <span class="loading loading-spinner loading-xs" /> : <RefreshCw class="size-3.5" />}
                        Tester la connexion
                    </button>
                    {canManage && (
                        <button
                            type="button"
                            class="btn btn-primary btn-sm gap-1"
                            disabled={saving || !urlDraft.trim()}
                            onClick={() => void handleSaveConnection()}
                        >
                            {saving ? <span class="loading loading-spinner loading-xs" /> : <Save class="size-3.5" />}
                            {selectedId != null ? 'Enregistrer' : 'Enregistrer comme provider'}
                        </button>
                    )}
                </div>
            </section>

            {message && (
                <div class={`alert alert-${message.type === 'success' ? 'success' : 'error'} py-2 text-xs`}>
                    <span>{message.text}</span>
                </div>
            )}

            {!status?.reachable && (
                <p class="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                    {status?.error
                        ?? 'Hors ligne — vérifiez que Pinokio tourne sur le PC GPU, puis corrigez l’URL ci-dessus et cliquez sur Tester.'}
                </p>
            )}

            {status?.reachable && (
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div class="rounded-lg border border-base-300 bg-base-200/40 p-3">
                        <div class="flex items-center justify-between text-xs text-base-content/70">
                            <span class="font-medium">Mémoire VRAM ({status.gpu?.name || 'GPU'})</span>
                            <span class="font-bold text-base-content">{vramUsed} / {vramTotal} Go</span>
                        </div>
                        <div class="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-base-300">
                            <div
                                class={`h-full transition-all duration-500 ${vramPercent > 90 ? 'bg-error' : vramPercent > 70 ? 'bg-warning' : 'bg-primary'}`}
                                style={{ width: `${vramPercent}%` }}
                            />
                        </div>
                        <div class="mt-1.5 flex justify-between text-[10px] text-base-content/50">
                            <span>Utilisation : {vramPercent}%</span>
                            <span>{status.backend_mode || 'CUDA 12'}</span>
                        </div>
                    </div>

                    <div class="rounded-lg border border-base-300 bg-base-200/40 p-3 sm:col-span-2">
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-medium text-base-content/70">Modèle chargé en VRAM</span>
                            {status.running && (
                                <button
                                    type="button"
                                    class="btn btn-ghost btn-xs text-error gap-1 hover:bg-error/10"
                                    onClick={handleStopModel}
                                    disabled={actionLoading === 'stop'}
                                >
                                    {actionLoading === 'stop' ? <Loader2 class="size-3 animate-spin" /> : <Power class="size-3" />}
                                    Mettre en veille
                                </button>
                            )}
                        </div>
                        <div class="mt-1.5 flex flex-wrap items-center gap-2">
                            {status.active_model ? (
                                <>
                                    <span class="badge badge-primary font-mono text-xs">{status.active_model}</span>
                                    <span class="badge badge-outline badge-sm gap-1">
                                        <Zap class="size-3 text-warning" />
                                        {status.context_size ?? 65536} tokens
                                    </span>
                                    <span class="badge badge-success badge-sm gap-1">
                                        <Sparkles class="size-3" />
                                        Flash Attention
                                    </span>
                                </>
                            ) : (
                                <span class="text-xs text-base-content/50 italic">Aucun modèle en mémoire (GPU en veille)</span>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {status?.reachable && (
                <div class="space-y-2">
                    <div class="flex items-center justify-between">
                        <h4 class="text-xs font-bold uppercase tracking-wider text-base-content/60">Modèles disponibles</h4>
                        <div class="flex items-center gap-2">
                            <span class="text-xs text-base-content/60">Contexte :</span>
                            <select
                                class="select select-bordered select-xs"
                                value={selectedContextSize}
                                onChange={(e) => setSelectedContextSize(Number((e.target as HTMLSelectElement).value))}
                            >
                                <option value={32768}>32 768 tokens (32k)</option>
                                <option value={65536}>65 536 tokens (64k - Recommandé)</option>
                                <option value={131072}>131 072 tokens (128k - Max)</option>
                            </select>
                        </div>
                    </div>

                    <div class="divide-y divide-base-300 rounded-lg border border-base-300 bg-base-100">
                        {status.models && status.models.length > 0 ? (
                            status.models.map((model) => (
                                <div key={model.filename} class="flex items-center justify-between p-2.5 transition-colors hover:bg-base-200/30">
                                    <div class="min-w-0 flex-1 pr-3">
                                        <div class="flex items-center gap-2">
                                            <span class="font-mono text-xs font-semibold text-base-content truncate">{model.name}</span>
                                            {model.is_active && (
                                                <span class="badge badge-success badge-xs gap-1 font-medium">
                                                    <CheckCircle2 class="size-3" />
                                                    Actif en VRAM
                                                </span>
                                            )}
                                        </div>
                                        <div class="mt-0.5 flex items-center gap-2 text-[11px] text-base-content/50">
                                            <span>{model.filename}</span>
                                            {model.size && <span>• {model.size}</span>}
                                        </div>
                                    </div>
                                    <div>
                                        {model.is_active ? (
                                            <button type="button" class="btn btn-outline btn-success btn-xs" disabled>
                                                Prêt
                                            </button>
                                        ) : (
                                            <button
                                                type="button"
                                                class="btn btn-primary btn-xs gap-1"
                                                onClick={() => handleStartModel(model)}
                                                disabled={actionLoading === model.filename}
                                            >
                                                {actionLoading === model.filename ? (
                                                    <>
                                                        <Loader2 class="size-3 animate-spin" />
                                                        Chargement...
                                                    </>
                                                ) : (
                                                    <>
                                                        <Zap class="size-3" />
                                                        Charger sur GPU
                                                    </>
                                                )}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div class="p-4 text-center text-xs text-base-content/50">
                                Aucun modèle détecté (GGUF ou /v1/models).
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
