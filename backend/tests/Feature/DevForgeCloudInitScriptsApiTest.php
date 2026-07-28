<?php

use App\Models\CloudInitScript;
use App\Models\Team;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);

    $this->user = User::factory()->create();
    $this->team = $this->user->teams()->firstOrFail();
    $this->session = ['currentTeam' => $this->team];
});

it('lists cloud-init scripts for the current team', function () {
    CloudInitScript::create([
        'team_id' => $this->team->id,
        'name' => 'Bootstrap Hetzner',
        'script' => "#!/bin/bash\necho hello\n",
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/security/cloud-init-scripts')
        ->assertSuccessful()
        ->assertJsonPath('data.0.name', 'Bootstrap Hetzner')
        ->assertJsonPath('data.0.script', "#!/bin/bash\necho hello\n");
});

it('creates updates and deletes a cloud-init script', function () {
    $create = $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/security/cloud-init-scripts', [
            'name' => 'Init script',
            'script' => "#cloud-config\npackages:\n  - nginx\n",
        ])
        ->assertCreated()
        ->assertJsonPath('data.name', 'Init script');

    $scriptId = $create->json('data.id');

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/security/cloud-init-scripts/{$scriptId}", [
            'name' => 'Updated script',
            'script' => "#!/bin/bash\napt update\n",
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.name', 'Updated script');

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->deleteJson("/api/devforge/v1/security/cloud-init-scripts/{$scriptId}")
        ->assertSuccessful();

    expect(CloudInitScript::query()->whereKey($scriptId)->exists())->toBeFalse();
});

it('rejects invalid cloud-init script content', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/security/cloud-init-scripts', [
            'name' => 'Bad script',
            'script' => "packages:\n  - nginx\n  broken: [",
        ])
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['script']);
});

it('scopes cloud-init scripts to the current team', function () {
    $otherTeam = Team::factory()->create();
    CloudInitScript::create([
        'team_id' => $otherTeam->id,
        'name' => 'Other team script',
        'script' => "#!/bin/bash\necho other\n",
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/security/cloud-init-scripts')
        ->assertSuccessful()
        ->assertJsonCount(0, 'data');
});

it('forbids cloud-init management for team members', function () {
    $member = User::factory()->create();
    $this->team->members()->attach($member, ['role' => 'member']);
    $member->refresh();
    $member->load('teams');

    $this->actingAs($member)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/security/cloud-init-scripts')
        ->assertForbidden();
});
