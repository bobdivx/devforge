<?php

namespace App\Services\DevForge\Readiness;

use App\Models\Application;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Throwable;

class ApplicationDomainProbe
{
    /**
     * @return array{
     *     ok: bool,
     *     url: string|null,
     *     status: int|null,
     *     error: string|null,
     *     skipped: bool
     * }
     */
    public function probe(Application $application): array
    {
        $url = $this->primaryUrl($application);

        if ($url === null) {
            return [
                'ok' => false,
                'url' => null,
                'status' => null,
                'error' => 'Aucun FQDN public configuré pour cette application.',
                'skipped' => true,
            ];
        }

        $timeout = max(3, (int) config('devforge.readiness_probe_timeout_seconds', 10));
        $acceptInsecure = (bool) config('devforge.readiness_accept_insecure_tls', true);

        try {
            $options = ['allow_redirects' => true];
            if ($acceptInsecure) {
                $options['verify'] = false;
            }

            $response = Http::timeout($timeout)
                ->connectTimeout(min(5, $timeout))
                ->withHeaders(['User-Agent' => 'DevForge-ReadinessProbe/1.0'])
                ->withOptions($options)
                ->get($url);
            $status = $response->status();
            $ok = $status >= 200 && $status < 400;
            $body = (string) $response->body();

            // Static Coolify apps with empty publish_directory often serve the
            // stock nginx welcome page (HTTP 200) instead of the built site.
            if ($ok && $this->looksLikeStockNginxWelcome($body)) {
                return [
                    'ok' => false,
                    'url' => $url,
                    'status' => $status,
                    'error' => 'Page nginx par défaut détectée (publish_directory probablement incorrect, ex. /dist manquant).',
                    'skipped' => false,
                ];
            }

            return [
                'ok' => $ok,
                'url' => $url,
                'status' => $status,
                'error' => $ok ? null : "HTTP {$status} pour {$url}",
                'skipped' => false,
            ];
        } catch (ConnectionException $exception) {
            return [
                'ok' => false,
                'url' => $url,
                'status' => null,
                'error' => 'Connexion impossible: '.$exception->getMessage(),
                'skipped' => false,
            ];
        } catch (Throwable $exception) {
            return [
                'ok' => false,
                'url' => $url,
                'status' => null,
                'error' => $exception->getMessage(),
                'skipped' => false,
            ];
        }
    }

    public function primaryUrl(Application $application): ?string
    {
        $fqdn = trim((string) $application->fqdn);
        if ($fqdn === '') {
            return null;
        }

        $first = collect(explode(',', $fqdn))
            ->map(fn (string $part): string => trim($part))
            ->first(fn (string $part): bool => $part !== '');

        if ($first === null) {
            return null;
        }

        if (! str_starts_with($first, 'http://') && ! str_starts_with($first, 'https://')) {
            $first = 'https://'.$first;
        }

        return rtrim($first, '/');
    }

    public function looksLikeStockNginxWelcome(string $body): bool
    {
        $sample = mb_substr($body, 0, 4000);

        return (bool) preg_match('/Welcome to nginx!/i', $sample)
            && (bool) preg_match('/nginx is successfully installed/i', $sample);
    }
}
