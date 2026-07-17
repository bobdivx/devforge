<?php

use App\Models\Server;
use App\Services\DevForge\Database\LibsqlDatabaseTransferService;
use Symfony\Component\HttpKernel\Exception\HttpException;

afterEach(function () {
    Mockery::close();
});

it('detects sqlite database files by magic header', function () {
    $sqliteHeader = "SQLite format 3\x00".str_repeat("\0", 100);

    expect(LibsqlDatabaseTransferService::isSqliteDatabaseFile($sqliteHeader))->toBeTrue()
        ->and(LibsqlDatabaseTransferService::isSqliteDatabaseFile("PRAGMA foreign_keys=OFF;\nCREATE TABLE users (id INTEGER);\n"))->toBeFalse();
});

it('estimates remote base64 chunks for transfer progress', function () {
    expect(LibsqlDatabaseTransferService::estimateRemoteChunks(0))->toBe(0)
        ->and(LibsqlDatabaseTransferService::estimateRemoteChunks(100))->toBe(1)
        ->and(LibsqlDatabaseTransferService::estimateRemoteChunks(LibsqlDatabaseTransferService::REMOTE_CHUNK_CHARS))->toBeGreaterThan(1);
});

it('flags large payloads above the soft warning threshold', function () {
    expect(LibsqlDatabaseTransferService::isLargePayload(LibsqlDatabaseTransferService::WARN_PAYLOAD_BYTES))->toBeTrue()
        ->and(LibsqlDatabaseTransferService::isLargePayload(1024))->toBeFalse();
});

it('rejects empty import payloads and accepts valid dumps under the hard limit', function () {
    expect(fn () => LibsqlDatabaseTransferService::assertPayloadWithinLimits(''))
        ->toThrow(HttpException::class);

    expect(fn () => LibsqlDatabaseTransferService::assertPayloadWithinLimits("CREATE TABLE t (id INTEGER);\n"))
        ->not->toThrow(HttpException::class);

    expect(LibsqlDatabaseTransferService::MAX_PAYLOAD_BYTES)->toBe(524288 * 1024)
        ->and(LibsqlDatabaseTransferService::MAX_UPLOAD_KILOBYTES)->toBe(524288);
});

it('enriches import results with downtime and transfer metadata', function () {
    $enriched = LibsqlDatabaseTransferService::enrichImportResult([
        'restarted' => true,
        'message' => 'OK',
        'format' => 'sql',
    ], LibsqlDatabaseTransferService::WARN_PAYLOAD_BYTES, 'sql');

    expect($enriched['downtime_required'])->toBeTrue()
        ->and($enriched['downtime_note'])->toContain('arrêtée')
        ->and($enriched['large_payload'])->toBeTrue()
        ->and($enriched['transfer_method'])->toBe(LibsqlDatabaseTransferService::TRANSFER_METHOD_SCP)
        ->and($enriched['estimated_transfer_chunks'])->toBe(1)
        ->and($enriched['transfer_hint'])->toContain('SCP')
        ->and($enriched['format'])->toBe('sql');
});

it('enriches chunked fallback transfer with multi-chunk estimate', function () {
    $enriched = LibsqlDatabaseTransferService::enrichImportResult(
        ['restarted' => true, 'message' => 'OK'],
        LibsqlDatabaseTransferService::WARN_PAYLOAD_BYTES,
        'db',
        LibsqlDatabaseTransferService::TRANSFER_METHOD_CHUNKED,
    );

    expect($enriched['transfer_method'])->toBe(LibsqlDatabaseTransferService::TRANSFER_METHOD_CHUNKED)
        ->and($enriched['estimated_transfer_chunks'])->toBeGreaterThan(1)
        ->and($enriched['transfer_hint'])->toContain('chunké');
});

it('retries chunked remote writes up to CHUNK_MAX_ATTEMPTS', function () {
    expect(LibsqlDatabaseTransferService::CHUNK_MAX_ATTEMPTS)->toBeGreaterThanOrEqual(2)
        ->and(LibsqlDatabaseTransferService::TRANSFER_METHOD_SCP)->toBe('scp')
        ->and(LibsqlDatabaseTransferService::TRANSFER_METHOD_CHUNKED)->toBe('chunked_base64');
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
    $service = app(LibsqlDatabaseTransferService::class);
    $method = new ReflectionMethod($service, 'sqliteCommand');
    $method->setAccessible(true);

    $command = $method->invoke($service, 'libsql-data-test', false, '.dump');

    expect($command)->toContain("sh -c '")
        ->and($command)->toContain('/var/lib/sqld/data.db/dbs/default/data')
        ->and($command)->not->toContain('&&');
});

it('prepares modern sqld layout for imports', function () {
    $service = app(LibsqlDatabaseTransferService::class);
    $method = new ReflectionMethod($service, 'prepareModernLayoutShellSnippet');
    $method->setAccessible(true);

    $snippet = $method->invoke($service);

    expect($snippet)->toContain('mkdir -p /var/lib/sqld/data.db/dbs/default')
        ->and($snippet)->toContain('/var/lib/sqld/data.db/dbs/default/data')
        ->and($snippet)->toContain('if [ -f /var/lib/sqld/data.db ]');
});

it('prefixes remote commands with sudo for non-root servers without re-parsing inner scripts', function () {
    $server = Mockery::mock(Server::class)->makePartial();
    $server->shouldReceive('isNonRoot')->andReturn(true);

    $service = app(LibsqlDatabaseTransferService::class);
    $method = new ReflectionMethod($service, 'wrapCommandsForServer');
    $method->setAccessible(true);

    $command = "docker run --rm alpine:3.20 sh -c 'mkdir -p /var/lib/sqld/data.db/dbs/default; cp /import.db /var/lib/sqld/data.db/dbs/default/data'";
    $result = $method->invoke($service, $server, [$command]);

    expect($result[0])->toBe("sudo {$command}")
        ->and($result[0])->not->toContain('&& sudo');
});
