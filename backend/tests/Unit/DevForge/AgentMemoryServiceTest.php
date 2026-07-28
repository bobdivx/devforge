<?php

use App\Models\AiAgent;
use App\Models\AiAgentMemory;
use App\Models\Team;
use App\Services\DevForge\Agent\AgentMemoryService;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

it('écrit et lit une mémoire agent et shared', function () {
    $team = Team::factory()->create();
    $agent = AiAgent::factory()->create(['team_id' => $team->id]);
    $service = app(AgentMemoryService::class);

    $agentMem = $service->write($team, 'Préférer Preact', AgentMemoryService::SCOPE_AGENT, $agent);
    $sharedMem = $service->write($team, 'Convention git en français', AgentMemoryService::SCOPE_SHARED);

    expect($agentMem)->toBeInstanceOf(AiAgentMemory::class)
        ->and($sharedMem)->toBeInstanceOf(AiAgentMemory::class);

    $rows = $service->listForPrompt($team, $agent);
    $block = $service->formatPromptBlock($rows);

    expect($block)->toContain('Préférer Preact')
        ->and($block)->toContain('Convention git en français')
        ->and($block)->toContain('MÉMOIRE AGENT')
        ->and($block)->toContain('MÉMOIRE PARTAGÉE');
});

it('refuse une mémoire projet sans resource_uuid', function () {
    $team = Team::factory()->create();
    $service = app(AgentMemoryService::class);

    $result = $service->write($team, 'fait projet', AgentMemoryService::SCOPE_PROJECT);

    expect($result)->toBeArray()
        ->and($result['error'] ?? '')->toContain('resource_uuid');
});

it('parseScope normalise les alias', function () {
    $service = app(AgentMemoryService::class);

    expect($service->parseScope('org'))->toBe('shared')
        ->and($service->parseScope('projet'))->toBe('project')
        ->and($service->parseScope('self'))->toBe('agent');
});
