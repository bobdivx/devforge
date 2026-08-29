<?php

use App\Models\AiAgent;
use App\Models\Team;
use App\Services\DevForge\Agent\AgentChatRepairStrategy;
use App\Services\DevForge\Agent\AgentDirectives;
use App\Services\DevForge\Agent\AgentPromptBuilder;

it('provides autonomous playbook steps per agent type', function () {
    $playbook = AgentDirectives::autonomousPlaybook('debug');

    expect($playbook)->toBeArray()
        ->and(count($playbook))->toBeGreaterThan(2)
        ->and($playbook[0])->toContain('mission_list');
});

it('builds autonomous initial message with playbook', function () {
    $agent = AiAgent::factory()->debug()->make([
        'name' => 'Debug Test',
        'team_id' => 1,
    ]);
    $agent->setRelation('team', Team::factory()->make(['name' => 'Equipe Test']));

    $message = app(AgentPromptBuilder::class)->autonomousInitialMessage($agent, [], 'manual');

    expect($message)->toContain('DÉMARRAGE AUTONOME')
        ->and($message)->toContain('mission_list')
        ->and($message)->toContain('Playbook');
});

it('builds github-actions webhook context with concrete tool ids', function () {
    $agent = AiAgent::factory()->make([
        'type' => 'github-actions',
        'name' => 'Correcteur CI',
        'team_id' => 1,
    ]);
    $agent->setRelation('team', Team::factory()->make(['name' => 'Equipe Test']));

    $system = app(AgentPromptBuilder::class)->autonomousSystemPrompt($agent);
    $message = app(AgentPromptBuilder::class)->autonomousInitialMessage($agent, [
        'event' => 'github_workflow_run_failed',
        'github_app_uuid' => 'app-uuid-1',
        'owner' => 'acme',
        'repo' => 'demo',
        'workflow_run_id' => 9911,
        'workflow_name' => 'CI',
        'workflow_path' => '.github/workflows/ci.yml',
        'conclusion' => 'failure',
    ], 'event');

    expect($system)->toContain('DevForge')
        ->and($system)->not->toContain('PaaS Coolify')
        ->and($system)->toContain('Ne refuse JAMAIS')
        ->and($message)->toContain('workflow_run_id : 9911')
        ->and($message)->toContain('get_github_workflow_run')
        ->and($message)->toContain('owner : acme')
        ->and($message)->toContain('INTERDIT');
});

it('requires tool usage in autonomy rules', function () {
    expect(AgentDirectives::autonomyRules())->toContain('première action DOIT être un appel d\'outil');
});

it('locks agent output language to french at the start of prompts', function () {
    $agent = AiAgent::factory()->debug()->make([
        'name' => 'Debug Test',
        'team_id' => 1,
    ]);
    $agent->setRelation('team', Team::factory()->make(['name' => 'Equipe Test']));

    $rules = AgentDirectives::outputLanguageRules();
    $system = app(AgentPromptBuilder::class)->autonomousSystemPrompt($agent, [
        'event' => 'deployment_failed',
    ]);

    expect($rules)->toContain('LANGUE OBLIGATOIRE : français.')
        ->and(ltrim(AgentDirectives::autonomyRules()))->toStartWith('LANGUE OBLIGATOIRE : français.')
        ->and(ltrim($system))->toStartWith('LANGUE OBLIGATOIRE : français.')
        ->and(AgentDirectives::containsCjkScript('Échec de l’intervention agent.'))->toBeFalse()
        ->and(AgentDirectives::containsCjkScript('从日志信息来看，构建过程在 astro build 步骤时失败了'))->toBeTrue();
});

it('requires immediate tool usage in chat autonomy rules', function () {
    expect(AgentDirectives::chatAutonomyRules())->toContain('première réponse à une demande actionnable DOIT inclure');
});

it('teaches failure playbook to use upsert_application_env_var and stop after deploy queue', function () {
    $agent = AiAgent::factory()->debug()->make([
        'name' => 'Debug Test',
        'team_id' => 1,
    ]);
    $agent->setRelation('team', Team::factory()->make(['name' => 'Equipe Test']));

    $system = app(AgentPromptBuilder::class)->autonomousSystemPrompt($agent, [
        'event' => 'deployment_failed',
    ]);
    $message = app(AgentPromptBuilder::class)->autonomousInitialMessage($agent, [
        'event' => 'deployment_failed',
        'application_name' => 'starbasefr',
        'application_uuid' => 'app-uuid',
        'deployment_uuid' => 'deploy-uuid',
        'commit' => 'abc123',
        'failure_excerpt' => ['PUPPETEER_SKIP_DOWNLOAD'],
    ], 'event');

    expect($system)->toContain('upsert_application_env_var')
        ->and($system)->toContain('update_application_git_branch')
        ->and($system)->toContain('update_application_runtime_settings')
        ->and($system)->toContain('dist/server/entry.mjs')
        ->and($system)->toContain('fix_application_host_permissions')
        ->and($system)->toContain('Permission denied')
        ->and($system)->toContain('DUMMY_')
        ->and($system)->toContain('ARRÊTE')
        ->and($message)->toContain('upsert_application_env_var')
        ->and($message)->toContain('update_application_git_branch')
        ->and($message)->toContain('update_application_runtime_settings')
        ->and($message)->toContain('dist/server/entry.mjs')
        ->and($message)->toContain('fix_application_host_permissions')
        ->and($message)->toContain('JAMAIS write_application_source sur .env')
        ->and($message)->toContain('STOP');
});

it('nudges failure agents that stop after diagnosis only', function () {
    expect(AgentDirectives::deploymentFailureCorrectionNudgeMessage())
        ->toContain('update_application_runtime_settings')
        ->and(AgentDirectives::deploymentFailureCorrectionNudgeMessage())
        ->toContain('DUMMY_');
});

it('detects host permission diagnoses and provides an ops nudge', function () {
    $text = 'Permission denied lors de l\'ecriture dans data/applications — ownership host.';

    expect(AgentDirectives::isHostPermissionDiagnosis($text))->toBeTrue()
        ->and(AgentDirectives::isHostPermissionDiagnosis('npm ERR! missing script'))->toBeFalse()
        ->and(AgentDirectives::isHostPermissionDiagnosis('Les logs suggèrent un problème lié à la création d\'un fichier .env'))->toBeTrue()
        ->and(AgentDirectives::failureExcerptHasHostPermissionIssue([
            ['message' => 'tee: /media/Docker/AppData/coolify/data/applications/x/.env: Permission denied'],
        ]))->toBeTrue()
        ->and(AgentDirectives::failureExcerptHasHostPermissionIssue([
            ['message' => 'npm ERR! missing script: build'],
        ]))->toBeFalse()
        ->and(AgentDirectives::deploymentFailureHostPermissionNudgeMessage())->toContain('fix_application_host_permissions')
        ->and(AgentDirectives::deploymentFailureHostPermissionNudgeMessage())->toContain('DUMMY_')
        ->and(AgentDirectives::deploymentFailureHostPermissionNudgeMessage())->not->toContain('send_notification sans fix');
});
