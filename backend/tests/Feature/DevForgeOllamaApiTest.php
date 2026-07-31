<?php

use App\Models\User;
use App\Services\DevForge\Agent\OllamaControlService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);
    config()->set('devforge.agents_enabled', true);

    $this->user = User::factory()->create();
    $this->team = $this->user->teams()->firstOrFail();
    $this->session = ['currentTeam' => $this->team];
});

it('returns ollama status payload for the current team', function () {
    $this->mock(OllamaControlService::class, function ($mock) {
        $mock->shouldReceive('status')
            ->once()
            ->andReturn([
                'reachable' => true,
                'base_url' => 'http://ollama.test',
                'provider_id' => 12,
                'provider_name' => 'Ollama NAS',
                'version' => '0.6.0',
                'models' => [[
                    'name' => 'qwen2.5:7b',
                    'size' => 1000,
                    'parameter_size' => '7B',
                    'quantization' => 'Q4_K_M',
                    'family' => 'qwen2',
                    'modified_at' => null,
                ]],
                'running' => [],
                'host' => [
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
                        'memory_used_mib' => 1024,
                        'memory_free_mib' => 11264,
                        'utilization_percent' => 3,
                        'temperature_c' => 41,
                    ]],
                    'error' => null,
                ],
                'error' => null,
            ]);
    });

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/ai/ollama?provider_id=12')
        ->assertSuccessful()
        ->assertJsonPath('data.reachable', true)
        ->assertJsonPath('data.provider_name', 'Ollama NAS')
        ->assertJsonPath('data.models.0.name', 'qwen2.5:7b')
        ->assertJsonPath('data.host.gpus.0.name', 'NVIDIA RTX A2000');
});

it('lists configured ollama instances for the team', function () {
    \App\Models\AiProviderConfig::factory()->ollama()->create([
        'team_id' => $this->team->id,
        'name' => 'Ollama PC 3090',
        'base_url' => 'https://ollama.briseteia.me',
        'is_default' => true,
    ]);
    \App\Models\AiProviderConfig::factory()->ollama()->create([
        'team_id' => $this->team->id,
        'name' => 'Ollama NAS A2000',
        'base_url' => 'https://ollamanas.briseteia.me',
        'is_default' => false,
    ]);

    $this->mock(OllamaControlService::class, function ($mock) {
        $mock->shouldReceive('listInstances')->once()->andReturn([
            [
                'id' => 1,
                'name' => 'Ollama PC 3090',
                'base_url' => 'https://ollama.briseteia.me',
                'resolved_base_url' => 'https://ollama.briseteia.me',
                'is_default' => true,
                'model' => 'auto',
                'reachable' => true,
            ],
            [
                'id' => 2,
                'name' => 'Ollama NAS A2000',
                'base_url' => 'https://ollamanas.briseteia.me',
                'resolved_base_url' => 'https://ollamanas.briseteia.me',
                'is_default' => false,
                'model' => 'auto',
                'reachable' => true,
            ],
        ]);
    });

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/ai/ollama/instances')
        ->assertSuccessful()
        ->assertJsonCount(2, 'data')
        ->assertJsonPath('data.0.name', 'Ollama PC 3090');
});

it('pulls an ollama model via api', function () {
    Http::fake([
        'http://ollama.test/api/pull' => Http::response(['status' => 'success']),
    ]);

    $this->mock(OllamaControlService::class, function ($mock) {
        $mock->shouldReceive('pull')
            ->once()
            ->withArgs(fn ($team, $model, $baseUrl) => $model === 'qwen2.5:7b')
            ->andReturn(['ok' => true, 'model' => 'qwen2.5:7b', 'status' => 'success', 'error' => null]);
    });

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/ai/ollama/pull', [
            'model' => 'qwen2.5:7b',
            'base_url' => 'http://ollama.test',
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.ok', true)
        ->assertJsonPath('data.model', 'qwen2.5:7b');
});

it('sets the default model on an ollama provider', function () {
    $provider = \App\Models\AiProviderConfig::factory()->ollama()->create([
        'team_id' => $this->team->id,
        'base_url' => 'https://ollama.example.test',
        'model' => 'auto',
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson('/api/devforge/v1/ai/ollama/provider-model', [
            'provider_id' => $provider->id,
            'model' => 'qwen2.5:7b',
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.model', 'qwen2.5:7b');

    expect($provider->fresh()->model)->toBe('qwen2.5:7b');
});

it('assigns an ollama instance and model to an agent', function () {
    $provider = \App\Models\AiProviderConfig::factory()->ollama()->create([
        'team_id' => $this->team->id,
        'name' => 'Ollama PC 3090',
        'base_url' => 'https://ollama.briseteia.me',
    ]);
    $agent = \App\Models\AiAgent::factory()->create([
        'team_id' => $this->team->id,
        'provider_config_id' => null,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/ai/ollama/assign-agent', [
            'agent_uuid' => $agent->uuid,
            'provider_id' => $provider->id,
            'model' => 'qwen2.5:7b',
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.preferred_model', 'qwen2.5:7b')
        ->assertJsonPath('data.provider_id', $provider->id);

    $agent->refresh();
    expect($agent->provider_config_id)->toBe($provider->id)
        ->and($agent->preferredLlmModel())->toBe('qwen2.5:7b');
});

it('deletes an ollama model via post endpoint', function () {
    $this->mock(OllamaControlService::class, function ($mock) {
        $mock->shouldReceive('delete')
            ->once()
            ->withArgs(fn ($team, $model, $baseUrl) => $model === 'llama3.2:latest')
            ->andReturn(['ok' => true, 'model' => 'llama3.2:latest', 'error' => null]);
    });

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/ai/ollama/models/delete', [
            'model' => 'llama3.2:latest',
            'base_url' => 'http://ollama.test',
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.ok', true)
        ->assertJsonPath('data.model', 'llama3.2:latest');
});
