<?php

use App\Services\DevForge\Core\CoreResourceActionsResolver;

it('returns deploy only for stopped applications', function () {
    $resolver = new CoreResourceActionsResolver;

    expect($resolver->forResource('application', 'exited:unknown'))->toBe(['deploy'])
        ->and($resolver->forResource('application', 'stopped'))->toBe(['deploy'])
        ->and($resolver->forResource('application', 'dead'))->toBe(['deploy']);
});

it('returns lifecycle actions for running applications', function () {
    $resolver = new CoreResourceActionsResolver;

    expect($resolver->forResource('application', 'running:healthy'))->toBe(['stop', 'restart', 'deploy'])
        ->and($resolver->forResource('application', 'running:unknown'))->toBe(['stop', 'restart', 'deploy'])
        ->and($resolver->forResource('application', 'starting:unknown'))->toBe(['stop', 'restart', 'deploy']);
});

it('returns start for stopped databases and stop/restart when running', function () {
    $resolver = new CoreResourceActionsResolver;

    expect($resolver->forResource('database', 'exited:unknown'))->toBe(['start'])
        ->and($resolver->forResource('database', 'running:healthy'))->toBe(['stop', 'restart']);
});

it('returns start for stopped services and lifecycle actions when running', function () {
    $resolver = new CoreResourceActionsResolver;

    expect($resolver->forResource('service', 'exited:unknown'))->toBe(['start'])
        ->and($resolver->forResource('service', 'running:healthy'))->toBe(['stop', 'restart', 'deploy']);
});
