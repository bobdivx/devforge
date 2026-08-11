<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\Service;
use App\Models\User;
use App\Services\DevForge\Application\ApplicationScheduledTaskCatalog;
use App\Services\DevForge\Core\CoreResourceCatalog;
use App\Services\DevForge\CurrentTeamContext;
use App\Services\DevForge\Service\ServiceEnvironmentVariableCatalog;
use App\Services\DevForge\Service\ServiceSettingsCatalog;
use App\Services\DevForge\Service\ServiceStorageCatalog;
use App\Services\DevForge\Service\ServiceWebhookService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ServiceController extends Controller
{
    public function __construct(
        private readonly CurrentTeamContext $currentTeamContext,
        private readonly CoreResourceCatalog $coreResourceCatalog,
        private readonly ApplicationScheduledTaskCatalog $applicationScheduledTaskCatalog,
        private readonly ServiceEnvironmentVariableCatalog $serviceEnvironmentVariableCatalog,
        private readonly ServiceSettingsCatalog $serviceSettingsCatalog,
        private readonly ServiceStorageCatalog $serviceStorageCatalog,
        private readonly ServiceWebhookService $serviceWebhookService,
    ) {}

    public function settings(Request $request, string $serviceUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $service = $this->resolveService($user, $serviceUuid);
        $this->authorize('view', $service);

        return response()->json([
            'data' => $this->serviceSettingsCatalog->show($service),
        ]);
    }

    public function updateSettings(Request $request, string $serviceUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $service = $this->resolveService($user, $serviceUuid);
        $this->authorize('update', $service);

        return response()->json([
            'data' => $this->serviceSettingsCatalog->update($service, $request->all()),
        ]);
    }

    public function scheduledTasks(Request $request, string $serviceUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $service = $this->resolveService($user, $serviceUuid);
        $this->authorize('view', $service);

        return response()->json([
            'data' => $this->applicationScheduledTaskCatalog->list($service),
        ]);
    }

    public function storeScheduledTask(Request $request, string $serviceUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $service = $this->resolveService($user, $serviceUuid);
        $this->authorize('update', $service);

        return response()->json([
            'data' => $this->applicationScheduledTaskCatalog->store($service, $request->all()),
        ], 201);
    }

    public function updateScheduledTask(Request $request, string $serviceUuid, string $taskUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $service = $this->resolveService($user, $serviceUuid);
        $this->authorize('update', $service);

        return response()->json([
            'data' => $this->applicationScheduledTaskCatalog->update($service, $taskUuid, $request->all()),
        ]);
    }

    public function destroyScheduledTask(Request $request, string $serviceUuid, string $taskUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $service = $this->resolveService($user, $serviceUuid);
        $this->authorize('update', $service);

        $this->applicationScheduledTaskCatalog->destroy($service, $taskUuid);

        return response()->json([
            'message' => 'Tâche planifiée supprimée.',
        ]);
    }

    public function scheduledTaskExecutions(Request $request, string $serviceUuid, string $taskUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $service = $this->resolveService($user, $serviceUuid);
        $this->authorize('view', $service);

        $validated = $request->validate([
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        return response()->json([
            'data' => $this->applicationScheduledTaskCatalog->executions(
                $service,
                $taskUuid,
                (int) ($validated['limit'] ?? 20),
            ),
        ]);
    }

    public function runScheduledTask(Request $request, string $serviceUuid, string $taskUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $service = $this->resolveService($user, $serviceUuid);
        $this->authorize('update', $service);

        return response()->json([
            'data' => $this->applicationScheduledTaskCatalog->run($service, $taskUuid),
        ]);
    }

    public function webhooks(Request $request, string $serviceUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $service = $this->resolveService($user, $serviceUuid);
        $this->authorize('view', $service);

        return response()->json([
            'data' => $this->serviceWebhookService->show($service),
        ]);
    }

    public function environmentVariables(Request $request, string $serviceUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $service = $this->resolveService($user, $serviceUuid);
        $this->authorize('view', $service);

        return response()->json([
            'data' => $this->serviceEnvironmentVariableCatalog->list($service),
        ]);
    }

    public function storeEnvironmentVariable(Request $request, string $serviceUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $service = $this->resolveService($user, $serviceUuid);
        $this->authorize('manageEnvironment', $service);

        return response()->json([
            'data' => $this->serviceEnvironmentVariableCatalog->store($service, $request->all()),
        ], 201);
    }

    public function updateEnvironmentVariable(Request $request, string $serviceUuid, string $envUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $service = $this->resolveService($user, $serviceUuid);
        $this->authorize('manageEnvironment', $service);

        return response()->json([
            'data' => $this->serviceEnvironmentVariableCatalog->update($service, $envUuid, $request->all()),
        ]);
    }

    public function destroyEnvironmentVariable(Request $request, string $serviceUuid, string $envUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $service = $this->resolveService($user, $serviceUuid);
        $this->authorize('manageEnvironment', $service);

        $this->serviceEnvironmentVariableCatalog->destroy($service, $envUuid);

        return response()->json([
            'message' => 'Variable d’environnement supprimée.',
        ]);
    }

    public function revealEnvironmentVariable(Request $request, string $serviceUuid, string $envUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $service = $this->resolveService($user, $serviceUuid);
        $this->authorize('view', $service);

        return response()->json([
            'data' => $this->serviceEnvironmentVariableCatalog->reveal($service, $envUuid),
        ]);
    }

    public function storages(Request $request, string $serviceUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $service = $this->resolveService($user, $serviceUuid);
        $this->authorize('view', $service);

        return response()->json([
            'data' => $this->serviceStorageCatalog->list($service),
        ]);
    }

    private function resolveService(User $user, string $serviceUuid): Service
    {
        $team = $this->currentTeamContext->resolve($user);
        $service = $this->coreResourceCatalog->find($team, 'services', $serviceUuid);

        abort_unless($service instanceof Service, 404, 'Service introuvable.');

        return $service;
    }
}
