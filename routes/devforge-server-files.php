<?php

use App\Http\Controllers\DevForge\ServerFilesystemController;
use Illuminate\Support\Facades\Route;

Route::prefix('server-files')->name('server-files.')->group(function () {
    Route::get('/meta', [ServerFilesystemController::class, 'meta'])->name('meta');

    Route::get('/{serverUuid}/list', [ServerFilesystemController::class, 'list'])
        ->where('serverUuid', '[A-Za-z0-9-]{8,64}')
        ->name('list');

    Route::get('/{serverUuid}/read', [ServerFilesystemController::class, 'read'])
        ->where('serverUuid', '[A-Za-z0-9-]{8,64}')
        ->name('read');

    Route::put('/{serverUuid}', [ServerFilesystemController::class, 'write'])
        ->where('serverUuid', '[A-Za-z0-9-]{8,64}')
        ->name('write');

    Route::get('/{serverUuid}/search', [ServerFilesystemController::class, 'search'])
        ->where('serverUuid', '[A-Za-z0-9-]{8,64}')
        ->name('search');
});
