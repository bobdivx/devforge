<?php

namespace App\Http\Middleware;

use App\Models\Team;
use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureDevForgeCurrentTeam
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user instanceof User && ! is_numeric(data_get(session('currentTeam'), 'id'))) {
            $team = $user->currentTeam() ?? $user->teams()->orderBy('teams.id')->first();

            if ($team instanceof Team) {
                refreshSession($team);
            }
        }

        return $next($request);
    }
}
