<?php

use App\Services\DevForge\Agent\AgentDelegator;
use App\Services\DevForge\Agent\AgentSubagentHandoff;
use App\Services\DevForge\Agent\Tool\AgentSubagentCapabilities;

it('exposes async spawn yield and handoff APIs', function () {
    expect(method_exists(AgentDelegator::class, 'spawnEphemeral'))->toBeTrue()
        ->and(method_exists(AgentDelegator::class, 'yieldWait'))->toBeTrue()
        ->and(method_exists(AgentDelegator::class, 'spawnMany'))->toBeTrue()
        ->and(method_exists(AgentSubagentHandoff::class, 'onLeafFinished'))->toBeTrue()
        ->and(method_exists(AgentSubagentHandoff::class, 'dispatchPendingLeafs'))->toBeTrue()
        ->and(method_exists(AgentSubagentHandoff::class, 'buildHandoffUserMessage'))->toBeTrue();
});

it('builds a review handoff message from completions', function () {
    $handoff = app(AgentSubagentHandoff::class);
    $message = $handoff->buildHandoffUserMessage([
        [
            'run_uuid' => 'abc',
            'goal' => 'Diagnostiquer le build',
            'status' => 'completed',
            'summary' => 'Cause: branche manquante',
            'leaf_profile' => 'diagnose',
        ],
    ]);

    expect($message)->toContain('[Subagent Completion]')
        ->and($message)->toContain(AgentSubagentCapabilities::reviewInstruction())
        ->and($message)->toContain('Diagnostiquer le build')
        ->and($message)->toContain('Cause: branche manquante');
});
