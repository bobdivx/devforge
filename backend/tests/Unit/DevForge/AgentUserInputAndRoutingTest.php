<?php

use App\Services\DevForge\Agent\AgentDirectives;
use App\Services\DevForge\Agent\AgentMissionBoard;
use App\Services\DevForge\Agent\Tool\AgentSubagentCapabilities;
use App\Services\DevForge\Agent\Tool\AgentToolPackage;

it('defaults assignee types for mission kinds', function () {
    $board = new AgentMissionBoard;

    expect($board->defaultAssigneeTypeForKind('tech_watch'))->toBe('devforge')
        ->and($board->defaultAssigneeTypeForKind('feature'))->toBe('devforge')
        ->and($board->defaultAssigneeTypeForKind('bug'))->toBe('debug')
        ->and($board->defaultAssigneeTypeForKind('ops'))->toBe('deployment')
        ->and($board->defaultAssigneeTypeForKind('github_pr'))->toBe('github');
});

it('exposes mission and user-input tools as meta tools', function () {
    expect(AgentToolPackage::META_TOOLS)
        ->toContain('mission_claim')
        ->toContain('mission_show')
        ->toContain('request_user_input')
        ->toContain('run_application_tests');
});

it('documents request_user_input in autonomy rules', function () {
    expect(AgentDirectives::autonomyRules())
        ->toContain('request_user_input')
        ->and(AgentDirectives::defaultSystemPrompt('tech-watch'))
        ->toContain('mission_create')
        ->and(AgentDirectives::defaultSystemPrompt('debug'))
        ->toContain('mission_list');
});

it('defaults max spawn depth to at least 2', function () {
    config()->set('devforge.agents_max_spawn_depth', 2);

    expect(AgentSubagentCapabilities::maxSpawnDepth())->toBe(2);
});
