import { Braces, Eye, EyeOff, LoaderCircle, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ActionToolbar } from '../ui/ActionToolbar';
import { DataState } from '../ui/DataState';
import { FilterBar } from '../ui/FilterBar';
import { StatusBadge } from '../ui/StatusBadge';
import { Table } from '../ui/Table';
import {
    domainApi,
    type ApplicationEnvironmentVariable,
    type ApplicationEnvironmentVariableInput,
} from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';

type EnvResourceType = 'databases' | 'services';

const defaultForm = (): ApplicationEnvironmentVariableInput => ({
    key: '',
    value: '',
    comment: '',
    is_runtime: true,
    is_buildtime: false,
    is_multiline: false,
    is_literal: false,
});

function variableFlags(variable: ApplicationEnvironmentVariable): string[] {
    const flags: string[] = [];

    if (variable.is_runtime) {
        flags.push('Runtime');
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

    return flags;
}

type Props = {
    resourceType?: EnvResourceType;
    resourceUuid?: string;
    canAct: boolean;
};

function VariableValueCell({
    resourceType,
    resourceUuid,
    variable,
}: {
    resourceType: EnvResourceType;
    resourceUuid: string;
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
            const response = await domainApi.revealResourceEnvironmentVariable(
                resourceType,
                resourceUuid,
                variable.uuid,
            );
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

export function DatabaseEnvironmentVariablesPanel({
    resourceType = 'databases',
    resourceUuid = '',
    canAct,
}: Props) {
    const uuid = resourceUuid;
    const resourceLabel = resourceType === 'services' ? 'ce service' : 'cette base de données';
    const caption = resourceType === 'services' ? 'Variables du service' : 'Variables de la base';

    const query = useApiQuery(
        `resource-env:${resourceType}:${uuid}`,
        () => domainApi.resourceEnvironmentVariables(resourceType, uuid),
    );
    const [search, setSearch] = useState('');
    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState<ApplicationEnvironmentVariable | null>(null);
    const [form, setForm] = useState<ApplicationEnvironmentVariableInput>(defaultForm());
    const [valuePrefilled, setValuePrefilled] = useState(false);
    const [loadingValue, setLoadingValue] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const [pendingDelete, setPendingDelete] = useState<ApplicationEnvironmentVariable | null>(null);
    const [deleting, setDeleting] = useState(false);
    const editRequestId = useRef(0);

    const variables = query.data?.data ?? [];

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
        setForm(defaultForm());
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

        void domainApi.revealResourceEnvironmentVariable(resourceType, uuid, variable.uuid)
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

        try {
            if (editing) {
                await domainApi.updateResourceEnvironmentVariable(resourceType, uuid, editing.uuid, {
                    value: valuePrefilled ? form.value : (form.value || undefined),
                    comment: form.comment,
                    is_runtime: form.is_runtime,
                    is_multiline: form.is_multiline,
                    is_literal: form.is_literal,
                });
            } else {
                await domainApi.createResourceEnvironmentVariable(resourceType, uuid, form);
            }

            closeForm();
            await query.reload();
        } catch {
            setFormError(editing
                ? 'La mise à jour de la variable a échoué.'
                : 'La création de la variable a échoué.');
        } finally {
            setSubmitting(false);
        }
    };

    const deleteVariable = async () => {
        if (!pendingDelete) {
            return;
        }

        setDeleting(true);

        try {
            await domainApi.deleteResourceEnvironmentVariable(resourceType, uuid, pendingDelete.uuid);
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
                        Variables injectées au démarrage de {resourceLabel}.
                    </p>
                </div>
                <ActionToolbar>
                    <button class="btn btn-ghost btn-sm rounded-full" type="button" onClick={() => void query.reload()}>
                        <RefreshCw class="size-3.5" aria-hidden />
                        Actualiser
                    </button>
                    {canAct && (
                        <button class="btn btn-primary btn-sm rounded-full" type="button" onClick={openCreate}>
                            <Plus class="size-3.5" aria-hidden />
                            Ajouter
                        </button>
                    )}
                </ActionToolbar>
            </div>

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
                emptyMessage={`Aucune variable pour ${resourceLabel}.`}
                onRetry={() => void query.reload()}
            >
                <Table
                    embedded
                    headers={['Clé', 'Options', 'Commentaire', 'Valeur', ...(canAct ? [''] : [])]}
                    caption={caption}
                >
                    {filtered.map((variable) => {
                        const flags = variableFlags(variable);

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
                                    <VariableValueCell
                                        resourceType={resourceType}
                                        resourceUuid={uuid}
                                        variable={variable}
                                    />
                                </td>
                                {canAct && (
                                    <td class="w-0 whitespace-nowrap text-end">
                                        {variable.is_editable ? (
                                            <ActionToolbar>
                                                <button
                                                    class="btn btn-ghost btn-xs btn-square"
                                                    type="button"
                                                    aria-label={`Modifier ${variable.key}`}
                                                    title="Modifier"
                                                    onClick={() => openEdit(variable)}
                                                >
                                                    <Pencil class="size-3.5" aria-hidden />
                                                </button>
                                                <button
                                                    class="btn btn-ghost btn-xs btn-square text-error"
                                                    type="button"
                                                    aria-label={`Supprimer ${variable.key}`}
                                                    title="Supprimer"
                                                    onClick={() => setPendingDelete(variable)}
                                                >
                                                    <Trash2 class="size-3.5" aria-hidden />
                                                </button>
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
                            Variable injectée dans le conteneur de {resourceLabel}.
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
                                {(['is_runtime', 'is_multiline', 'is_literal'] as const).map((flag) => (
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
