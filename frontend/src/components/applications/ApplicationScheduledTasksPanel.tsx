import { Clock, LoaderCircle, Pencil, Play, Plus, RefreshCw, Trash2 } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { CronInput } from '../ui/CronInput';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ActionToolbar } from '../ui/ActionToolbar';
import { DataState } from '../ui/DataState';
import { StatusBadge } from '../ui/StatusBadge';
import { Table } from '../ui/Table';
import {
    domainApi,
    type ApplicationScheduledTask,
    type ApplicationScheduledTaskExecution,
    type ApplicationScheduledTaskInput,
} from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';

type ScheduledTaskResourceType = 'applications' | 'services';

type Props = {
    resourceType?: ScheduledTaskResourceType;
    resourceUuid?: string;
    canAct: boolean;
};

import { formatCron, normalizeCron } from '../../lib/cron-utils';
import { maskSecretsInText } from '../../lib/secret-masking';

const defaultForm = (): ApplicationScheduledTaskInput => ({
    name: '',
    command: '',
    frequency: 'daily',
    container: '',
    timeout: 300,
    enabled: true,
});

function executionTone(status: string | null | undefined): 'success' | 'warning' | 'error' | 'neutral' {
    if (status === 'success') {
        return 'success';
    }
    if (status === 'running') {
        return 'warning';
    }
    if (status === 'failed') {
        return 'error';
    }

    return 'neutral';
}


export function ApplicationScheduledTasksPanel({
    resourceType = 'applications',
    resourceUuid = '',
    canAct,
}: Props) {
    const uuid = resourceUuid;
    const query = useApiQuery(
        `scheduled-tasks:${resourceType}:${uuid}`,
        () => domainApi.resourceScheduledTasks(resourceType, uuid),
    );
    const tasks = query.data?.data ?? [];
    const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState<ApplicationScheduledTask | null>(null);
    const [form, setForm] = useState<ApplicationScheduledTaskInput>(defaultForm());
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const [pendingDelete, setPendingDelete] = useState<ApplicationScheduledTask | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [runningUuid, setRunningUuid] = useState<string | null>(null);
    const [actionMessage, setActionMessage] = useState<string | null>(null);

    const executionsQuery = useApiQuery(
        selectedUuid ? `scheduled-task-executions:${resourceType}:${uuid}:${selectedUuid}` : null,
        () => domainApi.resourceScheduledTaskExecutions(resourceType, uuid, selectedUuid as string),
    );

    useEffect(() => {
        if (tasks.length === 0) {
            setSelectedUuid(null);

            return;
        }

        if (!selectedUuid || !tasks.some((task) => task.uuid === selectedUuid)) {
            setSelectedUuid(tasks[0].uuid);
        }
    }, [tasks, selectedUuid]);

    const openCreate = () => {
        setEditing(null);
        setForm(defaultForm());
        setFormError(null);
        setFormOpen(true);
    };

    const openEdit = (task: ApplicationScheduledTask) => {
        setForm({
            name: task.name,
            command: task.command,
            frequency: normalizeCron(task.frequency),
            container: task.container ?? '',
            timeout: task.timeout,
            enabled: task.enabled,
        });
        setFormError(null);
        setFormOpen(true);
    };

    const closeForm = () => {
        setFormOpen(false);
        setEditing(null);
        setFormError(null);
    };

    const submitForm = async () => {
        const name = form.name?.trim() ?? '';
        const command = form.command?.trim() ?? '';
        const frequency = form.frequency?.trim() ?? '';

        if (!name || !command || !frequency) {
            setFormError('Nom, commande et fréquence sont obligatoires.');

            return;
        }

        setSubmitting(true);
        setFormError(null);

        try {
            const payload: ApplicationScheduledTaskInput = {
                ...form,
                name,
                command,
                frequency: normalizeCron(frequency),
                container: form.container?.trim() || null,
            };

            if (editing) {
                await domainApi.updateResourceScheduledTask(resourceType, uuid, editing.uuid, payload);
            } else {
                await domainApi.createResourceScheduledTask(resourceType, uuid, payload);
            }

            closeForm();
            setActionMessage(editing ? 'Tâche mise à jour.' : 'Tâche créée.');
            await query.reload();
        } catch {
            setFormError(editing ? 'La mise à jour a échoué.' : 'La création a échoué.');
        } finally {
            setSubmitting(false);
        }
    };

    const deleteTask = async () => {
        if (!pendingDelete) {
            return;
        }

        setDeleting(true);

        try {
            await domainApi.deleteResourceScheduledTask(resourceType, uuid, pendingDelete.uuid);
            setPendingDelete(null);
            setActionMessage('Tâche supprimée.');
            await query.reload();
        } finally {
            setDeleting(false);
        }
    };

    const runTask = async (task: ApplicationScheduledTask) => {
        setRunningUuid(task.uuid);
        setActionMessage(null);

        try {
            const response = await domainApi.runResourceScheduledTask(resourceType, uuid, task.uuid);
            setActionMessage(response.data.message);
            setSelectedUuid(task.uuid);
            await query.reload();
            await executionsQuery.reload();
        } catch {
            setActionMessage('L’exécution immédiate a échoué.');
        } finally {
            setRunningUuid(null);
        }
    };

    const toggleEnabled = async (task: ApplicationScheduledTask) => {
        try {
            await domainApi.updateResourceScheduledTask(resourceType, uuid, task.uuid, {
                enabled: !task.enabled,
            });
            await query.reload();
        } catch {
            setActionMessage('Impossible de modifier l’état de la tâche.');
        }
    };

    const executions: ApplicationScheduledTaskExecution[] = executionsQuery.data?.data ?? [];

    return (
        <section class="grid min-w-0 gap-2.5 sm:gap-3 md:gap-2.5 sm:gap-3 md:gap-4 overflow-hidden rounded-2xl border border-base-300/70 bg-base-100 p-5 shadow-sm">
            <div class="toolbar-row">
                <div class="min-w-0 grid flex-1 gap-1">
                    <div class="flex items-center gap-2">
                        <Clock class="size-3.5 sm:size-4 text-base-content/45" aria-hidden />
                        <p class="text-xs sm:text-sm font-semibold">Tâches planifiées</p>
                    </div>
                    <p class="text-xs text-base-content/50">
                        Cron et commandes exécutées dans le conteneur {resourceType === 'services' ? 'du service' : 'de l’application'}.
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

            {actionMessage && <p class="text-xs text-base-content/60" role="status">{actionMessage}</p>}

            <DataState
                loading={query.loading}
                error={query.error}
                empty={tasks.length === 0}
                emptyMessage="Aucune tâche planifiée pour cette application."
                onRetry={() => void query.reload()}
            >
                <div class="grid gap-2.5 sm:gap-3 md:gap-2.5 sm:gap-3 md:gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                    <Table
                        embedded
                        headers={['Nom', 'Fréquence', 'État', 'Dernière exécution', ...(canAct ? [''] : [])]}
                        caption="Tâches planifiées"
                    >
                        {tasks.map((task) => {
                            const selected = task.uuid === selectedUuid;
                            const latest = task.latest_execution;

                            return (
                                <tr
                                    key={task.uuid}
                                    class={selected ? 'bg-primary/5' : undefined}
                                    onClick={() => setSelectedUuid(task.uuid)}
                                >
                                    <td class="max-w-[10rem]">
                                        <p class="truncate text-xs font-medium">{task.name}</p>
                                        <p class="truncate font-mono text-[10px] text-base-content/45">{maskSecretsInText(task.command)}</p>
                                    </td>
                                    <td class="text-xs text-base-content/65">{formatCron(task.frequency)}</td>
                                    <td>
                                        <StatusBadge
                                            label={task.enabled ? 'Activée' : 'Désactivée'}
                                            tone={task.enabled ? 'success' : 'neutral'}
                                        />
                                    </td>
                                    <td>
                                        {latest ? (
                                            <StatusBadge
                                                label={latest.status}
                                                tone={executionTone(latest.status)}
                                            />
                                        ) : (
                                            <span class="text-xs text-base-content/40">—</span>
                                        )}
                                    </td>
                                    {canAct && (
                                        <td class="w-0 whitespace-nowrap text-end" onClick={(event) => event.stopPropagation()}>
                                            <ActionToolbar>
                                                <button
                                                    class="btn btn-ghost btn-xs btn-square"
                                                    type="button"
                                                    aria-label={`Exécuter ${task.name}`}
                                                    title="Exécuter maintenant"
                                                    disabled={runningUuid === task.uuid}
                                                    onClick={() => void runTask(task)}
                                                >
                                                    {runningUuid === task.uuid
                                                        ? <LoaderCircle class="size-3.5 animate-spin" aria-hidden />
                                                        : <Play class="size-3.5" aria-hidden />}
                                                </button>
                                                <button
                                                    class="btn btn-ghost btn-xs"
                                                    type="button"
                                                    onClick={() => void toggleEnabled(task)}
                                                >
                                                    {task.enabled ? 'Off' : 'On'}
                                                </button>
                                                <button
                                                    class="btn btn-ghost btn-xs btn-square"
                                                    type="button"
                                                    aria-label={`Modifier ${task.name}`}
                                                    title="Modifier"
                                                    onClick={() => openEdit(task)}
                                                >
                                                    <Pencil class="size-3.5" aria-hidden />
                                                </button>
                                                <button
                                                    class="btn btn-ghost btn-xs btn-square text-error"
                                                    type="button"
                                                    aria-label={`Supprimer ${task.name}`}
                                                    title="Supprimer"
                                                    onClick={() => setPendingDelete(task)}
                                                >
                                                    <Trash2 class="size-3.5" aria-hidden />
                                                </button>
                                            </ActionToolbar>
                                        </td>
                                    )}
                                </tr>
                            );
                        })}
                    </Table>

                    <div class="rounded-xl border border-base-300/70 p-4">
                        <p class="mb-3 text-xs sm:text-sm font-semibold">Historique</p>
                        {!selectedUuid ? (
                            <p class="text-xs text-base-content/50">Sélectionnez une tâche.</p>
                        ) : (
                            <DataState
                                loading={executionsQuery.loading}
                                error={executionsQuery.error}
                                empty={executions.length === 0}
                                emptyMessage="Aucune exécution enregistrée."
                                onRetry={() => void executionsQuery.reload()}
                            >
                                <ul class="grid gap-2">
                                    {executions.map((execution) => (
                                        <li key={execution.uuid} class="rounded-lg border border-base-300/60 px-3 py-2">
                                            <div class="flex items-center justify-between gap-2">
                                                <StatusBadge
                                                    label={execution.status}
                                                    tone={executionTone(execution.status)}
                                                />
                                                <span class="text-[10px] text-base-content/45">
                                                    {execution.finished_at ?? execution.started_at ?? execution.created_at ?? '—'}
                                                </span>
                                            </div>
                                            {execution.message && (
                                                <p class="mt-1 line-clamp-3 font-mono text-[11px] text-base-content/55">
                                                    {execution.message}
                                                </p>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            </DataState>
                        )}
                    </div>
                </div>
            </DataState>

            {formOpen && (
                <div class="fixed inset-0 z-50 grid place-items-center bg-base-300/50 p-4 backdrop-blur-sm">
                    <div class="w-full max-w-lg rounded-2xl border border-base-300/70 bg-base-100 p-5 shadow-xl">
                        <h3 class="text-sm sm:text-base font-semibold">
                            {editing ? `Modifier ${editing.name}` : 'Nouvelle tâche planifiée'}
                        </h3>

                        <form
                            class="mt-4 grid gap-3"
                            onSubmit={(event) => {
                                event.preventDefault();
                                void submitForm();
                            }}
                        >
                            <label class="grid gap-1 text-sm">
                                <span class="text-xs font-medium text-base-content/60">Nom</span>
                                <input
                                    class="input input-bordered input-sm"
                                    required
                                    value={form.name}
                                    onInput={(event) => setForm((current) => ({
                                        ...current,
                                        name: (event.target as HTMLInputElement).value,
                                    }))}
                                />
                            </label>

                            <label class="grid gap-1 text-sm">
                                <span class="text-xs font-medium text-base-content/60">Commande</span>
                                <textarea
                                    class="textarea textarea-bordered textarea-sm font-mono"
                                    rows={3}
                                    required
                                    value={form.command}
                                    onInput={(event) => setForm((current) => ({
                                        ...current,
                                        command: (event.target as HTMLTextAreaElement).value,
                                    }))}
                                />
                            </label>

                            <CronInput
                                value={form.frequency ?? ''}
                                onChange={(val) => setForm({ ...form, frequency: val })}
                            />

                            <label class="grid gap-1 text-sm">
                                <span class="text-xs font-medium text-base-content/60">Conteneur (optionnel)</span>
                                <input
                                    class="input input-bordered input-sm font-mono"
                                    value={form.container ?? ''}
                                    onInput={(event) => setForm((current) => ({
                                        ...current,
                                        container: (event.target as HTMLInputElement).value,
                                    }))}
                                />
                            </label>

                            <label class="grid gap-1 text-sm">
                                <span class="text-xs font-medium text-base-content/60">Timeout (secondes)</span>
                                <input
                                    class="input input-bordered input-sm"
                                    type="number"
                                    min={60}
                                    max={36000}
                                    value={form.timeout ?? 300}
                                    onInput={(event) => setForm((current) => ({
                                        ...current,
                                        timeout: Number((event.target as HTMLInputElement).value),
                                    }))}
                                />
                            </label>

                            <label class="flex items-center gap-2 text-xs">
                                <input
                                    class="checkbox checkbox-xs"
                                    type="checkbox"
                                    checked={form.enabled ?? true}
                                    onChange={(event) => setForm((current) => ({
                                        ...current,
                                        enabled: (event.target as HTMLInputElement).checked,
                                    }))}
                                />
                                Activée
                            </label>

                            {formError && <p class="text-sm text-error" role="alert">{formError}</p>}

                            <div class="form-actions pt-2">
                                <button class="btn btn-ghost btn-sm" type="button" onClick={closeForm} disabled={submitting}>
                                    Annuler
                                </button>
                                <button class="btn btn-primary btn-sm" type="submit" disabled={submitting}>
                                    {submitting
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
                    title="Supprimer la tâche"
                    message={`Confirmer la suppression de « ${pendingDelete.name} » ?`}
                    tone="danger"
                    loading={deleting}
                    onCancel={() => setPendingDelete(null)}
                    onConfirm={() => void deleteTask()}
                />
            )}
        </section>
    );
}
