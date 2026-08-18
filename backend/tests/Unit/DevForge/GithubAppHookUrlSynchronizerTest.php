<?php

use App\Models\GithubApp;
use App\Models\InstanceSettings;
use App\Services\DevForge\Github\GithubAppHookUrlSynchronizer;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;

uses(RefreshDatabase::class);

beforeEach(function () {
    InstanceSettings::unguarded(fn (): InstanceSettings => InstanceSettings::query()->create([
        'id' => 0,
        'fqdn' => 'https://web.briseteia.me',
    ]));
});

it('rejects local and private webhook hosts', function (string $url) {
    expect((new GithubAppHookUrlSynchronizer)->isPubliclyReachable($url))->toBeFalse();
})->with([
    'http://zimacube.local:8080',
    'https://zimacube.local',
    'http://localhost:8080',
    'http://127.0.0.1:8080',
    'http://192.168.1.10:8080',
    'http://10.0.0.5',
    'http://host.docker.internal:8080',
]);

it('accepts a public https fqdn', function () {
    expect((new GithubAppHookUrlSynchronizer)->isPubliclyReachable('https://web.briseteia.me'))->toBeTrue();
});

it('builds the public github events webhook url from instance fqdn', function () {
    $sync = new GithubAppHookUrlSynchronizer;

    expect($sync->publicBaseUrl())->toBe('https://web.briseteia.me')
        ->and($sync->eventsUrl())->toBe('https://web.briseteia.me/webhooks/source/github/events');
});

it('patches a github app hook url still pointing at a local host', function () {
    Http::fake([
        'https://api.github.com/app/hook/config' => Http::sequence()
            ->push(['url' => 'http://zimacube.local:8080/webhooks/source/github/events', 'content_type' => 'json'], 200)
            ->push(['url' => 'https://web.briseteia.me/webhooks/source/github/events', 'content_type' => 'json'], 200),
    ]);

    $githubApp = new GithubApp([
        'app_id' => 4615578,
        'api_url' => 'https://api.github.com',
    ]);

    (new GithubAppHookUrlSynchronizer)->sync($githubApp, 'jwt-token');

    Http::assertSent(function ($request): bool {
        return $request->method() === 'PATCH'
            && $request->url() === 'https://api.github.com/app/hook/config'
            && $request['url'] === 'https://web.briseteia.me/webhooks/source/github/events';
    });
});
