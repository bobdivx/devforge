<?php

use App\Services\DevForge\Agent\AgentDirectives;
use App\Services\DevForge\Agent\AgentPromptBuilder;

it('provides autonomous playbook steps per agent type', function () {
    $playbook = AgentDirectives::autonomousPlaybook('debug');

    expect($playbook)->toBeArray()
        ->and(count($playbook))->toBeGreaterThan(2)
        ->and($playbook[0])->toContain('list_resources');
});

it('builds autonomous initial message with playbook', function () {
    $agent = \App\Models\AiAgent::factory()->debug()->make([
        'name' => 'Debug Test',
        'team_id' => 1,
    ]);
    $agent->setRelation('team', \App\Models\Team::factory()->make(['name' => 'Equipe Test']));

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
