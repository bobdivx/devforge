<?php

use App\Services\DevForge\Github\GithubRunnerJobSelector;

function runnerContext(array $overrides = []): array
{
    return [
        'runner_name' => 'devforge-runner-popcorn-tauri',
        'github_runner_id' => 88,
        'github_labels' => ['self-hosted', 'linux', 'x64', 'devforge-runner-popcorn-tauri'],
        ...$overrides,
    ];
}

it('parses owner/repo and github urls', function () {
    $selector = new GithubRunnerJobSelector;

    expect($selector->parseRepository('bobdivx/popcorn-tauri'))
        ->toBe(['owner' => 'bobdivx', 'repo' => 'popcorn-tauri'])
        ->and($selector->parseRepository('https://github.com/bobdivx/popcorn-tauri.git'))
        ->toBe(['owner' => 'bobdivx', 'repo' => 'popcorn-tauri'])
        ->and($selector->parseRepository(null))->toBeNull();
});

it('maps github statuses to runner job buckets', function (string $status, ?string $conclusion, ?string $expected) {
    expect((new GithubRunnerJobSelector)->bucketFor($status, $conclusion))->toBe($expected);
})->with([
    'running' => ['in_progress', null, 'in_progress'],
    'queued' => ['queued', null, 'queued'],
    'waiting' => ['waiting', null, 'queued'],
    'failed' => ['completed', 'failure', 'failure'],
    'timed out' => ['completed', 'timed_out', 'failure'],
    'success ignored' => ['completed', 'success', null],
    'cancelled ignored' => ['completed', 'cancelled', null],
]);

it('keeps jobs assigned to the runner and queued self-hosted jobs', function () {
    $selector = new GithubRunnerJobSelector;
    $runner = runnerContext();

    $payload = $selector->present($runner, [
        [
            'id' => 11,
            'name' => 'Desktop',
            'status' => 'in_progress',
            'head_branch' => 'main',
            'html_url' => 'https://github.com/bobdivx/popcorn-tauri/actions/runs/11',
        ],
        [
            'id' => 12,
            'name' => 'CI',
            'status' => 'queued',
            'head_branch' => 'feat/x',
            'html_url' => 'https://github.com/bobdivx/popcorn-tauri/actions/runs/12',
        ],
        [
            'id' => 13,
            'name' => 'Release',
            'status' => 'completed',
            'conclusion' => 'failure',
            'head_branch' => 'main',
            'html_url' => 'https://github.com/bobdivx/popcorn-tauri/actions/runs/13',
        ],
        [
            'id' => 14,
            'name' => 'Hosted',
            'status' => 'completed',
            'conclusion' => 'failure',
            'head_branch' => 'main',
        ],
    ], [
        11 => [[
            'id' => 101,
            'name' => 'build-windows',
            'status' => 'in_progress',
            'runner_id' => 88,
            'runner_name' => 'devforge-runner-popcorn-tauri',
            'html_url' => 'https://github.com/bobdivx/popcorn-tauri/actions/runs/11/job/101',
        ]],
        12 => [[
            'id' => 102,
            'name' => 'package',
            'status' => 'queued',
            'labels' => ['self-hosted', 'linux'],
        ]],
        13 => [[
            'id' => 103,
            'name' => 'build-linux',
            'status' => 'completed',
            'conclusion' => 'failure',
            'runner_name' => 'devforge-runner-popcorn-tauri',
        ]],
        14 => [[
            'id' => 104,
            'name' => 'lint',
            'status' => 'completed',
            'conclusion' => 'failure',
            'runner_name' => 'GitHub Actions 12',
            'labels' => ['ubuntu-latest'],
        ]],
    ], 'bobdivx/popcorn-tauri');

    expect($payload['available'])->toBeTrue()
        ->and($payload['counts'])->toBe([
            'in_progress' => 1,
            'queued' => 1,
            'failure' => 1,
        ])
        ->and(collect($payload['items'])->pluck('name')->all())
        ->toBe(['build-windows', 'package', 'build-linux']);
});

it('rejects github-hosted labels and accepts matching self-hosted labels', function () {
    $selector = new GithubRunnerJobSelector;
    $runnerLabels = ['self-hosted', 'linux', 'x64'];

    expect($selector->labelsCompatible(['ubuntu-latest'], $runnerLabels))->toBeFalse()
        ->and($selector->labelsCompatible(['self-hosted', 'linux'], $runnerLabels))->toBeTrue()
        ->and($selector->labelsCompatible(['self-hosted', 'windows'], $runnerLabels))->toBeFalse();
});
