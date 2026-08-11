<?php

namespace App\Services\DevForge\Agent;

use App\Models\Application;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * Fetch / smoke HTTP léger (inspiration Hermes browser, sans CDP).
 * Suffisant pour valider un domaine public post-deploy.
 */
class AgentBrowserService
{
    /**
     * @return array<string, mixed>
     */
    public function fetch(string $url, string $method = 'GET', int $maxChars = 4000): array
    {
        $url = trim($url);
        if ($url === '' || ! filter_var($url, FILTER_VALIDATE_URL)) {
            return ['error' => 'URL invalide.'];
        }

        $scheme = strtolower((string) parse_url($url, PHP_URL_SCHEME));
        if (! in_array($scheme, ['http', 'https'], true)) {
            return ['error' => 'Seuls http/https sont autorisés.'];
        }

        $method = strtoupper($method) === 'HEAD' ? 'HEAD' : 'GET';
        $maxChars = max(200, min(20000, $maxChars));

        try {
            $response = Http::timeout(20)
                ->withHeaders([
                    'User-Agent' => 'DevForge-AgentBrowser/1.0',
                    'Accept' => 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                ])
                ->withOptions(['allow_redirects' => ['max' => 5]])
                ->send($method, $url);

            $body = $method === 'HEAD' ? '' : (string) $response->body();
            $contentType = (string) ($response->header('Content-Type') ?? '');
            $title = $this->extractTitle($body);
            $text = $this->extractText($body, $maxChars);
            $looksLikeNginxDefault = $this->looksLikeNginxDefault($title, $text, $body);

            $finalUrl = $url;
            try {
                $effective = $response->effectiveUri();
                if ($effective !== null) {
                    $finalUrl = (string) $effective;
                }
            } catch (\Throwable) {
                // ignore
            }

            return [
                'ok' => $response->successful(),
                'url' => $url,
                'final_url' => $finalUrl,
                'status' => $response->status(),
                'content_type' => $contentType,
                'title' => $title,
                'text_excerpt' => $text,
                'looks_like_nginx_default' => $looksLikeNginxDefault,
                'bytes' => strlen($body),
            ];
        } catch (\Throwable $e) {
            return [
                'ok' => false,
                'url' => $url,
                'error' => mb_substr($e->getMessage(), 0, 500),
            ];
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function smokeApplication(Application $application, string $path = '/'): array
    {
        $hosts = $this->publicHosts($application);
        if ($hosts === []) {
            return [
                'ok' => false,
                'error' => 'Aucun FQDN public sur cette application.',
                'application_uuid' => $application->uuid,
            ];
        }

        $path = '/'.ltrim(trim($path) === '' ? '/' : $path, '/');
        if ($path !== '/') {
            $path = rtrim($path, '/') ?: '/';
        }

        $checks = [];
        $allOk = true;
        foreach ($hosts as $host) {
            $url = 'https://'.$host.$path;
            $result = $this->fetch($url, 'GET', 3000);
            if (! ($result['ok'] ?? false)) {
                // Retry http si https échoue (dev / self-signed edge cases)
                $httpResult = $this->fetch('http://'.$host.$path, 'GET', 3000);
                if ($httpResult['ok'] ?? false) {
                    $result = $httpResult;
                }
            }

            $statusOk = ($result['status'] ?? 0) >= 200 && ($result['status'] ?? 0) < 400;
            $nginxBad = (bool) ($result['looks_like_nginx_default'] ?? false);
            $checkOk = $statusOk && ! $nginxBad && ! isset($result['error']);
            if (! $checkOk) {
                $allOk = false;
            }

            $checks[] = array_merge($result, [
                'host' => $host,
                'smoke_ok' => $checkOk,
            ]);
        }

        return [
            'ok' => $allOk,
            'application_uuid' => $application->uuid,
            'application_name' => $application->name,
            'path' => $path,
            'checks' => $checks,
            'summary' => $allOk
                ? 'Smoke OK sur tous les domaines.'
                : 'Smoke en échec — vérifier status HTTP, 502, ou page nginx par défaut (publish_directory).',
        ];
    }

    /** @return list<string> */
    public function publicHosts(Application $application): array
    {
        $raw = trim((string) ($application->fqdn ?? ''));
        if ($raw === '') {
            return [];
        }

        $parts = preg_split('/[\s,]+/', $raw) ?: [];
        $hosts = [];
        foreach ($parts as $part) {
            $part = trim($part);
            if ($part === '') {
                continue;
            }
            $part = preg_replace('#^https?://#i', '', $part) ?? $part;
            $part = explode('/', $part)[0] ?? $part;
            $part = strtolower(trim($part));
            if ($part !== '' && ! in_array($part, $hosts, true)) {
                $hosts[] = $part;
            }
        }

        return $hosts;
    }

    private function extractTitle(string $html): ?string
    {
        if (preg_match('/<title[^>]*>(.*?)<\/title>/is', $html, $m)) {
            $title = html_entity_decode(strip_tags($m[1]), ENT_QUOTES | ENT_HTML5, 'UTF-8');
            $title = trim(preg_replace('/\s+/u', ' ', $title) ?? $title);

            return $title !== '' ? mb_substr($title, 0, 200) : null;
        }

        return null;
    }

    private function extractText(string $html, int $maxChars): string
    {
        $html = preg_replace('/<(script|style|noscript)[^>]*>.*?<\/\1>/is', ' ', $html) ?? $html;
        $text = html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $text = trim(preg_replace('/\s+/u', ' ', $text) ?? $text);

        return Str::limit($text, $maxChars, '…');
    }

    private function looksLikeNginxDefault(?string $title, string $text, string $body): bool
    {
        $hay = mb_strtolower(($title ?? '').' '.$text.' '.mb_substr($body, 0, 2000));

        return str_contains($hay, 'welcome to nginx')
            || str_contains($hay, 'nginx default')
            || (str_contains($hay, 'welcome to nginx!') && str_contains($hay, 'successfully installed'));
    }
}
