<?php

use App\Models\Application;
use App\Models\Environment;
use App\Models\Project;
use App\Models\Server;
use App\Models\StandaloneDocker;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->user = User::factory()->create();
    $this->team = $this->user->teams()->firstOrFail();

    $server = Server::factory()->create(['team_id' => $this->team->id]);
    $destination = $server->standaloneDockers()->firstOrFail();
    $project = Project::factory()->create(['team_id' => $this->team->id]);
    $environment = Environment::factory()->create(['project_id' => $project->id]);

    $this->application = Application::factory()->create([
        'environment_id' => $environment->id,
        'destination_id' => $destination->id,
        'destination_type' => StandaloneDocker::class,
        'build_pack' => 'nixpacks',
        'ports_exposes' => '4321',
        'fqdn' => 'https://mf3d.app',
        'custom_labels' => base64_encode(implode("\n", [
            'traefik.enable=true',
            'traefik.http.services.http-0-test.loadbalancer.server.port=80',
            'traefik.http.services.https-0-test.loadbalancer.server.port=80',
        ])),
    ]);

    $this->application->settings()->update([
        'is_static' => false,
        'is_container_label_readonly_enabled' => true,
    ]);
});

it('detects stale Traefik loadbalancer ports against ports_exposes', function () {
    expect(applicationExpectedProxyPort($this->application))->toBe('4321')
        ->and(applicationProxyLabelsNeedPortSync($this->application))->toBeTrue();
});

it('regenerates custom_labels to match ports_exposes', function () {
    $labels = syncApplicationProxyLabels($this->application->fresh(['settings', 'destination.server']));

    $this->application->refresh();
    $decoded = base64_decode((string) $this->application->custom_labels);

    expect($labels)->not->toBeEmpty()
        ->and(applicationProxyLabelsNeedPortSync($this->application))->toBeFalse()
        ->and($decoded)->toContain('loadbalancer.server.port=4321')
        ->and($decoded)->not->toContain('loadbalancer.server.port=80');
});
