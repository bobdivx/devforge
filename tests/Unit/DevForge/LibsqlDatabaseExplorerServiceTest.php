<?php

use App\Models\StandaloneLibsql;
use App\Services\DevForge\Database\LibsqlDatabaseExplorerService;
use App\Services\DevForge\Database\LibsqlDatabaseTransferService;

it('lists sqlite tables for explorer overview', function () {
    $database = Mockery::mock(StandaloneLibsql::class);

    $this->mock(LibsqlDatabaseTransferService::class, function ($mock): void {
        $mock->shouldReceive('databaseFileExists')
            ->once()
            ->andReturn(true);
        $mock->shouldReceive('queryJson')
            ->once()
            ->withArgs(fn ($db, string $sql): bool => str_contains($sql, 'sqlite_master'))
            ->andReturn([
                ['name' => 'users'],
                ['name' => 'posts'],
            ]);
    });

    $overview = app(LibsqlDatabaseExplorerService::class)->overview($database);

    expect($overview['available'])->toBeTrue()
        ->and($overview['table_count'])->toBe(2)
        ->and($overview['tables'][0]['name'])->toBe('users');
});

it('returns an empty overview when data.db is missing', function () {
    $database = Mockery::mock(StandaloneLibsql::class);

    $this->mock(LibsqlDatabaseTransferService::class, function ($mock): void {
        $mock->shouldReceive('databaseFileExists')
            ->once()
            ->andReturn(false);
    });

    $overview = app(LibsqlDatabaseExplorerService::class)->overview($database);

    expect($overview['available'])->toBeFalse()
        ->and($overview['tables'])->toBe([])
        ->and($overview['message'])->toContain('data.db');
});

it('returns an unavailable overview when sqlite query fails', function () {
    $database = Mockery::mock(StandaloneLibsql::class);

    $this->mock(LibsqlDatabaseTransferService::class, function ($mock): void {
        $mock->shouldReceive('databaseFileExists')
            ->once()
            ->andReturn(true);
        $mock->shouldReceive('queryJson')
            ->once()
            ->andThrow(new Symfony\Component\HttpKernel\Exception\HttpException(422, 'Impossible de lire les données SQLite.'));
    });

    $overview = app(LibsqlDatabaseExplorerService::class)->overview($database);

    expect($overview['available'])->toBeFalse()
        ->and($overview['message'])->toBe('Impossible de lire les données SQLite.');
});

it('rejects invalid table names for explorer preview', function () {
    $database = Mockery::mock(StandaloneLibsql::class);

    app(LibsqlDatabaseExplorerService::class)->previewTable($database, 'users;drop');
})->throws(Symfony\Component\HttpKernel\Exception\HttpException::class);
