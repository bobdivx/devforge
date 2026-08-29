<?php

use App\Models\AiAgent;
use App\Services\DevForge\Agent\AgentChatStatusDirectives;
use App\Services\DevForge\Agent\AgentDirectives;
use App\Services\DevForge\Agent\AgentPromptBuilder;

it('classifies status and non-deployed questions as needing tools', function () {
    expect(AgentChatStatusDirectives::isChatStatusOrFleetIntent('Santé des applications'))->toBeTrue()
        ->and(AgentChatStatusDirectives::isChatStatusOrFleetIntent('Pourquoi tu n\'as pas vu l\'app comme non déployé ?'))->toBeTrue()
        ->and(AgentChatStatusDirectives::isChatStatusOrFleetIntent('Elle est pas déployée ?'))->toBeTrue()
        ->and(AgentChatStatusDirectives::requiresChatTools('Santé des applications'))->toBeTrue()
        ->and(AgentChatStatusDirectives::requiresChatTools('Pourquoi tu n\'as pas vu l\'app comme non déployé ?'))->toBeTrue()
        ->and(AgentChatStatusDirectives::requiresChatTools('Bonjour'))->toBeFalse()
        ->and(AgentDirectives::isChatRepairIntent('Pourquoi le déploiement échoue ?'))->toBeFalse();

    $hint = AgentChatStatusDirectives::chatActionHint('Pourquoi tu n\'as pas vu l\'app comme non déployé ?');
    expect($hint)->toContain('get_resource_status')
        ->and($hint)->toContain('list_resources')
        ->and($hint)->toContain('get_deployment_logs')
        ->and($hint)->toContain('INTERDIT de demander plus de contexte');

    $sante = AgentChatStatusDirectives::chatActionHint('Santé des applications');
    expect($sante)->toContain('get_resource_status')
        ->and($sante)->toContain('list');
});

it('maps failed-vs-running fleet brief in the chat system prompt', function () {
    $agent = AiAgent::factory()->deployment()->make([
        'name' => 'Ollama Flash',
    ]);
    $agent->setRelation('team', \App\Models\Team::factory()->make(['name' => 'Equipe Test']));

    $brief = "Flotte équipe :\n- starbasefr (sb-uuid) statut=running:healthy fqdn=https://starbasefr.example dernier_déploiement=failed at=2026-08-29T18:00:00+00:00 rollback=oui\n";

    $prompt = app(AgentPromptBuilder::class)->chatSystemPrompt(
        $agent,
        'Pourquoi tu n\'as pas vu l\'app comme non déployé ?',
        [
            'fleet_brief' => $brief,
        ],
    );

    expect($prompt)->toContain('starbasefr')
        ->and($prompt)->toContain('running:healthy')
        ->and($prompt)->toContain('failed')
        ->and($prompt)->toContain('déploiement échoué, rollback')
        ->and($prompt)->toContain('LANGUE OBLIGATOIRE : français.')
        ->and($prompt)->toContain('get_resource_status')
        ->and($prompt)->not->toContain('is_static=true');
});
