<?php

use App\Http\Controllers\DevForge\AgentController;
use App\Http\Controllers\DevForge\AgentInstructionsController;
use App\Http\Controllers\DevForge\AgentMemoryController;
use App\Http\Controllers\DevForge\AgentMessageController;
use App\Http\Controllers\DevForge\AgentMissionController;
use App\Http\Controllers\DevForge\AgentRunController;
use App\Http\Controllers\DevForge\AgentRunStreamController;
use App\Http\Controllers\DevForge\AgentSessionController;
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
        Route::post('/{uuid}/messages/{messageUuid}/approval', [AgentMessageController::class, 'resolveApproval'])
            ->middleware('throttle:devforge-agent-run')
            ->where('uuid', '[A-Za-z0-9-]{8,64}')
            ->where('messageUuid', '[A-Za-z0-9-]{8,64}')
            ->name('messages.approval');

        Route::get('/{uuid}/sessions', [AgentSessionController::class, 'index'])
            ->where('uuid', '[A-Za-z0-9-]{8,64}')
            ->name('sessions.index');
        Route::post('/{uuid}/sessions', [AgentSessionController::class, 'store'])
            ->where('uuid', '[A-Za-z0-9-]{8,64}')
            ->name('sessions.store');
        Route::patch('/{uuid}/sessions/{sessionUuid}', [AgentSessionController::class, 'update'])
            ->where('uuid', '[A-Za-z0-9-]{8,64}')
            ->where('sessionUuid', '[A-Za-z0-9-]{8,64}')
            ->name('sessions.update');
        Route::post('/{uuid}/sessions/{sessionUuid}/activate', [AgentSessionController::class, 'activate'])
            ->where('uuid', '[A-Za-z0-9-]{8,64}')
            ->where('sessionUuid', '[A-Za-z0-9-]{8,64}')
            ->name('sessions.activate');
        Route::get('/{uuid}/sessions/{sessionUuid}/messages', [AgentSessionController::class, 'messages'])
            ->where('uuid', '[A-Za-z0-9-]{8,64}')
            ->where('sessionUuid', '[A-Za-z0-9-]{8,64}')
            ->name('sessions.messages.index');
        Route::post('/{uuid}/sessions/{sessionUuid}/messages', [AgentSessionController::class, 'sendMessage'])
            ->middleware('throttle:devforge-agent-run')
            ->where('uuid', '[A-Za-z0-9-]{8,64}')
            ->where('sessionUuid', '[A-Za-z0-9-]{8,64}')
            ->name('sessions.messages.store');

        Route::get('/{uuid}/memories', [AgentMemoryController::class, 'index'])
            ->where('uuid', '[A-Za-z0-9-]{8,64}')
            ->name('memories.index');
        Route::post('/{uuid}/memories', [AgentMemoryController::class, 'store'])
            ->where('uuid', '[A-Za-z0-9-]{8,64}')
            ->name('memories.store');
        Route::delete('/{uuid}/memories/{memoryId}', [AgentMemoryController::class, 'destroy'])
            ->where('uuid', '[A-Za-z0-9-]{8,64}')
            ->whereNumber('memoryId')
            ->name('memories.destroy');
        Route::post('/{uuid}/memories/clear', [AgentMemoryController::class, 'clear'])
            ->where('uuid', '[A-Za-z0-9-]{8,64}')
            ->name('memories.clear');

        Route::get('/{uuid}/runs', [AgentRunController::class, 'index'])
            ->where('uuid', '[A-Za-z0-9-]{8,64}')
            ->name('runs.index');
        Route::get('/{uuid}/runs/{runUuid}', [AgentRunController::class, 'show'])
            ->where('uuid', '[A-Za-z0-9-]{8,64}')
            ->where('runUuid', '[A-Za-z0-9-]{8,64}')
            ->name('runs.show');
        Route::get('/{uuid}/runs/{runUuid}/stream', AgentRunStreamController::class)
            ->where('uuid', '[A-Za-z0-9-]{8,64}')
            ->where('runUuid', '[A-Za-z0-9-]{8,64}')
            ->name('runs.stream');
        Route::post('/{uuid}/runs/{runUuid}/approval', [AgentRunController::class, 'resolveApproval'])
            ->middleware('throttle:devforge-agent-run')
            ->where('uuid', '[A-Za-z0-9-]{8,64}')
            ->where('runUuid', '[A-Za-z0-9-]{8,64}')
            ->name('runs.approval');
    });

    Route::prefix('ai')->name('ai.')->group(function () {
        Route::get('/providers', [AiProviderController::class, 'index'])->name('providers.index');
        Route::post('/providers/models', [AiProviderController::class, 'discoverModels'])->name('providers.models');
        Route::post('/providers', [AiProviderController::class, 'store'])->name('providers.store');
        Route::put('/providers/{id}', [AiProviderController::class, 'update'])->name('providers.update');
        Route::delete('/providers/{id}', [AiProviderController::class, 'destroy'])->name('providers.destroy');
        Route::post('/providers/{id}/test', [AiProviderController::class, 'test'])->name('providers.test');
        Route::get('/instructions', [AgentInstructionsController::class, 'show'])->name('instructions.show');
        Route::put('/instructions', [AgentInstructionsController::class, 'update'])->name('instructions.update');
        Route::get('/missions', [AgentMissionController::class, 'index'])->name('missions.index');
        Route::post('/missions', [AgentMissionController::class, 'store'])->name('missions.store');
        Route::patch('/missions/{uuid}', [AgentMissionController::class, 'update'])
            ->where('uuid', '[A-Za-z0-9-]{8,64}')
            ->name('missions.update');
    });
});