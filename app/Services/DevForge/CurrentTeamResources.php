<?php

namespace App\Services\DevForge;

use App\Models\Application;
use App\Models\Environment;
use App\Models\Project;
use App\Models\Team;
use App\Models\User;

class CurrentTeamResources
{
    public function __construct(private CurrentTeamContext $currentTeamContext) {}

    public function project(User $user, string $projectUuid): Project
    {
        $team = $this->currentTeamContext->resolve($user);

        return Project::query()
            ->where('team_id', $team->id)
            ->where('uuid', $projectUuid)
            ->firstOrFail();
    }

    public function environment(
        User $user,
        string $projectUuid,
        string $environmentUuid,
    ): Environment {
        return $this->project($user, $projectUuid)
            ->environments()
            ->where('uuid', $environmentUuid)
            ->firstOrFail();
    }

    public function application(User $user, string $applicationUuid): Application
    {
        return $this->applicationForTeam(
            $this->currentTeamContext->resolve($user),
            $applicationUuid,
        );
    }

    public function applicationForTeam(Team $team, string $applicationUuid): Application
    {
        return Application::query()
            ->where('uuid', $applicationUuid)
            ->whereRelation('environment.project', 'team_id', $team->id)
            ->firstOrFail();
    }
}
