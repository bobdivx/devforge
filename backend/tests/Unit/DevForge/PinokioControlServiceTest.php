<?php

use App\Services\DevForge\Agent\PinokioControlService;
use Illuminate\Support\Facades\Http;

it('returns status and lists models from Pinokio server', function () {
    Http::fake([
        'http://10.1.0.88:10086/api/health' => Http::response([
            'backend' => [
                'running' => true,
                'ready' => true,
                'settings' => [
                    'model' => 'qwen3-coder-30b-a3b-instruct-q4_k_m.gguf',
                    'contextSize' => 65536,
                ],
                'backendMode' => 'CUDA GPU',
            ],
        ]),
        'http://10.1.0.88:10086/api/telemetry' => Http::response([
            'gpu_name' => 'NVIDIA GeForce RTX 3090',
            'vram_used_gb' => 23.1,
            'vram_total_gb' => 24.0,
        ]),
        'http://10.1.0.88:10086/api/llm/models' => Http::response([
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
    ]);

    $service = new PinokioControlService();
    $status = $service->status('http://10.1.0.88:10086');

    expect($status['reachable'])->toBeTrue()
        ->and($status['running'])->toBeTrue()
        ->and($status['active_model'])->toBe('qwen3-coder-30b-a3b-instruct-q4_k_m.gguf')
        ->and($status['context_size'])->toBe(65536)
        ->and($status['gpu']['name'])->toContain('RTX 3090')
        ->and($status['gpu']['vram_used_gb'])->toBe(23.1)
        ->and($status['models'])->toHaveCount(2)
        ->and($status['models'][0]['is_active'])->toBeTrue()
        ->and($status['models'][1]['is_active'])->toBeFalse();
});

it('starts and swaps a model on Pinokio with optimal GPU flags', function () {
    Http::fake([
        'http://10.1.0.88:10086/api/llm/start' => Http::response([
            'ok' => true,
            'model' => 'qwen3-coder-30b-a3b-instruct-q4_k_m.gguf',
            'status' => 'ready',
        ]),
    ]);

    $service = new PinokioControlService();
    $result = $service->startModel('http://10.1.0.88:10086', 'qwen3-coder-30b-a3b-instruct-q4_k_m.gguf', [
        'context_size' => 65536,
        'batch_size' => 2048,
        'gpu_layers' => -1,
        'flash_attn' => true,
    ]);

    expect($result['ok'])->toBeTrue()
        ->and($result['message'])->toContain('chargé avec succès');
});

it('stops the active model to free GPU VRAM', function () {
    Http::fake([
        'http://10.1.0.88:10086/api/llm/stop' => Http::response(['ok' => true]),
    ]);

    $service = new PinokioControlService();
    $result = $service->stopModel('http://10.1.0.88:10086');

    expect($result['ok'])->toBeTrue()
        ->and($result['message'])->toContain('VRAM GPU libérée');
});
