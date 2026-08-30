<?php

use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\AiAgentSession;
use App\Models\AiProviderConfig;
use App\Models\User;
use App\Services\DevForge\Agent\AgentEmptyAbsurdReply;
use App\Services\DevForge\Agent\AgentRepairHarness;
use App\Services\DevForge\Agent\Contracts\LlmResponse;
use App\Services\DevForge\Agent\Providers\ResilientLlmProvider;
use App\Services\DevForge\Agent\RigChatRuntime;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;

uses(RefreshDatabase::class);

it('falls back to the secondary provider when the primary returns unfavored', function () {
    $primary = new class implements \App\Services\DevForge\Agent\Contracts\LlmProvider
    {
        public function chat(array $messages, array $tools = []): LlmResponse
        {
            return new LlmResponse(text: 'unfavored', toolCalls: [], tokensUsed: 1, isFinished: true);
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
            return new LlmResponse(text: 'Déploiement relancé.', toolCalls: [], tokensUsed: 1, isFinished: true);
        }

        public function testConnection(): bool
        {
            return true;
        }
    };

    $provider = new ResilientLlmProvider(
        primary: $primary,
        fallback: $fallback,
        primaryLabel: 'ollama/qwen2.5:3b',
        fallbackLabel: 'gemini/gemini-2.5-flash',
    );

    $response = $provider->chat([['role' => 'user', 'content' => 'corrige le déploiement']]);

    expect($response->text)->toBe('Déploiement relancé.')
        ->and($response->text)->not->toBe('unfavored');
});

it('does not surface unfavored from rig chat on a repair intent', function () {
    config([
        'devforge.agent_url' => 'http://agent.test',
        'devforge.agent_mcp_url' => 'http://api:8080/mcp/devforge',
        'devforge.agents_auto_fallback' => true,
    ]);

    Http::fake([
        'http://agent.test/v1/chat' => Http::response(['text' => 'unfavored']),
        '*' => Http::response('', 404),
    ]);

    $harness = Mockery::mock(AgentRepairHarness::class);
    $harness->shouldReceive('execute')
        ->once()
        ->andReturn([
            'text' => 'Réparation exécutée par le harness.',
            'steps' => [['name' => 'get_deployment_logs', 'status' => 'done']],
        ]);
    app()->instance(AgentRepairHarness::class, $harness);

    $user = User::factory()->create();
    $team = $user->teams()->first();
    $config = AiProviderConfig::factory()->create([
        'team_id' => $team->id,
        'provider' => 'ollama',
        'model' => 'qwen2.5:3b',
        'base_url' => 'http://10.1.0.58:11434',
        'is_default' => true,
    ]);
    $agent = AiAgent::factory()->create([
        'team_id' => $team->id,
        'provider_config_id' => $config->id,
    ]);
    $session = AiAgentSession::factory()->create([
        'agent_id' => $agent->id,
        'user_id' => $user->id,
    ]);
    $run = AiAgentRun::factory()->create([
        'agent_id' => $agent->id,
        'status' => 'running',
        'metadata' => [],
    ]);

    $reply = app(RigChatRuntime::class)->complete(
        $agent,
        $run,
        'corrige le déploiement',
        [
            ['role' => 'system', 'content' => 'Tu es un agent.'],
            ['role' => 'user', 'content' => 'corrige le déploiement'],
        ],
        $session,
    );

    expect($reply['text'])->toBe('Réparation exécutée par le harness.')
        ->and($reply['text'])->not->toContain('unfavored');
});

it('retries rig chat with a larger ollama model after an absurd token', function () {
    config([
        'devforge.agent_url' => 'http://agent.test',
        'devforge.agent_mcp_url' => 'http://api:8080/mcp/devforge',
        'devforge.ollama_url' => 'http://10.1.0.58:11434',
    ]);

    Http::fake([
        'http://agent.test/v1/chat' => Http::sequence()
            ->push(['text' => 'unfavored'])
            ->push(['text' => 'Le déploiement a été relancé.']),
        'http://10.1.0.58:11434/api/tags' => Http::response([
            'models' => [
                ['name' => 'qwen2.5:14b'],
                ['name' => 'qwen2.5:3b'],
            ],
        ]),
    ]);

    $user = User::factory()->create();
    $team = $user->teams()->first();
    $config = AiProviderConfig::factory()->create([
        'team_id' => $team->id,
        'provider' => 'ollama',
        'model' => 'qwen2.5:3b',
        'base_url' => 'http://10.1.0.58:11434',
        'is_default' => true,
    ]);
    $agent = AiAgent::factory()->create([
        'team_id' => $team->id,
        'provider_config_id' => $config->id,
    ]);
    $session = AiAgentSession::factory()->create([
        'agent_id' => $agent->id,
        'user_id' => $user->id,
    ]);
    $run = AiAgentRun::factory()->create([
        'agent_id' => $agent->id,
        'status' => 'running',
    ]);

    $reply = app(RigChatRuntime::class)->complete(
        $agent,
        $run,
        'corrige le déploiement',
        [
            ['role' => 'system', 'content' => 'Tu es un agent.'],
            ['role' => 'user', 'content' => 'corrige le déploiement'],
        ],
        $session,
    );

    expect($reply['text'])->toBe('Le déploiement a été relancé.')
        ->and($reply['text'])->not->toContain('unfavored');

    $chatBodies = collect(Http::recorded())
        ->filter(fn ($pair) => str_contains($pair[0]->url(), '/v1/chat'))
        ->map(fn ($pair) => $pair[0]->data())
        ->values();

    expect($chatBodies)->toHaveCount(2)
        ->and($chatBodies[1]['model'] ?? null)->toBe('qwen2.5:14b');
});

it('replaces a leftover absurd token with the french failure message', function () {
    expect(AgentEmptyAbsurdReply::userFacingFailureMessage())->not->toContain('unfavored')
        ->and(AgentEmptyAbsurdReply::isEmptyOrAbsurd('unfavored', false, 'corrige le déploiement'))->toBeTrue();
});
