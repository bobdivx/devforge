import { PageHeader } from '../../components/PageHeader';
import { InstanceBackupPanel } from '../../components/storages/InstanceBackupPanel';
import { S3StoragesSettings } from '../../components/storages/S3StoragesSettings';
import { Card } from '../../components/ui/Card';
import { DataState } from '../../components/ui/DataState';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { SettingsDetailList } from '../../components/settings/SettingsPanels';
import type { BootstrapPermissions } from '../../lib/bootstrap';
import { domainApi } from '../../lib/domain-api';
import {
    extractStorageUuid,
    storageShowsResources,
} from '../../lib/routing/storages-routes';
import { useApiQuery } from '../../lib/use-api-query';
import { navigateTo } from '../../lib/use-navigate';

function storageDetailPath(storageUuid: string, resources = false): string {
    return resources ? `/storages/${storageUuid}/resources` : `/storages/${storageUuid}`;
}

type StoragesPageProps = {
    path: string;
    permissions: BootstrapPermissions;
    legacyBaseUrl?: string;
};

export function StoragesPage({ path, permissions }: StoragesPageProps) {
    const storageUuid = extractStorageUuid(path);
    const showResources = storageShowsResources(path);

    if (storageUuid) {
        return (
            <StorageDetailPage
                storageUuid={storageUuid}
                showResources={showResources}
            />
        );
    }

    return (
        <div class="grid gap-3 sm:gap-4 md:gap-5">
            <PageHeader
                title="Stockage"
                description="Sauvegarde de l’instance DevForge et destinations S3."
            />
            {permissions.instance_admin && (
                <InstanceBackupPanel />
            )}
            <div class="grid gap-2">
                <h2 class="text-lg font-semibold">Destinations S3</h2>
                <p class="text-sm text-base-content/60">
                    Buckets utilisés par les sauvegardes de bases et, optionnellement, par la sauvegarde d’instance.
                </p>
            </div>
            <S3StoragesSettings canManage={permissions.create_resources} />
        </div>
    );
}

function StorageDetailPage({
    storageUuid,
    showResources,
}: {
    storageUuid: string;
    showResources: boolean;
}) {
    const storage = useApiQuery(`s3-storage:${storageUuid}`, () => domainApi.s3Storage(storageUuid));
    const data = storage.data?.data;

    return (
        <div class="grid gap-3 sm:gap-4 md:gap-5">
            <PageHeader
                title={data?.name ?? 'Stockage S3'}
                description={showResources ? 'Sauvegardes planifiées utilisant ce stockage.' : 'Configuration du stockage objet.'}
            />
            <button class="btn btn-ghost btn-sm w-fit" type="button" onClick={() => navigateTo('/storages')}>
                ← Tous les stockages
            </button>
            {showResources ? (
                <Card title="Sauvegardes liées">
                    <p class="text-sm text-base-content/65">
                        {data
                            ? `${data.scheduled_backups_count} sauvegarde(s) planifiée(s) utilisent ce stockage. La création et le déplacement des jobs se font depuis la fiche base de données.`
                            : 'Chargement des sauvegardes liées…'}
                    </p>
                    <button class="btn btn-ghost btn-sm mt-3 w-fit" type="button" onClick={() => navigateTo('/databases')}>
                        Voir les bases de données
                    </button>
                </Card>
            ) : (
                <DataState loading={storage.loading} error={storage.error} onRetry={() => void storage.reload()}>
                    {data && (
                        <Card title={data.name}>
                            <SettingsDetailList items={[
                                { label: 'Région', value: data.region },
                                { label: 'Bucket', value: data.bucket },
                                { label: 'Endpoint', value: data.endpoint },
                                { label: 'Connexion', value: <StatusBadge label={data.is_usable ? 'Validée' : 'Non testée'} tone={data.is_usable ? 'success' : 'warning'} /> },
                                { label: 'Sauvegardes liées', value: String(data.scheduled_backups_count) },
                            ]}
                            />
                            {data.description && <p class="mt-3 text-sm text-base-content/60">{data.description}</p>}
                            <p class="mt-3 text-xs text-base-content/55">
                                Pour modifier les identifiants ou tester la connexion, utilisez la liste des stockages.
                            </p>
                            <div class="mt-4 flex flex-wrap gap-2">
                                <button
                                    class="btn btn-ghost btn-sm"
                                    type="button"
                                    onClick={() => navigateTo('/storages')}
                                >
                                    Gérer / modifier
                                </button>
                                <button
                                    class="btn btn-ghost btn-sm"
                                    type="button"
                                    onClick={() => navigateTo(storageDetailPath(storageUuid, true))}
                                >
                                    Voir les ressources
                                </button>
                            </div>
                        </Card>
                    )}
                </DataState>
            )}
        </div>
    );
}
