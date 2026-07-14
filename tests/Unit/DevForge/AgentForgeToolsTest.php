<?php

use App\Models\AiAgent;
use App\Models\Team;
use App\Services\DevForge\Agent\Tool\AgentPermissionEngine;
use App\Services\DevForge\Agent\Tool\AgentToolClassification;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.agents_permission_mode', 'autonomous');
    config()->set('devforge.agents_permission_allowed_tools', '');
    config()->set('devforge.agents_permission_denied_tools', '');

    $this->team = Team::factory()->create();
    $this->agent = AiAgent::factory()->create(['team_id' => $this->team->id]);
    $this->engine = new AgentPermissionEngine;
});

it('allows tools in autonomous mode', function () {
    $result = $this->engine->decide($this->agent, 'exec_command', ['command' => 'docker ps']);

    expect($result['decision'])->toBe(AgentPermissionEngine::DECISION_ALLOW)
        ->and($result['rule_id'])->toBe('mode:autonomous');
});

it('denies hard-coded dangerous commands', function () {
    $result = $this->engine->decide($this->agent, 'exec_command', ['command' => 'rm -rf /']);

    expect($result['decision'])->toBe(AgentPermissionEngine::DECISION_DENY)
        ->and($result['rule_id'])->toBe('hard_deny:rmrf-root');
});

it('asks approval for destructive tools in tiered mode', function () {
    config()->set('devforge.agents_permission_mode', 'tiered');

    $classification = AgentToolClassification::forTool('control_resource');
    $result = $this->engine->decide($this->agent, 'control_resource', ['action' => 'deploy'], $classification);

    expect($result['decision'])->toBe(AgentPermissionEngine::DECISION_ASK)
        ->and($result['rule_id'])->toBe('mode:tiered:destructive');
});

it('allows read-only tools in tiered mode', function () {
    config()->set('devforge.agents_permission_mode', 'tiered');

    $result = $this->engine->decide($this->agent, 'read_remote_file', ['path' => '/var/log/syslog']);

    expect($result['decision'])->toBe(AgentPermissionEngine::DECISION_ALLOW)
        ->and($result['rule_id'])->toBe('mode:tiered:read');
});

it('respects per-agent denied tools override', function () {
    $this->agent->update([
        'metadata' => [
            'permissions' => [
                'denied_tools' => ['exec_command'],
            ],
        ],
    ]);

    $result = $this->engine->decide($this->agent->fresh(), 'exec_command', ['command' => 'uptime']);

    expect($result['decision'])->toBe(AgentPermissionEngine::DECISION_DENY)
        ->and($result['rule_id'])->toBe('agent_override:deny');
});

it('refunds iteration budget after successful tool round', function () {
    $budget = new \App\Services\DevForge\Agent\Tool\IterationBudget(5);

    expect($budget->consume())->toBeTrue();
    expect($budget->getUsed())->toBe(1);

    $budget->refund();

    expect($budget->getUsed())->toBe(0)
        ->and($budget->getRemaining())->toBe(5);
});

it('stops consuming when budget is exhausted', function () {
    $budget = new \App\Services\DevForge\Agent\Tool\IterationBudget(2);

    expect($budget->consume())->toBeTrue();
    expect($budget->consume())->toBeTrue();
    expect($budget->consume())->toBeFalse();
    expect($budget->getRemaining())->toBe(0);
});

it('registers subagent runs', function () {
    $parent = AiAgent::factory()->create(['team_id' => $this->team->id]);
    $child = AiAgent::factory()->subAgent($parent, 'res-uuid')->create();

    $registry = new \App\Services\DevForge\Agent\Tool\AgentSubagentRegistry;
    $record = $registry->start($parent, $child, null, 'Diagnostiquer les logs');

    expect($record->status)->toBe('pending')
        ->and($record->parent_agent_id)->toBe($parent->id)
        ->and($record->child_agent_id)->toBe($child->id);

    $registry->complete($record, 'Résumé OK');
    expect($record->fresh()->status)->toBe('completed')
        ->and($record->fresh()->output)->toBe('Résumé OK');
});

it('exposes delegate_task only for parent agents', function () {
    $parent = AiAgent::factory()->create(['team_id' => $this->team->id]);
    $child = AiAgent::factory()->subAgent($parent, 'res-uuid')->create();
    $run = \App\Models\AiAgentRun::factory()->create(['agent_id' => $parent->id]);

    $delegator = new \App\Services\DevForge\Agent\AgentDelegator(
        app(\App\Services\DevForge\Agent\AgentRunner::class),
        new \App\Services\DevForge\Agent\Tool\AgentSubagentRegistry,
    );

    $parentToolkit = new \App\Services\DevForge\Agent\AgentToolkit(
        team: $this->team,
        run: $run,
        catalog: app(\App\Services\DevForge\Core\CoreResourceCatalog::class),
        resourceAction: app(\App\Services\DevForge\Core\CoreResourceAction::class),
        deploymentData: app(\App\Services\DevForge\DeploymentData::class),
        agent: $parent,
        delegator: $delegator,
    );

    $childRun = \App\Models\AiAgentRun::factory()->create(['agent_id' => $child->id]);
    $childToolkit = new \App\Services\DevForge\Agent\AgentToolkit(
        team: $this->team,
        run: $childRun,
        catalog: app(\App\Services\DevForge\Core\CoreResourceCatalog::class),
        resourceAction: app(\App\Services\DevForge\Core\CoreResourceAction::class),
        deploymentData: app(\App\Services\DevForge\DeploymentData::class),
        agent: $child,
        delegator: $delegator,
    );

    $parentTools = collect($parentToolkit->definitions())->pluck('name');
    $childTools = collect($childToolkit->definitions())->pluck('name');

    expect($parentTools)->toContain('delegate_task')
        ->and($childTools)->not->toContain('delegate_task');
});
