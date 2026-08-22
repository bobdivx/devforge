<?php

namespace App\Services\DevForge\Application;

use App\Models\Application;
use App\Models\EnvironmentVariable;
use App\Models\Team;
use App\Models\User;
use App\Models\StandaloneLibsql;
use App\Services\DevForge\Database\LibsqlConnectionEnvSync;
use App\Services\DevForge\Database\LibsqlDatabaseTransferService;
use App\Services\DevForge\Database\LibsqlTursoMigrationService;
use Illuminate\Database\Eloquent\Model;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Visus\Cuid2\Cuid2;

class ApplicationDatabaseConnector
{
    public function __construct(
        private readonly LibsqlConnectionEnvSync $libsqlConnectionEnvSync,
        private readonly LibsqlTursoMigrationService $libsqlTursoMigrationService,
        private readonly LibsqlDatabaseTransferService $libsqlDatabaseTransferService,
    ) {}

    /**
     * @return array<int, string>
     */
    public static function envKeysForEngine(string $engine): array
    {
        return match ($engine) {
            'postgresql', 'mysql', 'mariadb', 'clickhouse' => ['DATABASE_URL'],
            'mongodb' => ['MONGODB_URI', 'MONGODB_URL'],
            'redis', 'keydb', 'dragonfly' => ['REDIS_URL'],
            'libsql' => LibsqlConnectionEnvSync::allowedEnvKeys(),
            default => ['DATABASE_URL'],
        };
    }

    public static function defaultEnvKeyForEngine(string $engine): string
    {
        return match ($engine) {
            'libsql' => 'TURSO_DATABASE_URL',
            default => self::envKeysForEngine($engine)[0],
        };
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function linkableDatabases(Application $application): array
    {
        $databases = $application->environment
            ?->databases()
            ->filter(function (Model $database) use ($application): bool {
                return (int) $database->destination_id === (int) $application->destination_id
                    && (string) $database->destination_type === (string) $application->destination_type;
            })
            ->values() ?? collect();

        $connectedApplicationsIndex = $this->connectedApplicationsIndex($databases);

        return $databases
            ->map(function (Model $database) use ($connectedApplicationsIndex): array {
                $engine = str((string) $database->type())->after('standalone-')->value();
                $connectedApplications = $connectedApplicationsIndex[(string) $database->uuid] ?? [];

                return [
                    'uuid' => $database->uuid,
                    'name' => $database->name,
                    'engine' => $engine,
                    'status' => $database->status,
                    'default_env_key' => self::defaultEnvKeyForEngine($engine),
                    'env_key_options' => self::envKeysForEngine($engine),
                    'connected_applications' => $connectedApplications,
                    'is_linkable' => $connectedApplications === [],
                ];
            })
            ->values()
            ->all();
    }

    /**
     * Reset a libSQL database linked to this application (wipe data + restart).
     *
     * @return array{
     *     database_uuid: string,
     *     database_name: string,
     *     reset: bool,
     *     restarted: bool,
     *     message: string,
     *     redeploy: array{queued: bool, deployment_uuid: string|null, message: string}|null
     * }
     */
    public function resetLinkedDatabase(
        Application $application,
        Team $team,
        string $databaseUuid,
        bool $redeployApplication = true,
    ): array {
        $connection = collect($this->connections($application))
            ->first(fn (array $item): bool => ($item['database_uuid'] ?? null) === $databaseUuid);

        abort_unless($connection !== null, 422, 'Cette base n’est pas rattachée à l’application.');

        $database = getResourceByUuid($databaseUuid, $team->id);
        abort_unless($database instanceof StandaloneLibsql, 422, 'La réinitialisation n’est disponible que pour les bases libSQL.');

        $result = $this->libsqlDatabaseTransferService->resetEmpty($database);

        $redeploy = null;
        if ($redeployApplication) {
            $deploymentUuid = new Cuid2;
            $queueResult = queue_application_deployment(
                application: $application,
                deployment_uuid: $deploymentUuid,
                force_rebuild: false,
                restart_only: false,
                is_api: true,
                no_questions_asked: true,
            );

            if ($queueResult['status'] === 'queue_full') {
                throw new HttpException(429, (string) $queueResult['message']);
            }

            $redeploy = [
                'queued' => $queueResult['status'] !== 'skipped',
                'deployment_uuid' => $queueResult['status'] !== 'skipped' ? $deploymentUuid->toString() : null,
                'message' => (string) ($queueResult['message'] ?? 'Deployment queued.'),
            ];
        }

        return [
            'database_uuid' => $database->uuid,
            'database_name' => $database->name,
            'reset' => (bool) ($result['reset'] ?? true),
            'restarted' => (bool) ($result['restarted'] ?? true),
            'message' => (string) ($result['message'] ?? 'Base réinitialisée.'),
            'redeploy' => $redeploy,
        ];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function connections(Application $application): array
    {
        $knownDatabaseUuids = collect($this->linkableDatabases($application))
            ->pluck('uuid')
            ->flip();

        $grouped = [];

        // First pass: detect connections with proper comment markers
        foreach ($this->linkedEnvironmentVariables($application) as $variable) {
            $databaseUuid = (string) str($variable->comment)->after(LibsqlConnectionEnvSync::LINK_COMMENT_PREFIX)->value();

            if (! $knownDatabaseUuids->has($databaseUuid)) {
                continue;
            }

            if (! isset($grouped[$databaseUuid])) {
                $grouped[$databaseUuid] = [
                    'database_uuid' => $databaseUuid,
                    'env_keys' => [],
                    'is_runtime' => (bool) $variable->is_runtime,
                    'is_buildtime' => (bool) $variable->is_buildtime,
                    'updated_at' => $variable->updated_at?->toISOString(),
                ];
            }

            $grouped[$databaseUuid]['env_keys'][] = $variable->key;
            $grouped[$databaseUuid]['is_runtime'] = $grouped[$databaseUuid]['is_runtime'] || (bool) $variable->is_runtime;
            $grouped[$databaseUuid]['is_buildtime'] = $grouped[$databaseUuid]['is_buildtime'] || (bool) $variable->is_buildtime;

            $updatedAt = $variable->updated_at?->toISOString();
            if ($updatedAt !== null && ($grouped[$databaseUuid]['updated_at'] === null || $updatedAt > $grouped[$databaseUuid]['updated_at'])) {
                $grouped[$databaseUuid]['updated_at'] = $updatedAt;
            }
        }

        // Second pass: detect Turso/libSQL connections without comment markers (legacy apps)
        // by parsing URL values for known database UUIDs
        $legacyTursoVars = $application->environment_variables()
            ->where('is_preview', false)
            ->whereIn('key', LibsqlConnectionEnvSync::allowedEnvKeys())
            ->get()
            ->filter(function (EnvironmentVariable $variable) use ($grouped): bool {
                // Skip if already detected via comment marker
                $hasComment = str($variable->comment ?? '')->startsWith(LibsqlConnectionEnvSync::LINK_COMMENT_PREFIX);
                if ($hasComment) {
                    return false;
                }

                // Skip if this UUID is already in grouped (from comment-marked vars)
                $detectedUuid = $this->extractDatabaseUuidFromUrl((string) $variable->value);
                if ($detectedUuid && isset($grouped[$detectedUuid])) {
                    return false;
                }

                return true;
            });

        foreach ($legacyTursoVars as $variable) {
            $detectedUuid = $this->extractDatabaseUuidFromUrl((string) $variable->value);

            if (! $detectedUuid || ! $knownDatabaseUuids->has($detectedUuid)) {
                continue;
            }

            if (! isset($grouped[$detectedUuid])) {
                $grouped[$detectedUuid] = [
                    'database_uuid' => $detectedUuid,
                    'env_keys' => [],
                    'is_runtime' => (bool) $variable->is_runtime,
                    'is_buildtime' => (bool) $variable->is_buildtime,
                    'updated_at' => $variable->updated_at?->toISOString(),
                ];
            }

            $grouped[$detectedUuid]['env_keys'][] = $variable->key;
            $grouped[$detectedUuid]['is_runtime'] = $grouped[$detectedUuid]['is_runtime'] || (bool) $variable->is_runtime;
            $grouped[$detectedUuid]['is_buildtime'] = $grouped[$detectedUuid]['is_buildtime'] || (bool) $variable->is_buildtime;

            $updatedAt = $variable->updated_at?->toISOString();
            if ($updatedAt !== null && ($grouped[$detectedUuid]['updated_at'] === null || $updatedAt > $grouped[$detectedUuid]['updated_at'])) {
                $grouped[$detectedUuid]['updated_at'] = $updatedAt;
            }
        }

        return collect($grouped)
            ->map(function (array $connection): array {
                $connection['env_keys'] = collect($connection['env_keys'])
                    ->unique()
                    ->sort()
                    ->values()
                    ->all();

                return $connection;
            })
            ->sortBy('database_uuid')
            ->values()
            ->all();
    }

    /**
     * Extract database UUID from a Turso/libSQL URL.
     * Returns null if URL doesn't contain a valid resource UUID pattern.
     */
    private function extractDatabaseUuidFromUrl(string $url): ?string
    {
        // Parse URLs like:
        // - http://{uuid}:8080
        // - libsql://{uuid}
        // - http://{uuid}:8080/path
        // But NOT:
        // - http://devforge-local-db:8080 (platform DB)
        // - http://some-random-host:8080
        
        // Extract potential UUID from the hostname part
        if (preg_match('#^(?:https?|libsql)://([a-z0-9]+?)(?::|/|$)#i', $url, $matches)) {
            $potentialUuid = $matches[1];
            
            // DevForge uses CUID2 for UUIDs, which are alphanumeric lowercase strings
            // Typical pattern: starts with a letter, 24-32 chars
            // Reject common non-UUID hostnames
            $rejectedPatterns = [
                'localhost',
                'devforge',
                'local',
                'db',
                'database',
                'turso',
                'libsql',
            ];
            
            $lowerUuid = strtolower($potentialUuid);
            foreach ($rejectedPatterns as $pattern) {
                if (str_contains($lowerUuid, $pattern)) {
                    return null;
                }
            }
            
            // CUID2 format validation: starts with letter, 24+ chars, alphanumeric lowercase
            if (preg_match('/^[a-z][a-z0-9]{23,}$/i', $potentialUuid)) {
                return $potentialUuid;
            }
        }
        
        return null;
    }

    /**
     * @return \Illuminate\Support\Collection<int, EnvironmentVariable>
     */
    private function linkedEnvironmentVariables(Application $application): \Illuminate\Support\Collection
    {
        return $application->environment_variables()
            ->where('is_preview', false)
            ->get()
            ->filter(fn (EnvironmentVariable $variable): bool => str($variable->comment ?? '')->startsWith(LibsqlConnectionEnvSync::LINK_COMMENT_PREFIX));
    }

    /**
     * @param  iterable<int, Model>  $databases
     * @return array<string, array<int, array{application_uuid: string, application_name: string}>>
     */
    public function connectedApplicationsIndex(iterable $databases): array
    {
        $databaseUuids = collect($databases)
            ->map(fn (Model $database): string => (string) $database->uuid)
            ->filter()
            ->unique()
            ->values();

        if ($databaseUuids->isEmpty()) {
            return [];
        }

        $comments = $databaseUuids
            ->map(fn (string $uuid): string => LibsqlConnectionEnvSync::LINK_COMMENT_PREFIX.$uuid)
            ->all();

        $variables = EnvironmentVariable::query()
            ->where('is_preview', false)
            ->whereIn('comment', $comments)
            ->where('resourceable_type', Application::class)
            ->with(['resourceable:id,uuid,name'])
            ->get();

        $index = [];

        foreach ($variables as $variable) {
            if (! $variable->resourceable instanceof Application) {
                continue;
            }

            $databaseUuid = (string) str($variable->comment)->after(LibsqlConnectionEnvSync::LINK_COMMENT_PREFIX)->value();
            $applicationUuid = (string) $variable->resourceable->uuid;

            $index[$databaseUuid][$applicationUuid] = [
                'application_uuid' => $applicationUuid,
                'application_name' => $variable->resourceable->name,
            ];
        }

        return collect($index)
            ->map(fn (array $applications): array => array_values($applications))
            ->all();
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function connectedApplications(Model $database): array
    {
        $comment = LibsqlConnectionEnvSync::LINK_COMMENT_PREFIX.$database->uuid;

        return EnvironmentVariable::query()
            ->where('is_preview', false)
            ->where('comment', $comment)
            ->where('resourceable_type', Application::class)
            ->with(['resourceable:id,uuid,name'])
            ->get()
            ->filter(fn (EnvironmentVariable $variable): bool => $variable->resourceable instanceof Application)
            ->map(fn (EnvironmentVariable $variable): array => [
                'application_uuid' => $variable->resourceable->uuid,
                'application_name' => $variable->resourceable->name,
                'env_key' => $variable->key,
                'is_runtime' => (bool) $variable->is_runtime,
                'is_buildtime' => (bool) $variable->is_buildtime,
                'updated_at' => $variable->updated_at?->toISOString(),
            ])
            ->unique(fn (array $connection): string => (string) $connection['application_uuid'])
            ->values()
            ->all();
    }

    /**
     * @return array{available: bool, source_url: string|null, env_keys: array<int, string>}|null
     */
    public function tursoMigrationCandidate(Application $application): ?array
    {
        return $this->libsqlTursoMigrationService->candidate($application);
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public function connect(User $user, Team $team, Application $application, array $input): array
    {
        if (array_key_exists('database_uuid', $input)) {
            $input['database_uuid'] = (string) $input['database_uuid'];
        }

        $validated = validator($input, [
            'database_uuid' => ['required', 'string'],
            'env_key' => ['nullable', 'string', 'max:255', 'regex:/^[A-Z][A-Z0-9_]*$/'],
            'is_runtime' => ['nullable', 'boolean'],
            'is_buildtime' => ['nullable', 'boolean'],
            'instant_deploy' => ['nullable', 'boolean'],
            'migrate_from_remote' => ['nullable', 'boolean'],
        ])->validate();

        $database = getResourceByUuid($validated['database_uuid'], $team->id);
        abort_unless($database instanceof Model && in_array($database->getMorphClass(), array_values(STANDALONE_DATABASE_MODELS), true), 404, 'Database not found.');

        if ((int) $database->environment_id !== (int) $application->environment_id) {
            throw new HttpException(422, 'The database must belong to the same environment as the application.');
        }

        if ((int) $database->destination_id !== (int) $application->destination_id
            || (string) $database->destination_type !== (string) $application->destination_type) {
            throw new HttpException(422, 'The database must use the same deployment destination as the application.');
        }

        $connectedApplications = $this->connectedApplications($database);
        if ($connectedApplications !== []) {
            $attachedApplicationNames = collect($connectedApplications)
                ->pluck('application_name')
                ->unique()
                ->implode(', ');

            throw new HttpException(422, "Cette base est déjà rattachée à {$attachedApplicationNames}.");
        }

        $engine = str((string) $database->type())->after('standalone-')->value();
        $preferredKey = $validated['env_key'] ?? null;
        $allowedKeys = self::envKeysForEngine($engine);

        if ($preferredKey !== null && ! in_array($preferredKey, $allowedKeys, true)) {
            throw new HttpException(422, 'Invalid environment variable key for this database engine.');
        }

        $isRuntime = (bool) ($validated['is_runtime'] ?? true);
        $isBuildtime = (bool) ($validated['is_buildtime'] ?? true);
        $instantDeploy = (bool) ($validated['instant_deploy'] ?? true);
        $migrateFromRemote = (bool) ($validated['migrate_from_remote'] ?? false);
        $migration = null;

        if ($engine === 'libsql') {
            $this->assertLibsqlReady($database);
            abort_unless($database instanceof StandaloneLibsql, 422, 'La base libSQL est invalide.');

            if ($migrateFromRemote) {
                $migration = $this->libsqlTursoMigrationService->migrate($application, $database);

                if ($this->libsqlTursoMigrationService->candidate($application) !== null) {
                    $preferredKey = null;
                }

                auditLog('devforge.application.turso_migrated', [
                    'team_id' => $team->id,
                    'application_uuid' => $application->uuid,
                    'database_uuid' => $database->uuid,
                    'user_id' => $user->id,
                ]);
            }

            $connection = $this->libsqlConnectionEnvSync->applyConnection(
                $application,
                $database,
                $preferredKey,
                $isRuntime,
                $isBuildtime,
            );
            $envKeys = $connection['env_keys'];
            $envKey = $connection['primary_env_key'];
        } else {
            $connectionUrl = (string) $database->internal_db_url;
            if (blank($connectionUrl)) {
                throw new HttpException(422, 'The database connection URL is not available yet. Start the database first.');
            }

            $envKey = $preferredKey ?? self::defaultEnvKeyForEngine($engine);
            $application->environment_variables()->updateOrCreate(
                [
                    'key' => $envKey,
                    'is_preview' => false,
                ],
                [
                    'value' => $connectionUrl,
                    'is_runtime' => $isRuntime,
                    'is_buildtime' => $isBuildtime,
                    'is_literal' => false,
                    'is_multiline' => false,
                    'is_shown_once' => false,
                    'comment' => LibsqlConnectionEnvSync::LINK_COMMENT_PREFIX.$database->uuid,
                    'resourceable_type' => $application->getMorphClass(),
                    'resourceable_id' => $application->id,
                ],
            );
            $envKeys = [$envKey];
        }

        $deployment = null;
        if ($instantDeploy) {
            $deploymentUuid = new Cuid2;
            $result = queue_application_deployment(
                application: $application,
                deployment_uuid: $deploymentUuid,
                force_rebuild: false,
                restart_only: false,
                is_api: true,
                no_questions_asked: true,
            );

            if ($result['status'] === 'queue_full') {
                throw new HttpException(429, (string) $result['message']);
            }

            $deployment = [
                'queued' => $result['status'] !== 'skipped',
                'deployment_uuid' => $deploymentUuid->toString(),
                'message' => (string) ($result['message'] ?? 'Deployment queued.'),
            ];
        }

        auditLog('devforge.application.database_connected', [
            'team_id' => $team->id,
            'application_uuid' => $application->uuid,
            'database_uuid' => $database->uuid,
            'env_key' => $envKey,
            'env_keys' => $envKeys,
            'user_id' => $user->id,
        ]);

        return [
            'application_uuid' => $application->uuid,
            'database_uuid' => $database->uuid,
            'database_name' => $database->name,
            'engine' => $engine,
            'env_key' => $envKey,
            'env_keys' => $envKeys,
            'is_runtime' => $isRuntime,
            'is_buildtime' => $isBuildtime,
            'deployment' => $deployment,
            'migration' => $migration,
        ];
    }

    private function assertLibsqlReady(Model $database): void
    {
        if (blank($database->libsql_auth_token)) {
            throw new HttpException(422, 'Le jeton d’authentification libSQL n’est pas disponible.');
        }
    }
}
