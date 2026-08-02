<?php

use App\Models\AiAgent;
use App\Models\AiProviderConfig;
use App\Services\DevForge\Agent\LlmProviderFactory;
use App\Services\DevForge\Agent\Providers\OllamaProvider;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

it('uses the agent preferred ollama model override', function () {
    config()->set('devforge.agents_auto_fallback', false);
    config()->set('devforge.agents_provider_probe', false);

    $provider = AiProviderConfig::factory()->ollama()->create([
        'base_url' => 'https://ollama.example.test',
        'model' => 'auto',
    ]);

    $agent = AiAgent::factory()->create([
        'team_id' => $provider->team_id,
        'provider_config_id' => $provider->id,
        'fallback_provider_config_id' => null,
        'metadata' => ['llm_model' => 'qwen2.5:7b'],
    ]);

    $llm = app(LlmProviderFactory::class)->makeForAgent($agent);

    expect($llm)->toBeInstanceOf(OllamaProvider::class)
        ->and($llm->model())->toBe('qwen2.5:7b');
});
