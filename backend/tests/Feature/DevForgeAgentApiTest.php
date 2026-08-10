<?php

use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\AiProviderConfig;
use App\Models\User;
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

// ── Agents CRUD ──────────────────────────────────────────────────────────────

it('lists agents scoped to current team', function () {
    AiAgent::factory()->count(2)->create(['team_id' => $this->team->id]);

    $otherTeam = \App\Models\Team::factory()->create();
    AiAgent::factory()->create(['team_id' => $otherTeam->id]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/agents')
        ->assertSuccessful()
        ->assertJsonCount(2, 'data')
        ->assertJsonPath('meta.count', 2);
});

it('creates an agent with preferred model override', function () {
    $provider = AiProviderConfig::factory()->ollama()->create([
        'team_id' => $this->team->id,
        'base_url' => 'https://ollama.example.test',
        'model' => 'auto',
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/agents', [
            'type' => 'github-actions',
            'name' => 'CI Watcher',
            'provider_config_id' => $provider->id,
            'preferred_model' => 'qwen2.5:7b',
        ])
        ->assertCreated()
        ->assertJsonPath('data.preferred_model', 'qwen2.5:7b')
        ->assertJsonPath('data.provider.model', 'qwen2.5:7b')
        ->assertJsonPath('data.provider.model_label', 'qwen2.5:7b')
        ->assertJsonPath('data.provider.base_url', 'https://ollama.example.test');

    $agent = AiAgent::where('team_id', $this->team->id)->first();
    expect($agent->preferredLlmModel())->toBe('qwen2.5:7b');
});

it('updates an agent preferred model', function () {
    $provider = AiProviderConfig::factory()->ollama()->create([
        'team_id' => $this->team->id,
        'base_url' => 'https://ollama.example.test',
    ]);
    $agent = AiAgent::factory()->create([
        'team_id' => $this->team->id,
        'provider_config_id' => $provider->id,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/agents/{$agent->uuid}", [
            'preferred_model' => 'llama3.1:8b',
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.preferred_model', 'llama3.1:8b');

    expect($agent->fresh()->preferredLlmModel())->toBe('llama3.1:8b');
});

it('marks a single agent as primary chat per team', function () {
    $first = AiAgent::factory()->create([
        'team_id' => $this->team->id,
        'metadata' => ['is_primary_chat' => true],
    ]);
    $second = AiAgent::factory()->create([
        'team_id' => $this->team->id,
        'metadata' => [],
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/agents/{$second->uuid}", [
            'is_primary_chat' => true,
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.is_primary_chat', true);

    expect($second->fresh()->metadata['is_primary_chat'] ?? false)->toBeTrue()
        ->and($first->fresh()->metadata['is_primary_chat'] ?? false)->toBeFalse();
});

it('lists agents when the session team was not initialized yet', function () {
    AiAgent::factory()->create(['team_id' => $this->team->id]);

    $this->actingAs($this->user)
        ->getJson('/api/devforge/v1/agents')
        ->assertSuccessful()
        ->assertJsonCount(1, 'data');

    expect(session('currentTeam')->id)->toBe($this->team->id);
});

it('creates an agent with valid payload', function () {
    $provider = AiProviderConfig::factory()->create(['team_id' => $this->team->id]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/agents', [
            'type' => 'debug',
            'name' => 'Debug Agent Test',
            'description' => 'Tests the debug flow',
            'schedule_minutes' => 15,
            'provider_config_id' => $provider->id,
        ])
        ->assertCreated()
        ->assertJsonPath('data.name', 'Debug Agent Test')
        ->assertJsonPath('data.type', 'debug')
        ->assertJsonPath('data.status', 'idle');

    $agent = AiAgent::where('team_id', $this->team->id)->first();
    expect($agent)->not->toBeNull()
        ->and($agent->system_prompt)->toContain('débogage')
        ->and($agent->description)->not->toBeEmpty();
});

it('creates an agent with default directives when system_prompt omitted', function () {
    $provider = AiProviderConfig::factory()->create(['team_id' => $this->team->id]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/agents', [
            'type' => 'security',
            'name' => 'Security Agent',
            'provider_config_id' => $provider->id,
        ])
        ->assertCreated()
        ->assertJsonPath('data.type', 'security')
        ->assertJsonStructure(['data' => ['default_directives', 'autonomous_playbook']]);

    expect(AiAgent::first()->system_prompt)->toContain('sécurité');
});

it('forces devforge agents to webhook mode without schedule', function () {
    $provider = AiProviderConfig::factory()->create(['team_id' => $this->team->id]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/agents', [
            'type' => 'devforge',
            'name' => 'DevForge Observer',
            'schedule_minutes' => 30,
            'provider_config_id' => $provider->id,
        ])
        ->assertCreated()
        ->assertJsonPath('data.type', 'devforge')
        ->assertJsonPath('data.schedule_minutes', 0)
        ->assertJsonPath('data.trigger_mode', 'webhook');
});

it('forces github-actions agents to event mode without schedule', function () {
    $provider = AiProviderConfig::factory()->create(['team_id' => $this->team->id]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/agents', [
            'type' => 'github-actions',
            'name' => 'Actions Fixer',
            'schedule_minutes' => 15,
            'provider_config_id' => $provider->id,
        ])
        ->assertCreated()
        ->assertJsonPath('data.type', 'github-actions')
        ->assertJsonPath('data.schedule_minutes', 0)
        ->assertJsonPath('data.trigger_mode', 'webhook')
        ->assertJsonPath('data.is_event_only', true);
});

it('rejects invalid agent type', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/agents', [
            'type' => 'invalid-type',
            'name' => 'Bad Agent',
        ])
        ->assertStatus(422);
});

it('shows agent detail with sub-agent count', function () {
    $parent = AiAgent::factory()->create(['team_id' => $this->team->id]);
    AiAgent::factory()->count(2)->create([
        'team_id' => $this->team->id,
        'parent_agent_id' => $parent->id,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/agents/{$parent->uuid}")
        ->assertSuccessful()
        ->assertJsonPath('data.uuid', $parent->uuid)
        ->assertJsonPath('data.id', $parent->id)
        ->assertJsonPath('data.sub_agents_count', 2)
        ->assertJsonCount(2, 'data.sub_agents');
});

it('lists only top-level agents and reports sub-agent counts', function () {
    $parent = AiAgent::factory()->create(['team_id' => $this->team->id, 'name' => 'Parent']);
    AiAgent::factory()->count(2)->create([
        'team_id' => $this->team->id,
        'parent_agent_id' => $parent->id,
    ]);
    AiAgent::factory()->create(['team_id' => $this->team->id, 'name' => 'Solo']);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/agents')
        ->assertSuccessful()
        ->assertJsonCount(2, 'data')
        ->assertJsonPath('meta.count', 2)
        ->assertJsonFragment(['name' => 'Parent', 'sub_agents_count' => 2])
        ->assertJsonFragment(['name' => 'Solo', 'sub_agents_count' => 0]);
});

it('creates a permanent sub-agent under a parent without schedule', function () {
    $provider = AiProviderConfig::factory()->create(['team_id' => $this->team->id]);
    $parent = AiAgent::factory()->create([
        'team_id' => $this->team->id,
        'type' => 'deployment',
        'provider_config_id' => $provider->id,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/agents', [
            'type' => 'debug',
            'name' => 'Diagnostiqueur',
            'parent_agent_id' => $parent->id,
            'schedule_minutes' => 30,
        ])
        ->assertCreated()
        ->assertJsonPath('data.name', 'Diagnostiqueur')
        ->assertJsonPath('data.parent_agent_id', $parent->id)
        ->assertJsonPath('data.schedule_minutes', 0)
        ->assertJsonPath('data.provider.id', $provider->id);
});

it('rejects nesting a sub-agent under another sub-agent', function () {
    $parent = AiAgent::factory()->create(['team_id' => $this->team->id]);
    $child = AiAgent::factory()->create([
        'team_id' => $this->team->id,
        'parent_agent_id' => $parent->id,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/agents', [
            'type' => 'debug',
            'name' => 'Trop profond',
            'parent_agent_id' => $child->id,
        ])
        ->assertStatus(422)
        ->assertJsonValidationErrors(['parent_agent_id']);
});

it('updates agent name and schedule', function () {
    $agent = AiAgent::factory()->create(['team_id' => $this->team->id]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/agents/{$agent->uuid}", [
            'name' => 'Updated Name',
            'schedule_minutes' => 60,
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.name', 'Updated Name')
        ->assertJsonPath('data.schedule_minutes', 60);
});

it('deletes an agent and its runs', function () {
    $agent = AiAgent::factory()->create(['team_id' => $this->team->id]);
    AiAgentRun::factory()->count(3)->create(['agent_id' => $agent->id]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->deleteJson("/api/devforge/v1/agents/{$agent->uuid}")
        ->assertSuccessful()
        ->assertJsonPath('data.deleted', true);

    expect(AiAgent::find($agent->id))->toBeNull();
    expect(AiAgentRun::where('agent_id', $agent->id)->count())->toBe(0);
});

it('cannot access agents from another team', function () {
    $otherTeam = \App\Models\Team::factory()->create();
    $otherAgent = AiAgent::factory()->create(['team_id' => $otherTeam->id]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/agents/{$otherAgent->uuid}")
        ->assertStatus(404);
});

it('returns 409 when attempting to run an already-running agent', function () {
    $provider = AiProviderConfig::factory()->create(['team_id' => $this->team->id]);
    $agent = AiAgent::factory()->running()->create([
        'team_id' => $this->team->id,
        'provider_config_id' => $provider->id,
    ]);

    AiAgentRun::factory()->create([
        'agent_id' => $agent->id,
        'status' => 'running',
        'started_at' => now(),
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/agents/{$agent->uuid}/run")
        ->assertStatus(409);
});

it('recovers a stale running agent without an active run before queueing a new run', function () {
    \Illuminate\Support\Facades\Queue::fake();

    $provider = AiProviderConfig::factory()->create(['team_id' => $this->team->id]);
    $agent = AiAgent::factory()->running()->create([
        'team_id' => $this->team->id,
        'provider_config_id' => $provider->id,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/agents/{$agent->uuid}/run")
        ->assertStatus(202)
        ->assertJsonPath('data.queued', true);

    expect($agent->fresh()->status)->toBe('running');

    \Illuminate\Support\Facades\Queue::assertPushed(\App\Jobs\Agent\RunAgentJob::class);
});

it('force-releases a stuck running agent when manually launched again', function () {
    \Illuminate\Support\Facades\Queue::fake();

    $provider = AiProviderConfig::factory()->create(['team_id' => $this->team->id]);
    $agent = AiAgent::factory()->running()->create([
        'team_id' => $this->team->id,
        'provider_config_id' => $provider->id,
    ]);

    AiAgentRun::factory()->running()->create([
        'agent_id' => $agent->id,
        'started_at' => now()->subSeconds(10),
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/agents/{$agent->uuid}/run")
        ->assertStatus(202);

    expect($agent->fresh()->status)->toBe('running');
});

it('queues a manual run for an idle agent', function () {
    \Illuminate\Support\Facades\Queue::fake();

    $provider = AiProviderConfig::factory()->create(['team_id' => $this->team->id]);
    $agent = AiAgent::factory()->create([
        'team_id' => $this->team->id,
        'provider_config_id' => $provider->id,
        'status' => 'idle',
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/agents/{$agent->uuid}/run")
        ->assertStatus(202)
        ->assertJsonPath('data.queued', true)
        ->assertJsonPath('data.status', 'running');

    \Illuminate\Support\Facades\Queue::assertPushed(\App\Jobs\Agent\RunAgentJob::class);
});

it('returns a welcome message when the agent has no chat history', function () {
    $provider = AiProviderConfig::factory()->create(['team_id' => $this->team->id]);
    $agent = AiAgent::factory()->create([
        'team_id' => $this->team->id,
        'provider_config_id' => $provider->id,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/agents/{$agent->uuid}/messages")
        ->assertSuccessful()
        ->assertJsonPath('data.0.role', 'assistant')
        ->assertJsonPath('data.0.uuid', 'welcome');
});

it('queues a chat message for asynchronous processing', function () {
    \Illuminate\Support\Facades\Queue::fake();

    $provider = AiProviderConfig::factory()->create(['team_id' => $this->team->id]);
    $agent = AiAgent::factory()->create([
        'team_id' => $this->team->id,
        'provider_config_id' => $provider->id,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/agents/{$agent->uuid}/messages", [
            'content' => 'Quel est l\'état de mes ressources ?',
        ])
        ->assertAccepted()
        ->assertJsonPath('data.status', 'pending')
        ->assertJsonStructure(['data' => ['user' => ['uuid', 'content'], 'run_uuid', 'status']]);

    \Illuminate\Support\Facades\Queue::assertPushed(\App\Jobs\Agent\RunAgentChatJob::class);
});

it('processes a queued chat message and stores an assistant reply', function () {
    Http::fake([
        'generativelanguage.googleapis.com/*' => Http::response([
            'candidates' => [
                [
                    'content' => ['parts' => [['text' => 'Voici l\'état de vos ressources.']]],
                    'finishReason' => 'STOP',
                ],
            ],
            'usageMetadata' => ['totalTokenCount' => 42],
        ]),
    ]);

    $provider = AiProviderConfig::factory()->create(['team_id' => $this->team->id]);
    $agent = AiAgent::factory()->create([
        'team_id' => $this->team->id,
        'provider_config_id' => $provider->id,
    ]);
    $session = \App\Models\AiAgentSession::factory()->create([
        'agent_id' => $agent->id,
        'user_id' => $this->user->id,
    ]);

    \Illuminate\Support\Facades\Queue::fake();

    $queued = app(\App\Services\DevForge\Agent\AgentChatService::class)->queueMessage(
        $agent,
        $session,
        'Quel est l\'état de mes ressources ?',
    );

    app(\App\Services\DevForge\Agent\AgentChatService::class)->processQueuedRun(
        $agent->fresh(),
        $queued['run']->fresh(),
        $queued['user']->fresh(),
    );

    expect(\App\Models\AiAgentMessage::where('agent_id', $agent->id)->count())->toBe(2);
    expect($agent->fresh()->status)->toBe('idle');
});

it('syncs agent status from the latest run when listing them', function () {
    $agent = AiAgent::factory()->create([
        'team_id' => $this->team->id,
        'status' => 'error',
    ]);

    \App\Models\AiAgentRun::factory()->create([
        'agent_id' => $agent->id,
        'status' => 'failed',
        'summary' => 'Erreur récente',
        'finished_at' => now()->subMinutes(5),
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/agents')
        ->assertSuccessful()
        ->assertJsonPath('data.0.status', 'error');

    \App\Models\AiAgentRun::factory()->create([
        'agent_id' => $agent->id,
        'status' => 'completed',
        'summary' => 'Mission terminée',
        'finished_at' => now(),
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/agents')
        ->assertSuccessful()
        ->assertJsonPath('data.0.status', 'idle');

    expect($agent->fresh()->status)->toBe('idle');
});

it('expires stale agent errors after the configured retention window', function () {
    config()->set('devforge.agents_error_retention_hours', 1);

    $agent = AiAgent::factory()->create([
        'team_id' => $this->team->id,
        'status' => 'error',
    ]);

    \App\Models\AiAgentRun::factory()->create([
        'agent_id' => $agent->id,
        'status' => 'failed',
        'summary' => 'Erreur ancienne',
        'finished_at' => now()->subHours(2),
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/agents')
        ->assertSuccessful()
        ->assertJsonPath('data.0.status', 'idle');

    expect($agent->fresh()->status)->toBe('idle');
});

// ── Agent Runs ────────────────────────────────────────────────────────────────

it('lists runs for an agent with pagination', function () {
    $agent = AiAgent::factory()->create(['team_id' => $this->team->id]);
    AiAgentRun::factory()->count(5)->create(['agent_id' => $agent->id]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/agents/{$agent->uuid}/runs")
        ->assertSuccessful()
        ->assertJsonCount(5, 'data')
        ->assertJsonStructure(['data', 'meta' => ['total', 'per_page', 'current_page']]);
});

it('shows a single run with logs', function () {
    $agent = AiAgent::factory()->create(['team_id' => $this->team->id]);
    $run = AiAgentRun::factory()->create([
        'agent_id' => $agent->id,
        'logs' => "[12:00:00] Agent démarré\n[12:00:01] Terminé",
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/agents/{$agent->uuid}/runs/{$run->uuid}")
        ->assertSuccessful()
        ->assertJsonPath('data.uuid', $run->uuid)
        ->assertJsonStructure(['data' => ['logs']]);
});

// ── AI Providers ──────────────────────────────────────────────────────────────

it('lists ai providers scoped to current team', function () {
    AiProviderConfig::factory()->count(2)->create(['team_id' => $this->team->id]);
    AiProviderConfig::factory()->create(); // autre équipe

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/ai/providers')
        ->assertSuccessful()
        ->assertJsonCount(2, 'data');
});

it('creates a gemini provider config', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/ai/providers', [
            'provider' => 'gemini',
            'name' => 'Gemini Flash',
            'api_key' => 'AIzaTestKey',
        ])
        ->assertCreated()
        ->assertJsonPath('data.provider', 'gemini')
        ->assertJsonPath('data.model', 'auto')
        ->assertJsonPath('data.model_label', 'Auto')
        ->assertJsonPath('data.has_api_key', true)
        ->assertJsonMissing(['api_key']); // ne pas exposer la clé

    expect(AiProviderConfig::where('team_id', $this->team->id)->count())->toBe(1);
    expect(AiProviderConfig::where('team_id', $this->team->id)->value('model'))->toBe('auto');
});

it('creates a gemini provider config with explicit model', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/ai/providers', [
            'provider' => 'gemini',
            'name' => 'Gemini Flash',
            'api_key' => 'AIzaTestKey',
            'model' => 'gemini-1.5-flash',
        ])
        ->assertCreated()
        ->assertJsonPath('data.model', 'gemini-1.5-flash');
});

it('rejects gemini provider without api key', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/ai/providers', [
            'provider' => 'gemini',
            'name' => 'Gemini Sans Clé',
            'model' => 'gemini-1.5-flash',
        ])
        ->assertStatus(422);
});

it('creates an ollama provider config', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/ai/providers', [
            'provider' => 'ollama',
            'name' => 'Ollama Local',
            'base_url' => 'http://localhost:11434',
            'model' => 'llama3.2',
        ])
        ->assertCreated()
        ->assertJsonPath('data.provider', 'ollama')
        ->assertJsonPath('data.base_url', 'http://localhost:11434');
});

it('sets a provider as default and unsets others', function () {
    $p1 = AiProviderConfig::factory()->default()->create(['team_id' => $this->team->id]);
    $p2 = AiProviderConfig::factory()->create(['team_id' => $this->team->id]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/ai/providers/{$p2->id}", ['is_default' => true])
        ->assertSuccessful();

    expect($p1->fresh()->is_default)->toBeFalse();
    expect($p2->fresh()->is_default)->toBeTrue();
});

it('updates a provider name and model without replacing the api key', function () {
    $provider = AiProviderConfig::factory()->create([
        'team_id' => $this->team->id,
        'provider' => 'gemini',
        'name' => 'Gemini Flash',
        'api_key' => 'AIzaOriginalKey',
        'model' => 'gemini-1.5-flash',
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/ai/providers/{$provider->id}", [
            'name' => 'Gemini Pro Équipe',
            'model' => 'gemini-2.5-flash',
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.name', 'Gemini Pro Équipe')
        ->assertJsonPath('data.model', 'gemini-2.5-flash')
        ->assertJsonPath('data.has_api_key', true);

    $provider->refresh();
    expect($provider->name)->toBe('Gemini Pro Équipe');
    expect($provider->model)->toBe('gemini-2.5-flash');
    expect($provider->api_key)->toBe('AIzaOriginalKey');
});

it('deletes a provider config', function () {
    $provider = AiProviderConfig::factory()->create(['team_id' => $this->team->id]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->deleteJson("/api/devforge/v1/ai/providers/{$provider->id}")
        ->assertSuccessful();

    expect(AiProviderConfig::find($provider->id))->toBeNull();
});

it('discovers gemini models from the provider api', function () {
    Http::fake([
        'generativelanguage.googleapis.com/v1beta/models*' => Http::response([
            'models' => [
                [
                    'name' => 'models/gemini-3.5-flash',
                    'displayName' => 'Gemini 3.5 Flash',
                    'supportedGenerationMethods' => ['generateContent'],
                ],
            ],
        ]),
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/ai/providers/models', [
            'provider' => 'gemini',
            'api_key' => 'AIzaTestKey',
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.models.0.id', 'gemini-3.5-flash')
        ->assertJsonPath('data.models.0.label', 'Gemini 3.5 Flash');
});

it('rejects gemini model discovery without api key', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/ai/providers/models', [
            'provider' => 'gemini',
        ])
        ->assertStatus(422);
});

it('returns not found when agents feature flag is disabled', function () {
    config()->set('devforge.agents_enabled', false);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/agents')
        ->assertNotFound()
        ->assertJsonPath('message', 'DevForge agents are disabled.');
});
