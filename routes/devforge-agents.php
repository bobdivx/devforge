<?php

use App\Http\Controllers\DevForge\AgentController;
use App\Http\Controllers\DevForge\AgentMessageController;
use App\Http\Controllers\DevForge\AgentRunController;
use App\Http\Controllers\DevForge\AiProviderController;
use App\Http\Middleware\EnsureDevForgeAgentsEnabled;
use Illuminate\Support\Facades\Route;

Route::middleware(EnsureDevForgeAgentsEnabled::class)->group(function () {
    Route::prefix('agents')->name('agents.')->group(function () {
        Route::get('/', [AgentController::class, 'index'])->name('index');
        Route::post('/', [AgentController::class, 'store'])->name('store');
        Route::get('/{uuid}', [AgentController::class, 'show'])
            ->where('uuid', '[A-Za-z0-9-]{8,64}')
            ->name('show');
        Route::put('/{uuid}', [AgentController::class, 'update'])
            ->where('uuid', '[A-Za-z0-9-]{8,64}')
            ->name('update');
        Route::delete('/{uuid}', [AgentController::class, 'destroy'])
            ->where('uuid', '[A-Za-z0-9-]{8,64}')
            ->name('destroy');
        Route::post('/{uuid}/run', [AgentController::class, 'run'])
            ->middleware('throttle:devforge-agent-run')
            ->where('uuid', '[A-Za-z0-9-]{8,64}')
            ->name('run');

        Route::get('/{uuid}/messages', [AgentMessageController::class, 'index'])
            ->where('uuid', '[A-Za-z0-9-]{8,64}')
            ->name('messages.index');
        Route::post('/{uuid}/messages', [AgentMessageController::class, 'store'])
            ->middleware('throttle:devforge-agent-run')
            ->where('uuid', '[A-Za-z0-9-]{8,64}')
            ->name('messages.store');

        Route::get('/{uuid}/runs', [AgentRunController::class, 'index'])
            ->where('uuid', '[A-Za-z0-9-]{8,64}')
            ->name('runs.index');
        Route::get('/{uuid}/runs/{runUuid}', [AgentRunController::class, 'show'])
            ->where('uuid', '[A-Za-z0-9-]{8,64}')
            ->where('runUuid', '[A-Za-z0-9-]{8,64}')
            ->name('runs.show');
    });

    Route::prefix('ai')->name('ai.')->group(function () {
        Route::get('/providers', [AiProviderController::class, 'index'])->name('providers.index');
        Route::post('/providers/models', [AiProviderController::class, 'discoverModels'])->name('providers.models');
        Route::post('/providers', [AiProviderController::class, 'store'])->name('providers.store');
        Route::put('/providers/{id}', [AiProviderController::class, 'update'])->name('providers.update');
        Route::delete('/providers/{id}', [AiProviderController::class, 'destroy'])->name('providers.destroy');
        Route::post('/providers/{id}/test', [AiProviderController::class, 'test'])->name('providers.test');
    });
});
