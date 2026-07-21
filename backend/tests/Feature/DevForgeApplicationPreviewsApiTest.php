<?php

use App\Actions\Application\CleanupPreviewDeployment;
use App\Models\Application;
use App\Models\ApplicationPreview;
use App\Models\Environment;
use App\Models\Project;
use App\Models\Server;
use App\Models\StandaloneDocker;
use App\Models\Team;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Visus\Cuid2\Cuid2;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);

    CleanupPreviewDeployment::shouldRun()->andReturn([
        'cancelled_deployments' => 0,
        'killed_containers' => 0,
        'status' => 'success',
    ]);

    $this->user = User::factory()->create();
    $this->team = $this->user->teams()->firstOrFail();
    $this->session = ['currentTeam' => $this->team];

    $this->server = Server::factory()->create([
        'team_id' => $this->team->id,
    ]);
    $this->destination = $this->server->standaloneDockers()->firstOrFail();
    $this->project = Project::factory()->create(['team_id' => $this->team->id]);
    $this->environment = Environment::factory()->create(['project_id' => $this->project->id]);
    $this->application = Application::factory()->create([
        'name' => 'Previews app',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
        'preview_url_template' => '{{pr_id}}.{{domain}}',
    ]);
});

function createDevForgePreview(Application $application, int $pullRequestId, array $overrides = []): ApplicationPreview
{
    return ApplicationPreview::create(array_merge([
        'uuid' => (string) new Cuid2,
        'application_id' => $application->id,
        'pull_request_id' => $pullRequestId,
        'pull_request_html_url' => "https://github.com/example/repo/pull/{$pullRequestId}",
        'fqdn' => "pr-{$pullRequestId}.example.com",
        'status' => 'running:healthy',
    ], $overrides));
}

it('lists application previews', function () {
    createDevForgePreview($this->application, 12);
    createDevForgePreview($this->application, 34, ['status' => 'exited']);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/applications/{$this->application->uuid}/previews")
        ->assertSuccessful()
        ->assertJsonCount(2, 'data')
        ->assertJsonPath('data.0.pull_request_id', 34)
        ->assertJsonPath('data.0.is_running', false)
        ->assertJsonPath('data.1.pull_request_id', 12)
        ->assertJsonPath('data.1.is_running', true);
});

it('returns and updates preview settings', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/applications/{$this->application->uuid}/previews/settings")
        ->assertSuccessful()
        ->assertJsonPath('data.is_preview_deployments_enabled', false)
        ->assertJsonPath('data.preview_url_template', '{{pr_id}}.{{domain}}');

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/applications/{$this->application->uuid}/previews/settings", [
            'is_preview_deployments_enabled' => true,
            'preview_url_template' => '{{pr_id}}-preview.{{domain}}',
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.is_preview_deployments_enabled', true)
        ->assertJsonPath('data.preview_url_template', '{{pr_id}}-preview.{{domain}}');

    expect($this->application->fresh()->settings->is_preview_deployments_enabled)->toBeTrue()
        ->and($this->application->fresh()->preview_url_template)->toBe('{{pr_id}}-preview.{{domain}}');
});

it('soft-deletes a preview and queues cleanup', function () {
    $preview = createDevForgePreview($this->application, 42);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->deleteJson("/api/devforge/v1/applications/{$this->application->uuid}/previews/42")
        ->assertSuccessful()
        ->assertJsonPath('message', 'Suppression du preview mise en file.')
        ->assertJsonPath('pull_request_id', 42);

    expect($preview->fresh()->trashed())->toBeTrue();
});

it('scopes application previews to the current team', function () {
    $otherTeam = Team::factory()->create();
    $otherServer = Server::factory()->create(['team_id' => $otherTeam->id]);
    $otherDestination = $otherServer->standaloneDockers()->firstOrFail();
    $otherProject = Project::factory()->create(['team_id' => $otherTeam->id]);
    $otherEnvironment = Environment::factory()->create(['project_id' => $otherProject->id]);
    $otherApplication = Application::factory()->create([
        'environment_id' => $otherEnvironment->id,
        'destination_id' => $otherDestination->id,
        'destination_type' => StandaloneDocker::class,
    ]);
    createDevForgePreview($otherApplication, 7);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/applications/{$otherApplication->uuid}/previews")
        ->assertNotFound();
});
