<?php

namespace App\Http\Controllers\DevForge\Core;

use App\Http\Controllers\Controller;
use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\Application\ApplicationBootSequenceService;
use App\Services\DevForge\Core\CurrentTeamContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ApplicationBootSequenceController extends Controller
{
    public function __construct(
        private readonly CurrentTeamContext $currentTeamContext,
        private readonly ApplicationBootSequenceService $bootSequence,
    ) {}

    public function __invoke(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401, 'Unauthenticated.');

        $team = $this->currentTeamContext->resolve($user);
        abort_unless($team instanceof Team, 403, 'No active team.');

        return response()->json([
            'data' => $this->bootSequence->statusForTeam($team, ensure: true),
        ]);
    }
}
