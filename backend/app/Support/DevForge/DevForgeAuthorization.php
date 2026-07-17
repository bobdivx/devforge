<?php

namespace App\Support\DevForge;

use App\Models\User;

final class DevForgeAuthorization
{
    public static function memberOfCurrentTeam(User $user): bool
    {
        $teamId = data_get(session('currentTeam'), 'id');

        if (! is_numeric($teamId)) {
            $team = $user->currentTeam() ?? $user->teams()->orderBy('teams.id')->first();

            if ($team) {
                refreshSession($team);
                $teamId = $team->id;
            }
        }

        if (! is_numeric($teamId)) {
            return false;
        }

        return $user->teams()->whereKey((int) $teamId)->exists();
    }
}
