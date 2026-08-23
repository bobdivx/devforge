import { Download, HardDrive, RefreshCw, Trash2, Cpu, CircuitBoard, Server, Bot, Star } from 'lucide-preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { ActionToolbar } from '../ui/ActionToolbar';
import { DataState } from '../ui/DataState';
import type { Agent, OllamaInstance, OllamaStatus } from '../../lib/domain-api';
import { domainApi } from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';
import { useTeamContext } from '../../lib/team-context';
import { ApiError } from '../../lib/api-client';

function formatBytes(bytes: number | null | undefined): string {
    if (bytes == null || bytes <= 0) {
        return '—';
    }
    const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatMib(mib: number | null | undefined): string {
    if (mib == null) {
        return '—';
    }
    return formatBytes(mib * 1024 * 1024);
}

export function OllamaControlPanel({ canManage = false }: { canManage?: boolean }) {
    const { agentsEnabled } = useTeamContext();
    const instancesQuery = useApiQuery(agentsEnabled ? 'ollama-instances' : null, () => domainApi.ollamaInstances());
    const instances = (instancesQuery.data?.data ?? []) as OllamaInstance[];
    const [selectedId, setSelectedId] = useState<number | null>(null);

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

    const statusQuery = useApiQuery(
        agentsEnabled && selectedId != null ? `ollama-status-${selectedId}` : null,
        () => domainApi.ollamaStatus({ providerId: selectedId }),
    );
    const status = statusQuery.data?.data as OllamaStatus | undefined;
    const selected = instances.find((i) => i.id === selectedId) ?? null;

    const [pullModel, setPullModel] = useState('qwen2.5:7b');
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const [actionOk, setActionOk] = useState<string | null>(null);
    const [agents, setAgents] = useState<Agent[]>([]);
    const [assignAgentUuid, setAssignAgentUuid] = useState('');

    useEffect(() => {
        if (!agentsEnabled) {
            return;
        }
        domainApi.agents()
            .then((r) => setAgents(r.data ?? []))
            .catch(() => setAgents([]));
    }, [agentsEnabled]);

    const runningNames = useMemo(
        () => new Set((status?.running ?? []).map((m) => m.name)),
        [status?.running],
    );

    const refreshAll = async () => {
        await instancesQuery.reload({ silent: true });
        await statusQuery.reload({ silent: true });
    };

    const handlePull = async () => {
        if (!pullModel.trim() || !canManage || selectedId == null) {
            return;
        }
        setBusy(true);
        setActionError(null);
        setActionOk(null);
        try {
            await domainApi.ollamaPull({
                model: pullModel.trim(),
                provider_id: selectedId,
                base_url: selected?.base_url ?? status?.base_url ?? undefined,
            });
            setActionOk(`Modèle ${pullModel.trim()} téléchargé sur ${selected?.name ?? 'Ollama'}.`);
            await statusQuery.reload({ silent: true });
        } catch (err) {
            setActionError(err instanceof ApiError ? err.message : 'Pull échoué.');
        } finally {
            setBusy(false);
        }
    };

    const handleDelete = async (model: string) => {
        if (!canManage || selectedId == null || !confirm(`Supprimer « ${model} » sur ${selected?.name ?? 'cette instance'} ?`)) {
            return;
        }
        setBusy(true);
        setActionError(null);
        setActionOk(null);
        try {
            await domainApi.ollamaDeleteModel({
                model,
                provider_id: selectedId,
                base_url: selected?.base_url ?? status?.base_url ?? undefined,
            });
            setActionOk(`Modèle ${model} supprimé.`);
            await statusQuery.reload({ silent: true });
        } catch (err) {
            setActionError(err instanceof ApiError ? err.message : 'Suppression échouée.');
        } finally {
            setBusy(false);
        }
    };

    const handleSetProviderModel = async (model: string) => {
        if (!canManage || selectedId == null) {
            return;
        }
        setBusy(true);
        setActionError(null);
        setActionOk(null);
        try {
            await domainApi.ollamaSetProviderModel({ provider_id: selectedId, model });
            setActionOk(`Modèle par défaut du provider « ${selected?.name ?? 'Ollama'} » → ${model}.`);
            await instancesQuery.reload({ silent: true });
        } catch (err) {
            setActionError(err instanceof ApiError ? err.message : 'Mise à jour du provider échouée.');
        } finally {
            setBusy(false);
        }
    };

    const handleAssignAgent = async (model: string) => {
        if (!canManage || selectedId == null || !assignAgentUuid) {
            setActionError('Choisissez un agent à attribuer.');
            return;
        }
        setBusy(true);
        setActionError(null);
        setActionOk(null);
        try {
            const result = await domainApi.ollamaAssignAgent({
                agent_uuid: assignAgentUuid,
                provider_id: selectedId,
                model,
            });
            setActionOk(`Agent « ${result.data.agent_name} » → ${selected?.name} / ${model}.`);
        } catch (err) {
            setActionError(err instanceof ApiError ? err.message : 'Attribution à l’agent échouée.');
        } finally {
            setBusy(false);
        }
    };

    const loading = instancesQuery.loading || (selectedId != null && statusQuery.loading && !status);
    const error = instancesQuery.error ?? statusQuery.error;

    return (
        <DataState loading={loading} error={error} onRetry={() => void refreshAll()}>
            <div class="grid gap-4">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <p class="text-[11px] text-base-content/55">
                        Une instance = un provider Ollama (URL). Ex. PC 3090 et NAS A2000 = 2 providers.
                    </p>
                    <ActionToolbar>
                        <button class="btn btn-ghost btn-xs gap-1" type="button" disabled={busy} onClick={() => void refreshAll()}>
                            <RefreshCw class={`size-3 ${loading ? 'animate-spin' : ''}`} aria-hidden />
                            Actualiser
                        </button>
                    </ActionToolbar>
                </div>

                {instances.length === 0 ? (
                    <p class="rounded-md border border-dashed border-base-300 px-3 py-4 text-center text-[11px] text-base-content/55">
                        Aucun provider Ollama. Créez-en un ci-dessus (ex. « Ollama PC 3090 » → https://ollama.briseteia.me
                        et « Ollama NAS A2000 » → https://ollamanas.briseteia.me).
                    </p>
                ) : (
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
                                    <span class="truncate max-w-[10rem]">{instance.name}</span>
                                    {instance.is_default && <span class="badge badge-xs">défaut</span>}
                                    <span class={`size-1.5 rounded-full ${instance.reachable ? 'bg-success' : 'bg-warning'}`} title={instance.reachable ? 'Joignable' : 'Injoignable'} />
                                </button>
                            );
                        })}
                    </div>
                )}

                {actionError && (
                    <p class="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">{actionError}</p>
                )}
                {actionOk && (
                    <p class="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">{actionOk}</p>
                )}

                {selectedId != null && (
                    <>
                        <div class="text-xs text-base-content/60">
                            {status?.reachable ? (
                                <span>
                                    {status.provider_name ?? selected?.name} · {status.base_url}
                                    {status.version ? ` · v${status.version}` : ''}
                                </span>
                            ) : (
                                <span class="text-warning">{status?.error ?? 'Instance injoignable'}</span>
                            )}
                        </div>

                        {canManage && (
                            <section class="grid gap-2 rounded-xl border border-base-300 p-3">
                                <h3 class="flex items-center gap-1.5 text-xs font-semibold">
                                    <Download class="size-3.5 text-base-content/50" aria-hidden />
                                    Télécharger sur cette instance
                                </h3>
                                <div class="flex flex-wrap gap-2">
                                    <input
                                        class="input input-bordered input-sm min-w-[12rem] flex-1 font-mono"
                                        type="text"
                                        placeholder="qwen2.5:7b"
                                        value={pullModel}
                                        disabled={busy || !status?.reachable}
                                        onInput={(e) => setPullModel((e.target as HTMLInputElement).value)}
                                    />
                                    <button
                                        class="btn btn-primary btn-sm gap-1"
                                        type="button"
                                        disabled={busy || !status?.reachable || !pullModel.trim()}
                                        onClick={() => void handlePull()}
                                    >
                                        {busy ? <span class="loading loading-spinner loading-xs" /> : <Download class="size-3.5" aria-hidden />}
                                        Pull
                                    </button>
                                </div>
                                <p class="text-[10px] text-base-content/45">
                                    Reco agents :{' '}
                                    <button type="button" class="link link-primary" onClick={() => setPullModel('qwen2.5:7b')}>qwen2.5:7b</button>
                                    {' · '}
                                    <button type="button" class="link link-primary" onClick={() => setPullModel('llama3.1:8b')}>llama3.1:8b</button>
                                </p>
                            </section>
                        )}

                        <section class="grid gap-2">
                            <h3 class="flex items-center gap-1.5 text-xs font-semibold">
                                <HardDrive class="size-3.5 text-base-content/50" aria-hidden />
                                Modèles ({status?.models?.length ?? 0})
                            </h3>
                            {canManage && agents.length > 0 && (
                                <label class="grid gap-1 text-[11px]">
                                    <span class="font-medium text-base-content/70">Agent cible (attribution)</span>
                                    <select
                                        class="select select-bordered select-xs"
                                        value={assignAgentUuid}
                                        onChange={(e) => setAssignAgentUuid((e.target as HTMLSelectElement).value)}
                                    >
                                        <option value="">Choisir un agent…</option>
                                        {agents.map((a) => (
                                            <option key={a.uuid} value={a.uuid}>{a.name} ({a.type})</option>
                                        ))}
                                    </select>
                                </label>
                            )}
                            {(status?.models ?? []).length === 0 ? (
                                <p class="rounded-md border border-dashed border-base-300 px-3 py-4 text-center text-[11px] text-base-content/50">
                                    Aucun modèle sur cette instance.
                                </p>
                            ) : (
                                <ul class="grid gap-2">
                                    {status!.models.map((model) => (
                                        <li key={model.name} class="flex flex-wrap items-center gap-2 rounded-lg border border-base-300 px-3 py-2">
                                            <div class="min-w-0 flex-1">
                                                <p class="truncate font-mono text-xs font-medium">{model.name}</p>
                                                <p class="text-[10px] text-base-content/50">
                                                    {formatBytes(model.size)}
                                                    {model.parameter_size ? ` · ${model.parameter_size}` : ''}
                                                    {model.quantization ? ` · ${model.quantization}` : ''}
                                                    {runningNames.has(model.name) && (
                                                        <span class="ms-1 text-success">· en mémoire</span>
                                                    )}
                                                </p>
                                            </div>
                                            {canManage && (
                                                <div class="flex flex-wrap gap-1">
                                                    <button
                                                        class="btn btn-ghost btn-xs gap-1"
                                                        type="button"
                                                        title="Définir comme modèle du provider"
                                                        disabled={busy}
                                                        onClick={() => void handleSetProviderModel(model.name)}
                                                    >
                                                        <Star class="size-3" aria-hidden />
                                                        Provider
                                                    </button>
                                                    <button
                                                        class="btn btn-ghost btn-xs gap-1"
                                                        type="button"
                                                        title="Attribuer ce modèle à l’agent sélectionné"
                                                        disabled={busy || !assignAgentUuid}
                                                        onClick={() => void handleAssignAgent(model.name)}
                                                    >
                                                        <Bot class="size-3" aria-hidden />
                                                        Agent
                                                    </button>
                                                    <button
                                                        class="btn btn-ghost btn-xs text-error"
                                                        type="button"
                                                        title="Supprimer"
                                                        disabled={busy}
                                                        onClick={() => void handleDelete(model.name)}
                                                    >
                                                        <Trash2 class="size-3" aria-hidden />
                                                    </button>
                                                </div>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>

                        {(status?.running?.length ?? 0) > 0 && (
                            <section class="grid gap-1 text-[11px] text-base-content/60">
                                <p class="font-medium text-base-content/80">Chargés (VRAM estimée via Ollama)</p>
                                {status!.running.map((m) => (
                                    <p key={m.name} class="font-mono">
                                        {m.name}
                                        {m.size_vram != null ? ` · VRAM ${formatBytes(m.size_vram)}` : ''}
                                    </p>
                                ))}
                            </section>
                        )}
                    </>
                )}

                <section class="grid gap-2 rounded-xl border border-base-300 p-3">
                    <h3 class="flex items-center gap-1.5 text-xs font-semibold">
                        <CircuitBoard class="size-3.5 text-base-content/50" aria-hidden />
                        Hôte DevForge (SSH)
                    </h3>
                    <p class="text-[10px] text-base-content/45">
                        Inventaire du serveur qui héberge DevForge (souvent le NAS / A2000), pas forcément l’instance Ollama sélectionnée (ex. PC 3090).
                    </p>
                    {status?.host?.probed ? (
                        <div class="grid gap-2 sm:gap-3 sm:grid-cols-2">
                            <div class="rounded-lg border border-base-300 bg-base-200/30 px-3 py-2 text-[11px]">
                                <p class="flex items-center gap-1 font-medium">
                                    <Cpu class="size-3" aria-hidden />
                                    CPU / RAM
                                </p>
                                <p class="mt-1 text-base-content/65">
                                    {status.host.cpu_cores ?? '—'} cœurs · RAM {formatBytes(status.host.memory_total_bytes)}
                                    {status.host.memory_available_bytes != null && (
                                        <span> ({formatBytes(status.host.memory_available_bytes)} dispo)</span>
                                    )}
                                </p>
                            </div>
                            {(status.host.gpus ?? []).length === 0 ? (
                                <div class="rounded-lg border border-dashed border-base-300 px-3 py-2 text-[11px] text-base-content/50">
                                    Aucun GPU NVIDIA sur l’hôte DevForge (nvidia-smi).
                                </div>
                            ) : (
                                status.host.gpus.map((gpu) => (
                                    <div key={gpu.index} class="rounded-lg border border-base-300 bg-base-200/30 px-3 py-2 text-[11px]">
                                        <p class="font-medium">GPU {gpu.index} · {gpu.name}</p>
                                        <p class="mt-1 text-base-content/65">
                                            VRAM {formatMib(gpu.memory_used_mib)} / {formatMib(gpu.memory_total_mib)}
                                            {gpu.utilization_percent != null && ` · ${gpu.utilization_percent}%`}
                                            {gpu.temperature_c != null && ` · ${gpu.temperature_c}°C`}
                                        </p>
                                        {gpu.memory_total_mib != null && gpu.memory_used_mib != null && (
                                            <progress
                                                class="progress progress-primary mt-2 h-1.5 w-full"
                                                value={gpu.memory_used_mib}
                                                max={gpu.memory_total_mib}
                                            />
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    ) : (
                        <p class="text-[11px] text-base-content/50">
                            {status?.host?.error ?? 'Inventaire hôte non disponible (chargez une instance pour sonder).'}
                        </p>
                    )}
                </section>
            </div>
        </DataState>
    );
}
