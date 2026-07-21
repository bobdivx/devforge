<?php

use App\Models\Application;
use App\Models\GithubApp;
use App\Services\DevForge\Application\GithubPackagesBuildAuthInjector;

it('skips injection when a user token key is already present', function () {
    $injector = new GithubPackagesBuildAuthInjector;
    $application = new Application;

    expect($injector->buildTimeAdditions($application, ['NODE_AUTH_TOKEN' => 'user-pat']))->toBe([])
        ->and($injector->hasUserToken(['NPM_TOKEN' => 'x']))->toBeTrue()
        ->and($injector->hasUserToken(['FOO' => 'bar']))->toBeFalse();
});

it('detects packages read permission levels', function () {
    $injector = new GithubPackagesBuildAuthInjector;

    expect($injector->hasPackagesRead(['packages' => 'read']))->toBeTrue()
        ->and($injector->hasPackagesRead(['packages' => 'write']))->toBeTrue()
        ->and($injector->hasPackagesRead(['contents' => 'read']))->toBeFalse()
        ->and($injector->hasPackagesRead([]))->toBeFalse();
});

it('diagnoses missing github app as needs pat', function () {
    $application = Mockery::mock(Application::class)->makePartial();
    $application->shouldReceive('loadMissing')->with('source')->andReturnSelf();
    $application->source = null;

    $diagnosis = (new GithubPackagesBuildAuthInjector)->diagnose($application);

    expect($diagnosis['has_github_app'])->toBeFalse()
        ->and($diagnosis['can_auto_redeploy'])->toBeFalse()
        ->and($diagnosis['ok'])->toBeFalse()
        ->and($diagnosis['steps'][0] ?? '')->toContain('PAT');
});

it('diagnoses github app without packages permission', function () {
    $githubApp = new GithubApp([
        'name' => 'coolify-test',
        'is_public' => false,
        'installation_id' => 123,
        'api_url' => 'https://api.github.com',
    ]);

    $application = Mockery::mock(Application::class)->makePartial();
    $application->shouldReceive('loadMissing')->with('source')->andReturnSelf();
    $application->source = $githubApp;

    $injector = Mockery::mock(GithubPackagesBuildAuthInjector::class)->makePartial();
    $injector->shouldReceive('installationPermissions')->andReturn(['contents' => 'read', 'metadata' => 'read']);
    $injector->shouldReceive('permissionsUrl')->andReturn('https://github.com/settings/apps/coolify-test/permissions');

    $diagnosis = $injector->diagnose($application);

    expect($diagnosis['has_github_app'])->toBeTrue()
        ->and($diagnosis['has_packages_permission'])->toBeFalse()
        ->and($diagnosis['has_packages_token'])->toBeFalse()
        ->and($diagnosis['can_auto_redeploy'])->toBeFalse()
        ->and($diagnosis['error'])->toContain('Aucun token Packages')
        ->and(implode(' ', $diagnosis['steps']))->toContain('Connexions');
});

it('allows auto redeploy when a packages PAT is registered', function () {
    $githubApp = new GithubApp([
        'name' => 'coolify-test',
        'is_public' => false,
        'installation_id' => 123,
        'api_url' => 'https://api.github.com',
    ]);
    $githubApp->packages_token = 'ghp_test_pat';

    $application = Mockery::mock(Application::class)->makePartial();
    $application->shouldReceive('loadMissing')->with('source')->andReturnSelf();
    $application->source = $githubApp;

    $injector = Mockery::mock(GithubPackagesBuildAuthInjector::class)->makePartial();
    $injector->shouldReceive('installationPermissions')->andReturn(['contents' => 'read']);
    $injector->shouldReceive('permissionsUrl')->andReturn(null);

    $diagnosis = $injector->diagnose($application);

    expect($diagnosis['ok'])->toBeTrue()
        ->and($diagnosis['can_auto_redeploy'])->toBeTrue()
        ->and($diagnosis['has_packages_token'])->toBeTrue()
        ->and($injector->resolveBuildToken($githubApp))->toBe('ghp_test_pat');
});

it('allows auto redeploy when packages permission is present', function () {
    $githubApp = new GithubApp([
        'name' => 'coolify-test',
        'is_public' => false,
        'installation_id' => 123,
        'api_url' => 'https://api.github.com',
    ]);

    $application = Mockery::mock(Application::class)->makePartial();
    $application->shouldReceive('loadMissing')->with('source')->andReturnSelf();
    $application->source = $githubApp;

    $injector = Mockery::mock(GithubPackagesBuildAuthInjector::class)->makePartial();
    $injector->shouldReceive('installationPermissions')->andReturn(['packages' => 'read', 'contents' => 'read']);
    $injector->shouldReceive('installationToken')->andReturn('ghs_test_token');
    $injector->shouldReceive('permissionsUrl')->andReturn(null);

    $diagnosis = $injector->diagnose($application);

    expect($diagnosis['ok'])->toBeTrue()
        ->and($diagnosis['can_auto_redeploy'])->toBeTrue()
        ->and($diagnosis['has_packages_permission'])->toBeTrue();
});
