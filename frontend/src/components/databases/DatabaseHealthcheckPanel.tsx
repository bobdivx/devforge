import { Activity, LoaderCircle, Save } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { ActionToolbar } from '../ui/ActionToolbar';
import { DataState } from '../ui/DataState';
import { domainApi, type DatabaseHealthcheckSettings } from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';

type Props = {
    databaseUuid: string;
    canAct: boolean;
};

type Draft = {
    health_check_enabled: boolean;
    health_check_interval: number;
    health_check_timeout: number;
    health_check_retries: number;
    health_check_start_period: number;
};

function toDraft(data: DatabaseHealthcheckSettings): Draft {
    return {
        health_check_enabled: data.health_check_enabled,
        health_check_interval: data.health_check_interval,
        health_check_timeout: data.health_check_timeout,
        health_check_retries: data.health_check_retries,
        health_check_start_period: data.health_check_start_period,
    };
}

export function DatabaseHealthcheckPanel({ databaseUuid, canAct }: Props) {
    const query = useApiQuery(
        `database-healthcheck:${databaseUuid}`,
        () => domainApi.databaseHealthcheck(databaseUuid),
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
            const response = await domainApi.updateDatabaseHealthcheck(databaseUuid, draft);
            setDraft(toDraft(response.data));
            setMessage(response.data.message ?? 'Healthcheck mis à jour. Redémarrez la base pour appliquer.');
            await query.reload();
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : 'Échec de l’enregistrement.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <section class="rounded-2xl border border-base-300/70 bg-base-100 shadow-sm">
            <div class="toolbar-row border-b border-base-300/70 px-3 sm:px-4 md:px-5 py-3 sm:py-4">
                <div>
                    <div class="flex items-center gap-2">
                        <Activity class="size-3.5 sm:size-4 text-base-content/45" aria-hidden />
                        <p class="text-xs sm:text-sm font-semibold">Healthcheck</p>
                    </div>
                    <p class="text-xs text-base-content/50">
                        Timing Docker Compose — la probe est fixe selon le moteur
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

            <div class="grid gap-2.5 sm:gap-3 md:gap-4 p-5">
                <DataState loading={query.loading} error={query.error} onRetry={() => void query.reload()}>
                    {draft && data && (
                        <div class="grid gap-4">
                            {message && (
                                <p class="rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
                                    {message}
                                </p>
                            )}
                            {error && (
                                <p class="text-sm text-error" role="alert">{error}</p>
                            )}

                            <p class="rounded-xl border border-base-300/60 bg-base-200/30 px-3 py-2 text-xs text-base-content/60">
                                Probe : <span class="font-mono text-base-content/80">{data.probe_label}</span>
                            </p>

                            {!draft.health_check_enabled && (
                                <p class="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
                                    Healthcheck désactivé — Docker ne surveillera pas la santé du conteneur.
                                </p>
                            )}

                            <label class="flex items-center gap-2 sm:gap-3 text-sm">
                                <input
                                    class="toggle toggle-sm"
                                    type="checkbox"
                                    checked={draft.health_check_enabled}
                                    disabled={!canAct || saving}
                                    onChange={(event) => update('health_check_enabled', event.currentTarget.checked)}
                                />
                                <span>Activer le healthcheck</span>
                            </label>

                            <div class="grid gap-2 sm:gap-3 sm:grid-cols-2">
                                {(
                                    [
                                        ['health_check_interval', 'Intervalle (s)', 1],
                                        ['health_check_timeout', 'Timeout (s)', 1],
                                        ['health_check_retries', 'Retries', 1],
                                        ['health_check_start_period', 'Start period (s)', 0],
                                    ] as const
                                ).map(([key, label, min]) => (
                                    <label class="grid gap-1.5 text-sm" key={key}>
                                        <span class="font-medium text-base-content/80">{label}</span>
                                        <input
                                            class="input input-bordered input-sm"
                                            type="number"
                                            min={min}
                                            disabled={!canAct || saving || !draft.health_check_enabled}
                                            value={draft[key]}
                                            onInput={(event) => update(
                                                key,
                                                Number((event.target as HTMLInputElement).value) || min,
                                            )}
                                        />
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}
                </DataState>
            </div>
        </section>
    );
}
