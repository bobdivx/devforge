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
