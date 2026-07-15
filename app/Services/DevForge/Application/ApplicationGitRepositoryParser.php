<?php

namespace App\Services\DevForge\Application;

class ApplicationGitRepositoryParser
{
    /**
     * @return array{owner: string, repo: string}|null
     */
    public static function parseOwnerRepo(?string $gitRepository): ?array
    {
        if ($gitRepository === null || trim($gitRepository) === '') {
            return null;
        }

        $normalized = trim($gitRepository);
        $normalized = preg_replace('#^https?://[^/]+/#', '', $normalized) ?? $normalized;
        $normalized = preg_replace('#^git@[^:]+:#', '', $normalized) ?? $normalized;
        $normalized = rtrim($normalized, '/');
        $normalized = preg_replace('#/(tree|blob)/[^/]+(/.*)?$#', '$2', $normalized) ?? $normalized;
        $normalized = preg_replace('#^/+#', '', $normalized) ?? $normalized;
        $normalized = str_ends_with($normalized, '.git')
            ? substr($normalized, 0, -4)
            : $normalized;

        $parts = array_values(array_filter(explode('/', $normalized)));

        if (count($parts) < 2) {
            return null;
        }

        return [
            'owner' => $parts[0],
            'repo' => $parts[1],
        ];
    }

    public static function normalizeSourcePath(?string $path): string
    {
        $path = trim((string) $path, '/');

        return $path === '' ? '' : $path;
    }

    public static function joinSourcePath(string $directory, string $name): string
    {
        $directory = self::normalizeSourcePath($directory);
        $name = trim($name, '/');

        if ($name === '') {
            return $directory;
        }

        return $directory === '' ? $name : "{$directory}/{$name}";
    }
}
