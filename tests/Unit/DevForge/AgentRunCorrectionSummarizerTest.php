<?php

use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\AiProviderConfig;
use App\Models\User;
use App\Services\DevForge\Agent\AgentRunCorrectionSummarizer;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->user = User::factory()->create();
    $this->team = $this->user->teams()->firstOrFail();
    $provider = AiProviderConfig::factory()->create(['team_id' => $this->team->id]);
    $this->agent = AiAgent::factory()->create([
        'team_id' => $this->team->id,
        'type' => 'deployment',
        'provider_config_id' => $provider->id,
    ]);
    $this->summarizer = app(AgentRunCorrectionSummarizer::class);
});

it('summarizes coolify env upsert and redeploy as fixed', function () {
    $run = AiAgentRun::factory()->create([
        'agent_id' => $this->agent->id,
        'status' => 'completed',
        'summary' => str_repeat('Raisonnement Ollama très long. ', 40),
        'metadata' => [
            'deployment_uuid' => 'fail-uuid-1',
            'correction_actions' => [
                [
                    'kind' => 'env_coolify',
                    'label' => 'Variable Coolify',
                    'detail' => 'PUPPETEER_SKIP_DOWNLOAD',
                    'ok' => true,
                ],
                [
                    'kind' => 'redeploy',
                    'label' => 'Redéploiement',
                    'deployment_uuid' => 'redeploy-uuid-1',
                    'ok' => true,
                ],
            ],
        ],
        'actions_taken' => [[
            'tool' => 'control_resource',
            'action' => 'deploy',
            'reason' => 'fix env',
            'deployment_uuid' => 'redeploy-uuid-1',
            'at' => now()->toISOString(),
        ]],
    ]);

    $summary = $this->summarizer->summarize($run);

    $pills = collect($summary['pills'])->keyBy('id');

    expect($summary['outcome'])->toBe('fixed')
        ->and($summary['source_scope'])->toBe('coolify_only')
        ->and($summary['headline'])->toContain('PUPPETEER_SKIP_DOWNLOAD')
        ->and($pills['env']['active'])->toBeTrue()
        ->and($pills['redeploy']['active'])->toBeTrue()
        ->and($pills['commit']['active'])->toBeFalse();

    $this->summarizer->finalize($run->fresh());
    $run->refresh();

    expect($run->summary)->toContain('Variables Coolify')
        ->and($run->metadata['correction']['outcome'])->toBe('fixed');
});

it('detects redeploy-only without source fix', function () {
    $run = AiAgentRun::factory()->create([
        'agent_id' => $this->agent->id,
        'status' => 'completed',
        'summary' => 'Je redéploie.',
        'actions_taken' => [[
            'tool' => 'control_resource',
            'action' => 'deploy',
            'reason' => 'retry',
            'deployment_uuid' => 'redeploy-only',
            'at' => now()->toISOString(),
        ]],
        'logs' => "[12:00]   ✓ Action deploy sur app-uuid : retry\n",
    ]);

    $summary = $this->summarizer->summarize($run);

    expect($summary['outcome'])->toBe('redeploy_only')
        ->and($summary['source_scope'])->toBe('redeploy_only')
        ->and($summary['headline'])->toContain('sans modification');
});

it('parses git commit and pr from tool logs for legacy runs', function () {
    $run = AiAgentRun::factory()->create([
        'agent_id' => $this->agent->id,
        'status' => 'completed',
        'summary' => '',
        'logs' => implode("\n", [
            '  → Outil: write_application_source({"path":"Dockerfile","mode":"pull_request","commit_message":"fix"})',
            '  ← Résultat: {"mode":"pull_request","path":"Dockerfile","commit_sha":"abc1234def","pull_request_url":"https://github.com/org/repo/pull/12","pull_request_number":12}',
        ]),
    ]);

    $summary = $this->summarizer->summarize($run);

    expect($summary['outcome'])->toBe('partial')
        ->and($summary['source_scope'])->toBe('pull_request')
        ->and(collect($summary['pills'])->firstWhere('id', 'pr')['active'])->toBeTrue()
        ->and(collect($summary['pills'])->firstWhere('id', 'pr')['href'])->toBe('https://github.com/org/repo/pull/12');
});

it('records tool results into correction_actions metadata', function () {
    $run = AiAgentRun::factory()->create([
        'agent_id' => $this->agent->id,
        'status' => 'running',
        'metadata' => [],
    ]);

    $this->summarizer->recordToolResult($run, 'upsert_application_env_var', [
        'key' => 'NODE_ENV',
        'value' => 'production',
    ], ['ok' => true]);

    $run->refresh();

    expect($run->metadata['correction_actions'][0]['kind'])->toBe('env_coolify')
        ->and($run->metadata['correction_actions'][0]['detail'])->toBe('NODE_ENV');
});

it('replaces noisy llm summaries', function () {
    expect($this->summarizer->shouldReplaceSummary('', 'ok'))->toBeTrue()
        ->and($this->summarizer->shouldReplaceSummary(str_repeat('x', 400), 'ok'))->toBeTrue()
        ->and($this->summarizer->shouldReplaceSummary("ligne1\nligne2\nligne3\nligne4", 'ok'))->toBeTrue()
        ->and($this->summarizer->shouldReplaceSummary('Build corrigé.', 'ok'))->toBeFalse();
});
