<?php

use App\Services\DevForge\Agent\Tool\AgentToolClassification;
use App\Services\DevForge\Agent\Tool\AgentToolPackage;

it('includes github in default packages for work-on-apps agent types', function () {
    foreach (['debug', 'deployment', 'devforge', 'tech-watch'] as $type) {
        expect(AgentToolPackage::defaultForAgentType($type))
            ->toContain(AgentToolPackage::PACKAGE_GITHUB);
    }
});

it('does not include github by default for security agents', function () {
    expect(AgentToolPackage::defaultForAgentType('security'))
        ->not->toContain(AgentToolPackage::PACKAGE_GITHUB)
        ->toContain(AgentToolPackage::PACKAGE_CORE);
});

it('registers application source tools in core package', function () {
    $tools = AgentToolPackage::toolNames(AgentToolPackage::PACKAGE_CORE);

    expect($tools)->toContain('get_application_source_info')
        ->and($tools)->toContain('list_application_source')
        ->and($tools)->toContain('read_application_source')
        ->and($tools)->toContain('write_application_source');
});

it('registers env var and spawn_task tools in core package', function () {
    $tools = AgentToolPackage::toolNames(AgentToolPackage::PACKAGE_CORE);

    expect($tools)->toContain('list_application_env_vars')
        ->and($tools)->toContain('upsert_application_env_var')
        ->and($tools)->toContain('spawn_task');
});

it('classifies spawn_task like other coordinator tools', function () {
    $classification = AgentToolClassification::forTool('spawn_task');

    expect($classification->isDestructive)->toBeFalse()
        ->and($classification->runtimeProfile)->toBe('coordinator');
});
