<?php

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);

    $this->user = User::factory()->create();
    $this->team = $this->user->teams()->firstOrFail();
    $this->session = ['currentTeam' => $this->team];
});

it('returns subscription status for self-hosted instances', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/subscription')
        ->assertSuccessful()
        ->assertJsonPath('data.cloud_enabled', false)
        ->assertJsonPath('data.subscription_active', false)
        ->assertJsonPath('data.can_manage', false);
});

it('forbids stripe portal for team members when cloud is enabled', function () {
    config()->set('constants.coolify.self_hosted', false);

    $member = User::factory()->create();
    $this->team->members()->attach($member, ['role' => 'member']);
    $member->refresh();
    $member->load('teams');

    $this->actingAs($member)
        ->withSession(['currentTeam' => $this->team])
        ->postJson('/api/devforge/v1/subscription/portal')
        ->assertForbidden();
});
