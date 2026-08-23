import { RefreshCw } from 'lucide-preact';
import { useMemo } from 'preact/hooks';
import {
    OperationsExplorer,
    TopologySummaryChips,
} from '../../components/deployments/DeploymentTopologyCanvas';
import { PageHeader } from '../../components/PageHeader';
import { DataState } from '../../components/ui/DataState';
import { domainApi } from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';

export function DeploymentsPage() {
    const query = useApiQuery('deployments:topology', () => domainApi.deploymentTopology());
    const topology = query.data?.data;

    const empty = useMemo(() => {
        if (!topology) {
            return false;
        }
        return topology.nodes.filter((node) => node.type === 'application').length === 0;
    }, [topology]);

    return (
        <div class="grid min-w-0 gap-2.5 sm:gap-3 md:gap-4">
            <PageHeader
                eyebrow="Ops"
                title="Déploiements"
                description="Parcours clair par application : source Git → app → déploiement → URL live, avec les interventions d’agents."
                actions={(
                    <button class="btn btn-ghost btn-sm rounded-full border border-base-300/80" type="button" onClick={() => void query.reload()}>
                        <RefreshCw class="size-3.5" aria-hidden />
                        Actualiser
                    </button>
                )}
            />

            {topology && <TopologySummaryChips summary={topology.summary} />}

            <DataState
                loading={query.loading}
                error={query.error}
                empty={empty}
                emptyMessage="Aucune application à cartographier pour cette équipe."
                onRetry={() => void query.reload()}
            >
                {topology && <OperationsExplorer topology={topology} />}
            </DataState>
        </div>
    );
}
