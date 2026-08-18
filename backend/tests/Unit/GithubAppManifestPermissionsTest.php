<?php

use App\Services\DevForge\Github\GithubAppManifestPermissions;

it('requests every github permission devforge needs at app registration', function () {
    expect(GithubAppManifestPermissions::permissions())->toBe([
        'contents' => 'write',
        'metadata' => 'read',
        'emails' => 'read',
        'administration' => 'write',
        'packages' => 'read',
        'actions' => 'write',
        'workflows' => 'write',
        'pull_requests' => 'write',
    ]);
});

it('subscribes to push and pull request events at app registration', function () {
    expect(GithubAppManifestPermissions::events())->toBe(['push', 'pull_request']);
});

it('builds github app permission and installation settings urls', function () {
    $githubApp = new \App\Models\GithubApp([
        'name' => 'devforgezimaos',
        'html_url' => 'https://github.com',
        'installation_id' => 154217861,
    ]);

    expect(GithubAppManifestPermissions::permissionsUrl($githubApp))
        ->toBe('https://github.com/settings/apps/devforgezimaos/permissions')
        ->and(GithubAppManifestPermissions::installationSettingsUrl($githubApp))
        ->toBe('https://github.com/settings/installations/154217861');
});
