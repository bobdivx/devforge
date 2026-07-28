import type { Deployment } from '../../lib/domain-api';
import { isDeploymentActive } from '../../lib/deployment-status';
import { DeploymentAgentCard } from './DeploymentAgentCard';
import { DeploymentLogsPanel } from './DeploymentLogsPanel';

type Props = {
    deploymentUuid: string;
    deployment?: Deployment | null;
    onSelectDeployment?: (deploymentUuid: string) => void;
};

export function DeploymentMonitorPanel({ deploymentUuid, deployment = null, onSelectDeployment }: Props) {
    const historyMode = deployment ? !isDeploymentActive(deployment.status) : false;

    return (
        <div class="grid min-w-0 gap-4 lg:grid-cols-2">
            <DeploymentLogsPanel class="min-w-0" deploymentUuid={deploymentUuid} deployment={deployment} />
            <DeploymentAgentCard
                deploymentUuid={deploymentUuid}
                historyMode={historyMode}
                onSelectDeployment={onSelectDeployment}
            />
        </div>
    );
}
