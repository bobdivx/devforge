<?php

namespace App\Services\DevForge\Database;

use App\Actions\Database\StartDatabase;
use App\Models\StandaloneDocker;
use App\Models\SwarmDocker;
use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\Application\ApplicationDatabaseConnector;
use App\Services\DevForge\CurrentTeamResources;
use App\Services\DevForge\DeploymentTargetData;
use Illuminate\Support\Facades\Gate;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Validation\Rule;

class StandaloneDatabaseCreator
{
    public function __construct(
        private readonly CurrentTeamResources $currentTeamResources,
        private readonly DeploymentTargetData $deploymentTargetData,
        private readonly ApplicationDatabaseConnector $applicationDatabaseConnector,
    ) {}

    /**
     * @param  array<string, mixed>  $input
     * @return array{database: Model, instant_deploy: bool, connection: array<string, mixed>|null}
     */
    public function create(User $user, Team $team, array $input): array
    {
        $validated = validator($input, [
            'engine' => ['required', Rule::in(DATABASE_TYPES)],
            'project_uuid' => ['required', 'string'],
            'environment_uuid' => ['required', 'string'],
            'destination_uuid' => ['required', 'string'],
            'name' => ['nullable', 'string', 'max:255'],
            'image' => ['nullable', 'string', 'max:255'],
            'instant_deploy' => ['nullable', 'boolean'],
            'application_uuid' => ['nullable', 'string'],
            'env_key' => ['nullable', 'string', 'max:255', 'regex:/^[A-Z][A-Z0-9_]*$/'],
            'application_instant_deploy' => ['nullable', 'boolean'],
            'migrate_from_remote' => ['nullable', 'boolean'],
        ])->validate();

        $environment = $this->currentTeamResources->environment(
            $user,
            $validated['project_uuid'],
            $validated['environment_uuid'],
        );

        $destination = $this->deploymentTargetData->destinationForTeam($team, $validated['destination_uuid']);
        abort_unless($destination instanceof StandaloneDocker || $destination instanceof SwarmDocker, 404, 'Destination not found.');

        $otherData = array_filter([
            'name' => $validated['name'] ?? null,
        ], fn (?string $value): bool => filled($value));

        $database = $this->createDatabase(
            $validated['engine'],
            $environment->id,
            $destination,
            $otherData === [] ? null : $otherData,
            $validated['image'] ?? null,
        );

        $instantDeploy = (bool) ($validated['instant_deploy'] ?? true);
        if ($instantDeploy) {
            StartDatabase::dispatch($database);
        }

        $connection = null;
        if (filled($validated['application_uuid'] ?? null)) {
            $application = $this->currentTeamResources->application($user, $validated['application_uuid']);
            Gate::forUser($user)->authorize('update', $application);

            $connection = $this->applicationDatabaseConnector->connect($user, $team, $application, [
                'database_uuid' => (string) $database->uuid,
                'env_key' => $validated['env_key'] ?? null,
                'instant_deploy' => (bool) ($validated['application_instant_deploy'] ?? true),
                'migrate_from_remote' => (bool) ($validated['migrate_from_remote'] ?? false),
            ]);
        }

        return [
            'database' => $database,
            'instant_deploy' => $instantDeploy,
            'connection' => $connection,
        ];
    }

    /**
     * @param  array<string, string>|null  $otherData
     */
    private function createDatabase(
        string $engine,
        int $environmentId,
        StandaloneDocker|SwarmDocker $destination,
        ?array $otherData,
        ?string $image,
    ): Model {
        return match ($engine) {
            'postgresql' => create_standalone_postgresql(
                $environmentId,
                $destination,
                $otherData,
                $image ?? 'postgres:16-alpine',
            ),
            'redis' => create_standalone_redis($environmentId, $destination, $otherData),
            'mongodb' => create_standalone_mongodb($environmentId, $destination, $otherData),
            'mysql' => create_standalone_mysql($environmentId, $destination, $otherData),
            'mariadb' => create_standalone_mariadb($environmentId, $destination, $otherData),
            'keydb' => create_standalone_keydb($environmentId, $destination, $otherData),
            'dragonfly' => create_standalone_dragonfly($environmentId, $destination, $otherData),
            'clickhouse' => create_standalone_clickhouse($environmentId, $destination, $otherData),
            'libsql' => create_standalone_libsql($environmentId, $destination, $otherData),
            default => abort(422, 'Unsupported database engine.'),
        };
    }
}
