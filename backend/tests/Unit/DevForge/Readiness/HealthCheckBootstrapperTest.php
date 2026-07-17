<?php

use App\Models\Application;
use App\Models\Environment;
use App\Models\Project;
use App\Models\Server;
use App\Models\StandaloneDocker;
use App\Models\User;
use App\Services\DevForge\Readiness\HealthCheckBootstrapper;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

it('enables http healthcheck defaults from ports_exposes', function () {
    $user = User::factory()->create();
    $team = $user->teams()->firstOrFail();
    $server = Server::factory()->create(['team_id' => $team->id]);
    $destination = $server->standaloneDockers()->firstOrFail();
    $project = Project::factory()->create(['team_id' => $team->id]);
    $environment = Environment::factory()->create(['project_id' => $project->id]);

    $application = Application::factory()->create([
        'environment_id' => $environment->id,
        'destination_id' => $destination->id,
        'destination_type' => StandaloneDocker::class,
        'ports_exposes' => '3000',
        'health_check_enabled' => false,
        'health_check_path' => null,
        'health_check_port' => null,
    ]);

    $result = app(HealthCheckBootstrapper::class)->ensureEnabled($application->fresh());

    $application->refresh();

    expect($result['changed'])->toBeTrue()
        ->and($application->health_check_enabled)->toBeTrue()
        ->and($application->health_check_type)->toBe('http')
        ->and($application->health_check_path)->toBe('/')
        ->and((string) $application->health_check_port)->toBe('3000');
});
