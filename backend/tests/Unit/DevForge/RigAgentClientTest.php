<?php

use App\Models\AiAgent;
use App\Models\AiProviderConfig;
use App\Services\DevForge\Agent\LlmModelResolver;
use App\Services\DevForge\Agent\RigAgentClient;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;

uses(RefreshDatabase::class);

it('sends optional llm fields on chat', function () {
    config(['devforge.agent_url' => 'http://agent.test']);

    Http::fake([
        'http://agent.test/v1/chat' => Http::response(['text' => 'ok']),
    ]);

    $text = (new RigAgentClient)->chat('hello', 'preamble', 'gpt-4o-mini', [
        'provider' => 'ollama',
        'base_url' => 'http://host.docker.internal:11434',
        'api_key' => null,
        'model' => 'qwen2.5:7b',
    ]);

    expect($text)->toBe('ok');

    Http::assertSent(function ($request) {
        $data = $request->data();

        return $request->url() === 'http://agent.test/v1/chat'
            && ($data['prompt'] ?? null) === 'hello'
            && ($data['preamble'] ?? null) === 'preamble'
            && ($data['provider'] ?? null) === 'ollama'
            && ($data['base_url'] ?? null) === 'http://host.docker.internal:11434'
            && ($data['model'] ?? null) === 'qwen2.5:7b'
            && ! array_key_exists('api_key', $data);
    });
});

it('resolves ollama llm from ux provider settings', function () {
    $config = AiProviderConfig::factory()->ollama()->create([
        'base_url' => 'http://localhost:11434',
        'model' => 'qwen2.5:7b',
    ]);

    $llm = (new RigAgentClient)->llmFromProviderSettings($config);

    expect($llm)->toMatchArray([
        'provider' => 'ollama',
        'base_url' => 'http://host.docker.internal:11434',
        'api_key' => null,
        'model' => 'qwen2.5:7b',
    ]);
});

it('resolves openai compatible llm from the team default provider', function () {
    $config = AiProviderConfig::factory()->create([
        'provider' => 'openai',
        'api_key' => 'sk-test-ux',
        'base_url' => null,
        'model' => 'gpt-4o-mini',
        'is_default' => true,
    ]);

    $llm = (new RigAgentClient)->llmFromProviderSettings(teamId: $config->team_id);

    expect($llm)->toMatchArray([
        'provider' => 'openai',
        'base_url' => 'https://api.openai.com/v1',
        'api_key' => 'sk-test-ux',
        'model' => 'gpt-4o-mini',
    ]);
});

it('prefers the agent llm model override from metadata', function () {
    $config = AiProviderConfig::factory()->gemini()->create([
        'api_key' => 'gem-test',
        'model' => LlmModelResolver::AUTO,
        'is_default' => true,
    ]);
    $agent = AiAgent::factory()->create([
        'team_id' => $config->team_id,
        'provider_config_id' => $config->id,
        'metadata' => ['llm_model' => 'gemini-2.5-flash'],
    ]);

    $llm = (new RigAgentClient)->llmFromProviderSettings(agent: $agent->fresh());

    expect($llm)->toMatchArray([
        'provider' => 'gemini',
        'base_url' => 'https://generativelanguage.googleapis.com/v1beta/openai',
        'api_key' => 'gem-test',
        'model' => 'gemini-2.5-flash',
    ]);
});

it('sends mcp_url, mcp_token and messages on chat', function () {
    config(['devforge.agent_url' => 'http://agent.test']);

    Http::fake([
        'http://agent.test/v1/chat' => Http::response(['text' => 'ok']),
    ]);

    $text = (new RigAgentClient)->chat('hello', null, 'gpt-4o-mini', [
        'provider' => 'openai',
        'api_key' => 'sk-test',
        'model' => 'gpt-4o-mini',
    ], [
        'messages' => [
            ['role' => 'system', 'content' => 'sys'],
            ['role' => 'user', 'content' => 'hello'],
        ],
        'mcp_url' => 'http://api:8080/mcp/devforge',
        'mcp_token' => '99|plain',
    ]);

    expect($text)->toBe('ok');

    Http::assertSent(function ($request) {
        $data = $request->data();

        return $request->url() === 'http://agent.test/v1/chat'
            && ($data['mcp_url'] ?? null) === 'http://api:8080/mcp/devforge'
            && ($data['mcp_token'] ?? null) === '99|plain'
            && ($data['messages'][1]['content'] ?? null) === 'hello';
    });
});

it('is disabled when AGENT_URL is empty', function () {
    config(['devforge.agent_url' => '']);

    expect((new RigAgentClient)->enabled())->toBeFalse();
});
