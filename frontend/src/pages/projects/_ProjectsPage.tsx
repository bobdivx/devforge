import { Plus, RefreshCw, Save, Trash2 } from 'lucide-preact';
import { useMemo, useState } from 'preact/hooks';
import { ActionToolbar } from '../../components/ui/ActionToolbar';
import { PageHeader } from '../../components/PageHeader';
import { Card } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { DataState } from '../../components/ui/DataState';
import { FilterBar } from '../../components/ui/FilterBar';
import { Modal } from '../../components/ui/Modal';
import { StatusBadge } from '../../components/ui/StatusBadge';
import type { BootstrapPermissions } from '../../lib/bootstrap';
import { domainApi, type Project, type ProjectInput } from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';

type ProjectsPageProps = {
    permissions: BootstrapPermissions;
    embedded?: boolean;
};

function ProjectFields({ initial, submitLabel, onSubmit }: {
    initial?: Pick<Project, 'name' | 'description'>;
    submitLabel: string;
    onSubmit: (input: ProjectInput) => Promise<void>;
}) {
    const [name, setName] = useState(initial?.name ?? '');
    const [description, setDescription] = useState(initial?.description ?? '');
    const [saving, setSaving] = useState(false);

    return (
        <form
            class="grid gap-2"
            onSubmit={async (event) => {
                event.preventDefault();
                setSaving(true);
                try {
                    await onSubmit({ name, description: description ?? '' });
                    if (!initial) {
                        setName('');
                        setDescription('');
                    }
                } finally {
                    setSaving(false);
                }
            }}
        >
            <label class="grid gap-1 text-xs">
                <span>Nom</span>
                <input class="input input-bordered input-sm w-full" required maxLength={255} value={name} onInput={(event) => setName(event.currentTarget.value)} />
            </label>
            <label class="grid gap-1 text-xs">
                <span>Description</span>
                <input class="input input-bordered input-sm w-full" maxLength={1024} value={description ?? ''} onInput={(event) => setDescription(event.currentTarget.value)} />
            </label>
            <button class="btn btn-primary btn-sm w-fit" type="submit" disabled={saving || name.trim() === ''}>
                {initial ? <Save class="size-3.5" aria-hidden /> : <Plus class="size-3.5" aria-hidden />}
                {saving ? 'Enregistrement…' : submitLabel}
            </button>
        </form>
    );
}

function ProjectCard({ project, permissions, onChanged, onMutate }: {
    project: Project;
    permissions: BootstrapPermissions;
    onChanged: () => Promise<void>;
    onMutate: (mutation: () => Promise<void>) => Promise<void>;
}) {
    const [expanded, setExpanded] = useState(false);
    const [editOpen, setEditOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const canManage = permissions.manage_team;
    const environmentsQuery = useApiQuery(
        expanded ? `environments:${project.uuid}` : null,
        () => domainApi.environments(project.uuid),
    );
    const environments = environmentsQuery.data?.data ?? [];

    const refresh = async () => {
        await Promise.all([onChanged(), environmentsQuery.reload()]);
    };

    return (
        <>
            <Card title={project.name} eyebrow={project.description || 'Sans description'} class="h-full">
                <button
                    class="flex w-full items-center justify-between gap-2 text-left text-xs text-primary"
                    type="button"
                    onClick={() => setExpanded((current) => !current)}
                >
                    <span>{expanded ? 'Masquer les environnements' : 'Voir les environnements'}</span>
                    <StatusBadge label={`${environments.length || '…'} env.`} tone="neutral" />
                </button>

                {expanded && (
                    <DataState
                        loading={environmentsQuery.loading}
                        error={environmentsQuery.error}
                        empty={environments.length === 0}
                        emptyMessage="Aucun environnement."
                        onRetry={() => void environmentsQuery.reload()}
                    >
                        <ul class="divide-y divide-base-300">
                            {environments.map((environment) => (
                                <li class="flex items-center justify-between gap-2 py-2" key={environment.uuid}>
                                    <div class="min-w-0">
                                        <p class="truncate text-xs font-medium">{environment.name}</p>
                                        <p class="truncate text-[11px] text-base-content/45">{environment.description || 'Sans description'}</p>
                                    </div>
                                    {canManage && (
                                        <button
                                            class="btn btn-ghost btn-xs text-error"
                                            type="button"
                                            aria-label={`Supprimer ${environment.name}`}
                                            onClick={async () => {
                                                if (!window.confirm(`Supprimer « ${environment.name} » ?`)) return;
                                                await onMutate(async () => {
                                                    await domainApi.deleteEnvironment(project.uuid, environment.uuid);
                                                    await refresh();
                                                });
                                            }}
                                        >
                                            <Trash2 class="size-3" aria-hidden />
                                        </button>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </DataState>
                )}

                <ActionToolbar class="mt-2 border-t border-base-300 pt-2">
                    {permissions.create_resources && expanded && (
                        <details>
                            <summary class="cursor-pointer text-xs text-primary">Ajouter un environnement</summary>
                            <div class="pt-2">
                                <ProjectFields submitLabel="Ajouter" onSubmit={async (input) => {
                                    await onMutate(async () => {
                                        await domainApi.createEnvironment(project.uuid, input);
                                        await refresh();
                                    });
                                }} />
                            </div>
                        </details>
                    )}
                    {canManage && (
                        <>
                            <button class="btn btn-ghost btn-xs" type="button" onClick={() => setEditOpen(true)}>Modifier</button>
                            <button class="btn btn-ghost btn-xs text-error" type="button" onClick={() => setDeleteOpen(true)}>Supprimer</button>
                        </>
                    )}
                </ActionToolbar>
            </Card>

            <Modal open={editOpen} title={`Modifier ${project.name}`} onClose={() => setEditOpen(false)}>
                <ProjectFields
                    initial={project}
                    submitLabel="Enregistrer"
                    onSubmit={async (input) => {
                        await onMutate(async () => {
                            await domainApi.updateProject(project.uuid, input);
                            await refresh();
                            setEditOpen(false);
                        });
                    }}
                />
            </Modal>

            <ConfirmDialog
                open={deleteOpen}
                title="Supprimer le projet"
                message={`Supprimer « ${project.name} » ? Le projet doit être vide.`}
                tone="danger"
                confirmLabel="Supprimer"
                onCancel={() => setDeleteOpen(false)}
                onConfirm={async () => {
                    await onMutate(async () => {
                        await domainApi.deleteProject(project.uuid);
                        await onChanged();
                        setDeleteOpen(false);
                    });
                }}
            />
        </>
    );
}

export function ProjectsPage({ permissions, embedded = false }: ProjectsPageProps) {
    const query = useApiQuery('projects', () => domainApi.projects());
    const [queryText, setQueryText] = useState('');
    const [sort, setSort] = useState('name');
    const [createOpen, setCreateOpen] = useState(false);
    const [mutationError, setMutationError] = useState<string | null>(null);
    const projects = query.data?.data ?? [];

    const filtered = useMemo(() => {
        const normalized = queryText.trim().toLowerCase();
        const list = normalized
            ? projects.filter((project) => project.name.toLowerCase().includes(normalized)
                || (project.description ?? '').toLowerCase().includes(normalized))
            : [...projects];

        list.sort((a, b) => {
            if (sort === 'updated') {
                return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
            }
            return a.name.localeCompare(b.name, 'fr');
        });

        return list;
    }, [projects, queryText, sort]);

    const reload = async () => {
        setMutationError(null);
        await query.reload();
    };

    const runMutation = async (mutation: () => Promise<void>) => {
        setMutationError(null);
        try {
            await mutation();
        } catch {
            setMutationError('La modification a échoué. Vérifiez les champs et vos permissions.');
        }
    };

    return (
        <>
            {!embedded && (
                <PageHeader
                    title="Projets"
                    description="Projets et environnements de l’équipe active."
                    actions={(
                        <>
                            <button class="btn btn-ghost btn-sm" type="button" onClick={() => void reload()}>
                                <RefreshCw class="size-3.5" aria-hidden />
                                Actualiser
                            </button>
                            {permissions.create_resources && (
                                <button class="btn btn-primary btn-sm" type="button" onClick={() => setCreateOpen(true)}>
                                    <Plus class="size-3.5" aria-hidden />
                                    Nouveau projet
                                </button>
                            )}
                        </>
                    )}
                />
            )}
            {embedded && (
                <div class="toolbar-row">
                    <p class="text-xs text-base-content/55">Projets et environnements de l’équipe active.</p>
                    <ActionToolbar>
                        <button class="btn btn-ghost btn-sm" type="button" onClick={() => void reload()}>
                            <RefreshCw class="size-3.5" aria-hidden />
                            Actualiser
                        </button>
                        {permissions.create_resources && (
                            <button class="btn btn-primary btn-sm" type="button" onClick={() => setCreateOpen(true)}>
                                <Plus class="size-3.5" aria-hidden />
                                Nouveau projet
                            </button>
                        )}
                    </ActionToolbar>
                </div>
            )}

            <FilterBar
                query={queryText}
                onQueryChange={setQueryText}
                sort={sort}
                sortOptions={[
                    { value: 'name', label: 'Nom (A→Z)' },
                    { value: 'updated', label: 'Dernière mise à jour' },
                ]}
                onSortChange={setSort}
            />

            {mutationError && <div class="alert alert-error min-h-8 py-1 text-xs" role="alert">{mutationError}</div>}

            <DataState
                loading={query.loading}
                error={query.error}
                empty={filtered.length === 0}
                emptyMessage="Aucun projet dans cette équipe."
                onRetry={() => void reload()}
            >
                <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {filtered.map((project) => (
                        <ProjectCard project={project} permissions={permissions} onChanged={reload} onMutate={runMutation} key={project.uuid} />
                    ))}
                </div>
            </DataState>

            <Modal open={createOpen} title="Créer un projet" onClose={() => setCreateOpen(false)}>
                <ProjectFields
                    submitLabel="Créer"
                    onSubmit={async (input) => {
                        await runMutation(async () => {
                            await domainApi.createProject(input);
                            await reload();
                            setCreateOpen(false);
                        });
                    }}
                />
            </Modal>
        </>
    );
}
