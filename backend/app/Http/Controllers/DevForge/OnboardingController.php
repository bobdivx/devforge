<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\DevForge\BootstrapData;
use App\Services\DevForge\CurrentTeamContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class OnboardingController extends Controller
{
    public function __construct(
        private readonly CurrentTeamContext $currentTeamContext,
        private readonly BootstrapData $bootstrapData,
    ) {}

    public function complete(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);
        abort_if($user->isMember(), 403, 'Seuls les administrateurs peuvent terminer l’onboarding.');

        $team = $this->currentTeamContext->resolve($user);
        $this->authorize('update', $team);

        $team->update([
            'show_boarding' => false,
        ]);
        refreshSession($team);

        return response()->json([
            'data' => $this->bootstrapData->build($user),
            'message' => 'Configuration initiale terminée.',
        ]);
    }
}
