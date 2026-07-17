<?php

namespace App\Services\DevForge\Backup;

use App\Jobs\DatabaseBackupJob;
use App\Models\ScheduledDatabaseBackup;
use App\Models\ScheduledDatabaseBackupExecution;
use App\Models\S3Storage;
use App\Models\StandaloneClickhouse;
use App\Models\StandaloneDragonfly;
use App\Models\StandaloneKeydb;
use App\Models\StandaloneLibsql;
use App\Models\StandaloneRedis;
use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\Core\CoreResourceCatalog;
use App\Services\DevForge\CurrentTeamContext;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;

class DatabaseBackupService
{
    /**
     * @var list<class-string<Model>>
     */
    private const UNSUPPORTED_DATABASE_TYPES = [
        StandaloneRedis::class,
        StandaloneKeydb::class,
        StandaloneDragonfly::class,
        StandaloneClickhouse::class,
        StandaloneLibsql::class,
    ];

    public function __construct(
        private readonly CurrentTeamContext $currentTeamContext,
        private readonly CoreResourceCatalog $catalog,
        private readonly BackupPresenter $presenter,
    ) {}

    /**
     * @return array<int, array<string, mixed>>
     */
    public function list(User $user, string $databaseUuid): array
    {
        $database = $this->resolveDatabase($user, $databaseUuid);
        $team = $this->currentTeamContext->resolve($user);

        return ScheduledDatabaseBackup::ownedByCurrentTeamAPI($team->id)
            ->with(['s3', 'latest_log'])
            ->where('database_id', $database->id)
            ->where('database_type', $database->getMorphClass())
            ->orderByDesc('created_at')
            ->get()
            ->map(fn (ScheduledDatabaseBackup $backup): array => $this->presenter->backup($backup))
            ->all();
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public function create(User $user, string $databaseUuid, array $input): array
    {
        $database = $this->resolveDatabase($user, $databaseUuid);
        $this->assertSupportsBackups($database);

        $team = $this->currentTeamContext->resolve($user);
        $validated = $this->validateBackupInput($input, creating: true);
        $this->validateS3Selection($team, $validated);

        $backupData = $this->buildBackupPayload($team, $database, $validated);
        $backup = ScheduledDatabaseBackup::create($backupData);

        if (! empty($validated['backup_now'])) {
            dispatch(new DatabaseBackupJob($backup));
        }

        auditLog('devforge.database.backup_created', [
            'team_id' => $team->id,
            'database_uuid' => $database->uuid,
            'backup_uuid' => $backup->uuid,
            'save_s3' => (bool) $backup->save_s3,
        ]);

        return $this->presenter->backup($backup->load(['s3', 'latest_log']));
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public function update(User $user, string $databaseUuid, string $backupUuid, array $input): array
    {
        $database = $this->resolveDatabase($user, $databaseUuid);
        $team = $this->currentTeamContext->resolve($user);
        $backup = $this->resolveBackup($team, $database, $backupUuid);

        $validated = $this->validateBackupInput($input, creating: false);
        $this->validateS3Selection($team, $validated, $backup);

        $payload = $this->buildBackupPayload($team, $database, $validated, $backup);
        $backup->update($payload);

        if (! empty($validated['backup_now'])) {
            dispatch(new DatabaseBackupJob($backup->fresh()));
        }

        auditLog('devforge.database.backup_updated', [
            'team_id' => $team->id,
            'database_uuid' => $database->uuid,
            'backup_uuid' => $backup->uuid,
        ]);

        return $this->presenter->backup($backup->fresh(['s3', 'latest_log']));
    }

    public function delete(User $user, string $databaseUuid, string $backupUuid, bool $deleteS3 = false): void
    {
        $database = $this->resolveDatabase($user, $databaseUuid);
        $team = $this->currentTeamContext->resolve($user);
        $backup = $this->resolveBackup($team, $database, $backupUuid);

        DB::transaction(function () use ($backup, $database, $deleteS3): void {
            $executions = $backup->executions()->get();

            foreach ($executions as $execution) {
                if ($execution->filename) {
                    deleteBackupsLocally($execution->filename, $database->destination->server);

                    if ($deleteS3 && $backup->s3) {
                        deleteBackupsS3($execution->filename, $backup->s3);
                    }
                }

                $execution->delete();
            }

            $backup->delete();
        });

        auditLog('devforge.database.backup_deleted', [
            'team_id' => $team->id,
            'database_uuid' => $database->uuid,
            'backup_uuid' => $backupUuid,
            'delete_s3' => $deleteS3,
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    public function run(User $user, string $databaseUuid, string $backupUuid): array
    {
        $database = $this->resolveDatabase($user, $databaseUuid);
        $team = $this->currentTeamContext->resolve($user);
        $backup = $this->resolveBackup($team, $database, $backupUuid);

        dispatch(new DatabaseBackupJob($backup));

        auditLog('devforge.database.backup_run', [
            'team_id' => $team->id,
            'database_uuid' => $database->uuid,
            'backup_uuid' => $backup->uuid,
        ]);

        return [
            'queued' => true,
            'message' => 'Sauvegarde planifiée en file d’attente.',
        ];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function executions(User $user, string $databaseUuid, string $backupUuid): array
    {
        $database = $this->resolveDatabase($user, $databaseUuid);
        $team = $this->currentTeamContext->resolve($user);
        $backup = $this->resolveBackup($team, $database, $backupUuid);

        return $backup->executions()
            ->orderByDesc('created_at')
            ->get()
            ->map(fn (ScheduledDatabaseBackupExecution $execution): array => $this->presenter->execution($execution))
            ->all();
    }

    public function deleteExecution(
        User $user,
        string $databaseUuid,
        string $backupUuid,
        string $executionUuid,
        bool $deleteS3 = false,
    ): void {
        $database = $this->resolveDatabase($user, $databaseUuid);
        $team = $this->currentTeamContext->resolve($user);
        $backup = $this->resolveBackup($team, $database, $backupUuid);

        $execution = $backup->executions()
            ->where('uuid', $executionUuid)
            ->firstOrFail();

        if ($execution->filename) {
            deleteBackupsLocally($execution->filename, $database->destination->server);

            if ($deleteS3 && $backup->s3) {
                deleteBackupsS3($execution->filename, $backup->s3);
            }
        }

        $execution->delete();

        auditLog('devforge.database.backup_execution_deleted', [
            'team_id' => $team->id,
            'database_uuid' => $database->uuid,
            'backup_uuid' => $backup->uuid,
            'execution_uuid' => $executionUuid,
            'delete_s3' => $deleteS3,
        ]);
    }

    public function supportsBackups(Model $database): bool
    {
        return ! in_array($database->getMorphClass(), self::UNSUPPORTED_DATABASE_TYPES, true);
    }

    private function resolveDatabase(User $user, string $databaseUuid): Model
    {
        $team = $this->currentTeamContext->resolve($user);
        $database = $this->catalog->find($team, 'databases', $databaseUuid);

        if (! $database) {
            abort(404, 'Base de données introuvable.');
        }

        return $database;
    }

    private function resolveBackup(Team $team, Model $database, string $backupUuid): ScheduledDatabaseBackup
    {
        return ScheduledDatabaseBackup::ownedByCurrentTeamAPI($team->id)
            ->where('database_id', $database->id)
            ->where('database_type', $database->getMorphClass())
            ->where('uuid', $backupUuid)
            ->firstOrFail();
    }

    private function assertSupportsBackups(Model $database): void
    {
        if (! $this->supportsBackups($database)) {
            throw new HttpException(422, 'Les sauvegardes planifiées ne sont pas prises en charge pour ce type de base.');
        }
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    private function validateBackupInput(array $input, bool $creating): array
    {
        $validator = Validator::make($input, [
            'frequency' => [$creating ? 'required' : 'sometimes', 'string'],
            'enabled' => ['sometimes', 'boolean'],
            'save_s3' => ['sometimes', 'boolean'],
            'disable_local_backup' => ['sometimes', 'boolean'],
            'dump_all' => ['sometimes', 'boolean'],
            'backup_now' => ['sometimes', 'boolean'],
            's3_storage_uuid' => ['nullable', 'string', 'exists:s3_storages,uuid'],
            'databases_to_backup' => ['nullable', 'string'],
            'database_backup_retention_amount_locally' => ['sometimes', 'integer', 'min:0'],
            'database_backup_retention_days_locally' => ['sometimes', 'integer', 'min:0'],
            'database_backup_retention_max_storage_locally' => ['sometimes', 'numeric', 'min:0'],
            'database_backup_retention_amount_s3' => ['sometimes', 'integer', 'min:0'],
            'database_backup_retention_days_s3' => ['sometimes', 'integer', 'min:0'],
            'database_backup_retention_max_storage_s3' => ['sometimes', 'numeric', 'min:0'],
            'timeout' => ['sometimes', 'integer', 'min:60', 'max:36000'],
        ]);

        if ($validator->fails()) {
            throw ValidationException::withMessages($validator->errors()->toArray());
        }

        /** @var array<string, mixed> $validated */
        $validated = $validator->validated();

        if (! empty($validated['frequency']) && ! validate_cron_expression((string) $validated['frequency'])) {
            throw ValidationException::withMessages([
                'frequency' => ['Expression cron ou fréquence invalide.'],
            ]);
        }

        if (! empty($validated['databases_to_backup'])) {
            try {
                validateDatabasesBackupInput((string) $validated['databases_to_backup']);
            } catch (\Exception $e) {
                throw ValidationException::withMessages([
                    'databases_to_backup' => [$e->getMessage()],
                ]);
            }
        }

        return $validated;
    }

    /**
     * @param  array<string, mixed>  $validated
     */
    private function validateS3Selection(Team $team, array $validated, ?ScheduledDatabaseBackup $existing = null): void
    {
        $saveS3 = array_key_exists('save_s3', $validated)
            ? (bool) $validated['save_s3']
            : (bool) ($existing?->save_s3 ?? false);

        if ($saveS3) {
            $storageUuid = $validated['s3_storage_uuid'] ?? $existing?->s3?->uuid;

            if (! $storageUuid) {
                throw ValidationException::withMessages([
                    's3_storage_uuid' => ['Une destination S3 est requise lorsque save_s3 est activé.'],
                ]);
            }

            $exists = S3Storage::ownedByCurrentTeamAPI($team->id)
                ->where('uuid', $storageUuid)
                ->exists();

            if (! $exists) {
                throw ValidationException::withMessages([
                    's3_storage_uuid' => ['La destination S3 sélectionnée est invalide pour cette équipe.'],
                ]);
            }
        }
    }

    /**
     * @param  array<string, mixed>  $validated
     * @return array<string, mixed>
     */
    private function buildBackupPayload(
        Team $team,
        Model $database,
        array $validated,
        ?ScheduledDatabaseBackup $existing = null,
    ): array {
        $payload = collect($validated)
            ->except(['backup_now', 's3_storage_uuid'])
            ->all();

        if (isset($validated['s3_storage_uuid'])) {
            $s3Storage = S3Storage::ownedByCurrentTeamAPI($team->id)
                ->where('uuid', $validated['s3_storage_uuid'])
                ->first();

            $payload['s3_storage_id'] = $s3Storage?->id;
        }

        if ($existing === null) {
            $payload['database_id'] = $database->id;
            $payload['database_type'] = $database->getMorphClass();
            $payload['team_id'] = $team->id;
            $payload['enabled'] ??= true;

            if (empty($payload['databases_to_backup'])) {
                $payload['databases_to_backup'] = $this->defaultDatabasesToBackup($database);
            }
        }

        return $payload;
    }

    private function defaultDatabasesToBackup(Model $database): ?string
    {
        return match ($database->type()) {
            'standalone-postgresql' => $database->postgres_db,
            'standalone-mysql' => $database->mysql_database,
            'standalone-mariadb' => $database->mariadb_database,
            default => null,
        };
    }

}
