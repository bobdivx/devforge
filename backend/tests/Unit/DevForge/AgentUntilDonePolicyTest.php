<?php

use App\Services\DevForge\Agent\AgentUntilDonePolicy;

it('force la suite après intention seule', function () {
    $policy = new AgentUntilDonePolicy;

    $decision = $policy->decide(
        'Améliore l’application et corrige le déploiement',
        'Je vais explorer ce dépôt et voir comment intégrer.',
        ['list_resources', 'get_deployment_logs'],
        0,
        4,
    );

    expect($decision['continue'])->toBeTrue()
        ->and($decision['nudge'] ?? '')->toContain('[DEVFORGE_CONTINUE]');
});

it('s’arrête sur [DEVFORGE_DONE]', function () {
    $policy = new AgentUntilDonePolicy;

    $decision = $policy->decide(
        'Corrige le bug',
        'Corrigé via update_application_runtime_settings. [DEVFORGE_DONE]',
        ['update_application_runtime_settings'],
        0,
        4,
    );

    expect($decision['continue'])->toBeFalse()
        ->and($decision['reason'])->toBe('done');
});

it('laisse une question informative se terminer', function () {
    $policy = new AgentUntilDonePolicy;

    $decision = $policy->decide(
        'C’est quoi le status de l’app ?',
        'L’application est healthy.',
        ['get_resource_status'],
        0,
        4,
    );

    expect($decision['continue'])->toBeFalse();
});

it('stripDoneMarker retire le marqueur', function () {
    $policy = new AgentUntilDonePolicy;

    expect($policy->stripDoneMarker('OK [DEVFORGE_DONE]'))->toBe('OK');
});
