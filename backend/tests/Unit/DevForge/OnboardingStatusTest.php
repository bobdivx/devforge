<?php

use App\Models\GithubApp;
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
        'github' => true,
        's3' => true,
        'server' => true,
    ]);
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
