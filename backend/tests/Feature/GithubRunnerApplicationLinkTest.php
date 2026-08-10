<?php

use App\Models\Application;
use App\Models\Environment;
use App\Models\GithubRunnerApplicationLink;
use App\Models\Project;
use App\Models\Server;
use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\Github\GithubRunnerApplicationLinker;
use App\Services\DevForge\Github\GithubRunnerInventory;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);

    $this->user = User::factory()->create();
    $this->team = $this->user->teams()->firstOrFail();
    $this->session = ['currentTeam' => $this->team];
    $this->server = Server::factory()->create([
        'team_id' => $this->team->id,
        'name' => 'zimacube',
    ]);

    $project = Project::factory()->create(['team_id' => $this->team->id]);
    $environment = Environment::factory()->create(['project_id' => $project->id]);
    $this->application = Application::factory()->create([
        'environment_id' => $environment->id,
        'name' => 'popcornn-client',
        'git_repository' => 'bobdivx/popcorn-client',
    ]);
});

it('attaches and detaches a runner to an application manually', function () {
    $inventory = Mockery::mock(GithubRunnerInventory::class);
    $inventory->shouldReceive('attachApplication')
        ->once()
        ->with(
            Mockery::on(fn (Team $team): bool => $team->id === $this->team->id),
            $this->server->uuid,
            'github-runner-server',
            $this->application->uuid,
            'backend',
        )
        ->andReturn([
            'uuid' => $this->application->uuid,
            'name' => $this->application->name,
            'role' => 'backend',
            'link_source' => 'manual',
        ]);
    $inventory->shouldReceive('detachApplication')
        ->once()
        ->andReturn([
            'ok' => true,
            'message' => 'Lien runner ↔ application supprimé.',
        ]);
    $this->app->instance(GithubRunnerInventory::class, $inventory);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/github/runners/{$this->server->uuid}/github-runner-server/applications", [
            'application_uuid' => $this->application->uuid,
            'role' => 'backend',
        ])
        ->assertCreated()
        ->assertJsonPath('data.role', 'backend');

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->deleteJson("/api/devforge/v1/github/runners/{$this->server->uuid}/github-runner-server/applications/{$this->application->uuid}")
        ->assertSuccessful()
        ->assertJsonPath('data.ok', true);
});

it('persists manual runner application links for a team', function () {
    $linker = new GithubRunnerApplicationLinker;

    $link = $linker->attach(
        $this->team,
        $this->server->uuid,
        'github-runner-tauri',
        $this->application->uuid,
        'desktop',
    );

    expect($link['uuid'])->toBe($this->application->uuid)
        ->and($link['role'])->toBe('desktop')
        ->and(GithubRunnerApplicationLink::query()->count())->toBe(1);

    $enriched = $linker->enrichRunners($this->team, collect([[
        'name' => 'github-runner-tauri',
        'server_uuid' => $this->server->uuid,
    ]]))->first();

    expect($enriched['linked_applications'])->toHaveCount(1)
        ->and($enriched['linked_applications'][0]['role'])->toBe('desktop');

    $linker->detach($this->team, $this->server->uuid, 'github-runner-tauri', $this->application->uuid);
    expect(GithubRunnerApplicationLink::query()->count())->toBe(0);
});
