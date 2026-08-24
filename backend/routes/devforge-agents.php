<?php

use App\Http\Controllers\DevForge\AgentSkillController;
use App\Http\Controllers\DevForge\AgentStandingOrderController;
use App\Http\Controllers\DevForge\AgentController;
use App\Http\Controllers\DevForge\AgentInstructionsController;
use App\Http\Controllers\DevForge\AgentMemoryController;
use App\Http\Controllers\DevForge\AgentMessageController;
use App\Http\Controllers\DevForge\AgentMissionController;
use App\Http\Controllers\DevForge\AgentFeatureDeliveryController;
use App\Http\Controllers\DevForge\AgentRunController;
use App\Http\Controllers\DevForge\AgentRunStreamController;
use App\Http\Controllers\DevForge\AgentSessionController;
use App\Http\Controllers\DevForge\AiProviderController;
use App\Http\Controllers\DevForge\GraftAutomationController;
use App\Http\Controllers\DevForge\OllamaController;
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
        Route::delete('/{uuid}/sessions/{sessionUuid}', [AgentSessionController::class, 'destroy'])
            ->where('uuid', '[A-Za-z0-9-]{8,64}')
            ->where('sessionUuid', '[A-Za-z0-9-]{8,64}')
            ->name('sessions.destroy');
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
        Route::delete('/{uuid}/runs', [AgentRunController::class, 'clear'])
            ->where('uuid', '[A-Za-z0-9-]{8,64}')
            ->name('runs.clear');
        Route::post('/{uuid}/runs/clear', [AgentRunController::class, 'clear'])
            ->where('uuid', '[A-Za-z0-9-]{8,64}')
            ->name('runs.clear.post');
        Route::get('/{uuid}/runs/{runUuid}', [AgentRunController::class, 'show'])
            ->where('uuid', '[A-Za-z0-9-]{8,64}')
            ->where('runUuid', '[A-Za-z0-9-]{8,64}')
            ->name('runs.show');
        Route::delete('/{uuid}/runs/{runUuid}', [AgentRunController::class, 'destroy'])
            ->where('uuid', '[A-Za-z0-9-]{8,64}')
            ->where('runUuid', '[A-Za-z0-9-]{8,64}')
            ->name('runs.destroy');
        Route::get('/{uuid}/runs/{runUuid}/stream', AgentRunStreamController::class)
            ->where('uuid', '[A-Za-z0-9-]{8,64}')
            ->where('runUuid', '[A-Za-z0-9-]{8,64}')
            ->name('runs.stream');
        Route::post('/{uuid}/runs/{runUuid}/approval', [AgentRunController::class, 'resolveApproval'])
            ->middleware('throttle:devforge-agent-run')
            ->where('uuid', '[A-Za-z0-9-]{8,64}')
            ->where('runUuid', '[A-Za-z0-9-]{8,64}')
            ->name('runs.approval');
        Route::post('/{uuid}/runs/{runUuid}/cancel', [AgentRunController::class, 'cancel'])
            ->middleware('throttle:devforge-agent-run')
            ->where('uuid', '[A-Za-z0-9-]{8,64}')
            ->where('runUuid', '[A-Za-z0-9-]{8,64}')
            ->name('runs.cancel');
    });

    Route::prefix('ai')->name('ai.')->group(function () {
        Route::get('/providers', [AiProviderController::class, 'index'])->name('providers.index');
        Route::post('/providers/models', [AiProviderController::class, 'discoverModels'])->name('providers.models');
        Route::post('/providers', [AiProviderController::class, 'store'])->name('providers.store');
        Route::put('/providers/{id}', [AiProviderController::class, 'update'])->name('providers.update');
        Route::delete('/providers/{id}', [AiProviderController::class, 'destroy'])->name('providers.destroy');
        Route::post('/providers/{id}/test', [AiProviderController::class, 'test'])->name('providers.test');
        Route::get('/ollama', [OllamaController::class, 'status'])->name('ollama.status');
        Route::get('/ollama/instances', [OllamaController::class, 'instances'])->name('ollama.instances');
        Route::post('/ollama/pull', [OllamaController::class, 'pull'])
            ->middleware('throttle:10,1')
            ->name('ollama.pull');
        Route::post('/ollama/models/delete', [OllamaController::class, 'destroyModel'])
            ->middleware('throttle:20,1')
            ->name('ollama.destroy');
        // Alias legacy (DELETE + body is often stripped/blocked by proxies).
        Route::delete('/ollama/models', [OllamaController::class, 'destroyModel'])
            ->middleware('throttle:20,1')
            ->name('ollama.destroy.legacy');
        Route::put('/ollama/provider-model', [OllamaController::class, 'setProviderModel'])
            ->name('ollama.provider-model');
        Route::post('/ollama/assign-agent', [OllamaController::class, 'assignToAgent'])
            ->name('ollama.assign-agent');
        Route::get('/instructions', [AgentInstructionsController::class, 'show'])->name('instructions.show');
        Route::put('/instructions', [AgentInstructionsController::class, 'update'])->name('instructions.update');
        Route::get('/missions', [AgentMissionController::class, 'index'])->name('missions.index');
        Route::post('/missions', [AgentMissionController::class, 'store'])->name('missions.store');
        Route::post('/missions/bulk-status', [AgentMissionController::class, 'bulkStatus'])
            ->name('missions.bulk-status');
        Route::patch('/missions/{uuid}', [AgentMissionController::class, 'update'])
            ->where('uuid', '[A-Za-z0-9-]{8,64}')
            ->name('missions.update');
        Route::get('/missions/{uuid}/delivery', [AgentFeatureDeliveryController::class, 'show'])
            ->where('uuid', '[A-Za-z0-9-]{8,64}')
            ->name('missions.delivery.show');
        Route::post('/missions/{uuid}/delivery/validate', [AgentFeatureDeliveryController::class, 'validateMerge'])
            ->where('uuid', '[A-Za-z0-9-]{8,64}')
            ->name('missions.delivery.validate');
        Route::post('/missions/{uuid}/delivery/request-changes', [AgentFeatureDeliveryController::class, 'requestChanges'])
            ->where('uuid', '[A-Za-z0-9-]{8,64}')
            ->name('missions.delivery.request-changes');
        Route::get('/standing-orders', [AgentStandingOrderController::class, 'index'])->name('standing-orders.index');
        Route::post('/standing-orders', [AgentStandingOrderController::class, 'store'])->name('standing-orders.store');
        Route::put('/standing-orders/{id}', [AgentStandingOrderController::class, 'update'])
            ->whereNumber('id')
            ->name('standing-orders.update');
        Route::delete('/standing-orders/{id}', [AgentStandingOrderController::class, 'destroy'])
            ->whereNumber('id')
            ->name('standing-orders.destroy');
        Route::get('/skills', [AgentSkillController::class, 'index'])->name('skills.index');
        Route::post('/skills', [AgentSkillController::class, 'store'])->name('skills.store');
        Route::put('/skills/{id}', [AgentSkillController::class, 'update'])
            ->whereNumber('id')
            ->name('skills.update');
        Route::delete('/skills/{id}', [AgentSkillController::class, 'destroy'])
            ->whereNumber('id')
            ->name('skills.destroy');
    });

    Route::prefix('graft')->name('graft.')->group(function () {
        Route::post('/deploy-all', [GraftAutomationController::class, 'deployToAllRepos'])->name('deploy-all');
        Route::get('/status', [GraftAutomationController::class, 'status'])->name('status');
        Route::post('/deploy/{repo}', [GraftAutomationController::class, 'deployToRepo'])
            ->where('repo', '.*')
            ->name('deploy-repo');
    });

    Route::prefix('ai/graft')->group(function () {
        Route::post('/deploy-all', [GraftAutomationController::class, 'deployToAllRepos']);
        Route::get('/status', [GraftAutomationController::class, 'status']);
        Route::post('/deploy/{repo}', [GraftAutomationController::class, 'deployToRepo'])->where('repo', '.*');
    });

    Route::prefix('devforge/graft')->group(function () {
        Route::post('/deploy-all', [GraftAutomationController::class, 'deployToAllRepos']);
        Route::get('/status', [GraftAutomationController::class, 'status']);
        Route::post('/deploy/{repo}', [GraftAutomationController::class, 'deployToRepo'])->where('repo', '.*');
    });
});