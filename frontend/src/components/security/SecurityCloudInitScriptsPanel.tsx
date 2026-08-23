import { LoaderCircle, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { DataState } from '../ui/DataState';
import { domainApi, type CloudInitScript } from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';

type Draft = {
    name: string;
    script: string;
};

const emptyDraft = (): Draft => ({
    name: '',
    script: '',
});

function formatDate(value: string): string {
    try {
        return new Date(value).toLocaleString('fr-FR');
    } catch {
        return value;
    }
}

export function SecurityCloudInitScriptsPanel() {
    const query = useApiQuery('security-cloud-init-scripts', () => domainApi.cloudInitScripts());
    const scripts = query.data?.data ?? [];

    const [draft, setDraft] = useState<Draft>(emptyDraft());
    const [editingId, setEditingId] = useState<number | null>(null);
    const [showForm, setShowForm] = useState(false);
    const [saving, setSaving] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<CloudInitScript | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    const openCreate = () => {
        setEditingId(null);
        setDraft(emptyDraft());
        setShowForm(true);
        setError(null);
        setMessage(null);
    };

    const openEdit = (script: CloudInitScript) => {
        setEditingId(script.id);
        setDraft({
            name: script.name,
            script: script.script,
        });
        setShowForm(true);
        setError(null);
        setMessage(null);
    };

    const save = async () => {
        setSaving(true);
        setError(null);
        setMessage(null);

        try {
            const payload = {
                name: draft.name.trim(),
                script: draft.script,
            };
            const response = editingId === null
                ? await domainApi.createCloudInitScript(payload)
                : await domainApi.updateCloudInitScript(editingId, payload);
            setMessage(response.data.message ?? (editingId === null ? 'Script créé.' : 'Script mis à jour.'));
            setDraft(emptyDraft());
            setEditingId(null);
            setShowForm(false);
            await query.reload();
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : 'Échec de l’enregistrement.');
        } finally {
            setSaving(false);
        }
    };

    const remove = async () => {
        if (!pendingDelete) {
            return;
        }

        setDeleting(true);
        setError(null);
        setMessage(null);

        try {
            await domainApi.deleteCloudInitScript(pendingDelete.id);
            setMessage('Script cloud-init supprimé.');
            setPendingDelete(null);
            await query.reload();
        } catch (deleteError) {
            setError(deleteError instanceof Error ? deleteError.message : 'Échec de la suppression.');
        } finally {
            setDeleting(false);
        }
    };

    return (
        <div class="grid gap-4">
            <div class="toolbar-row">
                <p class="text-xs text-base-content/55">
                    Scripts réutilisables pour l’initialisation des serveurs (intégration Hetzner).
                </p>
                <div class="card-toolbar flex flex-wrap gap-2">
                    <button class="btn btn-ghost btn-sm" type="button" onClick={() => void query.reload()}>
                        <RefreshCw class="size-3.5" aria-hidden />
                        Actualiser
                    </button>
                    <button class="btn btn-primary btn-sm" type="button" onClick={openCreate}>
                        <Plus class="size-3.5" aria-hidden />
                        Ajouter
                    </button>
                </div>
            </div>

            {error && <p class="text-sm text-error" role="alert">{error}</p>}
            {message && <p class="text-sm text-success" role="status">{message}</p>}

            {showForm && (
                <div class="grid gap-2 sm:gap-3 rounded-2xl border border-base-300/70 p-4">
                    <p class="text-xs sm:text-sm font-semibold">
                        {editingId === null ? 'Nouveau script cloud-init' : 'Modifier le script'}
                    </p>
                    <label class="grid gap-1.5 text-sm">
                        <span class="font-medium">Nom</span>
                        <input
                            class="input input-bordered input-sm w-full rounded-xl"
                            value={draft.name}
                            onInput={(event) => setDraft((current) => ({ ...current, name: event.currentTarget.value }))}
                            required
                            minLength={3}
                        />
                    </label>
                    <label class="grid gap-1.5 text-sm">
                        <span class="font-medium">Script</span>
                        <textarea
                            class="textarea textarea-bordered min-h-48 w-full rounded-xl font-mono text-xs"
                            value={draft.script}
                            onInput={(event) => setDraft((current) => ({ ...current, script: event.currentTarget.value }))}
                            placeholder={'#!/bin/bash\n# ou #cloud-config\n'}
                            required
                        />
                        <span class="text-xs text-base-content/45">
                            Bash (#!) ou cloud-config YAML (#cloud-config).
                        </span>
                    </label>
                    <div class="flex flex-wrap gap-2">
                        <button
                            class="btn btn-primary btn-sm"
                            type="button"
                            disabled={saving || draft.name.trim().length < 3 || draft.script.trim().length === 0}
                            onClick={() => void save()}
                        >
                            {saving ? <LoaderCircle class="size-3.5 animate-spin" aria-hidden /> : null}
                            {saving ? 'Enregistrement…' : 'Enregistrer'}
                        </button>
                        <button
                            class="btn btn-ghost btn-sm"
                            type="button"
                            disabled={saving}
                            onClick={() => {
                                setShowForm(false);
                                setEditingId(null);
                                setDraft(emptyDraft());
                            }}
                        >
                            Annuler
                        </button>
                    </div>
                </div>
            )}

            <DataState
                loading={query.loading}
                error={query.error}
                empty={scripts.length === 0}
                emptyMessage="Aucun script cloud-init. Créez-en un pour démarrer."
                onRetry={() => void query.reload()}
            >
                <ul class="grid gap-2 sm:gap-3 md:grid-cols-2">
                    {scripts.map((script) => (
                        <li class="grid gap-2 sm:gap-3 rounded-2xl border border-base-300/70 p-4" key={script.id}>
                            <div class="min-w-0">
                                <p class="truncate text-xs sm:text-sm font-semibold">{script.name}</p>
                                <p class="text-xs text-base-content/50">
                                    Créé {formatDate(script.created_at)}
                                </p>
                            </div>
                            <pre class="max-h-28 overflow-auto rounded-xl bg-base-200/60 p-3 text-[11px] leading-relaxed text-base-content/70">
                                {script.script}
                            </pre>
                            <div class="flex flex-wrap gap-2">
                                <button class="btn btn-ghost btn-xs" type="button" onClick={() => openEdit(script)}>
                                    <Pencil class="size-3.5" aria-hidden />
                                    Modifier
                                </button>
                                <button
                                    class="btn btn-ghost btn-xs text-error"
                                    type="button"
                                    onClick={() => setPendingDelete(script)}
                                >
                                    <Trash2 class="size-3.5" aria-hidden />
                                    Supprimer
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            </DataState>

            <ConfirmDialog
                open={pendingDelete !== null}
                title="Supprimer le script ?"
                message={
                    pendingDelete
                        ? `Le script « ${pendingDelete.name} » sera définitivement supprimé.`
                        : ''
                }
                confirmLabel="Supprimer"
                loading={deleting}
                tone="danger"
                onCancel={() => setPendingDelete(null)}
                onConfirm={() => void remove()}
            />
        </div>
    );
}
