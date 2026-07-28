<?php

use App\Services\DevForge\Agent\GithubPrWatchDispatcher;

it('parses owner and repo from github urls', function () {
    $ref = new ReflectionClass(GithubPrWatchDispatcher::class);
    $method = $ref->getMethod('parseOwnerRepo');
    $method->setAccessible(true);

    $dispatcher = app(GithubPrWatchDispatcher::class);

    expect($method->invoke($dispatcher, 'https://github.com/acme/widgets.git'))
        ->toBe(['owner' => 'acme', 'repo' => 'widgets'])
        ->and($method->invoke($dispatcher, 'acme/widgets'))
        ->toBe(['owner' => 'acme', 'repo' => 'widgets'])
        ->and($method->invoke($dispatcher, 'not-a-repo'))
        ->toBeNull();
});

it('builds stable fingerprints for pull requests', function () {
    $ref = new ReflectionClass(GithubPrWatchDispatcher::class);
    $method = $ref->getMethod('fingerprint');
    $method->setAccessible(true);

    $dispatcher = app(GithubPrWatchDispatcher::class);

    expect($method->invoke($dispatcher, 42, '2026-07-21T10:00:00Z'))
        ->toBe($method->invoke($dispatcher, 42, '2026-07-21T10:00:00Z'))
        ->and($method->invoke($dispatcher, 42, '2026-07-21T10:00:00Z'))
        ->not->toBe($method->invoke($dispatcher, 42, '2026-07-21T11:00:00Z'));
});
