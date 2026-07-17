<?php

use App\Http\Controllers\DevForge\TagController;
use Illuminate\Support\Facades\Route;

Route::get('/tags', [TagController::class, 'index'])->name('tags.index');
Route::post('/tags', [TagController::class, 'store'])->name('tags.store');
Route::get('/tags/{tagName}', [TagController::class, 'show'])
    ->where('tagName', '[A-Za-z0-9._-]+')
    ->name('tags.show');
Route::delete('/tags/{tagName}', [TagController::class, 'destroy'])
    ->where('tagName', '[A-Za-z0-9._-]+')
    ->name('tags.destroy');
Route::post('/tags/{tagName}/redeploy', [TagController::class, 'redeploy'])
    ->where('tagName', '[A-Za-z0-9._-]+')
    ->name('tags.redeploy');
