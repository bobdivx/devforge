<?php

use App\Http\Controllers\DevForge\StoreController;
use Illuminate\Support\Facades\Route;

Route::get('/store/listings', [StoreController::class, 'index'])
    ->name('store.listings.index');
Route::get('/store/listings/{slug}', [StoreController::class, 'show'])
    ->where('slug', '[a-z0-9]+(?:-[a-z0-9]+)*')
    ->name('store.listings.show');
Route::patch('/store/listings/{slug}', [StoreController::class, 'update'])
    ->where('slug', '[a-z0-9]+(?:-[a-z0-9]+)*')
    ->name('store.listings.update');
Route::post('/store/listings/{slug}/unpublish', [StoreController::class, 'unpublish'])
    ->where('slug', '[a-z0-9]+(?:-[a-z0-9]+)*')
    ->name('store.listings.unpublish');
Route::post('/store/listings/{slug}/install', [StoreController::class, 'install'])
    ->where('slug', '[a-z0-9]+(?:-[a-z0-9]+)*')
    ->name('store.listings.install');

Route::get('/applications/{applicationUuid}/store/publish-preview', [StoreController::class, 'publishPreview'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.store.publish-preview');
Route::post('/applications/{applicationUuid}/store/publish', [StoreController::class, 'publish'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.store.publish');
