<?php

use App\Models\InstanceSettings;
use App\Models\OauthSetting;
use App\Models\Team;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Socialite\Facades\Socialite;

uses(RefreshDatabase::class);

beforeEach(function () {
    InstanceSettings::create([
        'id' => 0,
        'is_registration_enabled' => false,
    ]);

    OauthSetting::create([
        'provider' => 'google',
        'client_id' => 'client-id',
        'client_secret' => 'client-secret',
        'redirect_uri' => 'https://coolify.example.com/auth/google/callback',
        'tenant' => 'example.com',
    ]);
});

it('logs in an existing user when the oauth provider returns a mixed-case email', function () {
    config()->set('app.maintenance.driver', 'file');

    $user = User::factory()->create([
        'email' => 'username@example.edu',
    ]);

    $provider = Mockery::mock();
    $provider->shouldReceive('setConfig')->once()->andReturnSelf();
    $provider->shouldReceive('with')->once()->with(['hd' => 'example.com'])->andReturnSelf();
    $provider->shouldReceive('user')->once()->andReturn((object) [
        'email' => 'UserName@example.edu',
        'name' => 'Example User',
        'id' => 'google-user-id',
    ]);

    Socialite::shouldReceive('driver')->once()->with('google')->andReturn($provider);

    $response = $this->get(route('auth.callback', 'google'));

    $response->assertRedirect('/');
    $this->assertAuthenticatedAs($user);
    expect(User::count())->toBe(1);
});

it('logs in an existing user through the pocketid socialite driver', function () {
    config()->set('app.maintenance.driver', 'file');

    OauthSetting::create([
        'provider' => 'pocketid',
        'client_id' => 'pocket-client',
        'client_secret' => 'pocket-secret',
        'redirect_uri' => 'https://coolify.example.com/auth/pocketid/callback',
        'base_url' => 'https://id.example.com',
        'enabled' => true,
    ]);

    $user = User::factory()->create([
        'email' => 'ada@example.com',
    ]);

    $provider = Mockery::mock();
    $provider->shouldReceive('setConfig')->once()->andReturnSelf();
    $provider->shouldReceive('user')->once()->andReturn((object) [
        'email' => 'Ada@example.com',
        'name' => 'Ada Lovelace',
        'id' => 'pocketid-user-id',
    ]);

    Socialite::shouldReceive('driver')->once()->with('pocketid')->andReturn($provider);

    $response = $this->get(route('auth.callback', 'pocketid'));

    $response->assertRedirect('/');
    $this->assertAuthenticatedAs($user);
    expect(User::count())->toBe(1);
});

it('rejects oauth logins when the provider does not return an email address', function (?string $providerEmail) {
    config()->set('app.maintenance.driver', 'file');
    InstanceSettings::firstOrCreate([
        'id' => 0,
    ], [
        'is_registration_enabled' => false,
    ])->update([
        'is_registration_enabled' => true,
    ]);

    $provider = Mockery::mock();
    $provider->shouldReceive('setConfig')->once()->andReturnSelf();
    $provider->shouldReceive('with')->once()->with(['hd' => 'example.com'])->andReturnSelf();
    $provider->shouldReceive('user')->once()->andReturn((object) [
        'email' => $providerEmail,
        'name' => 'Example User',
        'id' => 'google-user-id',
    ]);

    Socialite::shouldReceive('driver')->once()->with('google')->andReturn($provider);

    $response = $this->from('/login')->get(route('auth.callback', 'google'));

    $response->assertRedirect('/login');
    expect(User::count())->toBe(0);
})->with([
    'null email' => [null],
    'blank email' => ['   '],
]);

it('rejects unknown google users when registration is disabled', function () {
    config()->set('app.maintenance.driver', 'file');

    $provider = Mockery::mock();
    $provider->shouldReceive('setConfig')->once()->andReturnSelf();
    $provider->shouldReceive('with')->once()->with(['hd' => 'example.com'])->andReturnSelf();
    $provider->shouldReceive('user')->once()->andReturn((object) [
        'email' => 'brother@example.com',
        'name' => 'Brother',
        'id' => 'google-user-id',
    ]);

    Socialite::shouldReceive('driver')->once()->with('google')->andReturn($provider);

    $response = $this->from('/login')->get(route('auth.callback', 'google'));

    $response->assertRedirect('/login');
    $response->assertSessionHasErrors(['email' => __('auth.registration_disabled')]);
    expect(User::count())->toBe(0);
});

it('provisions a pocketid user onto the root team when registration is disabled', function () {
    config()->set('app.maintenance.driver', 'file');

    Team::factory()->create([
        'id' => 0,
        'name' => 'Root Team',
        'personal_team' => true,
        'show_boarding' => false,
    ]);

    OauthSetting::create([
        'provider' => 'pocketid',
        'client_id' => 'pocket-client',
        'client_secret' => 'pocket-secret',
        'redirect_uri' => 'https://coolify.example.com/auth/pocketid/callback',
        'base_url' => 'https://id.example.com',
        'enabled' => true,
    ]);

    $provider = Mockery::mock();
    $provider->shouldReceive('setConfig')->once()->andReturnSelf();
    $provider->shouldReceive('user')->once()->andReturn((object) [
        'email' => 'Brother@example.com',
        'name' => 'Frere DevForge',
        'id' => 'pocketid-brother-id',
    ]);

    Socialite::shouldReceive('driver')->once()->with('pocketid')->andReturn($provider);

    $response = $this->get(route('auth.callback', 'pocketid'));

    $response->assertRedirect('/');
    $user = User::query()->where('email', 'brother@example.com')->first();
    expect($user)->not->toBeNull()
        ->and($user->name)->toBe('Frere DevForge')
        ->and($user->hasVerifiedEmail())->toBeTrue();
    $this->assertAuthenticatedAs($user);
    $this->assertDatabaseHas('team_user', [
        'user_id' => $user->id,
        'team_id' => 0,
        'role' => 'member',
    ]);
    expect(data_get(session('currentTeam'), 'id'))->toBe(0);
});

it('does not provision a pocketid user when the provider is not fully configured', function () {
    config()->set('app.maintenance.driver', 'file');

    OauthSetting::create([
        'provider' => 'pocketid',
        'client_id' => 'pocket-client',
        'client_secret' => null,
        'redirect_uri' => 'https://coolify.example.com/auth/pocketid/callback',
        'base_url' => 'https://id.example.com',
        'enabled' => true,
    ]);

    $provider = Mockery::mock();
    $provider->shouldReceive('setConfig')->once()->andReturnSelf();
    $provider->shouldReceive('user')->once()->andReturn((object) [
        'email' => 'brother@example.com',
        'name' => 'Frere DevForge',
        'id' => 'pocketid-brother-id',
    ]);

    Socialite::shouldReceive('driver')->once()->with('pocketid')->andReturn($provider);

    $response = $this->from('/login')->get(route('auth.callback', 'pocketid'));

    $response->assertRedirect('/login');
    $response->assertSessionHasErrors(['email' => __('auth.registration_disabled')]);
    expect(User::count())->toBe(0);
});
