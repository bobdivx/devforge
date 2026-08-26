<?php

namespace App\Http\Controllers\DevForge;

use App\Enums\ApplicationDeploymentStatus;
use App\Http\Controllers\Controller;
use App\Models\ApplicationDeploymentQueue;
use App\Models\Server;
use App\Services\DevForge\CurrentTeamContext;
use App\Services\DevForge\DeploymentData;
use App\Services\DevForge\DeploymentMonitoringData;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Throwable;

class DeploymentController extends Controller
{
    public function index(Request $request, CurrentTeamContext $teamContext, DeploymentData $deploymentData): JsonResponse
    {
        try {
            $validated = $request->validate([
                'application_uuid' => ['nullable', 'string', 'max:255'],
                'status' => ['nullable', Rule::enum(ApplicationDeploymentStatus::class)],
                'active' => ['nullable', 'boolean'],
                'page' => ['nullable', 'integer', 'min:1'],
                'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
            ]);
            $team = $teamContext->resolve($request->user());
            $activeOnly = $request->boolean('active');
            $deployments = $deploymentData->paginate(
                $team,
                (int) ($validated['page'] ?? 1),
                (int) ($validated['per_page'] ?? 25),
                $validated['application_uuid'] ?? null,
                $activeOnly ? null : ($validated['status'] ?? null),
                $activeOnly
                    ? [
                        ApplicationDeploymentStatus::QUEUED->value,
                        ApplicationDeploymentStatus::IN_PROGRESS->value,
                    ]
                    : null,
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
        } catch (Throwable $e) {
            return response()->json([
                'error' => 'Impossible de charger les déploiements.',
                'message' => $e->getMessage(),
                'data' => [],
                'meta' => [
                    'current_page' => 1,
                    'per_page' => 25,
                    'total' => 0,
                    'last_page' => 1,
                ],
            ], 200);
        }
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

    public function toggleDebugLogs(
        Request $request,
        string $deploymentUuid,
        CurrentTeamContext $teamContext,
        DeploymentData $deploymentData,
    ): JsonResponse {
        $validated = $request->validate([
            'enabled' => ['nullable', 'boolean'],
        ]);
        $team = $teamContext->resolve($request->user());
        $deployment = $deploymentData->find($team, $deploymentUuid);
        $application = $deployment->application;

        abort_if(is_null($application), 404, 'Application not found.');
        $this->authorize('update', $application);

        $settings = $application->settings;
        abort_if(is_null($settings), 404, 'Application settings not found.');

        $settings->is_debug_enabled = array_key_exists('enabled', $validated)
            ? (bool) $validated['enabled']
            : ! $settings->is_debug_enabled;
        $settings->save();

        return response()->json([
            'data' => [
                'is_debug_enabled' => (bool) $settings->is_debug_enabled,
            ],
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

    public function cancel(
        Request $request,
        string $deploymentUuid,
        CurrentTeamContext $teamContext,
        DeploymentData $deploymentData,
    ): JsonResponse {
        $team = $teamContext->resolve($request->user());
        $scoped = $deploymentData->find($team, $deploymentUuid);
        $deployment = ApplicationDeploymentQueue::query()->findOrFail($scoped->id);
        $application = $deployment->application;

        abort_if(is_null($application), 404, 'Application not found.');
        $this->authorize('update', $application);

        $cancellableStatuses = [
            ApplicationDeploymentStatus::QUEUED->value,
            ApplicationDeploymentStatus::IN_PROGRESS->value,
        ];

        abort_unless(
            in_array($deployment->status, $cancellableStatuses, true),
            422,
            "Deployment cannot be cancelled. Current status: {$deployment->status}",
        );

        $deploymentUuidValue = $deployment->deployment_uuid;
        $killCommand = "docker rm -f {$deploymentUuidValue}";
        $buildServerId = $deployment->build_server_id
            ?? $deployment->server_id
            ?? data_get($application, 'destination.server_id');
        $server = null;

        $deployment->update([
            'status' => ApplicationDeploymentStatus::CANCELLED_BY_USER->value,
        ]);

        try {
            if ($buildServerId) {
                $server = Server::whereTeamId($team->id)->find($buildServerId);
            }

            if ($server) {
                $deployment->addLogEntry('Deployment cancelled by user.', 'stderr');

                $checkCommand = "docker ps -a --filter name={$deploymentUuidValue} --format '{{.Names}}'";
                $containerExists = instant_remote_process([$checkCommand], $server);

                if ($containerExists && str($containerExists)->trim()->isNotEmpty()) {
                    instant_remote_process([$killCommand], $server);
                    $deployment->addLogEntry('Deployment container stopped.');
                } else {
                    $deployment->addLogEntry('Deployment container not yet started. Will be cancelled when job checks status.');
                }

                if ($deployment->current_process_id) {
                    try {
                        instant_remote_process(["kill -9 {$deployment->current_process_id}"], $server);
                    } catch (Throwable) {
                        // Process might already be gone.
                    }
                }
            } else {
                $deployment->addLogEntry('Deployment cancelled by user.');
            }
        } catch (Throwable $exception) {
            report($exception);
        } finally {
            $deployment->update([
                'current_process_id' => null,
            ]);
            next_after_cancel($server);
        }

        $deployment->refresh()->load('application.settings');

        return response()->json([
            'data' => $deploymentData->deployment($deployment),
        ]);
    }
}
