<?php

use App\Models\Application;
use App\Services\DevForge\Store\StoreListingPublisher;

it('detects secret environment keys and public prefixes', function () {
    $publisher = app(StoreListingPublisher::class);

    expect($publisher->looksLikeSecret('API_TOKEN'))->toBeTrue()
        ->and($publisher->looksLikeSecret('DATABASE_PASSWORD'))->toBeTrue()
        ->and($publisher->looksLikeSecret('APP_KEY'))->toBeTrue()
        ->and($publisher->looksLikeSecret('NEXT_PUBLIC_API_URL'))->toBeFalse()
        ->and($publisher->looksLikeSecret('PUBLIC_SITE_NAME'))->toBeFalse()
        ->and($publisher->looksLikeSecret('APP_NAME'))->toBeFalse();
});

it('normalizes github repository urls to owner/repo', function () {
    $publisher = app(StoreListingPublisher::class);

    expect($publisher->normalizeGitRepository('https://github.com/acme/demo-app.git'))->toBe('acme/demo-app')
        ->and($publisher->normalizeGitRepository('git@github.com:acme/demo-app.git'))->toBe('acme/demo-app')
        ->and($publisher->normalizeGitRepository('acme/demo-app'))->toBe('acme/demo-app');
});

it('blocks publishing when the application is not running', function () {
    $application = new Application([
        'status' => 'exited',
        'git_repository' => 'acme/demo-app',
        'git_branch' => 'main',
    ]);

    expect(app(StoreListingPublisher::class)->unpublishedReason($application))
        ->toBe('L’application doit être en cours d’exécution pour être publiée sur le Store.');
});
