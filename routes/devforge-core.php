<?php

use App\Http\Controllers\DevForge\Core\ResourceController;
use Illuminate\Support\Facades\Route;

Route::prefix('core')->name('core.')->group(function () {
    Route::get('/resources', [ResourceController::class, 'catalog'])->name('resources.index');
    Route::get('/configuration', [ResourceController::class, 'configuration'])->name('configuration');

    Route::get('/{type}', [ResourceController::class, 'index'])
        ->whereIn('type', ['servers', 'applications', 'databases', 'services'])
        ->name('resources.type.index');
    Route::get('/{type}/{uuid}', [ResourceController::class, 'show'])
        ->whereIn('type', ['servers', 'applications', 'databases', 'services'])
        ->where('uuid', '[A-Za-z0-9-]{8,64}')
        ->name('resources.show');
    Route::post('/{type}/{uuid}/{action}', [ResourceController::class, 'action'])
        ->whereIn('type', ['applications', 'databases', 'services'])
        ->where('uuid', '[A-Za-z0-9-]{8,64}')
        ->whereIn('action', ['start', 'stop', 'restart', 'deploy'])
        ->name('resources.action');
});
