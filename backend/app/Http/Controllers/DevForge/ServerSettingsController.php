<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\DevForge\CurrentTeamContext;
use App\Services\DevForge\Server\ServerSettingsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ServerSettingsController extends Controller
{
    public function __construct(
        private readonly CurrentTeamContext $currentTeamContext,
        private readonly ServerSettingsService $serverSettingsService,
    ) {}

    public function show(Request $request, string $serverUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $team = $this->currentTeamContext->resolve($user);
        $server = $this->serverSettingsService->findForTeam($team, $serverUuid);
        $this->authorize('view', $server);

        return response()->json([
            'data' => $this->serverSettingsService->show($server),
        ]);
    }

    public function update(Request $request, string $serverUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $team = $this->currentTeamContext->resolve($user);
        $server = $this->serverSettingsService->findForTeam($team, $serverUuid);
        $this->authorize('update', $server);

        return response()->json([
            'data' => $this->serverSettingsService->update($server, $request->all(), $user),
        ]);
    }
}
