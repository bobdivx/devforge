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

    public function store(Request $request): JsonResponse
    {
        $this->authorize('createAnyResource');
        $team = $this->currentTeamContext->resolve($request->user());

        $validated = $request->validate([
            'name' => ['nullable', 'string', 'max:30'],
            'organization' => ['nullable', 'string', 'max:255'],
            'preview_deployments' => ['sometimes', 'boolean'],
            'administration' => ['sometimes', 'boolean'],
            'from_onboarding' => ['sometimes', 'boolean'],
            'return_to' => ['sometimes', 'string', 'in:applications,onboarding'],
        ]);

        $githubApp = $this->githubAppCatalog->createDraftForTeam($team, [
            'name' => $validated['name'] ?? null,
            'organization' => $validated['organization'] ?? null,
        ]);

        if (($validated['from_onboarding'] ?? false) === true || ($validated['return_to'] ?? null) === 'onboarding') {
            session(['devforge_onboarding_github' => true]);
            session()->forget('devforge_github_return_to');
        } elseif (($validated['return_to'] ?? null) === 'applications') {
            session(['devforge_github_return_to' => 'applications']);
            session()->forget('devforge_onboarding_github');
        }

        return response()->json([
            'data' => [
                'app' => $this->githubAppCatalog->presentApp($githubApp),
                'launch' => $this->githubAppCatalog->manifestLaunch(
                    $githubApp,
                    (bool) ($validated['preview_deployments'] ?? true),
                    (bool) ($validated['administration'] ?? false),
                ),
            ],
        ], 201);
    }

    public function installUrl(Request $request, string $githubAppUuid): JsonResponse
    {
        $team = $this->currentTeamContext->resolve($request->user());

        try {
            $githubApp = $this->githubAppCatalog->appForTeam($team, $githubAppUuid);
        } catch (ModelNotFoundException) {
            return response()->json(['message' => 'GitHub app not found.'], 404);
        }

        $validated = $request->validate([
            'return_to' => ['sometimes', 'string', 'in:applications,onboarding'],
        ]);

        if (($validated['return_to'] ?? null) === 'onboarding') {
            session(['devforge_onboarding_github' => true]);
            session()->forget('devforge_github_return_to');
        } elseif (($validated['return_to'] ?? null) === 'applications') {
            session(['devforge_github_return_to' => 'applications']);
            session()->forget('devforge_onboarding_github');
        }

        return response()->json([
            'data' => [
                'url' => $this->githubAppCatalog->installationUrl($githubApp),
            ],
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

    public function updatePackagesToken(Request $request, string $githubAppUuid): JsonResponse
    {
        $team = $this->currentTeamContext->resolve($request->user());

        try {
            $githubApp = $this->githubAppCatalog->appForTeam($team, $githubAppUuid);
        } catch (ModelNotFoundException) {
            return response()->json(['message' => 'GitHub app not found.'], 404);
        }

        if ((bool) $githubApp->is_system_wide && (int) $githubApp->team_id !== (int) $team->id) {
            return response()->json(['message' => 'Impossible de modifier une GitHub App système.'], 403);
        }

        $validated = $request->validate([
            'packages_token' => ['nullable', 'string', 'max:500'],
        ]);

        $token = array_key_exists('packages_token', $validated)
            ? $validated['packages_token']
            : null;

        return response()->json([
            'data' => $this->githubAppCatalog->updatePackagesToken($githubApp, $token),
            'message' => filled($token)
                ? 'Token Packages enregistré. Les prochains builds injecteront NODE_AUTH_TOKEN automatiquement.'
                : 'Token Packages supprimé.',
        ]);
    }
}
