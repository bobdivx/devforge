<?php

use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\Application;
use App\Models\Team;
use App\Services\DevForge\Agent\ApplicationOverviewChatBridge;
use App\Services\DevForge\Agent\Tool\AgentPermissionEngine;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

it('posts a clear failure announcement into the overview chat session', function () {
    $team = Team::factory()->create();
    $provider = \App\Models\AiProviderConfig::factory()->create(['team_id' => $team->id]);
    $agent = AiAgent::factory()->deployment()->create([
        'team_id' => $team->id,
        'provider_config_id' => $provider->id,
        'is_active' => true,
    ]);
    $application = Application::factory()->create(['name' => 'macompta-overview']);
    $run = AiAgentRun::factory()->create([
        'agent_id' => $agent->id,
        'status' => 'pending',
        'trigger' => 'event',
        'metadata' => [
            'event' => 'deployment_failed',
            'application_uuid' => $application->uuid,
            'deployment_uuid' => 'dep-overview-1',
        ],
    ]);

    $message = app(ApplicationOverviewChatBridge::class)->postFailureAnnouncement(
        $agent,
        $run,
        $application,
        [
            'event' => 'deployment_failed',
            'deployment_uuid' => 'dep-overview-1',
            'failure_excerpt' => [
                ['message' => 'npm ERR! code ELIFECYCLE'],
                ['message' => 'Permission denied'],
            ],
        ],
    );

    expect($message)->not->toBeNull()
        ->and($message->role)->toBe('assistant')
        ->and($message->content)->toContain('Déploiement en échec')
        ->and($message->content)->toContain('**État du problème :** `erreur`')
        ->and($message->content)->toContain('npm ERR! code ELIFECYCLE')
        ->and($message->metadata['problem_status'] ?? null)->toBe('error')
        ->and($message->session->title)->toBe('App · macompta-overview');
});

it('posts an intervention report with done and blocked actions', function () {
    $team = Team::factory()->create();
    $provider = \App\Models\AiProviderConfig::factory()->create(['team_id' => $team->id]);
    $agent = AiAgent::factory()->deployment()->create([
        'team_id' => $team->id,
        'provider_config_id' => $provider->id,
        'is_active' => true,
    ]);
    $run = AiAgentRun::factory()->create([
        'agent_id' => $agent->id,
        'status' => 'completed',
        'trigger' => 'event',
        'summary' => 'Permissions corrigées.',
        'metadata' => [
            'event' => 'deployment_failed',
            'application_uuid' => 'app-uuid',
            'application_name' => 'demo-app',
            'deployment_uuid' => 'dep-2',
            'correction' => [
                'outcome' => 'fixed',
                'headline' => 'Permissions host corrigées et redéploiement lancé.',
                'diagnosis' => 'tee Permission denied sur .env',
                'actions' => [
                    [
                        'kind' => 'host_permissions',
                        'label' => 'Permissions host',
                        'detail' => '/data/coolify/applications/x',
                        'ok' => true,
                    ],
                    [
                        'kind' => 'redeploy',
                        'label' => 'Redéploiement',
                        'detail' => 'relancé',
                        'ok' => true,
                    ],
                ],
            ],
        ],
    ]);

    $message = app(ApplicationOverviewChatBridge::class)->postInterventionReport(
        $agent,
        $run,
        [
            'event' => 'deployment_failed',
            'application_uuid' => 'app-uuid',
            'application_name' => 'demo-app',
            'deployment_uuid' => 'dep-2',
        ],
    );

    expect($message)->not->toBeNull()
        ->and($message->content)->toContain('Rapport d’intervention')
        ->and($message->content)->toContain('**État du problème :** `resolved`')
        ->and($message->content)->toContain('Permissions host')
        ->and($message->content)->toContain('Ce que j’ai fait')
        ->and($message->metadata['problem_status'] ?? null)->toBe('resolved')
        ->and($message->metadata['outcome'] ?? null)->toBe('fixed');
});

it('forces allow for auto-fix deployment event asks', function () {
    $engine = new AgentPermissionEngine;

    $ask = [
        'decision' => AgentPermissionEngine::DECISION_ASK,
        'reason' => 'Destructif',
        'rule_id' => 'mode:tiered:destructive',
    ];

    $allowed = $engine->resolveForAutoDeployFix($ask, 'event', ['event' => 'deployment_failed']);
    $ignored = $engine->resolveForAutoDeployFix($ask, 'chat', ['event' => 'deployment_failed']);
    $otherEvent = $engine->resolveForAutoDeployFix($ask, 'event', ['event' => 'deployment_build_started']);

    expect($allowed['decision'])->toBe(AgentPermissionEngine::DECISION_ALLOW)
        ->and($ignored['decision'])->toBe(AgentPermissionEngine::DECISION_ASK)
        ->and($otherEvent['decision'])->toBe(AgentPermissionEngine::DECISION_ASK);
});

it('does not force allow when auto-fix deployments is disabled', function () {
    config()->set('devforge.agents_auto_fix_deployments', false);

    $engine = new AgentPermissionEngine;
    $ask = [
        'decision' => AgentPermissionEngine::DECISION_ASK,
        'reason' => 'Destructif',
        'rule_id' => 'mode:tiered:destructive',
    ];

    $decision = $engine->resolveForAutoDeployFix($ask, 'event', ['event' => 'deployment_failed']);

    expect($decision['decision'])->toBe(AgentPermissionEngine::DECISION_ASK);
});
