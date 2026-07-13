<?php

use App\Http\Controllers\DevForge\ApplicationController;
use App\Http\Controllers\DevForge\GithubController;
use Illuminate\Support\Facades\Route;

Route::get('/deployment-targets', [ApplicationController::class, 'deploymentTargets'])
    ->name('deployment-targets.index');
Route::post('/applications', [ApplicationController::class, 'store'])
    ->name('applications.store');
Route::get('/applications/{applicationUuid}/linkable-databases', [ApplicationController::class, 'linkableDatabases'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.linkable-databases');
Route::post('/applications/{applicationUuid}/connect-database', [ApplicationController::class, 'connectDatabase'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.connect-database');
Route::get('/applications/{applicationUuid}/logs', [ApplicationController::class, 'logs'])
    ->where('applicationUuid', '[A-Za-z0-9-]{8,64}')
    ->name('applications.logs');

Route::prefix('github')->name('github.')->group(function () {
    Route::get('/apps', [GithubController::class, 'apps'])->name('apps.index');
    Route::get('/apps/{githubAppUuid}/repositories', [GithubController::class, 'repositories'])
        ->where('githubAppUuid', '[A-Za-z0-9-]{8,64}')
        ->name('apps.repositories');
    Route::get('/apps/{githubAppUuid}/repositories/{owner}/{repo}/branches', [GithubController::class, 'branches'])
        ->where('githubAppUuid', '[A-Za-z0-9-]{8,64}')
        ->name('apps.branches');
});
