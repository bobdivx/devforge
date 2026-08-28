<?php

use App\Models\AiProviderConfig;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);
    config()->set('devforge.agents_enabled', true);
    config()->set('devforge.agent_url', 'http://agent.test');
    config()->set('devforge.agent_mcp_url', 'http://mcp.test/mcp/devforge');
    config()->set('devforge.agents_mcp_client_enabled', false);

    $this->user = User::factory()->create();
    $this->team = $this->user->teams()->firstOrFail();
    $this->session = ['currentTeam' => $this->team];
});

it('runs agent diagnostics without leaking api keys', function () {
    AiProviderConfig::factory()->ollama()->create([
        'team_id' => $this->team->id,
        'name' => 'Ollama LAN',
        'base_url' => 'http://10.1.0.58:11434',
        'model' => 'qwen2.5:7b',
    ]);
    AiProviderConfig::factory()->gemini()->create([
        'team_id' => $this->team->id,
        'name' => 'Gemini équipe',
        'api_key' => 'secret-gemini-key-xyz',
    ]);

    Http::fake([
        'http://agent.test/health' => Http::response([
            'ok' => true,
            'service' => 'devforge-agent',
            'provider' => 'ollama',
            'model' => 'qwen2.5:7b',
        ]),
        'http://mcp.test/mcp/devforge' => Http::response(['jsonrpc' => '2.0', 'id' => 1, 'result' => [
            'protocolVersion' => '2024-11-05',
            'capabilities' => [],
            'serverInfo' => ['name' => 'devforge', 'version' => '1'],
        ]]),
        'http://10.1.0.58:11434/api/tags' => Http::response([
            'models' => [['name' => 'qwen2.5:7b']],
        ]),
        'http://10.1.0.58:11434/v1/chat/completions' => Http::response([
            'choices' => [['message' => ['content' => 'OK']]],
        ]),
        'generativelanguage.googleapis.com/*' => Http::response([
            'data' => [['id' => 'gemini-2.5-flash']],
        ]),
    ]);

    $response = $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/ai/diagnostics')
        ->assertSuccessful()
        ->assertJsonMissing(['secret-gemini-key-xyz'])
        ->assertJsonMissing(['api_key']);

    $checks = $response->json('data.checks');
    expect($checks)->toBeArray()->not->toBeEmpty();
    expect(collect($checks)->pluck('id'))->toContain('rig-health')
        ->toContain('mcp-devforge');
    expect(collect($checks)->pluck('kind')->unique()->values()->all())
        ->toContain('rig')
        ->toContain('mcp')
        ->toContain('ollama')
        ->toContain('gemini');
});

it('flags ollama cloudflare 502 on tags', function () {
    AiProviderConfig::factory()->ollama()->create([
        'team_id' => $this->team->id,
        'name' => 'Ollama tunnel',
        'base_url' => 'https://ollama.briseteia.me',
    ]);

    Http::fake([
        'http://agent.test/health' => Http::response(['ok' => true, 'service' => 'devforge-agent']),
        'http://mcp.test/mcp/devforge' => Http::response('', 401),
        'https://ollama.briseteia.me/api/tags' => Http::response('Bad Gateway', 502),
    ]);

    $response = $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/ai/diagnostics', ['check' => 'ollama'])
        ->assertSuccessful();

    $check = collect($response->json('data.checks'))->firstWhere('kind', 'ollama');
    expect($check['status'])->toBe('fail')
        ->and($check['message'])->toContain('502')
        ->and($check['target'])->toBe('ollama.briseteia.me')
        ->and(json_encode($response->json()))->not->toContain('secret');
});

it('reports gemini 429 as a clear warning', function () {
    AiProviderConfig::factory()->gemini()->create([
        'team_id' => $this->team->id,
        'api_key' => 'secret-gemini-key-xyz',
    ]);

    Http::fake([
        'generativelanguage.googleapis.com/*' => Http::response(['error' => ['message' => 'quota']], 429),
    ]);

    $response = $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/ai/diagnostics', ['check' => 'gemini'])
        ->assertSuccessful()
        ->assertJsonMissing(['secret-gemini-key-xyz']);

    $check = collect($response->json('data.checks'))->firstWhere('kind', 'gemini');
    expect($check['status'])->toBe('warn')
        ->and($check['http_status'])->toBe(429)
        ->and($check['message'])->toContain('429');
});

it('rejects guests', function () {
    $this->postJson('/api/devforge/v1/ai/diagnostics')
        ->assertUnauthorized();
});
