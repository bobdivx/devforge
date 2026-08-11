<?php

namespace App\Services\DevForge\Core;

use App\Models\Application;
use App\Models\Server;
use App\Models\Service;
use App\Services\DevForge\Application\ApplicationDatabaseConnector;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Collection;

class CoreResourcePresenter
{
    public function __construct(
        private readonly ApplicationDatabaseConnector $applicationDatabaseConnector,
        private readonly CoreResourceActionsResolver $actionsResolver,
    ) {}

    /**
     * @param  Collection<int, Model>  $resources
     * @return array<int, array<string, mixed>>
     */
    public function presentCollection(Collection $resources, string $type): array
    {
        $connectedApplicationsIndex = $type === 'databases'
            ? $this->applicationDatabaseConnector->connectedApplicationsIndex($resources)
            : [];

        return $resources
            ->map(function (Model $resource) use ($type, $connectedApplicationsIndex): array {
                $connectedApplications = $type === 'databases'
                    ? ($connectedApplicationsIndex[(string) $resource->uuid] ?? [])
                    : null;

                return $this->present($resource, $type, $connectedApplications);
            })
            ->values()
            ->all();
    }

    /**
     * @param  array<int, array{application_uuid: string, application_name: string}>|null  $connectedApplications
     * @return array<string, mixed>
     */
    public function present(Model $resource, ?string $type = null, ?array $connectedApplications = null): array
    {
        $type ??= $this->type($resource);

        return match ($type) {
            'servers' => $this->server($resource),
            'applications' => $this->application($resource),
            'services' => $this->service($resource),
            'databases' => $this->database($resource, $connectedApplications),
            default => [],
        };
    }

    /**
     * @return array<string, mixed>
     */
    public function configuration(): array
    {
        return [
            'resource_types' => ['server', 'application', 'database', 'service'],
            'database_engines' => array_keys(STANDALONE_DATABASE_MODELS),
            'actions' => [
                'server' => [],
                'application' => ['start', 'stop', 'restart', 'deploy'],
                'database' => ['start', 'stop', 'restart', 'deploy'],
                'service' => ['start', 'stop', 'restart', 'deploy'],
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function server(Server $server): array
    {
        return [
            'uuid' => $server->uuid,
            'type' => 'server',
            'name' => $server->name,
            'description' => $server->description,
            'status' => [
                'reachable' => (bool) $server->settings?->is_reachable,
                'usable' => (bool) $server->settings?->is_usable,
                'validating' => (bool) $server->is_validating,
            ],
            'configuration' => [
                'build_server' => (bool) $server->settings?->is_build_server,
                'swarm_manager' => (bool) $server->settings?->is_swarm_manager,
                'swarm_worker' => (bool) $server->settings?->is_swarm_worker,
                'metrics_enabled' => (bool) $server->settings?->is_metrics_enabled,
                'terminal_enabled' => (bool) $server->settings?->is_terminal_enabled,
                'wildcard_domain' => filled($server->settings?->wildcard_domain)
                    ? (string) $server->settings->wildcard_domain
                    : null,
            ],
            'actions' => [],
            'created_at' => $server->created_at?->toISOString(),
            'updated_at' => $server->updated_at?->toISOString(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function application(Application $application): array
    {
        $application->loadMissing('settings');

        return [
            ...$this->resourceBase($application, 'application'),
            'configuration' => [
                'build_pack' => $application->build_pack,
                'git_repository' => $this->safeUrl($application->git_repository),
                'git_branch' => $application->git_branch,
                'domains' => $this->domains($application->fqdn),
                'redirect' => (string) ($application->redirect ?: 'both'),
                'base_directory' => $application->base_directory ?: '',
                'publish_directory' => $application->publish_directory ?: '',
                'detected_framework' => $application->detected_framework ?: null,
                'ports_exposes' => (string) ($application->ports_exposes ?? ''),
                'start_command' => $application->start_command,
                'install_command' => $application->install_command,
                'build_command' => $application->build_command,
                'is_static' => (bool) ($application->settings?->is_static ?? false),
                'health_check_enabled' => (bool) $application->health_check_enabled,
                'health_check_type' => $application->health_check_type ?: 'http',
                'health_check_path' => $application->health_check_path ?: '/',
                'health_check_port' => filled($application->health_check_port)
                    ? (string) $application->health_check_port
                    : null,
                'project' => $this->project($application),
                'environment' => $this->environment($application),
                'destination' => $this->destinationReference($application),
                'server' => $this->serverReference($application),
                'remote_workdir' => $application->workdir(),
            ],
            'actions' => $this->actionsResolver->forResource('application', (string) $application->status),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function service(Service $service): array
    {
        return [
            ...$this->resourceBase($service, 'service'),
            'configuration' => [
                'service_type' => $service->service_type,
                'is_image_auto_update_enabled' => (bool) ($service->is_image_auto_update_enabled ?? false),
                'domains' => $service->applications
                    ->flatMap(fn ($application): array => $this->domains($application->fqdn))
                    ->filter()
                    ->unique()
                    ->values()
                    ->all(),
                'project' => $this->project($service),
                'environment' => $this->environment($service),
                'server' => $this->serverReference($service),
            ],
            'actions' => $this->actionsResolver->forResource('service', (string) $service->status),
        ];
    }

    /**
     * @param  array<int, array{application_uuid: string, application_name: string}>|null  $connectedApplications
     * @return array<string, mixed>
     */
    private function database(Model $database, ?array $connectedApplications = null): array
    {
        $engine = str((string) $database->type())->after('standalone-')->value();

        return [
            ...$this->resourceBase($database, 'database'),
            'engine' => $engine,
            'engine_label' => $this->engineLabel($engine),
            'connected_applications' => $connectedApplications
                ?? $this->applicationDatabaseConnector->connectedApplications($database),
            'configuration' => [
                'image' => $database->image,
                'public' => (bool) $database->is_public,
                'public_port' => $database->is_public ? $database->public_port : null,
                'project' => $this->project($database),
                'environment' => $this->environment($database),
                'server' => $this->serverReference($database),
            ],
            'actions' => $this->actionsResolver->forResource('database', (string) $database->status),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function resourceBase(Model $resource, string $type): array
    {
        return [
            'uuid' => $resource->uuid,
            'type' => $type,
            'name' => $resource->name,
            'description' => $resource->description,
            'status' => $resource->status,
            'created_at' => $resource->created_at?->toISOString(),
            'updated_at' => $resource->updated_at?->toISOString(),
        ];
    }

    /**
     * @return array{uuid: mixed, name: mixed}|null
     */
    private function project(Model $resource): ?array
    {
        $project = $resource->environment?->project;

        return $project ? ['uuid' => $project->uuid, 'name' => $project->name] : null;
    }

    /**
     * @return array{uuid: mixed, name: mixed}|null
     */
    private function environment(Model $resource): ?array
    {
        $environment = $resource->environment;

        return $environment ? ['uuid' => $environment->uuid, 'name' => $environment->name] : null;
    }

    /**
     * @return array{uuid: mixed, name: mixed}|null
     */
    private function destinationReference(Model $resource): ?array
    {
        $destination = $resource->destination;

        return $destination ? ['uuid' => $destination->uuid, 'name' => $destination->name] : null;
    }

    /**
     * @return array{uuid: mixed, name: mixed}|null
     */
    private function serverReference(Model $resource): ?array
    {
        $server = $resource->destination?->server ?? $resource->server;

        return $server ? ['uuid' => $server->uuid, 'name' => $server->name] : null;
    }

    /**
     * @return array<int, string>
     */
    private function domains(?string $fqdn): array
    {
        return str($fqdn)->explode(',')
            ->map(fn (string $domain): ?string => $this->safeUrl(trim($domain)))
            ->filter()
            ->values()
            ->all();
    }

    private function safeUrl(?string $url): ?string
    {
        if (blank($url)) {
            return null;
        }

        $parts = parse_url($url);
        if (! is_array($parts) || ! isset($parts['host'])) {
            $withoutUserInfo = preg_replace('/^[^@\/]+@/', '', $url) ?? $url;

            return str($withoutUserInfo)->before('?')->before('#')->value();
        }

        $scheme = isset($parts['scheme']) ? $parts['scheme'].'://' : '';
        $port = isset($parts['port']) ? ':'.$parts['port'] : '';

        return $scheme.$parts['host'].$port.($parts['path'] ?? '');
    }

    private function type(Model $resource): string
    {
        return match (true) {
            $resource instanceof Server => 'servers',
            $resource instanceof Application => 'applications',
            $resource instanceof Service => 'services',
            default => 'databases',
        };
    }

    private function engineLabel(string $engine): string
    {
        return match ($engine) {
            'libsql' => 'libSQL',
            'postgresql' => 'PostgreSQL',
            'mysql' => 'MySQL',
            'mariadb' => 'MariaDB',
            'mongodb' => 'MongoDB',
            'redis' => 'Redis',
            'keydb' => 'KeyDB',
            'dragonfly' => 'Dragonfly',
            'clickhouse' => 'ClickHouse',
            default => str($engine)->headline()->value(),
        };
    }
}
