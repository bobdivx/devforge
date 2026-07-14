<?php

use App\Models\AiAgent;
use App\Models\AiProviderConfig;
use App\Models\Application;
use App\Models\Environment;
use App\Models\Project;
use App\Models\Server;
use App\Models\StandaloneDocker;
use App\Models\User;
use App\Services\DevForge\Agent\DeploymentAgentResolver;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.agents_enabled', true);

    $this->user = User::factory()->create();
    $this->team = $this->user->teams()->firstOrFail();
    $server = Server::factory()->create(['team_id' => $this->team->id]);
    $destination = $server->standaloneDockers()->firstOrFail();
    $project = Project::factory()->create(['team_id' => $this->team->id]);
    $environment = Environment::factory()->create(['project_id' => $project->id]);
    $this->application = Application::factory()->create([
        'environment_id' => $environment->id,
        'destination_id' => $destination->id,
        'destination_type' => StandaloneDocker::class,
    ]);
    $this->resolver = app(DeploymentAgentResolver::class);
});

it('reports agents disabled in diagnostics', function () {
    config()->set('devforge.agents_enabled', false);

    $diagnostics = $this->resolver->diagnostics($this->team, $this->application->uuid);

    expect($diagnostics['blockers'])->not->toBeEmpty()
        ->and(collect($diagnostics['blockers'])->pluck('code'))->toContain('agents_disabled');
});

it('reports missing llm provider in diagnostics', function () {
    $diagnostics = $this->resolver->diagnostics($this->team, $this->application->uuid);

    expect($diagnostics['blockers'])->not->toBeEmpty()
        ->and(collect($diagnostics['blockers'])->pluck('code'))->toContain('no_llm_provider');
});

it('resolves a deployment agent scoped to the application', function () {
    $provider = AiProviderConfig::factory()->create(['team_id' => $this->team->id]);

    AiAgent::factory()->devforge()->create([
        'team_id' => $this->team->id,
        'provider_config_id' => $provider->id,
    ]);

    $deploymentAgent = AiAgent::factory()->deployment()->create([
        'team_id' => $this->team->id,
        'provider_config_id' => $provider->id,
        'resource_uuid' => $this->application->uuid,
    ]);

    $resolved = $this->resolver->resolve($this->team, $this->application->uuid);

    expect($resolved?->is($deploymentAgent))->toBeTrue();
});

it('resolves team from application via environment chain', function () {
    $team = $this->resolver->resolveTeam($this->application);

    expect($team?->is($this->team))->toBeTrue();
});
