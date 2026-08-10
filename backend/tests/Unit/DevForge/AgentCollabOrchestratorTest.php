<?php

use App\Services\DevForge\Agent\AgentCollabOrchestrator;
use App\Services\DevForge\Agent\Tool\AgentSubagentCapabilities;

beforeEach(function () {
    config([
        'devforge.agents_collab_enabled' => true,
        'devforge.agents_max_collab_rounds' => 8,
        'devforge.agents_dynamic_roles_enabled' => true,
    ]);
});

it('blocks collab on deploy and CI events', function () {
    $orchestrator = app(AgentCollabOrchestrator::class);

    expect($orchestrator->isAllowed(['event' => 'deployment_failed', 'force_collab' => true]))->toBeFalse()
        ->and($orchestrator->isAllowed(['event' => 'github_workflow_run_failed', 'force_collab' => true]))->toBeFalse()
        ->and($orchestrator->isAllowed(['event' => 'application_readiness_failed', 'force_collab' => true]))->toBeFalse()
        ->and($orchestrator->isAllowed(['event' => 'tech_watch_missions', 'force_collab' => true]))->toBeTrue()
        ->and($orchestrator->isAllowed(['orchestration' => 'collab', 'event' => 'mission_work']))->toBeTrue();
});

it('selects speakers in round robin order', function () {
    $orchestrator = app(AgentCollabOrchestrator::class);
    $roles = [
        ['slug' => 'researcher'],
        ['slug' => 'analyst'],
        ['slug' => 'writer'],
    ];

    expect($orchestrator->selectNextSpeaker($roles, [], 'round_robin', 0))->toBe('researcher')
        ->and($orchestrator->selectNextSpeaker($roles, [], 'round_robin', 1))->toBe('analyst')
        ->and($orchestrator->selectNextSpeaker($roles, [], 'round_robin', 2))->toBe('writer')
        ->and($orchestrator->selectNextSpeaker($roles, [], 'round_robin', 3))->toBe('researcher');
});

it('honors NEXT_SPEAKER tag in auto mode', function () {
    $orchestrator = app(AgentCollabOrchestrator::class);
    $roles = [
        ['slug' => 'researcher'],
        ['slug' => 'writer'],
        ['slug' => 'analyst'],
    ];

    $transcript = [[
        'round' => 1,
        'role_slug' => 'researcher',
        'leaf_profile' => 'research',
        'run_uuid' => null,
        'status' => 'completed',
        'summary' => 'Faits collectés. [NEXT_SPEAKER:writer]',
        'next_speaker' => $orchestrator->parseNextSpeaker('Faits collectés. [NEXT_SPEAKER:writer]'),
    ]];

    expect($transcript[0]['next_speaker'])->toBe('writer')
        ->and($orchestrator->selectNextSpeaker($roles, $transcript, 'auto', 1))->toBe('writer');
});

it('stops on DEVFORGE_DONE and caps rounds', function () {
    $orchestrator = app(AgentCollabOrchestrator::class);

    expect($orchestrator->shouldStop([
        'round' => 2,
        'role_slug' => 'writer',
        'leaf_profile' => 'research',
        'run_uuid' => null,
        'status' => 'completed',
        'summary' => 'Rapport final [DEVFORGE_DONE]',
        'next_speaker' => null,
    ], []))->toBeTrue();

    config(['devforge.agents_max_collab_rounds' => 3]);
    expect($orchestrator->maxRounds())->toBe(3);
});

it('keeps deploy pipeline profiles distinct from collab', function () {
    expect(AgentSubagentCapabilities::PROFILE_DIAGNOSE)->toBe('diagnose')
        ->and(AgentCollabOrchestrator::BLOCKED_EVENTS)->toContain('deployment_failed');
});
