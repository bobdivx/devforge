<?php

use App\Models\GithubApp;
use App\Models\PrivateKey;
use App\Models\Team;
use App\Services\DevForge\Agent\Tool\AgentGithubTools;
use App\Services\DevForge\Agent\Tool\AgentToolPackage;
use App\Services\DevForge\Agent\Tool\AgentSubagentCapabilities;
use App\Services\DevForge\Core\CoreResourceCatalog;
use App\Services\DevForge\Github\GithubAppCatalog;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->team = Team::factory()->create();

    $rsaKey = openssl_pkey_new([
        'private_key_bits' => 2048,
        'private_key_type' => OPENSSL_KEYTYPE_RSA,
    ]);
    openssl_pkey_export($rsaKey, $pemKey);

    $this->privateKey = PrivateKey::create([
        'name' => 'GitHub Actions Test Key',
        'private_key' => $pemKey,
        'team_id' => $this->team->id,
    ]);

    $this->githubApp = GithubApp::create([
        'name' => 'Actions App',
        'uuid' => 'actions-app-uuid-test12',
        'api_url' => 'https://api.github.com',
        'html_url' => 'https://github.com',
        'custom_user' => 'git',
        'custom_port' => 22,
        'app_id' => 111,
        'installation_id' => 222,
        'client_id' => 'cid',
        'client_secret' => 'csecret',
        'webhook_secret' => 'wsecret',
        'private_key_id' => $this->privateKey->id,
        'team_id' => $this->team->id,
        'is_system_wide' => false,
        'is_public' => false,
    ]);

    Http::fake([
        'https://api.github.com/app/installations/222/access_tokens' => Http::response([
            'token' => 'installation-token',
        ], 201),
        'https://api.github.com/repos/acme/demo/actions/workflows*' => Http::response([
            'workflows' => [[
                'id' => 9,
                'name' => 'CI',
                'path' => '.github/workflows/ci.yml',
                'state' => 'active',
                'html_url' => 'https://github.com/acme/demo/actions/workflows/ci.yml',
            ]],
        ], 200),
        'https://api.github.com/repos/acme/demo/actions/runs/*/jobs*' => Http::response([
            'jobs' => [[
                'id' => 77,
                'name' => 'build',
                'status' => 'completed',
                'conclusion' => 'failure',
                'steps' => [['name' => 'Install', 'status' => 'completed', 'conclusion' => 'failure', 'number' => 1]],
            ]],
        ], 200),
        'https://api.github.com/repos/acme/demo/actions/jobs/77/logs' => Http::response(
            "line1\nError: Process completed with exit code 1\n",
            200,
            ['Content-Type' => 'text/plain'],
        ),
        'https://api.github.com/repos/acme/demo/actions/runs/55/rerun-failed-jobs' => Http::response('', 201),
        'https://api.github.com/repos/acme/demo/actions/workflows/ci.yml/dispatches' => Http::response('', 204),
    ]);
});

it('lists workflows jobs and job logs then reruns failed jobs', function () {
    $tools = new AgentGithubTools($this->team, app(CoreResourceCatalog::class), app(GithubAppCatalog::class));
    $uuid = $this->githubApp->uuid;

    expect($tools->listWorkflows($uuid, 'acme', 'demo')['workflows'][0]['path'])
        ->toBe('.github/workflows/ci.yml');

    expect($tools->listWorkflowJobs($uuid, 'acme', 'demo', 55)['jobs'][0]['id'])
        ->toBe(77);

    $logs = $tools->getWorkflowJobLogs($uuid, 'acme', 'demo', 77);
    expect($logs['logs'])->toContain('exit code 1');

    expect($tools->rerunWorkflowRun($uuid, 'acme', 'demo', 55, failedOnly: true))
        ->toMatchArray(['ok' => true, 'failed_only' => true]);

    expect($tools->dispatchWorkflow($uuid, 'acme', 'demo', 'ci.yml', 'main'))
        ->toMatchArray(['ok' => true, 'ref' => 'main']);
});

it('enables github package by default for github-actions agents', function () {
    expect(AgentToolPackage::defaultForAgentType('github-actions'))
        ->toContain(AgentToolPackage::PACKAGE_GITHUB)
        ->toContain(AgentToolPackage::PACKAGE_CORE);
});

it('exposes fix-ci leaf tools for workflow repair loops', function () {
    $tools = AgentSubagentCapabilities::leafAllowedTools([
        'subagent_role' => 'leaf',
        'leaf_profile' => AgentSubagentCapabilities::PROFILE_FIX_CI,
    ]);

    expect($tools)
        ->toContain('get_github_workflow_job_logs')
        ->toContain('write_github_file')
        ->toContain('rerun_github_workflow_run');
});
