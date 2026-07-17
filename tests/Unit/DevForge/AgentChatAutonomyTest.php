<?php

use App\Models\AiAgent;
use App\Services\DevForge\Agent\AgentDirectives;
use App\Services\DevForge\Agent\AgentPromptBuilder;

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
