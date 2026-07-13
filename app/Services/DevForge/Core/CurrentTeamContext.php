<?php

namespace App\Services\DevForge\Core;

use App\Models\Team;
use App\Models\User;
use Symfony\Component\HttpKernel\Exception\HttpException;

class CurrentTeamContext
{
    public function resolve(User $user): Team
    {
        $teamId = data_get(session('currentTeam'), 'id');

        if (! is_numeric($teamId)) {
            $team = $user->currentTeam() ?? $user->teams()->orderBy('teams.id')->first();

            if (! $team) {
                throw new HttpException(409, 'Current team is unavailable.');
            }

            refreshSession($team);

            return $team;
        }

        $team = $user->teams()
            ->whereKey((int) $teamId)
            ->first();

        if (! $team) {
            throw new HttpException(409, 'Current team is unavailable.');
        }

        return $team;
    }
}
