<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\CurrentTeamContext;
use App\Services\DevForge\ResourceData;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TeamReadController extends Controller
{
    public function index(Request $request, ResourceData $resourceData): JsonResponse
    {
        $this->authorize('viewAny', Team::class);

        return response()->json([
            'data' => $request->user()
                ->teams()
                ->orderBy('teams.name')
                ->get()
                ->map(fn (Team $team): array => $resourceData->team($team))
                ->all(),
        ]);
    }

    public function members(
        Request $request,
        CurrentTeamContext $currentTeamContext,
    ): JsonResponse {
        $team = $currentTeamContext->resolve($request->user());
        $this->authorize('view', $team);

        return response()->json([
            'data' => $team->members()
                ->select(['users.id', 'users.name', 'users.email'])
                ->orderBy('users.name')
                ->get()
                ->map(fn (User $member): array => [
                    'id' => $member->id,
                    'name' => $member->name,
                    'email' => $member->email,
                    'role' => (string) $member->pivot->role,
                ])
                ->all(),
        ]);
    }
}
