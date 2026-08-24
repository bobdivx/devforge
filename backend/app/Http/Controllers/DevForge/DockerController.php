<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\Application;
use App\Models\Server;
use App\Models\Service;
use App\Services\DevForge\Docker\DockerImageAutoUpdater;
use App\Services\DevForge\Docker\DockerImageUpdateChecker;
use App\Support\ValidationPatterns;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;

class DockerController extends Controller
{
    public function containers(Request $request): JsonResponse
    {
        $team = currentTeam();
        if (! $team) {
            return response()->json(['error' => 'Team non trouvée.'], 404);
        }

        $serverUuid = $request->query('server_uuid');
        $serverQuery = Server::ownedByCurrentTeam();

        if ($serverUuid) {
            $server = $serverQuery->where('uuid', $serverUuid)->first();
        } else {
            $server = $serverQuery->first();
        }

        if (! $server) {
            return response()->json(['data' => [], 'meta' => ['server' => null]]);
        }

        if (! $server->isFunctional()) {
            return response()->json([
                'data' => [],
                'meta' => [
                    'server' => [
                        'uuid' => $server->uuid,
                        'name' => $server->name,
                        'is_functional' => false,
                    ],
                ],
            ]);
        }

        try {
            $containers = $server->loadAllContainers()->values();

            return response()->json([
                'data' => $containers,
                'meta' => [
                    'server' => [
                        'uuid' => $server->uuid,
                        'name' => $server->name,
                        'ip' => $server->ip,
                        'is_functional' => true,
                    ],
                    'total' => $containers->count(),
                    'running' => $containers->where('State', 'running')->count(),
                    'exited' => $containers->where('State', 'exited')->count(),
                ],
            ]);
        } catch (\Throwable $e) {
            return response()->json([
                'error' => $e->getMessage(),
                'data' => [],
            ], 500);
        }
    }

    public function containerAction(Request $request, string $serverUuid, string $containerId, string $action): JsonResponse
    {
        if (! in_array($action, ['start', 'stop', 'restart'], true)) {
            return response()->json(['error' => 'Action invalide.'], 422);
        }

        if (! ValidationPatterns::isValidContainerName($containerId)) {
            return response()->json(['error' => 'Identifiant de conteneur invalide.'], 422);
        }

        $server = Server::ownedByCurrentTeam()->where('uuid', $serverUuid)->first();
        if (! $server || ! $server->isFunctional()) {
            return response()->json(['error' => 'Serveur introuvable ou non fonctionnel.'], 404);
        }

        try {
            instant_remote_process(["docker {$action} {$containerId}"], $server);

            return response()->json([
                'message' => "Conteneur {$containerId} ".($action === 'start' ? 'démarré' : ($action === 'stop' ? 'arrêté' : 'redémarré')).'.',
            ]);
        } catch (\Throwable $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }

    public function images(Request $request): JsonResponse
    {
        $team = currentTeam();
        if (! $team) {
            return response()->json(['error' => 'Team non trouvée.'], 404);
        }

        $applications = Application::query()
            ->where('build_pack', 'dockerimage')
            ->whereHas('environment.project.team', fn ($query) => $query->where('teams.id', $team->id))
            ->with(['settings', 'environment.project', 'destination.server'])
            ->get()
            ->map(function ($app) {
                return [
                    'uuid' => $app->uuid,
                    'name' => $app->name,
                    'type' => 'application',
                    'image' => $app->docker_registry_image_name,
                    'tag' => $app->docker_registry_image_tag ?: 'latest',
                    'is_image_auto_update_enabled' => (bool) ($app->settings?->is_image_auto_update_enabled ?? false),
                    'project' => $app->environment?->project?->name,
                    'environment' => $app->environment?->name,
                    'server' => $app->destination?->server?->name,
                    'status' => $app->status,
                ];
            });

        $services = Service::query()
            ->whereHas('environment.project.team', fn ($query) => $query->where('teams.id', $team->id))
            ->with(['environment.project', 'server'])
            ->get()
            ->map(function ($service) {
                return [
                    'uuid' => $service->uuid,
                    'name' => $service->name,
                    'type' => 'service',
                    'image' => null,
                    'tag' => null,
                    'is_image_auto_update_enabled' => (bool) $service->is_image_auto_update_enabled,
                    'project' => $service->environment?->project?->name,
                    'environment' => $service->environment?->name,
                    'server' => $service->server?->name,
                    'status' => $service->status,
                ];
            });

        return response()->json([
            'data' => [
                'applications' => $applications,
                'services' => $services,
            ],
            'meta' => [
                'total' => $applications->count() + $services->count(),
                'auto_update_enabled' => $applications->where('is_image_auto_update_enabled', true)->count()
                    + $services->where('is_image_auto_update_enabled', true)->count(),
            ],
        ]);
    }

    public function checkImageUpdates(Request $request, DockerImageUpdateChecker $checker): JsonResponse
    {
        $team = currentTeam();
        if (! $team) {
            return response()->json(['error' => 'Team non trouvée.'], 404);
        }

        $type = $request->input('type');
        $uuid = $request->input('uuid');

        if ($type && $uuid) {
            if ($type === 'application') {
                $result = $checker->check($team, applicationUuid: $uuid, inspectRunning: true);
            } elseif ($type === 'service') {
                $result = $checker->checkService($team, serviceUuid: $uuid, inspectRunning: true);
            } else {
                return response()->json(['error' => 'Type invalide.'], 422);
            }

            return response()->json(['data' => $result]);
        }

        // Global check
        $results = [];
        $apps = Application::query()
            ->where('build_pack', 'dockerimage')
            ->whereHas('environment.project.team', fn ($query) => $query->where('teams.id', $team->id))
            ->get();

        foreach ($apps as $app) {
            $results['application:'.$app->uuid] = $checker->check($team, applicationUuid: $app->uuid, inspectRunning: true);
        }

        $services = Service::query()
            ->whereHas('environment.project.team', fn ($query) => $query->where('teams.id', $team->id))
            ->get();

        foreach ($services as $service) {
            $results['service:'.$service->uuid] = $checker->checkService($team, serviceUuid: $service->uuid, inspectRunning: true);
        }

        return response()->json(['data' => $results]);
    }

    public function updateImage(Request $request, DockerImageAutoUpdater $updater): JsonResponse
    {
        $team = currentTeam();
        if (! $team) {
            return response()->json(['error' => 'Team non trouvée.'], 404);
        }

        $validator = Validator::make($request->all(), [
            'type' => ['required', 'in:application,service'],
            'uuid' => ['required', 'string'],
        ]);

        if ($validator->fails()) {
            return response()->json(['errors' => $validator->errors()], 422);
        }

        $type = $request->input('type');
        $uuid = $request->input('uuid');

        if ($type === 'application') {
            $application = Application::query()
                ->where('uuid', $uuid)
                ->whereHas('environment.project.team', fn ($query) => $query->where('teams.id', $team->id))
                ->with(['settings', 'environment.project.team', 'destination.server'])
                ->first();

            if (! $application) {
                return response()->json(['error' => 'Application non trouvée.'], 404);
            }

            $result = $updater->applyForApplication($application, force: true);

            return response()->json(['data' => $result]);
        }

        $service = Service::query()
            ->where('uuid', $uuid)
            ->whereHas('environment.project.team', fn ($query) => $query->where('teams.id', $team->id))
            ->with(['applications', 'environment.project.team', 'server'])
            ->first();

        if (! $service) {
            return response()->json(['error' => 'Service non trouvé.'], 404);
        }

        $result = $updater->applyForService($service, force: true);

        return response()->json(['data' => $result]);
    }

    public function updateAllImages(DockerImageAutoUpdater $updater): JsonResponse
    {
        $summary = $updater->run();

        return response()->json(['data' => $summary]);
    }

    public function toggleAutoUpdate(Request $request): JsonResponse
    {
        $team = currentTeam();
        if (! $team) {
            return response()->json(['error' => 'Team non trouvée.'], 404);
        }

        $validator = Validator::make($request->all(), [
            'type' => ['required', 'in:application,service'],
            'uuid' => ['required', 'string'],
            'is_image_auto_update_enabled' => ['required', 'boolean'],
        ]);

        if ($validator->fails()) {
            return response()->json(['errors' => $validator->errors()], 422);
        }

        $type = $request->input('type');
        $uuid = $request->input('uuid');
        $enabled = (bool) $request->input('is_image_auto_update_enabled');

        if ($type === 'application') {
            $application = Application::query()
                ->where('uuid', $uuid)
                ->whereHas('environment.project.team', fn ($query) => $query->where('teams.id', $team->id))
                ->with('settings')
                ->first();

            if (! $application || ! $application->settings) {
                return response()->json(['error' => 'Application non trouvée.'], 404);
            }

            $application->settings->is_image_auto_update_enabled = $enabled;
            $application->settings->save();

            return response()->json([
                'message' => 'Configuration mise à jour.',
                'data' => [
                    'uuid' => $application->uuid,
                    'is_image_auto_update_enabled' => $enabled,
                ],
            ]);
        }

        $service = Service::query()
            ->where('uuid', $uuid)
            ->whereHas('environment.project.team', fn ($query) => $query->where('teams.id', $team->id))
            ->first();

        if (! $service) {
            return response()->json(['error' => 'Service non trouvé.'], 404);
        }

        $service->is_image_auto_update_enabled = $enabled;
        $service->save();

        return response()->json([
            'message' => 'Configuration mise à jour.',
            'data' => [
                'uuid' => $service->uuid,
                'is_image_auto_update_enabled' => $enabled,
            ],
        ]);
    }
}
