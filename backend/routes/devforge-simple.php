<?php

use App\Http\Controllers\DevForge\EnvironmentController;
use App\Http\Controllers\DevForge\NotificationController;
use App\Http\Controllers\DevForge\OauthSettingsController;
use App\Http\Controllers\DevForge\OverviewController;
use App\Http\Controllers\DevForge\ProfileController;
use App\Http\Controllers\DevForge\ProjectController;
use App\Http\Controllers\DevForge\SecurityController;
use App\Http\Controllers\DevForge\SettingsController;
use App\Http\Controllers\DevForge\InstanceBackupController;
use App\Http\Controllers\DevForge\ScheduledJobsController;
use App\Http\Controllers\DevForge\SharedVariableController;
use App\Http\Controllers\DevForge\AgentKeyRequestController;
use App\Http\Controllers\DevForge\SubscriptionController;
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
Route::put('/profile/password', [ProfileController::class, 'updatePassword'])->name('profile.password.update');
Route::get('/profile/two-factor', [ProfileController::class, 'twoFactorStatus'])->name('profile.two-factor.show');
Route::post('/profile/two-factor', [ProfileController::class, 'enableTwoFactor'])->name('profile.two-factor.enable');
Route::post('/profile/two-factor/confirm', [ProfileController::class, 'confirmTwoFactor'])->name('profile.two-factor.confirm');
Route::delete('/profile/two-factor', [ProfileController::class, 'disableTwoFactor'])->name('profile.two-factor.disable');
Route::post('/profile/two-factor/recovery-codes', [ProfileController::class, 'regenerateRecoveryCodes'])->name('profile.two-factor.recovery-codes');
Route::get('/settings', [SettingsController::class, 'show'])->name('settings.show');
Route::put('/settings/instance', [SettingsController::class, 'updateInstance'])->name('settings.instance.update');
Route::put('/settings/advanced', [SettingsController::class, 'updateAdvanced'])->name('settings.advanced.update');
Route::put('/settings/sso', [SettingsController::class, 'updateSso'])->name('settings.sso.update');
Route::post('/settings/sso/start', [SettingsController::class, 'startSso'])->name('settings.sso.start');
Route::put('/settings/email', [SettingsController::class, 'updateEmail'])->name('settings.email.update');
Route::put('/settings/updates', [SettingsController::class, 'updateUpdates'])->name('settings.updates.update');
Route::post('/settings/updates/check', [SettingsController::class, 'checkUpdates'])->name('settings.updates.check');
Route::get('/settings/updates/status', [SettingsController::class, 'upgradeStatus'])->name('settings.updates.status');
Route::post('/settings/updates/upgrade', [SettingsController::class, 'upgrade'])->name('settings.updates.upgrade');
Route::get('/settings/scheduled-jobs', [ScheduledJobsController::class, 'index'])->name('settings.scheduled-jobs.index');
Route::get('/settings/scheduled-jobs/definitions', [ScheduledJobsController::class, 'definitions'])->name('settings.scheduled-jobs.definitions');
Route::get('/settings/backup', [InstanceBackupController::class, 'show'])->name('settings.backup.show');
Route::post('/settings/backup/init', [InstanceBackupController::class, 'init'])->name('settings.backup.init');
Route::put('/settings/backup/database', [InstanceBackupController::class, 'updateDatabase'])->name('settings.backup.database.update');
Route::put('/settings/backup/schedule', [InstanceBackupController::class, 'updateSchedule'])->name('settings.backup.schedule.update');
Route::post('/settings/backup/run', [InstanceBackupController::class, 'run'])->name('settings.backup.run');
Route::get('/settings/backup/export', [InstanceBackupController::class, 'export'])->name('settings.backup.export');
Route::post('/settings/backup/import', [InstanceBackupController::class, 'import'])->name('settings.backup.import');
Route::delete('/settings/backup/executions/failed', [InstanceBackupController::class, 'destroyFailedExecutions'])
    ->name('settings.backup.executions.destroy-failed');
Route::delete('/settings/backup/executions/{executionUuid}', [InstanceBackupController::class, 'destroyExecution'])
    ->where('executionUuid', '[A-Za-z0-9-]{8,64}')
    ->name('settings.backup.executions.destroy');
Route::post('/settings/backup/migrate-coolify', [InstanceBackupController::class, 'migrateFromCoolify'])->name('settings.backup.migrate-coolify');
Route::get('/settings/oauth', [OauthSettingsController::class, 'index'])->name('settings.oauth');
Route::put('/settings/oauth/{provider}', [OauthSettingsController::class, 'update'])->name('settings.oauth.update');
Route::get('/notifications', [NotificationController::class, 'index'])->name('notifications.index');
Route::put('/notifications/{channel}', [NotificationController::class, 'update'])->name('notifications.update');
Route::get('/shared-variables', [SharedVariableController::class, 'index'])->name('shared-variables.index');
Route::post('/shared-variables', [SharedVariableController::class, 'store'])->name('shared-variables.store');
Route::put('/shared-variables/{sharedVariable}', [SharedVariableController::class, 'update'])->name('shared-variables.update');
Route::delete('/shared-variables/{sharedVariable}', [SharedVariableController::class, 'destroy'])->name('shared-variables.destroy');
Route::get('/security/keys', [SecurityController::class, 'keys'])->name('security.keys.index');
Route::post('/security/keys', [SecurityController::class, 'storeKey'])->name('security.keys.store');
Route::post('/security/keys/generate', [SecurityController::class, 'generateKey'])->name('security.keys.generate');
Route::put('/security/keys/{keyUuid}', [SecurityController::class, 'updateKey'])
    ->where('keyUuid', '[A-Za-z0-9-]{8,64}')
    ->name('security.keys.update');
Route::delete('/security/keys/{keyUuid}', [SecurityController::class, 'destroyKey'])
    ->where('keyUuid', '[A-Za-z0-9-]{8,64}')
    ->name('security.keys.destroy');
Route::get('/security/api-tokens', [SecurityController::class, 'apiTokens'])->name('security.api-tokens.index');
Route::post('/security/api-tokens', [SecurityController::class, 'storeApiToken'])->name('security.api-tokens.store');
Route::delete('/security/api-tokens/{tokenId}', [SecurityController::class, 'destroyApiToken'])
    ->whereNumber('tokenId')
    ->name('security.api-tokens.destroy');
Route::get('/security/cloud-tokens', [SecurityController::class, 'cloudTokens'])->name('security.cloud-tokens.index');
Route::post('/security/cloud-tokens', [SecurityController::class, 'storeCloudToken'])->name('security.cloud-tokens.store');
Route::put('/security/cloud-tokens/{tokenUuid}', [SecurityController::class, 'updateCloudToken'])
    ->where('tokenUuid', '[A-Za-z0-9-]{8,64}')
    ->name('security.cloud-tokens.update');
Route::delete('/security/cloud-tokens/{tokenUuid}', [SecurityController::class, 'destroyCloudToken'])
    ->where('tokenUuid', '[A-Za-z0-9-]{8,64}')
    ->name('security.cloud-tokens.destroy');
Route::post('/security/cloud-tokens/{tokenUuid}/validate', [SecurityController::class, 'validateCloudToken'])
    ->where('tokenUuid', '[A-Za-z0-9-]{8,64}')
    ->name('security.cloud-tokens.validate');
Route::get('/security/cloud-init-scripts', [SecurityController::class, 'cloudInitScripts'])
    ->name('security.cloud-init-scripts.index');
Route::post('/security/cloud-init-scripts', [SecurityController::class, 'storeCloudInitScript'])
    ->name('security.cloud-init-scripts.store');
Route::put('/security/cloud-init-scripts/{scriptId}', [SecurityController::class, 'updateCloudInitScript'])
    ->whereNumber('scriptId')
    ->name('security.cloud-init-scripts.update');
Route::delete('/security/cloud-init-scripts/{scriptId}', [SecurityController::class, 'destroyCloudInitScript'])
    ->whereNumber('scriptId')
    ->name('security.cloud-init-scripts.destroy');

Route::get('/agent-key-requests', [AgentKeyRequestController::class, 'index'])->name('agent-key-requests.index');
Route::post('/agent-key-requests/{uuid}/fulfill', [AgentKeyRequestController::class, 'fulfill'])->name('agent-key-requests.fulfill');

Route::get('/subscription', [SubscriptionController::class, 'show'])->name('subscription.show');
Route::post('/subscription/portal', [SubscriptionController::class, 'portal'])->name('subscription.portal');
