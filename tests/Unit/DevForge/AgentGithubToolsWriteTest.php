<?php

use App\Models\Team;
use App\Services\DevForge\Agent\Tool\AgentGithubTools;
use App\Services\DevForge\Core\CoreResourceCatalog;
use App\Services\DevForge\Github\GithubAppCatalog;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;

uses(RefreshDatabase::class);

it('writes a github file via contents api', function () {
    $team = Team::factory()->create();

    Http::fake([
        'https://api.github.com/app/installations/*' => Http::response(['token' => 'fake-token'], 201),
        'https://api.github.com/repos/acme/demo/contents/README.md' => Http::response([
            'content' => [
                'path' => 'README.md',
                'sha' => 'new-sha',
                'size' => 5,
            ],
            'commit' => [
                'sha' => 'commit-sha',
                'html_url' => 'https://github.com/acme/demo/commit/commit-sha',
            ],
        ], 200),
    ]);

    $tools = new AgentGithubTools($team, app(CoreResourceCatalog::class), app(GithubAppCatalog::class));

    // GithubAppCatalog will fail without a real app — test writeFile validation instead
    $result = $tools->writeFile('', 'acme', 'demo', 'README.md', 'hello', '');

    expect($result)->toHaveKey('error')
        ->and($result['error'])->toContain('commit');
});

it('rejects oversized github write payloads', function () {
    $team = Team::factory()->create();
    $tools = new AgentGithubTools($team, app(CoreResourceCatalog::class), app(GithubAppCatalog::class));

    $result = $tools->writeFile('uuid', 'acme', 'demo', 'big.txt', str_repeat('a', 32001), 'too big');

    expect($result)->toHaveKey('error')
        ->and($result['error'])->toContain('32 Ko');
});
