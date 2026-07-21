<?php

namespace App\Services\DevForge\Service;

use App\Models\LocalFileVolume;
use App\Models\LocalPersistentVolume;
use App\Models\Service;
use App\Models\ServiceApplication;
use App\Models\ServiceDatabase;

class ServiceStorageCatalog
{
    /**
     * @return array{
     *     compose_managed: bool,
     *     is_swarm: bool,
     *     groups: list<array{
     *         child_uuid: string,
     *         child_name: string,
     *         child_type: 'application'|'database',
     *         storages: list<array<string, mixed>>
     *     }>
     * }
     */
    public function list(Service $service): array
    {
        $service->loadMissing([
            'applications.persistentStorages.resource',
            'applications.fileStorages.resource',
            'databases.persistentStorages.resource',
            'databases.fileStorages.resource',
        ]);

        $groups = [];

        foreach ($service->applications->sortBy('name') as $application) {
            $groups[] = $this->presentGroup($application, 'application');
        }

        foreach ($service->databases->sortBy('name') as $database) {
            $groups[] = $this->presentGroup($database, 'database');
        }

        return [
            'compose_managed' => true,
            'is_swarm' => false,
            'groups' => array_values(array_filter(
                $groups,
                fn (array $group): bool => $group['storages'] !== []
            )),
        ];
    }

    /**
     * @return array{
     *     child_uuid: string,
     *     child_name: string,
     *     child_type: 'application'|'database',
     *     storages: list<array<string, mixed>>
     * }
     */
    private function presentGroup(ServiceApplication|ServiceDatabase $child, string $childType): array
    {
        $persistent = $child->persistentStorages
            ->sortBy('id')
            ->map(fn (LocalPersistentVolume $storage): array => $this->presentPersistent($storage))
            ->values()
            ->all();

        $files = $child->fileStorages
            ->sortBy('id')
            ->map(fn (LocalFileVolume $storage): array => $this->presentFile($storage))
            ->values()
            ->all();

        return [
            'child_uuid' => $child->uuid,
            'child_name' => $child->name,
            'child_type' => $childType,
            'storages' => array_values([...$persistent, ...$files]),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function presentPersistent(LocalPersistentVolume $storage): array
    {
        $storage->loadMissing('resource');

        return [
            'uuid' => $storage->uuid,
            'type' => 'persistent',
            'name' => $storage->name,
            'mount_path' => $storage->mount_path,
            'host_path' => $storage->host_path,
            'is_preview_suffix_enabled' => (bool) $storage->is_preview_suffix_enabled,
            'read_only' => true,
            'created_at' => $storage->created_at?->toIso8601String(),
            'updated_at' => $storage->updated_at?->toIso8601String(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function presentFile(LocalFileVolume $storage): array
    {
        $storage->loadMissing('resource');
        $rawContent = $storage->getRawOriginal('content');

        return [
            'uuid' => $storage->uuid,
            'type' => 'file',
            'fs_path' => $storage->fs_path,
            'mount_path' => $storage->mount_path,
            'is_directory' => (bool) $storage->is_directory,
            'is_preview_suffix_enabled' => (bool) $storage->is_preview_suffix_enabled,
            'has_content' => filled($rawContent)
                && $rawContent !== LocalFileVolume::BINARY_PLACEHOLDER
                && $rawContent !== LocalFileVolume::TOO_LARGE_PLACEHOLDER,
            'is_binary' => (bool) $storage->is_binary,
            'is_too_large' => (bool) $storage->is_too_large,
            'read_only' => true,
            'created_at' => $storage->created_at?->toIso8601String(),
            'updated_at' => $storage->updated_at?->toIso8601String(),
        ];
    }
}
