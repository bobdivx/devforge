<?php



use App\Http\Controllers\DevForge\S3StorageController;

use Illuminate\Support\Facades\Route;



Route::prefix('s3-storages')->name('s3-storages.')->group(function () {

    Route::get('/', [S3StorageController::class, 'index'])->name('index');

    Route::get('/{storageUuid}', [S3StorageController::class, 'show'])

        ->whereUuid('storageUuid')

        ->name('show');

    Route::post('/', [S3StorageController::class, 'store'])->name('store');

    Route::put('/{storageUuid}', [S3StorageController::class, 'update'])

        ->whereUuid('storageUuid')

        ->name('update');

    Route::delete('/{storageUuid}', [S3StorageController::class, 'destroy'])

        ->whereUuid('storageUuid')

        ->name('destroy');

    Route::post('/{storageUuid}/test', [S3StorageController::class, 'test'])

        ->whereUuid('storageUuid')

        ->name('test');

});

