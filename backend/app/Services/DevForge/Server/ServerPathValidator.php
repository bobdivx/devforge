<?php

namespace App\Services\DevForge\Server;

use Illuminate\Validation\ValidationException;

class ServerPathValidator
{
    public const DEFAULT_ROOT = '/data/coolify';

    public static function normalize(?string $path, string $default = self::DEFAULT_ROOT): string
    {
        $path = trim((string) $path);

        if ($path === '' || $path === '.') {
            return $default;
        }

        if (str_contains($path, "\0") || str_contains($path, '..')) {
            throw ValidationException::withMessages([
                'path' => 'Chemin invalide.',
            ]);
        }

        if (! str_starts_with($path, '/')) {
            throw ValidationException::withMessages([
                'path' => 'Le chemin doit être absolu.',
            ]);
        }

        return rtrim($path, '/') ?: '/';
    }

    public static function normalizeDirectory(?string $path, string $default = self::DEFAULT_ROOT): string
    {
        $normalized = self::normalize($path, $default);

        return $normalized === '/' ? $normalized : rtrim($normalized, '/');
    }

    public static function join(string $directory, string $name): string
    {
        $name = trim($name);

        if ($name === '' || str_contains($name, '/') || str_contains($name, "\0") || str_contains($name, '..')) {
            throw ValidationException::withMessages([
                'path' => 'Nom de fichier invalide.',
            ]);
        }

        $directory = self::normalizeDirectory($directory);

        return $directory === '/' ? "/{$name}" : "{$directory}/{$name}";
    }
}
