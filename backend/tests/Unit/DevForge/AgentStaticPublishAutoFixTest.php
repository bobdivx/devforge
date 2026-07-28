<?php

use App\Services\DevForge\Agent\AgentRunner;

it('does not treat nixpacks alone as a static site for auto-fix', function () {
    $runner = app(AgentRunner::class);
    $method = new ReflectionMethod(AgentRunner::class, 'shouldAutoFixStaticPublishDirectory');
    $method->setAccessible(true);

    $shouldFix = $method->invoke($runner, [
        'is_static' => false,
        'build_pack' => 'nixpacks',
        'publish_directory' => '/',
        'event' => 'application_readiness_failed',
        'probe_error' => 'Welcome to nginx!',
    ], [
        ['message' => 'Welcome to nginx!'],
    ], 'app-uuid-non-static');

    expect($shouldFix)->toBeFalse();
});

it('allows static publish auto-fix when context says the site is static', function () {
    $runner = app(AgentRunner::class);
    $method = new ReflectionMethod(AgentRunner::class, 'shouldAutoFixStaticPublishDirectory');
    $method->setAccessible(true);

    $shouldFix = $method->invoke($runner, [
        'is_static' => true,
        'build_pack' => 'nixpacks',
        'publish_directory' => '/',
        'event' => 'application_readiness_failed',
        'probe_error' => 'Welcome to nginx!',
    ], [
        ['message' => 'Welcome to nginx!'],
    ], 'app-uuid-static');

    expect($shouldFix)->toBeTrue();
});
