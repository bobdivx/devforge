import { HardDrive, LoaderCircle, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ActionToolbar } from '../ui/ActionToolbar';
import { DataState } from '../ui/DataState';
import { StatusBadge } from '../ui/StatusBadge';
import { Table } from '../ui/Table';
import {
    domainApi,
    type ApplicationStorage,
    type ApplicationStorageInput,
    type ApplicationStorageUpdateInput,
} from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';

type StorageResourceType = 'applications' | 'databases';

type Props = {
    resourceType?: StorageResourceType;
    resourceUuid?: string;
    canAct: boolean;
};

type FormState = {
    type: 'persistent' | 'file';
    name: string;
    mount_path: string;
    host_path: string;
    content: string;
    is_directory: boolean;
    fs_path: string;
    is_preview_suffix_enabled: boolean;
};

const emptyForm = (): FormState => ({
    type: 'persistent',
    name: '',
    mount_path: '',
    host_path: '',
    content: '',
    is_directory: false,
    fs_path: '',
    is_preview_suffix_enabled: true,
});

function typeLabel(storage: ApplicationStorage): string {
    if (storage.type === 'persistent') {
        return 'Volume';
    }

    return storage.is_directory ? 'Répertoire' : 'Fichier';
}

function shortPersistentName(name: string | null | undefined, applicationUuid: string): string {
    if (!name) {
        return '—';
    }

    const prefix = `${applicationUuid}-`;

    return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

export function ApplicationStoragePanel({
    resourceType = 'applications',
    resourceUuid = '',
    canAct,
}: Props) {
    const uuid = resourceUuid;
    const resourceLabel = resourceType === 'databases' ? 'cette base de données' : 'cette application';

    const query = useApiQuery(
        `resource-storages:${resourceType}:${uuid}`,
        () => domainApi.resourceStorages(resourceType, uuid),
    );
    const payload = query.data?.data;
    const storages = payload?.storages ?? [];
    const composeManaged = payload?.compose_managed ?? false;
    const isSwarm = payload?.is_swarm ?? false;

    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState<ApplicationStorage | null>(null);
    const [form, setForm] = useState<FormState>(emptyForm());
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const [pendingDelete, setPendingDelete] = useState<ApplicationStorage | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    const openCreate = () => {
        setEditing(null);
        setForm(emptyForm());
        setFormError(null);
        setFormOpen(true);
    };

    const openEdit = (storage: ApplicationStorage) => {
        setEditing(storage);
        setForm({
            type: storage.type,
            name: storage.type === 'persistent'
                ? shortPersistentName(storage.name, uuid)
                : '',
            mount_path: storage.mount_path,
            host_path: storage.host_path ?? '',
            content: '',
            is_directory: Boolean(storage.is_directory),
            fs_path: storage.fs_path ?? '',
            is_preview_suffix_enabled: storage.is_preview_suffix_enabled,
        });
        setFormError(null);
        setFormOpen(true);
    };

    const closeForm = () => {
        setFormOpen(false);
        setEditing(null);
        setFormError(null);
    };

    const submitForm = async () => {
        if (!form.mount_path.trim()) {
            setFormError('Le chemin de montage est obligatoire.');

            return;
        }

        if (!editing && form.type === 'persistent' && !form.name.trim()) {
            setFormError('Le nom du volume est obligatoire.');

            return;
        }

        if (!editing && form.type === 'file' && form.is_directory && !form.fs_path.trim()) {
            setFormError('Le chemin hôte est obligatoire pour un répertoire.');

            return;
        }

        setSubmitting(true);
        setFormError(null);
        setMessage(null);

        try {
            if (editing) {
                const payload: ApplicationStorageUpdateInput = {
                    is_preview_suffix_enabled: form.is_preview_suffix_enabled,
                };

                if (!editing.read_only) {
                    payload.mount_path = form.mount_path.trim();
                    if (editing.type === 'persistent') {
                        if (form.name.trim()) {
                            payload.name = form.name.trim();
                        }
                        payload.host_path = form.host_path.trim() || null;
                    } else if (!editing.is_directory && form.content.trim() !== '') {
                        payload.content = form.content;
                    }
                }

                await domainApi.updateResourceStorage(resourceType, uuid, editing.uuid, payload);
                setMessage('Storage mis à jour.');
            } else {
                const payload: ApplicationStorageInput = {
                    type: form.type,
                    mount_path: form.mount_path.trim(),
                };

                if (form.type === 'persistent') {
                    payload.name = form.name.trim();
                    if (form.host_path.trim()) {
                        payload.host_path = form.host_path.trim();
                    }
                } else if (form.is_directory) {
                    payload.is_directory = true;
                    payload.fs_path = form.fs_path.trim();
                } else if (form.content.trim() !== '') {
                    payload.content = form.content;
                }

                await domainApi.createResourceStorage(resourceType, uuid, payload);
                setMessage('Storage créé.');
            }

            closeForm();
            await query.reload();
        } catch (error) {
            setFormError(error instanceof Error ? error.message : 'L’opération a échoué.');
        } finally {
            setSubmitting(false);
        }
    };

    const deleteStorage = async () => {
        if (!pendingDelete) {
            return;
        }

        setDeleting(true);
        setMessage(null);

        try {
            await domainApi.deleteResourceStorage(resourceType, uuid, pendingDelete.uuid);
            setPendingDelete(null);
            setMessage('Storage supprimé.');
            await query.reload();
        } finally {
            setDeleting(false);
        }
    };

    return (
        <section class="rounded-2xl border border-base-300/70 bg-base-100 shadow-sm">
            <div class="toolbar-row border-b border-base-300/70 px-3 sm:px-3 sm:px-4 md:px-5 py-3 sm:py-3 sm:py-4">
                <div>
                    <p class="text-xs sm:text-sm font-semibold">Storages</p>
                    <p class="text-xs text-base-content/50">
                        Volumes persistants et montages fichiers pour {resourceLabel}
                    </p>
                </div>
                <ActionToolbar>
                    <button class="btn btn-ghost btn-sm" type="button" onClick={() => void query.reload()}>
                        <RefreshCw class="size-3.5" aria-hidden />
                        Actualiser
                    </button>
                    {canAct && !composeManaged && (
                        <button class="btn btn-primary btn-sm" type="button" onClick={openCreate}>
                            <Plus class="size-3.5" aria-hidden />
                            Ajouter
                        </button>
                    )}
                </ActionToolbar>
            </div>

            <div class="grid gap-2.5 sm:gap-3 md:gap-2.5 sm:gap-3 md:gap-4 p-5">
                {message && (
                    <p class="rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
                        {message}
                    </p>
                )}

                {composeManaged && (
                    <p class="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
                        Application docker-compose : les volumes sont définis dans le compose (lecture seule).
                    </p>
                )}

                <DataState
                    loading={query.loading}
                    error={query.error}
                    empty={!query.loading && !query.error && storages.length === 0}
                    emptyMessage={`Aucun storage configuré pour ${resourceLabel}.`}
                    onRetry={() => void query.reload()}
                >
                    <Table
                        embedded
                        headers={['Type', 'Source', 'Montage', 'Options', ...(canAct ? [''] : [])]}
                        caption="Storages application"
                    >
                        {storages.map((storage) => (
                            <tr key={storage.uuid}>
                                <td>
                                    <div class="flex items-center gap-2">
                                        <HardDrive class="size-3.5 text-base-content/45" aria-hidden />
                                        <span class="text-xs sm:text-sm font-medium">{typeLabel(storage)}</span>
                                    </div>
                                </td>
                                <td class="max-w-[14rem] truncate font-mono text-xs">
                                    {storage.type === 'persistent'
                                        ? shortPersistentName(storage.name, uuid)
                                        : (storage.fs_path ?? '—')}
                                </td>
                                <td class="max-w-[12rem] truncate font-mono text-xs">{storage.mount_path}</td>
                                <td>
                                    <div class="flex flex-wrap gap-1">
                                        {storage.read_only && <StatusBadge label="Lecture seule" tone="warning" />}
                                        {storage.is_preview_suffix_enabled && (
                                            <StatusBadge label="Suffixe preview" tone="neutral" />
                                        )}
                                    </div>
                                </td>
                                {canAct && (
                                    <td class="text-end">
                                        <ActionToolbar>
                                            <button
                                                class="btn btn-ghost btn-xs btn-square"
                                                type="button"
                                                aria-label="Modifier"
                                                title="Modifier"
                                                onClick={() => openEdit(storage)}
                                            >
                                                <Pencil class="size-3.5" aria-hidden />
                                            </button>
                                            {!storage.read_only && (
                                                <button
                                                    class="btn btn-ghost btn-xs btn-square text-error"
                                                    type="button"
                                                    aria-label="Supprimer"
                                                    title="Supprimer"
                                                    onClick={() => setPendingDelete(storage)}
                                                >
                                                    <Trash2 class="size-3.5" aria-hidden />
                                                </button>
                                            )}
                                        </ActionToolbar>
                                    </td>
                                )}
                            </tr>
                        ))}
                    </Table>
                </DataState>
            </div>

            {formOpen && (
                <div class="fixed inset-0 z-50 grid place-items-center bg-base-300/50 p-4 backdrop-blur-sm">
                    <div class="w-full max-w-lg rounded-2xl border border-base-300/70 bg-base-100 p-5 shadow-xl">
                        <h3 class="text-sm sm:text-base font-semibold">
                            {editing ? 'Modifier le storage' : 'Nouveau storage'}
                        </h3>

                        <form
                            class="mt-4 grid gap-3"
                            onSubmit={(event) => {
                                event.preventDefault();
                                void submitForm();
                            }}
                        >
                            {!editing && (
                                <label class="grid gap-1 text-sm">
                                    <span class="text-xs font-medium text-base-content/60">Type</span>
                                    <select
                                        class="select select-bordered select-sm"
                                        value={form.type}
                                        onChange={(event) => setForm((current) => ({
                                            ...current,
                                            type: (event.target as HTMLSelectElement).value as FormState['type'],
                                        }))}
                                    >
                                        <option value="persistent">Volume persistant</option>
                                        <option value="file">Fichier / répertoire</option>
                                    </select>
                                </label>
                            )}

                            {(!editing || !editing.read_only) && form.type === 'persistent' && (
                                <>
                                    <label class="grid gap-1 text-sm">
                                        <span class="text-xs font-medium text-base-content/60">Nom</span>
                                        <input
                                            class="input input-bordered input-sm font-mono"
                                            value={form.name}
                                            required={!editing}
                                            onInput={(event) => setForm((current) => ({
                                                ...current,
                                                name: (event.target as HTMLInputElement).value,
                                            }))}
                                        />
                                    </label>
                                    <label class="grid gap-1 text-sm">
                                        <span class="text-xs font-medium text-base-content/60">
                                            Chemin hôte {isSwarm ? '(obligatoire Swarm)' : '(optionnel)'}
                                        </span>
                                        <input
                                            class="input input-bordered input-sm font-mono"
                                            value={form.host_path}
                                            required={isSwarm && !editing}
                                            onInput={(event) => setForm((current) => ({
                                                ...current,
                                                host_path: (event.target as HTMLInputElement).value,
                                            }))}
                                        />
                                    </label>
                                </>
                            )}

                            {(!editing || !editing.read_only) && (
                                <label class="grid gap-1 text-sm">
                                    <span class="text-xs font-medium text-base-content/60">Chemin de montage</span>
                                    <input
                                        class="input input-bordered input-sm font-mono"
                                        value={form.mount_path}
                                        required
                                        onInput={(event) => setForm((current) => ({
                                            ...current,
                                            mount_path: (event.target as HTMLInputElement).value,
                                        }))}
                                    />
                                </label>
                            )}

                            {!editing && form.type === 'file' && (
                                <>
                                    <label class="flex items-center gap-2 text-xs">
                                        <input
                                            class="checkbox checkbox-xs"
                                            type="checkbox"
                                            checked={form.is_directory}
                                            onChange={(event) => setForm((current) => ({
                                                ...current,
                                                is_directory: (event.target as HTMLInputElement).checked,
                                            }))}
                                        />
                                        Montage de répertoire
                                    </label>
                                    {form.is_directory ? (
                                        <label class="grid gap-1 text-sm">
                                            <span class="text-xs font-medium text-base-content/60">Chemin hôte</span>
                                            <input
                                                class="input input-bordered input-sm font-mono"
                                                value={form.fs_path}
                                                required
                                                onInput={(event) => setForm((current) => ({
                                                    ...current,
                                                    fs_path: (event.target as HTMLInputElement).value,
                                                }))}
                                            />
                                        </label>
                                    ) : (
                                        <label class="grid gap-1 text-sm">
                                            <span class="text-xs font-medium text-base-content/60">Contenu (optionnel)</span>
                                            <textarea
                                                class="textarea textarea-bordered textarea-sm font-mono"
                                                rows={4}
                                                value={form.content}
                                                onInput={(event) => setForm((current) => ({
                                                    ...current,
                                                    content: (event.target as HTMLTextAreaElement).value,
                                                }))}
                                            />
                                        </label>
                                    )}
                                </>
                            )}

                            {editing && editing.type === 'file' && !editing.is_directory && !editing.read_only && (
                                <label class="grid gap-1 text-sm">
                                    <span class="text-xs font-medium text-base-content/60">
                                        Contenu (laisser vide pour conserver)
                                    </span>
                                    <textarea
                                        class="textarea textarea-bordered textarea-sm font-mono"
                                        rows={4}
                                        value={form.content}
                                        onInput={(event) => setForm((current) => ({
                                            ...current,
                                            content: (event.target as HTMLTextAreaElement).value,
                                        }))}
                                    />
                                </label>
                            )}

                            <label class="flex items-center gap-2 text-xs">
                                <input
                                    class="checkbox checkbox-xs"
                                    type="checkbox"
                                    checked={form.is_preview_suffix_enabled}
                                    onChange={(event) => setForm((current) => ({
                                        ...current,
                                        is_preview_suffix_enabled: (event.target as HTMLInputElement).checked,
                                    }))}
                                />
                                Suffixe preview (-pr-N)
                            </label>

                            {formError && <p class="text-sm text-error" role="alert">{formError}</p>}

                            <div class="form-actions pt-2">
                                <button class="btn btn-ghost btn-sm" type="button" onClick={closeForm} disabled={submitting}>
                                    Annuler
                                </button>
                                <button class="btn btn-primary btn-sm" type="submit" disabled={submitting}>
                                    {submitting
                                        ? <LoaderCircle class="size-3.5 animate-spin" aria-hidden />
                                        : (editing ? 'Enregistrer' : 'Créer')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {pendingDelete && (
                <ConfirmDialog
                    open
                    title="Supprimer le storage"
                    message={`Confirmer la suppression du montage « ${pendingDelete.mount_path} » ?`}
                    tone="danger"
                    loading={deleting}
                    onCancel={() => setPendingDelete(null)}
                    onConfirm={() => void deleteStorage()}
                />
            )}
        </section>
    );
}
