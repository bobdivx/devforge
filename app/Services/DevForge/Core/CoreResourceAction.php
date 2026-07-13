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
use Illuminate\Database\Eloquent\Model;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Visus\Cuid2\Cuid2;

class CoreResourceAction
{
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
            'team_id' => currentTeam()->id,
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
            StopApplication::dispatch(
                $application,
                false,
                (bool) ($options['docker_cleanup'] ?? true),
            );

            return ['queued' => true, 'message' => 'Application stopping request queued.'];
        }

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
        match ($action) {
            'stop' => StopDatabase::dispatch(
                $database,
                (bool) ($options['docker_cleanup'] ?? true),
            ),
            'restart' => RestartDatabase::dispatch($database),
            'start', 'deploy' => StartDatabase::dispatch($database),
        };

        return [
            'queued' => true,
            'message' => "Database {$action} request queued.",
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
            'start', 'deploy' => StartService::dispatch($service),
        };

        return [
            'queued' => true,
            'message' => "Service {$action} request queued.",
        ];
    }
}
