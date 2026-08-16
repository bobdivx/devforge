<?php

it('normalizes an apps wildcard domain from a bare host', function () {
    expect(normalize_apps_wildcard_domain('exemple.com'))->toBe('https://exemple.com')
        ->and(normalize_apps_wildcard_domain('*.apps.maison.local'))->toBe('http://apps.maison.local')
        ->and(normalize_apps_wildcard_domain('https://Apps.Exemple.com/'))->toBe('https://apps.exemple.com')
        ->and(normalize_apps_wildcard_domain('pas-un-domaine'))->toBeNull()
        ->and(normalize_apps_wildcard_domain(''))->toBeNull();
});

it('builds a dns slug from the application name', function () {
    expect(application_url_slug('Star Base FR', 'uuid-fallback'))->toBe('star-base-fr')
        ->and(application_url_slug('starbasefr', 'uuid-fallback'))->toBe('starbasefr')
        ->and(application_url_slug('!!!', 'AbcDef'))->toBe('abcdef');
});
