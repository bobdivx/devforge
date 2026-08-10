<?php

use App\Services\DevForge\Agent\AgentDelegator;

it('exposes spawnMany and delegateMany on the delegator', function () {
    expect(method_exists(AgentDelegator::class, 'spawnMany'))->toBeTrue()
        ->and(method_exists(AgentDelegator::class, 'delegateMany'))->toBeTrue()
        ->and(method_exists(AgentDelegator::class, 'spawnDynamicRoles'))->toBeTrue();
});
