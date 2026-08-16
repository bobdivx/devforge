<?php

namespace App\Services\DevForge\Backup;

use App\Models\S3Storage;
use App\Models\ScheduledDatabaseBackup;
use App\Models\Team;
use App\Services\DevForge\S3\S3EndpointNormalizer;
use Illuminate\Support\Facades\Log;

class EnsureInstanceS3Backup
{
    public const STORAGE_UUID_PREFIX = 'devforge-backup-s3';

    /**
     * @return array{
     *     status: string,
     *     message: string,
     *     storage_uuid: ?string,
     *     attached_backups: int,
     *     usable: bool
     * }
     */
    public function sync(bool $testConnection = true): array
    {
        if (! config('devforge.backup_s3.enabled')) {
            return $this->result('skipped', 'Sauvegardes S3 désactivées (DEVFORGE_BACKUP_S3_ENABLED).');
        }

        $key = trim((string) config('devforge.backup_s3.key'));
        $secret = trim((string) config('devforge.backup_s3.secret'));

        if ($key === '' || $secret === '') {
            return $this->result('error', 'Clés S3 manquantes (DEVFORGE_BACKUP_S3_KEY / DEVFORGE_BACKUP_S3_SECRET).');
        }

        $normalized = S3EndpointNormalizer::normalize(
            (string) config('devforge.backup_s3.endpoint'),
            (string) config('devforge.backup_s3.bucket'),
            (string) config('devforge.backup_s3.region'),
        );

        $bucket = (string) ($normalized['bucket'] ?? '');
        $endpoint = (string) $normalized['endpoint'];
        $region = (string) ($normalized['region'] ?? 'fr-par');

        if ($bucket === '' || $endpoint === '') {
            return $this->result('error', 'Bucket ou endpoint S3 manquant.');
        }

        $attached = 0;
        $lastStorage = null;

        foreach ($this->targetTeamIds() as $teamId) {
            $storage = $this->upsertStorage($teamId, $key, $secret, $bucket, $endpoint, $region);

            if ($testConnection) {
                try {
                    $storage->testConnection(shouldSave: true);
                } catch (\Throwable $e) {
                    Log::warning('DevForge S3 backup connection failed', [
                        'team_id' => $teamId,
                        'error' => $e->getMessage(),
                    ]);
                    $storage->is_usable = false;
                    $storage->save();

                    continue;
                }
            } else {
                $storage->is_usable = true;
                $storage->save();
            }

            $lastStorage = $storage->fresh();

            if ($lastStorage?->is_usable) {
                $attached += $this->attachToBackups($teamId, $lastStorage);
            }
        }

        if (! $lastStorage) {
            return $this->result('error', 'Impossible de créer la destination S3.');
        }

        if (! $lastStorage->is_usable) {
            return $this->result(
                'error',
                'Destination S3 enregistrée mais la connexion a échoué. Vérifiez les clés, la région et l’endpoint.',
                $lastStorage->uuid,
                $attached,
                false,
            );
        }

        return $this->result(
            'ok',
            'Destination S3 synchronisée. Les sauvegardes planifiées enverront les dumps vers le bucket.',
            $lastStorage->uuid,
            $attached,
            true,
        );
    }

    /**
     * @return list<int>
     */
    private function targetTeamIds(): array
    {
        $ids = Team::query()->orderBy('id')->pluck('id')->map(fn ($id): int => (int) $id)->all();

        if (! in_array(0, $ids, true)) {
            array_unshift($ids, 0);
        }

        return array_values(array_unique($ids));
    }

    private function upsertStorage(
        int $teamId,
        string $key,
        string $secret,
        string $bucket,
        string $endpoint,
        string $region,
    ): S3Storage {
        $uuid = $teamId === 0
            ? self::STORAGE_UUID_PREFIX
            : self::STORAGE_UUID_PREFIX.'-team-'.$teamId;

        $storage = S3Storage::query()
            ->where('team_id', $teamId)
            ->where(function ($query) use ($uuid, $bucket, $endpoint): void {
                $query->where('uuid', $uuid)
                    ->orWhere(function ($inner) use ($bucket, $endpoint): void {
                        $inner->where('bucket', $bucket)->where('endpoint', $endpoint);
                    });
            })
            ->first();

        if (! $storage) {
            $storage = new S3Storage;
            $storage->uuid = $uuid;
            $storage->team_id = $teamId;
            $storage->is_usable = false;
        }

        $storage->name = (string) config('devforge.backup_s3.name');
        $storage->description = 'Provisionné depuis DEVFORGE_BACKUP_S3_* (survits à une recréation de base).';
        $storage->key = $key;
        $storage->secret = $secret;
        $storage->bucket = $bucket;
        $storage->endpoint = $endpoint;
        $storage->region = $region;
        $storage->save();

        return $storage;
    }

    private function attachToBackups(int $teamId, S3Storage $storage): int
    {
        $query = ScheduledDatabaseBackup::query()->whereNull('s3_storage_id');

        if ($teamId === 0) {
            $query->where(function ($inner): void {
                $inner->where('team_id', 0)->orWhere('id', 0);
            });
        } else {
            $query->where('team_id', $teamId);
        }

        return $query->update([
            'save_s3' => true,
            's3_storage_id' => $storage->id,
        ]);
    }

    /**
     * @return array{
     *     status: string,
     *     message: string,
     *     storage_uuid: ?string,
     *     attached_backups: int,
     *     usable: bool
     * }
     */
    private function result(
        string $status,
        string $message,
        ?string $storageUuid = null,
        int $attached = 0,
        bool $usable = false,
    ): array {
        return [
            'status' => $status,
            'message' => $message,
            'storage_uuid' => $storageUuid,
            'attached_backups' => $attached,
            'usable' => $usable,
        ];
    }
}
