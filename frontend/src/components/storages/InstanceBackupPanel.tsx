import { useRef, useState } from 'preact/hooks';
import { CloudUpload, Database, Download, RefreshCw, Save, Upload } from 'lucide-preact';
import {
    domainApi,
    type InstanceBackupDatabaseUpdateInput,
    type InstanceBackupScheduleUpdateInput,
    type InstanceBackupSettings,
} from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';
import { CronInput } from '../ui/CronInput';
import { DataState } from '../ui/DataState';
import { Modal } from '../ui/Modal';
import { StatusBadge } from '../ui/StatusBadge';
import { Card } from '../ui/Card';

type Props = {
    compact?: boolean;
};

export function InstanceBackupPanel({ compact = false }: Props) {
    const settingsQuery = useApiQuery('instance-backup-settings', () => domainApi.instanceBackupSettings());
    const settings = settingsQuery.data?.data;

    const [busy, setBusy] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [dbForm, setDbForm] = useState<InstanceBackupDatabaseUpdateInput | null>(null);
    const [scheduleForm, setScheduleForm] = useState<InstanceBackupScheduleUpdateInput | null>(null);
    const importInputRef = useRef<HTMLInputElement>(null);
    const coolifyImportInputRef = useRef<HTMLInputElement>(null);

    const withAction = async (key: string, action: () => Promise<void>) => {
        setBusy(key);
        setError(null);
        setNotice(null);
        try {
            await action();
            await settingsQuery.reload();
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Action impossible.');
        } finally {
            setBusy(null);
        }
    };

    const initBackup = () => withAction('init', async () => {
        await domainApi.initInstanceBackupSettings();
        setNotice('Sauvegarde d’instance initialisée.');
    });

    const migrateCoolify = () => withAction('migrate', async () => {
        const response = await domainApi.migrateInstanceFromCoolify();
        setNotice(response.data.message ?? 'Migration Coolify → DevForge effectuée.');
    });

    const runNow = () => withAction('run', async () => {
        const response = await domainApi.runInstanceBackup();
        setNotice(response.data.message);
    });

    const exportBackup = () => withAction('export', async () => {
        const response = await domainApi.exportInstanceBackup();
        window.location.href = response.data.download_url;
        setNotice('Téléchargement de la dernière sauvegarde locale…');
    });

    const importFile = async (file: File, fromCoolify: boolean) => {
        await withAction(fromCoolify ? 'import-coolify' : 'import', async () => {
            const response = await domainApi.importInstanceBackup(file, fromCoolify);
            setNotice(response.data.message);
        });
    };

    const submitDb = async (e: Event) => {
        e.preventDefault();
        if (!dbForm) return;
        await withAction('db', async () => {
            await domainApi.updateInstanceBackupDatabase(dbForm);
            setDbForm(null);
            setNotice('Base d’instance mise à jour.');
        });
    };

    const submitSchedule = async (e: Event) => {
        e.preventDefault();
        if (!scheduleForm) return;
        await withAction('schedule', async () => {
            await domainApi.updateInstanceBackupSchedule(scheduleForm);
            setScheduleForm(null);
            setNotice('Planification enregistrée (local + S3 si activé).');
        });
    };

    const openScheduleEditor = (data: InstanceBackupSettings) => {
        setScheduleForm({
            enabled: data.backup?.enabled ?? true,
            frequency: data.backup?.frequency ?? '0 0 * * *',
            save_s3: data.backup?.save_s3 ?? false,
            s3_storage_uuid: data.backup?.s3_storage?.uuid ?? null,
            disable_local_backup: data.backup?.disable_local_backup ?? false,
        });
    };

    return (
        <section class="grid gap-4">
            {!compact && (
                <div class="grid gap-1">
                    <h2 class="text-xl font-semibold">Sauvegarde DevForge</h2>
                    <p class="text-sm text-base-content/60">
                        Sauvegardez la base de l’instance (même moteur que les backups S3 des bases), exportez / importez un dump,
                        ou migrez depuis Coolify.
                    </p>
                </div>
            )}

            {notice && (
                <div class="rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">{notice}</div>
            )}
            {error && (
                <div class="rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">{error}</div>
            )}

            <DataState loading={settingsQuery.loading} error={settingsQuery.error} onRetry={() => void settingsQuery.reload()}>
                {settings && (
                    <div class="grid gap-4">
                        {(settings.migration.legacy_container_detected || !settings.database) && (
                            <Card title="Migration Coolify → DevForge">
                                <p class="text-sm text-base-content/65">
                                    {settings.migration.notes}
                                </p>
                                {settings.migration.legacy_container_detected && (
                                    <p class="mt-2 text-sm text-warning">
                                        Conteneur <code class="font-mono">coolify-db</code> détecté sur le serveur local.
                                    </p>
                                )}
                                <div class="mt-4 flex flex-wrap gap-2">
                                    <button
                                        class="btn btn-primary btn-sm"
                                        type="button"
                                        disabled={busy === 'migrate'}
                                        onClick={() => void migrateCoolify()}
                                    >
                                        {busy === 'migrate' && <span class="loading loading-spinner loading-sm" />}
                                        Détecter / synchroniser Coolify
                                    </button>
                                    {!settings.database && (
                                        <p class="w-full text-xs text-base-content/55">
                                            Après initialisation, utilisez « Import dump Coolify » dans Export / import.
                                        </p>
                                    )}
                                    {settings.database && (
                                        <p class="w-full text-xs text-base-content/55">
                                            Pour un dump fichier, utilisez « Import dump Coolify » ci-dessous.
                                        </p>
                                    )}
                                </div>
                            </Card>
                        )}

                        {!settings.database && (
                            <div class="rounded-2xl border border-warning/30 bg-warning/5 p-6 text-center">
                                <h3 class="mb-2 font-semibold">Aucune configuration trouvée</h3>
                                <p class="mb-4 text-sm text-base-content/70">
                                    Initialisez la sauvegarde depuis le conteneur Postgres d’instance (<code class="font-mono">devforge-db</code> ou <code class="font-mono">coolify-db</code>).
                                </p>
                                <button class="btn btn-primary" type="button" onClick={() => void initBackup()} disabled={busy === 'init'}>
                                    {busy === 'init' && <span class="loading loading-spinner loading-sm" />}
                                    Initialiser la sauvegarde
                                </button>
                            </div>
                        )}

                        {settings.database && (
                            <div class={`grid gap-4 ${compact ? '' : 'md:grid-cols-2'}`}>
                                <div class="rounded-2xl border border-base-300/70 bg-base-100 p-4 shadow-sm">
                                    <div class="mb-4 flex items-center gap-2">
                                        <Database class="size-5 text-primary" aria-hidden />
                                        <h3 class="font-semibold">Base d’instance</h3>
                                    </div>
                                    <div class="grid gap-2 text-sm">
                                        <div class="flex justify-between gap-3">
                                            <span class="text-base-content/60">Nom</span>
                                            <span class="font-mono text-right">{settings.database.name}</span>
                                        </div>
                                        <div class="flex justify-between gap-3">
                                            <span class="text-base-content/60">Utilisateur</span>
                                            <span class="font-mono text-right">{settings.database.postgres_user}</span>
                                        </div>
                                        <div class="flex justify-between gap-3">
                                            <span class="text-base-content/60">Statut</span>
                                            <StatusBadge
                                                label={settings.database.status}
                                                tone={settings.database.status === 'running' ? 'success' : 'warning'}
                                            />
                                        </div>
                                        <div class="mt-3 flex justify-end">
                                            <button
                                                class="btn btn-outline btn-sm"
                                                type="button"
                                                onClick={() => setDbForm({
                                                    name: settings.database!.name,
                                                    description: settings.database!.description,
                                                    postgres_user: settings.database!.postgres_user,
                                                    postgres_password: settings.database!.postgres_password || '',
                                                })}
                                            >
                                                Modifier
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                <div class="rounded-2xl border border-base-300/70 bg-base-100 p-4 shadow-sm">
                                    <div class="mb-4 flex items-center justify-between gap-2">
                                        <div class="flex items-center gap-2">
                                            <Save class="size-5 text-primary" aria-hidden />
                                            <h3 class="font-semibold">Planification</h3>
                                        </div>
                                        {settings.backup && (
                                            <StatusBadge
                                                label={settings.backup.enabled ? 'Activée' : 'Désactivée'}
                                                tone={settings.backup.enabled ? 'success' : 'neutral'}
                                            />
                                        )}
                                    </div>
                                    {settings.backup ? (
                                        <div class="grid gap-2 text-sm">
                                            <div class="flex justify-between gap-3">
                                                <span class="text-base-content/60">Fréquence</span>
                                                <span class="font-mono text-right">{settings.backup.frequency}</span>
                                            </div>
                                            <div class="flex justify-between gap-3">
                                                <span class="text-base-content/60">S3</span>
                                                <span>
                                                    {settings.backup.save_s3
                                                        ? (settings.backup.s3_storage?.name ?? 'Activé')
                                                        : 'Local uniquement'}
                                                </span>
                                            </div>
                                            {!settings.is_server_functional && (
                                                <p class="text-xs text-warning">Le serveur local n’est pas prêt — les jobs peuvent être désactivés.</p>
                                            )}
                                            <div class="mt-3 flex flex-wrap justify-end gap-2">
                                                <button class="btn btn-outline btn-sm" type="button" onClick={() => openScheduleEditor(settings)}>
                                                    Configurer (S3)
                                                </button>
                                                <button class="btn btn-primary btn-sm" type="button" disabled={busy === 'run'} onClick={() => void runNow()}>
                                                    {busy === 'run' ? <span class="loading loading-spinner loading-sm" /> : <RefreshCw class="size-4" aria-hidden />}
                                                    Lancer maintenant
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <p class="text-sm text-base-content/60">Aucune planification. Réinitialisez ou configurez-en une.</p>
                                    )}
                                </div>
                            </div>
                        )}

                        {settings.database && (
                            <Card title="Export / import">
                                <p class="text-sm text-base-content/65">
                                    L’export télécharge la dernière sauvegarde locale (même fichiers que pour S3). L’import restaure un dump dans Postgres d’instance.
                                </p>
                                <div class="mt-4 flex flex-wrap gap-2">
                                    <button class="btn btn-outline btn-sm" type="button" disabled={busy === 'export'} onClick={() => void exportBackup()}>
                                        {busy === 'export' ? <span class="loading loading-spinner loading-sm" /> : <Download class="size-4" aria-hidden />}
                                        Exporter
                                    </button>
                                    <button class="btn btn-outline btn-sm" type="button" disabled={busy === 'import'} onClick={() => importInputRef.current?.click()}>
                                        {busy === 'import' ? <span class="loading loading-spinner loading-sm" /> : <CloudUpload class="size-4" aria-hidden />}
                                        Importer une sauvegarde
                                    </button>
                                    <button
                                        class="btn btn-ghost btn-sm"
                                        type="button"
                                        disabled={busy === 'import-coolify'}
                                        onClick={() => coolifyImportInputRef.current?.click()}
                                    >
                                        <Upload class="size-4" aria-hidden />
                                        Import dump Coolify
                                    </button>
                                    <input
                                        ref={importInputRef}
                                        type="file"
                                        class="hidden"
                                        accept=".sql,.sql.gz,.gz,.dump"
                                        onChange={(e) => {
                                            const file = e.currentTarget.files?.[0];
                                            e.currentTarget.value = '';
                                            if (file) void importFile(file, false);
                                        }}
                                    />
                                    <input
                                        ref={coolifyImportInputRef}
                                        type="file"
                                        class="hidden"
                                        accept=".sql,.sql.gz,.gz,.dump"
                                        onChange={(e) => {
                                            const file = e.currentTarget.files?.[0];
                                            e.currentTarget.value = '';
                                            if (file) void importFile(file, true);
                                        }}
                                    />
                                </div>

                                {settings.executions.length > 0 && (
                                    <div class="mt-5 overflow-x-auto">
                                        <table class="table table-sm">
                                            <thead>
                                                <tr>
                                                    <th>Date</th>
                                                    <th>Statut</th>
                                                    <th>Fichier</th>
                                                    <th />
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {settings.executions.slice(0, 8).map((execution) => (
                                                    <tr key={execution.uuid}>
                                                        <td class="whitespace-nowrap text-xs">{execution.created_at ?? '—'}</td>
                                                        <td><StatusBadge label={execution.status ?? '—'} tone={execution.status === 'success' ? 'success' : 'neutral'} /></td>
                                                        <td class="max-w-[14rem] truncate font-mono text-xs">{execution.filename ?? '—'}</td>
                                                        <td>
                                                            {execution.download_url && (
                                                                <a class="btn btn-ghost btn-xs" href={execution.download_url}>
                                                                    Télécharger
                                                                </a>
                                                            )}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </Card>
                        )}
                    </div>
                )}
            </DataState>

            <Modal title="Configurer la base de données" open={!!dbForm} onClose={() => setDbForm(null)}>
                <form class="grid gap-4" onSubmit={submitDb}>
                    <label class="form-control">
                        <span class="label-text">Nom</span>
                        <input class="input input-bordered w-full" value={dbForm?.name ?? ''} required onInput={(e) => setDbForm({ ...dbForm!, name: e.currentTarget.value })} />
                    </label>
                    <label class="form-control">
                        <span class="label-text">Description</span>
                        <input class="input input-bordered w-full" value={dbForm?.description ?? ''} onInput={(e) => setDbForm({ ...dbForm!, description: e.currentTarget.value })} />
                    </label>
                    <label class="form-control">
                        <span class="label-text">Utilisateur Postgres</span>
                        <input class="input input-bordered w-full" value={dbForm?.postgres_user ?? ''} required onInput={(e) => setDbForm({ ...dbForm!, postgres_user: e.currentTarget.value })} />
                    </label>
                    <label class="form-control">
                        <span class="label-text">Mot de passe Postgres</span>
                        <input type="password" class="input input-bordered w-full" value={dbForm?.postgres_password ?? ''} required onInput={(e) => setDbForm({ ...dbForm!, postgres_password: e.currentTarget.value })} />
                    </label>
                    <div class="flex justify-end gap-2">
                        <button class="btn btn-ghost" type="button" onClick={() => setDbForm(null)}>Annuler</button>
                        <button class="btn btn-primary" type="submit" disabled={busy === 'db'}>
                            {busy === 'db' && <span class="loading loading-spinner loading-sm" />}
                            Enregistrer
                        </button>
                    </div>
                </form>
            </Modal>

            <Modal title="Planification & S3" open={!!scheduleForm} onClose={() => setScheduleForm(null)}>
                <form class="grid gap-4" onSubmit={submitSchedule}>
                    <label class="flex items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            class="checkbox checkbox-sm"
                            checked={scheduleForm?.enabled ?? true}
                            onChange={(e) => setScheduleForm({ ...scheduleForm!, enabled: e.currentTarget.checked })}
                        />
                        Activée
                    </label>
                    <div>
                        <span class="label-text mb-1 block">Fréquence</span>
                        <CronInput
                            value={scheduleForm?.frequency ?? '0 0 * * *'}
                            onChange={(value) => setScheduleForm({ ...scheduleForm!, frequency: value })}
                        />
                    </div>
                    <label class="flex items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            class="checkbox checkbox-sm"
                            checked={scheduleForm?.save_s3 ?? false}
                            onChange={(e) => setScheduleForm({ ...scheduleForm!, save_s3: e.currentTarget.checked })}
                        />
                        Envoyer aussi vers S3 (mêmes destinations que Stockage S3)
                    </label>
                    {scheduleForm?.save_s3 && (
                        <label class="form-control">
                            <span class="label-text">Destination S3</span>
                            <select
                                class="select select-bordered w-full"
                                value={scheduleForm.s3_storage_uuid ?? ''}
                                onChange={(e) => setScheduleForm({ ...scheduleForm!, s3_storage_uuid: e.currentTarget.value || null })}
                                required
                            >
                                <option value="">Choisir…</option>
                                {(settings?.s3_storages ?? []).map((storage) => (
                                    <option key={storage.uuid} value={storage.uuid}>
                                        {storage.name}{storage.is_usable ? '' : ' (non testée)'}
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}
                    <label class="flex items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            class="checkbox checkbox-sm"
                            checked={scheduleForm?.disable_local_backup ?? false}
                            onChange={(e) => setScheduleForm({ ...scheduleForm!, disable_local_backup: e.currentTarget.checked })}
                        />
                        Désactiver la copie locale (S3 uniquement)
                    </label>
                    <div class="flex justify-end gap-2">
                        <button class="btn btn-ghost" type="button" onClick={() => setScheduleForm(null)}>Annuler</button>
                        <button class="btn btn-primary" type="submit" disabled={busy === 'schedule'}>
                            {busy === 'schedule' && <span class="loading loading-spinner loading-sm" />}
                            Enregistrer
                        </button>
                    </div>
                </form>
            </Modal>
        </section>
    );
}
