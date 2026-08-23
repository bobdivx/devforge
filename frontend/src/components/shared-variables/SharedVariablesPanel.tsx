import { Braces, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-preact';
import { useMemo, useState } from 'preact/hooks';
import { ActionToolbar } from '../ui/ActionToolbar';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { DataState } from '../ui/DataState';
import { FilterBar } from '../ui/FilterBar';
import { StatusBadge } from '../ui/StatusBadge';
import { Table } from '../ui/Table';
import { Tabs } from '../ui/Tabs';
import { SharedVariableFormModal } from './SharedVariableFormModal';
import {
    domainApi,
    type SharedVariable,
    type SharedVariableInput,
    type SharedVariableUpdateInput,
} from '../../lib/domain-api';
import {
    parseSharedVariableScope,
    sharedVariableScopePath,
    sharedVariableScopeTabs,
    type SharedVariableScopeTab,
} from '../../lib/shared-variables-routes';
import { useApiQuery } from '../../lib/use-api-query';
import { navigateTo } from '../../lib/use-navigate';

const scopeLabels: Record<Exclude<SharedVariableScopeTab, 'overview'>, string> = {
    team: 'Équipe',
    project: 'Projet',
    environment: 'Environnement',
    server: 'Serveur',
};

type SharedVariablesPanelProps = {
    path: string;
    embedded?: boolean;
    canManage?: boolean;
    forceScope?: Exclude<SharedVariableScopeTab, 'overview'>;
    extraVariables?: SharedVariable[];
    renderExtraActions?: (variable: SharedVariable) => preact.JSX.Element;
};

function variableFlags(variable: SharedVariable) {
    const flags: string[] = [];

    if (variable.is_multiline) {
        flags.push('Multiligne');
    }

    if (variable.is_literal) {
        flags.push('Littéral');
    }

    if (variable.is_shown_once) {
        flags.push('Affichage unique');
    }

    return flags;
}

function variableContext(variable: SharedVariable): string {
    const parts: string[] = [];

    if (variable.project_name) {
        parts.push(variable.project_name);
    } else if (variable.project_id) {
        parts.push(`projet #${variable.project_id}`);
    }

    if (variable.environment_name) {
        parts.push(variable.environment_name);
    } else if (variable.environment_id) {
        parts.push(`env. #${variable.environment_id}`);
    }

    if (variable.server_name) {
        parts.push(variable.server_name);
    } else if (variable.server_id) {
        parts.push(`serveur #${variable.server_id}`);
    }

    return parts.length > 0 ? parts.join(' · ') : '—';
}

function OverviewCards({
    counts,
    onNavigate,
}: {
    counts: Record<Exclude<SharedVariableScopeTab, 'overview'>, number>;
    onNavigate: (scope: SharedVariableScopeTab) => void;
}) {
    return (
        <div class="grid gap-2 sm:gap-3 md:grid-cols-2">
            {(Object.keys(scopeLabels) as Array<Exclude<SharedVariableScopeTab, 'overview'>>).map((scope) => {
                const tab = sharedVariableScopeTabs.find(({ id }) => id === scope);

                return (
                    <button
                        class="rounded-2xl border border-base-300/70 bg-base-100 p-4 text-left shadow-sm transition hover:border-primary/30 hover:shadow-md"
                        type="button"
                        key={scope}
                        onClick={() => onNavigate(scope)}
                    >
                        <div class="flex items-start justify-between gap-3">
                            <div>
                                <p class="text-xs sm:text-sm font-semibold">{scopeLabels[scope]}</p>
                                <p class="mt-1 text-xs text-base-content/55">{tab?.description}</p>
                            </div>
                            <span class="text-2xl font-semibold tabular-nums">{counts[scope]}</span>
                        </div>
                    </button>
                );
            })}
        </div>
    );
}

function VariablesTable({
    variables,
    canManage,
    onEdit,
    onDelete,
    renderExtraActions,
}: {
    variables: SharedVariable[];
    canManage: boolean;
    onEdit: (variable: SharedVariable) => void;
    onDelete: (variable: SharedVariable) => void;
    renderExtraActions?: (variable: SharedVariable) => preact.JSX.Element;
}) {
    return (
        <Table
            headers={canManage
                ? ['Clé', 'Contexte', 'Commentaire', 'Options', 'Valeur', 'Actions']
                : ['Clé', 'Contexte', 'Commentaire', 'Options', 'Valeur']}
            caption="Variables partagées de l’équipe active"
        >
            {variables.map((variable) => {
                const flags = variableFlags(variable);

                return (
                    <tr key={variable.id}>
                        <td class="font-mono text-xs font-medium">{variable.key}</td>
                        <td class="text-xs text-base-content/60">{variableContext(variable)}</td>
                        <td class="max-w-xs truncate text-xs">{variable.comment || '—'}</td>
                        <td>
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
                        <td>
                            <StatusBadge
                                label={variable.value ? 'Définie' : 'Vide'}
                                tone={variable.value ? 'success' : 'neutral'}
                            />
                        </td>
                        {canManage && (
                            <td>
                                {(variable as any).isExtra && renderExtraActions ? (
                                    renderExtraActions(variable)
                                ) : (
                                    <div class="action-toolbar">
                                        <button class="btn btn-ghost btn-xs" type="button" aria-label={`Modifier ${variable.key}`} onClick={() => onEdit(variable)}>
                                            <Pencil class="size-3.5" aria-hidden />
                                        </button>
                                        <button class="btn btn-ghost btn-xs text-error" type="button" aria-label={`Supprimer ${variable.key}`} onClick={() => onDelete(variable)}>
                                            <Trash2 class="size-3.5" aria-hidden />
                                        </button>
                                    </div>
                                )}
                            </td>
                        )}
                    </tr>
                );
            })}
        </Table>
    );
}

export function SharedVariablesPanel({ path, embedded = false, canManage = false, forceScope, extraVariables = [], renderExtraActions }: SharedVariablesPanelProps) {
    const activeScope = forceScope || parseSharedVariableScope(path);
    const query = useApiQuery('shared-variables', () => domainApi.sharedVariables());
    const [search, setSearch] = useState('');
    const [createOpen, setCreateOpen] = useState(false);
    const [editVariable, setEditVariable] = useState<SharedVariable | null>(null);
    const [deleteVariable, setDeleteVariable] = useState<SharedVariable | null>(null);
    const [mutationError, setMutationError] = useState<string | null>(null);

    const grouped = query.data?.data ?? {
        team: [],
        project: [],
        environment: [],
        server: [],
    };

    const counts = useMemo(() => ({
        team: grouped.team.length,
        project: grouped.project.length,
        environment: grouped.environment.length,
        server: grouped.server.length,
    }), [grouped]);

    const activeVariables = useMemo(() => {
        if (activeScope === 'overview') {
            return [
                ...grouped.team,
                ...grouped.project,
                ...grouped.environment,
                ...grouped.server,
            ];
        }

        const base = grouped[activeScope] ?? [];
        if (activeScope === 'team' && extraVariables.length > 0) {
            return [...base, ...extraVariables];
        }
        return base;
    }, [activeScope, grouped, extraVariables]);

    const filteredVariables = useMemo(() => {
        const normalized = search.trim().toLowerCase();
        if (!normalized) {
            return activeVariables;
        }

        return activeVariables.filter((variable) => [
            variable.key,
            variable.comment ?? '',
            variableContext(variable),
        ].join(' ').toLowerCase().includes(normalized));
    }, [activeVariables, search]);

    const tabs = embedded
        ? sharedVariableScopeTabs.filter(({ id }) => id !== 'overview')
        : sharedVariableScopeTabs;

    const tabItems = tabs.map(({ id, label }) => ({ id, label }));
    const formScope = (embedded && activeScope === 'overview' ? 'team' : activeScope) as Exclude<SharedVariableScopeTab, 'overview'>;
    const canCreate = canManage && activeScope !== 'overview';

    const reload = async () => {
        setMutationError(null);
        await query.reload();
    };

    const runMutation = async (mutation: () => Promise<void>) => {
        setMutationError(null);
        try {
            await mutation();
            await reload();
        } catch {
            setMutationError('La modification a échoué. Vérifiez les champs et vos permissions.');
            throw new Error('mutation failed');
        }
    };

    return (
        <div class="grid gap-2.5 sm:gap-3 md:gap-4">
            <div class="toolbar-row">
                {!forceScope && (
                    <p class="text-xs text-base-content/55">
                        Variables d’équipe, de projet, d’environnement et de serveur pour l’équipe active.
                    </p>
                )}
                <ActionToolbar>
                    <button class="btn btn-ghost btn-sm" type="button" onClick={() => void reload()}>
                        <RefreshCw class="size-3.5" aria-hidden />
                        Actualiser
                    </button>
                    {canCreate && (
                        <button class="btn btn-primary btn-sm" type="button" onClick={() => setCreateOpen(true)}>
                            <Plus class="size-3.5" aria-hidden />
                            Nouvelle variable
                        </button>
                    )}
                </ActionToolbar>
            </div>

            {mutationError && <div class="alert alert-error min-h-8 py-1 text-xs" role="alert">{mutationError}</div>}

            {!forceScope && (
                <Tabs
                    items={tabItems}
                    active={embedded && activeScope === 'overview' ? 'team' : activeScope}
                    onChange={(tabId) => navigateTo(sharedVariableScopePath(tabId as SharedVariableScopeTab))}
                />
            )}

            <DataState loading={query.loading} error={query.error} onRetry={() => void reload()}>
                {activeScope === 'overview' && !embedded ? (
                    <OverviewCards
                        counts={counts}
                        onNavigate={(scope) => navigateTo(sharedVariableScopePath(scope))}
                    />
                ) : (
                    <>
                        <FilterBar
                            query={search}
                            onQueryChange={setSearch}
                            placeholder="Rechercher une clé ou un commentaire…"
                        />
                        <DataState
                            loading={false}
                            error={null}
                            empty={filteredVariables.length === 0}
                            emptyMessage="Aucune variable pour cette portée."
                            onRetry={() => void reload()}
                        >
                            <VariablesTable
                                variables={filteredVariables}
                                canManage={canManage}
                                onEdit={setEditVariable}
                                onDelete={setDeleteVariable}
                                renderExtraActions={renderExtraActions}
                            />
                        </DataState>
                    </>
                )}
            </DataState>

            {embedded && (
                <div class="flex items-center gap-2 rounded-xl border border-base-300/70 bg-base-200/40 px-3 py-2 text-xs text-base-content/55">
                    <Braces class="size-3.5 shrink-0" aria-hidden />
                    <span>Les variables sont partagées entre les ressources de l’équipe active.</span>
                </div>
            )}

            {canCreate && (
                <SharedVariableFormModal
                    open={createOpen}
                    mode="create"
                    scope={formScope}
                    onClose={() => setCreateOpen(false)}
                    onSubmit={async (input) => {
                        await runMutation(async () => {
                            await domainApi.createSharedVariable(input as SharedVariableInput);
                        });
                    }}
                />
            )}

            {editVariable && (
                <SharedVariableFormModal
                    open
                    mode="edit"
                    scope={editVariable.scope as Exclude<SharedVariableScopeTab, 'overview'>}
                    variable={editVariable}
                    onClose={() => setEditVariable(null)}
                    onSubmit={async (input) => {
                        await runMutation(async () => {
                            await domainApi.updateSharedVariable(editVariable.id, input as SharedVariableUpdateInput);
                        });
                        setEditVariable(null);
                    }}
                />
            )}

            <ConfirmDialog
                open={deleteVariable !== null}
                title="Supprimer la variable"
                message={deleteVariable ? `Supprimer définitivement « ${deleteVariable.key} » ?` : ''}
                confirmLabel="Supprimer"
                tone="danger"
                onCancel={() => setDeleteVariable(null)}
                onConfirm={() => {
                    if (!deleteVariable) {
                        return;
                    }

                    void runMutation(async () => {
                        await domainApi.deleteSharedVariable(deleteVariable.id);
                    }).then(() => setDeleteVariable(null));
                }}
            />
        </div>
    );
}
