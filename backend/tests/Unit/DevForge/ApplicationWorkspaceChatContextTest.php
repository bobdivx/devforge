<?php

use App\Models\Application;
use App\Models\ApplicationDeploymentQueue;
use App\Models\EnvironmentVariable;
use App\Models\User;
use App\Services\DevForge\Agent\ApplicationWorkspaceChatContext;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

it('builds a live workspace pack without leaking secret values', function () {
    $user = User::factory()->create();
    $team = $user->teams()->firstOrFail();
    $server = \App\Models\Server::factory()->create(['team_id' => $team->id]);
    $destination = $server->standaloneDockers()->firstOrFail();
    $project = \App\Models\Project::factory()->create(['team_id' => $team->id]);
    $environment = \App\Models\Environment::factory()->create(['project_id' => $project->id]);
    $application = Application::factory()->create([
        'name' => 'macompta',
        'environment_id' => $environment->id,
        'destination_id' => $destination->id,
        'destination_type' => \App\Models\StandaloneDocker::class,
        'git_repository' => 'acme/macompta',
        'git_branch' => 'main',
        'build_pack' => 'nixpacks',
        'fqdn' => 'https://macompta.example.com',
        'health_check_enabled' => true,
        'health_check_path' => '/health',
    ]);
    $application->forceFill([
        'status' => 'running:unhealthy',
        'custom_nginx_configuration' => 'server { listen 80; }',
    ])->save();
    $application->refresh();

    $secret = 'super-secret-token-xyz';
    EnvironmentVariable::create([
        'key' => 'DATABASE_URL',
        'value' => 'postgres://user:'.$secret.'@db:5432/app',
        'is_preview' => false,
        'resourceable_type' => Application::class,
        'resourceable_id' => $application->id,
    ]);

    ApplicationDeploymentQueue::create([
        'application_id' => (string) $application->id,
        'deployment_uuid' => 'dep-failed-1',
        'status' => 'failed',
        'logs' => json_encode([
            ['output' => 'Starting deploy', 'hidden' => false],
            ['output' => 'Connection failed with '.$secret, 'hidden' => false],
            ['output' => 'internal debug '.$secret, 'hidden' => true],
        ]),
    ]);

    $pack = app(ApplicationWorkspaceChatContext::class)->build($application);
    $encoded = json_encode($pack, JSON_THROW_ON_ERROR);

    expect($pack['application_uuid'])->toBe($application->uuid)
        ->and($pack['application_status'])->toBe('running:unhealthy')
        ->and($pack['has_custom_nginx'])->toBeTrue()
        ->and($pack['latest_deployment']['status'])->toBe('failed')
        ->and($pack['latest_deployment']['failed_logs'])->toHaveCount(2)
        ->and($pack['env_var_hints'][0]['key'])->toBe('DATABASE_URL')
        ->and($pack['env_var_hints'][0]['scheme'])->toBe('postgres')
        ->and($pack['workspace_brief'])->toContain('running:unhealthy')
        ->and($pack['workspace_brief'])->toContain('DATABASE_URL')
        ->and($pack['workspace_brief'])->toContain('Nginx custom : oui')
        ->and($encoded)->not->toContain($secret)
        ->and($encoded)->not->toContain('postgres://user:');
});
