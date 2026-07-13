<?php

use App\Http\Controllers\DevForge\DatabaseController;
use Illuminate\Support\Facades\Route;

$cuid = '[A-Za-z0-9-]{8,64}';

Route::post('/databases', [DatabaseController::class, 'store'])
    ->name('databases.store');
Route::get('/databases/{databaseUuid}/connections', [DatabaseController::class, 'connections'])
    ->where('databaseUuid', $cuid)
    ->name('databases.connections');
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
