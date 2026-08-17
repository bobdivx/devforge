<?php

use App\Http\Controllers\DevForge\S3StorageController;
use Illuminate\Support\Facades\Route;

$cuid = '[A-Za-z0-9-]{8,64}';

Route::prefix('s3-storages')->name('s3-storages.')->group(function () use ($cuid) {
    Route::get('/', [S3StorageController::class, 'index'])->name('index');
    Route::get('/{storageUuid}', [S3StorageController::class, 'show'])
        ->where('storageUuid', $cuid)
        ->name('show');
    Route::post('/', [S3StorageController::class, 'store'])->name('store');
    Route::put('/{storageUuid}', [S3StorageController::class, 'update'])
        ->where('storageUuid', $cuid)
        ->name('update');
    Route::delete('/{storageUuid}', [S3StorageController::class, 'destroy'])
        ->where('storageUuid', $cuid)
        ->name('destroy');
    Route::post('/{storageUuid}/test', [S3StorageController::class, 'test'])
        ->where('storageUuid', $cuid)
        ->name('test');
});
