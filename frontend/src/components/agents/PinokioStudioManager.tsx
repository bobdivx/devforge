import { CheckCircle2, Cpu, Loader2, Power, RefreshCw, Sparkles, Wifi, WifiOff, Zap } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import type { PinokioModelInfo, PinokioStatus } from '../../lib/domain-api';
import { domainApi } from '../../lib/domain-api';

interface Props {
    defaultBaseUrl?: string;
    onModelSelected?: (model: string) => void;
}

export function PinokioStudioManager({ defaultBaseUrl = 'http://10.1.0.88:10086', onModelSelected }: Props) {
    const [baseUrl] = useState(defaultBaseUrl);
    const [status, setStatus] = useState<PinokioStatus | null>(null);
    const [loading, setLoading] = useState(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
    const [selectedContextSize, setSelectedContextSize] = useState<number>(65536);

    const fetchStatus = async () => {
        setLoading(true);
        try {
            const res = await domainApi.pinokioStatus({ baseUrl });
            setStatus(res.data);
            if (res.data.context_size) {
                setSelectedContextSize(res.data.context_size);
            }
        } catch (err: any) {
            setStatus({
                reachable: false,
                base_url: baseUrl,
                active_model: null,
                running: false,
                context_size: null,
                backend_mode: null,
                gpu: null,
                models: [],
                error: err?.message || 'Serveur injoignable',
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void fetchStatus();
    }, [baseUrl]);

    const handleStartModel = async (model: PinokioModelInfo) => {
        setActionLoading(model.filename);
        setMessage(null);
        try {
            const res = await domainApi.pinokioStartModel({
                model: model.filename,
                base_url: baseUrl,
                context_size: selectedContextSize,
                gpu_layers: -1,
                flash_attn: true,
                batch_size: 2048,
            });
            setMessage({ text: res.data.message || `Modèle ${model.name} chargé en VRAM !`, type: 'success' });
            if (onModelSelected) {
                onModelSelected(model.filename);
            }
            await fetchStatus();
        } catch (err: any) {
            setMessage({ text: err?.message || 'Erreur lors du chargement du modèle.', type: 'error' });
        } finally {
            setActionLoading(null);
        }
    };

    const handleStopModel = async () => {
        setActionLoading('stop');
        setMessage(null);
        try {
            const res = await domainApi.pinokioStopModel({ base_url: baseUrl });
            setMessage({ text: res.data.message || 'Modèle déchargé. VRAM libérée !', type: 'success' });
            await fetchStatus();
        } catch (err: any) {
            setMessage({ text: err?.message || 'Erreur lors de la mise en veille.', type: 'error' });
        } finally {
            setActionLoading(null);
        }
    };

    const vramUsed = status?.gpu?.vram_used_gb ?? 0;
    const vramTotal = status?.gpu?.vram_total_gb ?? 24;
    const vramPercent = vramTotal > 0 ? Math.min(100, Math.round((vramUsed / vramTotal) * 100)) : 0;

    return (
        <div class="space-y-4 rounded-xl border border-base-300 bg-base-100 p-4 shadow-sm">
            {/* Header & Connection */}
            <div class="flex flex-wrap items-center justify-between gap-3 border-b border-base-300/80 pb-3">
                <div class="flex items-center gap-2">
                    <div class="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Cpu class="size-5" />
                    </div>
                    <div>
                        <h3 class="text-sm font-bold text-base-content">Local AI Studio (Pinokio)</h3>
                        <p class="text-xs text-base-content/60">Gestion et monitoring du serveur GPU local</p>
                    </div>
                </div>

                <div class="flex items-center gap-2">
                    <div class="flex items-center gap-1.5 rounded-lg border border-base-300 bg-base-200/50 px-2.5 py-1 text-xs">
                        {status?.reachable ? (
                            <>
                                <Wifi class="size-3.5 text-success" />
                                <span class="font-medium text-success">En ligne ({status.base_url})</span>
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
                        onClick={fetchStatus}
                        disabled={loading}
                    >
                        <RefreshCw class={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
                        Actualiser
                    </button>
                </div>
            </div>

            {/* Notification message */}
            {message && (
                <div class={`alert alert-${message.type === 'success' ? 'success' : 'error'} py-2 text-xs`}>
                    <span>{message.text}</span>
                </div>
            )}

            {/* Hardware & VRAM Telemetry */}
            {status?.reachable && (
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {/* GPU VRAM Card */}
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

                    {/* Active Model Card */}
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
                                    Mettre en veille (Libérer VRAM)
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
                                    <span class="badge badge-ghost badge-sm font-semibold text-success">100% GPU</span>
                                </>
                            ) : (
                                <span class="text-xs text-base-content/50 italic">Aucun modèle en mémoire (GPU en veille)</span>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Model Management & Fast Swap */}
            {status?.reachable && (
                <div class="space-y-2 pt-1">
                    <div class="flex items-center justify-between">
                        <h4 class="text-xs font-bold uppercase tracking-wider text-base-content/60">Modèles GGUF Disponibles</h4>
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
                                Aucun fichier .gguf détecté dans le dossier app/llm-models de Pinokio.
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
