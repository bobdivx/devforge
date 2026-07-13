<?php

namespace App\Services\DevForge;

use App\Models\Team;
use App\Models\User;

class CurrentTeamContext
{
    public function resolve(User $user): Team
    {
        $teamId = data_get(session('currentTeam'), 'id');

        if (! is_numeric($teamId)) {
            $team = $user->currentTeam() ?? $user->teams()->orderBy('teams.id')->first();
            abort_if(is_null($team), 409, 'No current team is selected.');
            refreshSession($team);

            return $team;
        }

        $team = $user->teams()
            ->whereKey((int) $teamId)
            ->first();

        abort_if(is_null($team), 403, 'The selected team is not available.');

        return $team;
    }
}
