<?php

use App\Models\AiAgent;
use App\Models\AiAgentSkill;
use App\Models\Team;
use App\Services\DevForge\Agent\AgentPromptBuilder;
use App\Services\DevForge\Agent\AgentSkillService;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

it('seed builtins and lists catalog for prompt', function () {
    $team = Team::factory()->create();
    $agent = AiAgent::factory()->create(['team_id' => $team->id]);
    $service = app(AgentSkillService::class);

    $rows = $service->listForPrompt($team, $agent);
    $block = $service->formatPromptBlock($rows);

    expect($rows->count())->toBeGreaterThanOrEqual(4)
        ->and($block)->toContain('fix-deploy-502')
        ->and($block)->toContain('skill_load')
        ->and($block)->not->toContain('sync_application_proxy_labels'); // corps non injecté
});

it('loads skill body by slug and writes custom skill', function () {
    $team = Team::factory()->create();
    $agent = AiAgent::factory()->create(['team_id' => $team->id]);
    $service = app(AgentSkillService::class);

    $loaded = $service->findBySlug($team, 'fix-publish-directory', $agent);
    expect($loaded)->toBeInstanceOf(AiAgentSkill::class)
        ->and($loaded->body)->toContain('publish_directory');

    $written = $service->write(
        team: $team,
        slug: 'My Custom Skill!',
        name: 'Procédure custom',
        description: 'Une procédure équipe',
        body: "# Steps\n1. Faire X",
        agent: $agent,
        tags: ['custom'],
    );

    expect($written)->toBeInstanceOf(AiAgentSkill::class)
        ->and($written->slug)->toBe('my-custom-skill')
        ->and($service->findBySlug($team, 'my-custom-skill', $agent)->body)->toContain('Faire X');
});

it('injects skills catalog in autonomous and chat prompts', function () {
    $team = Team::factory()->create(['name' => 'Acme']);
    $agent = AiAgent::factory()->create([
        'team_id' => $team->id,
        'system_prompt' => 'Agent test',
    ]);
    $builder = app(AgentPromptBuilder::class);

    $auto = $builder->autonomousSystemPrompt($agent);
    $chat = $builder->chatSystemPrompt($agent, 'hello');

    expect($auto)->toContain('SKILLS DISPONIBLES')
        ->and($auto)->toContain('fix-deploy-502')
        ->and($chat)->toContain('SKILLS DISPONIBLES');
});
