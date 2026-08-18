<?php

namespace App\Services\DevForge\Github;

use App\Models\GithubApp;
use Illuminate\Support\Facades\Http;

class GithubAppHookUrlSynchronizer
{
    public function publicBaseUrl(): ?string
    {
        $settings = instanceSettings();
        $fqdn = is_string($settings->fqdn) ? trim($settings->fqdn) : '';
        if ($fqdn === '') {
            return null;
        }

        if (! str_starts_with($fqdn, 'http://') && ! str_starts_with($fqdn, 'https://')) {
            $fqdn = 'https://'.$fqdn;
        }

        $fqdn = rtrim($fqdn, '/');

        return $this->isPubliclyReachable($fqdn) ? $fqdn : null;
    }

    public function eventsUrl(): ?string
    {
        $base = $this->publicBaseUrl();

        return $base !== null ? $base.'/webhooks/source/github/events' : null;
    }

    public function isPubliclyReachable(string $url): bool
    {
        $parts = parse_url($url);
        $host = strtolower((string) ($parts['host'] ?? ''));
        $scheme = strtolower((string) ($parts['scheme'] ?? ''));

        if ($host === '' || ! in_array($scheme, ['http', 'https'], true)) {
            return false;
        }

        if (in_array($host, ['localhost', '127.0.0.1', '::1', 'host.docker.internal'], true)) {
            return false;
        }

        foreach (['.local', '.lan', '.home', '.internal'] as $suffix) {
            if (str_ends_with($host, $suffix)) {
                return false;
            }
        }

        if (filter_var($host, FILTER_VALIDATE_IP)) {
            $flags = FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE;

            return filter_var($host, FILTER_VALIDATE_IP, $flags) !== false
                && ($scheme === 'https' || (function_exists('isDev') && isDev()));
        }

        return $scheme === 'https' || (function_exists('isDev') && isDev());
    }

    public function sync(GithubApp $githubApp, string $jwt): void
    {
        $desired = $this->eventsUrl();
        if ($desired === null || blank($githubApp->app_id)) {
            return;
        }

        $headers = [
            'Authorization' => 'Bearer '.$jwt,
            'Accept' => 'application/vnd.github+json',
            'X-GitHub-Api-Version' => '2022-11-28',
        ];

        $current = Http::withHeaders($headers)
            ->timeout(10)
            ->connectTimeout(5)
            ->get(rtrim((string) $githubApp->api_url, '/').'/app/hook/config');

        if (! $current->successful()) {
            return;
        }

        $currentUrl = rtrim((string) $current->json('url'), '/');
        if ($currentUrl === rtrim($desired, '/')) {
            return;
        }

        Http::withHeaders($headers)
            ->timeout(10)
            ->connectTimeout(5)
            ->patch(rtrim((string) $githubApp->api_url, '/').'/app/hook/config', [
                'url' => $desired,
                'content_type' => 'json',
                'insecure_ssl' => '0',
            ])
            ->throw();
    }
}
