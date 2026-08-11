<?php

use App\Http\Controllers\DevForge\ServiceController;
use Illuminate\Support\Facades\Route;

$cuid = '[A-Za-z0-9-]{8,64}';

Route::get('/services/{serviceUuid}/settings', [ServiceController::class, 'settings'])
    ->where('serviceUuid', $cuid)
    ->name('services.settings.show');
Route::put('/services/{serviceUuid}/settings', [ServiceController::class, 'updateSettings'])
    ->where('serviceUuid', $cuid)
    ->name('services.settings.update');
Route::get('/services/{serviceUuid}/scheduled-tasks', [ServiceController::class, 'scheduledTasks'])
    ->where('serviceUuid', $cuid)
    ->name('services.scheduled-tasks.index');
Route::post('/services/{serviceUuid}/scheduled-tasks', [ServiceController::class, 'storeScheduledTask'])
    ->where('serviceUuid', $cuid)
    ->name('services.scheduled-tasks.store');
Route::put('/services/{serviceUuid}/scheduled-tasks/{taskUuid}', [ServiceController::class, 'updateScheduledTask'])
    ->where(['serviceUuid' => $cuid, 'taskUuid' => $cuid])
    ->name('services.scheduled-tasks.update');
Route::delete('/services/{serviceUuid}/scheduled-tasks/{taskUuid}', [ServiceController::class, 'destroyScheduledTask'])
    ->where(['serviceUuid' => $cuid, 'taskUuid' => $cuid])
    ->name('services.scheduled-tasks.destroy');
Route::get('/services/{serviceUuid}/scheduled-tasks/{taskUuid}/executions', [ServiceController::class, 'scheduledTaskExecutions'])
    ->where(['serviceUuid' => $cuid, 'taskUuid' => $cuid])
    ->name('services.scheduled-tasks.executions');
Route::post('/services/{serviceUuid}/scheduled-tasks/{taskUuid}/run', [ServiceController::class, 'runScheduledTask'])
    ->where(['serviceUuid' => $cuid, 'taskUuid' => $cuid])
    ->name('services.scheduled-tasks.run');
Route::get('/services/{serviceUuid}/webhooks', [ServiceController::class, 'webhooks'])
    ->where('serviceUuid', $cuid)
    ->name('services.webhooks.show');
Route::get('/services/{serviceUuid}/environment-variables', [ServiceController::class, 'environmentVariables'])
    ->where('serviceUuid', $cuid)
    ->name('services.environment-variables.index');
Route::post('/services/{serviceUuid}/environment-variables', [ServiceController::class, 'storeEnvironmentVariable'])
    ->where('serviceUuid', $cuid)
    ->name('services.environment-variables.store');
Route::put('/services/{serviceUuid}/environment-variables/{envUuid}', [ServiceController::class, 'updateEnvironmentVariable'])
    ->where(['serviceUuid' => $cuid, 'envUuid' => $cuid])
    ->name('services.environment-variables.update');
Route::get('/services/{serviceUuid}/environment-variables/{envUuid}/reveal', [ServiceController::class, 'revealEnvironmentVariable'])
    ->where(['serviceUuid' => $cuid, 'envUuid' => $cuid])
    ->name('services.environment-variables.reveal');
Route::delete('/services/{serviceUuid}/environment-variables/{envUuid}', [ServiceController::class, 'destroyEnvironmentVariable'])
    ->where(['serviceUuid' => $cuid, 'envUuid' => $cuid])
    ->name('services.environment-variables.destroy');
Route::get('/services/{serviceUuid}/storages', [ServiceController::class, 'storages'])
    ->where('serviceUuid', $cuid)
    ->name('services.storages.index');
