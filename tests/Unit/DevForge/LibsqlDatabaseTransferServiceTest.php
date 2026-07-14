<?php

use App\Models\Server;
use App\Services\DevForge\Database\LibsqlDatabaseTransferService;

afterEach(function () {
    Mockery::close();
});

it('detects sqlite database files by magic header', function () {
    $sqliteHeader = "SQLite format 3\x00".str_repeat("\0", 100);

    expect(LibsqlDatabaseTransferService::isSqliteDatabaseFile($sqliteHeader))->toBeTrue()
        ->and(LibsqlDatabaseTransferService::isSqliteDatabaseFile("PRAGMA foreign_keys=OFF;\nCREATE TABLE users (id INTEGER);\n"))->toBeFalse();
});

it('decodes sqlite json output line by line', function () {
    $rows = LibsqlDatabaseTransferService::decodeSqliteJsonOutput("{\"name\":\"users\"}\n{\"name\":\"posts\"}\n");

    expect($rows)->toHaveCount(2)
        ->and($rows[0]['name'])->toBe('users')
        ->and($rows[1]['name'])->toBe('posts');
});

it('decodes sqlite json array output', function () {
    $rows = LibsqlDatabaseTransferService::decodeSqliteJsonOutput('[{"name":"users"}]');

    expect($rows)->toHaveCount(1)
        ->and($rows[0]['name'])->toBe('users');
});

it('builds sqlite docker commands without inner && operators', function () {
    $service = new LibsqlDatabaseTransferService;
    $method = new ReflectionMethod($service, 'sqliteCommand');
    $method->setAccessible(true);

    $command = $method->invoke($service, 'libsql-data-test', false, '.dump');

    expect($command)->toContain("sh -c '")
        ->and($command)->not->toContain('&&');
});

it('prefixes remote commands with sudo for non-root servers without re-parsing inner scripts', function () {
    $server = Mockery::mock(Server::class)->makePartial();
    $server->shouldReceive('isNonRoot')->andReturn(true);

    $service = new LibsqlDatabaseTransferService;
    $method = new ReflectionMethod($service, 'wrapCommandsForServer');
    $method->setAccessible(true);

    $command = "docker run --rm alpine:3.20 sh -c 'rm -f /var/lib/sqld/data.db; cp /import.db /var/lib/sqld/data.db'";
    $result = $method->invoke($service, $server, [$command]);

    expect($result[0])->toBe("sudo {$command}")
        ->and($result[0])->not->toContain('&& sudo');
});
