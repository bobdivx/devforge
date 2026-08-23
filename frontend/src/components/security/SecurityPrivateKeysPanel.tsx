import { LoaderCircle, Plus, RefreshCw, Trash2 } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Card } from '../ui/Card';
import { DataState } from '../ui/DataState';
import { StatusBadge } from '../ui/StatusBadge';
import { domainApi, type SecurityKey } from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';

type Draft = {
    name: string;
    description: string;
    private_key: string;
};

const emptyDraft = (): Draft => ({
    name: '',
    description: '',
    private_key: '',
});

export function SecurityPrivateKeysPanel() {
    const query = useApiQuery('security-keys', () => domainApi.securityKeys());
    const keys = query.data?.data ?? [];

    const [draft, setDraft] = useState<Draft>(emptyDraft());
    const [creating, setCreating] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<SecurityKey | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [showForm, setShowForm] = useState(false);

    const createKey = async () => {
        setCreating(true);
        setError(null);
        setMessage(null);

        try {
            const response = await domainApi.createSecurityKey({
                name: draft.name.trim() || undefined,
                description: draft.description.trim() || null,
                private_key: draft.private_key,
            });
            setMessage(response.data.message ?? 'Clé privée créée.');
            setDraft(emptyDraft());
            setShowForm(false);
            await query.reload();
        } catch (createError) {
            setError(createError instanceof Error ? createError.message : 'Échec de la création.');
        } finally {
            setCreating(false);
        }
    };

    const generateKey = async (type: 'ed25519' | 'rsa') => {
        setGenerating(true);
        setError(null);

        try {
            const response = await domainApi.generateSecurityKey(type);
            setDraft({
                name: response.data.name,
                description: response.data.description,
                private_key: response.data.private_key,
            });
            setShowForm(true);
        } catch (generateError) {
            setError(generateError instanceof Error ? generateError.message : 'Échec de la génération.');
        } finally {
            setGenerating(false);
        }
    };

    const deleteKey = async () => {
        if (!pendingDelete) {
            return;
        }

        setDeleting(true);
        setError(null);
        setMessage(null);

        try {
            await domainApi.deleteSecurityKey(pendingDelete.uuid);
            setMessage('Clé privée supprimée.');
            setPendingDelete(null);
            await query.reload();
        } catch (deleteError) {
            setError(deleteError instanceof Error ? deleteError.message : 'Échec de la suppression.');
        } finally {
            setDeleting(false);
        }
    };

    return (
        <div class="grid gap-2.5 sm:gap-3 md:gap-4">
            <div class="toolbar-row">
                <p class="text-xs text-base-content/55">
                    Clés SSH et de déploiement accessibles à l’équipe active.
                </p>
                <div class="card-toolbar flex flex-wrap gap-2">
                    <button class="btn btn-ghost btn-sm" type="button" onClick={() => void query.reload()}>
                        <RefreshCw class="size-3.5" aria-hidden />
                        Actualiser
                    </button>
                    <button
                        class="btn btn-ghost btn-sm"
                        type="button"
                        disabled={generating}
                        onClick={() => void generateKey('ed25519')}
                    >
                        {generating ? <LoaderCircle class="size-3.5 animate-spin" aria-hidden /> : null}
                        Générer ED25519
                    </button>
                    <button class="btn btn-primary btn-sm" type="button" onClick={() => setShowForm((value) => !value)}>
                        <Plus class="size-3.5" aria-hidden />
                        {showForm ? 'Fermer' : 'Ajouter'}
                    </button>
                </div>
            </div>

            {message && (
                <p class="rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">{message}</p>
            )}
            {error && (
                <p class="rounded-xl border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">{error}</p>
            )}

            {showForm && (
                <Card title="Nouvelle clé privée">
                    <div class="grid gap-3">
                        <label class="grid gap-1.5 text-sm">
                            <span class="font-medium">Nom</span>
                            <input
                                class="input input-bordered input-sm"
                                value={draft.name}
                                onInput={(event) => setDraft((current) => ({ ...current, name: (event.target as HTMLInputElement).value }))}
                            />
                        </label>
                        <label class="grid gap-1.5 text-sm">
                            <span class="font-medium">Description</span>
                            <input
                                class="input input-bordered input-sm"
                                value={draft.description}
                                onInput={(event) => setDraft((current) => ({ ...current, description: (event.target as HTMLInputElement).value }))}
                            />
                        </label>
                        <label class="grid gap-1.5 text-sm">
                            <span class="font-medium">Clé privée</span>
                            <textarea
                                class="textarea textarea-bordered font-mono text-xs"
                                rows={8}
                                value={draft.private_key}
                                onInput={(event) => setDraft((current) => ({ ...current, private_key: (event.target as HTMLTextAreaElement).value }))}
                            />
                        </label>
                        <button
                            class="btn btn-primary btn-sm w-fit"
                            type="button"
                            disabled={creating || !draft.private_key.trim()}
                            onClick={() => void createKey()}
                        >
                            {creating ? <LoaderCircle class="size-3.5 animate-spin" aria-hidden /> : <Plus class="size-3.5" aria-hidden />}
                            Enregistrer
                        </button>
                    </div>
                </Card>
            )}

            <DataState
                loading={query.loading}
                error={query.error}
                empty={keys.length === 0}
                emptyMessage="Aucune clé privée."
                onRetry={() => void query.reload()}
            >
                <div class="grid gap-2 md:grid-cols-2">
                    {keys.map((key) => (
                        <Card title={key.name} eyebrow={key.is_git_related ? 'Git' : 'SSH'} key={key.uuid}>
                            <p class="text-xs text-base-content/55">{key.description || 'Sans description'}</p>
                            <div class="flex items-center justify-between gap-2">
                                <code class="truncate text-[11px] text-base-content/45">{key.fingerprint || 'Empreinte indisponible'}</code>
                                <div class="flex items-center gap-2">
                                    <StatusBadge label="Masquée" />
                                    <button
                                        class="btn btn-ghost btn-xs text-error"
                                        type="button"
                                        onClick={() => setPendingDelete(key)}
                                    >
                                        <Trash2 class="size-3.5" aria-hidden />
                                    </button>
                                </div>
                            </div>
                        </Card>
                    ))}
                </div>
            </DataState>

            <ConfirmDialog
                open={pendingDelete !== null}
                title="Supprimer la clé"
                message={pendingDelete ? `Supprimer définitivement « ${pendingDelete.name} » ?` : ''}
                tone="danger"
                loading={deleting}
                onCancel={() => setPendingDelete(null)}
                onConfirm={() => void deleteKey()}
            />
        </div>
    );
}
