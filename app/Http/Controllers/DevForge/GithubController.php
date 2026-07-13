<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Services\DevForge\CurrentTeamContext;
use App\Services\DevForge\Github\GithubAppCatalog;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class GithubController extends Controller
{
    public function __construct(
        private readonly CurrentTeamContext $currentTeamContext,
        private readonly GithubAppCatalog $githubAppCatalog,
    ) {}

    public function apps(Request $request): JsonResponse
    {
        $team = $this->currentTeamContext->resolve($request->user());

        return response()->json([
            'data' => $this->githubAppCatalog
                ->appsForTeam($team)
                ->map(fn ($githubApp): array => $this->githubAppCatalog->presentApp($githubApp))
                ->values()
                ->all(),
        ]);
    }

    public function repositories(Request $request, string $githubAppUuid): JsonResponse
    {
        $team = $this->currentTeamContext->resolve($request->user());

        try {
            $githubApp = $this->githubAppCatalog->appForTeam($team, $githubAppUuid);
        } catch (ModelNotFoundException) {
            return response()->json(['message' => 'GitHub app not found.'], 404);
        }

        return response()->json([
            'data' => $this->githubAppCatalog->repositories($githubApp),
        ]);
    }

    public function branches(
        Request $request,
        string $githubAppUuid,
        string $owner,
        string $repo,
    ): JsonResponse {
        $team = $this->currentTeamContext->resolve($request->user());

        try {
            $githubApp = $this->githubAppCatalog->appForTeam($team, $githubAppUuid);
        } catch (ModelNotFoundException) {
            return response()->json(['message' => 'GitHub app not found.'], 404);
        }

        return response()->json([
            'data' => $this->githubAppCatalog->branches($githubApp, $owner, $repo),
        ]);
    }
}
