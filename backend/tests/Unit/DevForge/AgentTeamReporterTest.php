<?php

use App\Models\AiAgentRun;
use App\Services\DevForge\Agent\AgentTeamReporter;

it('builds a structured team report with markdown from completions', function () {
    $parent = new AiAgentRun;
    $parent->forceFill([
        'metadata' => [
            'ephemeral_tasks' => [
                [
                    'run_uuid' => 'leaf-researcher',
                    'goal' => 'Collecter les faits',
                    'status' => 'completed',
                    'summary' => 'Sources OK, attention token manquant',
                    'contribution' => '3 sources vérifiées',
                    'role_slug' => 'researcher',
                    'leaf_profile' => 'research',
                    'tier' => 'heavy',
                    'model_label' => 'Pro',
                ],
                [
                    'run_uuid' => 'leaf-writer',
                    'goal' => 'Rédiger le rapport',
                    'status' => 'completed',
                    'summary' => 'Rapport prêt',
                    'contribution' => 'Synthèse exécutive livrée',
                    'role_slug' => 'writer',
                    'leaf_profile' => 'research',
                    'tier' => 'standard',
                    'model_label' => 'Flash',
                ],
            ],
        ],
    ]);

    $report = (new AgentTeamReporter)->build($parent, [
        [
            'run_uuid' => 'leaf-researcher',
            'goal' => 'Collecter les faits',
            'status' => 'completed',
            'summary' => 'Sources OK, attention token manquant',
            'contribution' => '3 sources vérifiées',
            'role_slug' => 'researcher',
            'leaf_profile' => 'research',
            'tier' => 'heavy',
            'model_label' => 'Pro',
        ],
        [
            'run_uuid' => 'leaf-writer',
            'goal' => 'Rédiger le rapport',
            'status' => 'completed',
            'summary' => 'Rapport prêt',
            'contribution' => 'Synthèse exécutive livrée',
            'role_slug' => 'writer',
            'leaf_profile' => 'research',
            'tier' => 'standard',
            'model_label' => 'Flash',
        ],
    ]);

    expect($report['leaf_count'])->toBe(2)
        ->and($report['succeeded'])->toBe(2)
        ->and($report['failed'])->toBe(0)
        ->and($report['roles'])->toContain('researcher')
        ->and($report['roles'])->toContain('writer')
        ->and($report['contributions'][0]['contribution'])->toContain('3 sources')
        ->and($report['risks'])->not->toBeEmpty()
        ->and($report['markdown'])->toContain('## Team report')
        ->and($report['markdown'])->toContain('researcher')
        ->and($report['markdown'])->toContain('writer');
});

it('exposes persist method on team reporter', function () {
    expect(method_exists(AgentTeamReporter::class, 'persist'))->toBeTrue()
        ->and(method_exists(AgentTeamReporter::class, 'build'))->toBeTrue();
});
