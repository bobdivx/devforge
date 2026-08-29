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
        ->and(AgentDirectives::mentionsToolWithoutCalling('get_github_workflow_run(owner=…)'))->toBeTrue()
        ->and(AgentDirectives::mentionsToolWithoutCalling('Le déploiement a échoué sur la branche main.'))->toBeFalse();
});

it('detects model refusals that block DevForge agent runs', function () {
    expect(AgentDirectives::isModelRefusal(
        'Je suis désolé, mais je ne peux pas poursuivre cette conversation car elle semble être liée à une application spécifique (apparently Coolify)',
    ))->toBeTrue()
        ->and(AgentDirectives::isModelRefusal('Voici le résumé des jobs en échec.'))->toBeFalse();
});

it('nudges github-actions agents toward real tool calls', function () {
    expect(AgentDirectives::toolNudgeMessage('github-actions'))
        ->toContain('list_github_apps')
        ->and(AgentDirectives::refusalNudgeMessage('github-actions'))
        ->toContain('DevForge')
        ->and(AgentDirectives::proseToolNudgeMessage('github-actions'))
        ->toContain('tool_call');
});

it('detects repair chat intents for autonomous fallback', function () {
    expect(AgentDirectives::isChatRepairIntent('Réparé le déploiement'))->toBeTrue()
        ->and(AgentDirectives::isChatRepairIntent('corrige le déploiement maintenant'))->toBeTrue()
        ->and(AgentDirectives::isChatRepairIntent('fix permission denied'))->toBeTrue()
        ->and(AgentDirectives::isChatRepairIntent('Permission denied'))->toBeTrue()
        ->and(AgentDirectives::isChatRepairIntent('https://mf3d.app/ me donne la page nginx et no l\'appli'))->toBeTrue()
        ->and(AgentDirectives::isChatRepairIntent('pourquoi je ne peux pas accéder a l\'appli https://mf3d.app/'))->toBeTrue()
        ->and(AgentDirectives::isChatRepairIntent('Page nginx par défaut détectée (publish_directory probablement incorrect)'))->toBeTrue()
        ->and(AgentDirectives::isChatRepairIntent('Pourquoi le déploiement échoue ?'))->toBeFalse()
        ->and(AgentDirectives::isChatRepairIntent('Bonjour'))->toBeFalse();
});

it('extracts tool calls from prose JSON dumps', function () {
    $calls = AgentDirectives::extractProseToolCalls(
        'Voici la commande requise : {"method":"spawn_task","goal":"reparer_le_deploiement","difficulty":"heavy"}',
    );

    expect($calls)->toHaveCount(1)
        ->and($calls[0]['name'])->toBe('spawn_task')
        ->and($calls[0]['arguments']['goal'])->toBe('reparer_le_deploiement')
        ->and($calls[0]['arguments']['difficulty'])->toBe('heavy');

    $named = AgentDirectives::extractProseToolCalls(
        '```json\n{"name":"control_resource","arguments":{"uuid":"app-1","type":"applications","action":"deploy"}}\n```',
    );

    expect($named)->toHaveCount(1)
        ->and($named[0]['name'])->toBe('control_resource')
        ->and($named[0]['arguments']['action'])->toBe('deploy');

    expect(AgentDirectives::extractProseToolCalls('Le déploiement a échoué sur la branche main.'))->toBe([]);
});

it('classifies repair strategy from deployment log blobs', function () {
    expect(AgentChatRepairStrategy::detectIssue('tee: /data/coolify/... Permission denied'))
        ->toBe(AgentChatRepairStrategy::ISSUE_PERMISSIONS)
        ->and(AgentChatRepairStrategy::detectIssue('Could not find remote branch feature/foo'))
        ->toBe(AgentChatRepairStrategy::ISSUE_BRANCH)
        ->and(AgentChatRepairStrategy::detectIssue('npm ERR! code ELIFECYCLE'))
        ->toBe(AgentChatRepairStrategy::ISSUE_GENERIC)
        ->and(AgentChatRepairStrategy::detectIssue('Read-only file system ... mkdir /data/coolify/applications/app'))
        ->toBe(AgentChatRepairStrategy::ISSUE_BASE_CONFIG)
        ->and(AgentChatRepairStrategy::detectIssue('Failed to launch the browser process Chromium puppeteer'))
        ->toBe(AgentChatRepairStrategy::ISSUE_PUPPETEER)
        ->and(AgentChatRepairStrategy::detectIssue(
            "Healthcheck URL (inside the container): GET: http://localhost:3000/\n".
            "[@astrojs/node] Server listening on\n local: http://localhost:4321\n".
            'New container is unhealthy.'
        ))->toBe(AgentChatRepairStrategy::ISSUE_HEALTHCHECK_PORT)
        ->and(AgentChatRepairStrategy::detectIssue('docker tee: /artifacts/foo without permission words'))
        ->toBe(AgentChatRepairStrategy::ISSUE_GENERIC)
        ->and(AgentChatRepairStrategy::detectIssue(
            'error @apollo/federation@0.27.0: The engine "node" is incompatible with this module. Expected version ">=12.13.0 <17.0". Got "22.11.0"',
        ))->toBe(AgentChatRepairStrategy::ISSUE_NODE_ENGINE)
        ->and(AgentChatRepairStrategy::detectIssue('Node.js v22.11.0 is not supported by Astro!'))
        ->toBe(AgentChatRepairStrategy::ISSUE_NODE_ENGINE)
        ->and(AgentChatRepairStrategy::detectIssue(
            "Error: Cannot find module '/app/dist/server/entry.mjs'\nNew container is unhealthy.",
        ))->toBe(AgentChatRepairStrategy::ISSUE_ASTRO_STATIC_RUNTIME);
});

it('harness switches Astro static missing entry.mjs to nginx runtime settings', function () {
    config(['devforge.agents_auto_fallback' => true]);

    $agent = AiAgent::factory()->deployment()->make(['resource_uuid' => 'app-uuid-astro-static']);
    $run = Mockery::mock(AiAgentRun::class);
    $run->shouldReceive('appendLog')->andReturnNull();
    $run->shouldReceive('mergeMetadata')->andReturnNull();
    $run->metadata = [];

    $toolkit = Mockery::mock(AgentToolkit::class);
    $toolkit->shouldReceive('execute')
        ->once()
        ->with('get_deployment_logs', Mockery::type('array'))
        ->andReturn([
            'deployments' => [
                ['logs' => [[
                    'message' => "Error: Cannot find module '/app/dist/server/entry.mjs'\nNew container is unhealthy.",
                ]]],
            ],
        ]);
    $toolkit->shouldReceive('execute')
        ->once()
        ->with('update_application_runtime_settings', Mockery::on(
            fn (array $args): bool => ($args['is_static'] ?? null) === true
                && ($args['publish_directory'] ?? null) === '/dist'
                && ($args['ports_exposes'] ?? null) === '80'
                && ($args['start_command'] ?? null) === ''
                && ($args['redeploy'] ?? false) === true
        ))
        ->andReturn(['ok' => true]);

    $result = app(AgentRepairHarness::class)->execute(
        $toolkit,
        $agent,
        $run,
        ['application_uuid' => 'app-uuid-astro-static'],
        'corrige le déploiement',
    );

    expect($result['steps'])->toHaveCount(2)
        ->and($result['steps'][1]['name'])->toBe('update_application_runtime_settings')
        ->and($result['text'])->toContain('nginx');
});

it('harness aligns ports when healthcheck mismatches listen port', function () {
    config(['devforge.agents_auto_fallback' => true]);

    $agent = AiAgent::factory()->deployment()->make(['resource_uuid' => 'app-uuid-port']);
    $run = Mockery::mock(AiAgentRun::class);
    $run->shouldReceive('appendLog')->andReturnNull();
    $run->shouldReceive('mergeMetadata')->andReturnNull();
    $run->metadata = [];

    $toolkit = Mockery::mock(AgentToolkit::class);
    $toolkit->shouldReceive('execute')
        ->once()
        ->with('get_deployment_logs', Mockery::type('array'))
        ->andReturn([
            'deployments' => [
                ['logs' => [[
                    'message' => "Healthcheck URL (inside the container): GET: http://localhost:3000/\n".
                        "[@astrojs/node] Server listening on\n local: http://localhost:4321\n".
                        'New container is unhealthy.',
                ]]],
            ],
        ]);
    $toolkit->shouldReceive('execute')
        ->once()
        ->with('update_application_runtime_settings', Mockery::on(
            fn (array $args): bool => ($args['ports_exposes'] ?? null) === '4321'
                && ($args['health_check_port'] ?? null) === '4321'
                && ($args['redeploy'] ?? false) === true
        ))
        ->andReturn(['ok' => true]);
    $toolkit->shouldReceive('execute')
        ->once()
        ->with('upsert_application_env_var', Mockery::on(
            fn (array $args): bool => ($args['key'] ?? '') === 'PORT' && ($args['value'] ?? '') === '4321'
        ))
        ->andReturn(['ok' => true]);

    $result = app(AgentRepairHarness::class)->execute(
        $toolkit,
        $agent,
        $run,
        ['application_uuid' => 'app-uuid-port'],
        'corrige le déploiement',
    );

    expect($result['steps'])->toHaveCount(3)
        ->and($result['steps'][1]['name'])->toBe('update_application_runtime_settings')
        ->and($result['text'])->toContain('4321');
});

it('falls back to harness after diagnostic tools without recorded corrections', function () {
    expect(AgentChatRepairStrategy::shouldFallbackToHarness(
        'deployment_failed',
        true,
        false,
        [],
    ))->toBeTrue()
        ->and(AgentChatRepairStrategy::shouldFallbackToHarness(
            'deployment_failed',
            true,
            false,
            [['kind' => 'git_branch']],
        ))->toBeFalse()
        ->and(AgentChatRepairStrategy::shouldFallbackToHarness(
            'deployment_failed',
            true,
            true,
            [],
        ))->toBeFalse()
        ->and(AgentChatRepairStrategy::shouldFallbackToHarness(
            'deployment_build_started',
            true,
            false,
            [],
        ))->toBeFalse()
        ->and(AgentChatRepairStrategy::stepsIncludeCorrectiveAction([
            ['name' => 'get_deployment_logs', 'status' => 'done'],
        ]))->toBeFalse()
        ->and(AgentChatRepairStrategy::stepsIncludeCorrectiveAction([
            ['name' => 'get_deployment_logs', 'status' => 'done'],
            ['name' => 'fix_application_host_permissions', 'status' => 'done'],
        ]))->toBeTrue();
});

it('harness executes fix_coolify_base_config_path on read-only logs', function () {
    config(['devforge.agents_auto_fallback' => true]);

    $agent = AiAgent::factory()->deployment()->make(['resource_uuid' => 'app-uuid-ro']);
    $run = Mockery::mock(AiAgentRun::class);
    $run->shouldReceive('appendLog')->andReturnNull();

    $toolkit = Mockery::mock(AgentToolkit::class);
    $toolkit->shouldReceive('execute')
        ->once()
        ->with('get_deployment_logs', Mockery::type('array'))
        ->andReturn([
            'deployments' => [
                ['logs' => [['message' => 'mkdir: cannot create directory ‘/data/coolify/applications/x’: Read-only file system']]],
            ],
        ]);
    $toolkit->shouldReceive('execute')
        ->once()
        ->with('fix_coolify_base_config_path', Mockery::type('array'))
        ->andReturn(['ok' => true]);

    $result = app(AgentRepairHarness::class)->execute(
        $toolkit,
        $agent,
        $run,
        ['application_uuid' => 'app-uuid-ro'],
        'corrige',
    );

    expect($result['steps'])->toHaveCount(2)
        ->and($result['steps'][1]['name'])->toBe('fix_coolify_base_config_path')
        ->and($result['text'])->toContain('Réparation exécutée');
});

it('harness enables skip puppeteer download in advanced settings then redeploys', function () {
    config(['devforge.agents_auto_fallback' => true]);

    $agent = AiAgent::factory()->deployment()->make(['resource_uuid' => 'app-uuid-pup']);
    $run = Mockery::mock(AiAgentRun::class);
    $run->shouldReceive('appendLog')->andReturnNull();

    $toolkit = Mockery::mock(AgentToolkit::class);
    $toolkit->shouldReceive('execute')
        ->once()
        ->with('get_deployment_logs', Mockery::type('array'))
        ->andReturn([
            'deployments' => [
                ['logs' => [['message' => 'Error: Failed to launch the browser process puppeteer']]],
            ],
        ]);
    $toolkit->shouldReceive('execute')
        ->once()
        ->with('update_application_advanced_settings', Mockery::on(fn (array $args): bool => ($args['skip_puppeteer_browser_download'] ?? false) === true))
        ->andReturn(['ok' => true, 'deployment_uuid' => 'dep-1']);

    $result = app(AgentRepairHarness::class)->execute(
        $toolkit,
        $agent,
        $run,
        ['application_uuid' => 'app-uuid-pup'],
        'corrige puppeteer',
    );

    expect($result['steps'])->toHaveCount(2)
        ->and($result['steps'][1]['name'])->toBe('update_application_advanced_settings')
        ->and($result['text'])->toContain('Réparation exécutée');
});

it('harness classifies nginx from chat goal when logs are clean', function () {
    config(['devforge.agents_auto_fallback' => true]);

    $agent = AiAgent::factory()->deployment()->make(['resource_uuid' => 'app-uuid-nginx']);
    $run = Mockery::mock(AiAgentRun::class);
    $run->shouldReceive('appendLog')->andReturnNull();
    $run->shouldReceive('mergeMetadata')->andReturnNull();
    $run->shouldReceive('getAttribute')->with('metadata')->andReturn([]);
    $run->metadata = [];

    $toolkit = Mockery::mock(AgentToolkit::class);
    $toolkit->shouldReceive('execute')
        ->once()
        ->with('get_deployment_logs', Mockery::type('array'))
        ->andReturn([
            'deployments' => [
                ['logs' => [['message' => 'Deployment successful']]],
            ],
        ]);
    $toolkit->shouldReceive('execute')
        ->once()
        ->with('list_application_source', Mockery::type('array'))
        ->andReturn(['entries' => [['name' => 'dist', 'type' => 'dir']]]);
    $toolkit->shouldReceive('execute')
        ->once()
        ->with('update_application_runtime_settings', Mockery::on(
            fn (array $args): bool => ($args['publish_directory'] ?? null) === '/dist'
                && ($args['redeploy'] ?? false) === true
        ))
        ->andReturn(['ok' => true]);

    $result = app(AgentRepairHarness::class)->execute(
        $toolkit,
        $agent,
        $run,
        ['application_uuid' => 'app-uuid-nginx'],
        'https://mf3d.app/ me donne la page nginx',
    );

    expect($result['steps'])->toHaveCount(3)
        ->and($result['steps'][2]['name'])->toBe('update_application_runtime_settings')
        ->and($result['text'])->toContain('publish_directory');
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
        ->and($prompt)->toContain('LANGUE OBLIGATOIRE : français.')
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


it('prefers workspace_brief over the short application scope block', function () {
    $agent = AiAgent::factory()->deployment()->make([
        'name' => 'Deploy Test',
    ]);
    $agent->setRelation('team', \App\Models\Team::factory()->make(['name' => 'Equipe Test']));

    $prompt = app(AgentPromptBuilder::class)->chatSystemPrompt(
        $agent,
        'Corrige l’application',
        [
            'application_uuid' => 'app-uuid-macompta',
            'application_name' => 'macompta',
            'application_status' => 'running:unhealthy',
            'workspace_brief' => "Champ d'application (scope obligatoire pour ce chat) :\nTu es dans le workspace de CETTE application.\n- Application : macompta (app-uuid-macompta)\n- Statut ressource : running:unhealthy\nPour les outils, utilise application_uuid=app-uuid-macompta",
        ],
    );

    expect($prompt)->toContain('workspace de CETTE application')
        ->and($prompt)->toContain('running:unhealthy')
        ->and($prompt)->toContain('application_uuid=app-uuid-macompta')
        ->and($prompt)->not->toContain('Build pack : inconnu');
});
