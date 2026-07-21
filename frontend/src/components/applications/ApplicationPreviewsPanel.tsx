import { ExternalLink, RefreshCw, Save, Trash2 } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ActionToolbar } from '../ui/ActionToolbar';
import { DataState } from '../ui/DataState';
import { StatusBadge } from '../ui/StatusBadge';
import { Table } from '../ui/Table';
import { visitUrl } from '../../lib/application-config';
import {
    domainApi,
    type ApplicationPreview,
    type ApplicationPreviewSettings,
} from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';

type Props = {
    applicationUuid: string;
    canAct: boolean;
};

function previewTone(preview: ApplicationPreview): 'success' | 'warning' | 'error' | 'neutral' {
    if (preview.is_running) {
        return 'success';
    }

    const status = (preview.status ?? '').toLowerCase();
    if (status.includes('exited') || status.includes('stopped') || status.includes('dead')) {
        return 'error';
    }
    if (status.includes('starting') || status.includes('restarting')) {
        return 'warning';
    }

    return 'neutral';
}

export function ApplicationPreviewsPanel({ applicationUuid, canAct }: Props) {
    const previewsQuery = useApiQuery(
        `application-previews:${applicationUuid}`,
        () => domainApi.applicationPreviews(applicationUuid),
    );
    const settingsQuery = useApiQuery(
        `application-preview-settings:${applicationUuid}`,
        () => domainApi.applicationPreviewSettings(applicationUuid),
    );

    const previews = previewsQuery.data?.data ?? [];
    const settings = settingsQuery.data?.data as ApplicationPreviewSettings | undefined;

    const [enabled, setEnabled] = useState(false);
    const [template, setTemplate] = useState('{{pr_id}}.{{domain}}');
    const [saving, setSaving] = useState(false);
    const [settingsError, setSettingsError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [pendingDelete, setPendingDelete] = useState<ApplicationPreview | null>(null);
    const [deleting, setDeleting] = useState(false);

    useEffect(() => {
        if (!settings) {
            return;
        }

        setEnabled(settings.is_preview_deployments_enabled);
        setTemplate(settings.preview_url_template || '{{pr_id}}.{{domain}}');
        setSettingsError(null);
    }, [settings]);

    const reloadAll = async () => {
        await Promise.all([previewsQuery.reload(), settingsQuery.reload()]);
    };

    const saveSettings = async () => {
        if (!canAct) {
            return;
        }

        setSaving(true);
        setSettingsError(null);
        setMessage(null);

        try {
            await domainApi.updateApplicationPreviewSettings(applicationUuid, {
                is_preview_deployments_enabled: enabled,
                preview_url_template: template.trim(),
            });
            setMessage('Paramètres preview enregistrés.');
            await settingsQuery.reload();
        } catch (error) {
            setSettingsError(error instanceof Error ? error.message : 'Échec de l’enregistrement.');
        } finally {
            setSaving(false);
        }
    };

    const deletePreview = async () => {
        if (!pendingDelete) {
            return;
        }

        setDeleting(true);
        setMessage(null);

        try {
            const response = await domainApi.deleteApplicationPreview(
                applicationUuid,
                pendingDelete.pull_request_id,
            );
            setPendingDelete(null);
            setMessage(response.message);
            await previewsQuery.reload();
        } finally {
            setDeleting(false);
        }
    };

    const loading = previewsQuery.loading || settingsQuery.loading;
    const error = previewsQuery.error || settingsQuery.error;

    return (
        <section class="rounded-2xl border border-base-300/70 bg-base-100 shadow-sm">
            <div class="toolbar-row border-b border-base-300/70 px-5 py-4">
                <div>
                    <p class="text-sm font-semibold">Previews</p>
                    <p class="text-xs text-base-content/50">
                        Déploiements PR créés via webhooks Git — gestion native DevForge
                    </p>
                </div>
                <ActionToolbar>
                    <button class="btn btn-ghost btn-sm" type="button" onClick={() => void reloadAll()}>
                        <RefreshCw class="size-3.5" aria-hidden />
                        Actualiser
                    </button>
                </ActionToolbar>
            </div>

            <div class="grid gap-5 p-5">
                {message && (
                    <p class="rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
                        {message}
                    </p>
                )}

                <div class="grid gap-3 rounded-xl border border-base-300/60 bg-base-200/30 p-4">
                    <div>
                        <p class="text-sm font-medium">Paramètres</p>
                        <p class="text-xs text-base-content/50">
                            Placeholders : {'{{pr_id}}'}, {'{{domain}}'}, {'{{random}}'}
                        </p>
                    </div>

                    <label class="flex items-center gap-3 text-sm">
                        <input
                            class="toggle toggle-sm"
                            type="checkbox"
                            checked={enabled}
                            disabled={!canAct || saving || !settings}
                            onChange={(event) => setEnabled(event.currentTarget.checked)}
                        />
                        <span>Activer les déploiements preview (PR)</span>
                    </label>

                    <label class="grid gap-1.5 text-sm">
                        <span class="font-medium text-base-content/80">Modèle d’URL</span>
                        <input
                            class="input input-bordered w-full font-mono text-xs"
                            value={template}
                            disabled={!canAct || saving || !settings}
                            onInput={(event) => setTemplate(event.currentTarget.value)}
                        />
                    </label>

                    {settingsError && (
                        <p class="text-sm text-error">{settingsError}</p>
                    )}

                    {canAct && (
                        <div>
                            <button
                                class="btn btn-primary btn-sm"
                                type="button"
                                disabled={saving || !settings || !template.trim()}
                                onClick={() => void saveSettings()}
                            >
                                <Save class="size-3.5" aria-hidden />
                                {saving ? 'Enregistrement…' : 'Enregistrer'}
                            </button>
                        </div>
                    )}
                </div>

                <DataState
                    loading={loading}
                    error={error}
                    empty={!loading && !error && previews.length === 0}
                    emptyMessage={
                        enabled
                            ? 'Aucun preview. Les prochaines pull requests en créeront via webhook.'
                            : 'Aucun preview. Activez les déploiements preview pour autoriser les PR.'
                    }
                    onRetry={() => void reloadAll()}
                >
                    <Table
                        embedded
                        headers={['PR', 'Statut', 'URL', ...(canAct ? [''] : [])]}
                        caption="Previews pull request"
                    >
                        {previews.map((preview) => {
                            const url = visitUrl(preview.fqdn);

                            return (
                                <tr key={preview.uuid}>
                                    <td>
                                        <div class="grid gap-0.5">
                                            <span class="font-medium">#{preview.pull_request_id}</span>
                                            {preview.docker_registry_image_tag && (
                                                <span class="font-mono text-xs text-base-content/45">
                                                    {preview.docker_registry_image_tag}
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td>
                                        <StatusBadge
                                            tone={previewTone(preview)}
                                            label={preview.status ?? (preview.is_running ? 'running' : 'inconnu')}
                                        />
                                    </td>
                                    <td>
                                        <div class="flex flex-wrap items-center gap-2">
                                            {url ? (
                                                <a
                                                    class="link link-hover inline-flex items-center gap-1 text-sm"
                                                    href={url}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                >
                                                    <ExternalLink class="size-3.5" aria-hidden />
                                                    Ouvrir
                                                </a>
                                            ) : (
                                                <span class="text-xs text-base-content/40">Pas d’URL</span>
                                            )}
                                            {preview.pull_request_html_url && (
                                                <a
                                                    class="link link-hover text-sm"
                                                    href={preview.pull_request_html_url}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                >
                                                    PR
                                                </a>
                                            )}
                                        </div>
                                    </td>
                                    {canAct && (
                                        <td class="text-right">
                                            <button
                                                class="btn btn-ghost btn-sm text-error"
                                                type="button"
                                                onClick={() => setPendingDelete(preview)}
                                            >
                                                <Trash2 class="size-3.5" aria-hidden />
                                                Supprimer
                                            </button>
                                        </td>
                                    )}
                                </tr>
                            );
                        })}
                    </Table>
                </DataState>
            </div>

            {pendingDelete && (
                <ConfirmDialog
                    open
                    title="Supprimer le preview"
                    message={`Le preview de la PR #${pendingDelete.pull_request_id} sera arrêté et nettoyé.`}
                    confirmLabel="Supprimer"
                    tone="danger"
                    loading={deleting}
                    onCancel={() => {
                        if (!deleting) {
                            setPendingDelete(null);
                        }
                    }}
                    onConfirm={() => void deletePreview()}
                />
            )}
        </section>
    );
}
