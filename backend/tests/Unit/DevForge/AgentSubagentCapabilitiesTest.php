<?php

use App\Services\DevForge\Agent\Tool\AgentSubagentCapabilities;

it('resolves main orchestrator and leaf roles', function () {
    expect(AgentSubagentCapabilities::resolveRole([]))->toBe(AgentSubagentCapabilities::ROLE_MAIN)
        ->and(AgentSubagentCapabilities::resolveRole(['subagent_role' => 'orchestrator']))
        ->toBe(AgentSubagentCapabilities::ROLE_ORCHESTRATOR)
        ->and(AgentSubagentCapabilities::resolveRole(['ephemeral' => true]))
        ->toBe(AgentSubagentCapabilities::ROLE_LEAF);
});

it('blocks spawn for leaf and beyond max depth', function () {
    config(['devforge.agents_max_spawn_depth' => 1]);

    expect(AgentSubagentCapabilities::canSpawn([
        'subagent_role' => 'main',
        'spawn_depth' => 0,
    ]))->toBeTrue()
        ->and(AgentSubagentCapabilities::canSpawn([
            'subagent_role' => 'orchestrator',
            'spawn_depth' => 0,
        ]))->toBeTrue()
        ->and(AgentSubagentCapabilities::canSpawn([
            'subagent_role' => 'leaf',
            'spawn_depth' => 1,
        ]))->toBeFalse()
        ->and(AgentSubagentCapabilities::canSpawn([
            'ephemeral' => true,
            'spawn_depth' => 0,
        ]))->toBeFalse()
        ->and(AgentSubagentCapabilities::canSpawn([
            'subagent_role' => 'main',
            'spawn_depth' => 0,
        ], hasParentAgentLink: true))->toBeFalse();
});

it('exposes diagnose leaf tool profile without orchestration tools', function () {
    $tools = AgentSubagentCapabilities::leafAllowedTools([
        'subagent_role' => 'leaf',
        'leaf_profile' => 'diagnose',
    ]);

    expect($tools)->toBeArray()
        ->and($tools)->toContain('get_deployment_logs')
        ->and($tools)->not->toContain('spawn_task')
        ->and($tools)->not->toContain('control_resource');
});

it('exposes implement and test leaf profiles', function () {
    $implement = AgentSubagentCapabilities::leafAllowedTools([
        'subagent_role' => 'leaf',
        'leaf_profile' => 'implement',
    ]);
    $test = AgentSubagentCapabilities::leafAllowedTools([
        'subagent_role' => 'leaf',
        'leaf_profile' => 'test',
    ]);

    expect($implement)->toContain('write_application_source')
        ->and($implement)->toContain('request_user_input')
        ->and($test)->toContain('run_application_tests')
        ->and($test)->not->toContain('spawn_task');
});

it('allows spawn depth 1 when max spawn depth is 2', function () {
    config(['devforge.agents_max_spawn_depth' => 2]);

    expect(AgentSubagentCapabilities::canSpawn([
        'subagent_role' => 'orchestrator',
        'spawn_depth' => 1,
    ]))->toBeTrue()
        ->and(AgentSubagentCapabilities::canSpawn([
            'subagent_role' => 'orchestrator',
            'spawn_depth' => 2,
        ]))->toBeFalse();
});

it('maps researcher alias to research tool profile', function () {
    $tools = AgentSubagentCapabilities::leafAllowedTools([
        'subagent_role' => 'leaf',
        'leaf_profile' => 'researcher',
    ]);

    expect($tools)->toContain('web_search')
        ->and($tools)->toContain('mission_create')
        ->and($tools)->not->toContain('spawn_task');
});

it('gives researcher and implementer distinct tool allowlists', function () {
    $researcher = AgentSubagentCapabilities::leafAllowedTools([
        'subagent_role' => 'leaf',
        'role_slug' => 'researcher',
    ]);
    $implementer = AgentSubagentCapabilities::leafAllowedTools([
        'subagent_role' => 'leaf',
        'role_slug' => 'implementer',
    ]);
    $writer = AgentSubagentCapabilities::leafAllowedTools([
        'subagent_role' => 'leaf',
        'role_slug' => 'writer',
    ]);

    expect($researcher)->toContain('web_search')
        ->and($researcher)->not->toContain('write_application_source')
        ->and($implementer)->toContain('write_application_source')
        ->and($implementer)->not->toContain('web_search')
        ->and($writer)->toContain('memory_write')
        ->and($writer)->toContain('mission_update')
        ->and($writer)->not->toContain('mission_create')
        ->and($writer)->not->toContain('write_application_source');
});

it('marks orchestration tools correctly', function () {
    expect(AgentSubagentCapabilities::isOrchestrationTool('spawn_task'))->toBeTrue()
        ->and(AgentSubagentCapabilities::isOrchestrationTool('yield_wait'))->toBeTrue()
        ->and(AgentSubagentCapabilities::isOrchestrationTool('get_deployment_logs'))->toBeFalse();
});
