<?php

use App\Models\Application;
use App\Services\DevForge\Readiness\ApplicationDomainProbe;
use Illuminate\Support\Facades\Http;

it('accepts 2xx and 3xx responses', function () {
    Http::fake([
        'https://app.example.com' => Http::response('ok', 302),
    ]);

    $application = new Application(['fqdn' => 'https://app.example.com']);
    $result = app(ApplicationDomainProbe::class)->probe($application);

    expect($result['ok'])->toBeTrue()
        ->and($result['status'])->toBe(302)
        ->and($result['skipped'])->toBeFalse();
});

it('fails on non-success http status', function () {
    Http::fake([
        'https://down.example.com' => Http::response('bad gateway', 502),
    ]);

    $application = new Application(['fqdn' => 'down.example.com']);
    $result = app(ApplicationDomainProbe::class)->probe($application);

    expect($result['ok'])->toBeFalse()
        ->and($result['url'])->toBe('https://down.example.com')
        ->and($result['status'])->toBe(502)
        ->and($result['error'])->not->toBeNull();
});

it('skips when no fqdn is configured', function () {
    $application = new Application(['fqdn' => null]);
    $result = app(ApplicationDomainProbe::class)->probe($application);

    expect($result['ok'])->toBeFalse()
        ->and($result['skipped'])->toBeTrue();
});

it('fails when the stock nginx welcome page is served', function () {
    Http::fake([
        'https://static.example.com' => Http::response(
            '<!DOCTYPE html><html><head><title>Welcome to nginx!</title></head><body><h1>Welcome to nginx!</h1><p>If you see this page, nginx is successfully installed and working.</p></body></html>',
            200,
        ),
    ]);

    $application = new Application(['fqdn' => 'https://static.example.com']);
    $result = app(ApplicationDomainProbe::class)->probe($application);

    expect($result['ok'])->toBeFalse()
        ->and($result['status'])->toBe(200)
        ->and($result['error'])->toContain('publish_directory');
});
