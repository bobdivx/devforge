<?php

it('normalizes an apps wildcard domain from a bare host', function () {
    expect(normalize_apps_wildcard_domain('exemple.com'))->toBe('https://exemple.com')
        ->and(normalize_apps_wildcard_domain('*.apps.maison.local'))->toBe('http://apps.maison.local')
        ->and(normalize_apps_wildcard_domain('https://Apps.Exemple.com/'))->toBe('https://apps.exemple.com')
        ->and(normalize_apps_wildcard_domain('pas-un-domaine'))->toBeNull()
        ->and(normalize_apps_wildcard_domain(''))->toBeNull();
});

it('prefixes https on scheme-less application hosts', function () {
    expect(ensure_fqdn_has_scheme('sonozz.briseteia.me'))->toBe('https://sonozz.briseteia.me')
        ->and(ensure_fqdn_has_scheme('https://app.example.com'))->toBe('https://app.example.com')
        ->and(ensure_fqdn_has_scheme('http://app.local'))->toBe('http://app.local')
        ->and(ensure_fqdn_has_scheme('app.127.0.0.1.sslip.io'))->toBe('http://app.127.0.0.1.sslip.io')
        ->and(ensure_fqdn_has_scheme(''))->toBe('');
});

it('normalizes comma-separated fqdn lists', function () {
    expect(normalize_fqdn_list('sonozz.briseteia.me,https://uuid.briseteia.me'))
        ->toBe('https://sonozz.briseteia.me,https://uuid.briseteia.me')
        ->and(normalize_fqdn_list('https://already.example.com'))->toBe('https://already.example.com')
        ->and(normalize_fqdn_list(''))->toBeNull()
        ->and(normalize_fqdn_list(null))->toBeNull();
});

it('normalizes compose domain json without a scheme', function () {
    $json = json_encode([
        'web' => ['domain' => 'sonozz.example.com'],
        'api' => ['domain' => 'https://api.example.com'],
    ]);

    expect(normalize_compose_domains_json($json))->toBe(json_encode([
        'web' => ['domain' => 'https://sonozz.example.com'],
        'api' => ['domain' => 'https://api.example.com'],
    ]));
});

it('builds traefik host rules for scheme-less domains', function () {
    $labels = fqdnLabelsForTraefik(
        uuid: 'kq5rr0s1qn0hkcs58gflvljk',
        domains: collect(['sonozz.briseteia.me']),
        onlyPort: 4321,
    );

    expect($labels->contains(fn (string $label) => str_contains($label, 'Host(`sonozz.briseteia.me`)')))->toBeTrue()
        ->and($labels->contains(fn (string $label) => str_contains($label, 'Host(``)')))->toBeFalse()
        ->and($labels->contains(fn (string $label) => str_contains($label, 'PathPrefix(`sonozz.briseteia.me`)')))->toBeFalse()
        ->and($labels->contains(fn (string $label) => str_contains($label, 'entryPoints=https')))->toBeTrue();
});

it('attaches the sso traefik middleware from service labels', function () {
    $labels = fqdnLabelsForTraefik(
        uuid: 'kq5rr0s1qn0hkcs58gflvljk',
        domains: collect(['https://app.example.com']),
        onlyPort: 80,
        serviceLabels: collect(['coolify.traefik.middlewares=devforge-sso-auth']),
    );

    expect($labels->contains(fn (string $label) => str_contains($label, 'devforge-sso-auth')))->toBeTrue();
});

it('builds a dns slug from the application name', function () {
    expect(application_url_slug('Star Base FR', 'uuid-fallback'))->toBe('star-base-fr')
        ->and(application_url_slug('starbasefr', 'uuid-fallback'))->toBe('starbasefr')
        ->and(application_url_slug('!!!', 'AbcDef'))->toBe('abcdef');
});
