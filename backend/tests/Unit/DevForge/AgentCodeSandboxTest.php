<?php

use App\Models\AiAgent;
use App\Services\DevForge\Agent\AgentCodeSandbox;
use App\Services\DevForge\Agent\Tool\AgentPermissionEngine;
use App\Services\DevForge\Agent\Tool\AgentSubagentCapabilities;

beforeEach(function () {
    config([
        'devforge.agents_code_sandbox_enabled' => false,
        'devforge.agents_code_sandbox_memory' => '256m',
        'devforge.agents_code_sandbox_cpus' => '0.5',
    ]);
});

it('denies execute when sandbox is disabled', function () {
    $sandbox = new AgentCodeSandbox;

    expect($sandbox->enabled())->toBeFalse()
        ->and($sandbox->execute('php', '<?php echo "hi";'))
        ->toHaveKey('error');
});

it('rejects unsupported language and oversized code when enabled', function () {
    config(['devforge.agents_code_sandbox_enabled' => true]);
    $sandbox = new AgentCodeSandbox;

    expect($sandbox->execute('ruby', 'puts 1'))->toHaveKey('error')
        ->and($sandbox->execute('php', str_repeat('a', 60_000)))->toHaveKey('error');
});

it('blocks docker.sock access in source', function () {
    config(['devforge.agents_code_sandbox_enabled' => true]);
    $sandbox = new AgentCodeSandbox;

    $result = $sandbox->execute('php', '<?php file_get_contents("/var/run/docker.sock");');

    expect($result['error'] ?? '')->toContain('Docker');
});

it('builds docker command without docker.sock or privileged', function () {
    $sandbox = new AgentCodeSandbox;
    $cmd = $sandbox->buildDockerCommand('php', '/tmp/workspace-test', 15);

    expect($cmd)->toContain('docker')
        ->and($cmd)->toContain('--network=none')
        ->and($cmd)->toContain('--rm')
        ->and($cmd)->toContain('--read-only')
        ->and(implode(' ', $cmd))->not->toContain('docker.sock')
        ->and(implode(' ', $cmd))->not->toContain('--privileged')
        ->and(implode(' ', $cmd))->toContain('/workspace:ro');
});

it('permission engine denies execute_code when sandbox disabled', function () {
    config(['devforge.agents_code_sandbox_enabled' => false]);
    $agent = new AiAgent;
    $agent->forceFill(['name' => 'Test', 'metadata' => []]);

    $decision = (new AgentPermissionEngine)->decide($agent, 'execute_code', [
        'language' => 'php',
        'code' => '<?php echo 1;',
    ]);

    expect($decision['decision'])->toBe(AgentPermissionEngine::DECISION_DENY)
        ->and($decision['rule_id'])->toBe('sandbox:disabled');
});

it('allows execute_code on implementer and tester leaf profiles', function () {
    $implementer = AgentSubagentCapabilities::leafAllowedTools([
        'subagent_role' => 'leaf',
        'role_slug' => 'implementer',
    ]);
    $tester = AgentSubagentCapabilities::leafAllowedTools([
        'subagent_role' => 'leaf',
        'role_slug' => 'tester',
    ]);

    expect($implementer)->toContain('execute_code')
        ->and($tester)->toContain('execute_code')
        ->and($implementer)->not->toContain('spawn_task');
});
