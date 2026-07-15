<?php

use App\Http\Controllers\DevForge\DeploymentController;
use App\Http\Controllers\DevForge\RealtimeController;
use App\Http\Controllers\DevForge\ResourceStatusController;
use App\Http\Controllers\DevForge\TerminalController;
use Illuminate\Support\Facades\Route;

Route::get('/deployments', [DeploymentController::class, 'index'])->name('deployments.index');
Route::get('/deployments/{deploymentUuid}', [DeploymentController::class, 'show'])
    ->where('deploymentUuid', '[A-Za-z0-9_-]{1,255}')
    ->name('deployments.show');
Route::get('/deployments/{deploymentUuid}/logs', [DeploymentController::class, 'logs'])
    ->where('deploymentUuid', '[A-Za-z0-9_-]{1,255}')
    ->name('deployments.logs');
Route::patch('/deployments/{deploymentUuid}/debug-logs', [DeploymentController::class, 'toggleDebugLogs'])
    ->where('deploymentUuid', '[A-Za-z0-9_-]{1,255}')
    ->name('deployments.debug-logs');
Route::get('/deployments/{deploymentUuid}/monitoring', [DeploymentController::class, 'monitoring'])
    ->where('deploymentUuid', '[A-Za-z0-9_-]{1,255}')
    ->name('deployments.monitoring');
Route::get('/realtime', RealtimeController::class)->name('realtime');
Route::get('/resources/status', ResourceStatusController::class)->name('resources.status');
Route::get('/terminal/config', TerminalController::class)
    ->middleware('can.access.terminal')
    ->name('terminal.config');
