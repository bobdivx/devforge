<?php

use App\Models\AiAgent;
use App\Models\Application;
use App\Models\User;
use App\Services\DevForge\Agent\AgentWelcomeComposer;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

it('scopes the welcome to the application and omits pick_app', function () {
    $user = User::factory()->create(['name' => 'Mathieu JESER']);
    $team = $user->teams()->firstOrFail();
    $agent = AiAgent::factory()->create(['team_id' => $team->id]);
    $application = Application::factory()->make([
        'name' => 'macompta',
        'status' => 'exited',
        'uuid' => 'app-macompta',
    ]);

    $welcome = app(AgentWelcomeComposer::class)->compose($agent, $user, null, $application);

    expect($welcome['metadata']['choice_card'] ?? null)->toBeNull()
        ->and($welcome['metadata']['application_uuid'])->toBe('app-macompta')
        ->and($welcome['content'])->toContain('On est sur macompta')
        ->and($welcome['content'])->toContain('exited')
        ->and($welcome['content'])->not->toContain('Je vais checker tes déploiements');
});
