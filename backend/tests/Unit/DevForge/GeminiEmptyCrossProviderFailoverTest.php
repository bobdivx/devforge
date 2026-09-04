<?php

use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\AiAgentSession;
use App\Models\AiProviderConfig;
use App\Models\User;
use App\Services\DevForge\Agent\AgentChatEmptyReplyFallback;
use App\Services\DevForge\Agent\AgentEmptyAbsurdReply;
use App\Services\DevForge\Agent\RigChatRuntime;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;

uses(RefreshDatabase::class);

it('orders failover agent fallback then other providers after gemini', function () {
    config(['devforge.agents_auto_fallback' => true]);
    $user = User::factory()->create();
    $team = $user->teams()->first();
    $gemini = AiProviderConfig::factory()->create([
        'team_id' => $team->id, 'provider' => 'gemini', 'model' => 'gemini-2.5-flash',
        'api_key' => 'AIza-test', 'is_default' => true,
    ]);
    $ollama = AiProviderConfig::factory()->create([
        'team_id' => $team->id, 'provider' => 'ollama', 'model' => 'qwen2.5-coder:7b',
        'base_url' => 'http://10.1.0.58:11434', 'is_default' => false,
    ]);
    $openai = AiProviderConfig::factory()->create([
        'team_id' => $team->id, 'provider' => 'openai', 'model' => 'qwen3',
        'base_url' => 'http://10.1.0.20:1234/v1', 'api_key' => 'sk-test', 'is_default' => false,
    ]);
    $agent = AiAgent::factory()->create([
        'team_id' => $team->id,
        'provider_config_id' => $gemini->id,
        'fallback_provider_config_id' => $openai->id,
    ]);
    $ordered = app(AgentChatEmptyReplyFallback::class)->orderedFallbackConfigs($agent, [
        'provider' => 'gemini', 'model' => 'gemini-2.5-flash',
    ]);
    expect($ordered[0]->id)->toBe($openai->id)
        ->and(collect($ordered)->pluck('id')->all())->toContain($ollama->id)
        ->and(AgentEmptyAbsurdReply::userFacingFailureMessage('gemini-2.5-flash', 'gemini'))
            ->not->toContain('petit modèle local');
});

it('retries rig chat when gemini returns empty completion with fallback provider', function () {
    config([
        'devforge.agent_url' => 'http://agent.test',
        'devforge.agent_mcp_url' => 'http://api:8080/mcp/devforge',
        'devforge.agents_auto_fallback' => true,
    ]);
    $err = json_encode(['error' => 'LLM error from generativelanguage.googleapis.com: CompletionError: ResponseError: Response contained no message or tool call (empty).']);
    Http::fake([
        'http://agent.test/v1/chat' => Http::sequence()->push($err, 502)->push(['text' => 'Relancé via Ollama.']),
        '*' => Http::response('', 404),
    ]);
    $user = User::factory()->create();
    $team = $user->teams()->first();
    $gemini = AiProviderConfig::factory()->create([
        'team_id' => $team->id, 'provider' => 'gemini', 'model' => 'gemini-2.5-flash',
        'api_key' => 'AIza-test', 'base_url' => 'https://generativelanguage.googleapis.com/v1beta/openai', 'is_default' => true,
    ]);
    $ollama = AiProviderConfig::factory()->create([
        'team_id' => $team->id, 'provider' => 'ollama', 'model' => 'qwen2.5-coder:7b',
        'base_url' => 'http://10.1.0.58:11434', 'is_default' => false,
    ]);
    $agent = AiAgent::factory()->create([
        'team_id' => $team->id, 'provider_config_id' => $gemini->id, 'fallback_provider_config_id' => $ollama->id,
    ]);
    $session = AiAgentSession::factory()->create(['agent_id' => $agent->id, 'user_id' => $user->id]);
    $run = AiAgentRun::factory()->create(['agent_id' => $agent->id, 'status' => 'running', 'metadata' => []]);
    $reply = app(RigChatRuntime::class)->complete(
        $agent, $run, 'corrige le déploiement',
        [['role' => 'system', 'content' => 'Tu es un agent.'], ['role' => 'user', 'content' => 'corrige le déploiement']],
        $session,
    );
    expect($reply['text'])->toBe('Relancé via Ollama.')->and($reply['text'])->not->toContain('petit modèle local');
    $bodies = collect(Http::recorded())->filter(fn ($p) => str_contains($p[0]->url(), '/v1/chat'))->map(fn ($p) => $p[0]->data())->values();
    expect($bodies)->toHaveCount(2)
        ->and($bodies[0]['provider'] ?? null)->toBe('gemini')
        ->and($bodies[1]['provider'] ?? null)->toBe('ollama');
});
