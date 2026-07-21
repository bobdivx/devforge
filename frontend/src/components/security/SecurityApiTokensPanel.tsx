import { Copy, LoaderCircle, Plus, RefreshCw, Trash2 } from 'lucide-preact';
import { useMemo, useState } from 'preact/hooks';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { DataState } from '../ui/DataState';
import { StatusBadge } from '../ui/StatusBadge';
import { Table } from '../ui/Table';
import { domainApi, type ApiToken } from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';

const ALL_ABILITIES = [
    { id: 'read', label: 'read' },
    { id: 'read:sensitive', label: 'read:sensitive' },
    { id: 'write', label: 'write' },
    { id: 'write:sensitive', label: 'write:sensitive' },
    { id: 'deploy', label: 'deploy' },
    { id: 'root', label: 'root' },
] as const;

const EXPIRATION_OPTIONS = [
    { value: 7, label: '7 jours' },
    { value: 30, label: '30 jours' },
    { value: 60, label: '60 jours' },
    { value: 90, label: '90 jours' },
    { value: 365, label: '1 an' },
    { value: 'never', label: 'Jamais' },
] as const;

function formatDate(value: string | null): string {
    if (!value) {
        return '—';
    }

    try {
        return new Date(value).toLocaleString('fr-FR');
    } catch {
        return value;
    }
}

export function SecurityApiTokensPanel() {
    const query = useApiQuery('security-api-tokens', () => domainApi.apiTokens());
    const tokens = query.data?.data ?? [];
    const meta = query.data?.meta;

    const [name, setName] = useState('');
    const [abilities, setAbilities] = useState<string[]>(['read']);
    const [expiresInDays, setExpiresInDays] = useState<number | 'never'>(30);
    const [showForm, setShowForm] = useState(false);
    const [creating, setCreating] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<ApiToken | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [plainTextToken, setPlainTextToken] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const availableAbilities = useMemo(() => {
        return ALL_ABILITIES.filter((ability) => {
            if (ability.id === 'root') {
                return meta?.can_use_root !== false;
            }
            if (ability.id === 'write' || ability.id === 'write:sensitive') {
                return meta?.can_use_write !== false;
            }

            return true;
        });
    }, [meta]);

    const toggleAbility = (abilityId: string) => {
        setAbilities((current) => {
            if (abilityId === 'root') {
                return current.includes('root') ? ['read'] : ['root'];
            }
            if (abilityId === 'deploy') {
                return current.includes('deploy') ? ['read'] : ['deploy'];
            }

            let next = current.filter((item) => item !== 'root' && item !== 'deploy');
            if (next.includes(abilityId)) {
                next = next.filter((item) => item !== abilityId);
            } else {
                next = [...next, abilityId];
            }
            if (abilityId === 'read:sensitive' && !next.includes('read')) {
                next.push('read');
            }
            if (next.length === 0) {
                next = ['read'];
            }

            return next;
        });
    };

    const createToken = async () => {
        setCreating(true);
        setError(null);
        setMessage(null);
        setCopied(false);

        try {
            const response = await domainApi.createApiToken({
                name: name.trim(),
                abilities,
                expires_in_days: expiresInDays === 'never' ? null : expiresInDays,
            });
            setPlainTextToken(response.data.plain_text_token ?? null);
            setMessage(response.data.message ?? 'Jeton créé.');
            setName('');
            setAbilities(['read']);
            setExpiresInDays(30);
            setShowForm(false);
            await query.reload();
        } catch (createError) {
            setError(createError instanceof Error ? createError.message : 'Échec de la création.');
        } finally {
            setCreating(false);
        }
    };

    const revokeToken = async () => {
        if (!pendingDelete) {
            return;
        }

        setDeleting(true);
        setError(null);
        setMessage(null);

        try {
            await domainApi.deleteApiToken(pendingDelete.id);
            setMessage('Jeton API révoqué.');
            setPendingDelete(null);
            await query.reload();
        } catch (deleteError) {
            setError(deleteError instanceof Error ? deleteError.message : 'Échec de la révocation.');
        } finally {
            setDeleting(false);
        }
    };

    const copyToken = async () => {
        if (!plainTextToken) {
            return;
        }

        try {
            await navigator.clipboard.writeText(plainTextToken);
            setCopied(true);
        } catch {
            setError('Impossible de copier le jeton.');
        }
    };

    return (
        <div class="grid gap-4">
            <div class="toolbar-row">
                <p class="text-xs text-base-content/55">
                    Jetons d’accès API Sanctum pour l’automatisation.
                </p>
                <div class="card-toolbar flex flex-wrap gap-2">
                    <button class="btn btn-ghost btn-sm" type="button" onClick={() => void query.reload()}>
                        <RefreshCw class="size-3.5" aria-hidden />
                        Actualiser
                    </button>
                    <button
                        class="btn btn-primary btn-sm"
                        type="button"
                        disabled={meta?.is_api_enabled === false}
                        onClick={() => setShowForm((value) => !value)}
                    >
                        <Plus class="size-3.5" aria-hidden />
                        {showForm ? 'Fermer' : 'Nouveau jeton'}
                    </button>
                </div>
            </div>

            {meta?.is_api_enabled === false && (
                <p class="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
                    L’API est désactivée sur cette instance. Activez-la dans les paramètres avancés.
                </p>
            )}

            {message && (
                <p class="rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">{message}</p>
            )}
            {error && (
                <p class="rounded-xl border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">{error}</p>
            )}

            {plainTextToken && (
                <div class="rounded-xl border border-warning/40 bg-warning/10 p-4">
                    <p class="text-sm font-semibold text-warning">Copiez ce jeton maintenant</p>
                    <p class="mt-1 text-xs text-base-content/60">Il ne sera plus affiché après actualisation.</p>
                    <code class="mt-3 block break-all rounded-lg bg-base-100 px-3 py-2 font-mono text-xs">{plainTextToken}</code>
                    <button class="btn btn-outline btn-sm mt-3" type="button" onClick={() => void copyToken()}>
                        <Copy class="size-3.5" aria-hidden />
                        {copied ? 'Copié' : 'Copier'}
                    </button>
                </div>
            )}

            {showForm && meta?.is_api_enabled !== false && (
                <div class="grid gap-3 rounded-2xl border border-base-300/70 bg-base-100 p-4">
                    <label class="grid gap-1.5 text-sm">
                        <span class="font-medium">Nom</span>
                        <input
                            class="input input-bordered input-sm"
                            value={name}
                            onInput={(event) => setName((event.target as HTMLInputElement).value)}
                            placeholder="Mon jeton CI"
                        />
                    </label>
                    <label class="grid gap-1.5 text-sm">
                        <span class="font-medium">Expiration</span>
                        <select
                            class="select select-bordered select-sm"
                            value={expiresInDays === 'never' ? 'never' : String(expiresInDays)}
                            onChange={(event) => {
                                const value = (event.target as HTMLSelectElement).value;
                                setExpiresInDays(value === 'never' ? 'never' : Number(value));
                            }}
                        >
                            {EXPIRATION_OPTIONS.map((option) => (
                                <option key={String(option.value)} value={String(option.value)}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </label>
                    <div class="grid gap-2">
                        <p class="text-sm font-medium">Abilities</p>
                        <div class="grid gap-2 sm:grid-cols-2">
                            {availableAbilities.map((ability) => (
                                <label key={ability.id} class="flex items-center gap-2 text-sm">
                                    <input
                                        type="checkbox"
                                        class="checkbox checkbox-sm"
                                        checked={abilities.includes(ability.id)}
                                        onChange={() => toggleAbility(ability.id)}
                                    />
                                    <code class="text-xs">{ability.label}</code>
                                </label>
                            ))}
                        </div>
                    </div>
                    <button
                        class="btn btn-primary btn-sm w-fit"
                        type="button"
                        disabled={creating || name.trim().length < 3}
                        onClick={() => void createToken()}
                    >
                        {creating ? <LoaderCircle class="size-3.5 animate-spin" aria-hidden /> : <Plus class="size-3.5" aria-hidden />}
                        Créer
                    </button>
                </div>
            )}

            <DataState
                loading={query.loading}
                error={query.error}
                empty={tokens.length === 0}
                emptyMessage="Aucun jeton API."
                onRetry={() => void query.reload()}
            >
                <Table headers={['Nom', 'Abilities', 'Dernier usage', 'Expire', '']} embedded>
                    {tokens.map((token) => (
                        <tr key={token.id}>
                            <td>
                                <div class="flex items-center gap-2">
                                    <span class="font-medium">{token.name}</span>
                                    {token.is_expired && <StatusBadge label="Expiré" tone="warning" />}
                                </div>
                            </td>
                            <td class="font-mono text-xs">{token.abilities.join(', ')}</td>
                            <td class="text-xs text-base-content/55">{formatDate(token.last_used_at)}</td>
                            <td class="text-xs text-base-content/55">{formatDate(token.expires_at)}</td>
                            <td>
                                <button
                                    class="btn btn-ghost btn-xs text-error"
                                    type="button"
                                    onClick={() => setPendingDelete(token)}
                                >
                                    <Trash2 class="size-3.5" aria-hidden />
                                </button>
                            </td>
                        </tr>
                    ))}
                </Table>
            </DataState>

            <ConfirmDialog
                open={pendingDelete !== null}
                title="Révoquer le jeton"
                message={pendingDelete ? `Révoquer définitivement « ${pendingDelete.name} » ?` : ''}
                tone="danger"
                loading={deleting}
                onCancel={() => setPendingDelete(null)}
                onConfirm={() => void revokeToken()}
            />
        </div>
    );
}
