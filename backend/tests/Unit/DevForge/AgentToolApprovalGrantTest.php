<?php

use App\Services\DevForge\Agent\Tool\AgentToolApprovalGrant;
use Illuminate\Support\Facades\Cache;

it('builds stable fingerprints for tool arguments', function () {
    $a = AgentToolApprovalGrant::fingerprint('exec_command', ['command' => 'uptime']);
    $b = AgentToolApprovalGrant::fingerprint('exec_command', ['command' => 'uptime']);
    $c = AgentToolApprovalGrant::fingerprint('exec_command', ['command' => 'whoami']);

    expect($a)->toBe($b)
        ->and($a)->not->toBe($c);
});

it('grants and consumes a one-shot approval', function () {
    Cache::flush();

    $key = AgentToolApprovalGrant::fingerprint('control_resource', ['action' => 'deploy']);
    AgentToolApprovalGrant::grant(42, $key);

    expect(AgentToolApprovalGrant::has(42, $key))->toBeTrue()
        ->and(AgentToolApprovalGrant::consume(42, $key))->toBeTrue()
        ->and(AgentToolApprovalGrant::consume(42, $key))->toBeFalse()
        ->and(AgentToolApprovalGrant::has(42, $key))->toBeFalse();
});

it('remembers a tool for the session without consuming it', function () {
    Cache::flush();

    AgentToolApprovalGrant::rememberTool(42, 'exec_command');

    expect(AgentToolApprovalGrant::hasRememberedTool(42, 'exec_command'))->toBeTrue()
        ->and(AgentToolApprovalGrant::hasRememberedTool(42, 'write_remote_file'))->toBeFalse()
        ->and(AgentToolApprovalGrant::hasRememberedTool(42, 'exec_command'))->toBeTrue();
});
