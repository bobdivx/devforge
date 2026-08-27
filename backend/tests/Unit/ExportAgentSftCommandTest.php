<?php

namespace Tests\Unit;

use App\Models\AiAgent;
use App\Models\AiAgentMessage;
use App\Models\AiAgentRun;
use App\Models\AiAgentSession;
use App\Models\Team;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ExportAgentSftCommandTest extends TestCase
{
    use RefreshDatabase;

    public function test_exports_chatml_jsonl_matching_fixture_for_relanceur_traces(): void
    {
        $team = Team::factory()->create();
        $agent = AiAgent::factory()->create([
            'team_id' => $team->id,
            'type' => 'devforge',
            'name' => 'Relanceur de déploiements',
            'system_prompt' => 'Tu es l\'agent Relanceur — un opérateur DevOps autonome.',
            'metadata' => ['default_agent' => true, 'role' => 'deploy_operator'],
        ]);
        $session = AiAgentSession::factory()->legacy()->create(['agent_id' => $agent->id]);
        $run = AiAgentRun::factory()->create([
            'agent_id' => $agent->id,
            'session_id' => $session->id,
            'status' => 'completed',
            'finished_at' => now(),
        ]);

        AiAgentMessage::factory()->create([
            'agent_id' => $agent->id,
            'session_id' => $session->id,
            'run_id' => $run->id,
            'role' => 'user',
            'content' => "Contexte:\nApplication sonozz, dernier déploiement failed.",
            'metadata' => ['kind' => 'context'],
        ]);
        AiAgentMessage::factory()->user()->create([
            'agent_id' => $agent->id,
            'session_id' => $session->id,
            'run_id' => $run->id,
            'content' => 'Le déploiement de sonozz a échoué (exit 1, nixpacks).',
        ]);
        AiAgentMessage::factory()->assistant()->create([
            'agent_id' => $agent->id,
            'session_id' => $session->id,
            'run_id' => $run->id,
            'content' => 'Je vais lire les logs, formuler une seule hypothèse, puis appliquer un correctif minimal.',
        ]);

        $this->seedNoiseTraces($team);

        $path = storage_path('app/qlora/test-agent-sft.jsonl');
        $this->artisan('devforge:export-agent-sft', ['--path' => $path])
            ->assertSuccessful();

        $this->assertFileExists($path);
        $lines = array_values(array_filter(explode("\n", trim((string) file_get_contents($path)))));
        $this->assertCount(1, $lines, 'Default export should keep Relanceur traces only.');

        $exported = json_decode($lines[0], true, 512, JSON_THROW_ON_ERROR);
        $fixture = json_decode(
            trim((string) file_get_contents(base_path('tests/fixtures/qlora/chatml-sft.jsonl'))),
            true,
            512,
            JSON_THROW_ON_ERROR,
        );

        $this->assertSame($fixture, $exported);
        $this->assertSame(['system', 'user', 'assistant'], array_column($exported['messages'], 'role'));
    }

    public function test_skips_cancelled_failed_and_empty_runs(): void
    {
        $team = Team::factory()->create();
        $agent = AiAgent::factory()->create([
            'team_id' => $team->id,
            'type' => 'deployment',
            'name' => 'Relanceur',
        ]);

        $cancelled = AiAgentRun::factory()->create(['agent_id' => $agent->id, 'status' => 'cancelled']);
        $this->seedTurn($agent, $cancelled, 'user cancelled', 'should skip');

        $failed = AiAgentRun::factory()->failed()->create(['agent_id' => $agent->id]);
        $this->seedTurn($agent, $failed, 'user failed', 'should skip');

        AiAgentRun::factory()->create(['agent_id' => $agent->id, 'status' => 'completed']);

        $path = storage_path('app/qlora/empty-skip.jsonl');
        $this->artisan('devforge:export-agent-sft', ['--path' => $path, '--team' => (string) $team->id])
            ->assertSuccessful();

        $body = trim((string) file_get_contents($path));
        $this->assertSame('', $body);
    }

    public function test_all_flag_exports_every_team_and_non_relanceur_types(): void
    {
        $teamA = Team::factory()->create();
        $teamB = Team::factory()->create();

        $relanceur = AiAgent::factory()->create([
            'team_id' => $teamA->id,
            'type' => 'devforge',
            'name' => 'Relanceur de déploiements',
            'metadata' => ['role' => 'deploy_operator'],
        ]);
        $watch = AiAgent::factory()->create([
            'team_id' => $teamB->id,
            'type' => 'tech-watch',
            'name' => 'Veille',
        ]);

        $this->seedTurn(
            $relanceur,
            AiAgentRun::factory()->create(['agent_id' => $relanceur->id, 'status' => 'completed']),
            'fix deploy',
            'one change then verify',
        );
        $this->seedTurn(
            $watch,
            AiAgentRun::factory()->create(['agent_id' => $watch->id, 'status' => 'completed']),
            'scan apps',
            'opened a kanban mission',
        );

        $defaultPath = storage_path('app/qlora/default.jsonl');
        $this->artisan('devforge:export-agent-sft', ['--path' => $defaultPath])->assertSuccessful();
        $this->assertCount(1, $this->jsonl($defaultPath));

        $allPath = storage_path('app/qlora/all.jsonl');
        $this->artisan('devforge:export-agent-sft', ['--path' => $allPath, '--all' => true])->assertSuccessful();
        $this->assertCount(2, $this->jsonl($allPath));
    }

    public function test_team_and_limit_options(): void
    {
        $team = Team::factory()->create();
        $other = Team::factory()->create();
        $agent = AiAgent::factory()->debug()->create([
            'team_id' => $team->id,
            'name' => 'Debug Relanceur',
        ]);
        $otherAgent = AiAgent::factory()->deployment()->create([
            'team_id' => $other->id,
            'name' => 'Relanceur autre team',
        ]);

        foreach (range(1, 3) as $i) {
            $this->seedTurn(
                $agent,
                AiAgentRun::factory()->create([
                    'agent_id' => $agent->id,
                    'status' => 'completed',
                    'finished_at' => now()->subMinutes(4 - $i),
                ]),
                "user {$i}",
                "assistant {$i}",
            );
        }
        $this->seedTurn(
            $otherAgent,
            AiAgentRun::factory()->create(['agent_id' => $otherAgent->id, 'status' => 'completed']),
            'other team',
            'should be filtered',
        );

        $path = storage_path('app/qlora/limited.jsonl');
        $this->artisan('devforge:export-agent-sft', [
            '--path' => $path,
            '--team' => (string) $team->id,
            '--limit' => '2',
        ])->assertSuccessful();

        $this->assertCount(2, $this->jsonl($path));
    }

    public function test_matches_debug_type_and_deploy_operator_role(): void
    {
        $team = Team::factory()->create();
        $debug = AiAgent::factory()->create([
            'team_id' => $team->id,
            'type' => 'debug',
            'name' => 'Debugger',
        ]);
        $operator = AiAgent::factory()->create([
            'team_id' => $team->id,
            'type' => 'worker',
            'name' => 'Ops',
            'metadata' => ['role' => 'deploy_operator'],
        ]);

        $this->seedTurn(
            $debug,
            AiAgentRun::factory()->create(['agent_id' => $debug->id, 'status' => 'completed']),
            'why is it down',
            'checking logs',
        );
        $this->seedTurn(
            $operator,
            AiAgentRun::factory()->create(['agent_id' => $operator->id, 'status' => 'completed']),
            'redeploy please',
            'redeployed after one fix',
        );

        $path = storage_path('app/qlora/preferred.jsonl');
        $this->artisan('devforge:export-agent-sft', ['--path' => $path])->assertSuccessful();
        $this->assertCount(2, $this->jsonl($path));
    }

    private function seedNoiseTraces(Team $team): void
    {
        $watch = AiAgent::factory()->create([
            'team_id' => $team->id,
            'type' => 'tech-watch',
            'name' => 'Veille',
        ]);
        $this->seedTurn(
            $watch,
            AiAgentRun::factory()->create(['agent_id' => $watch->id, 'status' => 'completed']),
            'scan',
            'mission created',
        );

        $failedAgent = AiAgent::factory()->create([
            'team_id' => $team->id,
            'type' => 'deployment',
            'name' => 'Relanceur failed',
        ]);
        $failed = AiAgentRun::factory()->failed()->create(['agent_id' => $failedAgent->id]);
        $this->seedTurn($failedAgent, $failed, 'failed user', 'failed assistant');
    }

    private function seedTurn(AiAgent $agent, AiAgentRun $run, string $user, string $assistant): void
    {
        $session = AiAgentSession::factory()->legacy()->create(['agent_id' => $agent->id]);
        $run->update(['session_id' => $session->id]);

        AiAgentMessage::factory()->user()->create([
            'agent_id' => $agent->id,
            'session_id' => $session->id,
            'run_id' => $run->id,
            'content' => $user,
        ]);
        AiAgentMessage::factory()->assistant()->create([
            'agent_id' => $agent->id,
            'session_id' => $session->id,
            'run_id' => $run->id,
            'content' => $assistant,
        ]);
    }

    /** @return list<array<string, mixed>> */
    private function jsonl(string $path): array
    {
        $raw = trim((string) file_get_contents($path));
        if ($raw === '') {
            return [];
        }

        return array_map(
            fn (string $line) => json_decode($line, true, 512, JSON_THROW_ON_ERROR),
            explode("\n", $raw),
        );
    }
}
