<?php

use App\Models\AiAgentRun;
use App\Models\Team;
use App\Services\DevForge\Agent\AgentCheckpointService;
use App\Services\DevForge\Agent\Tool\AgentGithubTools;
use App\Services\DevForge\Agent\Tool\AgentServerExecutor;
use App\Services\DevForge\Core\CoreResourceCatalog;
use App\Services\DevForge\Github\GithubAppCatalog;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

it('captures and lists checkpoints on a run', function () {
    $run = AiAgentRun::factory()->create(['metadata' => []]);
    $service = app(AgentCheckpointService::class);

    $cp = $service->capture(
        $run,
        'application_source',
        ['application_uuid' => 'app-1', 'path' => 'README.md'],
        "# before\n",
        existed: true,
    );

    $run->refresh();
    $list = $service->listForRun($run);

    expect($cp['id'])->toStartWith('cp_')
        ->and($list['count'])->toBe(1)
        ->and($list['checkpoints'][0]['id'])->toBe($cp['id'])
        ->and($list['checkpoints'][0]['kind'])->toBe('application_source')
        ->and($list['checkpoints'][0]['content_chars'])->toBeGreaterThan(0);
});

it('caps checkpoints per run', function () {
    $run = AiAgentRun::factory()->create(['metadata' => []]);
    $service = app(AgentCheckpointService::class);

    for ($i = 0; $i < AgentCheckpointService::MAX_PER_RUN + 5; $i++) {
        $service->capture($run, 'remote_file', ['path' => "f{$i}.txt"], "c{$i}", true);
        $run->refresh();
    }

    $list = $service->listForRun($run->fresh());
    expect($list['count'])->toBe(AgentCheckpointService::MAX_PER_RUN);
});

it('returns error for unknown checkpoint rollback', function () {
    $team = Team::factory()->create();
    $run = AiAgentRun::factory()->create(['metadata' => []]);
    $catalog = app(CoreResourceCatalog::class);

    $result = app(AgentCheckpointService::class)->rollback(
        run: $run,
        team: $team,
        checkpointId: 'cp_missing',
        catalog: $catalog,
        githubTools: new AgentGithubTools($team, $catalog, app(GithubAppCatalog::class)),
        serverExecutor: new AgentServerExecutor(team: $team, catalog: $catalog),
    );

    expect($result['error'] ?? '')->toContain('introuvable');
});
