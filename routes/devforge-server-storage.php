<?php

use App\Http\Controllers\DevForge\ServerStorageController;
use Illuminate\Support\Facades\Route;

Route::prefix('server-storage')->name('server-storage.')->group(function () {
    Route::get('/', [ServerStorageController::class, 'index'])->name('index');
    Route::get('/{serverUuid}/disk-breakdown', [ServerStorageController::class, 'diskBreakdown'])
        ->where('serverUuid', '[A-Za-z0-9-]{8,64}')
        ->name('disk-breakdown');
    Route::post('/{serverUuid}/disk', [ServerStorageController::class, 'refreshDisk'])
        ->where('serverUuid', '[A-Za-z0-9-]{8,64}')
        ->name('disk');
    Route::post('/{serverUuid}/cleanup', [ServerStorageController::class, 'runCleanup'])
        ->where('serverUuid', '[A-Za-z0-9-]{8,64}')
        ->name('cleanup');
    Route::put('/{serverUuid}', [ServerStorageController::class, 'update'])
        ->where('serverUuid', '[A-Za-z0-9-]{8,64}')
        ->name('update');
    Route::get('/{serverUuid}', [ServerStorageController::class, 'show'])
        ->where('serverUuid', '[A-Za-z0-9-]{8,64}')
        ->name('show');
});
