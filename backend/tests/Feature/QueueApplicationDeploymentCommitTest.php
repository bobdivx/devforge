<?php

use App\Enums\ApplicationDeploymentStatus;
use App\Jobs\ApplicationDeploymentJob;
use App\Models\Application;
use App\Models\ApplicationDeploymentQueue;
use App\Models\Environment;
use App\Models\Project;
use App\Models\Server;
use App\Models\StandaloneDocker;
use App\Models\Team;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;

uses(RefreshDatabase::class);

beforeEach(function () {
    Bus::fake([ApplicationDeploymentJob::class]);

    $this->team = Team::factory()->create();
    $this->server = Server::factory()->create(['team_id' => $this->team->id]);
    $this->destination = StandaloneDocker::factory()->create([
        'server_id' => $this->server->id,
        'network' => 'test-network-'.fake()->unique()->word(),
    ]);
    $this->project = Project::factory()->create(['team_id' => $this->team->id]);
    $this->environment = Environment::factory()->create(['project_id' => $this->project->id]);
});

function makeApplication(int $environmentId, int $destinationId, ?string $gitCommitSha): Application
{
    $attributes = [
        'environment_id' => $environmentId,
        'destination_id' => $destinationId,
        'destination_type' => StandaloneDocker::class,
    ];

    if ($gitCommitSha !== null) {
        $attributes['git_commit_sha'] = $gitCommitSha;
    }

    return Application::factory()->create($attributes);
}

describe('queue_application_deployment commit resolution', function () {
    test('uses application git_commit_sha when commit parameter omitted', function () {
        $pinnedSha = 'abc123def456abc123def456abc123def456abc1';
        $application = makeApplication($this->environment->id, $this->destination->id, $pinnedSha);

        $result = queue_application_deployment(
            application: $application,
            deployment_uuid: 'test-deploy-uuid-1',
        );

        expect($result['status'])->toBe('queued');

        $deployment = ApplicationDeploymentQueue::where('deployment_uuid', 'test-deploy-uuid-1')->first();
        expect($deployment)->not->toBeNull();
        expect($deployment->commit)->toBe($pinnedSha);
    });

    test('falls back to HEAD when both commit parameter and git_commit_sha are unset', function () {
        $application = makeApplication($this->environment->id, $this->destination->id, 'HEAD');

        $result = queue_application_deployment(
            application: $application,
            deployment_uuid: 'test-deploy-uuid-2',
        );

        expect($result['status'])->toBe('queued');

        $deployment = ApplicationDeploymentQueue::where('deployment_uuid', 'test-deploy-uuid-2')->first();
        expect($deployment->commit)->toBe('HEAD');
    });

    test('explicit commit parameter overrides application git_commit_sha', function () {
        $pinnedSha = 'abc123def456abc123def456abc123def456abc1';
        $webhookSha = '111222333444555666777888999000aaabbbccc1';
        $application = makeApplication($this->environment->id, $this->destination->id, $pinnedSha);

        $result = queue_application_deployment(
            application: $application,
            deployment_uuid: 'test-deploy-uuid-3',
            commit: $webhookSha,
        );

        expect($result['status'])->toBe('queued');

        $deployment = ApplicationDeploymentQueue::where('deployment_uuid', 'test-deploy-uuid-3')->first();
        expect($deployment->commit)->toBe($webhookSha);
    });

    test('treats empty string commit parameter as unset and uses git_commit_sha', function () {
        $pinnedSha = 'abc123def456abc123def456abc123def456abc1';
        $application = makeApplication($this->environment->id, $this->destination->id, $pinnedSha);

        $result = queue_application_deployment(
            application: $application,
            deployment_uuid: 'test-deploy-uuid-4',
            commit: '',
        );

        expect($result['status'])->toBe('queued');

        $deployment = ApplicationDeploymentQueue::where('deployment_uuid', 'test-deploy-uuid-4')->first();
        expect($deployment->commit)->toBe($pinnedSha);
    });
});

describe('queue_application_deployment supersedes previous active deployments', function () {
    test('cancels in-progress deployment when queueing a different commit', function () {
        $application = makeApplication($this->environment->id, $this->destination->id, 'HEAD');

        $previous = ApplicationDeploymentQueue::create([
            'application_id' => $application->id,
            'application_name' => $application->name,
            'server_id' => $this->server->id,
            'server_name' => $this->server->name,
            'destination_id' => $this->destination->id,
            'deployment_uuid' => 'old-deploy-uuid',
            'deployment_url' => '/old',
            'pull_request_id' => 0,
            'commit' => 'aaa111bbb222ccc333ddd444eee555fff666aaa1',
            'status' => ApplicationDeploymentStatus::IN_PROGRESS->value,
        ]);

        $result = queue_application_deployment(
            application: $application,
            deployment_uuid: 'new-deploy-uuid',
            commit: 'zzz999yyy888xxx777www666vvv555uuu444ttt1',
        );

        expect($result['status'])->toBe('queued');

        $previous->refresh();
        expect($previous->status)->toBe(ApplicationDeploymentStatus::CANCELLED_BY_USER->value);

        $newest = ApplicationDeploymentQueue::where('deployment_uuid', 'new-deploy-uuid')->first();
        expect($newest)->not->toBeNull();
        expect($newest->status)->toBeIn([
            ApplicationDeploymentStatus::QUEUED->value,
            ApplicationDeploymentStatus::IN_PROGRESS->value,
        ]);

        $activeCount = ApplicationDeploymentQueue::where('application_id', $application->id)
            ->whereIn('status', [
                ApplicationDeploymentStatus::QUEUED->value,
                ApplicationDeploymentStatus::IN_PROGRESS->value,
            ])
            ->count();
        expect($activeCount)->toBe(1);
    });

    test('cancels previous active deployment when force_rebuild queues the same commit again', function () {
        $commit = 'abc123def456abc123def456abc123def456abc1';
        $application = makeApplication($this->environment->id, $this->destination->id, $commit);

        $previous = ApplicationDeploymentQueue::create([
            'application_id' => $application->id,
            'application_name' => $application->name,
            'server_id' => $this->server->id,
            'server_name' => $this->server->name,
            'destination_id' => $this->destination->id,
            'deployment_uuid' => 'force-old-uuid',
            'deployment_url' => '/old',
            'pull_request_id' => 0,
            'commit' => $commit,
            'status' => ApplicationDeploymentStatus::QUEUED->value,
        ]);

        $result = queue_application_deployment(
            application: $application,
            deployment_uuid: 'force-new-uuid',
            commit: $commit,
            force_rebuild: true,
        );

        expect($result['status'])->toBe('queued');

        $previous->refresh();
        expect($previous->status)->toBe(ApplicationDeploymentStatus::CANCELLED_BY_USER->value);

        expect(
            ApplicationDeploymentQueue::where('deployment_uuid', 'force-new-uuid')->exists()
        )->toBeTrue();
    });

    test('skips queueing the same commit without force and keeps the existing deployment', function () {
        $commit = 'abc123def456abc123def456abc123def456abc1';
        $application = makeApplication($this->environment->id, $this->destination->id, $commit);

        $existing = ApplicationDeploymentQueue::create([
            'application_id' => $application->id,
            'application_name' => $application->name,
            'server_id' => $this->server->id,
            'server_name' => $this->server->name,
            'destination_id' => $this->destination->id,
            'deployment_uuid' => 'skip-existing-uuid',
            'deployment_url' => '/existing',
            'pull_request_id' => 0,
            'commit' => $commit,
            'status' => ApplicationDeploymentStatus::IN_PROGRESS->value,
        ]);

        $result = queue_application_deployment(
            application: $application,
            deployment_uuid: 'skip-new-uuid',
            commit: $commit,
        );

        expect($result['status'])->toBe('skipped');
        expect($result['deployment_uuid'])->toBe('skip-existing-uuid');

        $existing->refresh();
        expect($existing->status)->toBe(ApplicationDeploymentStatus::IN_PROGRESS->value);
        expect(ApplicationDeploymentQueue::where('deployment_uuid', 'skip-new-uuid')->exists())->toBeFalse();
    });

    test('does not cancel an active production deployment when queueing a preview PR deploy', function () {
        $application = makeApplication($this->environment->id, $this->destination->id, 'HEAD');

        $production = ApplicationDeploymentQueue::create([
            'application_id' => $application->id,
            'application_name' => $application->name,
            'server_id' => $this->server->id,
            'server_name' => $this->server->name,
            'destination_id' => $this->destination->id,
            'deployment_uuid' => 'prod-active-uuid',
            'deployment_url' => '/prod',
            'pull_request_id' => 0,
            'commit' => 'prodcommit000prodcommit000prodcommit0001',
            'status' => ApplicationDeploymentStatus::IN_PROGRESS->value,
        ]);

        $result = queue_application_deployment(
            application: $application,
            deployment_uuid: 'pr-deploy-uuid',
            commit: 'prcommit0000prcommit0000prcommit0000pr1',
            pull_request_id: 42,
        );

        expect($result['status'])->toBe('queued');

        $production->refresh();
        expect($production->status)->toBe(ApplicationDeploymentStatus::IN_PROGRESS->value);
        expect(ApplicationDeploymentQueue::where('deployment_uuid', 'pr-deploy-uuid')->exists())->toBeTrue();
    });
});
