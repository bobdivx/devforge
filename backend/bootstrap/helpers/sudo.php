<?php

use App\Models\Server;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

function shouldChangeOwnership(string $path): bool
{
    $path = trim($path);

    // Coolify data dirs (incl. NAS mounts like /media/.../coolify/data/applications).
    $isCoolifyPath = Str::startsWith($path, '/data/coolify')
        || Str::startsWith($path, '/tmp/coolify')
        || (bool) preg_match('#/(?:data/)?coolify/(?:data/)?applications(?:/|$)#', $path)
        || (bool) preg_match('#/coolify/data(?:/|$)#', $path);

    if ($isCoolifyPath) {
        return true;
    }

    $systemPaths = ['/var', '/etc', '/usr', '/opt', '/sys', '/proc', '/dev', '/bin', '/sbin', '/lib', '/lib64', '/boot', '/root', '/home', '/media', '/mnt', '/srv', '/run'];

    foreach ($systemPaths as $systemPath) {
        if ($path === $systemPath || Str::startsWith($path, $systemPath.'/')) {
            return false;
        }
    }

    return false;
}
function parseCommandsByLineForSudo(Collection $commands, Server $server): array
{
    $commands = $commands->map(function ($line) {
        $trimmedLine = trim($line);

        // All bash keywords that should not receive sudo prefix
        // Using word boundary matching to avoid prefix collisions (e.g., 'do' vs 'docker', 'if' vs 'ifconfig', 'fi' vs 'find')
        $bashKeywords = [
            'cd',
            'command',
            'declare',
            'echo',
            'export',
            'local',
            'readonly',
            'return',
            'true',
            'if',
            'fi',
            'for',
            'done',
            'while',
            'until',
            'case',
            'esac',
            'select',
            'then',
            'else',
            'elif',
            'break',
            'continue',
            'do',
        ];

        // Special case: comments (no collision risk with '#')
        if (str_starts_with($trimmedLine, '#')) {
            return $line;
        }

        // Check all keywords with word boundary matching
        // Match keyword followed by space, semicolon, or end of line
        foreach ($bashKeywords as $keyword) {
            if (preg_match('/^'.preg_quote($keyword, '/').'(\s|;|$)/', $trimmedLine)) {
                // Special handling for 'if' - insert sudo after 'if '
                if ($keyword === 'if') {
                    return preg_replace('/^(\s*)if\s+/', '$1if sudo ', $line);
                }

                return $line;
            }
        }

        return "sudo $line";
    });

    $commands = $commands->map(function ($line) use ($server) {
        if (Str::startsWith($line, 'sudo mkdir -p')) {
            $path = trim(Str::after($line, 'sudo mkdir -p'));
            if (shouldChangeOwnership($path)) {
                // Do not prefix chown/chmod with sudo here: the next pass injects
                // `&& sudo` and would otherwise produce `sudo sudo chown`.
                // Trailing colon: use the user's primary group (avoids invalid
                // `user:user` when no matching group exists, e.g. CasaOS samba).
                return "$line && chown -R {$server->user}: $path && chmod -R o-rwx $path";
            }

            return $line;
        }

        return $line;
    });

    $commands = $commands->map(function ($line) {
        $line = str($line);

        // Detect complex piped commands that should be wrapped in bash -c
        $isComplexPipeCommand = (
            $line->contains(' | sh') ||
            $line->contains(' | bash') ||
            ($line->contains(' | ') && ($line->contains('||') || $line->contains('&&')))
        );

        // If it's a complex pipe command and starts with sudo, wrap it in bash -c
        if ($isComplexPipeCommand && $line->startsWith('sudo ')) {
            $commandWithoutSudo = $line->after('sudo ')->value();
            // Escape single quotes for bash -c by replacing ' with '\''
            $escapedCommand = str_replace("'", "'\\''", $commandWithoutSudo);

            return "sudo bash -c '$escapedCommand'";
        }

        // For non-complex commands, apply the original logic
        if (str($line)->contains('$(')) {
            $line = $line->replace('$(', '$(sudo ');
        }
        if (! $isComplexPipeCommand && str($line)->contains('||')) {
            $line = $line->replace('||', '|| sudo');
        }
        if (! $isComplexPipeCommand && str($line)->contains('&&')) {
            $line = $line->replace('&&', '&& sudo');
        }
        // Don't insert sudo into pipes for complex commands
        if (! $isComplexPipeCommand && str($line)->contains(' | ')) {
            $line = $line->replace(' | ', ' | sudo ');
        }

        return $line->value();
    });

    return $commands->toArray();
}
function parseLineForSudo(string $command, Server $server): string
{
    // Same pipe/keyword rules as multi-line parsing — critical for
    // `echo … | base64 -d | tee path` (sudo must reach tee, not only echo).
    $parsed = parseCommandsByLineForSudo(collect([$command]), $server);

    return (string) ($parsed[0] ?? $command);
}
