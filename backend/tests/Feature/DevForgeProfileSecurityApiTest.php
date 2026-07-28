<?php

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Fortify\Actions\EnableTwoFactorAuthentication;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);

    $this->user = User::factory()->create([
        'password' => Hash::make('CurrentPass1!'),
    ]);
    $this->team = $this->user->teams()->firstOrFail();
    $this->session = ['currentTeam' => $this->team];
});

it('updates the authenticated user password', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson('/api/devforge/v1/profile/password', [
            'current_password' => 'CurrentPass1!',
            'password' => 'NewSecurePass1!',
            'password_confirmation' => 'NewSecurePass1!',
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.message', 'Mot de passe mis à jour.');

    expect(Hash::check('NewSecurePass1!', $this->user->fresh()->password))->toBeTrue();
});

it('clears force password reset when password is updated', function () {
    $this->user->forceFill(['force_password_reset' => true])->save();

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson('/api/devforge/v1/profile/password', [
            'current_password' => 'CurrentPass1!',
            'password' => 'NewSecurePass1!',
            'password_confirmation' => 'NewSecurePass1!',
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.force_password_reset', false);

    expect($this->user->fresh()->force_password_reset)->toBeFalse();
});

it('rejects password update with wrong current password', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson('/api/devforge/v1/profile/password', [
            'current_password' => 'WrongPass1!',
            'password' => 'NewSecurePass1!',
            'password_confirmation' => 'NewSecurePass1!',
        ])
        ->assertUnprocessable();
});

it('enables two factor authentication after password confirmation', function () {
    $response = $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/profile/two-factor', [
            'current_password' => 'CurrentPass1!',
        ])
        ->assertSuccessful();

    expect($response->json('data.qr_code_svg'))->not->toBeEmpty();
    expect($response->json('data.setup_key'))->not->toBeEmpty();
    expect($this->user->fresh()->two_factor_secret)->not->toBeNull();
});

it('disables two factor authentication', function () {
    app(EnableTwoFactorAuthentication::class)($this->user);
    $this->user->forceFill([
        'two_factor_confirmed_at' => now(),
    ])->save();

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->deleteJson('/api/devforge/v1/profile/two-factor', [
            'current_password' => 'CurrentPass1!',
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.two_factor_enabled', false);

    expect($this->user->fresh()->two_factor_secret)->toBeNull();
});
