<?php

use App\Models\Application;
use App\Models\Environment;
use App\Models\GithubApp;
use App\Models\PrivateKey;
use App\Models\Project;
use App\Models\Server;
use App\Models\Team;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);

    $this->user = User::factory()->create();
    $this->team = $this->user->teams()->firstOrFail();
    $this->session = ['currentTeam' => $this->team];

    $rsaKey = openssl_pkey_new([
        'private_key_bits' => 2048,
        'private_key_type' => OPENSSL_KEYTYPE_RSA,
    ]);
    openssl_pkey_export($rsaKey, $pemKey);

    $this->privateKey = PrivateKey::create([
        'name' => 'DevForge GitHub Key',
        'private_key' => $pemKey,
        'team_id' => $this->team->id,
    ]);

    $this->githubApp = GithubApp::create([
        'name' => 'DevForge GitHub App',
        'api_url' => 'https://api.github.com',
        'html_url' => 'https://github.com',
        'custom_user' => 'git',
        'custom_port' => 22,
        'app_id' => 12345,
        'installation_id' => 67890,
        'client_id' => 'test-client-id',
        'client_secret' => 'test-client-secret',
        'webhook_secret' => 'test-webhook-secret',
        'private_key_id' => $this->privateKey->id,
        'team_id' => $this->team->id,
        'is_system_wide' => false,
        'is_public' => false,
    ]);

    $this->server = Server::factory()->create([
        'team_id' => $this->team->id,
    ]);
    $this->destination = $this->server->standaloneDockers()->firstOrFail();
    $this->project = Project::factory()->create(['team_id' => $this->team->id]);
    $this->environment = Environment::factory()->create(['project_id' => $this->project->id]);

    $this->application = Application::factory()->create([
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'git_repository' => 'acme/demo-app',
        'git_branch' => 'main',
        'source_id' => $this->githubApp->id,
        'source_type' => GithubApp::class,
    ]);
});

function fakeGithubSourceHttp(string $path = 'README.md', string $content = "# Demo\n", string $sha = 'abc123'): void
{
    Http::fake([
        'https://api.github.com/zen' => Http::response('Keep it logically awesome.', 200, [
            'Date' => now()->toRfc7231String(),
        ]),
        'https://api.github.com/app/installations/67890/access_tokens' => Http::response([
            'token' => 'fake-installation-token',
        ], 201),
        'https://api.github.com/repos/acme/demo-app/contents/*' => function ($request) use ($path, $content, $sha) {
            if ($request->method() === 'GET') {
                return Http::response([
                    'type' => 'file',
                    'path' => $path,
                    'sha' => $sha,
                    'size' => strlen($content),
                    'content' => base64_encode($content),
                ], 200);
            }

            if ($request->method() === 'PUT') {
                $payload = $request->data();

                return Http::response([
                    'content' => [
                        'path' => $path,
                        'sha' => 'new-sha-456',
                        'size' => strlen(base64_decode((string) ($payload['content'] ?? ''), true) ?: ''),
                    ],
                    'commit' => [
                        'sha' => 'commit-sha-789',
                        'html_url' => 'https://github.com/acme/demo-app/commit/commit-sha-789',
                    ],
                ], 200);
            }

            return Http::response(['message' => 'Unexpected method'], 405);
        },
        'https://api.github.com/repos/acme/demo-app/contents' => Http::response([
            [
                'type' => 'file',
                'name' => 'README.md',
                'path' => 'README.md',
                'size' => 12,
            ],
        ], 200),
    ]);
}

function fakeGithubSourcePullRequestHttp(string $path = 'README.md', string $content = "# Demo\n", string $sha = 'abc123'): void
{
    Http::fake([
        'https://api.github.com/zen' => Http::response('Keep it logically awesome.', 200, [
            'Date' => now()->toRfc7231String(),
        ]),
        'https://api.github.com/app/installations/67890/access_tokens' => Http::response([
            'token' => 'fake-installation-token',
        ], 201),
        'https://api.github.com/repos/acme/demo-app/git/ref/heads/main' => Http::response([
            'ref' => 'refs/heads/main',
            'object' => ['sha' => 'base-head-sha'],
        ], 200),
        'https://api.github.com/repos/acme/demo-app/git/refs' => Http::response([
            'ref' => 'refs/heads/devforge/readme-edit-20260101-120000',
            'object' => ['sha' => 'base-head-sha'],
        ], 201),
        'https://api.github.com/repos/acme/demo-app/contents/*' => function ($request) use ($path, $content, $sha) {
            if ($request->method() === 'GET') {
                return Http::response([
                    'type' => 'file',
                    'path' => $path,
                    'sha' => $sha,
                    'size' => strlen($content),
                    'content' => base64_encode($content),
                ], 200);
            }

            if ($request->method() === 'PUT') {
                return Http::response([
                    'content' => [
                        'path' => $path,
                        'sha' => 'pr-file-sha',
                        'size' => 20,
                    ],
                    'commit' => [
                        'sha' => 'pr-commit-sha',
                        'html_url' => 'https://github.com/acme/demo-app/commit/pr-commit-sha',
                    ],
                ], 200);
            }

            return Http::response(['message' => 'Unexpected method'], 405);
        },
        'https://api.github.com/repos/acme/demo-app/pulls' => Http::response([
            'number' => 42,
            'title' => 'docs: update readme',
            'state' => 'open',
            'html_url' => 'https://github.com/acme/demo-app/pull/42',
            'head' => ['ref' => 'devforge/readme-edit'],
            'base' => ['ref' => 'main'],
        ], 201),
    ]);
}

it('reads application source file via devforge api', function () {
    fakeGithubSourceHttp();

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/applications/'.$this->application->uuid.'/source/read?path=README.md')
        ->assertSuccessful()
        ->assertJsonPath('data.path', 'README.md')
        ->assertJsonPath('data.sha', 'abc123')
        ->assertJsonPath('data.content', "# Demo\n");
});

it('writes application source file and commits on github', function () {
    fakeGithubSourceHttp();

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson('/api/devforge/v1/applications/'.$this->application->uuid.'/source/write', [
            'path' => 'README.md',
            'content' => "# Demo updated\n",
            'commit_message' => 'docs: update readme',
            'sha' => 'abc123',
            'redeploy' => false,
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.mode', 'direct')
        ->assertJsonPath('data.path', 'README.md')
        ->assertJsonPath('data.sha', 'new-sha-456')
        ->assertJsonPath('data.commit_sha', 'commit-sha-789')
        ->assertJsonPath('data.commit_url', 'https://github.com/acme/demo-app/commit/commit-sha-789')
        ->assertJsonPath('data.redeploy', null);
});

it('writes application source via pull request', function () {
    fakeGithubSourcePullRequestHttp();

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson('/api/devforge/v1/applications/'.$this->application->uuid.'/source/write', [
            'path' => 'README.md',
            'content' => "# Demo updated\n",
            'commit_message' => 'docs: update readme',
            'sha' => 'abc123',
            'mode' => 'pull_request',
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.mode', 'pull_request')
        ->assertJsonPath('data.pull_request_number', 42)
        ->assertJsonPath('data.pull_request_url', 'https://github.com/acme/demo-app/pull/42')
        ->assertJsonPath('data.redeploy.queued', false);
});

it('validates write payload for application source', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson('/api/devforge/v1/applications/'.$this->application->uuid.'/source/write', [
            'path' => 'README.md',
            'content' => 'hello',
        ])
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['commit_message']);
});

it('blocks cross-team application source write', function () {
    fakeGithubSourceHttp();

    $otherTeam = Team::factory()->create();
    $otherProject = Project::factory()->create(['team_id' => $otherTeam->id]);
    $otherEnvironment = Environment::factory()->create(['project_id' => $otherProject->id]);
    $otherApplication = Application::factory()->create([
        'environment_id' => $otherEnvironment->id,
        'destination_id' => $this->destination->id,
        'git_repository' => 'acme/other-app',
        'git_branch' => 'main',
        'source_id' => $this->githubApp->id,
        'source_type' => GithubApp::class,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson('/api/devforge/v1/applications/'.$otherApplication->uuid.'/source/write', [
            'path' => 'README.md',
            'content' => 'nope',
            'commit_message' => 'hack',
        ])
        ->assertNotFound();
});

it('returns git sync status against github head', function () {
    Http::fake([
        'https://api.github.com/zen' => Http::response('Keep it logically awesome.', 200, [
            'Date' => now()->toRfc7231String(),
        ]),
        'https://api.github.com/app/installations/67890/access_tokens' => Http::response([
            'token' => 'fake-installation-token',
        ], 201),
        'https://api.github.com/repos/acme/demo-app/git/ref/heads/main' => Http::response([
            'ref' => 'refs/heads/main',
            'object' => ['sha' => 'abcdef1234567890abcdef1234567890abcdef12'],
        ], 200),
    ]);

    \App\Models\ApplicationDeploymentQueue::create([
        'application_id' => $this->application->id,
        'deployment_uuid' => 'deploy-sync-1',
        'server_id' => $this->server->id,
        'status' => \App\Enums\ApplicationDeploymentStatus::FINISHED->value,
        'pull_request_id' => 0,
        'commit' => 'abcdef1234567890abcdef1234567890abcdef12',
        'commit_message' => 'feat: sync check',
        'finished_at' => now(),
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/applications/'.$this->application->uuid.'/git-sync')
        ->assertSuccessful()
        ->assertJsonPath('data.available', true)
        ->assertJsonPath('data.git_branch', 'main')
        ->assertJsonPath('data.deployed_commit', 'abcdef1234567890abcdef1234567890abcdef12')
        ->assertJsonPath('data.remote_head_sha', 'abcdef1234567890abcdef1234567890abcdef12')
        ->assertJsonPath('data.up_to_date', true);
});

it('updates application git branch without redeploying', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson('/api/devforge/v1/applications/'.$this->application->uuid.'/git-branch', [
            'git_branch' => 'feature/deploy-picker',
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.ok', true)
        ->assertJsonPath('data.unchanged', false)
        ->assertJsonPath('data.git_branch', 'feature/deploy-picker')
        ->assertJsonPath('data.previous_git_branch', 'main')
        ->assertJsonPath('data.application.configuration.git_branch', 'feature/deploy-picker');

    expect($this->application->fresh()->git_branch)->toBe('feature/deploy-picker');
    expect($this->application->fresh()->git_commit_sha)->toBe('HEAD');
});

it('rejects an invalid git branch update', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson('/api/devforge/v1/applications/'.$this->application->uuid.'/git-branch', [
            'git_branch' => 'bad;branch',
        ])
        ->assertUnprocessable();

    expect($this->application->fresh()->git_branch)->toBe('main');
});
