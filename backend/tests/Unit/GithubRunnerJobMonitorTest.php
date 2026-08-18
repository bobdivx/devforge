<?php

use App\Models\GithubApp;
use App\Models\Team;
use App\Services\DevForge\Github\GithubAppCatalog;
use App\Services\DevForge\Github\GithubRunnerInventory;
use App\Services\DevForge\Github\GithubRunnerJobMonitor;
use App\Services\DevForge\Github\GithubRunnerJobSelector;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

it('aggregates queued in-progress and failed jobs for a runner', function () {
    Cache::flush();

    $team = new Team;
    $team->id = 42;

    $inventory = Mockery::mock(GithubRunnerInventory::class);
    $inventory->shouldReceive('listForTeam')
        ->once()
        ->andReturn([[
            'server_uuid' => 'srv-1',
            'name' => 'github-runner-popcorn-tauri',
            'runner_name' => 'devforge-runner-popcorn-tauri',
            'github_runner_id' => 88,
            'github_labels' => ['self-hosted', 'linux', 'x64'],
            'repo_url' => 'https://github.com/bobdivx/popcorn-tauri',
        ]]);

    $app = new GithubApp([
        'uuid' => 'app-uuid-test-monitor1',
        'api_url' => 'https://api.github.com',
        'packages_token' => 'github_pat_test',
    ]);

    $catalog = Mockery::mock(GithubAppCatalog::class);
    $catalog->shouldReceive('appsForTeam')->once()->andReturn(collect([$app]));

    Http::fake(function ($request) {
        $url = $request->url();

        if (str_contains($url, '/app/installations/')) {
            return Http::response(['message' => 'not used'], 401);
        }

        if (str_contains($url, '/actions/runs/11/jobs')) {
            return Http::response([
                'jobs' => [[
                    'id' => 101,
                    'name' => 'build-windows',
                    'status' => 'in_progress',
                    'runner_id' => 88,
                    'runner_name' => 'devforge-runner-popcorn-tauri',
                    'html_url' => 'https://github.com/bobdivx/popcorn-tauri/actions/runs/11/job/101',
                ]],
            ], 200);
        }

        if (str_contains($url, '/actions/runs/13/jobs')) {
            return Http::response([
                'jobs' => [[
                    'id' => 103,
                    'name' => 'build-linux',
                    'status' => 'completed',
                    'conclusion' => 'failure',
                    'runner_name' => 'devforge-runner-popcorn-tauri',
                ]],
            ], 200);
        }

        if (str_contains($url, '/actions/runs')) {
            $status = (string) data_get($request->data(), 'status', '');
            if ($status === '' && preg_match('/[?&]status=([^&]+)/', $url, $matches) === 1) {
                $status = urldecode($matches[1]);
            }

            $runs = match ($status) {
                'in_progress' => [[
                    'id' => 11,
                    'name' => 'Desktop',
                    'status' => 'in_progress',
                    'head_branch' => 'main',
                    'html_url' => 'https://github.com/bobdivx/popcorn-tauri/actions/runs/11',
                ]],
                'queued' => [],
                'completed' => [[
                    'id' => 13,
                    'name' => 'Release',
                    'status' => 'completed',
                    'conclusion' => 'failure',
                    'head_branch' => 'main',
                    'html_url' => 'https://github.com/bobdivx/popcorn-tauri/actions/runs/13',
                ]],
                default => [],
            };

            return Http::response(['workflow_runs' => $runs], 200);
        }

        return Http::response(['message' => 'unexpected '.$url], 404);
    });

    $monitor = new GithubRunnerJobMonitor($inventory, $catalog, new GithubRunnerJobSelector);
    $payload = $monitor->listForRunner($team, 'srv-1', 'github-runner-popcorn-tauri');

    expect($payload['available'])->toBeTrue()
        ->and($payload['repo'])->toBe('bobdivx/popcorn-tauri')
        ->and($payload['counts']['in_progress'])->toBe(1)
        ->and($payload['counts']['failure'])->toBe(1)
        ->and(collect($payload['items'])->pluck('name')->all())
        ->toBe(['build-windows', 'build-linux']);
});

it('returns an unavailable payload when the runner has no repository', function () {
    Cache::flush();

    $team = new Team;
    $team->id = 7;

    $inventory = Mockery::mock(GithubRunnerInventory::class);
    $inventory->shouldReceive('listForTeam')->once()->andReturn([[
        'server_uuid' => 'srv-1',
        'name' => 'github-runner-orphan',
        'runner_name' => 'orphan',
        'repo_url' => null,
        'github_repo' => null,
    ]]);
    $inventory->shouldReceive('show')->once()->andReturn([
        'server_uuid' => 'srv-1',
        'name' => 'github-runner-orphan',
        'runner_name' => 'orphan',
        'repo_url' => null,
        'github_repo' => null,
    ]);

    $catalog = Mockery::mock(GithubAppCatalog::class);
    $catalog->shouldNotReceive('appsForTeam');

    $monitor = new GithubRunnerJobMonitor($inventory, $catalog, new GithubRunnerJobSelector);
    $payload = $monitor->listForRunner($team, 'srv-1', 'github-runner-orphan');

    expect($payload['available'])->toBeFalse()
        ->and($payload['items'])->toBe([])
        ->and($payload['message'])->toContain('Dépôt GitHub');
});
