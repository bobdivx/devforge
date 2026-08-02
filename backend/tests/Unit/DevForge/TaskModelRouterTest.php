<?php

use App\Enums\TaskModelTier;
use App\Services\DevForge\Agent\TaskModelRouter;

it('classifies simple chat questions as light tier', function () {
    $router = new TaskModelRouter;

    expect($router->classify('Liste mes serveurs', 'chat', 'debug', []))->toBe(TaskModelTier::Light);
});

it('classifies deployment failures as standard tier for stable flash models', function () {
    $router = new TaskModelRouter;

    expect($router->classify('', 'event', 'debug', ['event' => 'deployment_failed']))->toBe(TaskModelTier::Standard);
});

it('classifies deep analysis requests as heavy tier', function () {
    $router = new TaskModelRouter;

    expect($router->classify('Analyse la cause racine du crash', 'chat', 'debug', []))->toBe(TaskModelTier::Heavy);
});

it('prioritizes lite models for light tier then flash as quota overflow', function () {
    $router = new TaskModelRouter;

    $models = $router->prioritizeModelsForTier(TaskModelTier::Light, [
        'gemini-2.5-flash',
        'gemini-2.0-flash-lite',
        'gemini-2.5-flash-native-audio-latest',
    ]);

    expect($models)->toBe(['gemini-2.0-flash-lite', 'gemini-2.5-flash']);
});

it('prioritizes flash before pro for heavy tier', function () {
    $router = new TaskModelRouter;

    $models = $router->prioritizeModelsForTier(TaskModelTier::Heavy, [
        'gemini-2.5-flash',
        'gemini-2.5-pro',
    ]);

    expect($models[0])->toBe('gemini-2.5-flash')
        ->and($models[1])->toBe('gemini-2.5-pro');
});

it('builds ux friendly routing payload', function () {
    $router = new TaskModelRouter;

    $payload = $router->routingPayload(TaskModelTier::Standard, 'Diagnostic infra.');

    expect($payload['display'])->toBe('Auto · Flash')
        ->and($payload['tier_label'])->toBe('Standard')
        ->and($payload['reason'])->toBe('Diagnostic infra.');
});
