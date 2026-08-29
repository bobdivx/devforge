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
