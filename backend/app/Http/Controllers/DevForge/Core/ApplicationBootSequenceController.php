<?php

namespace App\Http\Controllers\DevForge\Core;

use App\Http\Controllers\Controller;
use App\Models\Application;
use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\Application\ApplicationBootSequenceService;
use App\Services\DevForge\Core\CoreResourceCatalog;
use App\Services\DevForge\Core\CurrentTeamContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ApplicationBootSequenceController extends Controller
{
    public function __construct(
        private readonly CurrentTeamContext $currentTeamContext,
        private readonly ApplicationBootSequenceService $bootSequence,
        private readonly CoreResourceCatalog $catalog,
    ) {}

    public function show(Request $request): JsonResponse
    {
        $team = $this->currentTeam($request);

        return response()->json([
            'data' => $this->bootSequence->statusForTeam($team, ensure: true, tick: false),
        ]);
    }

    public function start(Request $request): JsonResponse
    {
        $team = $this->currentTeam($request);
        $applications = $this->catalog->resources($team, 'applications');

        foreach ($applications as $application) {
            if ($application instanceof Application) {
                $this->authorize('deploy', $application);
            }
        }

        return response()->json([
            'data' => $this->bootSequence->startAllForTeam($team),
        ], 202);
    }

    private function currentTeam(Request $request): Team
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401, 'Unauthenticated.');

        $team = $this->currentTeamContext->resolve($user);
        abort_unless($team instanceof Team, 403, 'No active team.');

        return $team;
    }
}
