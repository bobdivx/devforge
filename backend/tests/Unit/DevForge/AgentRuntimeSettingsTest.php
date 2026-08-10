<?php

use App\Models\InstanceSettings;
use App\Services\DevForge\Agent\AgentRuntimeSettings;

beforeEach(function () {
    config([
        'devforge.agents_dynamic_roles_enabled' => true,
        'devforge.agents_role_model_routing' => true,
        'devforge.agents_collab_enabled' => true,
        'devforge.agents_code_sandbox_enabled' => true,
        'devforge.agents_mcp_client_enabled' => true,
        'devforge.agents_mcp_servers' => [],
    ]);
});

it('defaults product features to enabled without instance row', function () {
    $resolved = (new AgentRuntimeSettings)->resolved();

    expect($resolved['dynamic_roles_enabled'])->toBeTrue()
        ->and($resolved['collab_enabled'])->toBeTrue()
        ->and($resolved['code_sandbox_enabled'])->toBeTrue()
        ->and($resolved['mcp_client_enabled'])->toBeTrue()
        ->and($resolved['mcp_servers'])->toBe([]);
});

it('prefers instance settings over config', function () {
    $settings = new InstanceSettings;
    $settings->forceFill([
        'agents_features' => [
            'code_sandbox_enabled' => false,
            'mcp_client_enabled' => false,
            'mcp_servers' => [
                ['id' => 'docs', 'url' => 'https://mcp.example/docs', 'label' => 'Docs'],
            ],
        ],
    ]);

    config(['devforge.agents_code_sandbox_enabled' => true]);

    $runtime = new AgentRuntimeSettings;

    expect($runtime->codeSandboxEnabled($settings))->toBeFalse()
        ->and($runtime->mcpClientEnabled($settings))->toBeFalse()
        ->and($runtime->mcpServers($settings))->toHaveCount(1)
        ->and($runtime->mcpServers($settings)[0]['id'])->toBe('docs');
});

it('merges stored features without wiping unspecified keys', function () {
    $runtime = new AgentRuntimeSettings;
    $merged = $runtime->mergeStored(
        [
            'collab_enabled' => true,
            'mcp_servers' => [['id' => 'a', 'url' => 'https://a.test']],
        ],
        [
            'collab_enabled' => false,
            'code_sandbox_enabled' => true,
        ],
    );

    expect($merged['collab_enabled'])->toBeFalse()
        ->and($merged['code_sandbox_enabled'])->toBeTrue()
        ->and($merged['mcp_servers'])->toHaveCount(1);
});
