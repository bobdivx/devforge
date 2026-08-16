<?php

use App\Models\Environment;
use App\Models\Project;
use App\Models\Team;
use App\Services\DevForge\Onboarding\DefaultWorkspace;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

it('creates a default project with a production environment', function () {
    $team = Team::factory()->create();

    $project = (new DefaultWorkspace)->ensure($team);

    expect($project->name)->toBe(DefaultWorkspace::PROJECT_NAME)
        ->and($project->team_id)->toBe($team->id)
        ->and($project->environments)->toHaveCount(1)
        ->and($project->environments->first()->name)->toBe('production');
});

it('reuses the existing project and restores production if missing', function () {
    $team = Team::factory()->create();
    $project = Project::create([
        'name' => 'Déjà là',
        'team_id' => $team->id,
    ]);
    $project->environments()->delete();

    $ensured = (new DefaultWorkspace)->ensure($team);

    expect($ensured->is($project))->toBeTrue()
        ->and(Project::query()->where('team_id', $team->id)->count())->toBe(1)
        ->and(Environment::query()->where('project_id', $project->id)->pluck('name')->all())->toBe(['production']);
});
