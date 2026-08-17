<?php

use App\Models\Application;
use App\Models\Environment;
use App\Models\Project;
use App\Models\Server;
use App\Models\StandaloneDocker;
use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\Application\FqdnSchemeRepair;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->user = User::factory()->create();
    $this->team = $this->user->teams()->firstOrFail();
    $this->server = Server::factory()->create([
        'team_id' => $this->team->id,
    ]);
    $this->server->settings->update([
        'wildcard_domain' => 'https://apps.example.com',
    ]);
    $this->destination = $this->server->standaloneDockers()->firstOrFail();
    $this->project = Project::factory()->create(['team_id' => $this->team->id]);
    $this->environment = Environment::factory()->create(['project_id' => $this->project->id]);

    $this->application = Application::factory()->create([
        'name' => 'sonozz',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
        'git_repository' => 'acme/sonozz',
        'git_branch' => 'main',
        'build_pack' => 'nixpacks',
        'fqdn' => 'https://uuid.apps.example.com',
        'redirect' => 'both',
    ]);
});

it('normalizes scheme-less domains when an application is saved', function () {
    $this->application->fqdn = 'sonozz.example.com,https://uuid.apps.example.com';
    $this->application->save();

    expect($this->application->fresh()->fqdn)->toBe('https://sonozz.example.com,https://uuid.apps.example.com');
});

it('repairs persisted scheme-less application fqdns and regenerates proxy labels', function () {
    $this->application->forceFill([
        'fqdn' => 'sonozz.example.com,https://uuid.apps.example.com',
    ])->saveQuietly();

    $result = app(FqdnSchemeRepair::class)->repair(redeploy: false);

    $application = $this->application->fresh();
    $labels = base64_decode((string) $application->custom_labels);

    expect($result['applications'])->toBe(1)
        ->and($application->fqdn)->toBe('https://sonozz.example.com,https://uuid.apps.example.com')
        ->and($labels)->toContain('Host(`sonozz.example.com`)')
        ->and($labels)->not->toContain('Host(``)')
        ->and($labels)->not->toContain('PathPrefix(`sonozz.example.com`)');
});

it('leaves already-valid fqdns unchanged', function () {
    $result = app(FqdnSchemeRepair::class)->repair(redeploy: false);

    expect($result['applications'])->toBe(0)
        ->and($this->application->fresh()->fqdn)->toBe('https://uuid.apps.example.com');
});

it('always includes a scheme when generating compose fqdns', function () {
    $fqdn = generateFqdn($this->server, 'sonozz', parserVersion: 5);

    expect($fqdn)->toBe('https://sonozz.apps.example.com');
});

it('runs from the artisan command', function () {
    $this->application->forceFill([
        'fqdn' => 'bare.example.com',
    ])->saveQuietly();

    $this->artisan('devforge:repair-fqdn-schemes')
        ->assertSuccessful();

    expect($this->application->fresh()->fqdn)->toBe('https://bare.example.com');
});

it('is invoked during app init so every install is repaired', function () {
    expect(file_get_contents(app_path('Console/Commands/Init.php')))
        ->toContain('devforge:repair-fqdn-schemes');
});
