<?php

use App\Models\AiAgent;
use App\Models\AiAgentMessage;
use App\Models\AiAgentRun;
use App\Models\AiAgentSession;
use App\Models\AiProviderConfig;
use App\Models\PersonalAccessToken;
use App\Models\User;
use App\Services\DevForge\Agent\AgentChatService;
use App\Services\DevForge\Agent\LlmProviderFactory;
use App\Services\DevForge\Agent\RigAgentClient;
use App\Services\DevForge\Agent\RigChatRuntime;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;

uses(RefreshDatabase::class);

it('mints a team-scoped sanctum token then revokes it after chat', function () {
    config([
        'devforge.agent_url' => 'http://agent.test',
        'devforge.agent_mcp_url' => 'http://api:8080/mcp/devforge',
    ]);

    Http::fake([
        'http://agent.test/v1/chat' => Http::response(['text' => 'sidecar-ok']),
    ]);

    $user = User::factory()->create();
    $team = $user->teams()->first();
    $config = AiProviderConfig::factory()->create([
        'team_id' => $team->id,
        'provider' => 'openai',
        'api_key' => 'sk-test-ux',
        'model' => 'gpt-4o-mini',
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
        'bonjour',
        [
            ['role' => 'system', 'content' => 'Tu es un agent.'],
            ['role' => 'user', 'content' => 'bonjour'],
        ],
        $session,
    );

    expect($reply['text'])->toBe('sidecar-ok')
        ->and(PersonalAccessToken::query()->where('name', 'devforge-agent-mcp')->count())->toBe(0);

    Http::assertSent(function ($request) {
        $data = $request->data();

        return $request->url() === 'http://agent.test/v1/chat'
            && ($data['mcp_url'] ?? null) === 'http://api:8080/mcp/devforge'
            && is_string($data['mcp_token'] ?? null)
            && str_contains((string) $data['mcp_token'], '|')
            && ($data['provider'] ?? null) === 'openai'
            && ($data['model'] ?? null) === 'gpt-4o-mini';
    });
});

it('routes processQueuedRun through Rig and never builds the PHP LLM provider', function () {
    config([
        'devforge.agent_url' => 'http://agent.test',
        'devforge.agent_mcp_url' => 'http://api:8080/mcp/devforge',
    ]);

    Http::fake([
        'http://agent.test/v1/chat' => Http::response(['text' => 'sidecar-chat']),
    ]);

    $factory = Mockery::mock(LlmProviderFactory::class);
    $factory->shouldReceive('makeForAgent')->never();
    app()->instance(LlmProviderFactory::class, $factory);

    $user = User::factory()->create();
    $team = $user->teams()->first();
    $config = AiProviderConfig::factory()->create([
        'team_id' => $team->id,
        'provider' => 'openai',
        'api_key' => 'sk-test-ux',
        'model' => 'gpt-4o-mini',
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
    $message = AiAgentMessage::factory()->user()->create([
        'agent_id' => $agent->id,
        'session_id' => $session->id,
        'run_id' => $run->id,
        'content' => 'bonjour sidecar',
    ]);

    $reply = app(AgentChatService::class)->processQueuedRun($agent->fresh(), $run->fresh(), $message->fresh());

    expect($reply->content)->toBe('sidecar-chat')
        ->and($reply->role)->toBe('assistant');

    Http::assertSent(fn ($request) => $request->url() === 'http://agent.test/v1/chat');
});
