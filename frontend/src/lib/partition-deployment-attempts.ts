import type { Deployment } from './domain-api';
import { isDeploymentActive } from './deployment-status';

export type DeploymentAttemptBucket = 'current' | 'active' | 'failed' | 'history';

export type PartitionedDeploymentAttempts = {
    current: Deployment | null;
    active: Deployment[];
    failed: Deployment[];
    history: Deployment[];
};

/**
 * Splits recent deployments into visual buckets for the application detail panel.
 * - current: the focused attempt (failure logs / agent card)
 * - active: in-progress / queued attempts other than current
 * - failed: failed attempts other than current (earlier retries)
 * - history: finished / cancelled attempts
 */
export function partitionDeploymentAttempts(
    deployments: Deployment[],
    focusedUuid: string | null,
): PartitionedDeploymentAttempts {
    const current = focusedUuid
        ? deployments.find((deployment) => deployment.uuid === focusedUuid) ?? null
        : null;

    const active: Deployment[] = [];
    const failed: Deployment[] = [];
    const history: Deployment[] = [];

    for (const deployment of deployments) {
        if (current && deployment.uuid === current.uuid) {
            continue;
        }

        const status = deployment.status.trim().toLowerCase();

        if (isDeploymentActive(deployment.status)) {
            active.push(deployment);
            continue;
        }

        if (status.includes('fail')) {
            failed.push(deployment);
            continue;
        }

        history.push(deployment);
    }

    return { current, active, failed, history };
}

export function deploymentAttemptBucket(
    deployment: Deployment,
    focusedUuid: string | null,
): DeploymentAttemptBucket {
    if (focusedUuid && deployment.uuid === focusedUuid) {
        return 'current';
    }

    const status = deployment.status.trim().toLowerCase();

    if (isDeploymentActive(deployment.status)) {
        return 'active';
    }

    if (status.includes('fail')) {
        return 'failed';
    }

    return 'history';
}
