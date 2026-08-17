<?php

use App\Models\StandalonePostgresql;
use App\Services\DevForge\Backup\InstanceBackupTarget;

it('identifies the instance database by id or resource name', function () {
    $byId = new StandalonePostgresql;
    $byId->id = 0;
    $byId->name = 'anything';

    $byName = new StandalonePostgresql;
    $byName->id = 12;
    $byName->name = 'coolify-db';

    $regular = new StandalonePostgresql;
    $regular->id = 5;
    $regular->name = 'app-postgres';

    expect(InstanceBackupTarget::isInstanceDatabase($byId))->toBeTrue()
        ->and(InstanceBackupTarget::isInstanceDatabase($byName))->toBeTrue()
        ->and(InstanceBackupTarget::isInstanceDatabase($regular))->toBeFalse()
        ->and(InstanceBackupTarget::isInstanceDatabase(null))->toBeFalse();
});

it('prefers the running DevForge postgres container over coolify-db', function () {
    expect(InstanceBackupTarget::selectRunningContainer([
        'coolify-db' => false,
        'devforge-db' => true,
    ]))->toBe('devforge-db');

    expect(InstanceBackupTarget::selectRunningContainer([
        'coolify-db' => true,
        'devforge-db' => false,
    ]))->toBe('coolify-db');

    expect(InstanceBackupTarget::selectRunningContainer([
        'coolify-db' => false,
        'devforge-db' => false,
    ]))->toBeNull();
});

it('dumps the instance postgres_db instead of the hardcoded coolify name', function () {
    $database = new StandalonePostgresql;
    $database->name = 'coolify-db';
    $database->postgres_db = 'devforge';

    expect(InstanceBackupTarget::dumpDatabaseName($database, 'devforge-db'))->toBe('devforge');
});

it('falls back to coolify or devforge when postgres_db is empty', function () {
    $legacy = new StandalonePostgresql;
    $legacy->name = 'coolify-db';
    $legacy->postgres_db = null;

    $devforge = new StandalonePostgresql;
    $devforge->name = 'devforge-db';
    $devforge->postgres_db = null;

    expect(InstanceBackupTarget::dumpDatabaseName($legacy, 'coolify-db'))->toBe('coolify')
        ->and(InstanceBackupTarget::dumpDatabaseName($devforge, 'devforge-db'))->toBe('devforge');
});

it('builds the instance backup directory from the real container name', function () {
    expect(InstanceBackupTarget::backupDirectory('devforge-db', '127.0.0.1'))
        ->toEndWith('/coolify/devforge-db-127-0-0-1');
});
