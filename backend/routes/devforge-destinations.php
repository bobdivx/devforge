<?php

use App\Http\Controllers\DevForge\DestinationController;
use Illuminate\Support\Facades\Route;

Route::get('/destinations', [DestinationController::class, 'index'])->name('destinations.index');
Route::post('/destinations', [DestinationController::class, 'store'])->name('destinations.store');
Route::get('/destinations/{destinationUuid}', [DestinationController::class, 'show'])
    ->where('destinationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('destinations.show');
Route::put('/destinations/{destinationUuid}', [DestinationController::class, 'update'])
    ->where('destinationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('destinations.update');
Route::delete('/destinations/{destinationUuid}', [DestinationController::class, 'destroy'])
    ->where('destinationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('destinations.destroy');
Route::get('/destinations/{destinationUuid}/resources', [DestinationController::class, 'resources'])
    ->where('destinationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('destinations.resources');
