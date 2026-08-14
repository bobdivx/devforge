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

it('records git branch update and redeploy as fixed', function () {
    $run = AiAgentRun::factory()->create([
        'agent_id' => $this->agent->id,
        'status' => 'completed',
        'summary' => 'Diagnostic branche.',
        'metadata' => [],
    ]);

    $this->summarizer->recordToolResult($run, 'update_application_git_branch', [
        'git_branch' => 'feat/website',
        'reason' => 'main introuvable',
    ], [
        'ok' => true,
        'git_branch' => 'feat/website',
        'previous_git_branch' => 'main',
        'redeploy' => [
            'deployment_uuid' => 'redeploy-branch-1',
            'queued' => true,
        ],
    ]);

    $run->refresh();
    $summary = $this->summarizer->summarize($run);
    $pills = collect($summary['pills'])->keyBy('id');

    expect($summary['outcome'])->toBe('fixed')
        ->and($pills['branch']['active'])->toBeTrue()
        ->and($pills['branch']['detail'])->toBe('feat/website')
        ->and($pills['redeploy']['active'])->toBeTrue();
});

it('records runtime settings update and redeploy as fixed build correction', function () {
    $run = AiAgentRun::factory()->create([
        'agent_id' => $this->agent->id,
        'status' => 'completed',
        'summary' => 'Build cassé.',
        'metadata' => [],
    ]);

    $this->summarizer->recordToolResult($run, 'update_application_runtime_settings', [
        'build_command' => 'npm run build',
        'ports_exposes' => '3000',
        'reason' => 'fix build',
    ], [
        'ok' => true,
        'updated_keys' => ['build_command', 'ports_exposes'],
        'redeploy' => [
            'deployment_uuid' => 'redeploy-build-1',
            'queued' => true,
        ],
    ]);

    $run->refresh();
    $summary = $this->summarizer->summarize($run);
    $pills = collect($summary['pills'])->keyBy('id');

    expect($summary['outcome'])->toBe('fixed')
        ->and($summary['source_scope'])->toBe('runtime_settings')
        ->and($summary['headline'])->toContain('build_command')
        ->and($pills['build']['active'])->toBeTrue()
        ->and($pills['redeploy']['active'])->toBeTrue();
});

it('records host permission fix and redeploy as fixed', function () {
    $run = AiAgentRun::factory()->create([
        'agent_id' => $this->agent->id,
        'status' => 'completed',
        'summary' => 'Permission denied.',
        'metadata' => [],
    ]);

    $this->summarizer->recordToolResult($run, 'fix_application_host_permissions', [
        'path' => '/media/Docker/AppData/coolify/data/applications/app-1',
        'reason' => 'tee permission denied',
    ], [
        'ok' => true,
        'path' => '/media/Docker/AppData/coolify/data/applications/app-1',
        'redeploy' => [
            'deployment_uuid' => 'redeploy-perms-1',
            'queued' => true,
        ],
    ]);

    $run->refresh();
    $summary = $this->summarizer->summarize($run);
    $pills = collect($summary['pills'])->keyBy('id');

    expect($summary['outcome'])->toBe('fixed')
        ->and($summary['source_scope'])->toBe('host_permissions')
        ->and($summary['headline'])->toContain('Permissions host')
        ->and($pills['perms']['active'])->toBeTrue()
        ->and($pills['redeploy']['active'])->toBeTrue();
});

it('replaces noisy llm summaries', function () {
    expect($this->summarizer->shouldReplaceSummary('', 'ok'))->toBeTrue()
        ->and($this->summarizer->shouldReplaceSummary(str_repeat('x', 400), 'ok'))->toBeTrue()
        ->and($this->summarizer->shouldReplaceSummary("ligne1\nligne2\nligne3\nligne4", 'ok'))->toBeTrue()
        ->and($this->summarizer->shouldReplaceSummary('Build corrigé.', 'ok'))->toBeFalse()
        ->and($this->summarizer->shouldReplaceSummary('从日志信息来看，构建过程在 astro build 步骤时失败了', 'ok'))->toBeTrue();
});

it('does not surface cjk llm dumps as correction diagnosis', function () {
    $run = AiAgentRun::factory()->create([
        'agent_id' => $this->agent->id,
        'status' => 'failed',
        'summary' => '从日志信息来看，构建过程在 astro build 步骤时失败了，因为 Node.js 版本不被 Astro 支持。',
        'metadata' => [
            'correction_actions' => [[
                'kind' => 'attempt_failed',
                'label' => 'fix_coolify_base_config_path',
                'detail' => 'Error response from daemon: No such container: coolify',
                'ok' => false,
            ]],
        ],
    ]);

    $summary = $this->summarizer->summarize($run);

    expect($summary['outcome'])->toBe('failed')
        ->and($summary['headline'])->toBe('Échec de l’intervention agent.')
        ->and($summary['diagnosis'])->toBeNull();
});

it('strips cjk diagnosis from a persisted correction payload', function () {
    $sanitized = $this->summarizer->sanitizePersistedCorrection([
        'outcome' => 'failed',
        'headline' => 'Échec de l’intervention agent.',
        'diagnosis' => '从日志信息来看，构建过程在 astro build 步骤时失败了。',
        'steps' => ['Mettre à jour Node.js', '检查版本'],
    ]);

    expect($sanitized['diagnosis'])->toBeNull()
        ->and($sanitized['headline'])->toBe('Échec de l’intervention agent.')
        ->and($sanitized['steps'])->toBe(['Mettre à jour Node.js']);
});
