<?php

use App\Models\User;
use App\Services\DevForge\Agent\PinokioControlService;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);
    config()->set('devforge.agents_enabled', true);

    $this->user = User::factory()->create();
    $this->team = $this->user->teams()->firstOrFail();
    $this->session = ['currentTeam' => $this->team];
});

it('returns pinokio status payload for current team', function () {
    $this->mock(PinokioControlService::class, function ($mock) {
        $mock->shouldReceive('status')
            ->once()
            ->andReturn([
                'reachable' => true,
                'base_url' => 'http://10.1.0.88:10086',
                'active_model' => 'qwen3-coder-30b-a3b-instruct-q4_k_m.gguf',
                'running' => true,
                'context_size' => 65536,
                'backend_mode' => 'CUDA GPU',
                'gpu' => [
                    'name' => 'NVIDIA GeForce RTX 3090',
                    'vram_used_gb' => 23.1,
                    'vram_total_gb' => 24.0,
                ],
                'models' => [[
                    'filename' => 'qwen3-coder-30b-a3b-instruct-q4_k_m.gguf',
                    'name' => 'Qwen3 Coder 30B MoE',
                    'size' => '17.5 GB',
                    'size_bytes' => 18790481920,
                    'is_active' => true,
                ]],
                'error' => null,
            ]);
    });

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson(route('ai.pinokio.status', ['base_url' => 'http://10.1.0.88:10086']))
        ->assertOk()
        ->assertJsonPath('data.reachable', true)
        ->assertJsonPath('data.active_model', 'qwen3-coder-30b-a3b-instruct-q4_k_m.gguf')
        ->assertJsonPath('data.gpu.name', 'NVIDIA GeForce RTX 3090');
});

it('swaps model via post to pinokio start', function () {
    $this->mock(PinokioControlService::class, function ($mock) {
        $mock->shouldReceive('startModel')
            ->once()
            ->andReturn([
                'ok' => true,
                'message' => 'Modèle chargé avec succès.',
            ]);
    });

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson(route('ai.pinokio.start'), [
            'base_url' => 'http://10.1.0.88:10086',
            'model' => 'qwen3-coder-30b-a3b-instruct-q4_k_m.gguf',
            'context_size' => 65536,
        ])
        ->assertOk()
        ->assertJsonPath('data.ok', true);
});

it('lists demeter pinokio instances for the team', function () {
    $this->mock(PinokioControlService::class, function ($mock) {
        $mock->shouldReceive('listInstances')
            ->once()
            ->andReturn([[
                'id' => 12,
                'name' => 'Demeter (RTX 3090)',
                'base_url' => 'http://10.1.0.88:10086',
                'resolved_base_url' => 'http://10.1.0.88:10086',
                'is_default' => true,
                'model' => 'qwen3',
                'reachable' => true,
            ]]);
    });

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson(route('ai.pinokio.instances'))
        ->assertOk()
        ->assertJsonPath('data.0.name', 'Demeter (RTX 3090)')
        ->assertJsonPath('data.0.reachable', true);
});

it('stops model via post to pinokio stop', function () {
    $this->mock(PinokioControlService::class, function ($mock) {
        $mock->shouldReceive('stopModel')
            ->once()
            ->andReturn([
                'ok' => true,
                'message' => 'Modèle déchargé.',
            ]);
    });

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson(route('ai.pinokio.stop'), [
            'base_url' => 'http://10.1.0.88:10086',
        ])
        ->assertOk()
        ->assertJsonPath('data.ok', true);
});
