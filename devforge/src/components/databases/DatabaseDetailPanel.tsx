import { ArrowLeft, Copy, Download, Eye, EyeOff, Link2, Play, Plus, RefreshCw, Trash2, Upload } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { domainApi, type CoreAction, type DatabaseBackup, type DatabaseBackupInput } from '../../lib/domain-api';
import { resourceStatusInput } from '../../lib/resource-status';
import { useApiQuery } from '../../lib/use-api-query';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { DataState } from '../ui/DataState';
import { Modal } from '../ui/Modal';
import { ResourceStatusIcon } from '../ui/ResourceStatusIcon';
import { StatusBadge } from '../ui/StatusBadge';
import { Table } from '../ui/Table';

const actionLabels: Record<CoreAction, string> = {
    start: 'Démarrer',
    stop: 'Arrêter',
    restart: 'Redémarrer',
    deploy: 'Déployer',
};

const frequencyPresets = [
    { label: 'Quotidien', value: '0 0 * * *' },
    { label: 'Hebdomadaire', value: '0 0 * * 0' },
    { label: 'Mensuel', value: '0 0 1 * *' },
    { label: 'Horaire', value: '0 * * * *' },
];

const defaultBackupForm = (): DatabaseBackupInput => ({
    frequency: '0 0 * * *',
    enabled: true,
    save_s3: false,
    disable_local_backup: false,
    dump_all: false,
    backup_now: false,
    timeout: 3600,
    database_backup_retention_amount_locally: 0,
    database_backup_retention_days_locally: 0,
    database_backup_retention_max_storage_locally: 0,
    database_backup_retention_amount_s3: 0,
    database_backup_retention_days_s3: 0,
    database_backup_retention_max_storage_s3: 0,
});

function formatBytes(size: number): string {
    if (size <= 0) return '—';
    const units = ['o', 'Ko', 'Mo', 'Go'];
    let value = size;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function copyText(value: string) {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
        void navigator.clipboard.writeText(value);
    }
}

type CredentialFieldProps = {
    label: string;
    value: string;
    masked?: boolean;
};

function CredentialField({ label, value, masked = false }: CredentialFieldProps) {
    const [revealed, setRevealed] = useState(false);
    const displayValue = masked && !revealed ? '•'.repeat(Math.min(value.length, 24)) : value;

    return (
        <div class="grid gap-1">
            <span class="text-xs font-medium text-base-content/55">{label}</span>
            <div class="flex items-center gap-2 rounded-lg border border-base-300/70 bg-base-100 px-3 py-2">
                <code class="min-w-0 flex-1 truncate font-mono text-[11px]">{displayValue}</code>
                {masked && (
                    <button
                        class="btn btn-ghost btn-xs"
                        type="button"
                        aria-label={revealed ? 'Masquer' : 'Afficher'}
                        onClick={() => setRevealed((current) => !current)}
                    >
                        {revealed ? <EyeOff class="size-3" aria-hidden /> : <Eye class="size-3" aria-hidden />}
                    </button>
                )}
                <button
                    class="btn btn-ghost btn-xs"
                    type="button"
                    aria-label={`Copier ${label}`}
                    onClick={() => copyText(value)}
                >
                    <Copy class="size-3" aria-hidden />
                </button>
            </div>
        </div>
    );
}

function executionTone(status: string): 'success' | 'warning' | 'error' | 'neutral' {
    if (status === 'success') return 'success';
    if (status === 'running') return 'warning';
    if (status === 'failed') return 'error';
    return 'neutral';
}

type DatabaseDetailPanelProps = {
    uuid: string;
    canAct: boolean;
    onClose: () => void;
    onChanged: () => Promise<void>;
};

export function DatabaseDetailPanel({ uuid, canAct, onClose, onChanged }: DatabaseDetailPanelProps) {
    const resourceQuery = useApiQuery(`core:databases:${uuid}`, () => domainApi.coreResource('databases', uuid));
    const connectionsQuery = useApiQuery(`db-connections:${uuid}`, () => domainApi.databaseConnections(uuid));
    const [activeTab, setActiveTab] = useState<'overview' | 'data' | 'backups'>('overview');
    const backupsQuery = useApiQuery(
        activeTab === 'backups' ? `db-backups:${uuid}` : null,
        () => domainApi.databaseBackups(uuid),
    );
    const storagesQuery = useApiQuery(
        activeTab === 'backups' ? 's3-storages' : null,
        () => domainApi.s3Storages(),
    );

    const [acting, setActing] = useState<CoreAction | null>(null);
    const [pendingAction, setPendingAction] = useState<CoreAction | null>(null);
    const [pendingDeleteDatabase, setPendingDeleteDatabase] = useState(false);
    const [deletingDatabase, setDeletingDatabase] = useState(false);
    const [transferring, setTransferring] = useState<'export' | 'import' | null>(null);
    const [transferMessage, setTransferMessage] = useState<string | null>(null);
    const [transferError, setTransferError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [backupModalOpen, setBackupModalOpen] = useState(false);
    const [editingBackup, setEditingBackup] = useState<DatabaseBackup | null>(null);
    const [backupForm, setBackupForm] = useState<DatabaseBackupInput>(defaultBackupForm());
    const [backupSubmitting, setBackupSubmitting] = useState(false);
    const [selectedBackupUuid, setSelectedBackupUuid] = useState<string | null>(null);
    const [pendingDeleteBackup, setPendingDeleteBackup] = useState<DatabaseBackup | null>(null);
    const [accessSubmitting, setAccessSubmitting] = useState(false);
    const [accessMessage, setAccessMessage] = useState<string | null>(null);
    const [pendingRegenerateToken, setPendingRegenerateToken] = useState(false);

    const resource = resourceQuery.data?.data;
    const isLibsql = resource?.engine === 'libsql';
    const credentialsQuery = useApiQuery(
        isLibsql ? `db-credentials:${uuid}` : null,
        () => domainApi.libsqlCredentials(uuid),
    );
    const connections = connectionsQuery.data?.data ?? [];
    const backups = backupsQuery.data?.data ?? [];
    const supportsBackups = backupsQuery.data?.meta.supports_backups ?? true;
    const storages = storagesQuery.data?.data ?? [];
    const credentials = credentialsQuery.data?.data;

    const regenerateToken = async () => {
        setAccessSubmitting(true);
        setAccessMessage(null);
        setActionError(null);
        try {
            const response = await domainApi.regenerateLibsqlToken(uuid, true);
            setAccessMessage('Jeton régénéré. Les applications rattachées ont été mises à jour.');
            await credentialsQuery.reload();
            await connectionsQuery.reload();
            if (response.data.redeployments_queued > 0) {
                setAccessMessage(`Jeton régénéré. ${response.data.redeployments_queued} redéploiement(s) lancé(s).`);
            }
        } catch {
            setActionError('La régénération du jeton a échoué.');
        } finally {
            setAccessSubmitting(false);
            setPendingRegenerateToken(false);
        }
    };

    const togglePublicAccess = async (enabled: boolean) => {
        setAccessSubmitting(true);
        setAccessMessage(null);
        setActionError(null);
        try {
            const response = await domainApi.updateLibsqlPublicAccess(uuid, {
                enabled,
                public_port: credentials?.public_port ?? undefined,
                redeploy_applications: false,
            });
            setAccessMessage(enabled ? 'Accès distant activé.' : 'Accès distant désactivé.');
            await credentialsQuery.reload();
            await resourceQuery.reload();
            if (response.data.turso_database_url_external) {
                setAccessMessage('Accès distant activé. Utilisez l’URL Turso distante ci-dessous.');
            }
        } catch {
            setActionError('La mise à jour de l’accès distant a échoué.');
        } finally {
            setAccessSubmitting(false);
        }
    };

    const executionsQuery = useApiQuery(
        selectedBackupUuid ? `db-backup-exec:${uuid}:${selectedBackupUuid}` : null,
        () => domainApi.databaseBackupExecutions(uuid, selectedBackupUuid!),
    );

    const runAction = async (action: CoreAction) => {
        if (!resource) return;
        setActing(action);
        setActionError(null);
        try {
            await domainApi.coreAction('databases', resource.uuid, action);
            await resourceQuery.reload();
            await onChanged();
        } catch {
            setActionError(`L’action « ${actionLabels[action]} » a échoué.`);
        } finally {
            setActing(null);
            setPendingAction(null);
        }
    };

    const openCreateBackup = () => {
        setEditingBackup(null);
        setBackupForm(defaultBackupForm());
        setBackupModalOpen(true);
    };

    const openEditBackup = (backup: DatabaseBackup) => {
        setEditingBackup(backup);
        setBackupForm({
            frequency: backup.frequency,
            enabled: backup.enabled,
            save_s3: backup.save_s3,
            disable_local_backup: backup.disable_local_backup,
            dump_all: backup.dump_all,
            s3_storage_uuid: backup.s3_storage?.uuid ?? null,
            databases_to_backup: backup.databases_to_backup,
            timeout: backup.timeout,
            database_backup_retention_amount_locally: backup.retention.local.amount,
            database_backup_retention_days_locally: backup.retention.local.days,
            database_backup_retention_max_storage_locally: backup.retention.local.max_storage_gb,
            database_backup_retention_amount_s3: backup.retention.s3.amount,
            database_backup_retention_days_s3: backup.retention.s3.days,
            database_backup_retention_max_storage_s3: backup.retention.s3.max_storage_gb,
        });
        setBackupModalOpen(true);
    };

    const submitBackup = async () => {
        setBackupSubmitting(true);
        try {
            if (editingBackup) {
                await domainApi.updateDatabaseBackup(uuid, editingBackup.uuid, backupForm);
            } else {
                await domainApi.createDatabaseBackup(uuid, backupForm);
            }
            setBackupModalOpen(false);
            await backupsQuery.reload();
        } finally {
            setBackupSubmitting(false);
        }
    };

    const runBackup = async (backup: DatabaseBackup) => {
        await domainApi.runDatabaseBackup(uuid, backup.uuid);
        await backupsQuery.reload();
        if (selectedBackupUuid === backup.uuid) {
            await executionsQuery.reload();
        }
    };

    const deleteBackup = async () => {
        if (!pendingDeleteBackup) return;
        setBackupSubmitting(true);
        try {
            await domainApi.deleteDatabaseBackup(uuid, pendingDeleteBackup.uuid, pendingDeleteBackup.save_s3);
            if (selectedBackupUuid === pendingDeleteBackup.uuid) {
                setSelectedBackupUuid(null);
            }
            setPendingDeleteBackup(null);
            await backupsQuery.reload();
        } finally {
            setBackupSubmitting(false);
        }
    };

    const deleteDatabase = async () => {
        setDeletingDatabase(true);
        setActionError(null);
        try {
            await domainApi.deleteDatabase(uuid);
            setPendingDeleteDatabase(false);
            await onChanged();
            onClose();
        } catch {
            setActionError('La suppression de la base a échoué.');
        } finally {
            setDeletingDatabase(false);
        }
    };

    const exportSql = async () => {
        if (!resource) {
            return;
        }

        setTransferring('export');
        setTransferError(null);
        setTransferMessage(null);
        try {
            const filename = `${resource.name.replace(/[^\w.-]+/g, '-')}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.sql`;
            await domainApi.exportDatabaseSql(resource.uuid, filename);
            setTransferMessage('Export SQL téléchargé.');
        } catch (exportError: unknown) {
            setTransferError(exportError instanceof Error ? exportError.message : 'L’export SQL a échoué.');
        } finally {
            setTransferring(null);
        }
    };

    const importSql = async (file: File) => {
        setTransferring('import');
        setTransferError(null);
        setTransferMessage(null);
        try {
            const response = await domainApi.importDatabaseSql(uuid, file);
            setTransferMessage(response.data.message);
            await resourceQuery.reload();
            await onChanged();
        } catch (importError: unknown) {
            setTransferError(importError instanceof Error ? importError.message : 'L’import SQL a échoué.');
        } finally {
            setTransferring(null);
        }
    };

    return (
        <>
            <div class="mb-4 flex flex-wrap items-center gap-2">
                <button class="btn btn-ghost btn-sm" type="button" onClick={onClose}>
                    <ArrowLeft class="size-3.5" aria-hidden />
                    Retour à la liste
                </button>
                <div class="ms-auto flex gap-2">
                    <button
                        class={`btn btn-sm ${activeTab === 'overview' ? 'btn-primary' : 'btn-ghost'}`}
                        type="button"
                        onClick={() => setActiveTab('overview')}
                    >
                        Vue d’ensemble
                    </button>
                    {isLibsql && (
                        <button
                            class={`btn btn-sm ${activeTab === 'data' ? 'btn-primary' : 'btn-ghost'}`}
                            type="button"
                            onClick={() => setActiveTab('data')}
                        >
                            Données
                        </button>
                    )}
                    <button
                        class={`btn btn-sm ${activeTab === 'backups' ? 'btn-primary' : 'btn-ghost'}`}
                        type="button"
                        onClick={() => setActiveTab('backups')}
                    >
                        Sauvegardes
                    </button>
                </div>
            </div>

            <DataState loading={resourceQuery.loading} error={resourceQuery.error} onRetry={() => void resourceQuery.reload()}>
                {resource && activeTab === 'overview' && (
                    <section class="rounded-2xl border border-base-300/70 bg-base-100 p-4 shadow-sm">
                        <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
                            <div>
                                <h2 class="text-lg font-semibold">{resource.name}</h2>
                                <p class="font-mono text-[11px] text-base-content/45">{resource.uuid}</p>
                            </div>
                            <ResourceStatusIcon status={resourceStatusInput(resource)} />
                        </div>
                        {resource.engine && <p class="text-sm">Moteur : <span class="font-medium">{resource.engine}</span></p>}

                        {isLibsql && (
                            <div class="mt-4 rounded-xl border border-base-300/70 bg-base-200/30 p-3">
                                <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
                                    <div>
                                        <p class="text-sm font-medium">Connexion</p>
                                        <p class="text-xs text-base-content/55">
                                            Compatible Turso : utilisez <span class="font-mono">TURSO_DATABASE_URL</span> + <span class="font-mono">TURSO_AUTH_TOKEN</span> sans modifier votre code.
                                        </p>
                                    </div>
                                    {canAct && (
                                        <button
                                            class="btn btn-outline btn-xs"
                                            type="button"
                                            disabled={accessSubmitting}
                                            onClick={() => setPendingRegenerateToken(true)}
                                        >
                                            <RefreshCw class="size-3" aria-hidden />
                                            Régénérer le jeton
                                        </button>
                                    )}
                                </div>
                                <DataState
                                    loading={credentialsQuery.loading}
                                    error={credentialsQuery.error}
                                    onRetry={() => void credentialsQuery.reload()}
                                >
                                    {credentials && (
                                        <div class="grid gap-3">
                                            <CredentialField label="TURSO_DATABASE_URL (réseau interne)" value={credentials.turso_database_url} />
                                            <CredentialField label="TURSO_AUTH_TOKEN" value={credentials.turso_auth_token} masked />
                                            <CredentialField label="LIBSQL_URL (URL complète interne)" value={credentials.libsql_url} masked />
                                            {credentials.turso_database_url_external && (
                                                <CredentialField label="TURSO_DATABASE_URL (accès distant)" value={credentials.turso_database_url_external} />
                                            )}
                                            {credentials.external_url && (
                                                <CredentialField label="URL distante complète" value={credentials.external_url} masked />
                                            )}
                                            <div class="flex flex-wrap items-center gap-3 rounded-lg border border-base-300/60 bg-base-100 px-3 py-2 text-sm">
                                                <label class="flex items-center gap-2">
                                                    <input
                                                        class="toggle toggle-sm"
                                                        type="checkbox"
                                                        checked={credentials.is_public}
                                                        disabled={!canAct || accessSubmitting}
                                                        onChange={(event) => void togglePublicAccess((event.target as HTMLInputElement).checked)}
                                                    />
                                                    <span>Accès distant</span>
                                                </label>
                                                {credentials.is_public && credentials.public_port && (
                                                    <span class="text-xs text-base-content/55">
                                                        Port public : <span class="font-mono">{credentials.public_port}</span>
                                                    </span>
                                                )}
                                            </div>
                                            {accessMessage && <p class="text-xs text-success" role="status">{accessMessage}</p>}
                                        </div>
                                    )}
                                </DataState>
                            </div>
                        )}

                        <div class="mt-4 rounded-xl border border-base-300/70 bg-base-200/30 p-3">
                            <div class="mb-2 flex items-center gap-2 text-sm font-medium">
                                <Link2 class="size-3.5 text-base-content/45" aria-hidden />
                                Applications rattachées
                            </div>
                            <DataState
                                loading={connectionsQuery.loading}
                                error={connectionsQuery.error}
                                onRetry={() => void connectionsQuery.reload()}
                            >
                                {connections.length === 0 ? (
                                    <p class="text-xs text-base-content/55">
                                        Aucune application n’utilise cette base pour le moment.
                                    </p>
                                ) : (
                                    <ul class="grid gap-2">
                                        {connections.map((connection) => (
                                            <li
                                                class="rounded-lg border border-base-300/60 bg-base-100 px-3 py-2 text-sm"
                                                key={`${connection.application_uuid}:${connection.env_key}`}
                                            >
                                                <span class="font-medium">{connection.application_name}</span>
                                                <span class="text-base-content/45"> via </span>
                                                <span class="font-mono text-xs text-primary">{connection.env_key}</span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </DataState>
                        </div>

                        {actionError && <p class="mt-2 text-xs text-error" role="alert">{actionError}</p>}
                        {canAct && (
                            <div class="mt-4 flex flex-wrap gap-2">
                                {resource.actions.map((action) => (
                                    <button
                                        class="btn btn-sm"
                                        type="button"
                                        key={action}
                                        disabled={acting !== null || deletingDatabase}
                                        onClick={() => {
                                            if (['stop', 'restart'].includes(action)) {
                                                setPendingAction(action);
                                                return;
                                            }
                                            void runAction(action);
                                        }}
                                    >
                                        {acting === action ? 'En cours…' : actionLabels[action]}
                                    </button>
                                ))}
                                <button
                                    class="btn btn-sm btn-outline btn-error"
                                    type="button"
                                    disabled={acting !== null || deletingDatabase}
                                    onClick={() => setPendingDeleteDatabase(true)}
                                >
                                    <Trash2 class="size-3.5" aria-hidden />
                                    Supprimer
                                </button>
                            </div>
                        )}
                    </section>
                )}

                {resource && activeTab === 'data' && isLibsql && (
                    <section class="rounded-2xl border border-base-300/70 bg-base-100 p-4 shadow-sm">
                        <div class="mb-4">
                            <h2 class="text-lg font-semibold">Import / export SQL</h2>
                            <p class="text-xs text-base-content/55">
                                Migrez depuis Turso ou sauvegardez le contenu SQLite de cette base libSQL.
                            </p>
                        </div>

                        <div class="grid gap-4 md:grid-cols-2">
                            <article class="rounded-xl border border-base-300/70 bg-base-200/20 p-4">
                                <h3 class="text-sm font-semibold">Exporter</h3>
                                <p class="mt-1 text-xs text-base-content/55">
                                    Télécharge un dump SQL (`sqlite3 .dump`) du fichier `data.db`.
                                </p>
                                {canAct && (
                                    <button
                                        class="btn btn-sm btn-primary mt-3"
                                        type="button"
                                        disabled={transferring !== null}
                                        onClick={() => void exportSql()}
                                    >
                                        <Download class="size-3.5" aria-hidden />
                                        {transferring === 'export' ? 'Export…' : 'Exporter en SQL'}
                                    </button>
                                )}
                            </article>

                            <article class="rounded-xl border border-base-300/70 bg-base-200/20 p-4">
                                <h3 class="text-sm font-semibold">Importer</h3>
                                <p class="mt-1 text-xs text-base-content/55">
                                    Remplace le contenu actuel. La base est arrêtée puis redémarrée automatiquement.
                                </p>
                                {canAct && (
                                    <label class="btn btn-sm btn-outline mt-3 cursor-pointer">
                                        <Upload class="size-3.5" aria-hidden />
                                        {transferring === 'import' ? 'Import…' : 'Choisir un fichier .sql'}
                                        <input
                                            class="hidden"
                                            type="file"
                                            accept=".sql,.txt,text/plain"
                                            disabled={transferring !== null}
                                            onChange={(event) => {
                                                const file = (event.target as HTMLInputElement).files?.[0];
                                                if (file) {
                                                    void importSql(file);
                                                }
                                                (event.target as HTMLInputElement).value = '';
                                            }}
                                        />
                                    </label>
                                )}
                            </article>
                        </div>

                        {transferMessage && <p class="mt-3 text-xs text-success" role="status">{transferMessage}</p>}
                        {transferError && <p class="mt-3 text-xs text-error" role="alert">{transferError}</p>}
                    </section>
                )}

                {resource && activeTab === 'backups' && (
                    <section class="grid gap-4">
                        {!supportsBackups ? (
                            <div class="rounded-2xl border border-base-300/70 bg-base-100 p-4 text-sm text-base-content/65">
                                Les sauvegardes planifiées ne sont pas disponibles pour ce type de base.
                            </div>
                        ) : (
                            <>
                                <div class="flex flex-wrap items-center justify-between gap-2">
                                    <p class="text-sm text-base-content/60">Planifications et historique des sauvegardes.</p>
                                    {canAct && (
                                        <button class="btn btn-primary btn-sm" type="button" onClick={openCreateBackup}>
                                            <Plus class="size-3.5" aria-hidden />
                                            Nouvelle planification
                                        </button>
                                    )}
                                </div>

                                <DataState loading={backupsQuery.loading} error={backupsQuery.error} onRetry={() => void backupsQuery.reload()}>
                                    {backups.length === 0 ? (
                                        <div class="rounded-2xl border border-dashed border-base-300/80 p-6 text-sm text-base-content/60">
                                            Aucune sauvegarde planifiée. Configurez une fréquence et, optionnellement, une destination S3.
                                        </div>
                                    ) : (
                                        <div class="grid gap-3">
                                            {backups.map((backup) => (
                                                <article class="rounded-2xl border border-base-300/70 bg-base-100 p-4" key={backup.uuid}>
                                                    <div class="flex flex-wrap items-start justify-between gap-3">
                                                        <div>
                                                            <div class="flex flex-wrap items-center gap-2">
                                                                <h3 class="font-semibold">{backup.frequency}</h3>
                                                                <StatusBadge label={backup.enabled ? 'Activée' : 'Désactivée'} tone={backup.enabled ? 'success' : 'neutral'} />
                                                                {backup.save_s3 && <StatusBadge label="S3" tone="success" />}
                                                            </div>
                                                            {backup.s3_storage && (
                                                                <p class="mt-1 text-xs text-base-content/55">Destination : {backup.s3_storage.name}</p>
                                                            )}
                                                            {backup.latest_execution && (
                                                                <p class="mt-1 text-xs text-base-content/55">
                                                                    Dernière exécution :
                                                                    {' '}
                                                                    <StatusBadge label={backup.latest_execution.status} tone={executionTone(backup.latest_execution.status)} />
                                                                    {backup.latest_execution.size > 0 && ` · ${formatBytes(backup.latest_execution.size)}`}
                                                                </p>
                                                            )}
                                                        </div>
                                                        {canAct && (
                                                            <div class="flex flex-wrap gap-2">
                                                                <button class="btn btn-ghost btn-sm" type="button" onClick={() => void runBackup(backup)}>
                                                                    <Play class="size-3.5" aria-hidden />
                                                                    Lancer
                                                                </button>
                                                                <button class="btn btn-ghost btn-sm" type="button" onClick={() => openEditBackup(backup)}>
                                                                    Modifier
                                                                </button>
                                                                <button
                                                                    class="btn btn-ghost btn-sm"
                                                                    type="button"
                                                                    onClick={() => {
                                                                        setSelectedBackupUuid((current) => current === backup.uuid ? null : backup.uuid);
                                                                    }}
                                                                >
                                                                    Historique
                                                                </button>
                                                                <button class="btn btn-ghost btn-sm text-error" type="button" onClick={() => setPendingDeleteBackup(backup)}>
                                                                    <Trash2 class="size-3.5" aria-hidden />
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>

                                                    {selectedBackupUuid === backup.uuid && (
                                                        <div class="mt-4 border-t border-base-300/60 pt-4">
                                                            <DataState
                                                                loading={executionsQuery.loading}
                                                                error={executionsQuery.error}
                                                                onRetry={() => void executionsQuery.reload()}
                                                            >
                                                                {(executionsQuery.data?.data ?? []).length === 0 ? (
                                                                    <p class="text-sm text-base-content/60">Aucune exécution pour le moment.</p>
                                                                ) : (
                                                                    <Table headers={['Statut', 'Taille', 'Date', 'S3']} caption="Historique des exécutions">
                                                                        {(executionsQuery.data?.data ?? []).map((execution) => (
                                                                            <tr key={execution.uuid}>
                                                                                <td><StatusBadge label={execution.status} tone={executionTone(execution.status)} /></td>
                                                                                <td>{formatBytes(execution.size)}</td>
                                                                                <td>{execution.finished_at ?? execution.created_at ?? '—'}</td>
                                                                                <td>{execution.s3_uploaded ? 'Oui' : 'Non'}</td>
                                                                            </tr>
                                                                        ))}
                                                                    </Table>
                                                                )}
                                                            </DataState>
                                                        </div>
                                                    )}
                                                </article>
                                            ))}
                                        </div>
                                    )}
                                </DataState>
                            </>
                        )}
                    </section>
                )}
            </DataState>

            {pendingAction && resource && (
                <ConfirmDialog
                    open
                    title={actionLabels[pendingAction]}
                    message={`Confirmer « ${actionLabels[pendingAction]} » sur « ${resource.name} » ?`}
                    tone="danger"
                    loading={acting === pendingAction}
                    onCancel={() => setPendingAction(null)}
                    onConfirm={() => void runAction(pendingAction)}
                />
            )}

            <Modal
                open={backupModalOpen}
                title={editingBackup ? 'Modifier la sauvegarde' : 'Nouvelle sauvegarde planifiée'}
                onClose={() => setBackupModalOpen(false)}
            >
                <form
                    class="grid gap-3"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void submitBackup();
                    }}
                >
                    <label class="grid gap-1 text-sm">
                        <span class="font-medium">Fréquence</span>
                        <select
                            class="select select-bordered rounded-xl"
                            value={backupForm.frequency}
                            onChange={(e) => setBackupForm({ ...backupForm, frequency: e.currentTarget.value })}
                        >
                            {frequencyPresets.map((preset) => (
                                <option value={preset.value} key={preset.value}>{preset.label}</option>
                            ))}
                        </select>
                    </label>
                    <label class="grid gap-1 text-sm">
                        <span class="font-medium">Expression cron personnalisée</span>
                        <input
                            class="input input-bordered rounded-xl font-mono text-xs"
                            value={backupForm.frequency}
                            onInput={(e) => setBackupForm({ ...backupForm, frequency: e.currentTarget.value })}
                        />
                    </label>
                    <label class="flex items-center gap-2 text-sm">
                        <input type="checkbox" class="checkbox checkbox-sm" checked={backupForm.enabled} onChange={(e) => setBackupForm({ ...backupForm, enabled: e.currentTarget.checked })} />
                        Planification activée
                    </label>
                    <label class="flex items-center gap-2 text-sm">
                        <input type="checkbox" class="checkbox checkbox-sm" checked={backupForm.save_s3} onChange={(e) => setBackupForm({ ...backupForm, save_s3: e.currentTarget.checked })} />
                        Envoyer vers S3
                    </label>
                    {backupForm.save_s3 && (
                        <label class="grid gap-1 text-sm">
                            <span class="font-medium">Destination S3</span>
                            <select
                                class="select select-bordered rounded-xl"
                                required
                                value={backupForm.s3_storage_uuid ?? ''}
                                onChange={(e) => setBackupForm({ ...backupForm, s3_storage_uuid: e.currentTarget.value })}
                            >
                                <option value="">Sélectionner…</option>
                                {storages.map((storage) => (
                                    <option value={storage.uuid} key={storage.uuid}>{storage.name}</option>
                                ))}
                            </select>
                        </label>
                    )}
                    {!editingBackup && (
                        <label class="flex items-center gap-2 text-sm">
                            <input type="checkbox" class="checkbox checkbox-sm" checked={backupForm.backup_now} onChange={(e) => setBackupForm({ ...backupForm, backup_now: e.currentTarget.checked })} />
                            Lancer une sauvegarde immédiatement
                        </label>
                    )}
                    <div class="flex justify-end gap-2">
                        <button class="btn btn-ghost" type="button" onClick={() => setBackupModalOpen(false)}>Annuler</button>
                        <button class="btn btn-primary" type="submit" disabled={backupSubmitting}>
                            {backupSubmitting ? 'Enregistrement…' : 'Enregistrer'}
                        </button>
                    </div>
                </form>
            </Modal>

            {pendingDeleteBackup && (
                <ConfirmDialog
                    open
                    title="Supprimer la planification"
                    message={`Supprimer la planification « ${pendingDeleteBackup.frequency} » et toutes ses exécutions ?`}
                    tone="danger"
                    loading={backupSubmitting}
                    onCancel={() => setPendingDeleteBackup(null)}
                    onConfirm={() => void deleteBackup()}
                />
            )}

            {pendingDeleteDatabase && resource && (
                <ConfirmDialog
                    open
                    title="Supprimer la base"
                    message={`Supprimer définitivement « ${resource.name} » ? Les conteneurs, volumes et planifications associés seront retirés.`}
                    tone="danger"
                    loading={deletingDatabase}
                    onCancel={() => setPendingDeleteDatabase(false)}
                    onConfirm={() => void deleteDatabase()}
                />
            )}

            {pendingRegenerateToken && (
                <ConfirmDialog
                    open
                    title="Régénérer le jeton"
                    message="Un nouveau jeton sera créé. Les applications rattachées seront mises à jour et redéployées. Les anciennes connexions cesseront de fonctionner."
                    tone="danger"
                    loading={accessSubmitting}
                    onCancel={() => setPendingRegenerateToken(false)}
                    onConfirm={() => void regenerateToken()}
                />
            )}
        </>
    );
}
