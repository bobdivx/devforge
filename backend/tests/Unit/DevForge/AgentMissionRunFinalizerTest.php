<?php

use App\Models\AiAgent;
use App\Models\AiAgentMission;
use App\Models\AiAgentRun;
use App\Models\Team;
use App\Services\DevForge\Agent\AgentMissionBoard;
use App\Services\DevForge\Agent\AgentMissionRunFinalizer;
use Illuminate\Support\Facades\Schema;

beforeEach(function () {
    if (! Schema::hasTable('ai_agent_missions') || ! Schema::hasTable('ai_agent_runs')) {
        $this->markTestSkipped('Tables missions/runs indisponibles.');
    }
});

it('marks linked in_progress mission done when run completes', function () {
    $team = Team::factory()->create();
    $agent = AiAgent::factory()->create(['team_id' => $team->id]);
    $board = app(AgentMissionBoard::class);

    $mission = $board->create($team, [
        'title' => 'Fix disk',
        'kind' => 'ops',
        'status' => 'in_progress',
    ], $agent);
    expect($mission)->toBeInstanceOf(AiAgentMission::class);

    $run = AiAgentRun::factory()->create([
        'agent_id' => $agent->id,
        'status' => 'completed',
        'trigger' => 'event',
        'summary' => 'Espace libéré',
        'metadata' => [
            'event' => 'mission_work',
            'mission_uuid' => $mission->uuid,
        ],
    ]);

    app(AgentMissionRunFinalizer::class)->finalizeFromRun($run);

    expect($mission->fresh()->status)->toBe('done');
});

it('marks linked in_progress mission blocked when run fails', function () {
    $team = Team::factory()->create();
    $agent = AiAgent::factory()->create(['team_id' => $team->id]);
    $board = app(AgentMissionBoard::class);

    $mission = $board->create($team, [
        'title' => 'DB down',
        'kind' => 'bug',
        'status' => 'in_progress',
    ], $agent);
    expect($mission)->toBeInstanceOf(AiAgentMission::class);

    $run = AiAgentRun::factory()->create([
        'agent_id' => $agent->id,
        'status' => 'failed',
        'trigger' => 'event',
        'summary' => 'Erreur: disk full',
        'metadata' => [
            'event' => 'mission_work',
            'mission_uuid' => $mission->uuid,
        ],
    ]);

    app(AgentMissionRunFinalizer::class)->finalizeFromRun($run);

    $fresh = $mission->fresh();
    expect($fresh->status)->toBe('blocked')
        ->and($fresh->metadata['blocked_reason'] ?? null)->toContain('disk full');
});

it('does not overwrite an already closed mission', function () {
    $team = Team::factory()->create();
    $agent = AiAgent::factory()->create(['team_id' => $team->id]);
    $board = app(AgentMissionBoard::class);

    $mission = $board->create($team, [
        'title' => 'Already done',
        'kind' => 'bug',
        'status' => 'done',
    ], $agent);
    expect($mission)->toBeInstanceOf(AiAgentMission::class);

    $run = AiAgentRun::factory()->create([
        'agent_id' => $agent->id,
        'status' => 'failed',
        'trigger' => 'event',
        'metadata' => ['mission_uuid' => $mission->uuid],
    ]);

    app(AgentMissionRunFinalizer::class)->finalizeFromRun($run);

    expect($mission->fresh()->status)->toBe('done');
});
