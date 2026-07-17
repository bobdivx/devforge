<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Http\Requests\DevForge\DestinationRequest;
use App\Http\Requests\DevForge\UpdateDestinationRequest;
use App\Models\StandaloneDocker;
use App\Services\DevForge\CurrentTeamContext;
use App\Services\DevForge\Destination\DestinationCatalog;
use App\Services\DevForge\Destination\DestinationWriter;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class DestinationController extends Controller
{
    public function __construct(
        private readonly CurrentTeamContext $currentTeamContext,
        private readonly DestinationCatalog $destinationCatalog,
        private readonly DestinationWriter $destinationWriter,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $team = $this->currentTeamContext->resolve($request->user());

        return response()->json([
            'data' => $this->destinationCatalog->destinationsForTeam($team),
        ]);
    }

    public function store(DestinationRequest $request): JsonResponse
    {
        $team = $this->currentTeamContext->resolve($request->user());
        $destination = $this->destinationWriter->create(
            $team,
            $request->user(),
            $request->payload(),
        );

        return response()->json([
            'data' => $this->destinationCatalog->present($destination->loadMissing('server')),
        ], 201);
    }

    public function show(Request $request, string $destinationUuid): JsonResponse
    {
        $team = $this->currentTeamContext->resolve($request->user());

        try {
            $destination = $this->destinationCatalog->destinationForTeam($team, $destinationUuid);
        } catch (ModelNotFoundException) {
            return response()->json(['message' => 'Destination not found.'], 404);
        }

        $this->authorize('view', $destination);

        return response()->json([
            'data' => $this->destinationCatalog->present($destination),
        ]);
    }

    public function update(
        UpdateDestinationRequest $request,
        string $destinationUuid,
    ): JsonResponse {
        $team = $this->currentTeamContext->resolve($request->user());

        try {
            $destination = $this->destinationCatalog->destinationForTeam($team, $destinationUuid);
        } catch (ModelNotFoundException) {
            return response()->json(['message' => 'Destination not found.'], 404);
        }

        $payload = $request->payload();
        abort_if($payload === [], 422, 'At least one of name or network must be provided.');

        $destination = $this->destinationWriter->update(
            $request->user(),
            $destination,
            $payload,
        );

        return response()->json([
            'data' => $this->destinationCatalog->present($destination),
        ]);
    }

    public function destroy(Request $request, string $destinationUuid): JsonResponse
    {
        $team = $this->currentTeamContext->resolve($request->user());

        try {
            $destination = $this->destinationCatalog->destinationForTeam($team, $destinationUuid);
        } catch (ModelNotFoundException) {
            return response()->json(['message' => 'Destination not found.'], 404);
        }

        try {
            $this->destinationWriter->delete($request->user(), $destination);
        } catch (ValidationException $exception) {
            return response()->json([
                'message' => $exception->getMessage(),
                'errors' => $exception->errors(),
            ], 409);
        }

        return response()->json(status: 204);
    }

    public function resources(Request $request, string $destinationUuid): JsonResponse
    {
        $team = $this->currentTeamContext->resolve($request->user());

        try {
            $destination = $this->destinationCatalog->destinationForTeam($team, $destinationUuid);
        } catch (ModelNotFoundException) {
            return response()->json(['message' => 'Destination not found.'], 404);
        }

        if (! $destination instanceof StandaloneDocker) {
            return response()->json(['message' => 'Resources are only available for standalone destinations.'], 422);
        }

        $this->authorize('view', $destination);

        return response()->json([
            'data' => $this->destinationCatalog->resourcesForDestination($destination),
        ]);
    }
}
