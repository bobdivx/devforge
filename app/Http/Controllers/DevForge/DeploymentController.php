<?php

namespace App\Http\Controllers\DevForge;

use App\Enums\ApplicationDeploymentStatus;
use App\Http\Controllers\Controller;
use App\Services\DevForge\CurrentTeamContext;
use App\Services\DevForge\DeploymentData;
use App\Services\DevForge\DeploymentMonitoringData;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class DeploymentController extends Controller
{
    public function index(Request $request, CurrentTeamContext $teamContext, DeploymentData $deploymentData): JsonResponse
    {
        $validated = $request->validate([
            'application_uuid' => ['nullable', 'string', 'max:255'],
            'status' => ['nullable', Rule::enum(ApplicationDeploymentStatus::class)],
            'page' => ['nullable', 'integer', 'min:1'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $team = $teamContext->resolve($request->user());
        $deployments = $deploymentData->paginate(
            $team,
            (int) ($validated['page'] ?? 1),
            (int) ($validated['per_page'] ?? 25),
            $validated['application_uuid'] ?? null,
            $validated['status'] ?? null,
        );

        return response()->json([
            'data' => $deployments->getCollection()
                ->map(fn ($deployment): array => $deploymentData->deployment($deployment))
                ->values()
                ->all(),
            'meta' => [
                'current_page' => $deployments->currentPage(),
                'per_page' => $deployments->perPage(),
                'total' => $deployments->total(),
                'last_page' => $deployments->lastPage(),
            ],
        ]);
    }

    public function show(
        Request $request,
        string $deploymentUuid,
        CurrentTeamContext $teamContext,
        DeploymentData $deploymentData,
    ): JsonResponse {
        $team = $teamContext->resolve($request->user());
        $deployment = $deploymentData->find($team, $deploymentUuid);

        return response()->json([
            'data' => $deploymentData->deployment($deployment),
        ]);
    }

    public function logs(
        Request $request,
        string $deploymentUuid,
        CurrentTeamContext $teamContext,
        DeploymentData $deploymentData,
    ): JsonResponse {
        $validated = $request->validate([
            'after' => ['nullable', 'integer', 'min:0'],
        ]);
        $team = $teamContext->resolve($request->user());
        $deployment = $deploymentData->find($team, $deploymentUuid);

        return response()->json([
            'data' => $deploymentData->logs($deployment, (int) ($validated['after'] ?? 0)),
        ]);
    }

    public function monitoring(
        Request $request,
        string $deploymentUuid,
        CurrentTeamContext $teamContext,
        DeploymentData $deploymentData,
        DeploymentMonitoringData $monitoringData,
    ): JsonResponse {
        $team = $teamContext->resolve($request->user());
        $deployment = $deploymentData->find($team, $deploymentUuid);

        return response()->json([
            'data' => $monitoringData->forDeployment($team, $deployment),
        ]);
    }
}
