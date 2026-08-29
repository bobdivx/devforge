<?php

use App\Models\Application;
use App\Models\ApplicationDeploymentQueue;
use App\Models\EnvironmentVariable;
use App\Models\User;
use App\Jobs\Agent\RunAgentChatJob;
use App\Models\AiAgent;
use App\Models\AiAgentSession;
use App\Models\AiProviderConfig;
use App\Services\DevForge\Agent\AgentChatService;
use App\Services\DevForge\Agent\ApplicationWorkspaceChatContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;

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

function makeWorkspaceApp(array $overrides = [], ?\App\Models\User $user = null): array
{
    $user ??= \App\Models\User::factory()->create();
    $team = $user->teams()->firstOrFail();
    $server = \App\Models\Server::factory()->create(['team_id' => $team->id]);
    $destination = $server->standaloneDockers()->firstOrFail();
    $project = \App\Models\Project::factory()->create(['team_id' => $team->id]);
    $environment = \App\Models\Environment::factory()->create(['project_id' => $project->id]);
    $application = \App\Models\Application::factory()->create(array_merge([
        'environment_id' => $environment->id,
        'destination_id' => $destination->id,
        'destination_type' => \App\Models\StandaloneDocker::class,
        'git_repository' => 'acme/app',
        'git_branch' => 'main',
        'build_pack' => 'nixpacks',
    ], $overrides));

    return compact('user', 'team', 'server', 'destination', 'project', 'environment', 'application');
}

it('maps failed last deploy plus running container as rollback not undeployed', function () {
    $ctx = makeWorkspaceApp([
        'name' => 'starbasefr',
        'fqdn' => 'https://starbasefr.example',
    ]);
    $application = $ctx['application'];
    $application->forceFill(['status' => 'running:healthy'])->save();
    $application->refresh();

    ApplicationDeploymentQueue::create([
        'application_id' => (string) $application->id,
        'deployment_uuid' => 'dep-failed-rollback',
        'status' => 'failed',
        'rollback' => true,
        'logs' => json_encode([['output' => 'deploy failed', 'hidden' => false]]),
    ]);

    $pack = app(ApplicationWorkspaceChatContext::class)->build($application);

    expect($pack['application_status'])->toBe('running:healthy')
        ->and($pack['latest_deployment']['status'])->toBe('failed')
        ->and($pack['workspace_brief'])->toContain('running:healthy')
        ->and($pack['workspace_brief'])->toContain('failed')
        ->and($pack['workspace_brief'])->toContain('déploiement échoué, rollback')
        ->and($pack['workspace_brief'])->not->toContain('is_static=true');
});

it('builds workspace_brief from application uuid only without a frontend pack', function () {
    Bus::fake();
    $ctx = makeWorkspaceApp(['name' => 'starbasefr', 'fqdn' => 'https://starbasefr.example']);
    $application = $ctx['application'];
    $application->forceFill(['status' => 'running:healthy'])->save();
    $application->refresh();
    ApplicationDeploymentQueue::create([
        'application_id' => (string) $application->id,
        'deployment_uuid' => 'dep-uuid-only',
        'status' => 'failed',
        'logs' => json_encode([['output' => 'boom', 'hidden' => false]]),
    ]);

    $provider = AiProviderConfig::factory()->create([
        'team_id' => $ctx['team']->id,
        'provider' => 'openai',
        'api_key' => 'sk-test',
        'model' => 'gpt-4o-mini',
        'is_default' => true,
    ]);
    $agent = AiAgent::factory()->create([
        'team_id' => $ctx['team']->id,
        'provider_config_id' => $provider->id,
    ]);
    $session = AiAgentSession::factory()->create([
        'agent_id' => $agent->id,
        'user_id' => $ctx['user']->id,
    ]);

    $queued = app(AgentChatService::class)->queueMessage($agent, $session, 'statut', [
        'application_uuid' => $application->uuid,
    ]);

    $meta = $queued['run']->metadata;
    expect($meta['application_uuid'])->toBe($application->uuid)
        ->and($meta['workspace_brief'])->toContain($application->uuid)
        ->and($meta['workspace_brief'])->toContain('running:healthy')
        ->and($meta['latest_deployment']['status'])->toBe('failed')
        ->and($meta['application_status'])->toBe('running:healthy');

    Bus::assertDispatched(RunAgentChatJob::class);
});

it('injects team fleet status with failed last deploy and running container first', function () {
    Bus::fake();
    $ctx = makeWorkspaceApp(['name' => 'healthy-ok', 'fqdn' => 'https://ok.example']);
    $ok = $ctx['application'];
    $ok->forceFill(['status' => 'running:healthy'])->save();

    $failedRunning = \App\Models\Application::factory()->create([
        'name' => 'starbasefr',
        'environment_id' => $ctx['environment']->id,
        'destination_id' => $ctx['destination']->id,
        'destination_type' => \App\Models\StandaloneDocker::class,
        'fqdn' => 'https://starbasefr.example',
        'git_repository' => 'acme/starbasefr',
        'git_branch' => 'main',
        'build_pack' => 'nixpacks',
    ]);
    $failedRunning->forceFill(['status' => 'running:healthy'])->save();
    $failedRunning->refresh();

    $undeployed = \App\Models\Application::factory()->create([
        'name' => 'never-shipped',
        'environment_id' => $ctx['environment']->id,
        'destination_id' => $ctx['destination']->id,
        'destination_type' => \App\Models\StandaloneDocker::class,
        'fqdn' => 'https://never.example',
        'git_repository' => 'acme/never',
        'git_branch' => 'main',
        'build_pack' => 'nixpacks',
    ]);
    $undeployed->forceFill(['status' => 'exited:unhealthy'])->save();

    ApplicationDeploymentQueue::create([
        'application_id' => (string) $failedRunning->id,
        'deployment_uuid' => 'dep-sb-failed',
        'status' => 'failed',
        'rollback' => true,
        'logs' => json_encode([['output' => 'rollback', 'hidden' => false]]),
    ]);

    $provider = AiProviderConfig::factory()->create([
        'team_id' => $ctx['team']->id,
        'provider' => 'openai',
        'api_key' => 'sk-test',
        'model' => 'gpt-4o-mini',
        'is_default' => true,
    ]);
    $agent = AiAgent::factory()->create([
        'team_id' => $ctx['team']->id,
        'provider_config_id' => $provider->id,
    ]);
    $session = AiAgentSession::factory()->create([
        'agent_id' => $agent->id,
        'user_id' => $ctx['user']->id,
    ]);

    $queued = app(AgentChatService::class)->queueMessage($agent, $session, 'Santé des applications', []);
    $meta = $queued['run']->metadata;
    $brief = (string) ($meta['fleet_brief'] ?? $meta['workspace_brief'] ?? '');

    expect($brief)->toContain('starbasefr')
        ->and($brief)->toContain('running:healthy')
        ->and($brief)->toContain('failed')
        ->and($brief)->toContain($failedRunning->uuid)
        ->and($brief)->toContain('déploiement échoué, rollback')
        ->and($brief)->toContain('never-shipped')
        ->and($brief)->toContain('exited')
        ->and(strpos($brief, 'starbasefr'))->toBeLessThan(strpos($brief, 'healthy-ok'));

    $fleet = $meta['fleet'] ?? [];
    expect($fleet[0]['name'] ?? null)->toBe('starbasefr')
        ->and($fleet[0]['status'] ?? null)->toBe('running:healthy')
        ->and($fleet[0]['last_deploy_status'] ?? null)->toBe('failed');
});
