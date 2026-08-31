<?php

use App\Actions\Server\UpdateDevForge;
use App\Models\InstanceSettings;
use App\Models\Team;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Once;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);
    config()->set('constants.coolify.version', '4.0.0-beta.998');
    config()->set('constants.coolify.self_hosted', true);

    $this->user = User::factory()->create([
        'password' => Hash::make('secret-password'),
    ]);
    $this->rootTeam = Team::factory()->create(['id' => 0]);
    $this->rootTeam->members()->attach($this->user, ['role' => 'admin']);
    $this->session = ['currentTeam' => $this->rootTeam];

    InstanceSettings::unguarded(fn (): InstanceSettings => InstanceSettings::query()->create([
        'id' => 0,
        'instance_name' => 'DevForge',
        'is_auto_update_enabled' => false,
        'new_version_available' => true,
    ]));

    Cache::put('coolify:versions:all', [
        'coolify' => [
            'v4' => [
                'version' => '4.0.0-beta.999',
            ],
        ],
    ], 3600);
});

it('returns an available instance upgrade for an instance admin', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/settings/updates/status')
        ->assertSuccessful()
        ->assertJsonPath('data.available', true)
        ->assertJsonPath('data.current_version', '4.0.0-beta.998')
        ->assertJsonPath('data.latest_version', '4.0.0-beta.999')
        ->assertJsonPath('data.status', 'none');
});

it('forbids instance upgrade status for non instance admins', function () {
    $outsider = User::factory()->create();
    $team = $outsider->teams()->firstOrFail();

    $this->actingAs($outsider)
        ->withSession(['currentTeam' => $team])
        ->getJson('/api/devforge/v1/settings/updates/status')
        ->assertForbidden();
});

it('starts a manual instance upgrade when a newer version is available', function () {
    $this->mock(UpdateDevForge::class, function ($mock): void {
        $mock->shouldReceive('handle')->once()->with(true, '4.0.0-beta.999');
    });

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/settings/updates/upgrade')
        ->assertSuccessful()
        ->assertJsonPath('data.current_version', '4.0.0-beta.998')
        ->assertJsonPath('data.latest_version', '4.0.0-beta.999');
});

it('rejects a manual upgrade when no newer version is available', function () {
    Cache::put('coolify:versions:all', [
        'coolify' => [
            'v4' => [
                'version' => '4.0.0-beta.998',
            ],
        ],
    ], 3600);
    InstanceSettings::query()->whereKey(0)->update(['new_version_available' => false]);
    Once::flush();

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/settings/updates/upgrade')
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['upgrade']);
});
