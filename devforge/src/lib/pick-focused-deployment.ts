import type { Deployment } from './domain-api';
import { isDeploymentActive } from './deployment-status';

export type PickFocusedDeploymentOptions = {
    /**
     * When true, keep the preferred UUID even if another deployment is active
     * (user explicitly opened historical logs).
     */
    pinned?: boolean;
};

/**
 * Chooses which deployment to follow in the application detail panel.
 *
 * An explicitly selected UUID (e.g. agent redeploy) is preserved while the
 * recent list is still empty/loading, or once it appears in the list.
 * A preferred UUID that belongs to another application (stale after navigation)
 * is dropped as soon as this app's deployments are known.
 *
 * Unless `pinned` is set, a terminal preferred focus yields to any active
 * deployment so a fresh deploy/redeploy becomes the followed attempt.
 */
export function pickFocusedDeployment(
    deployments: Deployment[],
    preferredUuid: string | null,
    options: PickFocusedDeploymentOptions = {},
): string | null {
    const pinned = options.pinned === true;
    const active = deployments.find((deployment) => isDeploymentActive(deployment.status));

    if (preferredUuid) {
        const preferred = deployments.find((deployment) => deployment.uuid === preferredUuid);

        if (preferred) {
            if (pinned || isDeploymentActive(preferred.status) || !active) {
                return preferredUuid;
            }

            // Fresh in-progress / queued attempt should take over failed/finished focus.
            return active.uuid;
        }

        // Reload in progress / empty history: keep the pending selection.
        if (deployments.length === 0) {
            return preferredUuid;
        }
    }

    return active?.uuid ?? deployments[0]?.uuid ?? null;
}
