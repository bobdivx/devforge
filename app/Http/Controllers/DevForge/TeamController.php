<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Http\Requests\DevForge\SwitchTeamRequest;
use App\Services\DevForge\BootstrapData;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\JsonResponse;

class TeamController extends Controller
{
    /**
     * @throws AuthorizationException
     */
    public function switch(SwitchTeamRequest $request, BootstrapData $bootstrapData): JsonResponse
    {
        $user = $request->user();
        $team = $user->teams()
            ->whereKey($request->integer('team_id'))
            ->first();

        if (! $team) {
            throw new AuthorizationException;
        }

        refreshSession($team);

        return response()->json([
            'data' => $bootstrapData->build($user),
        ]);
    }
}
