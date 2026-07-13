import { Cloud, Plus, RefreshCw, Trash2, Wifi } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { domainApi, type S3Storage, type S3StorageInput } from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';
import { Card } from '../ui/Card';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { DataState } from '../ui/DataState';
import { Modal } from '../ui/Modal';
import { StatusBadge } from '../ui/StatusBadge';

const emptyForm = (): S3StorageInput => ({
    name: '',
    description: '',
    region: 'us-east-1',
    key: '',
    secret: '',
    bucket: '',
    endpoint: 'https://s3.amazonaws.com',
});

type S3StoragesSettingsProps = {
    canManage?: boolean;
};

export function S3StoragesSettings({ canManage = true }: S3StoragesSettingsProps) {
    const query = useApiQuery('s3-storages', () => domainApi.s3Storages());
    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<S3Storage | null>(null);
    const [form, setForm] = useState<S3StorageInput>(emptyForm());
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [testingUuid, setTestingUuid] = useState<string | null>(null);
    const [testMessage, setTestMessage] = useState<Record<string, string>>({});
    const [pendingDelete, setPendingDelete] = useState<S3Storage | null>(null);

    const storages = query.data?.data ?? [];

    const openCreate = () => {
        setEditing(null);
        setForm(emptyForm());
        setError(null);
        setModalOpen(true);
    };

    const openEdit = (storage: S3Storage) => {
        setEditing(storage);
        setForm({
            name: storage.name,
            description: storage.description ?? '',
            region: storage.region,
            key: '',
            secret: '',
            bucket: storage.bucket,
            endpoint: storage.endpoint,
        });
        setError(null);
        setModalOpen(true);
    };

    const submit = async () => {
        setSubmitting(true);
        setError(null);
        try {
            if (editing) {
                const payload: Partial<S3StorageInput> = {
                    name: form.name,
                    description: form.description,
                    region: form.region,
                    bucket: form.bucket,
                    endpoint: form.endpoint,
                };
                if (form.key) payload.key = form.key;
                if (form.secret) payload.secret = form.secret;
                await domainApi.updateS3Storage(editing.uuid, payload);
            } else {
                await domainApi.createS3Storage(form);
            }
            setModalOpen(false);
            await query.reload();
        } catch {
            setError('Échec de l’enregistrement de la destination S3.');
        } finally {
            setSubmitting(false);
        }
    };

    const testConnection = async (storage: S3Storage) => {
        setTestingUuid(storage.uuid);
        setTestMessage((current) => ({ ...current, [storage.uuid]: '' }));
        try {
            const result = await domainApi.testS3Storage(storage.uuid);
            setTestMessage((current) => ({
                ...current,
                [storage.uuid]: result.data.message,
            }));
            await query.reload();
        } catch (error) {
            setTestMessage((current) => ({
                ...current,
                [storage.uuid]: error instanceof Error ? error.message : 'Test échoué.',
            }));
        } finally {
            setTestingUuid(null);
        }
    };

    const deleteStorage = async () => {
        if (!pendingDelete) return;
        setSubmitting(true);
        try {
            await domainApi.deleteS3Storage(pendingDelete.uuid);
            setPendingDelete(null);
            await query.reload();
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <>
            <Card title="Destinations S3" eyebrow="Sauvegardes">
                <div class="mb-3 flex justify-end">
                    {canManage && (
                        <button class="btn btn-primary btn-sm" type="button" onClick={openCreate}>
                            <Plus class="size-3.5" aria-hidden />
                            Ajouter
                        </button>
                    )}
                </div>
                <DataState loading={query.loading} error={query.error} onRetry={() => void query.reload()}>
                    {storages.length === 0 ? (
                        <p class="text-sm text-base-content/60">
                            Aucune destination S3 configurée. Ajoutez un bucket compatible S3 pour y envoyer les sauvegardes.
                        </p>
                    ) : (
                        <ul class="divide-y divide-base-300/70">
                            {storages.map((storage) => (
                                <li class="flex flex-wrap items-center justify-between gap-3 py-3" key={storage.uuid}>
                                    <div class="min-w-0">
                                        <div class="flex items-center gap-2">
                                            <Cloud class="size-4 text-primary" aria-hidden />
                                            <p class="truncate text-sm font-semibold">{storage.name}</p>
                                            <StatusBadge
                                                label={storage.is_usable ? 'Connecté' : 'Non testé'}
                                                tone={storage.is_usable ? 'success' : 'neutral'}
                                            />
                                        </div>
                                        <p class="mt-1 truncate font-mono text-[11px] text-base-content/45">
                                            {storage.endpoint}/{storage.bucket}
                                        </p>
                                        {testMessage[storage.uuid] && (
                                            <p class="mt-1 text-xs text-base-content/55">{testMessage[storage.uuid]}</p>
                                        )}
                                    </div>
                                    {canManage && (
                                        <div class="flex flex-wrap gap-2">
                                            <button
                                                class="btn btn-ghost btn-sm"
                                                type="button"
                                                disabled={testingUuid === storage.uuid}
                                                onClick={() => void testConnection(storage)}
                                            >
                                                <Wifi class="size-3.5" aria-hidden />
                                                {testingUuid === storage.uuid ? 'Test…' : 'Tester'}
                                            </button>
                                            <button class="btn btn-ghost btn-sm" type="button" onClick={() => openEdit(storage)}>
                                                Modifier
                                            </button>
                                            <button
                                                class="btn btn-ghost btn-sm text-error"
                                                type="button"
                                                onClick={() => setPendingDelete(storage)}
                                            >
                                                <Trash2 class="size-3.5" aria-hidden />
                                            </button>
                                        </div>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                    <button class="btn btn-ghost btn-sm mt-3" type="button" onClick={() => void query.reload()}>
                        <RefreshCw class="size-3.5" aria-hidden />
                        Actualiser
                    </button>
                </DataState>
            </Card>

            <Modal
                open={modalOpen}
                title={editing ? 'Modifier la destination S3' : 'Nouvelle destination S3'}
                onClose={() => setModalOpen(false)}
            >
                <form
                    class="grid gap-3"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void submit();
                    }}
                >
                    <label class="grid gap-1 text-sm">
                        <span class="font-medium">Nom</span>
                        <input class="input input-bordered rounded-xl" required value={form.name} onInput={(e) => setForm({ ...form, name: e.currentTarget.value })} />
                    </label>
                    <label class="grid gap-1 text-sm">
                        <span class="font-medium">Description</span>
                        <input class="input input-bordered rounded-xl" value={form.description ?? ''} onInput={(e) => setForm({ ...form, description: e.currentTarget.value })} />
                    </label>
                    <div class="grid gap-3 sm:grid-cols-2">
                        <label class="grid gap-1 text-sm">
                            <span class="font-medium">Région</span>
                            <input class="input input-bordered rounded-xl" required value={form.region} onInput={(e) => setForm({ ...form, region: e.currentTarget.value })} />
                        </label>
                        <label class="grid gap-1 text-sm">
                            <span class="font-medium">Bucket</span>
                            <input class="input input-bordered rounded-xl" required value={form.bucket} onInput={(e) => setForm({ ...form, bucket: e.currentTarget.value })} />
                        </label>
                    </div>
                    <label class="grid gap-1 text-sm">
                        <span class="font-medium">Endpoint</span>
                        <input class="input input-bordered rounded-xl font-mono text-xs" required value={form.endpoint} onInput={(e) => setForm({ ...form, endpoint: e.currentTarget.value })} />
                    </label>
                    <div class="grid gap-3 sm:grid-cols-2">
                        <label class="grid gap-1 text-sm">
                            <span class="font-medium">Access Key</span>
                            <input class="input input-bordered rounded-xl font-mono text-xs" required={!editing} value={form.key} onInput={(e) => setForm({ ...form, key: e.currentTarget.value })} />
                        </label>
                        <label class="grid gap-1 text-sm">
                            <span class="font-medium">Secret Key</span>
                            <input class="input input-bordered rounded-xl font-mono text-xs" type="password" required={!editing} value={form.secret} onInput={(e) => setForm({ ...form, secret: e.currentTarget.value })} />
                        </label>
                    </div>
                    {editing && (
                        <p class="text-xs text-base-content/50">Laissez les clés vides pour conserver les valeurs actuelles.</p>
                    )}
                    {error && <p class="text-xs text-error" role="alert">{error}</p>}
                    <div class="flex justify-end gap-2">
                        <button class="btn btn-ghost" type="button" onClick={() => setModalOpen(false)}>Annuler</button>
                        <button class="btn btn-primary" type="submit" disabled={submitting}>
                            {submitting ? 'Enregistrement…' : 'Enregistrer'}
                        </button>
                    </div>
                </form>
            </Modal>

            {pendingDelete && (
                <ConfirmDialog
                    open
                    title="Supprimer la destination S3"
                    message={`Supprimer « ${pendingDelete.name} » ? Les sauvegardes associées ne seront plus envoyées vers S3.`}
                    tone="danger"
                    loading={submitting}
                    onCancel={() => setPendingDelete(null)}
                    onConfirm={() => void deleteStorage()}
                />
            )}
        </>
    );
}
