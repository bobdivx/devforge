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
