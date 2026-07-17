<?php

use App\Models\AiAgent;
use App\Models\Team;
use App\Services\DevForge\Agent\AgentDirectives;
use App\Services\DevForge\Agent\AgentPromptBuilder;

it('provides autonomous playbook steps per agent type', function () {
    $playbook = AgentDirectives::autonomousPlaybook('debug');

    expect($playbook)->toBeArray()
        ->and(count($playbook))->toBeGreaterThan(2)
        ->and($playbook[0])->toContain('list_resources');
});

it('builds autonomous initial message with playbook', function () {
    $agent = AiAgent::factory()->debug()->make([
        'name' => 'Debug Test',
        'team_id' => 1,
    ]);
    $agent->setRelation('team', Team::factory()->make(['name' => 'Equipe Test']));

    $message = app(AgentPromptBuilder::class)->autonomousInitialMessage($agent, [], 'manual');

    expect($message)->toContain('DÉMARRAGE AUTONOME')
        ->and($message)->toContain('list_resources')
        ->and($message)->toContain('Playbook');
});

it('requires tool usage in autonomy rules', function () {
    expect(AgentDirectives::autonomyRules())->toContain('première action DOIT être un appel d\'outil');
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
        ->and($system)->toContain('Permission denied')
        ->and($system)->toContain('ARRÊTE')
        ->and($message)->toContain('upsert_application_env_var')
        ->and($message)->toContain('JAMAIS write_application_source sur .env')
        ->and($message)->toContain('STOP');
});
