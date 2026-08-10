<?php

use App\Services\DevForge\Agent\AgentStandingOrders;
use App\Services\DevForge\Agent\Tool\AgentSubagentCapabilities;

it('provides default deploy failure standing order with pipeline steps', function () {
    $body = app(AgentStandingOrders::class)->defaultDeployFailureBody();

    expect($body)->toContain('leaf_profile=diagnose')
        ->and($body)->toContain('leaf_profile=fix')
        ->and($body)->toContain('leaf_profile=redeploy')
        ->and($body)->toContain('1×');
});

it('defines orchestrator and leaf deploy profiles', function () {
    expect(AgentSubagentCapabilities::PROFILE_DIAGNOSE)->toBe('diagnose')
        ->and(AgentSubagentCapabilities::PROFILE_FIX)->toBe('fix')
        ->and(AgentSubagentCapabilities::PROFILE_REDEPLOY)->toBe('redeploy');

    $redeploy = AgentSubagentCapabilities::leafAllowedTools([
        'subagent_role' => 'leaf',
        'leaf_profile' => 'redeploy',
    ]);

    expect($redeploy)->toContain('control_resource')
        ->and($redeploy)->not->toContain('write_application_source');
});

it('forbids collab orchestration on deployment failure events', function () {
    $orchestrator = app(\App\Services\DevForge\Agent\AgentCollabOrchestrator::class);

    expect($orchestrator->isAllowed([
        'event' => 'deployment_failed',
        'orchestration' => 'collab',
        'force_collab' => true,
    ]))->toBeFalse()
        ->and(app(\App\Services\DevForge\Agent\AgentStandingOrders::class)->defaultDeployFailureBody())
        ->not->toContain('orchestration=collab');
});
