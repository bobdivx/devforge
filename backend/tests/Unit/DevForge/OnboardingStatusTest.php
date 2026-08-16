<?php

use App\Models\GithubApp;
use App\Models\InstanceSettings;
use App\Models\S3Storage;
use App\Models\Server;
use App\Models\Team;
use App\Services\DevForge\Onboarding\OnboardingStatus;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

it('marks only the account step as done on a fresh team', function () {
    $team = Team::factory()->create();

    expect((new OnboardingStatus)->steps($team))->toBe([
        'account' => true,
        'domain' => false,
        'github' => false,
        's3' => false,
        'server' => false,
    ]);
});

it('marks github s3 and server when the team already configured them', function () {
    $team = Team::factory()->create();

    GithubApp::create([
        'name' => 'DevForge GitHub',
        'api_url' => 'https://api.github.com',
        'html_url' => 'https://github.com',
        'app_id' => 123,
        'installation_id' => 456,
        'team_id' => $team->id,
        'is_public' => false,
    ]);
    S3Storage::create([
        'name' => 'Backups',
        'region' => 'eu-west-1',
        'key' => 'key',
        'secret' => 'secret',
        'bucket' => 'backups',
        'endpoint' => 'https://s3.example.com',
        'team_id' => $team->id,
    ]);
    Server::factory()->create(['team_id' => $team->id]);

    expect((new OnboardingStatus)->steps($team))->toBe([
        'account' => true,
        'domain' => false,
        'github' => true,
        's3' => true,
        'server' => true,
    ]);
});

it('marks domain when the apps wildcard is set', function () {
    $team = Team::factory()->create();

    InstanceSettings::unguarded(fn (): InstanceSettings => InstanceSettings::query()->create([
        'id' => 0,
        'instance_name' => 'DevForge',
        'instance_timezone' => 'UTC',
        'apps_wildcard_domain' => 'https://exemple.com',
        'public_port_min' => 1025,
        'public_port_max' => 65535,
        'is_registration_enabled' => false,
        'disable_two_step_confirmation' => false,
        'is_auto_update_enabled' => false,
        'auto_update_frequency' => '0 0 * * *',
        'update_check_frequency' => '0 * * * *',
    ]));

    expect((new OnboardingStatus)->steps($team)['domain'])->toBeTrue();
});

it('does not mark domain when only the instance fqdn is set', function () {
    $team = Team::factory()->create();

    InstanceSettings::unguarded(fn (): InstanceSettings => InstanceSettings::query()->create([
        'id' => 0,
        'instance_name' => 'DevForge',
        'instance_timezone' => 'UTC',
        'fqdn' => 'http://zimacube.local:8080',
        'public_port_min' => 1025,
        'public_port_max' => 65535,
        'is_registration_enabled' => false,
        'disable_two_step_confirmation' => false,
        'is_auto_update_enabled' => false,
        'auto_update_frequency' => '0 0 * * *',
        'update_check_frequency' => '0 * * * *',
    ]));

    expect((new OnboardingStatus)->steps($team)['domain'])->toBeFalse();
});

it('does not mark github as done before the app is installed', function () {
    $team = Team::factory()->create();

    GithubApp::create([
        'name' => 'Pending install',
        'api_url' => 'https://api.github.com',
        'html_url' => 'https://github.com',
        'app_id' => 123,
        'team_id' => $team->id,
        'is_public' => false,
    ]);

    expect((new OnboardingStatus)->steps($team)['github'])->toBeFalse();
});

it('ignores the public github source when checking the github step', function () {
    $team = Team::factory()->create();

    GithubApp::create([
        'name' => 'Public GitHub',
        'api_url' => 'https://api.github.com',
        'html_url' => 'https://github.com',
        'team_id' => $team->id,
        'is_public' => true,
    ]);

    expect((new OnboardingStatus)->steps($team)['github'])->toBeFalse();
});
