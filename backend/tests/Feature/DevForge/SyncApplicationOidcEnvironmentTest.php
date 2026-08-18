<?php

use App\Models\Application;
use App\Models\Environment;
use App\Models\EnvironmentVariable;
use App\Models\InstanceSettings;
use App\Models\Project;
use App\Models\Server;
use App\Models\StandaloneDocker;
use App\Models\Team;
use App\Services\DevForge\Sso\SyncApplicationOidcEnvironment;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Once;

uses(RefreshDatabase::class);

beforeEach(function () {
    InstanceSettings::unguarded(fn (): InstanceSettings => InstanceSettings::query()->create([
        'id' => 0,
        'fqdn' => 'https://forge.exemple.com',
        'apps_wildcard_domain' => 'https://apps.exemple.com',
        'instance_name' => 'DevForge',
        'instance_timezone' => 'UTC',
        'public_port_min' => 1025,
        'public_port_max' => 65535,
        'is_registration_enabled' => false,
        'disable_two_step_confirmation' => false,
        'is_auto_update_enabled' => false,
        'auto_update_frequency' => '0 0 * * *',
        'update_check_frequency' => '0 * * * *',
        'sso_protect_apps_by_default' => true,
        'sso_hide_local_login' => false,
        'sso_apps_client_id' => 'apps-id',
        'sso_apps_client_secret' => 'apps-secret',
    ]));
    Once::flush();

    $this->team = Team::factory()->create();
    $this->server = Server::factory()->create(['team_id' => $this->team->id]);
    $this->destination = StandaloneDocker::where('server_id', $this->server->id)->first();
    $this->project = Project::factory()->create(['team_id' => $this->team->id]);
    $this->environment = Environment::factory()->create(['project_id' => $this->project->id]);
    $this->application = Application::factory()->create([
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => $this->destination->getMorphClass(),
    ]);
});

it('persists pocket id oidc variables on the application so they appear in the env ui', function () {
    $count = app(SyncApplicationOidcEnvironment::class)->sync($this->application);

    expect($count)->toBeGreaterThan(0);

    $oidc = $this->application->environment_variables()->where('key', 'OIDC_ISSUER')->first();
    expect($oidc)->not->toBeNull()
        ->and($oidc->value)->toBe('https://id.apps.exemple.com')
        ->and($oidc->comment)->toBe(SyncApplicationOidcEnvironment::AUTO_COMMENT)
        ->and($oidc->is_runtime)->toBeTrue()
        ->and($this->application->environment_variables()->where('key', 'OIDC_CLIENT_ID')->value('value'))->toBe('apps-id')
        ->and($this->application->environment_variables_preview()->where('key', 'OIDC_ISSUER')->exists())->toBeTrue();
});

it('persists AUTH_URL from the application public origin so Auth.js uses https callbacks', function () {
    $this->application->update([
        'fqdn' => 'https://starbasefr.com,https://starbasefr.exemple.com',
    ]);

    app(SyncApplicationOidcEnvironment::class)->sync($this->application);

    expect($this->application->environment_variables()->where('key', 'AUTH_URL')->value('value'))
        ->toBe('https://starbasefr.com')
        ->and($this->application->environment_variables()->where('key', 'AUTH_TRUST_HOST')->value('value'))
        ->toBe('true');
});

it('does not overwrite a user-defined oidc client id', function () {
    EnvironmentVariable::create([
        'key' => 'OIDC_CLIENT_ID',
        'value' => 'custom-app-client',
        'comment' => null,
        'resourceable_type' => Application::class,
        'resourceable_id' => $this->application->id,
        'is_preview' => false,
        'is_runtime' => true,
        'is_buildtime' => true,
    ]);

    app(SyncApplicationOidcEnvironment::class)->sync($this->application);

    expect($this->application->environment_variables()->where('key', 'OIDC_CLIENT_ID')->value('value'))
        ->toBe('custom-app-client')
        ->and($this->application->environment_variables()->where('key', 'OIDC_ISSUER')->value('value'))
        ->toBe('https://id.apps.exemple.com');
});

it('does nothing when the instance oidc client is not configured', function () {
    InstanceSettings::get()->update([
        'sso_apps_client_id' => null,
        'sso_apps_client_secret' => null,
    ]);
    Once::flush();

    $count = app(SyncApplicationOidcEnvironment::class)->sync($this->application);

    expect($count)->toBe(0)
        ->and($this->application->environment_variables()->where('key', 'OIDC_ISSUER')->exists())->toBeFalse();
});
