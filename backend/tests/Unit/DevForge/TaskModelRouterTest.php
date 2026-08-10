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

it('maps business roles to distinct model tiers', function () {
    $router = new TaskModelRouter;

    expect($router->tierForRole('researcher'))->toBe(TaskModelTier::Heavy)
        ->and($router->tierForRole('writer'))->toBe(TaskModelTier::Standard)
        ->and($router->tierForRole('tester'))->toBe(TaskModelTier::Light)
        ->and($router->tierForRole('implementer'))->toBe(TaskModelTier::Standard);
});

it('classifies ephemeral leafs by role slug when role model routing is on', function () {
    config(['devforge.agents_role_model_routing' => true]);
    $router = new TaskModelRouter;

    $researcher = $router->classify('Objectif quelconque', 'ephemeral', 'devforge', [
        'ephemeral' => true,
        'event' => 'delegated',
        'role_slug' => 'researcher',
    ]);
    $tester = $router->classify('Objectif quelconque', 'ephemeral', 'devforge', [
        'ephemeral' => true,
        'event' => 'delegated',
        'role_slug' => 'tester',
    ]);

    expect($researcher)->toBe(TaskModelTier::Heavy)
        ->and($tester)->toBe(TaskModelTier::Light)
        ->and($researcher)->not->toBe($tester);
});

it('includes role in routing display payload', function () {
    $router = new TaskModelRouter;
    $payload = $router->routingPayload(TaskModelTier::Heavy, 'Rôle researcher', 'researcher');

    expect($payload['display'])->toBe('Rôle researcher · Pro')
        ->and($payload['role_slug'])->toBe('researcher');
});
