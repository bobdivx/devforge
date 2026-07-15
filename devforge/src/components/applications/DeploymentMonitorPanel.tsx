import type { Deployment } from '../../lib/domain-api';
import { DeploymentAgentCard } from './DeploymentAgentCard';
import { DeploymentLogsPanel } from './DeploymentLogsPanel';

type Props = {
    deploymentUuid: string;
    deployment?: Deployment | null;
    onSelectDeployment?: (deploymentUuid: string) => void;
};

export function DeploymentMonitorPanel({ deploymentUuid, deployment = null, onSelectDeployment }: Props) {
    return (
        <div class="grid min-w-0 gap-4 xl:grid-cols-2">
            <DeploymentLogsPanel class="min-w-0" deploymentUuid={deploymentUuid} deployment={deployment} />
            <DeploymentAgentCard
                deploymentUuid={deploymentUuid}
                onSelectDeployment={onSelectDeployment}
            />
        </div>
    );
}
