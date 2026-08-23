import { Braces, Eye, EyeOff, LoaderCircle, Pencil, Plus, RefreshCw, Trash2, Upload } from 'lucide-preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ActionToolbar } from '../ui/ActionToolbar';
import { DataState } from '../ui/DataState';
import { FilterBar } from '../ui/FilterBar';
import { StatusBadge } from '../ui/StatusBadge';
import { Table } from '../ui/Table';
import { Tabs } from '../ui/Tabs';
import {
    domainApi,
    type ApplicationEnvironmentVariable,
    type ApplicationEnvironmentVariableInput,
} from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';
import { readEnvFile } from '../../lib/env-file';

type ScopeTab = 'production' | 'preview';

const scopeTabs: Array<{ id: ScopeTab; label: string }> = [
    { id: 'production', label: 'Production' },
    { id: 'preview', label: 'Preview' },
];

const defaultForm = (isPreview = false): ApplicationEnvironmentVariableInput => ({
    key: '',
    value: '',
    comment: '',
    is_preview: isPreview,
    is_runtime: true,
    is_buildtime: true,
    is_multiline: false,
    is_literal: false,
});

function variableFlags(variable: ApplicationEnvironmentVariable): string[] {
    const flags: string[] = [];

    if (variable.is_runtime) {
        flags.push('Runtime');
    }

    if (variable.is_buildtime) {
        flags.push('Build');
    }

    if (variable.is_multiline) {
        flags.push('Multiligne');
    }

    if (variable.is_literal) {
        flags.push('Littéral');
    }

    if (variable.is_shared) {
        flags.push('Partagée');
    }

    if (variable.is_coolify) {
        flags.push('Système');
    }

    if (variable.is_buildpack_control) {
        flags.push('Buildpack');
    }

    return flags;
}

type ApplicationEnvironmentVariablesPanelProps = {
    applicationUuid: string;
    canAct: boolean;
};

function VariableValueCell({
    applicationUuid,
    variable,
}: {
    applicationUuid: string;
    variable: ApplicationEnvironmentVariable;
}) {
    const [revealed, setRevealed] = useState(false);
    const [revealedValue, setRevealedValue] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!variable.has_value) {
        return <span class="text-base-content/35">vide</span>;
    }

    if (variable.is_shown_once) {
        return <span class="text-base-content/45">Masquée définitivement</span>;
    }

    const maskedValue = variable.value ?? '********';

    const toggleReveal = async () => {
        if (revealed) {
            setRevealed(false);
            setError(null);

            return;
        }

        if (revealedValue !== null) {
            setRevealed(true);
            setError(null);

            return;
        }

        setLoading(true);
        setError(null);

        try {
            const response = await domainApi.revealApplicationEnvironmentVariable(applicationUuid, variable.uuid);
            setRevealedValue(response.data.value);
            setRevealed(true);
        } catch {
            setError('Impossible d’afficher la valeur.');
        } finally {
            setLoading(false);
        }
    };

    const displayValue = revealed && revealedValue !== null ? revealedValue : maskedValue;

    return (
        <div class="flex min-w-0 items-center gap-1">
            <span
                class={`min-w-0 flex-1 font-mono text-xs text-base-content/55 ${
                    revealed && variable.is_multiline ? 'whitespace-pre-wrap break-all' : 'truncate'
                }`}
                title={revealed ? revealedValue ?? undefined : undefined}
            >
                {displayValue}
            </span>
            {variable.is_revealable && (
                <button
                    class="btn btn-ghost btn-xs btn-square shrink-0"
                    type="button"
                    aria-label={revealed ? `Masquer ${variable.key}` : `Afficher ${variable.key}`}
                    title={revealed ? 'Masquer' : 'Afficher'}
                    disabled={loading}
                    onClick={() => void toggleReveal()}
                >
                    {loading
                        ? <LoaderCircle class="size-3.5 animate-spin" aria-hidden />
                        : (revealed
                            ? <EyeOff class="size-3.5" aria-hidden />
                            : <Eye class="size-3.5" aria-hidden />)}
                </button>
            )}
            {error && <span class="sr-only" role="alert">{error}</span>}
        </div>
    );
}

export function ApplicationEnvironmentVariablesPanel({
    applicationUuid,
    canAct,
}: ApplicationEnvironmentVariablesPanelProps) {
    const query = useApiQuery(
        `application-env:${applicationUuid}`,
        () => domainApi.applicationEnvironmentVariables(applicationUuid),
    );
    const [scope, setScope] = useState<ScopeTab>('production');
    const [search, setSearch] = useState('');
    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState<ApplicationEnvironmentVariable | null>(null);
    const [form, setForm] = useState<ApplicationEnvironmentVariableInput>(defaultForm());
    const [valuePrefilled, setValuePrefilled] = useState(false);
    const [loadingValue, setLoadingValue] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [bannerError, setBannerError] = useState<string | null>(null);
    const [pendingDelete, setPendingDelete] = useState<ApplicationEnvironmentVariable | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [importing, setImporting] = useState(false);
    const editRequestId = useRef(0);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const variables = useMemo(() => {
        const data = query.data?.data;

        if (!data) {
            return [];
        }

        return scope === 'preview' ? data.preview : data.production;
    }, [query.data?.data, scope]);

    const filtered = useMemo(() => {
        const normalized = search.trim().toLowerCase();

        if (!normalized) {
            return variables;
        }

        return variables.filter((variable) => (
            variable.key.toLowerCase().includes(normalized)
            || (variable.comment ?? '').toLowerCase().includes(normalized)
        ));
    }, [search, variables]);

    const openCreate = () => {
        setEditing(null);
        setForm(defaultForm(scope === 'preview'));
        setValuePrefilled(true);
        setLoadingValue(false);
        setFormError(null);
        setFormOpen(true);
    };

    const openEdit = (variable: ApplicationEnvironmentVariable) => {
        const requestId = ++editRequestId.current;

        setEditing(variable);
        setForm({
            key: variable.key,
            value: '',
            comment: variable.comment ?? '',
            is_preview: variable.is_preview,
            is_runtime: variable.is_runtime,
            is_buildtime: variable.is_buildtime,
            is_multiline: variable.is_multiline,
            is_literal: variable.is_literal,
        });
        setValuePrefilled(!variable.has_value);
        setLoadingValue(false);
        setFormError(null);
        setFormOpen(true);

        if (!variable.is_revealable || !variable.has_value) {
            return;
        }

        setLoadingValue(true);

        void domainApi.revealApplicationEnvironmentVariable(applicationUuid, variable.uuid)
            .then((response) => {
                if (requestId !== editRequestId.current) {
                    return;
                }

                setForm((current) => ({
                    ...current,
                    value: response.data.value,
                }));
                setValuePrefilled(true);
            })
            .catch(() => {
                if (requestId !== editRequestId.current) {
                    return;
                }

                setFormError('Impossible de charger la valeur actuelle. Laissez vide pour la conserver.');
            })
            .finally(() => {
                if (requestId === editRequestId.current) {
                    setLoadingValue(false);
                }
            });
    };

    const closeForm = () => {
        editRequestId.current += 1;
        setFormOpen(false);
        setEditing(null);
        setValuePrefilled(false);
        setLoadingValue(false);
        setFormError(null);
    };

    const submitForm = async () => {
        if (!form.key.trim()) {
            setFormError('La clé est obligatoire.');

            return;
        }

        if (loadingValue) {
            return;
        }

        setSubmitting(true);
        setFormError(null);

        const rawValue = valuePrefilled ? form.value : (form.value || undefined);
        let nextValue = rawValue;
        let nextMultiline = form.is_multiline;

        if (typeof rawValue === 'string' && /[\r\n]/.test(rawValue)) {
            if (rawValue.includes('-----BEGIN ')) {
                nextMultiline = true;
            } else {
                // Base64 wrapé (clé Tesla HA, etc.) : une ligne sinon Compose casse sur `/`.
                nextValue = rawValue.replace(/\s+/g, '');
                nextMultiline = false;
            }
        }

        try {
            if (editing) {
                await domainApi.updateApplicationEnvironmentVariable(applicationUuid, editing.uuid, {
                    value: nextValue,
                    comment: form.comment,
                    is_runtime: form.is_runtime,
                    is_buildtime: form.is_buildtime,
                    is_multiline: nextMultiline,
                    is_literal: form.is_literal,
                });
            } else {
                await domainApi.createApplicationEnvironmentVariable(applicationUuid, {
                    ...form,
                    value: nextValue ?? '',
                    is_multiline: nextMultiline,
                });
            }

            closeForm();
            await query.reload();
            setSuccess('Variable enregistrée. Redémarre ou redéploie l’application pour l’injecter dans le conteneur.');
        } catch {
            setFormError(editing
                ? 'La mise à jour de la variable a échoué.'
                : 'La création de la variable a échoué.');
        } finally {
            setSubmitting(false);
        }
    };

    const importEnvFile = async (file: File) => {
        if (file.size > 262144) {
            setSuccess(null);
            setBannerError('Le fichier .env dépasse 256 Ko.');

            return;
        }

        setImporting(true);
        setBannerError(null);
        setSuccess(null);

        try {
            const contents = await readEnvFile(file);

            if (contents.trim() === '') {
                setBannerError('Le fichier .env est vide.');

                return;
            }

            const response = await domainApi.importApplicationEnvironmentVariables(applicationUuid, {
                contents,
                is_preview: scope === 'preview',
            });
            const { created, updated, skipped } = response.data;
            const imported = created + updated;
            const skippedCount = skipped.length;
            const parts = [
                `${imported} variable${imported > 1 ? 's' : ''} importée${imported > 1 ? 's' : ''}`,
            ];

            if (created > 0) {
                parts.push(`${created} créée${created > 1 ? 's' : ''}`);
            }

            if (updated > 0) {
                parts.push(`${updated} mise${updated > 1 ? 's' : ''} à jour`);
            }

            if (skippedCount > 0) {
                parts.push(`${skippedCount} ignorée${skippedCount > 1 ? 's' : ''}`);
            }

            await query.reload();
            setSuccess(`${parts.join(' · ')}. Redémarre ou redéploie l’application pour les injecter.`);
        } catch (error) {
            setBannerError(error instanceof Error && error.message !== ''
                ? error.message
                : 'L’import du fichier .env a échoué. Vérifie le format KEY=VALUE.');
        } finally {
            setImporting(false);

            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    const deleteVariable = async () => {
        if (!pendingDelete) {
            return;
        }

        setDeleting(true);

        try {
            await domainApi.deleteApplicationEnvironmentVariable(applicationUuid, pendingDelete.uuid);
            setPendingDelete(null);
            await query.reload();
        } finally {
            setDeleting(false);
        }
    };

    return (
        <section class="grid min-w-0 gap-2.5 sm:gap-3 md:gap-4 overflow-hidden rounded-2xl border border-base-300/70 bg-base-100 p-5 shadow-sm">
            <div class="toolbar-row">
                <div class="min-w-0 grid flex-1 gap-1">
                    <div class="flex items-center gap-2">
                        <Braces class="size-3.5 sm:size-4 text-base-content/45" aria-hidden />
                        <p class="text-xs sm:text-sm font-semibold">Variables d’environnement</p>
                    </div>
                    <p class="text-xs text-base-content/50">
                        Variables injectées au build et au runtime de cette application.
                        Après modification, un redémarrage / redéploiement est nécessaire.
                    </p>
                </div>
                <ActionToolbar>
                    <button class="btn btn-ghost btn-sm rounded-full" type="button" onClick={() => void query.reload()}>
                        <RefreshCw class="size-3.5" aria-hidden />
                        Actualiser
                    </button>
                    {canAct && (
                        <>
                            <input
                                ref={fileInputRef}
                                id="application-env-file"
                                class="sr-only"
                                type="file"
                                aria-label="Fichier .env"
                                accept=".env,.txt,text/plain"
                                disabled={importing}
                                onChange={(event) => {
                                    const file = (event.target as HTMLInputElement).files?.[0];

                                    if (file) {
                                        void importEnvFile(file);
                                    }
                                }}
                            />
                            <button
                                class="btn btn-ghost btn-sm rounded-full"
                                type="button"
                                disabled={importing}
                                onClick={() => fileInputRef.current?.click()}
                            >
                                {importing
                                    ? <LoaderCircle class="size-3.5 animate-spin" aria-hidden />
                                    : <Upload class="size-3.5" aria-hidden />}
                                Importer .env
                            </button>
                            <button class="btn btn-primary btn-sm rounded-full" type="button" onClick={openCreate}>
                                <Plus class="size-3.5" aria-hidden />
                                Ajouter
                            </button>
                        </>
                    )}
                </ActionToolbar>
            </div>

            {success && (
                <p class="rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-sm text-success" role="status">
                    {success}
                </p>
            )}
            {bannerError && (
                <p class="rounded-xl border border-error/30 bg-error/10 px-3 py-2 text-sm text-error" role="alert">
                    {bannerError}
                </p>
            )}
            <Tabs
                items={scopeTabs}
                active={scope}
                onChange={(nextScope) => {
                    setScope(nextScope as ScopeTab);
                    setSearch('');
                }}
            />

            <div class="min-w-0">
                <FilterBar
                    query={search}
                    onQueryChange={setSearch}
                    placeholder="Rechercher une clé ou un commentaire…"
                />
            </div>

            <DataState
                loading={query.loading}
                error={query.error}
                empty={filtered.length === 0}
                emptyMessage={`Aucune variable ${scope === 'preview' ? 'preview' : 'de production'} pour cette application.`}
                onRetry={() => void query.reload()}
            >
                <Table
                    embedded
                    headers={['Clé', 'Options', 'Commentaire', 'Valeur', ...(canAct ? [''] : [])]}
                    caption={`Variables ${scope === 'preview' ? 'preview' : 'de production'}`}
                >
                    {filtered.map((variable) => {
                        const flags = variableFlags(variable);
                        const canDelete = variable.is_deletable ?? variable.is_editable;
                        const canManage = variable.is_editable || canDelete;

                        return (
                            <tr key={variable.uuid}>
                                <td class="max-w-[11rem] truncate font-mono text-xs font-medium">{variable.key}</td>
                                <td class="min-w-[6.5rem]">
                                    {flags.length === 0 ? (
                                        <span class="text-xs text-base-content/40">—</span>
                                    ) : (
                                        <div class="flex flex-wrap gap-1">
                                            {flags.map((flag) => (
                                                <StatusBadge key={flag} label={flag} tone="neutral" />
                                            ))}
                                        </div>
                                    )}
                                </td>
                                <td class="max-w-[10rem] truncate text-xs text-base-content/60">
                                    {variable.comment || '—'}
                                </td>
                                <td class="max-w-[12rem] text-xs">
                                    <VariableValueCell applicationUuid={applicationUuid} variable={variable} />
                                </td>
                                {canAct && (
                                    <td class="w-0 whitespace-nowrap text-end">
                                        {canManage ? (
                                            <ActionToolbar>
                                                {variable.is_editable && (
                                                    <button
                                                        class="btn btn-ghost btn-xs btn-square"
                                                        type="button"
                                                        aria-label={`Modifier ${variable.key}`}
                                                        title="Modifier"
                                                        onClick={() => openEdit(variable)}
                                                    >
                                                        <Pencil class="size-3.5" aria-hidden />
                                                    </button>
                                                )}
                                                {canDelete && (
                                                    <button
                                                        class="btn btn-ghost btn-xs btn-square text-error"
                                                        type="button"
                                                        aria-label={`Supprimer ${variable.key}`}
                                                        title="Supprimer"
                                                        onClick={() => setPendingDelete(variable)}
                                                    >
                                                        <Trash2 class="size-3.5" aria-hidden />
                                                    </button>
                                                )}
                                                {!variable.is_editable && canDelete && (
                                                    <span class="text-xs text-base-content/40">Auto</span>
                                                )}
                                            </ActionToolbar>
                                        ) : (
                                            <span class="text-xs text-base-content/40">Auto</span>
                                        )}
                                    </td>
                                )}
                            </tr>
                        );
                    })}
                </Table>
            </DataState>

            {formOpen && (
                <div class="fixed inset-0 z-50 grid place-items-center bg-base-300/50 p-4 backdrop-blur-sm">
                    <div class="w-full max-w-lg rounded-2xl border border-base-300/70 bg-base-100 p-5 shadow-xl">
                        <h3 class="text-sm sm:text-base font-semibold">
                            {editing ? `Modifier ${editing.key}` : 'Nouvelle variable'}
                        </h3>
                        <p class="mt-1 text-xs text-base-content/55">
                            {scope === 'preview'
                                ? 'Variable utilisée uniquement pour les déploiements preview.'
                                : 'Variable utilisée pour les déploiements de production.'}
                        </p>

                        <form class="mt-4 grid gap-3" onSubmit={(event) => {
                            event.preventDefault();
                            void submitForm();
                        }}
                        >
                            {!editing && (
                                <label class="grid gap-1 text-sm">
                                    <span class="text-xs font-medium text-base-content/60">Clé</span>
                                    <input
                                        class="input input-bordered input-sm font-mono"
                                        required
                                        value={form.key}
                                        onInput={(event) => setForm((current) => ({
                                            ...current,
                                            key: (event.target as HTMLInputElement).value,
                                        }))}
                                    />
                                </label>
                            )}

                            <label class="grid gap-1 text-sm">
                                <span class="text-xs font-medium text-base-content/60">
                                    Valeur {editing && !valuePrefilled ? '(laisser vide pour conserver)' : ''}
                                </span>
                                <div class="relative">
                                    <textarea
                                        class="textarea textarea-bordered textarea-sm w-full font-mono"
                                        rows={form.is_multiline ? 5 : 2}
                                        value={form.value ?? ''}
                                        disabled={loadingValue}
                                        aria-busy={loadingValue}
                                        onInput={(event) => setForm((current) => ({
                                            ...current,
                                            value: (event.target as HTMLTextAreaElement).value,
                                        }))}
                                    />
                                    {loadingValue && (
                                        <span class="absolute inset-y-0 right-3 flex items-center text-base-content/50">
                                            <LoaderCircle class="size-3.5 sm:size-4 animate-spin" aria-hidden />
                                            <span class="sr-only">Chargement de la valeur…</span>
                                        </span>
                                    )}
                                </div>
                            </label>

                            <label class="grid gap-1 text-sm">
                                <span class="text-xs font-medium text-base-content/60">Commentaire</span>
                                <input
                                    class="input input-bordered input-sm"
                                    value={form.comment ?? ''}
                                    onInput={(event) => setForm((current) => ({
                                        ...current,
                                        comment: (event.target as HTMLInputElement).value,
                                    }))}
                                />
                            </label>

                            <div class="flex flex-wrap gap-2 sm:gap-3 text-xs">
                                {(['is_runtime', 'is_buildtime', 'is_multiline', 'is_literal'] as const).map((flag) => (
                                    <label class="flex items-center gap-2" key={flag}>
                                        <input
                                            checked={form[flag]}
                                            class="checkbox checkbox-xs"
                                            type="checkbox"
                                            onChange={(event) => setForm((current) => ({
                                                ...current,
                                                [flag]: (event.target as HTMLInputElement).checked,
                                            }))}
                                        />
                                        <span>
                                            {flag === 'is_runtime' && 'Runtime'}
                                            {flag === 'is_buildtime' && 'Build'}
                                            {flag === 'is_multiline' && 'Multiligne'}
                                            {flag === 'is_literal' && 'Littéral'}
                                        </span>
                                    </label>
                                ))}
                            </div>

                            {formError && <p class="text-sm text-error" role="alert">{formError}</p>}

                            <div class="form-actions pt-2">
                                <button class="btn btn-ghost btn-sm" type="button" onClick={closeForm} disabled={submitting}>
                                    Annuler
                                </button>
                                <button class="btn btn-primary btn-sm" type="submit" disabled={submitting || loadingValue}>
                                    {submitting || loadingValue
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
                    title="Supprimer la variable"
                    message={`Confirmer la suppression de « ${pendingDelete.key} » ?`}
                    tone="danger"
                    loading={deleting}
                    onCancel={() => setPendingDelete(null)}
                    onConfirm={() => void deleteVariable()}
                />
            )}
        </section>
    );
}
