import { useState } from 'preact/hooks';
import { Database, Save } from 'lucide-preact';
import { useApiQuery } from '../../lib/use-api-query';
import { domainApi, type InstanceBackupDatabaseUpdateInput } from '../../lib/api/domain';
import { DataState } from '../ui/DataState';
import { Modal } from '../ui/Modal';

export function InstanceBackupSettingsPanel() {
    const settingsQuery = useApiQuery('instance-backup-settings', () => domainApi.instanceBackupSettings());
    const settings = settingsQuery.data?.data;

    const [initializing, setInitializing] = useState(false);
    
    // Database edit form
    const [dbForm, setDbForm] = useState<InstanceBackupDatabaseUpdateInput | null>(null);
    const [dbSubmitting, setDbSubmitting] = useState(false);

    // Initializer
    const initBackup = async () => {
        setInitializing(true);
        try {
            await domainApi.initInstanceBackupSettings();
            await settingsQuery.reload();
        } catch (e: unknown) {
            console.error(e);
        } finally {
            setInitializing(false);
        }
    };

    const submitDb = async (e: Event) => {
        e.preventDefault();
        if (!dbForm) return;
        setDbSubmitting(true);
        try {
            await domainApi.updateInstanceBackupDatabase(dbForm);
            await settingsQuery.reload();
            setDbForm(null);
        } catch (e: unknown) {
            console.error(e);
        } finally {
            setDbSubmitting(false);
        }
    };

    return (
        <section class="grid gap-6">
            <div class="grid gap-1">
                <h2 class="text-xl font-semibold">Sauvegarde de l'instance</h2>
                <p class="text-sm text-base-content/60">
                    Gérez la sauvegarde automatique de la base de données de DevForge elle-même.
                </p>
            </div>

            <DataState loading={settingsQuery.loading} error={settingsQuery.error} onRetry={() => void settingsQuery.reload()}>
                {settings && (
                    <>
                        {!settings.database && (
                            <div class="rounded-2xl border border-warning/30 bg-warning/5 p-6 text-center">
                                <h3 class="mb-2 font-semibold">Aucune configuration trouvée</h3>
                                <p class="mb-4 text-sm text-base-content/70">
                                    La base de données principale n'est pas encore configurée pour la sauvegarde automatique.
                                </p>
                                <button 
                                    class="btn btn-primary" 
                                    onClick={initBackup} 
                                    disabled={initializing}
                                >
                                    {initializing && <span class="loading loading-spinner loading-sm" />}
                                    Initialiser la sauvegarde
                                </button>
                            </div>
                        )}

                        {settings.database && (
                            <div class="grid gap-6 md:grid-cols-2">
                                <div class="rounded-2xl border border-base-300/70 bg-base-100 p-4 shadow-sm">
                                    <div class="mb-4 flex items-center gap-2">
                                        <Database class="size-5 text-primary" aria-hidden />
                                        <h3 class="font-semibold">Base de données cible</h3>
                                    </div>
                                    <div class="grid gap-2 text-sm">
                                        <div class="flex justify-between">
                                            <span class="text-base-content/60">Nom :</span>
                                            <span class="font-mono">{settings.database.name}</span>
                                        </div>
                                        <div class="flex justify-between">
                                            <span class="text-base-content/60">Utilisateur Postgres :</span>
                                            <span class="font-mono">{settings.database.postgres_user}</span>
                                        </div>
                                        <div class="flex justify-between">
                                            <span class="text-base-content/60">Statut :</span>
                                            <span class="font-mono">{settings.database.status}</span>
                                        </div>
                                        
                                        <div class="mt-4 flex justify-end">
                                            <button 
                                                class="btn btn-outline btn-sm"
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
                                    <div class="mb-4 flex items-center justify-between">
                                        <div class="flex items-center gap-2">
                                            <Save class="size-5 text-primary" aria-hidden />
                                            <h3 class="font-semibold">Planification</h3>
                                        </div>
                                        {settings.backup && (
                                            <span class={`badge ${settings.backup.enabled ? 'badge-success' : 'badge-neutral'}`}>
                                                {settings.backup.enabled ? 'Activée' : 'Désactivée'}
                                            </span>
                                        )}
                                    </div>
                                    
                                    {settings.backup ? (
                                        <div class="grid gap-2 text-sm">
                                            <div class="flex justify-between">
                                                <span class="text-base-content/60">Fréquence :</span>
                                                <span class="font-mono">{settings.backup.frequency}</span>
                                            </div>
                                            <div class="mt-4 flex justify-end">
                                                <a 
                                                    href={`/projects/1/environments/1/databases/${settings.database.uuid}?tab=backups`}
                                                    class="btn btn-primary btn-sm"
                                                >
                                                    Gérer les sauvegardes
                                                </a>
                                            </div>
                                        </div>
                                    ) : (
                                        <p class="text-sm text-base-content/60">Aucune planification trouvée.</p>
                                    )}
                                </div>
                            </div>
                        )}
                    </>
                )}
            </DataState>

            <Modal title="Configurer la base de données" open={!!dbForm} onClose={() => setDbForm(null)}>
                <form class="grid gap-4" onSubmit={submitDb}>
                    <div class="form-control">
                        <label class="label"><span class="label-text">Nom</span></label>
                        <input 
                            type="text" 
                            class="input input-bordered w-full" 
                            value={dbForm?.name ?? ''}
                            onInput={(e) => setDbForm({ ...dbForm!, name: e.currentTarget.value })}
                            required 
                        />
                    </div>
                    <div class="form-control">
                        <label class="label"><span class="label-text">Description</span></label>
                        <input 
                            type="text" 
                            class="input input-bordered w-full" 
                            value={dbForm?.description ?? ''}
                            onInput={(e) => setDbForm({ ...dbForm!, description: e.currentTarget.value })}
                        />
                    </div>
                    <div class="form-control">
                        <label class="label"><span class="label-text">Utilisateur Postgres</span></label>
                        <input 
                            type="text" 
                            class="input input-bordered w-full" 
                            value={dbForm?.postgres_user ?? ''}
                            onInput={(e) => setDbForm({ ...dbForm!, postgres_user: e.currentTarget.value })}
                            required 
                        />
                    </div>
                    <div class="form-control">
                        <label class="label"><span class="label-text">Mot de passe Postgres</span></label>
                        <input 
                            type="password" 
                            class="input input-bordered w-full" 
                            value={dbForm?.postgres_password ?? ''}
                            onInput={(e) => setDbForm({ ...dbForm!, postgres_password: e.currentTarget.value })}
                            required 
                        />
                    </div>
                    <div class="mt-4 flex justify-end gap-2">
                        <button class="btn btn-ghost" type="button" onClick={() => setDbForm(null)}>Annuler</button>
                        <button class="btn btn-primary" type="submit" disabled={dbSubmitting}>
                            {dbSubmitting && <span class="loading loading-spinner loading-sm" />}
                            Enregistrer
                        </button>
                    </div>
                </form>
            </Modal>
        </section>
    );
}
