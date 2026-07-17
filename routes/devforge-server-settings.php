<?php

use App\Http\Controllers\DevForge\ServerSettingsController;
use Illuminate\Support\Facades\Route;

Route::get('/servers/{serverUuid}/settings', [ServerSettingsController::class, 'show'])
    ->where('serverUuid', '[A-Za-z0-9-]{8,64}')
    ->name('servers.settings.show');
Route::put('/servers/{serverUuid}/settings', [ServerSettingsController::class, 'update'])
    ->where('serverUuid', '[A-Za-z0-9-]{8,64}')
    ->name('servers.settings.update');
