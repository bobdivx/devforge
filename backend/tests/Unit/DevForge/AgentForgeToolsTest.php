<?php

use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\Team;
use App\Services\DevForge\Agent\AgentDelegator;
use App\Services\DevForge\Agent\AgentRunner;
use App\Services\DevForge\Agent\AgentToolkit;
use App\Services\DevForge\Agent\TaskModelRouter;
use App\Services\DevForge\Agent\Tool\AgentPermissionEngine;
use App\Services\DevForge\Agent\Tool\AgentSubagentRegistry;
use App\Services\DevForge\Agent\Tool\AgentToolClassification;
use App\Services\DevForge\Agent\Tool\IterationBudget;
use App\Services\DevForge\Core\CoreResourceAction;
use App\Services\DevForge\Core\CoreResourceCatalog;
use App\Services\DevForge\DeploymentData;
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

it('auto-denies ask decisions for event triggers without approval UI', function () {
    config()->set('devforge.agents_permission_mode', 'tiered');

    $ask = $this->engine->decide($this->agent, 'control_resource', ['action' => 'deploy']);
    $resolved = $this->engine->resolveForTrigger($ask, 'event', 'control_resource');

    expect($ask['decision'])->toBe(AgentPermissionEngine::DECISION_ASK)
        ->and($resolved['decision'])->toBe(AgentPermissionEngine::DECISION_DENY)
        ->and($resolved['approval_unavailable'])->toBeTrue()
        ->and($resolved['reason'])->toContain('aucune boucle d’approbation')
        ->and($resolved['reason'])->toContain('mode autonome');
});

it('keeps ask decisions for chat triggers that can approve', function () {
    config()->set('devforge.agents_permission_mode', 'plan_first');

    $ask = $this->engine->decide($this->agent, 'exec_command', ['command' => 'uptime']);
    $resolved = $this->engine->resolveForTrigger($ask, 'chat', 'exec_command');

    expect(AgentPermissionEngine::triggerSupportsApproval('chat'))->toBeTrue()
        ->and(AgentPermissionEngine::triggerSupportsApproval('event'))->toBeFalse()
        ->and($resolved['decision'])->toBe(AgentPermissionEngine::DECISION_ASK)
        ->and($resolved)->not->toHaveKey('approval_unavailable');
});

it('exposes a stable ask payload shape for chat UI', function () {
    config()->set('devforge.agents_permission_mode', 'plan_first');

    $ask = $this->engine->decide($this->agent, 'exec_command', ['command' => 'uptime']);
    $resolved = $this->engine->resolveForTrigger($ask, 'chat', 'exec_command');

    expect($resolved)->toMatchArray([
        'decision' => 'ask',
        'reason' => 'Mode plan-first — propose d’abord un plan (propose_plan), puis attends l’approbation avant toute modification.',
        'rule_id' => 'mode:plan_first:mutate',
    ]);
});

it('allows read-only tools in plan_first mode without approval', function () {
    config()->set('devforge.agents_permission_mode', 'plan_first');

    $result = $this->engine->decide($this->agent, 'get_deployment_logs', ['limit' => 3]);

    expect($result['decision'])->toBe(AgentPermissionEngine::DECISION_ALLOW)
        ->and($result['rule_id'])->toBe('mode:plan_first:read');
});

it('allows propose_plan in plan_first mode', function () {
    config()->set('devforge.agents_permission_mode', 'plan_first');

    $result = $this->engine->decide($this->agent, 'propose_plan', [
        'title' => 'Fix nginx',
        'summary' => 'Corriger publish_directory',
        'steps' => [['action' => 'update settings']],
    ]);

    expect($result['decision'])->toBe(AgentPermissionEngine::DECISION_ALLOW)
        ->and($result['rule_id'])->toBe('mode:plan_first:propose');
});

it('allows mutating tools in plan_first after plan execution grant', function () {
    config()->set('devforge.agents_permission_mode', 'plan_first');

    $sessionId = 4242;
    \App\Services\DevForge\Agent\Tool\AgentToolApprovalGrant::grantPlanExecution($sessionId);

    $result = $this->engine->decide(
        $this->agent,
        'control_resource',
        ['action' => 'deploy'],
        null,
        $sessionId,
    );

    expect($result['decision'])->toBe(AgentPermissionEngine::DECISION_ALLOW)
        ->and($result['rule_id'])->toBe('mode:plan_first:executing');
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
    $budget = new IterationBudget(5);

    expect($budget->consume())->toBeTrue();
    expect($budget->getUsed())->toBe(1);

    $budget->refund();

    expect($budget->getUsed())->toBe(0)
        ->and($budget->getRemaining())->toBe(5);
});

it('stops consuming when budget is exhausted', function () {
    $budget = new IterationBudget(2);

    expect($budget->consume())->toBeTrue();
    expect($budget->consume())->toBeTrue();
    expect($budget->consume())->toBeFalse();
    expect($budget->getRemaining())->toBe(0);
});

it('registers subagent runs', function () {
    $parent = AiAgent::factory()->create(['team_id' => $this->team->id]);
    $child = AiAgent::factory()->subAgent($parent, 'res-uuid')->create();

    $registry = new AgentSubagentRegistry;
    $record = $registry->start($parent, $child, null, 'Diagnostiquer les logs');

    expect($record->status)->toBe('pending')
        ->and($record->parent_agent_id)->toBe($parent->id)
        ->and($record->child_agent_id)->toBe($child->id);

    $registry->complete($record, 'Résumé OK');
    expect($record->fresh()->status)->toBe('completed')
        ->and($record->fresh()->output)->toBe('Résumé OK');
});

it('exposes propose_plan in toolkit definitions', function () {
    $run = AiAgentRun::factory()->create(['agent_id' => $this->agent->id]);

    $toolkit = new AgentToolkit(
        team: $this->team,
        run: $run,
        catalog: app(CoreResourceCatalog::class),
        resourceAction: app(CoreResourceAction::class),
        deploymentData: app(DeploymentData::class),
        agent: $this->agent,
    );

    $names = collect($toolkit->definitions())->pluck('name');

    expect($names)->toContain('propose_plan');
});

it('stores a plan artefact via propose_plan', function () {
    config()->set('devforge.agents_permission_mode', 'plan_first');

    $run = AiAgentRun::factory()->create([
        'agent_id' => $this->agent->id,
        'trigger' => 'chat',
    ]);

    $toolkit = new AgentToolkit(
        team: $this->team,
        run: $run,
        catalog: app(CoreResourceCatalog::class),
        resourceAction: app(CoreResourceAction::class),
        deploymentData: app(DeploymentData::class),
        agent: $this->agent,
    );

    $result = $toolkit->execute('propose_plan', [
        'title' => 'Corriger nginx',
        'summary' => 'Mettre à jour publish_directory',
        'steps' => [
            ['action' => 'Lire settings', 'tool' => 'get_application_runtime_settings', 'risk' => 'low'],
            ['action' => 'Update publish_directory', 'tool' => 'update_application_runtime_settings', 'risk' => 'medium'],
        ],
    ]);

    expect($result['ok'])->toBeTrue()
        ->and($result['pending_plan'])->toBeTrue()
        ->and($result['plan']['title'])->toBe('Corriger nginx')
        ->and($result['plan']['steps'])->toHaveCount(2)
        ->and($run->fresh()->metadata['plan']['status'])->toBe('proposed');
});

it('exposes delegate_task only for parent agents', function () {
    $parent = AiAgent::factory()->create(['team_id' => $this->team->id]);
    $child = AiAgent::factory()->subAgent($parent, 'res-uuid')->create();
    $run = AiAgentRun::factory()->create(['agent_id' => $parent->id]);

    $delegator = new AgentDelegator(
        app(AgentRunner::class),
        new AgentSubagentRegistry,
        app(TaskModelRouter::class),
    );

    $parentToolkit = new AgentToolkit(
        team: $this->team,
        run: $run,
        catalog: app(CoreResourceCatalog::class),
        resourceAction: app(CoreResourceAction::class),
        deploymentData: app(DeploymentData::class),
        agent: $parent,
        delegator: $delegator,
    );

    $childRun = AiAgentRun::factory()->create(['agent_id' => $child->id]);
    $childToolkit = new AgentToolkit(
        team: $this->team,
        run: $childRun,
        catalog: app(CoreResourceCatalog::class),
        resourceAction: app(CoreResourceAction::class),
        deploymentData: app(DeploymentData::class),
        agent: $child,
        delegator: $delegator,
    );

    $parentTools = collect($parentToolkit->definitions())->pluck('name');
    $childTools = collect($childToolkit->definitions())->pluck('name');

    expect($parentTools)->toContain('delegate_task')
        ->and($childTools)->not->toContain('delegate_task');
});
