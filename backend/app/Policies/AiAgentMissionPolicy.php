<?php

namespace App\Policies;

use App\Models\AiAgentMission;
use App\Models\User;

class AiAgentMissionPolicy
{
    public function viewAny(User $user): bool
    {
        return true;
    }

    public function view(User $user, AiAgentMission $mission): bool
    {
        return $user->isAdminFromSession() || $user->currentTeam()->id === $mission->team_id;
    }

    public function create(User $user): bool
    {
        return true;
    }

    public function update(User $user, AiAgentMission $mission): bool
    {
        return $user->isAdminFromSession() || $user->currentTeam()->id === $mission->team_id;
    }

    public function delete(User $user, AiAgentMission $mission): bool
    {
        return $user->isAdminFromSession() || $user->currentTeam()->id === $mission->team_id;
    }
}
