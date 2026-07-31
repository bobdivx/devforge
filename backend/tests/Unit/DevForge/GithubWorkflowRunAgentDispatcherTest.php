<?php

use App\Models\AiAgent;
use App\Models\GithubApp;
use App\Models\PrivateKey;
use App\Models\Team;
use App\Services\DevForge\Agent\GithubWorkflowRunAgentDispatcher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);
    config()->set('devforge.agents_enabled', true);
    Queue::fake();

    $this->team = Team::factory()->create();

    $rsaKey = openssl_pkey_new([
        'private_key_bits' => 2048,
        'private_key_type' => OPENSSL_KEYTYPE_RSA,
    ]);
    openssl_pkey_export($rsaKey, $pemKey);

    $privateKey = PrivateKey::create([
        'name' => 'WF Key',
        'private_key' => $pemKey,
        'team_id' => $this->team->id,
    ]);

    $this->githubApp = GithubApp::create([
        'name' => 'WF App',
        'api_url' => 'https://api.github.com',
        'html_url' => 'https://github.com',
        'custom_user' => 'git',
        'custom_port' => 22,
        'app_id' => 4242,
        'installation_id' => 4243,
        'client_id' => 'cid',
        'client_secret' => 'csecret',
        'webhook_secret' => 'wsecret',
        'private_key_id' => $privateKey->id,
        'team_id' => $this->team->id,
        'is_system_wide' => false,
        'is_public' => false,
    ]);
});

it('dispatches github-actions agent on failed workflow_run webhook payload', function () {
    $agent = AiAgent::factory()->create([
        'team_id' => $this->team->id,
        'type' => 'github-actions',
        'is_active' => true,
        'schedule_minutes' => 0,
        'status' => 'idle',
    ]);

    $run = app(GithubWorkflowRunAgentDispatcher::class)->dispatch($this->githubApp, [
        'action' => 'completed',
        'workflow_run' => [
            'id' => 9911,
            'workflow_id' => 12,
            'name' => 'CI',
            'path' => '.github/workflows/ci.yml',
            'conclusion' => 'failure',
            'status' => 'completed',
            'head_branch' => 'main',
            'head_sha' => 'abc123',
            'html_url' => 'https://github.com/acme/demo/actions/runs/9911',
        ],
        'repository' => [
            'full_name' => 'acme/demo',
            'name' => 'demo',
            'owner' => ['login' => 'acme'],
        ],
    ]);

    expect($run)->not->toBeNull()
        ->and($run->trigger)->toBe('event')
        ->and($run->metadata['event'])->toBe('github_workflow_run_failed')
        ->and($run->metadata['workflow_run_id'])->toBe(9911)
        ->and($agent->fresh()->status)->toBe('running');
});

it('ignores successful workflow_run webhooks', function () {
    AiAgent::factory()->create([
        'team_id' => $this->team->id,
        'type' => 'github-actions',
        'is_active' => true,
        'status' => 'idle',
    ]);

    $run = app(GithubWorkflowRunAgentDispatcher::class)->dispatch($this->githubApp, [
        'action' => 'completed',
        'workflow_run' => [
            'id' => 9912,
            'conclusion' => 'success',
            'status' => 'completed',
        ],
        'repository' => ['full_name' => 'acme/demo'],
    ]);

    expect($run)->toBeNull();
});
