<?php

namespace App\Services\DevForge\Database;

use App\Models\LocalFileVolume;
use App\Models\LocalPersistentVolume;
use App\Support\ValidationPatterns;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;

class DatabaseStorageCatalog
{
    /**
     * @return array{compose_managed: bool, is_swarm: bool, storages: array<int, array<string, mixed>>}
     */
    public function list(Model $database): array
    {
        $database->loadMissing(['persistentStorages.resource', 'fileStorages.resource']);

        $persistent = $database->persistentStorages
            ->sortBy('id')
            ->map(fn (LocalPersistentVolume $storage): array => $this->presentPersistent($storage))
            ->values()
            ->all();

        $files = $database->fileStorages
            ->sortBy('id')
            ->map(fn (LocalFileVolume $storage): array => $this->presentFile($storage))
            ->values()
            ->all();

        return [
            'compose_managed' => false,
            'is_swarm' => false,
            'storages' => array_values([...$persistent, ...$files]),
        ];
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public function store(Model $database, array $input): array
    {
        $validated = validator($input, [
            'type' => ['required', 'string', 'in:persistent,file'],
            'name' => ValidationPatterns::volumeNameRules(required: false),
            'mount_path' => ['required', 'string'],
            'host_path' => ['nullable', 'string', 'regex:'.ValidationPatterns::DIRECTORY_PATH_PATTERN],
            'content' => ['nullable', 'string'],
            'is_directory' => ['sometimes', 'boolean'],
            'fs_path' => ['nullable', 'string'],
        ], array_merge(ValidationPatterns::volumeNameMessages(), [
            'host_path.regex' => 'Le chemin hôte doit commencer par / et ne contenir que des caractères sûrs.',
        ]))->validate();

        if ($validated['type'] === 'persistent') {
            return $this->storePersistent($database, $validated);
        }

        return $this->storeFile($database, $validated);
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public function update(Model $database, string $storageUuid, array $input): array
    {
        [$storage, $type] = $this->findStorage($database, $storageUuid);

        $validated = validator($input, [
            'is_preview_suffix_enabled' => ['sometimes', 'boolean'],
            'name' => ValidationPatterns::volumeNameRules(required: false),
            'mount_path' => ['sometimes', 'string'],
            'host_path' => ['sometimes', 'nullable', 'string', 'regex:'.ValidationPatterns::DIRECTORY_PATH_PATTERN],
            'content' => ['sometimes', 'nullable', 'string'],
        ], array_merge(ValidationPatterns::volumeNameMessages(), [
            'host_path.regex' => 'Le chemin hôte doit commencer par / et ne contenir que des caractères sûrs.',
        ]))->validate();

        if ($validated === []) {
            throw ValidationException::withMessages([
                'input' => 'Au moins un champ doit être fourni.',
            ]);
        }

        $storage->loadMissing('resource');
        $isReadOnly = $storage->shouldBeReadOnlyInUI();
        $editableOnlyFields = ['name', 'mount_path', 'host_path', 'content'];
        $requestedEditable = array_values(array_intersect($editableOnlyFields, array_keys($validated)));

        if ($isReadOnly && $requestedEditable !== []) {
            throw ValidationException::withMessages([
                'storage' => 'Ce storage est en lecture seule. Seul is_preview_suffix_enabled peut être modifié.',
            ]);
        }

        if (! $isReadOnly) {
            $invalid = $type === 'persistent'
                ? array_intersect(['content'], array_keys($validated))
                : array_intersect(['name', 'host_path'], array_keys($validated));

            if ($invalid !== []) {
                throw ValidationException::withMessages(
                    collect($invalid)->mapWithKeys(
                        fn (string $field): array => [$field => "Le champ « {$field} » n’est pas valide pour le type « {$type} »."]
                    )->all()
                );
            }
        }

        if (array_key_exists('is_preview_suffix_enabled', $validated)) {
            $storage->is_preview_suffix_enabled = (bool) $validated['is_preview_suffix_enabled'];
        }

        if (! $isReadOnly) {
            if ($type === 'persistent') {
                if (array_key_exists('name', $validated) && filled($validated['name'])) {
                    $storage->name = $this->normalizePersistentName($database, (string) $validated['name']);
                }
                if (array_key_exists('mount_path', $validated)) {
                    $storage->mount_path = $validated['mount_path'];
                }
                if (array_key_exists('host_path', $validated)) {
                    $storage->host_path = $validated['host_path'];
                }
            } else {
                if (array_key_exists('mount_path', $validated)) {
                    $storage->mount_path = $validated['mount_path'];
                }
                if (array_key_exists('content', $validated)) {
                    $storage->content = $validated['content'];
                }
            }
        }

        $storage->save();

        return $type === 'persistent'
            ? $this->presentPersistent($storage->fresh(['resource']))
            : $this->presentFile($storage->fresh(['resource']));
    }

    public function destroy(Model $database, string $storageUuid): void
    {
        [$storage] = $this->findStorage($database, $storageUuid);
        $storage->loadMissing('resource');

        if ($storage->shouldBeReadOnlyInUI()) {
            throw ValidationException::withMessages([
                'storage' => 'Ce storage est en lecture seule et ne peut pas être supprimé.',
            ]);
        }

        if ($storage instanceof LocalFileVolume) {
            $storage->deleteStorageOnServer();
        }

        $storage->delete();
    }

    /**
     * @param  array<string, mixed>  $validated
     * @return array<string, mixed>
     */
    private function storePersistent(Model $database, array $validated): array
    {
        if (! filled($validated['name'] ?? null)) {
            throw ValidationException::withMessages([
                'name' => 'Le nom est obligatoire pour un volume persistant.',
            ]);
        }

        if (array_key_exists('content', $validated) || array_key_exists('is_directory', $validated) || array_key_exists('fs_path', $validated)) {
            throw ValidationException::withMessages([
                'type' => 'Les champs content / is_directory / fs_path ne sont pas valides pour un volume persistant.',
            ]);
        }

        $storage = LocalPersistentVolume::query()->create([
            'name' => $this->normalizePersistentName($database, (string) $validated['name']),
            'mount_path' => $validated['mount_path'],
            'host_path' => $validated['host_path'] ?? null,
            'resource_id' => $database->getKey(),
            'resource_type' => $database->getMorphClass(),
        ]);

        return $this->presentPersistent($storage->load('resource'));
    }

    /**
     * @param  array<string, mixed>  $validated
     * @return array<string, mixed>
     */
    private function storeFile(Model $database, array $validated): array
    {
        if (array_key_exists('name', $validated) || array_key_exists('host_path', $validated)) {
            throw ValidationException::withMessages([
                'type' => 'Les champs name / host_path ne sont pas valides pour un file mount.',
            ]);
        }

        $isDirectory = (bool) ($validated['is_directory'] ?? false);
        $mountPath = str($validated['mount_path'])->trim()->start('/')->value();
        validateShellSafePath($mountPath, 'file storage path');

        if ($isDirectory) {
            if (! filled($validated['fs_path'] ?? null)) {
                throw ValidationException::withMessages([
                    'fs_path' => 'Le chemin hôte (fs_path) est obligatoire pour un montage de répertoire.',
                ]);
            }

            $fsPath = str($validated['fs_path'])->trim()->start('/')->value();
            validateShellSafePath($fsPath, 'storage source path');

            $storage = LocalFileVolume::query()->create([
                'fs_path' => $fsPath,
                'mount_path' => $mountPath,
                'is_directory' => true,
                'resource_id' => $database->getKey(),
                'resource_type' => get_class($database),
            ]);
        } else {
            $fsPath = database_configuration_dir().'/'.$database->uuid.$mountPath;

            $storage = LocalFileVolume::query()->create([
                'fs_path' => $fsPath,
                'mount_path' => $mountPath,
                'content' => $validated['content'] ?? null,
                'is_directory' => false,
                'resource_id' => $database->getKey(),
                'resource_type' => get_class($database),
            ]);
        }

        return $this->presentFile($storage->load('resource'));
    }

    /**
     * @return array{0: LocalPersistentVolume|LocalFileVolume, 1: 'persistent'|'file'}
     */
    private function findStorage(Model $database, string $storageUuid): array
    {
        $persistent = $database->persistentStorages()->where('uuid', $storageUuid)->first();
        if ($persistent) {
            return [$persistent, 'persistent'];
        }

        $file = $database->fileStorages()->where('uuid', $storageUuid)->first();
        if ($file) {
            return [$file, 'file'];
        }

        throw new HttpException(404, 'Storage introuvable.');
    }

    private function normalizePersistentName(Model $database, string $name): string
    {
        $trimmed = trim($name);
        $prefix = $database->uuid.'-';

        if (str($trimmed)->startsWith($prefix)) {
            return $trimmed;
        }

        return $prefix.$trimmed;
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
            'read_only' => $storage->shouldBeReadOnlyInUI(),
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
            'read_only' => $storage->shouldBeReadOnlyInUI(),
            'created_at' => $storage->created_at?->toIso8601String(),
            'updated_at' => $storage->updated_at?->toIso8601String(),
        ];
    }
}
