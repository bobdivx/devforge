import { AlertTriangle, DatabaseBackup, LoaderCircle, Trash2 } from 'lucide-preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { DataState } from '../ui/DataState';
import {
    domainApi,
    type ApplicationDatabaseConnection,
    type LinkableDatabase,
} from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';

type Props = {
    applicationUuid: string;
    applicationName: string;
    canAct: boolean;
    onDeleted: () => Promise<void> | void;
    onDatabaseReset?: (deploymentUuid: string | null) => void;
};

export function ApplicationDangerPanel({
    applicationUuid,
    applicationName,
    canAct,
    onDeleted,
    onDatabaseReset,
}: Props) {
    const databasesQuery = useApiQuery(
        `application-danger-databases:${applicationUuid}`,
        () => domainApi.linkableDatabases(applicationUuid),
    );

    const [pendingDelete, setPendingDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [pendingResetUuid, setPendingResetUuid] = useState<string | null>(null);
    const [resettingUuid, setResettingUuid] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const databases = databasesQuery.data?.data ?? [];
    const connections = databasesQuery.data?.meta?.connections ?? [];

    const linkedLibsql = useMemo(() => {
        return connections
            .map((connection: ApplicationDatabaseConnection) => {
                const database = databases.find((item: LinkableDatabase) => item.uuid === connection.database_uuid);
                if (!database || database.engine !== 'libsql') {
                    return null;
                }

                return {
                    uuid: database.uuid,
                    name: database.name,
                    env_keys: connection.env_keys,
                };
            })
            .filter((item): item is { uuid: string; name: string; env_keys: string[] } => item !== null);
    }, [connections, databases]);

    useEffect(() => {
        setPendingDelete(false);
        setPendingResetUuid(null);
        setError(null);
        setSuccess(null);
    }, [applicationUuid]);

    const deleteApplication = async () => {
        setDeleting(true);
        setError(null);
        setSuccess(null);
        try {
            await domainApi.deleteApplication(applicationUuid);
            setPendingDelete(false);
            await onDeleted();
        } catch {
            setError('La suppression de l’application a échoué.');
        } finally {
            setDeleting(false);
        }
    };

    const resetDatabase = async (databaseUuid: string) => {
        setResettingUuid(databaseUuid);
        setError(null);
        setSuccess(null);
        try {
            const response = await domainApi.resetApplicationDatabase(applicationUuid, databaseUuid, true);
            setPendingResetUuid(null);
            setSuccess(response.data.message);
            onDatabaseReset?.(response.data.redeploy?.deployment_uuid ?? null);
            await databasesQuery.reload({ silent: true });
        } catch {
            setError('La réinitialisation de la base a échoué.');
        } finally {
            setResettingUuid(null);
        }
    };

    const pendingReset = linkedLibsql.find((item) => item.uuid === pendingResetUuid) ?? null;

    return (
        <DataState
            loading={databasesQuery.loading && databases.length === 0}
            error={databasesQuery.error}
            onRetry={() => void databasesQuery.reload()}
        >
            <div class="grid gap-4">
                <section class="overflow-hidden rounded-2xl border border-error/40 bg-error/5 shadow-sm">
                    <div class="border-b border-error/30 px-4 py-4 sm:px-5">
                        <p class="inline-flex items-center gap-2 text-sm font-semibold text-error">
                            <AlertTriangle class="size-4" aria-hidden />
                            Zone dangereuse
                        </p>
                        <p class="mt-1 text-xs text-base-content/60">
                            Actions irréversibles sur « {applicationName} » et ses bases liées.
                        </p>
                    </div>

                    <div class="grid gap-4 p-4 sm:p-5">
                        {linkedLibsql.length > 0 && (
                            <div class="rounded-xl border border-error/25 bg-base-100/80 p-4">
                                <div class="mb-3 flex items-start gap-3">
                                    <DatabaseBackup class="mt-0.5 size-4 shrink-0 text-error" aria-hidden />
                                    <div class="min-w-0">
                                        <p class="text-sm font-semibold">Réinitialiser la base liée</p>
                                        <p class="text-xs text-base-content/55">
                                            Vide toutes les données libSQL rattachées, redémarre la base, puis redéploie l’application.
                                        </p>
                                    </div>
                                </div>
                                <ul class="grid gap-2">
                                    {linkedLibsql.map((database) => (
                                        <li
                                            key={database.uuid}
                                            class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-base-300/70 px-3 py-2"
                                        >
                                            <div class="min-w-0">
                                                <p class="truncate text-sm font-medium">{database.name}</p>
                                                <p class="truncate font-mono text-[11px] text-base-content/45">
                                                    {database.env_keys.join(', ') || 'libSQL'}
                                                </p>
                                            </div>
                                            {canAct && (
                                                <button
                                                    class="btn btn-outline btn-error btn-xs rounded-full"
                                                    type="button"
                                                    disabled={resettingUuid !== null || deleting}
                                                    onClick={() => setPendingResetUuid(database.uuid)}
                                                >
                                                    {resettingUuid === database.uuid ? (
                                                        <LoaderCircle class="size-3.5 animate-spin" aria-hidden />
                                                    ) : (
                                                        <DatabaseBackup class="size-3.5" aria-hidden />
                                                    )}
                                                    Reset DB
                                                </button>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {linkedLibsql.length === 0 && (
                            <p class="rounded-xl border border-base-300/70 bg-base-100/70 px-4 py-3 text-xs text-base-content/55">
                                Aucune base libSQL rattachée — le reset DB n’est disponible que pour les connexions libSQL.
                            </p>
                        )}

                        <div class="rounded-xl border border-error/30 bg-base-100/80 p-4">
                            <div class="mb-3 flex items-start gap-3">
                                <Trash2 class="mt-0.5 size-4 shrink-0 text-error" aria-hidden />
                                <div class="min-w-0">
                                    <p class="text-sm font-semibold">Supprimer l’application</p>
                                    <p class="text-xs text-base-content/55">
                                        Supprime définitivement l’application, ses conteneurs, volumes et configuration Coolify.
                                    </p>
                                </div>
                            </div>
                            {canAct ? (
                                <button
                                    class="btn btn-error btn-sm rounded-full"
                                    type="button"
                                    disabled={deleting || resettingUuid !== null}
                                    onClick={() => setPendingDelete(true)}
                                >
                                    {deleting ? (
                                        <LoaderCircle class="size-3.5 animate-spin" aria-hidden />
                                    ) : (
                                        <Trash2 class="size-3.5" aria-hidden />
                                    )}
                                    Supprimer l’application
                                </button>
                            ) : (
                                <p class="text-xs text-base-content/50">Permission insuffisante pour supprimer.</p>
                            )}
                        </div>

                        {success && <p class="text-sm text-success">{success}</p>}
                        {error && <p class="text-sm text-error" role="alert">{error}</p>}
                    </div>
                </section>

                {pendingDelete && (
                    <ConfirmDialog
                        open
                        title="Supprimer l’application"
                        message={`Supprimer définitivement « ${applicationName} » ? Les conteneurs, volumes et configuration associés seront retirés.`}
                        tone="danger"
                        loading={deleting}
                        onCancel={() => setPendingDelete(false)}
                        onConfirm={() => void deleteApplication()}
                    />
                )}

                {pendingReset && (
                    <ConfirmDialog
                        open
                        title="Réinitialiser la base"
                        message={`Vider définitivement « ${pendingReset.name} » puis redéployer « ${applicationName} » ? Toutes les données de cette base seront perdues.`}
                        tone="danger"
                        loading={resettingUuid === pendingReset.uuid}
                        onCancel={() => setPendingResetUuid(null)}
                        onConfirm={() => void resetDatabase(pendingReset.uuid)}
                    />
                )}
            </div>
        </DataState>
    );
}
