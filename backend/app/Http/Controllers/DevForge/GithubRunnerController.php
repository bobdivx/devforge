<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\Server;
use App\Services\DevForge\CurrentTeamContext;
use App\Services\DevForge\Github\GithubRunnerInventory;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class GithubRunnerController extends Controller
{
    public function __construct(
        private readonly CurrentTeamContext $currentTeamContext,
        private readonly GithubRunnerInventory $githubRunnerInventory,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $team = $this->currentTeamContext->resolve($request->user());
        $this->authorize('viewAny', Server::class);

        return response()->json([
            'data' => $this->githubRunnerInventory->listForTeam($team),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $team = $this->currentTeamContext->resolve($request->user());
        $this->authorize('create', Server::class);

        $serverUuid = (string) $request->input('server_uuid', '');
        if ($serverUuid !== '') {
            $server = Server::query()
                ->where('team_id', $team->id)
                ->where('uuid', $serverUuid)
                ->first();

            if ($server) {
                $this->authorize('update', $server);
            }
        }

        try {
            $result = $this->githubRunnerInventory->create($team, $request->all());
        } catch (ValidationException $e) {
            throw $e;
        } catch (ModelNotFoundException) {
            return response()->json(['message' => 'Ressource introuvable.'], 404);
        }

        return response()->json([
            'data' => $result['runner'],
            'message' => $result['message'],
        ], 201);
    }

    public function show(Request $request, string $serverUuid, string $containerName): JsonResponse
    {
        $team = $this->currentTeamContext->resolve($request->user());

        try {
            $server = Server::query()
                ->where('team_id', $team->id)
                ->where('uuid', $serverUuid)
                ->firstOrFail();
        } catch (ModelNotFoundException) {
            return response()->json(['message' => 'Serveur introuvable.'], 404);
        }

        $this->authorize('view', $server);

        try {
            return response()->json([
                'data' => $this->githubRunnerInventory->show($team, $serverUuid, $containerName),
            ]);
        } catch (ModelNotFoundException) {
            return response()->json(['message' => 'Runner introuvable.'], 404);
        }
    }

    public function logs(Request $request, string $serverUuid, string $containerName): JsonResponse
    {
        $team = $this->currentTeamContext->resolve($request->user());

        try {
            $server = Server::query()
                ->where('team_id', $team->id)
                ->where('uuid', $serverUuid)
                ->firstOrFail();
        } catch (ModelNotFoundException) {
            return response()->json(['message' => 'Serveur introuvable.'], 404);
        }

        $this->authorize('view', $server);

        $validated = $request->validate([
            'lines' => ['nullable', 'integer', 'min:10', 'max:1000'],
        ]);

        try {
            return response()->json([
                'data' => $this->githubRunnerInventory->logs(
                    $team,
                    $serverUuid,
                    $containerName,
                    (int) ($validated['lines'] ?? 200),
                ),
            ]);
        } catch (ModelNotFoundException) {
            return response()->json(['message' => 'Runner introuvable.'], 404);
        }
    }

    public function action(Request $request, string $serverUuid, string $containerName, string $action): JsonResponse
    {
        $team = $this->currentTeamContext->resolve($request->user());

        try {
            $server = Server::query()
                ->where('team_id', $team->id)
                ->where('uuid', $serverUuid)
                ->firstOrFail();
        } catch (ModelNotFoundException) {
            return response()->json(['message' => 'Serveur introuvable.'], 404);
        }

        $this->authorize('update', $server);

        try {
            $result = $this->githubRunnerInventory->action($team, $serverUuid, $containerName, $action);

            return response()->json([
                'data' => $result,
                'message' => $result['message'],
            ]);
        } catch (ModelNotFoundException) {
            return response()->json(['message' => 'Runner introuvable.'], 404);
        }
    }
}
