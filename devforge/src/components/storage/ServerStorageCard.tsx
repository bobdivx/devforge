import { useEffect, useState } from 'preact/hooks';
import { RefreshCw, Trash2 } from 'lucide-preact';
import { Card } from '../ui/Card';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { StatusBadge } from '../ui/StatusBadge';
import {
    domainApi,
    type ServerStorageCleanupSettings,
    type ServerStorageMonitoringSettings,
    type ServerStorageSummary,
} from '../../lib/domain-api';
import { diskUsageLabel, diskUsageTone } from '../../lib/disk-usage';
import { cleanupFreedNoSpace, criticalDiskHints } from '../../lib/storage-cleanup-hints';
import { useServerCleanupTracker } from '../../lib/use-server-cleanup-tracker';
import { CleanupProgressPanel } from './CleanupProgressPanel';

type Props = {
    server: ServerStorageSummary;
    canManage: boolean;
    onUpdated: (server: ServerStorageSummary) => void;
};

type FormState = ServerStorageCleanupSettings & ServerStorageMonitoringSettings;

function toFormState(server: ServerStorageSummary): FormState {
    return {
        ...server.cleanup,
        ...server.monitoring,
    };
}

export function ServerStorageCard({ server, canManage, onUpdated }: Props) {
    const [diskUsage, setDiskUsage] = useState(server.disk_usage_percent);
    const [form, setForm] = useState<FormState>(() => toFormState(server));
    const [expanded, setExpanded] = useState(false);
    const [detail, setDetail] = useState(server);
    const [loadingDetail, setLoadingDetail] = useState(false);
    const [refreshingDisk, setRefreshingDisk] = useState(false);
    const [saving, setSaving] = useState(false);
    const [confirmCleanup, setConfirmCleanup] = useState(false);
    const [confirmAggressive, setConfirmAggressive] = useState(false);
    const [feedback, setFeedback] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const cleanupTracker = useServerCleanupTracker(server.uuid, {
        onComplete: (updated) => {
            if (updated) {
                setDiskUsage(updated.disk_usage_percent);
                setDetail(updated);
                onUpdated(updated);

                if (updated.last_cleanup?.status === 'success') {
                    setFeedback(updated.last_cleanup.message ?? 'Nettoyage Docker terminé.');
                }
            }
        },
    });

    useEffect(() => {
        setDiskUsage(server.disk_usage_percent);
        setForm(toFormState(server));
        setDetail(server);
    }, [server.uuid, server.disk_usage_percent, server.cleanup, server.monitoring, server.last_cleanup]);

    const toggleExpanded = async () => {
        if (expanded) {
            setExpanded(false);
            return;
        }

        setLoadingDetail(true);
        setError(null);

        try {
            const response = await domainApi.serverStorage(server.uuid, false);
            setDetail(response.data);
            onUpdated(response.data);
            setExpanded(true);
        } catch {
            setError('Impossible de charger la configuration détaillée.');
        } finally {
            setLoadingDetail(false);
        }
    };

    const usageTone = diskUsageTone(
        diskUsage,
        form.docker_cleanup_threshold,
        form.server_disk_usage_notification_threshold,
    );

    const refreshDisk = async () => {
        setRefreshingDisk(true);
        setError(null);

        try {
            const response = await domainApi.refreshServerDiskUsage(server.uuid);
            setDiskUsage(response.data.disk_usage_percent);
            onUpdated({ ...server, disk_usage_percent: response.data.disk_usage_percent });
        } catch {
            setError('Impossible d’actualiser l’utilisation disque.');
        } finally {
            setRefreshingDisk(false);
        }
    };

    const saveSettings = async () => {
        setSaving(true);
        setError(null);
        setFeedback(null);

        try {
            const response = await domainApi.updateServerStorage(server.uuid, form);
            onUpdated(response.data);
            setFeedback('Configuration enregistrée.');
        } catch {
            setError('Impossible d’enregistrer la configuration.');
        } finally {
            setSaving(false);
        }
    };

    const runCleanup = async (aggressive = false) => {
        setError(null);
        setFeedback(null);
        setConfirmCleanup(false);
        setConfirmAggressive(false);

        await cleanupTracker.startCleanup({
            delete_unused_volumes: aggressive ? true : form.delete_unused_volumes,
            delete_unused_networks: aggressive ? true : form.delete_unused_networks,
            force_docker_cleanup: aggressive ? true : form.force_docker_cleanup,
            disable_application_image_retention: aggressive ? true : form.disable_application_image_retention,
            aggressive,
        });

        if (aggressive) {
            setForm((current) => ({
                ...current,
                delete_unused_volumes: true,
                delete_unused_networks: true,
                force_docker_cleanup: true,
                disable_application_image_retention: true,
            }));
        }
    };

    const displayError = error ?? (cleanupTracker.phase === 'failed' ? cleanupTracker.error : null);
    const lastCleanupMessage = server.last_cleanup?.message ?? detail.last_cleanup?.message ?? null;
    const cleanupHadNoGain = cleanupFreedNoSpace(lastCleanupMessage);
    const diskCritical = diskUsage !== null && diskUsage >= form.server_disk_usage_notification_threshold;
    const hints = diskCritical ? criticalDiskHints(diskUsage) : [];

    return (
        <Card title={server.name}>
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0 flex-1 space-y-2">
                    <div class="flex flex-wrap items-center gap-2">
                        <StatusBadge label={diskUsageLabel(diskUsage)} tone={usageTone} />
                        {!server.status.functional && (
                            <StatusBadge label="Serveur indisponible" tone="error" />
                        )}
                        {!cleanupTracker.isTracking && server.last_cleanup && (
                            <StatusBadge
                                label={
                                    cleanupHadNoGain && diskCritical
                                        ? 'Nettoyage sans gain d’espace'
                                        : `Dernier nettoyage : ${server.last_cleanup.status}`
                                }
                                tone={
                                    cleanupHadNoGain && diskCritical
                                        ? 'warning'
                                        : server.last_cleanup.status === 'success'
                                            ? 'success'
                                            : server.last_cleanup.status === 'failed'
                                                ? 'error'
                                                : 'warning'
                                }
                            />
                        )}
                    </div>
                    {diskUsage !== null && (
                        <progress
                            class={`progress w-full max-w-md ${usageTone === 'error' ? 'progress-error' : usageTone === 'warning' ? 'progress-warning' : 'progress-success'}`}
                            max="100"
                            value={diskUsage}
                        />
                    )}
                    {server.description && (
                        <p class="text-xs text-base-content/55">{server.description}</p>
                    )}
                    {lastCleanupMessage && diskCritical && (
                        <p class="text-xs text-base-content/60">{lastCleanupMessage}</p>
                    )}
                </div>

                <div class="flex flex-wrap gap-2">
                    <button
                        class="btn btn-ghost btn-sm"
                        type="button"
                        disabled={refreshingDisk || cleanupTracker.isTracking || !server.status.functional}
                        onClick={() => void refreshDisk()}
                    >
                        <RefreshCw class={`size-3.5 ${refreshingDisk ? 'animate-spin' : ''}`} aria-hidden />
                        Actualiser
                    </button>
                    {canManage && (
                        <button
                            class="btn btn-warning btn-sm"
                            type="button"
                            disabled={cleanupTracker.isTracking || !server.status.functional}
                            onClick={() => setConfirmCleanup(true)}
                        >
                            <Trash2 class={`size-3.5 ${cleanupTracker.isTracking ? 'animate-pulse' : ''}`} aria-hidden />
                            {cleanupTracker.isTracking ? 'Nettoyage…' : 'Nettoyer'}
                        </button>
                    )}
                    {canManage && diskCritical && (
                        <button
                            class="btn btn-error btn-sm"
                            type="button"
                            disabled={cleanupTracker.isTracking || !server.status.functional}
                            onClick={() => setConfirmAggressive(true)}
                        >
                            <Trash2 class="size-3.5" aria-hidden />
                            Nettoyage agressif
                        </button>
                    )}
                    <button class="btn btn-ghost btn-sm" type="button" disabled={loadingDetail} onClick={() => void toggleExpanded()}>
                        {loadingDetail ? 'Chargement…' : expanded ? 'Réduire' : 'Configurer'}
                    </button>
                </div>
            </div>

            {diskCritical && hints.length > 0 && (
                <div class="mt-3 rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
                    <p class="font-medium">Disque critique — utilisez « Nettoyage agressif » pour appliquer volumes + suppression d’images immédiatement.</p>
                    <ul class="mt-2 list-disc space-y-1 ps-5 text-xs text-base-content/75">
                        {hints.map((hint) => <li key={hint}>{hint}</li>)}
                    </ul>
                </div>
            )}

            {cleanupTracker.isTracking && (
                <div class="mt-3">
                    <CleanupProgressPanel
                        execution={cleanupTracker.execution}
                        phase={cleanupTracker.phase}
                        phaseLabel={cleanupTracker.phaseLabel}
                    />
                </div>
            )}

            {feedback && !cleanupTracker.isTracking && <p class="mt-3 text-xs text-success">{feedback}</p>}
            {displayError && !cleanupTracker.isTracking && <p class="mt-3 text-xs text-error">{displayError}</p>}

            {expanded && (
                <div class="mt-4 grid gap-4 border-t border-base-300/70 pt-4">
                    <div class="grid gap-3 md:grid-cols-2">
                        <label class="form-control">
                            <span class="label-text text-xs font-medium">Fréquence nettoyage Docker (cron)</span>
                            <input
                                class="input input-bordered input-sm"
                                disabled={!canManage}
                                value={form.docker_cleanup_frequency}
                                onInput={(event) => setForm({ ...form, docker_cleanup_frequency: event.currentTarget.value })}
                            />
                        </label>
                        <label class="form-control">
                            <span class="label-text text-xs font-medium">Seuil nettoyage (%)</span>
                            <input
                                class="input input-bordered input-sm"
                                type="number"
                                min="1"
                                max="99"
                                disabled={!canManage || form.force_docker_cleanup}
                                value={form.docker_cleanup_threshold}
                                onInput={(event) => setForm({ ...form, docker_cleanup_threshold: Number(event.currentTarget.value) })}
                            />
                        </label>
                        <label class="form-control">
                            <span class="label-text text-xs font-medium">Alerte disque (%)</span>
                            <input
                                class="input input-bordered input-sm"
                                type="number"
                                min="1"
                                max="99"
                                disabled={!canManage}
                                value={form.server_disk_usage_notification_threshold}
                                onInput={(event) => setForm({ ...form, server_disk_usage_notification_threshold: Number(event.currentTarget.value) })}
                            />
                        </label>
                        <label class="form-control">
                            <span class="label-text text-xs font-medium">Fréquence surveillance disque (cron)</span>
                            <input
                                class="input input-bordered input-sm"
                                disabled={!canManage}
                                value={form.server_disk_usage_check_frequency}
                                onInput={(event) => setForm({ ...form, server_disk_usage_check_frequency: event.currentTarget.value })}
                            />
                        </label>
                    </div>

                    <div class="grid gap-2 sm:grid-cols-2">
                        <label class="label cursor-pointer justify-start gap-2">
                            <input
                                checked={form.force_docker_cleanup}
                                class="checkbox checkbox-sm"
                                disabled={!canManage}
                                type="checkbox"
                                onChange={(event) => setForm({ ...form, force_docker_cleanup: event.currentTarget.checked })}
                            />
                            <span class="label-text text-xs">Forcer le nettoyage à chaque exécution</span>
                        </label>
                        <label class="label cursor-pointer justify-start gap-2">
                            <input
                                checked={form.delete_unused_volumes}
                                class="checkbox checkbox-sm"
                                disabled={!canManage}
                                type="checkbox"
                                onChange={(event) => setForm({ ...form, delete_unused_volumes: event.currentTarget.checked })}
                            />
                            <span class="label-text text-xs">Supprimer les volumes inutilisés</span>
                        </label>
                        <label class="label cursor-pointer justify-start gap-2">
                            <input
                                checked={form.delete_unused_networks}
                                class="checkbox checkbox-sm"
                                disabled={!canManage}
                                type="checkbox"
                                onChange={(event) => setForm({ ...form, delete_unused_networks: event.currentTarget.checked })}
                            />
                            <span class="label-text text-xs">Supprimer les réseaux inutilisés</span>
                        </label>
                        <label class="label cursor-pointer justify-start gap-2">
                            <input
                                checked={form.disable_application_image_retention}
                                class="checkbox checkbox-sm"
                                disabled={!canManage}
                                type="checkbox"
                                onChange={(event) => setForm({ ...form, disable_application_image_retention: event.currentTarget.checked })}
                            />
                            <span class="label-text text-xs">Désactiver la rétention d’images</span>
                        </label>
                    </div>

                    {canManage && (
                        <button class="btn btn-primary btn-sm w-fit" type="button" disabled={saving} onClick={() => void saveSettings()}>
                            {saving ? 'Enregistrement…' : 'Enregistrer'}
                        </button>
                    )}

                    {detail.docker_disk_report && (
                        <div>
                            <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-base-content/45">Répartition Docker</p>
                            <pre class="custom-scrollbar max-h-48 overflow-auto rounded-lg border border-base-300/70 bg-base-200/40 p-3 text-[11px] leading-relaxed text-base-content/75">{detail.docker_disk_report}</pre>
                        </div>
                    )}

                    {detail.executions && detail.executions.length > 0 && (
                        <div>
                            <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-base-content/45">Historique récent</p>
                            <ul class="space-y-2">
                                {detail.executions.map((execution) => (
                                    <li class="rounded-lg border border-base-300/70 px-3 py-2 text-xs" key={execution.id}>
                                        <div class="flex flex-wrap items-center gap-2">
                                            <StatusBadge
                                                label={execution.status}
                                                tone={execution.status === 'success' ? 'success' : execution.status === 'failed' ? 'error' : 'warning'}
                                            />
                                            <span class="text-base-content/50">
                                                {execution.created_at ? new Date(execution.created_at).toLocaleString('fr-FR') : '—'}
                                            </span>
                                        </div>
                                        {execution.message && <p class="mt-1 text-base-content/70">{execution.message}</p>}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}

            <ConfirmDialog
                confirmLabel="Lancer le nettoyage"
                message="Applique les options cochées ci-dessous (enregistrées automatiquement pour ce nettoyage). Les volumes inutilisés ne sont supprimés que si la case est cochée."
                open={confirmCleanup}
                title="Nettoyer Docker sur ce serveur ?"
                tone="danger"
                loading={cleanupTracker.isTracking}
                onCancel={() => setConfirmCleanup(false)}
                onConfirm={() => void runCleanup(false)}
            />

            <ConfirmDialog
                confirmLabel="Lancer le nettoyage agressif"
                message="Active et applique immédiatement : volumes inutilisés, réseaux inutilisés, sans rétention d’images, nettoyage forcé. Peut supprimer des données de builds ou volumes orphelins — les conteneurs en cours d’exécution sont conservés."
                open={confirmAggressive}
                title="Nettoyage agressif sur ce serveur ?"
                tone="danger"
                loading={cleanupTracker.isTracking}
                onCancel={() => setConfirmAggressive(false)}
                onConfirm={() => void runCleanup(true)}
            />
        </Card>
    );
}
