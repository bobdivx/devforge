<?php

namespace App\Services\DevForge\Backup;

use App\Models\ScheduledDatabaseBackup;
use App\Models\ScheduledDatabaseBackupExecution;
use Carbon\CarbonInterface;
use Illuminate\Support\Carbon;

class BackupPresenter
{
    private function iso8601(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        if ($value instanceof CarbonInterface) {
            return $value->toIso8601String();
        }

        return Carbon::parse($value)->toIso8601String();
    }

    /**
     * @return array<string, mixed>
     */
    public function backup(ScheduledDatabaseBackup $backup): array
    {
        $backup->loadMissing(['s3', 'latest_log']);

        return [
            'uuid' => $backup->uuid,
            'enabled' => (bool) $backup->enabled,
            'frequency' => $backup->frequency,
            'save_s3' => (bool) $backup->save_s3,
            'disable_local_backup' => (bool) $backup->disable_local_backup,
            'dump_all' => (bool) $backup->dump_all,
            'databases_to_backup' => $backup->databases_to_backup,
            'timeout' => (int) $backup->timeout,
            's3_storage' => $backup->s3 ? [
                'uuid' => $backup->s3->uuid,
                'name' => $backup->s3->name,
            ] : null,
            'retention' => [
                'local' => [
                    'amount' => (int) $backup->database_backup_retention_amount_locally,
                    'days' => (int) $backup->database_backup_retention_days_locally,
                    'max_storage_gb' => (float) $backup->database_backup_retention_max_storage_locally,
                ],
                's3' => [
                    'amount' => (int) $backup->database_backup_retention_amount_s3,
                    'days' => (int) $backup->database_backup_retention_days_s3,
                    'max_storage_gb' => (float) $backup->database_backup_retention_max_storage_s3,
                ],
            ],
            'latest_execution' => $backup->latest_log
                ? $this->execution($backup->latest_log)
                : null,
            'created_at' => $this->iso8601($backup->created_at),
            'updated_at' => $this->iso8601($backup->updated_at),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function execution(ScheduledDatabaseBackupExecution $execution): array
    {
        return [
            'uuid' => $execution->uuid,
            'status' => $execution->status,
            'message' => $execution->message,
            'size' => (int) $execution->size,
            'filename' => $execution->filename,
            'database_name' => $execution->database_name,
            's3_uploaded' => $execution->s3_uploaded,
            'local_storage_deleted' => (bool) $execution->local_storage_deleted,
            'created_at' => $this->iso8601($execution->created_at),
            'finished_at' => $this->iso8601($execution->finished_at),
        ];
    }

}
