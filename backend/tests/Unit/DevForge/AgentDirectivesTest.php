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
