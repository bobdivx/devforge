<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Laravel\Sanctum\TransientToken;
use Symfony\Component\HttpFoundation\Response;

class EnsureTokenBelongsToCurrentTeamMember
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        $token = $user?->currentAccessToken();

        if (! $user || ! $token) {
            return response()->json(['message' => 'Invalid token.'], 401);
        }

        // SPA session: Sanctum uses TransientToken, which has no team_id.
        if ($token instanceof TransientToken) {
            return $next($request);
        }

        $teamId = $token->team_id ?? null;

        if (is_null($teamId)) {
            return response()->json(['message' => 'Invalid token.'], 401);
        }

        $team = $user->teams()
            ->where('teams.id', $teamId)
            ->first();

        if (! $team) {
            return response()->json(['message' => 'Invalid token.'], 401);
        }

        $role = $team->pivot?->role;
        if (($token->can('root') || $token->can('write') || $token->can('write:sensitive'))
            && ! in_array($role, ['admin', 'owner'], true)) {
            return response()->json(['message' => 'Missing required team role.'], 403);
        }

        return $next($request);
    }
}