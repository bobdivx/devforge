<?php

use App\Http\Controllers\DevForge\TeamReadController;
use Illuminate\Support\Facades\Route;

Route::get('/teams', [TeamReadController::class, 'index'])->name('teams.index');
Route::get('/teams/current', [TeamReadController::class, 'current'])->name('teams.current');
Route::put('/teams/current', [TeamReadController::class, 'update'])->name('teams.current.update');
Route::get('/teams/current/members', [TeamReadController::class, 'members'])->name('teams.members');
Route::put('/teams/current/members/{userId}', [TeamReadController::class, 'updateMember'])
    ->whereNumber('userId')
    ->name('teams.members.update');
Route::delete('/teams/current/members/{userId}', [TeamReadController::class, 'removeMember'])
    ->whereNumber('userId')
    ->name('teams.members.destroy');
Route::get('/teams/current/invitations', [TeamReadController::class, 'invitations'])->name('teams.invitations.index');
Route::post('/teams/current/invitations', [TeamReadController::class, 'storeInvitation'])->name('teams.invitations.store');
Route::delete('/teams/current/invitations/{invitationId}', [TeamReadController::class, 'destroyInvitation'])
    ->whereNumber('invitationId')
    ->name('teams.invitations.destroy');
