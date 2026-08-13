<?php

namespace App\Services\DevForge\Core;

use App\Actions\Application\StopApplication;
use App\Actions\Database\RestartDatabase;
use App\Actions\Database\StartDatabase;
use App\Actions\Database\StopDatabase;
use App\Actions\Service\RestartService;
use App\Actions\Service\StartService;
use App\Actions\Service\StopService;
use App\Models\Application;
use App\Models\Service;
use App\Services\DevForge\Application\ApplicationDesiredRuntimeState;
use App\Services\DevForge\Database\DatabaseDesiredRuntimeState;
use Illuminate\Database\Eloquent\Model;
use RuntimeException;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Visus\Cuid2\Cuid2;

class CoreResourceAction
{
    public function __construct(
        private readonly ApplicationDesiredRuntimeState $desiredRuntimeState,
        private readonly DatabaseDesiredRuntimeState $databaseDesiredRuntimeState,
    ) {}

    /**
     * @param  array<string, mixed>  $options
     * @return array<string, mixed>
     */
    public function execute(Model $resource, string $type, string $action, array $options): array
    {
        $result = match ($type) {
            'applications' => $this->application($resource, $action, $options),
            'databases' => $this->database($resource, $action, $options),
            'services' => $this->service($resource, $action, $options),
            default => throw new HttpException(422, 'This resource does not support actions.'),
        };

        auditLog('devforge.core.action', [
            'team_id' => $this->resolveTeamId($resource) ?? currentTeam()?->id,
            'resource_type' => $type,
            'resource_uuid' => $resource->uuid,
            'action' => $action,
        ]);

        return [
            'resource_uuid' => $resource->uuid,
            'resource_type' => str($type)->singular()->value(),
            'action' => $action,
            ...$result,
        ];
    }

    /**
     * @param  array<string, mixed>  $options
     * @return array<string, mixed>
     */
    private function application(Application $application, string $action, array $options): array
    {
        if ($action === 'stop') {
            $this->desiredRuntimeState->markDesiredStopped($application);

            StopApplication::dispatch(
                $application,
                false,
                (bool) ($options['docker_cleanup'] ?? true),
            );

            return ['queued' => true, 'message' => 'Application stopping request queued.'];
        }

        $this->desiredRuntimeState->markDesiredRunning($application);

        $deploymentUuid = new Cuid2;
        $result = queue_application_deployment(
            application: $application,
            deployment_uuid: $deploymentUuid,
            force_rebuild: (bool) ($options['force'] ?? false),
            restart_only: $action === 'restart',
            is_api: true,
            no_questions_asked: (bool) ($options['instant_deploy'] ?? false),
        );

        if ($result['status'] === 'queue_full') {
            throw new HttpException(429, (string) $result['message']);
        }

        if ($result['status'] === 'skipped') {
            return ['queued' => false, 'message' => (string) $result['message']];
        }

        return [
            'queued' => true,
            'deployment_uuid' => $deploymentUuid->toString(),
            'message' => $action === 'restart'
                ? 'Application restart request queued.'
                : 'Application deployment request queued.',
        ];
    }

    /**
     * @param  array<string, mixed>  $options
     * @return array<string, mixed>
     */
    private function database(Model $database, string $action, array $options): array
    {
        try {
            match ($action) {
                'stop' => StopDatabase::run(
                    $database,
                    (bool) ($options['docker_cleanup'] ?? true),
                ),
                'restart' => RestartDatabase::run($database),
                'start', 'deploy' => StartDatabase::run($database),
            };
        } catch (RuntimeException $exception) {
            throw new HttpException(422, $exception->getMessage(), previous: $exception);
        }

        if ($action === 'stop') {
            $this->databaseDesiredRuntimeState->markDesiredStopped($database);
        } else {
            $this->databaseDesiredRuntimeState->markDesiredRunning($database);
        }

        return [
            'queued' => false,
            'completed' => true,
            'message' => match ($action) {
                'stop' => 'Base arrêtée.',
                'restart' => 'Base redémarrée.',
                'start' => 'Base démarrée.',
                'deploy' => 'Déploiement de la base terminé.',
                default => "Database {$action} completed.",
            },
        ];
    }

    /**
     * @param  array<string, mixed>  $options
     * @return array<string, mixed>
     */
    private function service(Service $service, string $action, array $options): array
    {
        match ($action) {
            'stop' => StopService::dispatch(
                $service,
                false,
                (bool) ($options['docker_cleanup'] ?? true),
            ),
            'restart' => RestartService::dispatch(
                $service,
                (bool) ($options['latest'] ?? false),
            ),
            'start' => StartService::dispatch($service),
            'deploy' => StartService::dispatch(
                $service,
                (bool) ($options['latest'] ?? true),
            ),
        };

        return [
            'queued' => true,
            'message' => "Service {$action} request queued.",
        ];
    }

    private function resolveTeamId(Model $resource): ?int
    {
        if ($resource instanceof Application) {
            $teamId = $resource->environment?->project?->team_id;

            return is_numeric($teamId) ? (int) $teamId : null;
        }

        if ($resource instanceof Service) {
            $teamId = $resource->environment?->project?->team_id;

            return is_numeric($teamId) ? (int) $teamId : null;
        }

        $teamId = data_get($resource, 'environment.project.team_id')
            ?? data_get($resource, 'destination.server.team_id');

        return is_numeric($teamId) ? (int) $teamId : null;
    }
}
