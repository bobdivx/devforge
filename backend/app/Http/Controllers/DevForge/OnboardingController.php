<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\DevForge\BootstrapData;
use App\Services\DevForge\CurrentTeamContext;
use App\Services\DevForge\Onboarding\DefaultWorkspace;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class OnboardingController extends Controller
{
    public function __construct(
        private readonly CurrentTeamContext $currentTeamContext,
        private readonly BootstrapData $bootstrapData,
        private readonly DefaultWorkspace $defaultWorkspace,
    ) {}

    public function complete(Request $request): JsonResponse
    {
        $user = $this->authorizedAdministrator($request);
        $team = $this->currentTeamContext->resolve($user);
        $this->authorize('update', $team);

        $this->defaultWorkspace->ensure($team);
        $team->update([
            'show_boarding' => false,
        ]);
        refreshSession($team);

        return response()->json([
            'data' => $this->bootstrapData->build($user),
            'message' => 'Configuration initiale terminée.',
        ]);
    }

    public function restart(Request $request): JsonResponse
    {
        $user = $this->authorizedAdministrator($request);
        $team = $this->currentTeamContext->resolve($user);
        $this->authorize('update', $team);

        $this->defaultWorkspace->ensure($team);
        $team->update([
            'show_boarding' => true,
        ]);
        refreshSession($team);

        return response()->json([
            'data' => $this->bootstrapData->build($user),
            'message' => 'Assistant de configuration relancé.',
        ]);
    }

    private function authorizedAdministrator(Request $request): User
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);
        abort_if($user->isMember(), 403, 'Seuls les administrateurs peuvent gérer l’onboarding.');

        return $user;
    }
}
