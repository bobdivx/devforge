<?php

use App\Http\Controllers\DevForge\DatabaseBackupController;
use Illuminate\Support\Facades\Route;

$cuid = '[A-Za-z0-9-]{8,64}';

Route::get('/databases/{databaseUuid}/backups', [DatabaseBackupController::class, 'index'])
    ->where('databaseUuid', $cuid)
    ->name('databases.backups.index');
Route::post('/databases/{databaseUuid}/backups', [DatabaseBackupController::class, 'store'])
    ->where('databaseUuid', $cuid)
    ->name('databases.backups.store');
Route::put('/databases/{databaseUuid}/backups/{backupUuid}', [DatabaseBackupController::class, 'update'])
    ->where('databaseUuid', $cuid)
    ->where('backupUuid', $cuid)
    ->name('databases.backups.update');
Route::delete('/databases/{databaseUuid}/backups/{backupUuid}', [DatabaseBackupController::class, 'destroy'])
    ->where('databaseUuid', $cuid)
    ->where('backupUuid', $cuid)
    ->name('databases.backups.destroy');
Route::post('/databases/{databaseUuid}/backups/{backupUuid}/run', [DatabaseBackupController::class, 'run'])
    ->where('databaseUuid', $cuid)
    ->where('backupUuid', $cuid)
    ->name('databases.backups.run');
Route::get('/databases/{databaseUuid}/backups/{backupUuid}/executions', [DatabaseBackupController::class, 'executions'])
    ->where('databaseUuid', $cuid)
    ->where('backupUuid', $cuid)
    ->name('databases.backups.executions.index');
Route::delete('/databases/{databaseUuid}/backups/{backupUuid}/executions/{executionUuid}', [DatabaseBackupController::class, 'destroyExecution'])
    ->where('databaseUuid', $cuid)
    ->where('backupUuid', $cuid)
    ->where('executionUuid', $cuid)
    ->name('databases.backups.executions.destroy');
