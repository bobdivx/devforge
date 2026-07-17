<?php

use App\Models\AiAgent;
use App\Models\AiAgentSession;
use App\Models\AiProviderConfig;
use App\Models\User;
use App\Services\DevForge\Agent\AgentSessionService;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

it('lists chat sessions scoped to the current user and legacy shared history', function () {
    $user = User::factory()->create();
    $otherUser = User::factory()->create();
    $team = $user->teams()->firstOrFail();
    $otherUser->teams()->attach($team, ['role' => 'member']);

    $agent = AiAgent::factory()->create(['team_id' => $team->id]);
    $ownSession = AiAgentSession::factory()->create([
        'agent_id' => $agent->id,
        'user_id' => $user->id,
        'title' => 'Ma session',
    ]);
    AiAgentSession::factory()->create([
        'agent_id' => $agent->id,
        'user_id' => $otherUser->id,
        'title' => 'Session autre membre',
    ]);
    $legacySession = AiAgentSession::factory()->legacy()->create([
        'agent_id' => $agent->id,
    ]);

    $this->actingAs($user)
        ->withSession(['currentTeam' => $team])
        ->getJson("/api/devforge/v1/agents/{$agent->uuid}/sessions")
        ->assertSuccessful()
        ->assertJsonCount(2, 'data')
        ->assertJsonPath('data.0.uuid', $ownSession->uuid)
        ->assertJsonFragment(['uuid' => $legacySession->uuid]);
});

it('creates a new chat session for the current user', function () {
    $user = User::factory()->create();
    $team = $user->teams()->firstOrFail();
    $agent = AiAgent::factory()->create(['team_id' => $team->id]);

    $this->actingAs($user)
        ->withSession(['currentTeam' => $team])
        ->postJson("/api/devforge/v1/agents/{$agent->uuid}/sessions", [
            'title' => 'Analyse prod',
        ])
        ->assertCreated()
        ->assertJsonPath('data.title', 'Analyse prod')
        ->assertJsonPath('data.is_legacy', false);

    expect(AiAgentSession::query()->where('agent_id', $agent->id)->where('user_id', $user->id)->count())->toBe(1);
});

it('returns messages only for the selected session', function () {
    $user = User::factory()->create();
    $team = $user->teams()->firstOrFail();
    $agent = AiAgent::factory()->create(['team_id' => $team->id]);

    $sessionA = AiAgentSession::factory()->create([
        'agent_id' => $agent->id,
        'user_id' => $user->id,
        'title' => 'Session A',
    ]);
    $sessionB = AiAgentSession::factory()->create([
        'agent_id' => $agent->id,
        'user_id' => $user->id,
        'title' => 'Session B',
    ]);

    \App\Models\AiAgentMessage::factory()->user()->create([
        'agent_id' => $agent->id,
        'session_id' => $sessionA->id,
        'content' => 'Message session A',
    ]);
    \App\Models\AiAgentMessage::factory()->user()->create([
        'agent_id' => $agent->id,
        'session_id' => $sessionB->id,
        'content' => 'Message session B',
    ]);

    $this->actingAs($user)
        ->withSession(['currentTeam' => $team])
        ->getJson("/api/devforge/v1/agents/{$agent->uuid}/sessions/{$sessionA->uuid}/messages")
        ->assertSuccessful()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.content', 'Message session A');
});

it('queues chat messages inside a session', function () {
    \Illuminate\Support\Facades\Queue::fake();

    $user = User::factory()->create();
    $team = $user->teams()->firstOrFail();
    $provider = AiProviderConfig::factory()->create(['team_id' => $team->id]);
    $agent = AiAgent::factory()->create([
        'team_id' => $team->id,
        'provider_config_id' => $provider->id,
    ]);
    $session = AiAgentSession::factory()->create([
        'agent_id' => $agent->id,
        'user_id' => $user->id,
    ]);

    $this->actingAs($user)
        ->withSession(['currentTeam' => $team])
        ->postJson("/api/devforge/v1/agents/{$agent->uuid}/sessions/{$session->uuid}/messages", [
            'content' => 'Bonjour agent',
        ])
        ->assertAccepted()
        ->assertJsonPath('data.session_uuid', $session->uuid);

    \Illuminate\Support\Facades\Queue::assertPushed(\App\Jobs\Agent\RunAgentChatJob::class);
});

it('stores application context on queued chat messages', function () {
    \Illuminate\Support\Facades\Queue::fake();

    $user = User::factory()->create();
    $team = $user->teams()->firstOrFail();
    $provider = AiProviderConfig::factory()->create(['team_id' => $team->id]);
    $agent = AiAgent::factory()->create([
        'team_id' => $team->id,
        'provider_config_id' => $provider->id,
    ]);
    $session = AiAgentSession::factory()->create([
        'agent_id' => $agent->id,
        'user_id' => $user->id,
        'title' => 'App · Domain app',
    ]);

    $server = \App\Models\Server::factory()->create(['team_id' => $team->id]);
    $destination = $server->standaloneDockers()->firstOrFail();
    $project = \App\Models\Project::factory()->create(['team_id' => $team->id]);
    $environment = \App\Models\Environment::factory()->create(['project_id' => $project->id]);
    $application = \App\Models\Application::factory()->create([
        'name' => 'Domain app',
        'environment_id' => $environment->id,
        'destination_id' => $destination->id,
        'destination_type' => \App\Models\StandaloneDocker::class,
        'git_repository' => 'acme/demo-app',
        'git_branch' => 'main',
        'build_pack' => 'nixpacks',
        'fqdn' => 'https://demo.example.com',
    ]);

    $this->actingAs($user)
        ->withSession(['currentTeam' => $team])
        ->postJson("/api/devforge/v1/agents/{$agent->uuid}/sessions/{$session->uuid}/messages", [
            'content' => 'Remplacer l’adapter Vercel par @astrojs/node en mode standalone',
            'application_uuid' => $application->uuid,
        ])
        ->assertAccepted();

    $run = \App\Models\AiAgentRun::query()->where('agent_id', $agent->id)->latest('id')->first();
    expect($run)->not->toBeNull()
        ->and($run->metadata['application_uuid'])->toBe($application->uuid)
        ->and($run->metadata['application_name'])->toBe('Domain app')
        ->and($run->metadata['git_repository'])->toBe('acme/demo-app')
        ->and($session->fresh()->title)->toBe('App · Domain app');
});

it('remembers the active session per user and agent in the database', function () {
    $user = User::factory()->create();
    $team = $user->teams()->firstOrFail();
    $agent = AiAgent::factory()->create(['team_id' => $team->id]);

    $sessionA = AiAgentSession::factory()->create([
        'agent_id' => $agent->id,
        'user_id' => $user->id,
        'title' => 'Session A',
    ]);
    $sessionB = AiAgentSession::factory()->create([
        'agent_id' => $agent->id,
        'user_id' => $user->id,
        'title' => 'Session B',
    ]);

    app(AgentSessionService::class)->activate($agent, $user, $sessionB->uuid);

    $this->actingAs($user)
        ->withSession(['currentTeam' => $team])
        ->getJson("/api/devforge/v1/agents/{$agent->uuid}/sessions")
        ->assertSuccessful()
        ->assertJsonPath('meta.active_session_uuid', $sessionB->uuid);

    app(AgentSessionService::class)->activate($agent, $user, $sessionA->uuid);

    $this->actingAs($user)
        ->withSession(['currentTeam' => $team])
        ->getJson("/api/devforge/v1/agents/{$agent->uuid}/sessions")
        ->assertSuccessful()
        ->assertJsonPath('meta.active_session_uuid', $sessionA->uuid);
});

it('activates a session through the API', function () {
    $user = User::factory()->create();
    $team = $user->teams()->firstOrFail();
    $agent = AiAgent::factory()->create(['team_id' => $team->id]);
    $session = AiAgentSession::factory()->create([
        'agent_id' => $agent->id,
        'user_id' => $user->id,
    ]);

    $this->actingAs($user)
        ->withSession(['currentTeam' => $team])
        ->postJson("/api/devforge/v1/agents/{$agent->uuid}/sessions/{$session->uuid}/activate")
        ->assertSuccessful()
        ->assertJsonPath('meta.active_session_uuid', $session->uuid);
});

it('auto titles a session from the first user message', function () {
    $user = User::factory()->create();
    $team = $user->teams()->firstOrFail();
    $agent = AiAgent::factory()->create(['team_id' => $team->id]);
    $session = AiAgentSession::factory()->create([
        'agent_id' => $agent->id,
        'user_id' => $user->id,
        'title' => 'Nouvelle conversation',
    ]);

    app(AgentSessionService::class)->autoTitleFromMessage($session, 'Analyser les logs du déploiement menu');

    expect($session->fresh()->title)->toBe('Analyser les logs du déploiement menu');
});
