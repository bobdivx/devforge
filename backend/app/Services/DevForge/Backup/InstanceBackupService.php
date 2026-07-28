<?php

namespace App\Services\DevForge\Backup;

use App\Jobs\DatabaseBackupJob;
use App\Models\S3Storage;
use App\Models\ScheduledDatabaseBackup;
use App\Models\ScheduledDatabaseBackupExecution;
use App\Models\Server;
use App\Models\StandaloneDocker;
use App\Models\StandalonePostgresql;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;

class InstanceBackupService
{
    public const INSTANCE_DATABASE_NAMES = ['coolify-db', 'devforge-db'];

    public const CONTAINER_CANDIDATES = ['devforge-db', 'coolify-db'];

    public function __construct(
        private readonly BackupPresenter $presenter,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function show(): array
    {
        $database = $this->findInstanceDatabase();
        $backup = $database?->scheduledBackups()->with(['s3', 'latest_log'])->first();
        $server = Server::find(0);
        $teamId = (int) (currentTeam()?->id ?? 0);

        $s3Storages = S3Storage::query()
            ->whereIn('team_id', array_values(array_unique([$teamId, 0])))
            ->orderBy('name')
            ->get()
            ->map(fn (S3Storage $storage): array => [
                'uuid' => $storage->uuid,
                'name' => $storage->name,
                'is_usable' => (bool) $storage->is_usable,
                'team_id' => (int) $storage->team_id,
            ])
            ->values()
            ->all();

        $executions = [];
        if ($backup) {
            $executions = $backup->executions()
                ->orderByDesc('created_at')
                ->limit(20)
                ->get()
                ->map(fn (ScheduledDatabaseBackupExecution $execution): array => array_merge(
                    $this->presenter->execution($execution),
                    [
                        'id' => $execution->id,
                        'download_url' => $execution->filename
                            ? url('/download/backup/'.$execution->id)
                            : null,
                    ],
                ))
                ->all();
        }

        return [
            'database' => $database ? $this->presentDatabase($database) : null,
            'backup' => $backup ? $this->presenter->backup($backup) : null,
            'executions' => $executions,
            's3_storages' => $s3Storages,
            'is_server_functional' => $server ? $server->isFunctional() : false,
            'migration' => [
                'legacy_container_detected' => $this->detectLegacyCoolifyContainer($server),
                'container_candidates' => self::CONTAINER_CANDIDATES,
                'notes' => 'Importez un dump Coolify (.sql / .sql.gz) ou initialisez depuis le conteneur coolify-db / devforge-db pour basculer vers DevForge.',
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function init(?string $preferredContainer = null): array
    {
        if ($this->findInstanceDatabase()) {
            throw new HttpException(422, 'La sauvegarde d’instance est déjà initialisée.');
        }

        $server = Server::findOrFail(0);
        $container = $this->resolveContainerName($server, $preferredContainer);
        $out = instant_remote_process(['docker inspect '.escapeshellarg($container)], $server);
        $envs = format_docker_envs_to_json($out);

        $database = new StandalonePostgresql;
        $database->forceFill([
            'id' => 0,
            'uuid' => Str::uuid()->toString(),
            'name' => 'coolify-db',
            'description' => 'Base de données DevForge (instance)',
            'postgres_user' => $envs['POSTGRES_USER'] ?? 'devforge',
            'postgres_password' => $envs['POSTGRES_PASSWORD'] ?? '',
            'postgres_db' => $envs['POSTGRES_DB'] ?? 'devforge',
            'status' => 'running',
            'destination_type' => StandaloneDocker::class,
            'destination_id' => 0,
        ]);
        $database->save();

        ScheduledDatabaseBackup::create([
            'id' => 0,
            'enabled' => true,
            'save_s3' => false,
            'frequency' => '0 0 * * *',
            'database_id' => $database->id,
            'database_type' => StandalonePostgresql::class,
            'team_id' => currentTeam()->id ?? 0,
        ]);

        return $this->show();
    }

    /**
     * Detect Coolify container and initialize (or refresh credentials) for DevForge cutover.
     *
     * @return array<string, mixed>
     */
    public function migrateFromCoolify(): array
    {
        $server = Server::findOrFail(0);

        if (! $this->detectLegacyCoolifyContainer($server) && ! $this->containerExists($server, 'devforge-db')) {
            throw new HttpException(
                422,
                'Aucun conteneur coolify-db ou devforge-db détecté. Importez un dump Coolify à la place.',
            );
        }

        if ($this->findInstanceDatabase()) {
            return $this->syncCredentialsFromContainer($server);
        }

        return $this->init('coolify-db');
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public function updateDatabase(array $input): array
    {
        $validated = Validator::make($input, [
            'name' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:255'],
            'postgres_user' => ['required', 'string', 'max:255'],
            'postgres_password' => ['required', 'string'],
        ])->validate();

        $database = $this->requireInstanceDatabase();
        $database->update([
            'name' => $validated['name'],
            'description' => $validated['description'] ?? null,
            'postgres_user' => $validated['postgres_user'],
            'postgres_password' => $validated['postgres_password'],
        ]);

        return $this->show();
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public function updateSchedule(array $input): array
    {
        $validated = Validator::make($input, [
            'enabled' => ['sometimes', 'boolean'],
            'frequency' => ['sometimes', 'string'],
            'save_s3' => ['sometimes', 'boolean'],
            's3_storage_uuid' => ['nullable', 'string', 'exists:s3_storages,uuid'],
            'disable_local_backup' => ['sometimes', 'boolean'],
            'database_backup_retention_amount_locally' => ['sometimes', 'integer', 'min:0'],
            'database_backup_retention_days_locally' => ['sometimes', 'integer', 'min:0'],
            'database_backup_retention_amount_s3' => ['sometimes', 'integer', 'min:0'],
            'database_backup_retention_days_s3' => ['sometimes', 'integer', 'min:0'],
        ])->validate();

        if (! empty($validated['frequency']) && ! validate_cron_expression((string) $validated['frequency'])) {
            throw ValidationException::withMessages([
                'frequency' => ['Expression cron ou fréquence invalide.'],
            ]);
        }

        $database = $this->requireInstanceDatabase();
        $backup = $database->scheduledBackups()->first();

        if (! $backup) {
            $backup = ScheduledDatabaseBackup::create([
                'id' => 0,
                'enabled' => true,
                'save_s3' => false,
                'frequency' => '0 0 * * *',
                'database_id' => $database->id,
                'database_type' => StandalonePostgresql::class,
                'team_id' => currentTeam()->id ?? 0,
            ]);
        }

        $saveS3 = array_key_exists('save_s3', $validated)
            ? (bool) $validated['save_s3']
            : (bool) $backup->save_s3;

        $s3Id = $backup->s3_storage_id;
        if ($saveS3) {
            $uuid = $validated['s3_storage_uuid'] ?? $backup->s3?->uuid;
            if (! $uuid) {
                throw ValidationException::withMessages([
                    's3_storage_uuid' => ['Choisissez une destination S3 pour les sauvegardes d’instance.'],
                ]);
            }

            $teamId = (int) (currentTeam()?->id ?? 0);
            $storage = S3Storage::query()
                ->where('uuid', $uuid)
                ->whereIn('team_id', array_values(array_unique([$teamId, 0])))
                ->first();

            if (! $storage) {
                throw ValidationException::withMessages([
                    's3_storage_uuid' => ['Destination S3 introuvable pour cette équipe.'],
                ]);
            }

            $s3Id = $storage->id;
        } elseif (array_key_exists('save_s3', $validated) && ! $saveS3) {
            $s3Id = null;
        }

        $backup->fill([
            'enabled' => $validated['enabled'] ?? $backup->enabled,
            'frequency' => $validated['frequency'] ?? $backup->frequency,
            'save_s3' => $saveS3,
            's3_storage_id' => $s3Id,
            'disable_local_backup' => $validated['disable_local_backup'] ?? $backup->disable_local_backup,
            'database_backup_retention_amount_locally' => $validated['database_backup_retention_amount_locally']
                ?? $backup->database_backup_retention_amount_locally,
            'database_backup_retention_days_locally' => $validated['database_backup_retention_days_locally']
                ?? $backup->database_backup_retention_days_locally,
            'database_backup_retention_amount_s3' => $validated['database_backup_retention_amount_s3']
                ?? $backup->database_backup_retention_amount_s3,
            'database_backup_retention_days_s3' => $validated['database_backup_retention_days_s3']
                ?? $backup->database_backup_retention_days_s3,
        ]);
        $backup->save();

        return $this->show();
    }

    /**
     * @return array<string, mixed>
     */
    public function runNow(): array
    {
        $database = $this->requireInstanceDatabase();
        $backup = $database->scheduledBackups()->firstOrFail();

        dispatch(new DatabaseBackupJob($backup));

        auditLog('devforge.instance.backup_run', [
            'backup_uuid' => $backup->uuid,
            'database_uuid' => $database->uuid,
        ]);

        return [
            'queued' => true,
            'backup_uuid' => $backup->uuid,
            'message' => 'Sauvegarde d’instance mise en file d’attente.',
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function import(UploadedFile $file, bool $fromCoolify = false): array
    {
        $name = strtolower($file->getClientOriginalName());
        $extension = strtolower($file->getClientOriginalExtension());

        $allowed = str_ends_with($name, '.sql.gz')
            || in_array($extension, ['sql', 'gz', 'dump', 'bak'], true);

        if (! $allowed) {
            throw ValidationException::withMessages([
                'file' => ['Fichier invalide. Formats acceptés : .sql, .sql.gz, .dump'],
            ]);
        }

        $database = $this->requireInstanceDatabase();
        $server = Server::findOrFail(0);
        $container = $this->resolveContainerName($server);

        $isGzip = str_ends_with($name, '.gz') || $extension === 'gz';
        $token = Str::uuid()->toString();
        $storageRel = "upload/instance-{$database->uuid}/restore-{$token}";
        Storage::putFileAs(dirname($storageRel), $file, basename($storageRel));

        $localPath = Storage::path($storageRel);
        $tmpHost = '/tmp/devforge-instance-import-'.$token.($isGzip ? '.sql.gz' : '.sql');
        $tmpContainer = $tmpHost;

        try {
            instant_scp($localPath, $tmpHost, $server);
            Storage::delete($storageRel);

            $restore = $isGzip
                ? "gunzip -c {$tmpContainer} | psql -U \$POSTGRES_USER -d \${POSTGRES_DB:-\$POSTGRES_USER}"
                : "psql -U \$POSTGRES_USER -d \${POSTGRES_DB:-\$POSTGRES_USER} -f {$tmpContainer}";

            instant_remote_process([
                "docker cp {$tmpHost} {$container}:{$tmpContainer}",
                "rm -f {$tmpHost}",
                "docker exec {$container} sh -c ".escapeshellarg("{$restore}; rm -f {$tmpContainer}"),
            ], $server);
        } finally {
            if (Storage::exists($storageRel)) {
                Storage::delete($storageRel);
            }
        }

        auditLog('devforge.instance.backup_imported', [
            'database_uuid' => $database->uuid,
            'from_coolify' => $fromCoolify,
            'filename' => $file->getClientOriginalName(),
            'size' => $file->getSize(),
        ]);

        return [
            'imported' => true,
            'from_coolify' => $fromCoolify,
            'message' => $fromCoolify
                ? 'Dump Coolify importé dans la base DevForge.'
                : 'Sauvegarde d’instance importée.',
            'database' => $this->presentDatabase($database->fresh()),
        ];
    }

    /**
     * Latest successful local execution download metadata.
     *
     * @return array{execution_id: int, download_url: string, filename: string|null}
     */
    public function latestExport(): array
    {
        $database = $this->requireInstanceDatabase();
        $backup = $database->scheduledBackups()->firstOrFail();

        $execution = $backup->executions()
            ->whereNotNull('filename')
            ->where(function ($query): void {
                $query->where('status', 'success')
                    ->orWhere('status', 'finished')
                    ->orWhereNull('status');
            })
            ->orderByDesc('created_at')
            ->first();

        if (! $execution) {
            $execution = $backup->executions()
                ->whereNotNull('filename')
                ->orderByDesc('created_at')
                ->first();
        }

        if (! $execution) {
            throw new HttpException(
                404,
                'Aucune sauvegarde locale à exporter. Lancez d’abord une sauvegarde (éventuellement vers S3 + local).',
            );
        }

        return [
            'execution_id' => $execution->id,
            'download_url' => url('/download/backup/'.$execution->id),
            'filename' => $execution->filename,
            'created_at' => $execution->created_at?->toIso8601String(),
        ];
    }

    public function findInstanceDatabase(): ?StandalonePostgresql
    {
        return StandalonePostgresql::query()
            ->where(function ($query): void {
                $query->where('id', 0)
                    ->orWhereIn('name', self::INSTANCE_DATABASE_NAMES);
            })
            ->orderBy('id')
            ->first();
    }

    private function requireInstanceDatabase(): StandalonePostgresql
    {
        $database = $this->findInstanceDatabase();

        if (! $database) {
            throw new HttpException(404, 'Sauvegarde d’instance non initialisée.');
        }

        return $database;
    }

    /**
     * @return array<string, mixed>
     */
    private function presentDatabase(StandalonePostgresql $database): array
    {
        return [
            'uuid' => $database->uuid,
            'name' => $database->name,
            'description' => $database->description,
            'postgres_user' => $database->postgres_user,
            'postgres_password' => $database->postgres_password,
            'postgres_db' => $database->postgres_db,
            'status' => $database->status,
        ];
    }

    private function resolveContainerName(Server $server, ?string $preferred = null): string
    {
        $candidates = $preferred
            ? array_values(array_unique([$preferred, ...self::CONTAINER_CANDIDATES]))
            : self::CONTAINER_CANDIDATES;

        foreach ($candidates as $name) {
            if ($this->containerExists($server, $name)) {
                return $name;
            }
        }

        throw new HttpException(
            422,
            'Conteneur Postgres d’instance introuvable (cherché : '.implode(', ', $candidates).').',
        );
    }

    private function containerExists(Server $server, string $name): bool
    {
        try {
            $result = instant_remote_process(
                ['docker inspect -f "{{.State.Running}}" '.escapeshellarg($name).' 2>/dev/null || true'],
                $server,
            );

            return trim((string) $result) === 'true';
        } catch (\Throwable) {
            return false;
        }
    }

    private function detectLegacyCoolifyContainer(?Server $server): bool
    {
        if (! $server) {
            return false;
        }

        return $this->containerExists($server, 'coolify-db');
    }

    /**
     * @return array<string, mixed>
     */
    private function syncCredentialsFromContainer(Server $server): array
    {
        $container = $this->resolveContainerName($server, 'coolify-db');
        $out = instant_remote_process(['docker inspect '.escapeshellarg($container)], $server);
        $envs = format_docker_envs_to_json($out);
        $database = $this->requireInstanceDatabase();

        $database->update([
            'description' => $database->description ?: 'Base de données DevForge (migrée depuis Coolify)',
            'postgres_user' => $envs['POSTGRES_USER'] ?? $database->postgres_user,
            'postgres_password' => $envs['POSTGRES_PASSWORD'] ?? $database->postgres_password,
            'postgres_db' => $envs['POSTGRES_DB'] ?? $database->postgres_db,
            'status' => 'running',
        ]);

        return array_merge($this->show(), [
            'migrated' => true,
            'message' => 'Identifiants synchronisés depuis le conteneur Coolify/DevForge.',
        ]);
    }
}
