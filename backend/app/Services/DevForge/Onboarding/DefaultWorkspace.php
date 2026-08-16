<?php

namespace App\Services\DevForge\Onboarding;

use App\Models\Environment;
use App\Models\Project;
use App\Models\Team;
use Visus\Cuid2\Cuid2;

class DefaultWorkspace
{
    public const PROJECT_NAME = 'Mon premier projet';

    public function ensure(Team $team): Project
    {
        $project = Project::query()
            ->where('team_id', $team->id)
            ->orderBy('id')
            ->first();

        if ($project) {
            $this->ensureProductionEnvironment($project);

            return $project;
        }

        return Project::query()->create([
            'name' => self::PROJECT_NAME,
            'description' => 'Projet créé automatiquement à l’installation.',
            'team_id' => $team->id,
        ]);
    }

    private function ensureProductionEnvironment(Project $project): void
    {
        if ($project->environments()->exists()) {
            return;
        }

        Environment::query()->create([
            'name' => 'production',
            'project_id' => $project->id,
            'uuid' => (string) new Cuid2,
        ]);
    }
}
