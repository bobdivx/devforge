import { RefreshCw, Save } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { Card } from '../ui/Card';
import { DataState } from '../ui/DataState';
import { domainApi } from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';

type ServerAdvancedPanelProps = {
    serverUuid: string;
    canManage: boolean;
};

export function ServerAdvancedPanel({ serverUuid, canManage }: ServerAdvancedPanelProps) {
    const settings = useApiQuery(
        `server-settings-advanced:${serverUuid}`,
        () => domainApi.serverSettings(serverUuid),
    );
    const advanced = settings.data?.data.advanced;
    const [form, setForm] = useState({
        concurrent_builds: 1,
        dynamic_timeout: 1,
        deployment_queue_limit: 25,
        server_disk_usage_notification_threshold: 50,
        server_disk_usage_check_frequency: '0 23 * * *',
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    useEffect(() => {
        if (!advanced) {
            return;
        }
        setForm({
            concurrent_builds: advanced.concurrent_builds,
            dynamic_timeout: advanced.dynamic_timeout,
            deployment_queue_limit: advanced.deployment_queue_limit,
            server_disk_usage_notification_threshold: advanced.server_disk_usage_notification_threshold,
            server_disk_usage_check_frequency: advanced.server_disk_usage_check_frequency,
        });
    }, [advanced]);

    const save = async () => {
        setSaving(true);
        setError(null);
        setMessage(null);
        try {
            await domainApi.updateServerSettings(serverUuid, form);
            await settings.reload();
            setMessage('Paramètres avancés enregistrés.');
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Échec de l’enregistrement.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card title="Paramètres avancés">
            <div class="card-toolbar mb-3">
                <button class="btn btn-ghost btn-sm" type="button" onClick={() => void settings.reload()}>
                    <RefreshCw class="size-3.5" aria-hidden />
                    Actualiser
                </button>
            </div>
            <DataState loading={settings.loading} error={settings.error} onRetry={() => void settings.reload()}>
                {advanced && (
                    <div class="grid gap-3">
                        <div class="grid gap-2 sm:gap-3 md:grid-cols-2">
                            <label class="grid gap-1.5 text-sm">
                                <span class="font-medium">Builds concurrents</span>
                                <input
                                    class="input input-bordered input-sm w-full rounded-xl"
                                    type="number"
                                    min={1}
                                    max={100}
                                    disabled={!canManage || saving}
                                    value={form.concurrent_builds}
                                    onInput={(event) => setForm((current) => ({
                                        ...current,
                                        concurrent_builds: Number(event.currentTarget.value),
                                    }))}
                                />
                            </label>
                            <label class="grid gap-1.5 text-sm">
                                <span class="font-medium">Timeout dynamique (s)</span>
                                <input
                                    class="input input-bordered input-sm w-full rounded-xl"
                                    type="number"
                                    min={1}
                                    disabled={!canManage || saving}
                                    value={form.dynamic_timeout}
                                    onInput={(event) => setForm((current) => ({
                                        ...current,
                                        dynamic_timeout: Number(event.currentTarget.value),
                                    }))}
                                />
                            </label>
                            <label class="grid gap-1.5 text-sm">
                                <span class="font-medium">Limite file de déploiement</span>
                                <input
                                    class="input input-bordered input-sm w-full rounded-xl"
                                    type="number"
                                    min={1}
                                    disabled={!canManage || saving}
                                    value={form.deployment_queue_limit}
                                    onInput={(event) => setForm((current) => ({
                                        ...current,
                                        deployment_queue_limit: Number(event.currentTarget.value),
                                    }))}
                                />
                            </label>
                            <label class="grid gap-1.5 text-sm">
                                <span class="font-medium">Seuil alerte disque (%)</span>
                                <input
                                    class="input input-bordered input-sm w-full rounded-xl"
                                    type="number"
                                    min={1}
                                    max={99}
                                    disabled={!canManage || saving}
                                    value={form.server_disk_usage_notification_threshold}
                                    onInput={(event) => setForm((current) => ({
                                        ...current,
                                        server_disk_usage_notification_threshold: Number(event.currentTarget.value),
                                    }))}
                                />
                            </label>
                        </div>
                        <label class="grid gap-1.5 text-sm">
                            <span class="font-medium">Fréquence contrôle disque (cron)</span>
                            <input
                                class="input input-bordered input-sm w-full rounded-xl font-mono"
                                disabled={!canManage || saving}
                                value={form.server_disk_usage_check_frequency}
                                onInput={(event) => setForm((current) => ({
                                    ...current,
                                    server_disk_usage_check_frequency: event.currentTarget.value,
                                }))}
                            />
                        </label>
                        {error && <p class="text-sm text-error" role="alert">{error}</p>}
                        {message && <p class="text-sm text-success" role="status">{message}</p>}
                        {canManage && (
                            <button class="btn btn-primary btn-sm w-fit" type="button" disabled={saving} onClick={() => void save()}>
                                <Save class="size-3.5" aria-hidden />
                                {saving ? 'Enregistrement…' : 'Enregistrer'}
                            </button>
                        )}
                    </div>
                )}
            </DataState>
        </Card>
    );
}

type ServerTerminalAccessPanelProps = {
    serverUuid: string;
    canManage: boolean;
};

export function ServerTerminalAccessPanel({ serverUuid, canManage }: ServerTerminalAccessPanelProps) {
    const settings = useApiQuery(
        `server-settings-terminal:${serverUuid}`,
        () => domainApi.serverSettings(serverUuid),
    );
    const enabled = settings.data?.data.security?.is_terminal_enabled ?? false;
    const [password, setPassword] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    const toggle = async () => {
        setSaving(true);
        setError(null);
        setMessage(null);
        try {
            const response = await domainApi.updateServerSettings(serverUuid, {
                is_terminal_enabled: !enabled,
                confirmation_password: password,
            });
            setMessage(response.data.security?.is_terminal_enabled
                ? 'Accès terminal activé.'
                : 'Accès terminal désactivé.');
            setPassword('');
            await settings.reload();
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Échec de la mise à jour.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card title="Accès terminal" eyebrow="Sécurité">
            <div class="card-toolbar mb-3">
                <button class="btn btn-ghost btn-sm" type="button" onClick={() => void settings.reload()}>
                    <RefreshCw class="size-3.5" aria-hidden />
                    Actualiser
                </button>
            </div>
            <DataState loading={settings.loading} error={settings.error} onRetry={() => void settings.reload()}>
                <div class="grid gap-3">
                    <p class="text-sm text-base-content/65">
                        Contrôle si les utilisateurs peuvent ouvrir un terminal SSH vers ce serveur depuis DevForge.
                        Réservé aux administrateurs / propriétaires (confirmation par mot de passe).
                    </p>
                    <div class="flex items-center justify-between rounded-xl border border-base-300/70 px-3 py-2 text-sm">
                        <span>Terminal</span>
                        <span class={`badge ${enabled ? 'badge-success' : 'badge-neutral'}`}>
                            {enabled ? 'Activé' : 'Désactivé'}
                        </span>
                    </div>
                    {canManage && (
                        <>
                            <label class="grid max-w-sm gap-1.5 text-sm">
                                <span class="font-medium">Mot de passe de confirmation</span>
                                <input
                                    class="input input-bordered input-sm w-full rounded-xl"
                                    type="password"
                                    value={password}
                                    onInput={(event) => setPassword(event.currentTarget.value)}
                                    autoComplete="current-password"
                                />
                            </label>
                            <button
                                class={`btn btn-sm w-fit ${enabled ? 'btn-error btn-outline' : 'btn-primary'}`}
                                type="button"
                                disabled={saving || password.trim().length === 0}
                                onClick={() => void toggle()}
                            >
                                {saving ? 'En cours…' : enabled ? 'Désactiver le terminal' : 'Activer le terminal'}
                            </button>
                        </>
                    )}
                    {error && <p class="text-sm text-error" role="alert">{error}</p>}
                    {message && <p class="text-sm text-success" role="status">{message}</p>}
                </div>
            </DataState>
        </Card>
    );
}
