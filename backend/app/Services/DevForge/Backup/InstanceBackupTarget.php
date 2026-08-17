<?php

namespace App\Services\DevForge\Backup;

use App\Models\StandalonePostgresql;
use Illuminate\Support\Str;

final class InstanceBackupTarget
{
    /**
     * @var list<string>
     */
    public const DATABASE_NAMES = ['coolify-db', 'devforge-db'];

    /**
     * @var list<string>
     */
    public const CONTAINER_CANDIDATES = ['devforge-db', 'coolify-db'];

    public static function isInstanceDatabase(?StandalonePostgresql $database): bool
    {
        if (! $database) {
            return false;
        }

        return (int) $database->id === 0
            || in_array($database->name, self::DATABASE_NAMES, true);
    }

    /**
     * @param  array<string, bool>  $runningByName
     */
    public static function selectRunningContainer(array $runningByName): ?string
    {
        foreach (self::CONTAINER_CANDIDATES as $name) {
            if (($runningByName[$name] ?? false) === true) {
                return $name;
            }
        }

        return null;
    }

    public static function dumpDatabaseName(StandalonePostgresql $database, ?string $container = null): string
    {
        if (filled($database->postgres_db)) {
            return (string) $database->postgres_db;
        }

        if ($container === 'devforge-db' || $database->name === 'devforge-db') {
            return 'devforge';
        }

        return 'coolify';
    }

    public static function backupDirectory(string $container, string $serverIp): string
    {
        return backup_dir().'/coolify/'.$container.'-'.Str::slug($serverIp);
    }
}
