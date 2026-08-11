<?php

use App\Models\Application;
use App\Services\DevForge\Agent\AgentBrowserService;
use Illuminate\Support\Facades\Http;

it('fetch returns status title and text excerpt', function () {
    Http::fake([
        'https://example.test/*' => Http::response(
            '<html><head><title>Hello App</title></head><body><h1>Welcome</h1><p>Ready</p></body></html>',
            200,
            ['Content-Type' => 'text/html'],
        ),
    ]);

    $result = app(AgentBrowserService::class)->fetch('https://example.test/');

    expect($result['ok'])->toBeTrue()
        ->and($result['status'])->toBe(200)
        ->and($result['title'])->toBe('Hello App')
        ->and($result['text_excerpt'])->toContain('Welcome')
        ->and($result['looks_like_nginx_default'])->toBeFalse();
});

it('detects nginx default page', function () {
    Http::fake([
        'https://bad.test/*' => Http::response(
            '<html><head><title>Welcome to nginx!</title></head><body>Welcome to nginx! If you see this page, the nginx web server is successfully installed</body></html>',
            200,
        ),
    ]);

    $result = app(AgentBrowserService::class)->fetch('https://bad.test/');

    expect($result['looks_like_nginx_default'])->toBeTrue();
});

it('smokeApplication checks fqdn hosts', function () {
    Http::fake([
        'https://app.example.com/*' => Http::response('<html><title>OK</title><body>up</body></html>', 200),
    ]);

    $application = new Application([
        'uuid' => 'app-uuid-1',
        'name' => 'Demo',
        'fqdn' => 'https://app.example.com,app.example.com',
    ]);

    $result = app(AgentBrowserService::class)->smokeApplication($application);

    expect($result['ok'])->toBeTrue()
        ->and($result['checks'])->toHaveCount(1)
        ->and($result['checks'][0]['smoke_ok'])->toBeTrue();
});

it('rejects invalid urls', function () {
    $result = app(AgentBrowserService::class)->fetch('not-a-url');

    expect($result)->toHaveKey('error');
});
