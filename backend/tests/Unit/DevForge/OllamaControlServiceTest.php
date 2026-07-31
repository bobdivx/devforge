<?php

use App\Models\AiProviderConfig;
use App\Models\Team;
use App\Services\DevForge\Agent\OllamaControlService;
use App\Services\DevForge\Agent\OllamaFallbackResolver;
use Illuminate\Support\Facades\Http;

it('parses nvidia-smi csv into gpu inventory via status host probe shape', function () {
    $service = new class(app(OllamaFallbackResolver::class)) extends OllamaControlService
    {
        public function exposeParse(string $csv): array
        {
            $ref = new ReflectionClass(OllamaControlService::class);
            $method = $ref->getMethod('parseNvidiaSmi');
            $method->setAccessible(true);

            return $method->invoke($this, $csv);
        }
    };

    $gpus = $service->exposeParse("0, NVIDIA RTX A2000, 12288, 4096, 8192, 12, 54\n1, NVIDIA RTX A2000, 12288, 0, 12288, 0, 40");

    expect($gpus)->toHaveCount(2)
        ->and($gpus[0]['name'])->toContain('A2000')
        ->and($gpus[0]['memory_total_mib'])->toBe(12288)
        ->and($gpus[0]['memory_used_mib'])->toBe(4096)
        ->and($gpus[0]['utilization_percent'])->toBe(12)
        ->and($gpus[0]['temperature_c'])->toBe(54);
});

it('lists ollama models and running processes when api is reachable', function () {
    Http::fake([
        'http://ollama.test/api/version' => Http::response(['version' => '0.6.0']),
        'http://ollama.test/api/tags' => Http::response([
            'models' => [[
                'name' => 'qwen2.5:7b',
                'size' => 4_000_000_000,
                'details' => [
                    'parameter_size' => '7B',
                    'quantization_level' => 'Q4_K_M',
                    'family' => 'qwen2',
                ],
                'modified_at' => '2026-07-31T00:00:00Z',
            ]],
        ]),
        'http://ollama.test/api/ps' => Http::response([
            'models' => [[
                'name' => 'qwen2.5:7b',
                'size' => 4_000_000_000,
                'size_vram' => 3_500_000_000,
            ]],
        ]),
    ]);

    $team = Team::factory()->make(['id' => 1]);
    $fallback = Mockery::mock(OllamaFallbackResolver::class);
    $fallback->shouldReceive('isReachable')->andReturn(true);
    $fallback->shouldReceive('discover')->never();

    $service = Mockery::mock(OllamaControlService::class, [$fallback])->makePartial();
    $service->shouldAllowMockingProtectedMethods();
    $service->shouldReceive('probeHostCapabilities')->andReturn([
        'server_id' => 0,
        'server_name' => 'localhost',
        'probed' => true,
        'cpu_cores' => 16,
        'memory_total_bytes' => 64 * 1024 ** 3,
        'memory_available_bytes' => 32 * 1024 ** 3,
        'gpus' => [[
            'index' => 0,
            'name' => 'NVIDIA RTX A2000',
            'memory_total_mib' => 12288,
            'memory_used_mib' => 2048,
            'memory_free_mib' => 10240,
            'utilization_percent' => 5,
            'temperature_c' => 42,
        ]],
        'error' => null,
    ]);

    $status = $service->status($team, 'http://ollama.test');

    expect($status['reachable'])->toBeTrue()
        ->and($status['version'])->toBe('0.6.0')
        ->and($status['models'][0]['name'])->toBe('qwen2.5:7b')
        ->and($status['running'][0]['size_vram'])->toBe(3_500_000_000)
        ->and($status['host']['gpus'][0]['name'])->toContain('A2000');
});

it('pulls a model through ollama api', function () {
    Http::fake([
        'http://ollama.test/api/pull' => Http::response(['status' => 'success']),
    ]);

    $team = Team::factory()->make(['id' => 1]);
    $fallback = Mockery::mock(OllamaFallbackResolver::class);
    $fallback->shouldReceive('isReachable')->andReturn(true);

    $service = new OllamaControlService($fallback);
    $result = $service->pull($team, 'qwen2.5:7b', 'http://ollama.test');

    expect($result['ok'])->toBeTrue()
        ->and($result['model'])->toBe('qwen2.5:7b');

    Http::assertSent(fn ($request) => $request->url() === 'http://ollama.test/api/pull'
        && $request['name'] === 'qwen2.5:7b'
        && $request['stream'] === false);
});

it('deletes a model through ollama api using POST', function () {
    Http::fake([
        'http://ollama.test/api/delete' => Http::response('', 200),
    ]);

    $team = Team::factory()->make(['id' => 1]);
    $fallback = Mockery::mock(OllamaFallbackResolver::class);
    $fallback->shouldReceive('isReachable')->andReturn(true);

    $service = new OllamaControlService($fallback);
    $result = $service->delete($team, 'llama3.2:latest', 'http://ollama.test');

    expect($result['ok'])->toBeTrue()
        ->and($result['model'])->toBe('llama3.2:latest');

    Http::assertSent(fn ($request) => $request->url() === 'http://ollama.test/api/delete'
        && $request->method() === 'POST'
        && $request['model'] === 'llama3.2:latest');
});

it('falls back to DELETE when ollama rejects POST with 405', function () {
    Http::fake([
        'http://ollama.test/api/delete' => Http::sequence()
            ->push('Method Not Allowed', 405)
            ->push('', 200),
    ]);

    $team = Team::factory()->make(['id' => 1]);
    $fallback = Mockery::mock(OllamaFallbackResolver::class);
    $fallback->shouldReceive('isReachable')->andReturn(true);

    $service = new OllamaControlService($fallback);
    $result = $service->delete($team, 'qwen2.5:7b', 'http://ollama.test');

    expect($result['ok'])->toBeTrue();

    Http::assertSentCount(2);
});
