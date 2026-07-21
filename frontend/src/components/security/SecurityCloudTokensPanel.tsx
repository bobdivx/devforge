import { CheckCircle2, LoaderCircle, Plus, RefreshCw, Trash2 } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { DataState } from '../ui/DataState';
import { StatusBadge } from '../ui/StatusBadge';
import { Table } from '../ui/Table';
import { domainApi, type CloudProviderTokenSummary } from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';

type Draft = {
    provider: 'hetzner' | 'digitalocean';
    name: string;
    token: string;
};

const emptyDraft = (): Draft => ({
    provider: 'hetzner',
    name: '',
    token: '',
});

function providerLabel(provider: string): string {
    if (provider === 'digitalocean') {
        return 'DigitalOcean';
    }

    return 'Hetzner';
}

export function SecurityCloudTokensPanel() {
    const query = useApiQuery('security-cloud-tokens', () => domainApi.cloudTokens());
    const tokens = query.data?.data ?? [];

    const [draft, setDraft] = useState<Draft>(emptyDraft());
    const [showForm, setShowForm] = useState(false);
    const [creating, setCreating] = useState(false);
    const [validatingUuid, setValidatingUuid] = useState<string | null>(null);
    const [pendingDelete, setPendingDelete] = useState<CloudProviderTokenSummary | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    const createToken = async () => {
        setCreating(true);
        setError(null);
        setMessage(null);

        try {
            const response = await domainApi.createCloudToken({
                provider: draft.provider,
                name: draft.name.trim(),
                token: draft.token.trim(),
            });
            setMessage(response.data.message ?? 'Jeton cloud ajouté.');
            setDraft(emptyDraft());
            setShowForm(false);
            await query.reload();
        } catch (createError) {
            setError(createError instanceof Error ? createError.message : 'Échec de la création.');
        } finally {
            setCreating(false);
        }
    };

    const validateToken = async (tokenUuid: string) => {
        setValidatingUuid(tokenUuid);
        setError(null);
        setMessage(null);

        try {
            const response = await domainApi.validateCloudToken(tokenUuid);
            setMessage(response.data.message);
            if (!response.data.valid) {
                setError(response.data.message);
                setMessage(null);
            }
        } catch (validateError) {
            setError(validateError instanceof Error ? validateError.message : 'Échec de la validation.');
        } finally {
            setValidatingUuid(null);
        }
    };

    const deleteToken = async () => {
        if (!pendingDelete) {
            return;
        }

        setDeleting(true);
        setError(null);
        setMessage(null);

        try {
            await domainApi.deleteCloudToken(pendingDelete.uuid);
            setMessage('Jeton cloud supprimé.');
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
                    Jetons des fournisseurs cloud pour le provisionnement de serveurs.
                </p>
                <div class="card-toolbar flex flex-wrap gap-2">
                    <button class="btn btn-ghost btn-sm" type="button" onClick={() => void query.reload()}>
                        <RefreshCw class="size-3.5" aria-hidden />
                        Actualiser
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
                <div class="grid gap-3 rounded-2xl border border-base-300/70 bg-base-100 p-4">
                    <label class="grid gap-1.5 text-sm">
                        <span class="font-medium">Fournisseur</span>
                        <select
                            class="select select-bordered select-sm"
                            value={draft.provider}
                            onChange={(event) => setDraft((current) => ({
                                ...current,
                                provider: (event.target as HTMLSelectElement).value as Draft['provider'],
                            }))}
                        >
                            <option value="hetzner">Hetzner</option>
                            <option value="digitalocean">DigitalOcean</option>
                        </select>
                    </label>
                    <label class="grid gap-1.5 text-sm">
                        <span class="font-medium">Nom</span>
                        <input
                            class="input input-bordered input-sm"
                            value={draft.name}
                            onInput={(event) => setDraft((current) => ({
                                ...current,
                                name: (event.target as HTMLInputElement).value,
                            }))}
                        />
                    </label>
                    <label class="grid gap-1.5 text-sm">
                        <span class="font-medium">Token API</span>
                        <input
                            class="input input-bordered input-sm font-mono"
                            type="password"
                            value={draft.token}
                            onInput={(event) => setDraft((current) => ({
                                ...current,
                                token: (event.target as HTMLInputElement).value,
                            }))}
                        />
                    </label>
                    <button
                        class="btn btn-primary btn-sm w-fit"
                        type="button"
                        disabled={creating || !draft.name.trim() || !draft.token.trim()}
                        onClick={() => void createToken()}
                    >
                        {creating ? <LoaderCircle class="size-3.5 animate-spin" aria-hidden /> : <Plus class="size-3.5" aria-hidden />}
                        Valider et ajouter
                    </button>
                </div>
            )}

            <DataState
                loading={query.loading}
                error={query.error}
                empty={tokens.length === 0}
                emptyMessage="Aucun jeton cloud."
                onRetry={() => void query.reload()}
            >
                <Table headers={['Nom', 'Fournisseur', 'Serveurs', '']} embedded>
                    {tokens.map((token) => (
                        <tr key={token.uuid}>
                            <td class="font-medium">{token.name}</td>
                            <td>
                                <StatusBadge label={providerLabel(token.provider)} tone="neutral" />
                            </td>
                            <td class="text-xs text-base-content/55">{token.servers_count}</td>
                            <td>
                                <div class="flex items-center gap-1">
                                    <button
                                        class="btn btn-ghost btn-xs"
                                        type="button"
                                        disabled={validatingUuid === token.uuid}
                                        onClick={() => void validateToken(token.uuid)}
                                    >
                                        {validatingUuid === token.uuid
                                            ? <LoaderCircle class="size-3.5 animate-spin" aria-hidden />
                                            : <CheckCircle2 class="size-3.5" aria-hidden />}
                                    </button>
                                    <button
                                        class="btn btn-ghost btn-xs text-error"
                                        type="button"
                                        disabled={token.servers_count > 0}
                                        title={token.servers_count > 0 ? 'Jeton lié à des serveurs' : 'Supprimer'}
                                        onClick={() => setPendingDelete(token)}
                                    >
                                        <Trash2 class="size-3.5" aria-hidden />
                                    </button>
                                </div>
                            </td>
                        </tr>
                    ))}
                </Table>
            </DataState>

            <ConfirmDialog
                open={pendingDelete !== null}
                title="Supprimer le jeton cloud"
                message={pendingDelete ? `Supprimer définitivement « ${pendingDelete.name} » ?` : ''}
                tone="danger"
                loading={deleting}
                onCancel={() => setPendingDelete(null)}
                onConfirm={() => void deleteToken()}
            />
        </div>
    );
}
