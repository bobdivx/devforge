<?php

namespace App\Services\DevForge\S3;

use App\Models\S3Storage;

class S3StoragePresenter
{
    /**
     * @return array<string, mixed>
     */
    public function present(S3Storage $storage): array
    {
        return [
            'uuid' => $storage->uuid,
            'name' => $storage->name,
            'description' => $storage->description,
            'region' => $storage->region,
            'bucket' => $storage->bucket,
            'endpoint' => $storage->endpoint,
            'is_usable' => (bool) $storage->is_usable,
            'scheduled_backups_count' => $storage->scheduledBackups()->count(),
            'created_at' => $storage->created_at?->toIso8601String(),
            'updated_at' => $storage->updated_at?->toIso8601String(),
        ];
    }

}
