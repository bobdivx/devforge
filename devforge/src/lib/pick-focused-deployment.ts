import type { Deployment } from './domain-api';
import { isDeploymentActive } from './deployment-status';

/**
 * Chooses which deployment to follow in the application detail panel.
 *
 * An explicitly selected UUID (e.g. agent redeploy) is preserved while the
 * recent list is still empty/loading, or once it appears in the list.
 * A preferred UUID that belongs to another application (stale after navigation)
 * is dropped as soon as this app's deployments are known.
 */
export function pickFocusedDeployment(
    deployments: Deployment[],
    preferredUuid: string | null,
): string | null {
    if (preferredUuid) {
        if (deployments.some((deployment) => deployment.uuid === preferredUuid)) {
            return preferredUuid;
        }

        // Reload in progress / empty history: keep the pending selection.
        if (deployments.length === 0) {
            return preferredUuid;
        }
    }

    const active = deployments.find((deployment) => isDeploymentActive(deployment.status));

    return active?.uuid ?? deployments[0]?.uuid ?? null;
}
