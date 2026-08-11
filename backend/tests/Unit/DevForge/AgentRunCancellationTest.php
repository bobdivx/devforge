<?php

use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\AiAgentSubagentRun;
use App\Models\Team;
use App\Services\DevForge\Agent\AgentRunCancellation;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

it('marque un run running comme cancelled et idle l’agent', function () {
    $team = Team::factory()->create();
    $agent = AiAgent::factory()->create([
        'team_id' => $team->id,
        'status' => 'running',
    ]);
    $run = AiAgentRun::factory()->create([
        'agent_id' => $agent->id,
        'status' => 'running',
        'metadata' => [],
    ]);

    $updated = app(AgentRunCancellation::class)->request($run, 'Stop UI');

    expect($updated->status)->toBe('cancelled')
        ->and($updated->summary)->toContain('Stop UI')
        ->and($updated->metadata['cancel_requested'] ?? false)->toBeTrue()
        ->and($agent->fresh()->status)->toBe('idle');
});

it('compte les sous-agents actifs', function () {
    $team = Team::factory()->create();
    $parent = AiAgent::factory()->create(['team_id' => $team->id]);
    $child = AiAgent::factory()->create(['team_id' => $team->id]);
    $run = AiAgentRun::factory()->create([
        'agent_id' => $parent->id,
        'status' => 'waiting_for_subagents',
        'metadata' => [
            'ephemeral_tasks' => [
                ['status' => 'running', 'goal' => 'A'],
                ['status' => 'completed', 'goal' => 'B'],
            ],
        ],
    ]);

    AiAgentSubagentRun::query()->create([
        'parent_agent_id' => $parent->id,
        'child_agent_id' => $child->id,
        'parent_run_id' => $run->id,
        'child_run_id' => null,
        'status' => AiAgentSubagentRun::STATUS_RUNNING,
        'reason' => 'diagnose',
    ]);

    $count = app(AgentRunCancellation::class)->activeSubagentCount($run->fresh());

    expect($count)->toBe(2);
});

it('wasRequested détecte le flag metadata', function () {
    $run = AiAgentRun::factory()->create([
        'status' => 'running',
        'metadata' => ['cancel_requested' => true],
    ]);

    expect(app(AgentRunCancellation::class)->wasRequested($run))->toBeTrue();
});
