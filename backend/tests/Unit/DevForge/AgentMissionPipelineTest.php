<?php

use App\Models\AiAgent;
use App\Models\AiAgentMission;
use App\Models\AiAgentRun;
use App\Models\Team;
use App\Services\DevForge\Agent\AgentMissionBoard;
use App\Services\DevForge\Agent\MissionWorkDispatcher;
use Illuminate\Support\Facades\Schema;

beforeEach(function () {
    if (! Schema::hasTable('ai_agent_missions') || ! Schema::hasTable('ai_agents')) {
        $this->markTestSkipped('Tables agents/missions indisponibles.');
    }
});

it('assigns tech_watch missions to devforge type by default', function () {
    $team = Team::factory()->create();
    $vt = AiAgent::factory()->create(['team_id' => $team->id, 'type' => 'tech-watch']);
    $implementer = AiAgent::factory()->create(['team_id' => $team->id, 'type' => 'devforge', 'is_active' => true]);
    $board = app(AgentMissionBoard::class);

    $mission = $board->upsertTechWatch(
        $team,
        $vt,
        'PHP outdated',
        'Upgrade PHP',
        'tech-watch:php-test:'.$implementer->uuid,
    );

    expect($mission)->toBeInstanceOf(AiAgentMission::class)
        ->and($mission->assignee_agent_id)->toBe($implementer->id)
        ->and($mission->metadata['assignee_type'] ?? null)->toBe('devforge');
});

it('claims mission atomically for current agent', function () {
    $team = Team::factory()->create();
    $worker = AiAgent::factory()->create(['team_id' => $team->id, 'type' => 'debug']);
    $other = AiAgent::factory()->create(['team_id' => $team->id, 'type' => 'debug']);
    $board = app(AgentMissionBoard::class);

    $mission = $board->create($team, [
        'title' => 'Fix crash',
        'kind' => 'bug',
        'assignee_type' => 'debug',
    ], $worker);

    expect($mission)->toBeInstanceOf(AiAgentMission::class);

    $claimed = $board->claim($team, $mission->uuid, $worker);
    expect($claimed)->toBeInstanceOf(AiAgentMission::class)
        ->and($claimed->status)->toBe('in_progress')
        ->and($claimed->assignee_agent_id)->toBe($worker->id);

    $second = $board->claim($team, $mission->uuid, $other);
    expect($second)->toBeArray()
        ->and($second['error'] ?? null)->toContain('non claimable');
});

it('rejects assignee outside team', function () {
    $team = Team::factory()->create();
    $otherTeam = Team::factory()->create();
    $outsider = AiAgent::factory()->create(['team_id' => $otherTeam->id, 'type' => 'devforge']);
    $board = app(AgentMissionBoard::class);

    $result = $board->create($team, [
        'title' => 'Bad assignee',
        'kind' => 'feature',
        'assignee_agent_uuid' => $outsider->uuid,
    ]);

    expect($result)->toBeArray()
        ->and($result['error'] ?? null)->toContain('introuvable');
});

it('routes kind to default assignee type', function () {
    $board = app(AgentMissionBoard::class);

    expect($board->defaultAssigneeTypeForKind('bug'))->toBe('debug')
        ->and($board->defaultAssigneeTypeForKind('feature'))->toBe('devforge')
        ->and($board->defaultAssigneeTypeForKind('ops'))->toBe('deployment');
});

it('shows mission details', function () {
    $team = Team::factory()->create();
    $board = app(AgentMissionBoard::class);
    $mission = $board->create($team, [
        'title' => 'Show me',
        'kind' => 'ops',
        'blocked_reason' => 'need token',
        'status' => 'blocked',
    ]);

    expect($mission)->toBeInstanceOf(AiAgentMission::class);

    $shown = $board->show($team, $mission->uuid);
    expect($shown)->toBeInstanceOf(AiAgentMission::class)
        ->and($shown->uuid)->toBe($mission->uuid)
        ->and($shown->metadata['blocked_reason'] ?? null)->toBe('need token');
});

it('mission work dispatcher claims open missions for idle workers', function () {
    $team = Team::factory()->create();
    AiAgent::factory()->create([
        'team_id' => $team->id,
        'type' => 'devforge',
        'is_active' => true,
        'status' => 'idle',
    ]);

    $board = app(AgentMissionBoard::class);
    $mission = $board->create($team, [
        'title' => 'Implement feature X',
        'kind' => 'feature',
        'assignee_type' => 'devforge',
    ]);
    expect($mission)->toBeInstanceOf(AiAgentMission::class);

    $implementer = AiAgent::query()
        ->where('team_id', $team->id)
        ->where('type', 'devforge')
        ->firstOrFail();

    $fakeRun = AiAgentRun::factory()->create([
        'agent_id' => $implementer->id,
        'status' => 'pending',
        'trigger' => 'event',
    ]);

    $launcher = Mockery::mock(\App\Services\DevForge\Agent\AgentRunLauncher::class);
    $launcher->shouldReceive('queue')->once()->andReturn($fakeRun);
    app()->instance(\App\Services\DevForge\Agent\AgentRunLauncher::class, $launcher);

    config()->set('devforge.agents_enabled', true);
    config()->set('devforge.agents_mission_work_cooldown_minutes', 0);

    $result = app(MissionWorkDispatcher::class)->dispatchDue(5);

    expect($result['claimed'])->toBeGreaterThanOrEqual(1)
        ->and($result['runs'])->toBeGreaterThanOrEqual(1);

    $mission->refresh();
    expect($mission->status)->toBe('in_progress');
});

it('mission work dispatcher falls back to worker agent when debug agent is absent', function () {
    $team = Team::factory()->create();
    $worker = AiAgent::factory()->create([
        'team_id' => $team->id,
        'type' => 'worker',
        'name' => 'Worker',
        'is_active' => true,
        'status' => 'idle',
    ]);

    $board = app(AgentMissionBoard::class);
    $mission = $board->create($team, [
        'title' => 'Fix bug without debug agent',
        'kind' => 'bug',
        'assignee_type' => 'debug',
    ]);
    expect($mission)->toBeInstanceOf(AiAgentMission::class);

    $fakeRun = AiAgentRun::factory()->create([
        'agent_id' => $worker->id,
        'status' => 'pending',
        'trigger' => 'event',
    ]);

    $launcher = Mockery::mock(\App\Services\DevForge\Agent\AgentRunLauncher::class);
    $launcher->shouldReceive('queue')->once()->andReturn($fakeRun);
    app()->instance(\App\Services\DevForge\Agent\AgentRunLauncher::class, $launcher);

    config()->set('devforge.agents_enabled', true);
    config()->set('devforge.agents_mission_work_cooldown_minutes', 0);

    $result = app(MissionWorkDispatcher::class)->dispatchDue(5);

    expect($result['claimed'])->toBeGreaterThanOrEqual(1)
        ->and($result['runs'])->toBeGreaterThanOrEqual(1);

    $mission->refresh();
    expect($mission->status)->toBe('in_progress')
        ->and($mission->assignee_agent_id)->toBe($worker->id);
});

it('claims and runs mission on demand via claimAndRun', function () {
    $team = Team::factory()->create();
    $worker = AiAgent::factory()->create([
        'team_id' => $team->id,
        'type' => 'worker',
        'is_active' => true,
        'status' => 'idle',
    ]);

    $board = app(AgentMissionBoard::class);
    $mission = $board->create($team, [
        'title' => 'Manual run mission',
        'kind' => 'feature',
    ]);
    expect($mission)->toBeInstanceOf(AiAgentMission::class);

    $fakeRun = AiAgentRun::factory()->create([
        'agent_id' => $worker->id,
        'status' => 'pending',
        'trigger' => 'event',
    ]);

    $launcher = Mockery::mock(\App\Services\DevForge\Agent\AgentRunLauncher::class);
    $launcher->shouldReceive('queue')->once()->andReturn($fakeRun);
    app()->instance(\App\Services\DevForge\Agent\AgentRunLauncher::class, $launcher);

    $claimed = $board->claimAndRun($team, $mission->uuid);
    expect($claimed)->toBeInstanceOf(AiAgentMission::class)
        ->and($claimed->status)->toBe('in_progress')
        ->and($claimed->assignee_agent_id)->toBe($worker->id);
});
