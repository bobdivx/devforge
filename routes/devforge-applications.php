<?php

use App\Http\Controllers\DevForge\ApplicationController;
use App\Http\Controllers\DevForge\GithubController;
use Illuminate\Support\Facades\Route;

Route::get('/deployment-targets', [ApplicationController::class, 'deploymentTargets'])
    ->name('deployment-targets.index');
Route::post('/applications', [ApplicationController::class, 'store'])
    ->name('applications.store');
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
Route::get('/applications/{applicationUuid}/logs', [ApplicationController::class, 'logs'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.logs');
Route::get('/applications/{applicationUuid}/environment-variables', [ApplicationController::class, 'environmentVariables'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.environment-variables.index');
Route::post('/applications/{applicationUuid}/environment-variables', [ApplicationController::class, 'storeEnvironmentVariable'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.environment-variables.store');
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
Route::get('/applications/{applicationUuid}/source/list', [ApplicationController::class, 'sourceList'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.source.list');
Route::get('/applications/{applicationUuid}/source/read', [ApplicationController::class, 'sourceRead'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.source.read');
Route::put('/applications/{applicationUuid}/source/write', [ApplicationController::class, 'sourceWrite'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.source.write');

Route::prefix('github')->name('github.')->group(function () {
    Route::get('/apps', [GithubController::class, 'apps'])->name('apps.index');
    Route::get('/apps/{githubAppUuid}/repositories', [GithubController::class, 'repositories'])
        ->where('githubAppUuid', '[A-Za-z0-9-]{8,64}')
        ->name('apps.repositories');
    Route::get('/apps/{githubAppUuid}/repositories/{owner}/{repo}/branches', [GithubController::class, 'branches'])
        ->where('githubAppUuid', '[A-Za-z0-9-]{8,64}')
        ->name('apps.branches');
});
