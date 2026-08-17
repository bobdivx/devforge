<?php

use App\Models\Server;

function instance_apps_wildcard_domain(): ?string
{
    try {
        $value = instanceSettings()->apps_wildcard_domain;
    } catch (Throwable) {
        return null;
    }

    return filled($value) ? (string) $value : null;
}

function resolve_application_wildcard(Server $server): string
{
    $wildcard = data_get($server, 'settings.wildcard_domain');
    if (filled($wildcard)) {
        return (string) $wildcard;
    }

    $instanceWildcard = instance_apps_wildcard_domain();
    if (filled($instanceWildcard)) {
        return $instanceWildcard;
    }

    return sslip($server);
}

/**
 * Traefik/Caddy treat a scheme-less value as a path, not a host
 * (`Host(``) && PathPrefix(`app.example.com`)` → HTTP 404).
 */
function ensure_fqdn_has_scheme(string $domain, ?string $defaultScheme = null): string
{
    $domain = trim($domain);
    if ($domain === '') {
        return $domain;
    }

    if (preg_match('#^[a-z][a-z0-9+.-]*://#i', $domain) === 1) {
        return $domain;
    }

    $scheme = $defaultScheme ?: fqdn_default_scheme_for_host($domain);

    return $scheme.'://'.$domain;
}

function fqdn_default_scheme_for_host(string $host): string
{
    $host = strtolower(trim($host));
    $host = (string) preg_replace('#^[a-z][a-z0-9+.-]*://#i', '', $host);
    $host = explode('/', $host, 2)[0] ?? $host;
    $host = explode(':', $host, 2)[0] ?? $host;

    if (
        str_ends_with($host, '.local')
        || str_contains($host, 'sslip.io')
        || str_contains($host, 'zimacube')
        || filter_var($host, FILTER_VALIDATE_IP)
    ) {
        return 'http';
    }

    return 'https';
}

function normalize_fqdn_list(?string $fqdn): ?string
{
    if ($fqdn === null) {
        return null;
    }

    $normalized = str($fqdn)
        ->explode(',')
        ->map(fn (string $domain): string => trim($domain))
        ->filter()
        ->map(fn (string $domain): string => ensure_fqdn_has_scheme($domain))
        ->unique()
        ->values();

    if ($normalized->isEmpty()) {
        return null;
    }

    return $normalized->implode(',');
}

function normalize_compose_domains_json(?string $json): ?string
{
    if ($json === null || trim($json) === '') {
        return $json;
    }

    $decoded = json_decode($json, true);
    if (! is_array($decoded)) {
        return $json;
    }

    $changed = false;
    foreach ($decoded as $key => $value) {
        if (is_string($value)) {
            $normalized = normalize_fqdn_list($value) ?? $value;
            if ($normalized !== $value) {
                $decoded[$key] = $normalized;
                $changed = true;
            }

            continue;
        }

        if (! is_array($value) || ! isset($value['domain']) || ! is_string($value['domain'])) {
            continue;
        }

        $normalized = normalize_fqdn_list($value['domain']);
        if ($normalized !== null && $normalized !== $value['domain']) {
            $decoded[$key]['domain'] = $normalized;
            $changed = true;
        }
    }

    return $changed ? json_encode($decoded) : $json;
}

function normalize_apps_wildcard_domain(?string $value): ?string
{
    if ($value === null) {
        return null;
    }

    $host = trim($value);
    if ($host === '') {
        return null;
    }

    $host = (string) preg_replace('#^https?://#i', '', $host);
    $host = rtrim($host, '/');
    $host = (string) preg_replace('#^\*\.#', '', $host);
    $host = strtolower($host);

    if ($host === '' || ! str_contains($host, '.') || ! preg_match('/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/', $host)) {
        return null;
    }

    $scheme = str_ends_with($host, '.local')
        || str_contains($host, 'zimacube')
        || filter_var($host, FILTER_VALIDATE_IP)
        ? 'http'
        : 'https';

    return $scheme.'://'.$host;
}

function application_url_slug(string $name, string $fallback): string
{
    $slug = str($name)
        ->ascii()
        ->lower()
        ->replaceMatches('/[^a-z0-9]+/', '-')
        ->trim('-')
        ->substr(0, 63)
        ->trim('-')
        ->toString();

    if ($slug === '' || ! preg_match('/^[a-z0-9]/', $slug)) {
        return str($fallback)->lower()->substr(0, 63)->toString();
    }

    return $slug;
}
