<?php

use App\Models\AiAgentRun;
use App\Services\DevForge\Agent\AgentTodoService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;

uses(RefreshDatabase::class);

it('stores and replaces todos for a run', function () {
    Cache::flush();
    $run = AiAgentRun::factory()->create();
    $service = new AgentTodoService;

    $items = $service->replace($run, [
        ['content' => 'Lire les logs', 'status' => 'completed'],
        ['content' => 'Corriger publish_directory', 'status' => 'in_progress'],
    ]);

    expect($items)->toHaveCount(2)
        ->and($items[0]['status'])->toBe('completed')
        ->and($service->list($run))->toHaveCount(2);
});

it('upserts a single todo by id', function () {
    Cache::flush();
    $run = AiAgentRun::factory()->create();
    $service = new AgentTodoService;

    $created = $service->upsert($run, 'Diagnostiquer', 'pending', 't1');
    $updated = $service->upsert($run, 'Diagnostiquer OK', 'completed', 't1');

    expect($created['id'])->toBe('t1')
        ->and($updated['status'])->toBe('completed')
        ->and($service->list($run))->toHaveCount(1)
        ->and($service->list($run)[0]['content'])->toBe('Diagnostiquer OK');
});
