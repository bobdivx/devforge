<?php

use App\Models\GithubApp;
use App\Services\DevForge\Github\GithubAppCatalog;
use Illuminate\Support\Facades\Http;
use Illuminate\Validation\ValidationException;

it('returns a registration token from the packages token candidate', function () {
    Http::fake([
        'https://api.github.com/repos/bobdivx/popcorn-client/actions/runners/registration-token' => Http::response([
            'token' => 'REGISTRATION_TOKEN',
            'expires_at' => '2026-08-10T12:00:00Z',
        ], 201),
    ]);

    $githubApp = new GithubApp([
        'api_url' => 'https://api.github.com',
        'packages_token' => 'ghp_packages',
    ]);

    $result = (new GithubAppCatalog)->registrationToken($githubApp, 'bobdivx', 'popcorn-client');

    expect($result['token'])->toBe('REGISTRATION_TOKEN')
        ->and($result['expires_at'])->toBe('2026-08-10T12:00:00Z');
});

it('throws a validation error when github denies runner registration', function () {
    Http::fake([
        'https://api.github.com/repos/bobdivx/popcorn-client/actions/runners/registration-token' => Http::response([
            'message' => 'Resource not accessible by integration',
        ], 403),
    ]);

    $githubApp = new GithubApp([
        'name' => 'devforgezimaos',
        'html_url' => 'https://github.com',
        'installation_id' => 154217861,
        'api_url' => 'https://api.github.com',
        'packages_token' => 'ghp_packages',
    ]);

    try {
        (new GithubAppCatalog)->registrationToken($githubApp, 'bobdivx', 'popcorn-client');
        expect(false)->toBeTrue('Expected ValidationException');
    } catch (ValidationException $exception) {
        expect($exception->errors()['github_app_uuid'][0] ?? '')
            ->toContain('Permission insuffisante')
            ->toContain('bobdivx/popcorn-client')
            ->toContain('Administration')
            ->toContain('settings/apps');
    }
});

it('throws a validation error when no github token candidates are available', function () {
    $githubApp = new GithubApp([
        'api_url' => 'https://api.github.com',
        'packages_token' => null,
        'app_id' => null,
        'installation_id' => null,
        'private_key_id' => null,
    ]);

    expect(fn () => (new GithubAppCatalog)->registrationToken($githubApp, 'bobdivx', 'popcorn-client'))
        ->toThrow(ValidationException::class);
});
