<?php

use App\Services\DevForge\Agent\AgentRoleFactory;
use App\Services\DevForge\Agent\Tool\AgentSubagentCapabilities;

beforeEach(function () {
    config([
        'devforge.agents_dynamic_roles_enabled' => true,
        'devforge.agents_max_dynamic_roles' => 4,
        'devforge.agents_max_concurrent_subagents' => 3,
    ]);
});

it('proposes researcher and analyst for tech watch tasks', function () {
    $factory = new AgentRoleFactory;
    $roles = $factory->propose(
        'Veille tech : tendances renouvelables et synthèse',
        null,
        ['mission_kind' => 'tech_watch'],
    );

    $slugs = array_column($roles, 'slug');

    expect($slugs)->toContain(AgentRoleFactory::ROLE_RESEARCHER)
        ->and($slugs)->toContain(AgentRoleFactory::ROLE_ANALYST)
        ->and($slugs)->toContain(AgentRoleFactory::ROLE_WRITER)
        ->and(count($roles))->toBeLessThanOrEqual(3);
});

it('adds writer when the task asks for a report', function () {
    $factory = new AgentRoleFactory;
    $roles = $factory->propose('Research renewable energy and create a comprehensive report');

    expect(array_column($roles, 'slug'))->toContain(AgentRoleFactory::ROLE_WRITER);
});

it('respects explicit roles and normalizes aliases', function () {
    $factory = new AgentRoleFactory;
    $roles = $factory->propose('Anything', ['Research', 'implement', 'qa', 'unknown-role']);

    expect(array_column($roles, 'slug'))->toBe([
        AgentRoleFactory::ROLE_RESEARCHER,
        AgentRoleFactory::ROLE_IMPLEMENTER,
        AgentRoleFactory::ROLE_TESTER,
    ]);
});

it('maps role slugs to leaf profiles and tool allowlists', function () {
    $factory = new AgentRoleFactory;

    expect($factory->resolveLeafProfile('researcher'))->toBe(AgentSubagentCapabilities::PROFILE_RESEARCH)
        ->and($factory->resolveLeafProfile('implementer'))->toBe(AgentSubagentCapabilities::PROFILE_IMPLEMENT)
        ->and($factory->resolveLeafProfile('tester'))->toBe(AgentSubagentCapabilities::PROFILE_TEST)
        ->and($factory->resolveLeafProfile('reviewer'))->toBe(AgentSubagentCapabilities::PROFILE_DIAGNOSE);

    $tools = AgentSubagentCapabilities::leafAllowedTools([
        'subagent_role' => 'leaf',
        'leaf_profile' => $factory->resolveLeafProfile('researcher'),
    ]);

    expect($tools)->toContain('web_search')
        ->and($tools)->not->toContain('spawn_task')
        ->and($tools)->not->toContain('control_resource');
});

it('caps roles by concurrent subagent limit', function () {
    config([
        'devforge.agents_max_dynamic_roles' => 8,
        'devforge.agents_max_concurrent_subagents' => 2,
    ]);

    $factory = new AgentRoleFactory;
    $roles = $factory->propose('feature implement code and test and review report', null, ['mission_kind' => 'feature']);

    expect(count($roles))->toBe(2)
        ->and($factory->maxRoles())->toBe(2);
});

it('builds spawn tasks with role metadata', function () {
    $factory = new AgentRoleFactory;
    $roles = $factory->propose('Analyse marché IA', ['analyst', 'writer']);
    $tasks = $factory->toSpawnTasks($roles);

    expect($tasks)->toHaveCount(2)
        ->and($tasks[0]['role_slug'])->toBe(AgentRoleFactory::ROLE_ANALYST)
        ->and($tasks[0]['leaf_profile'])->toBe(AgentSubagentCapabilities::PROFILE_RESEARCH)
        ->and($tasks[0]['difficulty'])->toBe('heavy')
        ->and($tasks[1]['difficulty'])->toBe('standard')
        ->and($tasks[0]['role_system_prompt'])->not->toBeEmpty()
        ->and($tasks[0]['goal'])->toContain('[Rôle:');
});

it('can be disabled via config', function () {
    config(['devforge.agents_dynamic_roles_enabled' => false]);

    expect((new AgentRoleFactory)->enabled())->toBeFalse();
});

it('proposes diagnose fix reviewer for deploy-style bugs', function () {
    $factory = new AgentRoleFactory;
    $slugs = array_column(
        $factory->propose('Corriger le bug de déploiement crash', null, ['kind' => 'bug']),
        'slug',
    );

    expect($slugs)->toContain(AgentSubagentCapabilities::PROFILE_DIAGNOSE)
        ->and($slugs)->toContain(AgentSubagentCapabilities::PROFILE_FIX);
});
