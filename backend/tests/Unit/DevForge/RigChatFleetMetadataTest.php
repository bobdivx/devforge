<?php

use App\Models\AiAgent;
use App\Models\AiAgentMessage;
use App\Models\AiAgentRun;
use App\Models\AiAgentSession;
use App\Models\AiProviderConfig;
use App\Models\User;
use App\Services\DevForge\Agent\AgentPromptBuilder;
use App\Services\DevForge\Agent\RigChatRuntime;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;

uses(RefreshDatabase::class);

it('sends fleet_brief from run metadata in the Rig system preamble', function () {
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
    $brief = "Flotte équipe :\n- starbasefr (sb-uuid) statut=running:healthy fqdn=https://starbasefr.example dernier_déploiement=failed at=2026-08-29T18:00:00+00:00 rollback=oui\n";
    $run = AiAgentRun::factory()->create([
        'agent_id' => $agent->id,
        'status' => 'running',
        'trigger' => 'heartbeat',
        'metadata' => [
            'fleet_brief' => $brief,
            'workspace_brief' => $brief,
        ],
    ]);
    $message = AiAgentMessage::factory()->user()->create([
        'agent_id' => $agent->id,
        'session_id' => $session->id,
        'run_id' => $run->id,
        'content' => 'Pourquoi tu n\'as pas vu l\'app comme non déployé ?',
    ]);

    app(RigChatRuntime::class)->completeFromChat(
        $agent->fresh(),
        $run->fresh(),
        $message->fresh(),
        app(AgentPromptBuilder::class),
    );

    Http::assertSent(function ($request) {
        $data = $request->data();
        $preamble = (string) ($data['preamble'] ?? '');

        return $request->url() === 'http://agent.test/v1/chat'
            && str_contains($preamble, 'starbasefr')
            && str_contains($preamble, 'running:healthy')
            && str_contains($preamble, 'failed')
            && str_contains($preamble, 'déploiement échoué, rollback')
            && str_contains($preamble, 'LANGUE OBLIGATOIRE : français.');
    });
});
