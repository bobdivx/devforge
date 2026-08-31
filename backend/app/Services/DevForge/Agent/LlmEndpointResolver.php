<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiProviderConfig;

class LlmEndpointResolver
{
    private const GEMINI_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';

    public static function geminiBaseUrl(?string $baseUrl): string
    {
        $candidate = trim((string) $baseUrl);

        if ($candidate === '') {
            return self::GEMINI_DEFAULT_BASE_URL;
        }

        if (! self::isGeminiBaseUrl($candidate)) {
            return self::GEMINI_DEFAULT_BASE_URL;
        }

        return rtrim($candidate, '/');
    }

    public static function ollamaBaseUrl(?string $baseUrl): string
    {
        $candidate = trim((string) $baseUrl);

        if ($candidate === '') {
            throw new \InvalidArgumentException('Une URL Ollama est requise.');
        }

        return rtrim(self::resolveLocalhostForContainer($candidate), '/');
    }

    public static function openAiCompatibleBaseUrl(string $provider, ?string $baseUrl): string
    {
        $candidate = trim((string) $baseUrl);
        $fallback = LlmProviderRegistry::defaultBaseUrl($provider)
            ?? throw new \InvalidArgumentException("URL de base inconnue pour {$provider}.");

        if ($candidate === '') {
            return rtrim($fallback, '/');
        }

        return rtrim(self::resolveLocalhostForContainer($candidate), '/');
    }

    public static function anthropicBaseUrl(?string $baseUrl): string
    {
        $candidate = trim((string) $baseUrl);

        if ($candidate === '') {
            return (string) LlmProviderRegistry::defaultBaseUrl('anthropic');
        }

        return rtrim($candidate, '/');
    }

    public static function sanitizeProviderConfig(AiProviderConfig|array $config): array
    {
        $provider = is_array($config) ? ($config['provider'] ?? '') : $config->provider;

        if ($provider === 'gemini') {
            return ['base_url' => null];
        }

        if ($provider === 'ollama') {
            $baseUrl = is_array($config) ? ($config['base_url'] ?? null) : $config->base_url;

            return ['base_url' => self::ollamaBaseUrl($baseUrl)];
        }

        if (in_array($provider, ['openai', 'openrouter'], true)) {
            $baseUrl = is_array($config) ? ($config['base_url'] ?? null) : $config->base_url;

            return ['base_url' => self::openAiCompatibleBaseUrl($provider, $baseUrl)];
        }

        if ($provider === 'anthropic') {
            $baseUrl = is_array($config) ? ($config['base_url'] ?? null) : $config->base_url;

            return ['base_url' => self::anthropicBaseUrl($baseUrl)];
        }

        return [];
    }

    public static function isGeminiBaseUrl(string $baseUrl): bool
    {
        $host = parse_url($baseUrl, PHP_URL_HOST);

        if (! is_string($host) || $host === '') {
            return false;
        }

        return str_contains(mb_strtolower($host), 'generativelanguage.googleapis.com');
    }

    public static function urlHost(?string $baseUrl): ?string
    {
        $host = parse_url(trim((string) $baseUrl), PHP_URL_HOST);

        return is_string($host) && $host !== '' ? $host : null;
    }

    public static function isLocalOrPrivateHost(string $host): bool
    {
        $host = strtolower(trim($host, '[]'));

        if (in_array($host, ['localhost', '127.0.0.1', '::1', 'host.docker.internal'], true)) {
            return true;
        }

        if (str_ends_with($host, '.local') || str_ends_with($host, '.internal')) {
            return true;
        }

        if (filter_var($host, FILTER_VALIDATE_IP)) {
            return ! filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE);
        }

        return false;
    }

    public static function isPublicHttpsTunnel(?string $baseUrl): bool
    {
        $candidate = trim((string) $baseUrl);
        if ($candidate === '') {
            return false;
        }

        $parts = parse_url($candidate);
        if ($parts === false) {
            return false;
        }

        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        $host = strtolower((string) ($parts['host'] ?? ''));
        if ($scheme !== 'https' || $host === '') {
            return false;
        }

        return ! self::isLocalOrPrivateHost($host);
    }

    private static function resolveLocalhostForContainer(string $baseUrl): string
    {
        $parts = parse_url($baseUrl);

        if ($parts === false) {
            return $baseUrl;
        }

        $host = mb_strtolower((string) ($parts['host'] ?? ''));

        if (! in_array($host, ['localhost', '127.0.0.1', '::1'], true)) {
            return $baseUrl;
        }

        $configured = trim((string) config('devforge.ollama_url', ''));

        if ($configured !== '') {
            return $configured;
        }

        $port = $parts['port'] ?? 11434;
        $scheme = $parts['scheme'] ?? 'http';

        return "{$scheme}://host.docker.internal:{$port}";
    }
}
