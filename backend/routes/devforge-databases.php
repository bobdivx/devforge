<?php

use App\Http\Controllers\DevForge\DatabaseController;
use Illuminate\Support\Facades\Route;

$cuid = '[A-Za-z0-9-]{8,64}';

Route::post('/databases', [DatabaseController::class, 'store'])
    ->name('databases.store');
Route::get('/databases/{databaseUuid}/connections', [DatabaseController::class, 'connections'])
    ->where('databaseUuid', $cuid)
    ->name('databases.connections');
Route::get('/databases/{databaseUuid}/logs', [DatabaseController::class, 'logs'])
    ->where('databaseUuid', $cuid)
    ->name('databases.logs');
Route::get('/databases/{databaseUuid}/webhooks', [DatabaseController::class, 'webhooks'])
    ->where('databaseUuid', $cuid)
    ->name('databases.webhooks.show');
Route::get('/databases/{databaseUuid}/environment-variables', [DatabaseController::class, 'environmentVariables'])
    ->where('databaseUuid', $cuid)
    ->name('databases.environment-variables.index');
Route::post('/databases/{databaseUuid}/environment-variables', [DatabaseController::class, 'storeEnvironmentVariable'])
    ->where('databaseUuid', $cuid)
    ->name('databases.environment-variables.store');
Route::put('/databases/{databaseUuid}/environment-variables/{envUuid}', [DatabaseController::class, 'updateEnvironmentVariable'])
    ->where(['databaseUuid' => $cuid, 'envUuid' => $cuid])
    ->name('databases.environment-variables.update');
Route::get('/databases/{databaseUuid}/environment-variables/{envUuid}/reveal', [DatabaseController::class, 'revealEnvironmentVariable'])
    ->where(['databaseUuid' => $cuid, 'envUuid' => $cuid])
    ->name('databases.environment-variables.reveal');
Route::delete('/databases/{databaseUuid}/environment-variables/{envUuid}', [DatabaseController::class, 'destroyEnvironmentVariable'])
    ->where(['databaseUuid' => $cuid, 'envUuid' => $cuid])
    ->name('databases.environment-variables.destroy');
Route::get('/databases/{databaseUuid}/storages', [DatabaseController::class, 'storages'])
    ->where('databaseUuid', $cuid)
    ->name('databases.storages.index');
Route::post('/databases/{databaseUuid}/storages', [DatabaseController::class, 'storeStorage'])
    ->where('databaseUuid', $cuid)
    ->name('databases.storages.store');
Route::put('/databases/{databaseUuid}/storages/{storageUuid}', [DatabaseController::class, 'updateStorage'])
    ->where(['databaseUuid' => $cuid, 'storageUuid' => $cuid])
    ->name('databases.storages.update');
Route::delete('/databases/{databaseUuid}/storages/{storageUuid}', [DatabaseController::class, 'destroyStorage'])
    ->where(['databaseUuid' => $cuid, 'storageUuid' => $cuid])
    ->name('databases.storages.destroy');
Route::get('/databases/{databaseUuid}/healthcheck', [DatabaseController::class, 'healthcheck'])
    ->where('databaseUuid', $cuid)
    ->name('databases.healthcheck.show');
Route::put('/databases/{databaseUuid}/healthcheck', [DatabaseController::class, 'updateHealthcheck'])
    ->where('databaseUuid', $cuid)
    ->name('databases.healthcheck.update');
Route::get('/databases/{databaseUuid}/credentials', [DatabaseController::class, 'credentials'])
    ->where('databaseUuid', $cuid)
    ->name('databases.credentials');
Route::post('/databases/{databaseUuid}/regenerate-token', [DatabaseController::class, 'regenerateToken'])
    ->where('databaseUuid', $cuid)
    ->name('databases.regenerate-token');
Route::put('/databases/{databaseUuid}/public-access', [DatabaseController::class, 'updatePublicAccess'])
    ->where('databaseUuid', $cuid)
    ->name('databases.public-access');
Route::delete('/databases/{databaseUuid}', [DatabaseController::class, 'destroy'])
    ->where('databaseUuid', $cuid)
    ->name('databases.destroy');
Route::get('/databases/{databaseUuid}/export-sql', [DatabaseController::class, 'exportSql'])
    ->where('databaseUuid', $cuid)
    ->name('databases.export-sql');
Route::post('/databases/{databaseUuid}/import-sql', [DatabaseController::class, 'importSql'])
    ->where('databaseUuid', $cuid)
    ->name('databases.import-sql');
Route::get('/databases/{databaseUuid}/explorer', [DatabaseController::class, 'explorer'])
    ->where('databaseUuid', $cuid)
    ->name('databases.explorer');
Route::get('/databases/{databaseUuid}/explorer/tables/{table}', [DatabaseController::class, 'explorerTable'])
    ->where('databaseUuid', $cuid)
    ->where('table', '[A-Za-z0-9_]+')
    ->name('databases.explorer-table');
