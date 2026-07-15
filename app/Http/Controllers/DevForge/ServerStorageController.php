<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Services\DevForge\CurrentTeamContext;
use App\Services\DevForge\Server\ServerStorageService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ServerStorageController extends Controller
{
    public function index(Request $request, CurrentTeamContext $teamContext, ServerStorageService $storageService): JsonResponse
    {
        $validated = $request->validate([
            'refresh_disk' => ['nullable', 'boolean'],
        ]);
        $team = $teamContext->resolve($request->user());

        return response()->json([
            'data' => $storageService->overview($team, (bool) ($validated['refresh_disk'] ?? true)),
            'meta' => $storageService->meta(),
        ]);
    }

    public function show(
        Request $request,
        string $serverUuid,
        CurrentTeamContext $teamContext,
        ServerStorageService $storageService,
    ): JsonResponse {
        $validated = $request->validate([
            'refresh_disk' => ['nullable', 'boolean'],
        ]);
        $team = $teamContext->resolve($request->user());
        $server = $storageService->findForTeam($team, $serverUuid);
        $this->authorize('view', $server);

        return response()->json([
            'data' => $storageService->show($server, (bool) ($validated['refresh_disk'] ?? false)),
            'meta' => $storageService->meta(),
        ]);
    }

    public function refreshDisk(
        Request $request,
        string $serverUuid,
        CurrentTeamContext $teamContext,
        ServerStorageService $storageService,
    ): JsonResponse {
        $team = $teamContext->resolve($request->user());
        $server = $storageService->findForTeam($team, $serverUuid);
        $this->authorize('view', $server);

        return response()->json([
            'data' => $storageService->refreshDiskUsage($server),
        ]);
    }

    public function update(
        Request $request,
        string $serverUuid,
        CurrentTeamContext $teamContext,
        ServerStorageService $storageService,
    ): JsonResponse {
        $team = $teamContext->resolve($request->user());
        $server = $storageService->findForTeam($team, $serverUuid);
        $this->authorize('update', $server);

        return response()->json([
            'data' => $storageService->updateCleanupSettings($server, $request->all()),
            'meta' => $storageService->meta(),
        ]);
    }

    public function runCleanup(
        Request $request,
        string $serverUuid,
        CurrentTeamContext $teamContext,
        ServerStorageService $storageService,
    ): JsonResponse {
        $team = $teamContext->resolve($request->user());
        $server = $storageService->findForTeam($team, $serverUuid);
        $this->authorize('update', $server);

        return response()->json([
            'data' => $storageService->runCleanup($server, $request->all()),
        ]);
    }
}
