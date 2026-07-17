<?php

use App\Models\AiAgent;
use App\Models\AiProviderConfig;
use App\Models\Team;
use App\Services\DevForge\Agent\Contracts\LlmResponse;
use App\Services\DevForge\Agent\LlmProviderFactory;
use App\Services\DevForge\Agent\Providers\ResilientLlmProvider;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

it('falls back to a secondary provider when the primary is overloaded', function () {
    $primary = new class implements \App\Services\DevForge\Agent\Contracts\LlmProvider
    {
        public function chat(array $messages, array $tools = []): LlmResponse
        {
            throw new RuntimeException('Gemini API error [503]: high demand');
        }

        public function testConnection(): bool
        {
            return true;
        }
    };

    $fallback = new class implements \App\Services\DevForge\Agent\Contracts\LlmProvider
    {
        public function chat(array $messages, array $tools = []): LlmResponse
        {
            return new LlmResponse(text: 'réponse secours', toolCalls: [], tokensUsed: 1, isFinished: true);
        }

        public function testConnection(): bool
        {
            return true;
        }
    };

    $provider = new ResilientLlmProvider(
        primary: $primary,
        fallback: $fallback,
        primaryLabel: 'gemini/gemini-2.5-flash',
        fallbackLabel: 'ollama/llama3.2',
    );

    $response = $provider->chat([['role' => 'user', 'content' => 'test']]);

    expect($response->text)->toBe('réponse secours');
});

it('falls back when gemini quota message is raised', function () {
    $primary = new class implements \App\Services\DevForge\Agent\Contracts\LlmProvider
    {
        public function chat(array $messages, array $tools = []): LlmResponse
        {
            throw new RuntimeException('Quota Gemini atteint sur les modèles chat essayés (gemini-2.5-flash).');
        }

        public function testConnection(): bool
        {
            return true;
        }
    };

    $fallback = new class implements \App\Services\DevForge\Agent\Contracts\LlmProvider
    {
        public function chat(array $messages, array $tools = []): LlmResponse
        {
            return new LlmResponse(text: 'via ollama', toolCalls: [], tokensUsed: 1, isFinished: true);
        }

        public function testConnection(): bool
        {
            return true;
        }
    };

    $provider = new ResilientLlmProvider(
        primary: $primary,
        fallback: $fallback,
        primaryLabel: 'gemini/Auto',
        fallbackLabel: 'ollama/llama3.2',
    );

    expect($provider->chat([['role' => 'user', 'content' => 'test']])->text)->toBe('via ollama');
});

it('resolves an automatic fallback provider for an agent', function () {
    config()->set('devforge.agents_auto_fallback', true);

    $team = Team::factory()->create();
    $primary = AiProviderConfig::factory()->create([
        'team_id' => $team->id,
        'provider' => 'gemini',
        'model' => 'gemini-2.5-flash',
    ]);
    $secondary = AiProviderConfig::factory()->create([
        'team_id' => $team->id,
        'provider' => 'ollama',
        'model' => 'llama3.2',
        'base_url' => 'http://localhost:11434',
    ]);

    $agent = AiAgent::factory()->create([
        'team_id' => $team->id,
        'provider_config_id' => $primary->id,
        'fallback_provider_config_id' => null,
    ]);

    $provider = app(LlmProviderFactory::class)->makeForAgent($agent);

    expect($provider)->toBeInstanceOf(ResilientLlmProvider::class);
    expect($secondary->id)->not->toBe($primary->id);
});

it('uses an explicit fallback provider when configured on the agent', function () {
    $team = Team::factory()->create();
    $primary = AiProviderConfig::factory()->create(['team_id' => $team->id, 'provider' => 'gemini']);
    $explicit = AiProviderConfig::factory()->create([
        'team_id' => $team->id,
        'provider' => 'gemini',
        'model' => 'gemini-2.0-flash',
    ]);
    AiProviderConfig::factory()->create([
        'team_id' => $team->id,
        'provider' => 'ollama',
        'base_url' => 'http://localhost:11434',
    ]);

    $agent = AiAgent::factory()->create([
        'team_id' => $team->id,
        'provider_config_id' => $primary->id,
        'fallback_provider_config_id' => $explicit->id,
    ]);

    $provider = app(LlmProviderFactory::class)->makeForAgent($agent);

    expect($provider)->toBeInstanceOf(ResilientLlmProvider::class);
});
