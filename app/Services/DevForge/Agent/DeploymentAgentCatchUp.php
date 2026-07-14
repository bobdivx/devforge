<?php

namespace App\Services\DevForge\Agent;

use App\Enums\ApplicationDeploymentStatus;
use App\Models\ApplicationDeploymentQueue;

class DeploymentAgentCatchUp
{
    public function __construct(
        private readonly DeploymentBuildAgentDispatcher $buildDispatcher,
        private readonly DeploymentFailureAgentDispatcher $failureDispatcher,
        private readonly DeploymentAgentResolver $agentResolver,
    ) {}

    public function maybeDispatch(ApplicationDeploymentQueue $deployment): bool
    {
        if (! $this->isRecent($deployment)) {
            return false;
        }

        $application = $deployment->application;

        if ($application === null) {
            return false;
        }

        $team = $this->agentResolver->resolveTeam($application);

        if ($team === null) {
            return false;
        }

        $diagnostics = $this->agentResolver->diagnostics($team, $application->uuid);

        if (($diagnostics['eligible_agents_count'] ?? 0) === 0) {
            return false;
        }

        if ($deployment->restart_only) {
            return false;
        }

        return match ($deployment->status) {
            ApplicationDeploymentStatus::FAILED->value => $this->dispatchFailure($application, $deployment),
            ApplicationDeploymentStatus::IN_PROGRESS->value => $this->dispatchBuildStart($application, $deployment),
            default => false,
        };
    }

    private function isRecent(ApplicationDeploymentQueue $deployment): bool
    {
        $reference = $deployment->finished_at ?? $deployment->updated_at ?? $deployment->created_at;

        if ($reference === null) {
            return false;
        }

        return $reference->greaterThan(now()->subHours(6));
    }

    private function dispatchFailure(\App\Models\Application $application, ApplicationDeploymentQueue $deployment): bool
    {
        if (! config('devforge.agents_enabled') || ! config('devforge.agents_auto_fix_deployments')) {
            return false;
        }

        $this->failureDispatcher->dispatch(
            application: $application,
            deploymentUuid: (string) $deployment->deployment_uuid,
            deploymentQueue: $deployment,
        );

        return true;
    }

    private function dispatchBuildStart(\App\Models\Application $application, ApplicationDeploymentQueue $deployment): bool
    {
        if (! config('devforge.agents_enabled') || ! config('devforge.agents_monitor_build_enabled', true)) {
            return false;
        }

        $this->buildDispatcher->dispatch(
            application: $application,
            deploymentUuid: (string) $deployment->deployment_uuid,
            deploymentQueue: $deployment,
        );

        return true;
    }
}
