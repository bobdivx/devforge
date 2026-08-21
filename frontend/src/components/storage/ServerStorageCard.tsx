import { useEffect, useState } from 'preact/hooks';
import { CronInput } from '../ui/CronInput';
import { RefreshCw, Trash2 } from 'lucide-preact';
import { Card } from '../ui/Card';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ProgressBar } from '../ui/ProgressBar';
import { StatusBadge } from '../ui/StatusBadge';
import {
    domainApi,
    type ServerStorageCleanupSettings,
    type ServerStorageMonitoringSettings,
    type ServerStorageSummary,
} from '../../lib/domain-api';
import { diskUsageLabel, diskUsageTone, workloadDiskLabel } from '../../lib/disk-usage';
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
    const [diskPartitions, setDiskPartitions] = useState(server.disk_partitions ?? null);
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
    const [diskBreakdown, setDiskBreakdown] = useState<string | null>(null);
    const [loadingBreakdown, setLoadingBreakdown] = useState(false);
    const [breakdownError, setBreakdownError] = useState<string | null>(null);

    const cleanupTracker = useServerCleanupTracker(server.uuid, {
        onComplete: (updated) => {
            if (updated) {
                setDiskUsage(updated.disk_usage_percent);
                setDiskPartitions(updated.disk_partitions ?? null);
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
        setDiskPartitions(server.disk_partitions ?? null);
        setForm(toFormState(server));
        setDetail(server);
    }, [server.uuid, server.disk_usage_percent, server.disk_partitions, server.cleanup, server.monitoring, server.last_cleanup]);

    const toggleExpanded = async () => {
        if (expanded) {
            setExpanded(false);
            return;
        }

        setLoadingDetail(true);
        setError(null);

        try {
            const response = await domainApi.serverStorage(server.uuid, false, true);
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
            setDiskPartitions(response.data.disk_partitions ?? null);
            onUpdated({
                ...server,
                disk_usage_percent: response.data.disk_usage_percent,
                disk_partitions: response.data.disk_partitions ?? null,
            });
        } catch {
            setError('Impossible d’actualiser l’utilisation disque.');
        } finally {
            setRefreshingDisk(false);
        }
    };

    const runDiskBreakdown = async () => {
        setLoadingBreakdown(true);
        setBreakdownError(null);
        setDiskBreakdown(null);

        try {
            const response = await domainApi.serverStorageDiskBreakdown(server.uuid);
            const report = response.data.report?.trim() ?? '';

            if (report === '') {
                setBreakdownError('Diagnostic vide — le serveur n’a pas renvoyé de données.');
            } else {
                setDiskBreakdown(report);
            }
        } catch {
            setBreakdownError('Impossible d’analyser l’espace disque (timeout ou serveur indisponible).');
        } finally {
            setLoadingBreakdown(false);
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
    const workloadLabel = workloadDiskLabel(diskPartitions);
    const rootInodeCritical = (diskPartitions?.['/'] ?? 0) >= 95;
    const lastCleanupMessage = server.last_cleanup?.message ?? detail.last_cleanup?.message ?? null;
    const cleanupHadNoGain = cleanupFreedNoSpace(lastCleanupMessage);
    const diskCritical = diskUsage !== null && diskUsage >= form.server_disk_usage_notification_threshold;
    const hints = diskCritical ? criticalDiskHints(diskUsage) : [];

    return (
        <Card title={server.name}>
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0 flex-1 space-y-3">
                    <div class="flex flex-wrap items-center gap-2">
                        <StatusBadge label={diskUsageLabel(diskUsage, workloadLabel)} tone={usageTone} />
                        {rootInodeCritical && workloadLabel === '/media/Docker' && (
                            <StatusBadge label="Partition racine (inodes) saturée — Docker sur autre partition" tone="warning" />
                        )}
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
                        <ProgressBar
                            value={diskUsage}
                            label={workloadLabel ? `Utilisation ${workloadLabel}` : 'Utilisation disque'}
                            tone={usageTone === 'neutral' ? 'primary' : usageTone}
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
                    {diskCritical && (
                        <button
                            class="btn btn-outline btn-sm"
                            type="button"
                            disabled={loadingBreakdown || !server.status.functional}
                            onClick={() => void runDiskBreakdown()}
                        >
                            {loadingBreakdown ? 'Analyse…' : 'Diagnostiquer l’espace'}
                        </button>
                    )}
                    <button class="btn btn-ghost btn-sm" type="button" disabled={loadingDetail} onClick={() => void toggleExpanded()}>
                        {loadingDetail ? 'Chargement…' : expanded ? 'Réduire' : 'Configurer'}
                    </button>
                </div>
            </div>

            {diskCritical && hints.length > 0 && (
                <div class="mt-3 rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
                    <p class="font-medium">
                        {cleanupHadNoGain
                            ? 'Nettoyage Docker terminé sans libérer d’espace — l’occupation est probablement hors Docker.'
                            : 'Disque critique — utilisez « Nettoyage agressif » ou « Diagnostiquer l’espace ».'}
                    </p>
                    <ul class="mt-2 list-disc space-y-1 ps-5 text-xs text-base-content/75">
                        {hints.map((hint) => <li key={hint}>{hint}</li>)}
                    </ul>
                </div>
            )}

            {diskBreakdown && (
                <div class="mt-3">
                    <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-base-content/45">Diagnostic disque hôte</p>
                    <pre class="custom-scrollbar max-h-64 overflow-auto rounded-lg border border-base-300/70 bg-base-200/40 p-3 text-[11px] leading-relaxed text-base-content/75">{diskBreakdown}</pre>
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

            {breakdownError && (
                <p class="mt-3 text-xs text-error">{breakdownError}</p>
            )}

            {feedback && !cleanupTracker.isTracking && <p class="mt-3 text-xs text-success">{feedback}</p>}
            {displayError && !cleanupTracker.isTracking && <p class="mt-3 text-xs text-error">{displayError}</p>}

            {expanded && (
                <div class="mt-4 grid gap-4 border-t border-base-300/70 pt-4">
                    <div class="grid gap-3 md:grid-cols-2">
                        <CronInput
                            id={`docker-cleanup-${server.uuid}`}
                            label="Fréquence nettoyage Docker"
                            value={form.docker_cleanup_frequency}
                            onChange={(val) => setForm({ ...form, docker_cleanup_frequency: val })}
                        />
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
                        <CronInput
                            id={`disk-check-${server.uuid}`}
                            label="Fréquence surveillance disque"
                            value={form.server_disk_usage_check_frequency}
                            onChange={(val) => setForm({ ...form, server_disk_usage_check_frequency: val })}
                        />
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
