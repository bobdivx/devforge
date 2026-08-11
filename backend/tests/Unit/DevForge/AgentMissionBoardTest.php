<?php

use App\Models\AiAgent;
use App\Models\AiAgentMission;
use App\Models\Team;
use App\Services\DevForge\Agent\AgentMissionBoard;
use Illuminate\Support\Facades\Schema;

beforeEach(function () {
    if (! Schema::hasTable('ai_agent_missions')) {
        $this->markTestSkipped('Migration ai_agent_missions non appliquée.');
    }
});

it('creates and lists missions with dedupe', function () {
    $team = Team::factory()->create();
    $agent = AiAgent::factory()->create(['team_id' => $team->id]);
    $board = app(AgentMissionBoard::class);

    $first = $board->create($team, [
        'title' => 'Coolify update',
        'kind' => 'tech_watch',
        'dedupe_key' => 'tech-watch:coolify-update:test',
        'assignee_agent_uuid' => $agent->uuid,
    ], $agent);

    expect($first)->toBeInstanceOf(AiAgentMission::class);

    $second = $board->create($team, [
        'title' => 'Coolify update again',
        'kind' => 'tech_watch',
        'dedupe_key' => 'tech-watch:coolify-update:test',
    ], $agent);

    expect($second->id)->toBe($first->id)
        ->and($board->list($team, ['kind' => 'tech_watch'])->count())->toBeGreaterThanOrEqual(1);
});

it('updates mission status to done', function () {
    $team = Team::factory()->create();
    $board = app(AgentMissionBoard::class);

    $mission = $board->create($team, [
        'title' => 'Fix nginx',
        'kind' => 'bug',
        'priority' => 'high',
    ]);

    expect($mission)->toBeInstanceOf(AiAgentMission::class);

    $updated = $board->update($team, $mission->uuid, ['status' => 'done']);

    expect($updated)->toBeInstanceOf(AiAgentMission::class)
        ->and($updated->status)->toBe('done')
        ->and($updated->completed_at)->not->toBeNull();
});

it('stores assignee_type in metadata when no agent of that type exists', function () {
    $team = Team::factory()->create();
    $board = app(AgentMissionBoard::class);

    $mission = $board->create($team, [
        'title' => 'Orphan assignee type',
        'kind' => 'feature',
        'assignee_type' => 'devforge',
    ]);

    expect($mission)->toBeInstanceOf(AiAgentMission::class)
        ->and($mission->assignee_agent_id)->toBeNull()
        ->and($mission->metadata['assignee_type'] ?? null)->toBe('devforge');
});

it('bulk transitions in_progress missions to done', function () {
    $team = Team::factory()->create();
    $board = app(AgentMissionBoard::class);

    $first = $board->create($team, ['title' => 'Ghost A', 'kind' => 'bug', 'status' => 'in_progress']);
    $second = $board->create($team, ['title' => 'Ghost B', 'kind' => 'ops', 'status' => 'in_progress']);
    $open = $board->create($team, ['title' => 'Still open', 'kind' => 'bug', 'status' => 'open']);

    expect($first)->toBeInstanceOf(AiAgentMission::class)
        ->and($second)->toBeInstanceOf(AiAgentMission::class)
        ->and($open)->toBeInstanceOf(AiAgentMission::class);

    $result = $board->bulkTransition($team, 'in_progress', 'done');

    expect($result['updated'] ?? 0)->toBe(2)
        ->and($first->fresh()->status)->toBe('done')
        ->and($second->fresh()->status)->toBe('done')
        ->and($open->fresh()->status)->toBe('open');
});
