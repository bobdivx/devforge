<?php

use App\Models\AiProviderConfig;
use App\Models\Team;
use App\Services\DevForge\Agent\PinokioControlService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;

uses(RefreshDatabase::class);

const STUDIO_URL = 'http://10.1.0.88:42065';
const LLM_URL = 'http://10.1.0.88:10086';

it('returns status and lists models from Pinokio studio', function () {
    Http::fake([
        STUDIO_URL.'/api/health' => Http::response([
            'backend' => [
                'running' => true,
                'ready' => true,
                'settings' => [
                    'model' => 'qwen3-coder-30b-a3b-instruct-q4_k_m.gguf',
                    'contextSize' => 49152,
                ],
                'backendMode' => 'CUDA GPU',
            ],
        ]),
        STUDIO_URL.'/api/telemetry' => Http::response([
            'gpu_name' => 'NVIDIA GeForce RTX 3090',
            'vram_used_gb' => 23.1,
            'vram_total_gb' => 24.0,
        ]),
        STUDIO_URL.'/api/llm/models' => Http::response([
            [
                'filename' => 'qwen3-coder-30b-a3b-instruct-q4_k_m.gguf',
                'name' => 'Qwen3 Coder 30B MoE',
                'size' => '17.5 GB',
                'sizeBytes' => 18790481920,
            ],
            [
                'filename' => 'deepseek-r1-distill-qwen-14b-q4_k_m.gguf',
                'name' => 'DeepSeek R1 Distill 14B',
                'size' => '8.9 GB',
                'sizeBytes' => 9556302233,
            ],
        ]),
        STUDIO_URL.'/api/llm/status' => Http::response(['ready' => true]),
    ]);

    $service = new PinokioControlService;
    $status = $service->status(LLM_URL, STUDIO_URL);

    expect($status['reachable'])->toBeTrue()
        ->and($status['running'])->toBeTrue()
        ->and($status['studio_url'])->toBe(STUDIO_URL)
        ->and($status['llm_url'])->toBe(LLM_URL)
        ->and($status['active_model'])->toBe('qwen3-coder-30b-a3b-instruct-q4_k_m.gguf')
        ->and($status['context_size'])->toBe(49152)
        ->and($status['gpu']['name'])->toContain('RTX 3090')
        ->and($status['models'])->toHaveCount(2)
        ->and($status['models'][0]['is_active'])->toBeTrue();
});

it('starts a model via studio API with default 49152 context', function () {
    Http::fake([
        STUDIO_URL.'/api/llm/start' => Http::response([
            'ok' => true,
            'model' => 'qwen3-coder-30b-a3b-instruct-q4_k_m.gguf',
            'status' => 'ready',
        ]),
    ]);

    $service = new PinokioControlService;
    $result = $service->startModel(LLM_URL, 'qwen3-coder-30b-a3b-instruct-q4_k_m.gguf', [
        'studio_url' => STUDIO_URL,
        'gpu_layers' => -1,
        'flash_attn' => true,
    ]);

    expect($result['ok'])->toBeTrue()
        ->and($result['message'])->toContain('chargé avec succès');

    Http::assertSent(function ($request) {
        if (! str_contains($request->url(), '/api/llm/start')) {
            return false;
        }
        $body = $request->data();

        return ($body['contextSize'] ?? null) === PinokioControlService::DEFAULT_CONTEXT_SIZE;
    });
});

it('requires studio URL to start when only LLM port is given without discovery', function () {
    Http::fake();

    $service = new PinokioControlService;
    $result = $service->startModel(LLM_URL, 'model.gguf');

    expect($result['ok'])->toBeFalse()
        ->and($result['error'])->toContain('studio_url');
});

it('stops the active model via studio API', function () {
    Http::fake([
        STUDIO_URL.'/api/llm/stop' => Http::response(['ok' => true]),
    ]);

    $service = new PinokioControlService;
    $result = $service->stopModel(LLM_URL, STUDIO_URL);

    expect($result['ok'])->toBeTrue()
        ->and($result['message'])->toContain('VRAM GPU libérée');
});

it('lists openai providers on Demeter / Pinokio ports as local studio instances', function () {
    Http::fake([
        LLM_URL.'/v1/models' => Http::response(['data' => [['id' => 'qwen3']]]),
        STUDIO_URL.'/api/health' => Http::response(['ok' => true]),
    ]);

    $team = Team::factory()->create();
    $demeter = AiProviderConfig::factory()->create([
        'team_id' => $team->id,
        'provider' => 'openai',
        'name' => 'qwen3',
        'base_url' => LLM_URL.'/v1',
        'studio_base_url' => STUDIO_URL,
        'model' => 'auto',
        'is_default' => true,
    ]);
    AiProviderConfig::factory()->create([
        'team_id' => $team->id,
        'provider' => 'openai',
        'name' => 'Cloud OpenAI',
        'base_url' => 'https://api.openai.com/v1',
        'model' => 'gpt-4o',
    ]);
    AiProviderConfig::factory()->create([
        'team_id' => $team->id,
        'provider' => 'openai',
        'name' => 'Demeter Home',
        'base_url' => 'http://192.168.1.50:8080/v1',
        'model' => 'qwen3',
    ]);

    $service = new PinokioControlService;
    $instances = $service->listInstances($team);

    expect($instances)->toHaveCount(2)
        ->and(collect($instances)->pluck('id')->all())->toContain($demeter->id)
        ->and(collect($instances)->firstWhere('id', $demeter->id)['name'])->toBe('Demeter (RTX 3090)')
        ->and(collect($instances)->firstWhere('id', $demeter->id)['studio_base_url'])->toBe(STUDIO_URL);
});

it('normalizes LLM provider URL with /v1 suffix', function () {
    $service = new PinokioControlService;

    expect($service->normalizeLlmProviderUrl('http://10.1.0.88:10086'))
        ->toBe('http://10.1.0.88:10086/v1')
        ->and($service->normalizeLlmProviderUrl('http://10.1.0.88:42065'))
        ->toBe('http://10.1.0.88:10086/v1');
});

it('includes OpenAI-compatible model ids without .gguf from /v1/models', function () {
    Http::fake([
        STUDIO_URL.'/api/health' => Http::response([
            'backend' => [
                'running' => true,
                'ready' => true,
                'settings' => [
                    'model' => 'qwen3',
                    'contextSize' => 49152,
                ],
            ],
        ]),
        STUDIO_URL.'/api/telemetry' => Http::response([
            'gpu_name' => 'NVIDIA GeForce RTX 3090',
            'vram_used_gb' => 20.0,
            'vram_total_gb' => 24.0,
        ]),
        STUDIO_URL.'/api/llm/models' => Http::response('Not Found', 404),
        STUDIO_URL.'/api/llm/status' => Http::response(['ready' => true]),
        LLM_URL.'/v1/models' => Http::response([
            'data' => [
                ['id' => 'qwen3'],
                ['id' => 'qwen2.5-coder'],
            ],
        ]),
    ]);

    $service = new PinokioControlService;
    $status = $service->status(LLM_URL, STUDIO_URL);

    expect($status['reachable'])->toBeTrue()
        ->and(collect($status['models'])->pluck('filename')->all())->toContain('qwen3', 'qwen2.5-coder');
});

it('discovers studio port when only LLM URL is provided', function () {
    Http::fake([
        'http://10.1.0.88:42065/api/health' => Http::response(['ok' => true]),
        STUDIO_URL.'/api/health' => Http::response([
            'backend' => ['running' => true, 'ready' => true, 'settings' => ['model' => 'test.gguf', 'contextSize' => 49152]],
        ]),
        STUDIO_URL.'/api/telemetry' => Http::response([]),
        STUDIO_URL.'/api/llm/models' => Http::response([]),
        STUDIO_URL.'/api/llm/status' => Http::response(['ready' => true]),
    ]);

    $service = new PinokioControlService;
    $endpoints = $service->resolveEndpoints(LLM_URL);

    expect($endpoints['control'])->toBe(STUDIO_URL)
        ->and($endpoints['llm'])->toBe(LLM_URL);
});
