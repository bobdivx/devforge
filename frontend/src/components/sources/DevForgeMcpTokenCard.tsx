import { Copy, KeyRound, LoaderCircle, Plus, Trash2 } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { Card } from '../ui/Card';
import { Modal } from '../ui/Modal';
import { domainApi, type ApiToken } from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';
import { navigateTo } from '../../lib/use-navigate';

const EXPIRATION_OPTIONS = [
    { value: 7, label: '7 jours' },
    { value: 30, label: '30 jours' },
    { value: 60, label: '60 jours' },
    { value: 90, label: '90 jours' },
    { value: 365, label: '1 an' },
    { value: 'never', label: 'Jamais' },
] as const;

function mcpEndpoint(): string {
    if (typeof window === 'undefined') {
        return '/mcp/devforge';
    }

    return `${window.location.origin}/mcp/devforge`;
}

function formatDate(value: string | null): string {
    if (!value) {
        return 'Jamais';
    }

    try {
        return new Date(value).toLocaleString('fr-FR', { 
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });
    } catch {
        return value;
    }
}

export function DevForgeMcpTokenCard() {
    const query = useApiQuery('security-api-tokens', () => domainApi.apiTokens());
    const tokens = query.data?.data ?? [];
    const meta = query.data?.meta;
    const endpoint = mcpEndpoint();

    const [name, setName] = useState('');
    const [abilities, setAbilities] = useState<string[]>(['read', 'write']);
    const [expiresInDays, setExpiresInDays] = useState<number | 'never'>(365);
    const [showForm, setShowForm] = useState(false);
    const [creating, setCreating] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<ApiToken | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [plainTextToken, setPlainTextToken] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const createToken = async () => {
        setCreating(true);
        setError(null);
        setCopied(false);

        try {
            const response = await domainApi.createApiToken({
                name: name.trim() || 'Cursor MCP',
                abilities,
                expires_in_days: expiresInDays === 'never' ? null : expiresInDays,
            });
            setPlainTextToken(response.data.plain_text_token ?? null);
            setName('');
            setAbilities(['read', 'write']);
            setExpiresInDays(365);
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

        try {
            await domainApi.deleteApiToken(pendingDelete.id);
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

    const isApiDisabled = meta?.is_api_enabled === false;

    return (
        <>
            <Card title="Token DevForge" eyebrow="MCP & API">
                <div class="grid gap-2.5 sm:gap-3 md:gap-4">
                    <p class="text-xs text-base-content/55">
                        Jetons d'authentification pour l'API REST et le serveur MCP DevForge (Cursor, agents).
                        Endpoint : <code class="font-mono text-[11px]">{endpoint}</code>
                    </p>

                    {isApiDisabled && (
                        <div class="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2">
                            <p class="text-sm text-warning">
                                L'API est désactivée sur cette instance. Activez-la dans{' '}
                                <button
                                    class="link link-warning font-medium"
                                    type="button"
                                    onClick={() => navigateTo('/settings/advanced')}
                                >
                                    Paramètres → Avancé
                                </button>
                                .
                            </p>
                        </div>
                    )}

                    {error && (
                        <p class="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">{error}</p>
                    )}

                    {plainTextToken && (
                        <div class="rounded-lg border border-success/40 bg-success/10 p-4">
                            <p class="text-xs sm:text-sm font-semibold text-success">Jeton créé avec succès</p>
                            <p class="mt-1 text-xs text-base-content/65">
                                Copiez ce jeton maintenant. Il ne sera plus affiché après fermeture.
                            </p>
                            <code class="mt-3 block break-all rounded-lg bg-base-100 px-3 py-2 font-mono text-xs">
                                {plainTextToken}
                            </code>
                            <button class="btn btn-outline btn-sm mt-3" type="button" onClick={() => void copyToken()}>
                                <Copy class="size-3.5" aria-hidden />
                                {copied ? 'Copié' : 'Copier'}
                            </button>
                        </div>
                    )}

                    {tokens.length > 0 && (
                        <div class="grid gap-2">
                            <h4 class="text-xs sm:text-sm font-semibold">Jetons actifs ({tokens.length})</h4>
                            <div class="grid gap-2">
                                {tokens.slice(0, 5).map((token: ApiToken) => (
                                    <div key={token.id} class="flex items-center justify-between gap-2 sm:gap-3 rounded-lg border border-base-300 bg-base-100 p-3">
                                        <div class="min-w-0 flex-1">
                                            <div class="font-medium text-sm truncate">{token.name}</div>
                                            <div class="text-xs text-base-content/55">
                                                <span class="font-mono">{token.abilities.join(', ')}</span>
                                                {' · '}
                                                Expire {formatDate(token.expires_at)}
                                            </div>
                                        </div>
                                        <button
                                            class="btn btn-ghost btn-xs text-error"
                                            type="button"
                                            onClick={() => setPendingDelete(token)}
                                            title="Révoquer"
                                        >
                                            <Trash2 class="size-3.5" aria-hidden />
                                        </button>
                                    </div>
                                ))}
                            </div>
                            {tokens.length > 5 && (
                                <button
                                    class="link link-sm text-base-content/65 text-left"
                                    type="button"
                                    onClick={() => navigateTo('/settings/security')}
                                >
                                    Voir tous les jetons ({tokens.length}) →
                                </button>
                            )}
                        </div>
                    )}

                    {tokens.length === 0 && !isApiDisabled && (
                        <p class="text-xs text-base-content/55">Aucun jeton créé.</p>
                    )}

                    <button
                        class="btn btn-primary btn-sm w-fit"
                        type="button"
                        disabled={isApiDisabled}
                        onClick={() => setShowForm(true)}
                    >
                        <Plus class="size-3.5" aria-hidden />
                        Créer un jeton MCP
                    </button>
                </div>
            </Card>

            <Modal title="Nouveau jeton DevForge" open={showForm} onClose={() => setShowForm(false)}>
                <div class="p-6 grid gap-2.5 sm:gap-3 md:gap-4">
                    <label class="grid gap-1.5 text-sm">
                        <span class="font-medium">Nom du jeton</span>
                        <input
                            class="input input-bordered input-sm"
                            value={name}
                            onInput={(event) => setName((event.target as HTMLInputElement).value)}
                            placeholder="Cursor MCP"
                        />
                        <span class="text-xs text-base-content/55">Ex: Cursor MCP, CI/CD Pipeline, etc.</span>
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
                        <p class="text-xs sm:text-sm font-medium">Permissions</p>
                        <div class="grid gap-2">
                            <label class="flex items-start gap-2 text-sm">
                                <input
                                    type="checkbox"
                                    class="checkbox checkbox-sm mt-0.5"
                                    checked={abilities.includes('read')}
                                    onChange={() => {
                                        setAbilities((current) =>
                                            current.includes('read')
                                                ? current.filter((a) => a !== 'read')
                                                : [...current, 'read']
                                        );
                                    }}
                                />
                                <span class="grid gap-0.5">
                                    <code class="text-xs">read</code>
                                    <span class="text-[11px] text-base-content/55">Lecture API et MCP</span>
                                </span>
                            </label>
                            <label class="flex items-start gap-2 text-sm">
                                <input
                                    type="checkbox"
                                    class="checkbox checkbox-sm mt-0.5"
                                    checked={abilities.includes('write')}
                                    onChange={() => {
                                        setAbilities((current) =>
                                            current.includes('write')
                                                ? current.filter((a) => a !== 'write')
                                                : [...current, 'write']
                                        );
                                    }}
                                    disabled={meta?.can_use_write === false}
                                />
                                <span class="grid gap-0.5">
                                    <code class="text-xs">write</code>
                                    <span class="text-[11px] text-base-content/55">
                                        Écriture API / réparation MCP
                                        {meta?.can_use_write === false && ' (admin/owner uniquement)'}
                                    </span>
                                </span>
                            </label>
                        </div>
                        <p class="text-xs text-base-content/55">
                            Pour MCP Cursor, utilisez <code class="font-mono">read</code> +{' '}
                            <code class="font-mono">write</code>
                        </p>
                    </div>

                    <div class="modal-action">
                        <button class="btn btn-ghost" type="button" onClick={() => setShowForm(false)}>
                            Annuler
                        </button>
                        <button
                            class="btn btn-primary"
                            type="button"
                            disabled={creating || abilities.length === 0}
                            onClick={() => void createToken()}
                        >
                            {creating ? (
                                <LoaderCircle class="size-3.5 animate-spin" aria-hidden />
                            ) : (
                                <KeyRound class="size-3.5" aria-hidden />
                            )}
                            Créer le jeton
                        </button>
                    </div>
                </div>
            </Modal>

            <Modal
                title="Révoquer le jeton"
                open={pendingDelete !== null}
                onClose={() => setPendingDelete(null)}
            >
                <div class="p-6">
                    <p class="text-sm text-base-content/70">
                        Voulez-vous révoquer définitivement le jeton « {pendingDelete?.name} » ?
                    </p>
                    <p class="mt-2 text-sm text-error">
                        Cette action est irréversible. Toutes les connexions API/MCP utilisant ce jeton échoueront.
                    </p>
                    <div class="modal-action mt-6">
                        <button class="btn btn-ghost" type="button" onClick={() => setPendingDelete(null)}>
                            Annuler
                        </button>
                        <button
                            class="btn btn-error"
                            type="button"
                            disabled={deleting}
                            onClick={() => void revokeToken()}
                        >
                            {deleting ? (
                                <LoaderCircle class="size-3.5 animate-spin" aria-hidden />
                            ) : (
                                <Trash2 class="size-3.5" aria-hidden />
                            )}
                            Révoquer
                        </button>
                    </div>
                </div>
            </Modal>
        </>
    );
}
