import { RefreshCw, Save } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { Card } from '../ui/Card';
import { DataState } from '../ui/DataState';
import { StatusBadge } from '../ui/StatusBadge';
import { SettingsDetailList } from '../settings/SettingsPanels';
import { domainApi } from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';

type ServerProxyPanelProps = {
    serverUuid: string;
    legacyBaseUrl?: string;
};

export function ServerProxyPanel({ serverUuid, legacyBaseUrl = '' }: ServerProxyPanelProps) {
    const settings = useApiQuery(
        `server-settings:${serverUuid}`,
        () => domainApi.serverSettings(serverUuid),
    );
    const proxy = settings.data?.data.proxy;

    return (
        <Card title="Proxy">
            <div class="card-toolbar mb-3 flex flex-wrap gap-2">
                <button class="btn btn-ghost btn-sm" type="button" onClick={() => void settings.reload()}>
                    <RefreshCw class="size-3.5" aria-hidden />
                    Actualiser
                </button>
                {legacyBaseUrl && (
                    <a
                        class="btn btn-ghost btn-sm"
                        href={`${legacyBaseUrl.replace(/\/$/, '')}/server/${serverUuid}/proxy`}
                    >
                        Édition avancée Coolify
                    </a>
                )}
            </div>
            <DataState loading={settings.loading} error={settings.error} onRetry={() => void settings.reload()}>
                {proxy && (
                    <div class="grid gap-3">
                        <SettingsDetailList
                            items={[
                                { label: 'Type', value: proxy.type ?? '—' },
                                {
                                    label: 'Statut',
                                    value: (
                                        <StatusBadge
                                            label={proxy.status ? String(proxy.status) : 'Inconnu'}
                                            tone={String(proxy.status ?? '').toLowerCase().includes('running') ? 'success' : 'neutral'}
                                        />
                                    ),
                                },
                                { label: 'Redirect', value: proxy.redirect_enabled ? 'Activé' : 'Désactivé' },
                                { label: 'URL redirect', value: proxy.redirect_url ?? '—' },
                                { label: 'Labels exacts', value: proxy.generate_exact_labels ? 'Oui' : 'Non' },
                                { label: 'Version Traefik détectée', value: proxy.detected_traefik_version ?? '—' },
                                {
                                    label: 'Config',
                                    value: proxy.config_out_of_sync ? 'Hors sync (saved ≠ applied)' : 'À jour / N/A',
                                },
                            ]}
                        />
                        <p class="text-xs text-base-content/55">
                            Démarrage/arrêt, YAML et configs dynamiques restent dans Coolify pour l’instant.
                        </p>
                    </div>
                )}
            </DataState>
        </Card>
    );
}

type ServerSwarmPanelProps = {
    serverUuid: string;
    canManage: boolean;
};

export function ServerSwarmPanel({ serverUuid, canManage }: ServerSwarmPanelProps) {
    const settings = useApiQuery(
        `server-settings:${serverUuid}`,
        () => domainApi.serverSettings(serverUuid),
    );
    const swarm = settings.data?.data.swarm;
    const [manager, setManager] = useState(false);
    const [worker, setWorker] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    useEffect(() => {
        setManager(Boolean(swarm?.is_swarm_manager));
        setWorker(Boolean(swarm?.is_swarm_worker));
    }, [swarm?.is_swarm_manager, swarm?.is_swarm_worker]);

    const save = async () => {
        setSaving(true);
        setError(null);
        setMessage(null);
        try {
            await domainApi.updateServerSettings(serverUuid, {
                is_swarm_manager: manager,
                is_swarm_worker: worker,
            });
            setMessage('Réglages Swarm enregistrés.');
            await settings.reload({ silent: true });
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Échec de l’enregistrement.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card title="Docker Swarm">
            <div class="card-toolbar mb-3">
                <button class="btn btn-ghost btn-sm" type="button" onClick={() => void settings.reload()}>
                    <RefreshCw class="size-3.5" aria-hidden />
                    Actualiser
                </button>
            </div>
            <DataState loading={settings.loading} error={settings.error} onRetry={() => void settings.reload()}>
                <div class="grid gap-3">
                    <p class="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                        Swarm est déprécié dans Coolify. Réservé aux clusters existants.
                    </p>
                    <label class="flex items-center justify-between gap-3 text-sm">
                        <span>Swarm manager</span>
                        <input
                            class="toggle toggle-sm"
                            type="checkbox"
                            checked={manager}
                            disabled={!canManage || saving || worker}
                            onChange={(event) => setManager(event.currentTarget.checked)}
                        />
                    </label>
                    <label class="flex items-center justify-between gap-3 text-sm">
                        <span>Swarm worker</span>
                        <input
                            class="toggle toggle-sm"
                            type="checkbox"
                            checked={worker}
                            disabled={!canManage || saving || manager}
                            onChange={(event) => setWorker(event.currentTarget.checked)}
                        />
                    </label>
                    {error && <p class="text-sm text-error">{error}</p>}
                    {message && <p class="text-sm text-success">{message}</p>}
                    {canManage && (
                        <button class="btn btn-primary btn-sm w-fit" type="button" disabled={saving} onClick={() => void save()}>
                            <Save class="size-3.5" aria-hidden />
                            {saving ? 'Enregistrement…' : 'Enregistrer'}
                        </button>
                    )}
                </div>
            </DataState>
        </Card>
    );
}

type ServerSentinelPanelProps = {
    serverUuid: string;
    canManage: boolean;
    legacyBaseUrl?: string;
};

export function ServerSentinelPanel({ serverUuid, canManage, legacyBaseUrl = '' }: ServerSentinelPanelProps) {
    const settings = useApiQuery(
        `server-settings:${serverUuid}`,
        () => domainApi.serverSettings(serverUuid),
    );
    const sentinel = settings.data?.data.sentinel;
    const [draft, setDraft] = useState({
        is_sentinel_enabled: false,
        is_metrics_enabled: false,
        sentinel_custom_url: '',
        sentinel_metrics_refresh_rate_seconds: '',
        sentinel_metrics_history_days: '',
        sentinel_push_interval_seconds: '',
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    useEffect(() => {
        if (!sentinel) {
            return;
        }
        setDraft({
            is_sentinel_enabled: Boolean(sentinel.is_sentinel_enabled),
            is_metrics_enabled: Boolean(sentinel.is_metrics_enabled),
            sentinel_custom_url: sentinel.sentinel_custom_url ?? '',
            sentinel_metrics_refresh_rate_seconds: sentinel.sentinel_metrics_refresh_rate_seconds?.toString() ?? '',
            sentinel_metrics_history_days: sentinel.sentinel_metrics_history_days?.toString() ?? '',
            sentinel_push_interval_seconds: sentinel.sentinel_push_interval_seconds?.toString() ?? '',
        });
    }, [sentinel]);

    const save = async () => {
        setSaving(true);
        setError(null);
        setMessage(null);
        try {
            await domainApi.updateServerSettings(serverUuid, {
                is_sentinel_enabled: draft.is_sentinel_enabled,
                is_metrics_enabled: draft.is_metrics_enabled,
                sentinel_custom_url: draft.sentinel_custom_url.trim() || null,
                sentinel_metrics_refresh_rate_seconds: draft.sentinel_metrics_refresh_rate_seconds === ''
                    ? null
                    : Number(draft.sentinel_metrics_refresh_rate_seconds),
                sentinel_metrics_history_days: draft.sentinel_metrics_history_days === ''
                    ? null
                    : Number(draft.sentinel_metrics_history_days),
                sentinel_push_interval_seconds: draft.sentinel_push_interval_seconds === ''
                    ? null
                    : Number(draft.sentinel_push_interval_seconds),
            });
            setMessage('Réglages Sentinel enregistrés.');
            await settings.reload({ silent: true });
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Échec de l’enregistrement.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card title="Sentinel">
            <div class="card-toolbar mb-3 flex flex-wrap gap-2">
                <button class="btn btn-ghost btn-sm" type="button" onClick={() => void settings.reload()}>
                    <RefreshCw class="size-3.5" aria-hidden />
                    Actualiser
                </button>
                {legacyBaseUrl && (
                    <a
                        class="btn btn-ghost btn-sm"
                        href={`${legacyBaseUrl.replace(/\/$/, '')}/server/${serverUuid}/sentinel`}
                    >
                        Actions agent Coolify
                    </a>
                )}
            </div>
            <DataState loading={settings.loading} error={settings.error} onRetry={() => void settings.reload()}>
                {sentinel && (
                    <div class="grid gap-3">
                        <SettingsDetailList
                            items={[
                                {
                                    label: 'Agent live',
                                    value: (
                                        <StatusBadge
                                            label={sentinel.is_live ? 'En ligne' : 'Hors ligne'}
                                            tone={sentinel.is_live ? 'success' : 'neutral'}
                                        />
                                    ),
                                },
                                {
                                    label: 'Token',
                                    value: sentinel.sentinel_token_set ? 'Configuré' : 'Absent',
                                },
                            ]}
                        />
                        <label class="flex items-center justify-between gap-3 text-sm">
                            <span>Sentinel activé</span>
                            <input
                                class="toggle toggle-sm"
                                type="checkbox"
                                checked={draft.is_sentinel_enabled}
                                disabled={!canManage || saving}
                                onChange={(event) => setDraft((current) => ({
                                    ...current,
                                    is_sentinel_enabled: event.currentTarget.checked,
                                }))}
                            />
                        </label>
                        <label class="flex items-center justify-between gap-3 text-sm">
                            <span>Métriques activées</span>
                            <input
                                class="toggle toggle-sm"
                                type="checkbox"
                                checked={draft.is_metrics_enabled}
                                disabled={!canManage || saving}
                                onChange={(event) => setDraft((current) => ({
                                    ...current,
                                    is_metrics_enabled: event.currentTarget.checked,
                                }))}
                            />
                        </label>
                        <label class="grid gap-1 text-xs">
                            <span>URL custom</span>
                            <input
                                class="input input-bordered input-sm"
                                value={draft.sentinel_custom_url}
                                disabled={!canManage || saving}
                                onInput={(event) => setDraft((current) => ({
                                    ...current,
                                    sentinel_custom_url: event.currentTarget.value,
                                }))}
                            />
                        </label>
                        <div class="grid gap-3 sm:grid-cols-3">
                            {(
                                [
                                    ['sentinel_metrics_refresh_rate_seconds', 'Refresh (s)'],
                                    ['sentinel_metrics_history_days', 'Historique (jours)'],
                                    ['sentinel_push_interval_seconds', 'Push (s)'],
                                ] as const
                            ).map(([key, label]) => (
                                <label class="grid gap-1 text-xs" key={key}>
                                    <span>{label}</span>
                                    <input
                                        class="input input-bordered input-sm"
                                        type="number"
                                        value={draft[key]}
                                        disabled={!canManage || saving}
                                        onInput={(event) => setDraft((current) => ({
                                            ...current,
                                            [key]: event.currentTarget.value,
                                        }))}
                                    />
                                </label>
                            ))}
                        </div>
                        {error && <p class="text-sm text-error">{error}</p>}
                        {message && <p class="text-sm text-success">{message}</p>}
                        {canManage && (
                            <button class="btn btn-primary btn-sm w-fit" type="button" disabled={saving} onClick={() => void save()}>
                                <Save class="size-3.5" aria-hidden />
                                {saving ? 'Enregistrement…' : 'Enregistrer'}
                            </button>
                        )}
                        <p class="text-xs text-base-content/55">
                            Restart / sync / régénération du token restent dans Coolify.
                        </p>
                    </div>
                )}
            </DataState>
        </Card>
    );
}
