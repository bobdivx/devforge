<?php

it('returns the configured product name', function () {
    config(['app.name' => 'DevForge']);

    expect(product_name())->toBe('DevForge');
});

it('prefers a custom domain over sslip and uuid-managed urls', function () {
    $uuid = 'abc123uuid';
    $fqdn = "http://{$uuid}.127.0.0.1.sslip.io,https://app.example.com,http://{$uuid}.apps.example.com";

    expect(preferred_fqdn($fqdn, $uuid))->toBe('https://app.example.com');
});

it('falls back to the first domain when only provisional urls exist', function () {
    $uuid = 'abc123uuid';
    $fqdn = "http://{$uuid}.127.0.0.1.sslip.io,http://{$uuid}.apps.example.com";

    expect(preferred_fqdn($fqdn, $uuid))->toBe("http://{$uuid}.127.0.0.1.sslip.io");
});

it('prefers https among custom domains', function () {
    $fqdn = 'http://app.example.com,https://secure.example.com';

    expect(preferred_fqdn($fqdn))->toBe('https://secure.example.com');
});

it('returns null for empty fqdn lists', function () {
    expect(preferred_fqdn(null))->toBeNull()
        ->and(preferred_fqdn(''))->toBeNull()
        ->and(preferred_fqdn(' , '))->toBeNull();
});

it('detects provisional domains', function () {
    $uuid = 'abc123uuid';

    expect(is_provisional_fqdn("http://{$uuid}.127.0.0.1.sslip.io", $uuid))->toBeTrue()
        ->and(is_provisional_fqdn("https://{$uuid}.apps.example.com", $uuid))->toBeTrue()
        ->and(is_provisional_fqdn('https://app.example.com', $uuid))->toBeFalse();
});
