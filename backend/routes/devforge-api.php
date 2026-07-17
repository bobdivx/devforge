<?php

use App\Http\Controllers\DevForge\BootstrapController;
use App\Http\Controllers\DevForge\TeamController;
use Illuminate\Support\Facades\Route;

Route::get('/bootstrap', BootstrapController::class)->name('bootstrap');
Route::post('/teams/switch', [TeamController::class, 'switch'])->name('teams.switch');

require __DIR__.'/devforge-simple.php';
require __DIR__.'/devforge-applications.php';
require __DIR__.'/devforge-databases.php';
require __DIR__.'/devforge-database-backups.php';
require __DIR__.'/devforge-s3-storages.php';
require __DIR__.'/devforge-core.php';
require __DIR__.'/devforge-realtime.php';
require __DIR__.'/devforge-agents.php';
require __DIR__.'/devforge-destinations.php';
require __DIR__.'/devforge-tags.php';
require __DIR__.'/devforge-team.php';
require __DIR__.'/devforge-server-storage.php';
require __DIR__.'/devforge-server-files.php';
require __DIR__.'/devforge-server-settings.php';
