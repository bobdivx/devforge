<?php

use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Services\DevForge\Agent\AgentChatRepairStrategy;
use App\Services\DevForge\Agent\AgentDirectives;
use App\Services\DevForge\Agent\AgentPromptBuilder;
use App\Services\DevForge\Agent\AgentRepairHarness;
use App\Services\DevForge\Agent\AgentToolkit;
use Mockery;

it('forbids asking user confirmation in chat autonomy rules', function () {
    expect(AgentDirectives::chatAutonomyRules())
        ->toContain('N\'INTERROGE JAMAIS')
        ->and(AgentDirectives::chatAutonomyRules())->toContain('Est-ce que cela vous convient');
});

it('detects when the model defers to the user', function () {
    expect(AgentDirectives::defersToUser('Est-ce que cela vous convient ?'))->toBeTrue()
        ->and(AgentDirectives::defersToUser('Voulez-vous que je commence ?'))->toBeTrue()
        ->and(AgentDirectives::defersToUser('Voici l\'état de vos ressources.'))->toBeFalse();
});

it('detects tool names written in prose instead of tool_calls', function () {
    expect(AgentDirectives::mentionsToolWithoutCalling('Je vais appeler spawn_task maintenant'))->toBeTrue()
        ->and(AgentDirectives::mentionsToolWithoutCalling('{"method":"spawn_task","goal":"fix"}'))->toBeTrue()
        ->and(AgentDirectives::mentionsToolWithoutCalling('Le déploiement a échoué sur la branche main.'))->toBeFalse();
});

it('detects repair chat intents for autonomous fallback', function () {
    expect(AgentDirectives::isChatRepairIntent('Réparé le déploiement'))->toBeTrue()
        ->and(AgentDirectives::isChatRepairIntent('corrige le déploiement maintenant'))->toBeTrue()
        ->and(AgentDirectives::isChatRepairIntent('fix permission denied'))->toBeTrue()
        ->and(AgentDirectives::isChatRepairIntent('Permission denied'))->toBeTrue()
        ->and(AgentDirectives::isChatRepairIntent('Pourquoi le déploiement échoue ?'))->toBeFalse()
        ->and(AgentDirectives::isChatRepairIntent('Bonjour'))->toBeFalse();
});

it('classifies repair strategy from deployment log blobs', function () {
    expect(AgentChatRepairStrategy::detectIssue('tee: /data/coolify/... Permission denied'))
        ->toBe(AgentChatRepairStrategy::ISSUE_PERMISSIONS)
        ->and(AgentChatRepairStrategy::detectIssue('Could not find remote branch feature/foo'))
        ->toBe(AgentChatRepairStrategy::ISSUE_BRANCH)
        ->and(AgentChatRepairStrategy::detectIssue('npm ERR! code ELIFECYCLE'))
        ->toBe(AgentChatRepairStrategy::ISSUE_GENERIC);
});

it('respects agents_auto_fallback when harness is disabled', function () {
    config(['devforge.agents_auto_fallback' => false]);

    $agent = AiAgent::factory()->deployment()->make(['resource_uuid' => 'app-uuid']);
    $run = Mockery::mock(AiAgentRun::class);
    $toolkit = Mockery::mock(AgentToolkit::class);
    $toolkit->shouldNotReceive('execute');

    $result = app(AgentRepairHarness::class)->execute($toolkit, $agent, $run, [], 'corrige');

    expect($result['steps'])->toBe([])
        ->and($result['text'])->toContain('désactivé');
});

it('harness executes fix_application_host_permissions on permission denied logs', function () {
    config(['devforge.agents_auto_fallback' => true]);

    $agent = AiAgent::factory()->deployment()->make(['resource_uuid' => 'app-uuid-1']);
    $run = Mockery::mock(AiAgentRun::class);
    $run->shouldReceive('appendLog')->andReturnNull();

    $toolkit = Mockery::mock(AgentToolkit::class);
    $toolkit->shouldReceive('execute')
        ->once()
        ->with('get_deployment_logs', Mockery::on(fn (array $args): bool => ($args['application_uuid'] ?? null) === 'app-uuid-1'))
        ->andReturn([
            'deployments' => [
                ['logs' => [['message' => 'tee: /data/coolify/applications/app-uuid-1/.env: Permission denied']]],
            ],
        ]);
    $toolkit->shouldReceive('execute')
        ->once()
        ->with('fix_application_host_permissions', Mockery::type('array'))
        ->andReturn(['ok' => true, 'path' => '/data/coolify/applications/app-uuid-1']);

    $result = app(AgentRepairHarness::class)->execute(
        $toolkit,
        $agent,
        $run,
        ['application_uuid' => 'app-uuid-1'],
        'corrige le déploiement maintenant',
    );

    expect($result['steps'])->toHaveCount(2)
        ->and($result['steps'][0]['name'])->toBe('get_deployment_logs')
        ->and($result['steps'][1]['name'])->toBe('fix_application_host_permissions')
        ->and($result['text'])->toContain('Réparation exécutée');
});

it('hints repair requests toward git branch tools', function () {
    $hint = AgentDirectives::chatActionHint('Réparé le déploiement');

    expect($hint)->toContain('fix_application_host_permissions')
        ->and($hint)->toContain('tool_calls');
});

it('suggests immediate github tool usage for capability questions', function () {
    $hint = AgentDirectives::chatActionHint('As tu accès aux fichiers github et aux outils github ?');

    expect($hint)->toContain('enable_tool_package')
        ->and($hint)->toContain('get_application_git_info')
        ->and($hint)->not->toContain('confirmation');
});

it('includes chat autonomy rules and action hint in chat system prompt', function () {
    $agent = AiAgent::factory()->debug()->make([
        'name' => 'Debug Test',
        'resource_uuid' => 'bp68rd8g7pka4g9h0m8nl275',
    ]);
    $agent->setRelation('team', \App\Models\Team::factory()->make(['name' => 'Equipe Test']));

    $prompt = app(AgentPromptBuilder::class)->chatSystemPrompt(
        $agent,
        'As tu accès aux fichiers des appli et github ?',
    );

    expect($prompt)->toContain('autonomie style agent Cursor')
        ->and($prompt)->toContain('enable_tool_package')
        ->and($prompt)->toContain('bp68rd8g7pka4g9h0m8nl275');
});

it('includes application scope in chat system prompt when provided', function () {
    $agent = AiAgent::factory()->deployment()->make([
        'name' => 'Deploy Test',
    ]);
    $agent->setRelation('team', \App\Models\Team::factory()->make(['name' => 'Equipe Test']));

    $prompt = app(AgentPromptBuilder::class)->chatSystemPrompt(
        $agent,
        'Remplacer l’adapter Vercel par @astrojs/node',
        [
            'application_uuid' => 'app-uuid-macompta',
            'application_name' => 'macompta',
            'git_repository' => 'acme/macompta',
            'git_branch' => 'main',
            'build_pack' => 'nixpacks',
            'fqdn' => 'https://macompta.example.com',
        ],
    );

    expect($prompt)->toContain('Champ d\'application')
        ->and($prompt)->toContain('app-uuid-macompta')
        ->and($prompt)->toContain('macompta')
        ->and($prompt)->toContain('application_uuid=app-uuid-macompta');
});
