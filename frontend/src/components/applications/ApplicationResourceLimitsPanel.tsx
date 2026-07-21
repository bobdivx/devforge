import { Gauge, LoaderCircle, Save } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { ActionToolbar } from '../ui/ActionToolbar';
import { DataState } from '../ui/DataState';
import { domainApi, type ApplicationResourceLimits } from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';

type Props = {
    applicationUuid: string;
    canAct: boolean;
};

type Draft = {
    limits_cpus: string;
    limits_cpuset: string;
    limits_cpu_shares: number;
    limits_memory: string;
    limits_memory_swap: string;
    limits_memory_reservation: string;
    limits_memory_swappiness: number;
};

function toDraft(data: ApplicationResourceLimits): Draft {
    return {
        limits_cpus: data.limits_cpus ?? '0',
        limits_cpuset: data.limits_cpuset ?? '',
        limits_cpu_shares: data.limits_cpu_shares,
        limits_memory: data.limits_memory || '0',
        limits_memory_swap: data.limits_memory_swap || '0',
        limits_memory_reservation: data.limits_memory_reservation || '0',
        limits_memory_swappiness: data.limits_memory_swappiness,
    };
}

export function ApplicationResourceLimitsPanel({ applicationUuid, canAct }: Props) {
    const query = useApiQuery(
        `application-resource-limits:${applicationUuid}`,
        () => domainApi.applicationResourceLimits(applicationUuid),
    );
    const data = query.data?.data;
    const [draft, setDraft] = useState<Draft | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    useEffect(() => {
        if (data) {
            setDraft(toDraft(data));
            setError(null);
        }
    }, [data]);

    const update = <K extends keyof Draft>(key: K, value: Draft[K]) => {
        setDraft((current) => (current ? { ...current, [key]: value } : current));
    };

    const save = async () => {
        if (!draft || !canAct) {
            return;
        }

        setSaving(true);
        setError(null);
        setMessage(null);

        try {
            const response = await domainApi.updateApplicationResourceLimits(applicationUuid, {
                limits_cpus: draft.limits_cpus.trim() || '0',
                limits_cpuset: draft.limits_cpuset.trim() || null,
                limits_cpu_shares: draft.limits_cpu_shares,
                limits_memory: draft.limits_memory.trim() || '0',
                limits_memory_swap: draft.limits_memory_swap.trim() || '0',
                limits_memory_reservation: draft.limits_memory_reservation.trim() || '0',
                limits_memory_swappiness: draft.limits_memory_swappiness,
            });
            setDraft(toDraft(response.data));
            setMessage(response.data.message ?? 'Limites mises à jour. Redéployez pour appliquer.');
            await query.reload();
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : 'Échec de l’enregistrement.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <section class="rounded-2xl border border-base-300/70 bg-base-100 shadow-sm">
            <div class="toolbar-row border-b border-base-300/70 px-5 py-4">
                <div>
                    <div class="flex items-center gap-2">
                        <Gauge class="size-4 text-base-content/45" aria-hidden />
                        <p class="text-sm font-semibold">Limites de ressources</p>
                    </div>
                    <p class="text-xs text-base-content/50">
                        CPU et mémoire Docker — utilisez 0 pour illimité
                    </p>
                </div>
                <ActionToolbar>
                    <button class="btn btn-ghost btn-sm" type="button" onClick={() => void query.reload()}>
                        Actualiser
                    </button>
                    {canAct && (
                        <button
                            class="btn btn-primary btn-sm"
                            type="button"
                            disabled={saving || !draft}
                            onClick={() => void save()}
                        >
                            {saving
                                ? <LoaderCircle class="size-3.5 animate-spin" aria-hidden />
                                : <Save class="size-3.5" aria-hidden />}
                            Enregistrer
                        </button>
                    )}
                </ActionToolbar>
            </div>

            <div class="grid gap-4 p-5">
                <DataState loading={query.loading} error={query.error} onRetry={() => void query.reload()}>
                    {draft && (
                        <div class="grid gap-4">
                            {message && (
                                <p class="rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
                                    {message}
                                </p>
                            )}
                            {error && <p class="text-sm text-error" role="alert">{error}</p>}

                            <div class="grid gap-3 sm:grid-cols-2">
                                <label class="grid gap-1.5 text-sm">
                                    <span class="font-medium text-base-content/80">CPUs</span>
                                    <input
                                        class="input input-bordered input-sm font-mono"
                                        disabled={!canAct || saving}
                                        value={draft.limits_cpus}
                                        placeholder="0.5"
                                        onInput={(event) => update('limits_cpus', (event.target as HTMLInputElement).value)}
                                    />
                                </label>
                                <label class="grid gap-1.5 text-sm">
                                    <span class="font-medium text-base-content/80">CPU set</span>
                                    <input
                                        class="input input-bordered input-sm font-mono"
                                        disabled={!canAct || saving}
                                        value={draft.limits_cpuset}
                                        placeholder="0-2 ou 0,1,3"
                                        onInput={(event) => update('limits_cpuset', (event.target as HTMLInputElement).value)}
                                    />
                                </label>
                                <label class="grid gap-1.5 text-sm">
                                    <span class="font-medium text-base-content/80">CPU shares</span>
                                    <input
                                        class="input input-bordered input-sm"
                                        type="number"
                                        min={0}
                                        disabled={!canAct || saving}
                                        value={draft.limits_cpu_shares}
                                        onInput={(event) => update(
                                            'limits_cpu_shares',
                                            Number((event.target as HTMLInputElement).value) || 0,
                                        )}
                                    />
                                </label>
                                <label class="grid gap-1.5 text-sm">
                                    <span class="font-medium text-base-content/80">Mémoire max</span>
                                    <input
                                        class="input input-bordered input-sm font-mono"
                                        disabled={!canAct || saving}
                                        value={draft.limits_memory}
                                        placeholder="512m"
                                        onInput={(event) => update('limits_memory', (event.target as HTMLInputElement).value)}
                                    />
                                </label>
                                <label class="grid gap-1.5 text-sm">
                                    <span class="font-medium text-base-content/80">Swap max</span>
                                    <input
                                        class="input input-bordered input-sm font-mono"
                                        disabled={!canAct || saving}
                                        value={draft.limits_memory_swap}
                                        placeholder="0"
                                        onInput={(event) => update('limits_memory_swap', (event.target as HTMLInputElement).value)}
                                    />
                                </label>
                                <label class="grid gap-1.5 text-sm">
                                    <span class="font-medium text-base-content/80">Réservation mémoire</span>
                                    <input
                                        class="input input-bordered input-sm font-mono"
                                        disabled={!canAct || saving}
                                        value={draft.limits_memory_reservation}
                                        placeholder="128m"
                                        onInput={(event) => update('limits_memory_reservation', (event.target as HTMLInputElement).value)}
                                    />
                                </label>
                                <label class="grid gap-1.5 text-sm sm:col-span-2">
                                    <span class="font-medium text-base-content/80">Swappiness (0–100)</span>
                                    <input
                                        class="input input-bordered input-sm"
                                        type="number"
                                        min={0}
                                        max={100}
                                        disabled={!canAct || saving}
                                        value={draft.limits_memory_swappiness}
                                        onInput={(event) => update(
                                            'limits_memory_swappiness',
                                            Number((event.target as HTMLInputElement).value) || 0,
                                        )}
                                    />
                                </label>
                            </div>
                        </div>
                    )}
                </DataState>
            </div>
        </section>
    );
}
