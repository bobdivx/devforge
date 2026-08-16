<?php

use App\Http\Controllers\DevForge\ApplicationController;
use App\Http\Controllers\DevForge\GithubController;
use App\Http\Controllers\DevForge\GithubRunnerController;
use Illuminate\Support\Facades\Route;

Route::get('/deployment-targets', [ApplicationController::class, 'deploymentTargets'])
    ->name('deployment-targets.index');
Route::post('/applications', [ApplicationController::class, 'store'])
    ->name('applications.store');
Route::patch('/applications/{applicationUuid}', [ApplicationController::class, 'update'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.update');
Route::delete('/applications/{applicationUuid}', [ApplicationController::class, 'destroy'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.destroy');
Route::get('/applications/{applicationUuid}/domains', [ApplicationController::class, 'domains'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.domains.show');
Route::put('/applications/{applicationUuid}/domains', [ApplicationController::class, 'updateDomains'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.domains.update');
Route::post('/applications/{applicationUuid}/domains/generate', [ApplicationController::class, 'generateDomain'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.domains.generate');
Route::get('/applications/{applicationUuid}/linkable-databases', [ApplicationController::class, 'linkableDatabases'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.linkable-databases');
Route::post('/applications/{applicationUuid}/connect-database', [ApplicationController::class, 'connectDatabase'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.connect-database');
Route::post('/applications/{applicationUuid}/databases/{databaseUuid}/reset', [ApplicationController::class, 'resetLinkedDatabase'])
    ->where([
        'applicationUuid' => '[A-Za-z0-9-]{8,64}',
        'databaseUuid' => '[A-Za-z0-9-]{8,64}',
    ])
    ->name('applications.databases.reset');
Route::get('/applications/{applicationUuid}/logs', [ApplicationController::class, 'logs'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.logs');
Route::get('/applications/{applicationUuid}/webhooks', [ApplicationController::class, 'webhooks'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.webhooks.show');
Route::put('/applications/{applicationUuid}/webhooks', [ApplicationController::class, 'updateWebhooks'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.webhooks.update');
Route::get('/applications/{applicationUuid}/scheduled-tasks', [ApplicationController::class, 'scheduledTasks'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.scheduled-tasks.index');
Route::post('/applications/{applicationUuid}/scheduled-tasks', [ApplicationController::class, 'storeScheduledTask'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.scheduled-tasks.store');
Route::put('/applications/{applicationUuid}/scheduled-tasks/{taskUuid}', [ApplicationController::class, 'updateScheduledTask'])
    ->where(['applicationUuid' => '[A-Za-z0-9-]{8,64}', 'taskUuid' => '[A-Za-z0-9-]{8,64}'])
    ->name('applications.scheduled-tasks.update');
Route::delete('/applications/{applicationUuid}/scheduled-tasks/{taskUuid}', [ApplicationController::class, 'destroyScheduledTask'])
    ->where(['applicationUuid' => '[A-Za-z0-9-]{8,64}', 'taskUuid' => '[A-Za-z0-9-]{8,64}'])
    ->name('applications.scheduled-tasks.destroy');
Route::get('/applications/{applicationUuid}/scheduled-tasks/{taskUuid}/executions', [ApplicationController::class, 'scheduledTaskExecutions'])
    ->where(['applicationUuid' => '[A-Za-z0-9-]{8,64}', 'taskUuid' => '[A-Za-z0-9-]{8,64}'])
    ->name('applications.scheduled-tasks.executions');
Route::post('/applications/{applicationUuid}/scheduled-tasks/{taskUuid}/run', [ApplicationController::class, 'runScheduledTask'])
    ->where(['applicationUuid' => '[A-Za-z0-9-]{8,64}', 'taskUuid' => '[A-Za-z0-9-]{8,64}'])
    ->name('applications.scheduled-tasks.run');
Route::get('/applications/{applicationUuid}/previews', [ApplicationController::class, 'previews'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.previews.index');
Route::post('/applications/{applicationUuid}/feature-requests', [\App\Http\Controllers\DevForge\AgentFeatureDeliveryController::class, 'storeForApplication'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.feature-requests.store');
Route::get('/applications/{applicationUuid}/previews/settings', [ApplicationController::class, 'previewSettings'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.previews.settings.show');
Route::put('/applications/{applicationUuid}/previews/settings', [ApplicationController::class, 'updatePreviewSettings'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.previews.settings.update');
Route::delete('/applications/{applicationUuid}/previews/{pullRequestId}', [ApplicationController::class, 'destroyPreview'])
    ->where([
        'applicationUuid' => '[A-Za-z0-9-]{8,64}',
        'pullRequestId' => '[0-9]+',
    ])
    ->name('applications.previews.destroy');
Route::get('/applications/{applicationUuid}/storages', [ApplicationController::class, 'storages'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.storages.index');
Route::post('/applications/{applicationUuid}/storages', [ApplicationController::class, 'storeStorage'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.storages.store');
Route::put('/applications/{applicationUuid}/storages/{storageUuid}', [ApplicationController::class, 'updateStorage'])
    ->where(['applicationUuid' => '[A-Za-z0-9-]{8,64}', 'storageUuid' => '[A-Za-z0-9-]{8,64}'])
    ->name('applications.storages.update');
Route::delete('/applications/{applicationUuid}/storages/{storageUuid}', [ApplicationController::class, 'destroyStorage'])
    ->where(['applicationUuid' => '[A-Za-z0-9-]{8,64}', 'storageUuid' => '[A-Za-z0-9-]{8,64}'])
    ->name('applications.storages.destroy');
Route::get('/applications/{applicationUuid}/resource-limits', [ApplicationController::class, 'resourceLimits'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.resource-limits.show');
Route::put('/applications/{applicationUuid}/resource-limits', [ApplicationController::class, 'updateResourceLimits'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.resource-limits.update');
Route::get('/applications/{applicationUuid}/advanced', [ApplicationController::class, 'advancedSettings'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.advanced.show');
Route::put('/applications/{applicationUuid}/advanced', [ApplicationController::class, 'updateAdvancedSettings'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.advanced.update');
Route::get('/applications/{applicationUuid}/resource-operations', [ApplicationController::class, 'resourceOperations'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.resource-operations.show');
Route::post('/applications/{applicationUuid}/clone', [ApplicationController::class, 'cloneApplication'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.clone');
Route::put('/applications/{applicationUuid}/move', [ApplicationController::class, 'moveApplication'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.move');
Route::get('/applications/{applicationUuid}/environment-variables', [ApplicationController::class, 'environmentVariables'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.environment-variables.index');
Route::post('/applications/{applicationUuid}/environment-variables', [ApplicationController::class, 'storeEnvironmentVariable'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.environment-variables.store');
Route::post('/applications/{applicationUuid}/environment-variables/import', [ApplicationController::class, 'importEnvironmentVariables'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.environment-variables.import');
Route::put('/applications/{applicationUuid}/environment-variables/{envUuid}', [ApplicationController::class, 'updateEnvironmentVariable'])
    ->where(['applicationUuid' => '[A-Za-z0-9-]{8,64}', 'envUuid' => '[A-Za-z0-9-]{8,64}'])
    ->name('applications.environment-variables.update');
Route::get('/applications/{applicationUuid}/environment-variables/{envUuid}/reveal', [ApplicationController::class, 'revealEnvironmentVariable'])
    ->where(['applicationUuid' => '[A-Za-z0-9-]{8,64}', 'envUuid' => '[A-Za-z0-9-]{8,64}'])
    ->name('applications.environment-variables.reveal');
Route::delete('/applications/{applicationUuid}/environment-variables/{envUuid}', [ApplicationController::class, 'destroyEnvironmentVariable'])
    ->where(['applicationUuid' => '[A-Za-z0-9-]{8,64}', 'envUuid' => '[A-Za-z0-9-]{8,64}'])
    ->name('applications.environment-variables.destroy');
Route::get('/applications/{applicationUuid}/source', [ApplicationController::class, 'sourceInfo'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.source.info');
Route::get('/applications/{applicationUuid}/git-sync', [ApplicationController::class, 'gitSync'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.git-sync');
Route::put('/applications/{applicationUuid}/git-branch', [ApplicationController::class, 'updateGitBranch'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.git-branch');
Route::get('/applications/{applicationUuid}/source/list', [ApplicationController::class, 'sourceList'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.source.list');
Route::get('/applications/{applicationUuid}/source/read', [ApplicationController::class, 'sourceRead'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.source.read');
Route::put('/applications/{applicationUuid}/source/write', [ApplicationController::class, 'sourceWrite'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.source.write');
Route::get('/applications/{applicationUuid}/runtime-settings', [ApplicationController::class, 'runtimeSettings'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.runtime-settings.show');
Route::put('/applications/{applicationUuid}/runtime-settings', [ApplicationController::class, 'updateRuntimeSettings'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.runtime-settings.update');
Route::post('/applications/{applicationUuid}/runtime-settings/detect', [ApplicationController::class, 'detectRuntimeSettings'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.runtime-settings.detect');
Route::get('/applications/{applicationUuid}/readiness', [ApplicationController::class, 'readiness'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.readiness.show');
Route::patch('/applications/{applicationUuid}/readiness', [ApplicationController::class, 'updateReadiness'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.readiness.update');
Route::post('/applications/{applicationUuid}/readiness/probe', [ApplicationController::class, 'probeReadiness'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.readiness.probe');
Route::post('/applications/{applicationUuid}/readiness/interventions/{interventionUuid}/done', [ApplicationController::class, 'acknowledgeReadinessIntervention'])
    ->where([
        'applicationUuid' => '[A-Za-z0-9-]{8,64}',
        'interventionUuid' => '[A-Za-z0-9-]{8,64}',
    ])
    ->name('applications.readiness.interventions.done');

Route::prefix('github')->name('github.')->group(function () {
    Route::get('/apps', [GithubController::class, 'apps'])->name('apps.index');
    Route::post('/apps', [GithubController::class, 'store'])->name('apps.store');
    Route::get('/apps/{githubAppUuid}/install-url', [GithubController::class, 'installUrl'])
        ->where('githubAppUuid', '[A-Za-z0-9-]{8,64}')
        ->name('apps.install-url');
    Route::put('/apps/{githubAppUuid}/packages-token', [GithubController::class, 'updatePackagesToken'])
        ->where('githubAppUuid', '[A-Za-z0-9-]{8,64}')
        ->name('apps.packages-token.update');
    Route::get('/apps/{githubAppUuid}/repositories', [GithubController::class, 'repositories'])
        ->where('githubAppUuid', '[A-Za-z0-9-]{8,64}')
        ->name('apps.repositories');
    Route::get('/apps/{githubAppUuid}/repositories/{owner}/{repo}/branches', [GithubController::class, 'branches'])
        ->where('githubAppUuid', '[A-Za-z0-9-]{8,64}')
        ->name('apps.branches');

    Route::get('/runners', [GithubRunnerController::class, 'index'])->name('runners.index');
    Route::post('/runners', [GithubRunnerController::class, 'store'])->name('runners.store');
    Route::get('/runners/{serverUuid}/{containerName}', [GithubRunnerController::class, 'show'])
        ->where([
            'serverUuid' => '[A-Za-z0-9-]{8,64}',
            'containerName' => '[A-Za-z0-9][A-Za-z0-9._-]{0,254}',
        ])
        ->name('runners.show');
    Route::get('/runners/{serverUuid}/{containerName}/logs', [GithubRunnerController::class, 'logs'])
        ->where([
            'serverUuid' => '[A-Za-z0-9-]{8,64}',
            'containerName' => '[A-Za-z0-9][A-Za-z0-9._-]{0,254}',
        ])
        ->name('runners.logs');
    Route::delete('/runners/{serverUuid}/{containerName}', [GithubRunnerController::class, 'destroy'])
        ->where([
            'serverUuid' => '[A-Za-z0-9-]{8,64}',
            'containerName' => '[A-Za-z0-9][A-Za-z0-9._-]{0,254}',
        ])
        ->name('runners.destroy');
    Route::post('/runners/{serverUuid}/{containerName}/applications', [GithubRunnerController::class, 'attachApplication'])
        ->where([
            'serverUuid' => '[A-Za-z0-9-]{8,64}',
            'containerName' => '[A-Za-z0-9][A-Za-z0-9._-]{0,254}',
        ])
        ->name('runners.applications.attach');
    Route::delete('/runners/{serverUuid}/{containerName}/applications/{applicationUuid}', [GithubRunnerController::class, 'detachApplication'])
        ->where([
            'serverUuid' => '[A-Za-z0-9-]{8,64}',
            'containerName' => '[A-Za-z0-9][A-Za-z0-9._-]{0,254}',
            'applicationUuid' => '[A-Za-z0-9-]{8,64}',
        ])
        ->name('runners.applications.detach');
    Route::post('/runners/{serverUuid}/{containerName}/{action}', [GithubRunnerController::class, 'action'])
        ->where([
            'serverUuid' => '[A-Za-z0-9-]{8,64}',
            'containerName' => '[A-Za-z0-9][A-Za-z0-9._-]{0,254}',
            'action' => 'start|stop|restart|recreate',
        ])
        ->name('runners.action');
});
