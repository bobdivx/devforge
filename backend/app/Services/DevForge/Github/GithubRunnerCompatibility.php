<?php

namespace App\Services\DevForge\Github;

class GithubRunnerCompatibility
{
    public const NODE24_MIN_VERSION = '2.327.1';

    public const DEFAULT_RUNNER_VERSION = '2.336.0';

    public static function parseVersion(?string $text): ?string
    {
        if (! filled($text)) {
            return null;
        }

        if (preg_match('/(?:Version:\s*|Runner v|actions-runner-linux-x64-|Current runner version:\s*[\'"]?)(\d+\.\d+\.\d+)/i', $text, $matches) !== 1) {
            return null;
        }

        return $matches[1];
    }

    public static function supportsNode24(?string $version): bool
    {
        if (! filled($version) || preg_match('/^\d+\.\d+\.\d+$/', (string) $version) !== 1) {
            return false;
        }

        return version_compare((string) $version, self::NODE24_MIN_VERSION, '>=');
    }

    public static function compatibleVersion(?string $version): string
    {
        return self::supportsNode24($version) ? (string) $version : self::DEFAULT_RUNNER_VERSION;
    }

    /**
     * @param  array<int, mixed>  $envLines
     * @return array<int, string>
     */
    public static function withCompatibleRunnerVersion(array $envLines): array
    {
        $normalized = [];
        $found = false;

        foreach ($envLines as $line) {
            if (! is_string($line) || ! str_contains($line, '=')) {
                continue;
            }

            [$key, $value] = explode('=', $line, 2);
            if (strcasecmp($key, 'RUNNER_VERSION') === 0) {
                $found = true;
                $normalized[] = 'RUNNER_VERSION='.self::compatibleVersion($value);

                continue;
            }

            $normalized[] = $line;
        }

        if (! $found) {
            $normalized[] = 'RUNNER_VERSION='.self::DEFAULT_RUNNER_VERSION;
        }

        return $normalized;
    }

    /**
     * @param  array<int, array{key?: string, value?: string}>  $extraEnv
     * @return array<int, array{key: string, value: string}>
     */
    public static function withCompatibleExtraEnv(array $extraEnv): array
    {
        $normalized = [];
        $found = false;

        foreach ($extraEnv as $entry) {
            $key = (string) ($entry['key'] ?? '');
            $value = (string) ($entry['value'] ?? '');
            if (strcasecmp($key, 'RUNNER_VERSION') === 0) {
                $found = true;
                $normalized[] = [
                    'key' => 'RUNNER_VERSION',
                    'value' => self::compatibleVersion($value),
                ];

                continue;
            }

            $normalized[] = [
                'key' => $key,
                'value' => $value,
            ];
        }

        if (! $found) {
            $normalized[] = [
                'key' => 'RUNNER_VERSION',
                'value' => self::DEFAULT_RUNNER_VERSION,
            ];
        }

        return $normalized;
    }

    /**
     * @return array{runner_version: string|null, node24_ready: bool|null, node24_min_version: string, recommended_runner_version: string}
     */
    public static function payload(?string $version): array
    {
        $normalized = filled($version) ? trim((string) $version) : null;

        return [
            'runner_version' => $normalized,
            'node24_ready' => $normalized === null ? null : self::supportsNode24($normalized),
            'node24_min_version' => self::NODE24_MIN_VERSION,
            'recommended_runner_version' => self::DEFAULT_RUNNER_VERSION,
        ];
    }
}
