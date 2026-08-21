<?php

use App\Models\AiAgent;
use App\Models\GithubApp;
use App\Models\User;
use App\Services\DevForge\Agent\AgentWelcomeComposer;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

it('greets the user and asks to connect GitHub when no app is installed', function () {
    $user = User::factory()->create(['name' => 'Mathieu Test']);
    $team = $user->teams()->firstOrFail();
    $agent = AiAgent::factory()->create(['team_id' => $team->id, 'name' => 'Ingénieur QA']);

    $payload = app(AgentWelcomeComposer::class)->compose($agent, $user);

    expect($payload['uuid'])->toBe('welcome')
        ->and($payload['content'])->toContain('Salut Mathieu')
        ->and($payload['metadata']['choice_card']['id'])->toBe('github_connect')
        ->and($payload['metadata']['choice_card']['options'])->toHaveCount(2);
});

it('skips the github card when the team already has an installation', function () {
    $user = User::factory()->create(['name' => 'Mathieu']);
    $team = $user->teams()->firstOrFail();
    $agent = AiAgent::factory()->create(['team_id' => $team->id]);

    GithubApp::create([
        'name' => 'Team GitHub',
        'uuid' => 'gh-app-welcome-test12',
        'api_url' => 'https://api.github.com',
        'html_url' => 'https://github.com',
        'app_id' => 1,
        'installation_id' => 99,
        'team_id' => $team->id,
        'is_system_wide' => false,
        'is_public' => false,
    ]);

    $payload = app(AgentWelcomeComposer::class)->compose($agent, $user);

    expect($payload['content'])->toContain('Salut Mathieu')
        ->and($payload['metadata']['choice_card'] ?? null)->toBeNull();
});
