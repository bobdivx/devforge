<?php

use App\Models\Team;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);

    $this->team = Team::factory()->create();
    $this->user = User::factory()->create();
    $this->team->members()->attach($this->user->id, ['role' => 'admin']);
    $this->actingAs($this->user);
    session(['currentTeam' => ['id' => $this->team->id]]);
});

test('bootstrap endpoint returns user, team, permissions, and features data', function () {
    $response = $this->getJson('/api/devforge/v1/bootstrap');

    $response->assertOk();
    $response->assertJsonStructure([
        'data' => [
            'user' => ['id', 'name', 'email'],
            'current_team' => ['id', 'name', 'role', 'is_current'],
            'teams',
            'permissions' => ['role', 'create_resources', 'manage_team', 'manage_members', 'access_terminal', 'instance_admin'],
            'realtime',
            'onboarding' => ['required', 'steps'],
            'cloud',
            'migration',
            'features',
        ],
    ]);
});

test('bootstrap endpoint works even if user has no initial team in session', function () {
    session()->forget('currentTeam');

    $response = $this->getJson('/api/devforge/v1/bootstrap');

    $response->assertOk();
    $response->assertJsonPath('data.current_team.id', $this->team->id);
});
