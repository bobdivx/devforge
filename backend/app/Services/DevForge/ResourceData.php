<?php

namespace App\Services\DevForge;

use App\Models\Environment;
use App\Models\Project;
use App\Models\Team;

class ResourceData
{
    /**
     * @return array<string, mixed>
     */
    public function project(Project $project, bool $includeEnvironments = false): array
    {
        $data = [
            'id' => $project->id,
            'uuid' => $project->uuid,
            'name' => $project->name,
            'description' => $project->description,
            'created_at' => $project->created_at,
            'updated_at' => $project->updated_at,
        ];

        if ($includeEnvironments) {
            $data['environments'] = $project->environments
                ->map(fn (Environment $environment): array => $this->environment($environment))
                ->values()
                ->all();
        }

        return $data;
    }

    /**
     * @return array<string, mixed>
     */
    public function environment(Environment $environment): array
    {
        return [
            'id' => $environment->id,
            'uuid' => $environment->uuid,
            'project_id' => $environment->project_id,
            'name' => $environment->name,
            'description' => $environment->description,
            'created_at' => $environment->created_at,
            'updated_at' => $environment->updated_at,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function team(Team $team): array
    {
        return [
            'id' => $team->id,
            'name' => $team->name,
            'description' => $team->description,
            'personal_team' => (bool) $team->personal_team,
            'role' => (string) $team->pivot->role,
        ];
    }
}
