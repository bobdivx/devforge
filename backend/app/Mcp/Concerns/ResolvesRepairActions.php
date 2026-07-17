<?php

namespace App\Mcp\Concerns;

use App\Models\Team;
use App\Services\DevForge\Agent\Tool\AgentServerExecutor;
use App\Services\DevForge\Application\ApplicationRepairActions;
use App\Services\DevForge\Core\CoreResourceAction;
use App\Services\DevForge\Core\CoreResourceCatalog;
use App\Services\DevForge\DeploymentData;

trait ResolvesRepairActions
{
    protected function repairActions(int $teamId): ApplicationRepairActions
    {
        $team = Team::query()->findOrFail($teamId);
        $catalog = app(CoreResourceCatalog::class);

        return new ApplicationRepairActions(
            team: $team,
            catalog: $catalog,
            resourceAction: app(CoreResourceAction::class),
            deploymentData: app(DeploymentData::class),
            serverExecutor: new AgentServerExecutor($team, $catalog),
            run: null,
            assignedResourceUuid: null,
            runContext: [],
            maxDeployActions: 5,
        );
    }
}
