<?php

use App\Http\Controllers\DevForge\EnvironmentController;
use App\Http\Controllers\DevForge\NotificationController;
use App\Http\Controllers\DevForge\OverviewController;
use App\Http\Controllers\DevForge\ProfileController;
use App\Http\Controllers\DevForge\ProjectController;
use App\Http\Controllers\DevForge\SecurityController;
use App\Http\Controllers\DevForge\SettingsController;
use App\Http\Controllers\DevForge\SharedVariableController;
use App\Http\Controllers\DevForge\TeamReadController;
use Illuminate\Support\Facades\Route;

Route::get('/overview', OverviewController::class)->name('overview');
Route::get('/dashboard', OverviewController::class)->name('dashboard');

Route::get('/projects', [ProjectController::class, 'index'])->name('projects.index');
Route::post('/projects', [ProjectController::class, 'store'])->name('projects.store');
Route::get('/projects/{projectUuid}', [ProjectController::class, 'show'])->name('projects.show');
Route::put('/projects/{projectUuid}', [ProjectController::class, 'update'])->name('projects.update');
Route::delete('/projects/{projectUuid}', [ProjectController::class, 'destroy'])->name('projects.destroy');

Route::get('/projects/{projectUuid}/environments', [EnvironmentController::class, 'index'])
    ->name('projects.environments.index');
Route::post('/projects/{projectUuid}/environments', [EnvironmentController::class, 'store'])
    ->name('projects.environments.store');
Route::get('/projects/{projectUuid}/environments/{environmentUuid}', [EnvironmentController::class, 'show'])
    ->name('projects.environments.show');
Route::put('/projects/{projectUuid}/environments/{environmentUuid}', [EnvironmentController::class, 'update'])
    ->name('projects.environments.update');
Route::delete('/projects/{projectUuid}/environments/{environmentUuid}', [EnvironmentController::class, 'destroy'])
    ->name('projects.environments.destroy');

Route::get('/profile', [ProfileController::class, 'show'])->name('profile.show');
Route::put('/profile', [ProfileController::class, 'update'])->name('profile.update');
Route::get('/teams', [TeamReadController::class, 'index'])->name('teams.index');
Route::get('/teams/current/members', [TeamReadController::class, 'members'])->name('teams.members');
Route::get('/settings', SettingsController::class)->name('settings.show');
Route::get('/notifications', NotificationController::class)->name('notifications.index');
Route::get('/shared-variables', SharedVariableController::class)->name('shared-variables.index');
Route::get('/security/keys', [SecurityController::class, 'keys'])->name('security.keys.index');
