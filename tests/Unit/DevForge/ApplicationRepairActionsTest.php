<?php

use App\Services\DevForge\Application\ApplicationRepairActions;
use App\Services\DevForge\Agent\Tool\AgentServerExecutor;
use App\Services\DevForge\Core\CoreResourceAction;
use App\Services\DevForge\Core\CoreResourceCatalog;
use App\Services\DevForge\DeploymentData;
use App\Models\Application;
use App\Models\Team;
use Mockery;

it('resolves safe application host directory under applications uuid', function () {
    $team = Team::factory()->make();
    $application = Mockery::mock(Application::class)->makePartial();
    $application->uuid = 'bp68rd8g7pka4g9h0m8nl275';
    $application->shouldReceive('workdir')->never();

    $actions = new ApplicationRepairActions(
        team: $team,
        catalog: Mockery::mock(CoreResourceCatalog::class),
        resourceAction: Mockery::mock(CoreResourceAction::class),
        deploymentData: Mockery::mock(DeploymentData::class),
        serverExecutor: Mockery::mock(AgentServerExecutor::class),
        run: null,
        assignedResourceUuid: null,
        runContext: [],
        maxDeployActions: 1,
    );

    $resolved = $actions->resolveApplicationHostDirectory(
        $application,
        '/data/coolify/applications/bp68rd8g7pka4g9h0m8nl275/.env',
    );

    expect($resolved)->toBe([
        'path' => '/data/coolify/applications/bp68rd8g7pka4g9h0m8nl275',
    ]);
});

it('ignores unsafe path hints and falls back to applications uuid directory', function () {
    $team = Team::factory()->make();
    $application = Mockery::mock(Application::class)->makePartial();
    $application->uuid = 'bp68rd8g7pka4g9h0m8nl275';
    $application->shouldReceive('workdir')->andReturn('/data/coolify/applications/bp68rd8g7pka4g9h0m8nl275');

    $actions = new ApplicationRepairActions(
        team: $team,
        catalog: Mockery::mock(CoreResourceCatalog::class),
        resourceAction: Mockery::mock(CoreResourceAction::class),
        deploymentData: Mockery::mock(DeploymentData::class),
        serverExecutor: Mockery::mock(AgentServerExecutor::class),
    );

    $resolved = $actions->resolveApplicationHostDirectory(
        $application,
        '/tmp/evil',
    );

    expect($resolved)->toBe([
        'path' => '/data/coolify/applications/bp68rd8g7pka4g9h0m8nl275',
    ]);
});

it('reloads Coolify BASE_CONFIG_PATH via docker exec then redeploys', function () {
    $team = Team::factory()->make(['id' => 1]);
    $application = Mockery::mock(Application::class)->makePartial();
    $application->uuid = 'bp68rd8g7pka4g9h0m8nl275';

    $source = Mockery::mock(\App\Services\DevForge\Application\ApplicationSourceService::class);
    $source->shouldReceive('applicationForTeam')->andReturn($application);
    app()->instance(\App\Services\DevForge\Application\ApplicationSourceService::class, $source);

    $catalog = Mockery::mock(CoreResourceCatalog::class);
    $catalog->shouldReceive('find')
        ->with($team, 'applications', 'bp68rd8g7pka4g9h0m8nl275')
        ->andReturn($application);

    $serverExecutor = Mockery::mock(AgentServerExecutor::class);
    $serverExecutor->shouldReceive('resolveServerForApplication')
        ->with('bp68rd8g7pka4g9h0m8nl275')
        ->andReturn(['success' => true, 'server_uuid' => 'server-1', 'server_name' => 'localhost']);
    $serverExecutor->shouldReceive('execOnServer')
        ->once()
        ->withArgs(function (string $serverUuid, string $command): bool {
            return $serverUuid === 'server-1'
                && str_contains($command, 'config:clear')
                && str_contains($command, 'horizon:terminate');
        })
        ->andReturn([
            'success' => true,
            'output' => "ENV_BASE=/media/Docker/AppData/coolify/data\nMEDIA_PATH_OK=1\nOK_COOLIFY_BASE_CONFIG_RELOADED",
        ]);

    $resourceAction = Mockery::mock(CoreResourceAction::class);
    $resourceAction->shouldReceive('execute')
        ->once()
        ->andReturn(['ok' => true, 'deployment_uuid' => 'deploy-new']);

    $actions = new ApplicationRepairActions(
        team: $team,
        catalog: $catalog,
        resourceAction: $resourceAction,
        deploymentData: Mockery::mock(DeploymentData::class),
        serverExecutor: $serverExecutor,
        run: null,
        assignedResourceUuid: null,
        runContext: ['application_uuid' => 'bp68rd8g7pka4g9h0m8nl275'],
        maxDeployActions: 1,
    );

    $result = $actions->fixCoolifyBaseConfigPath('bp68rd8g7pka4g9h0m8nl275', true, 'test');

    expect($result['ok'] ?? false)->toBeTrue()
        ->and($result['redeploy']['deployment_uuid'] ?? null)->toBe('deploy-new');
});
