import { RefreshCw } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { Pagination } from '../components/ui/Pagination';
import { PageHeader } from '../components/PageHeader';
import { DeploymentAgentCard } from '../components/applications/DeploymentAgentCard';
import { DeploymentLogsPanel } from '../components/applications/DeploymentLogsPanel';
import { DataState } from '../components/ui/DataState';
import { DeploymentStatusIcon } from '../components/ui/DeploymentStatusIcon';
import { domainApi, type Deployment } from '../lib/domain-api';
import { useApiQuery } from '../lib/use-api-query';

export function DeploymentsPage() {
    const [page, setPage] = useState(1);
    const [selected, setSelected] = useState<Deployment | null>(null);
    const [selectError, setSelectError] = useState<string | null>(null);
    const [selecting, setSelecting] = useState(false);
    const query = useApiQuery(`deployments:${page}`, () => domainApi.deployments(page));
    const deployments = query.data?.data ?? [];
    const lastPage = Number(query.data?.meta?.last_page ?? 1);

    const selectDeploymentByUuid = async (deploymentUuid: string) => {
        const fromList = deployments.find((deployment) => deployment.uuid === deploymentUuid);

        if (fromList) {
            setSelectError(null);
            setSelected(fromList);
            return;
        }

        setSelecting(true);
        setSelectError(null);

        try {
            const response = await domainApi.deployment(deploymentUuid);
            setSelected(response.data);
            void query.reload({ silent: true });
        } catch {
            setSelectError('Impossible d’ouvrir ce redéploiement. Actualisez la liste puis réessayez.');
        } finally {
            setSelecting(false);
        }
    };

    return (
        <>
            <PageHeader
                title="Déploiements"
                description="Historique, logs en direct et surveillance agent."
                actions={(
                    <button class="btn btn-ghost btn-sm" type="button" onClick={() => void query.reload()}>
                        <RefreshCw class="size-3.5" aria-hidden />
                        Actualiser
                    </button>
                )}
            />
            {selectError && (
                <p class="mb-4 rounded-xl border border-error/30 bg-error/10 px-3 py-2 text-xs text-error" role="alert">
                    {selectError}
                </p>
            )}
            {selected && (
                <div class="mb-5 grid gap-4 xl:grid-cols-2">
                    <DeploymentLogsPanel deploymentUuid={selected.uuid} deployment={selected} />
                    <DeploymentAgentCard
                        deploymentUuid={selected.uuid}
                        onSelectDeployment={(deploymentUuid) => {
                            void selectDeploymentByUuid(deploymentUuid);
                        }}
                    />
                </div>
            )}
            {selecting && (
                <p class="mb-4 text-xs text-base-content/55" role="status">
                    Ouverture du redéploiement…
                </p>
            )}
            <DataState
                loading={query.loading}
                error={query.error}
                empty={deployments.length === 0}
                emptyMessage="Aucun déploiement."
                onRetry={() => void query.reload()}
            >
                <div class="overflow-x-auto border border-base-300 bg-base-100">
                    <table class="table table-sm">
                        <thead>
                            <tr>
                                <th>Application</th>
                                <th>Statut</th>
                                <th>Commit</th>
                                <th>Date</th>
                                <th><span class="sr-only">Actions</span></th>
                            </tr>
                        </thead>
                        <tbody>
                            {deployments.map((deployment) => (
                                <tr
                                    class={selected?.uuid === deployment.uuid ? 'bg-primary/5' : 'cursor-pointer hover:bg-base-200/40'}
                                    key={deployment.uuid}
                                    onClick={() => setSelected(deployment)}
                                >
                                    <td class="font-medium">{deployment.application?.name ?? '—'}</td>
                                    <td><DeploymentStatusIcon status={deployment.status} showLabel /></td>
                                    <td class="max-w-48 truncate font-mono text-[11px]">{deployment.commit || '—'}</td>
                                    <td class="text-xs">{deployment.created_at ? new Date(deployment.created_at).toLocaleString('fr-FR') : '—'}</td>
                                    <td class="text-end">
                                        <button
                                            class={`btn btn-ghost btn-sm ${selected?.uuid === deployment.uuid ? 'text-primary' : ''}`}
                                            type="button"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                setSelected(deployment);
                                            }}
                                        >
                                            Suivre
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {lastPage > 1 && (
                    <Pagination page={page} lastPage={lastPage} onPageChange={setPage} label="Pagination des déploiements" />
                )}
            </DataState>
        </>
    );
}
