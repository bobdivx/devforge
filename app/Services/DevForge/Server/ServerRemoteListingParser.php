<?php

namespace App\Services\DevForge\Server;

/**
 * Parse la sortie de ls -la en entrées structurées pour l'explorateur DevForge.
 */
class ServerRemoteListingParser
{
    /**
     * @return array<int, array{
     *     name: string,
     *     type: 'file'|'directory'|'symlink'|'other',
     *     size: int,
     *     permissions: string,
     *     modified_label: string,
     *     symlink_target: string|null
     * }>
     */
    public static function parse(string $output): array
    {
        $entries = [];

        foreach (explode("\n", $output) as $line) {
            $line = rtrim($line);
            if ($line === '' || str_starts_with($line, 'total ')) {
                continue;
            }

            if (! preg_match(
                '/^([\-dlcsbp])([rwx-]{9})\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\S+\s+\d+\s+(?:\d{2}:\d{2}|\d{4}))\s+(.+)$/',
                $line,
                $matches,
            )) {
                continue;
            }

            $rawName = $matches[5];
            $symlinkTarget = null;

            if (str_contains($rawName, ' -> ')) {
                [$rawName, $symlinkTarget] = array_pad(explode(' -> ', $rawName, 2), 2, null);
            }

            $name = trim($rawName);
            if ($name === '' || $name === '.' || $name === '..') {
                continue;
            }

            $entries[] = [
                'name' => $name,
                'type' => self::resolveType($matches[1]),
                'size' => (int) $matches[3],
                'permissions' => $matches[1].$matches[2],
                'modified_label' => trim($matches[4]),
                'symlink_target' => $symlinkTarget !== null ? trim($symlinkTarget) : null,
            ];
        }

        usort($entries, function (array $left, array $right): int {
            if ($left['type'] === 'directory' && $right['type'] !== 'directory') {
                return -1;
            }

            if ($right['type'] === 'directory' && $left['type'] !== 'directory') {
                return 1;
            }

            return strnatcasecmp($left['name'], $right['name']);
        });

        return $entries;
    }

    private static function resolveType(string $firstChar): string
    {
        return match ($firstChar) {
            'd' => 'directory',
            'l' => 'symlink',
            '-' => 'file',
            default => 'other',
        };
    }
}
