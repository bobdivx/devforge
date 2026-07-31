<?php

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

it('renders the DevForge login page when DevForge is enabled', function () {
    config()->set('devforge.enabled', true);

    User::factory()->create();

    $this->get('/login')
        ->assertOk()
        ->assertSee('DevForge', false)
        ->assertSee('Connectez-vous pour accéder à votre espace', false)
        ->assertSee('devforge-auth-page', false)
        ->assertSee('devforge-auth-logo', false)
        ->assertSee('devforge-auth-card', false)
        ->assertSee('devforge-auth-input', false)
        ->assertSee('devforge-auth-primary', false)
        ->assertSee('devforge-auth-primary-block', false)
        ->assertSee('css/devforge-auth.css', false)
        ->assertSee('brand/logo.png', false)
        ->assertDontSee('resources/css/app.css', false)
        ->assertDontSee('>Coolify<', false)
        ->assertDontSee('class="input"', false)
        ->assertDontSee('x-forms', false);
});

it('renders the legacy Coolify login page when DevForge is disabled', function () {
    config()->set('devforge.enabled', false);

    User::factory()->create();

    $this->get('/login')
        ->assertOk()
        ->assertSee('Coolify', false)
        ->assertDontSee('Connectez-vous pour accéder à votre espace', false);
});
