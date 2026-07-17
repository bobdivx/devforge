<?php

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);

    $this->user = User::factory()->create();
    $this->team = $this->user->teams()->firstOrFail();

    $base = public_path('devforge');
    if (! is_dir($base)) {
        mkdir($base, 0777, true);
    }

    file_put_contents($base.'/index.html', '<html><body>DevForge shell</body></html>');
    if (! is_dir($base.'/_astro')) {
        mkdir($base.'/_astro', 0777, true);
    }
    file_put_contents($base.'/_astro/app.js', 'console.log("devforge");');
});

afterEach(function () {
    @unlink(public_path('devforge/_astro/app.js'));
    @unlink(public_path('devforge/index.html'));
    @rmdir(public_path('devforge/_astro'));
});

it('serves the devforge shell and static assets for authenticated users', function () {
    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->get('/devforge/')
        ->assertSuccessful()
        ->assertSee('DevForge shell');

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->get('/devforge/_astro/app.js')
        ->assertSuccessful()
        ->assertHeader('Content-Type', 'application/javascript');
});

it('redirects guests to login', function () {
    $this->get('/devforge/')
        ->assertRedirect(route('login'));
});

it('returns not found when devforge is disabled', function () {
    config()->set('devforge.enabled', false);

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->get('/devforge/')
        ->assertNotFound();
});
