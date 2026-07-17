import type { DeploymentDispatchPolicy, DeploymentMonitoring } from './domain-api';

/**
 * Message UI quand monitor_build est on mais le quota bloque les events build.
 */
export function buildMonitoringQuotaNotice(
    agents: DeploymentMonitoring['agents'] | undefined,
    policy: DeploymentDispatchPolicy | undefined,
): string | null {
    if (!agents?.enabled || !agents.monitor_build || !policy) {
        return null;
    }

    if (policy.build_monitoring_effective) {
        return null;
    }

    return policy.summary
        ?? `La surveillance des builds est activée, mais le quota (${policy.max_runs_per_deployment} run/déploiement) ne déclenche un agent qu’en cas d’échec. Augmentez DEVFORGE_AGENTS_PER_DEPLOYMENT_MAX_RUNS à 2+ pour surveiller aussi les builds.`;
}
