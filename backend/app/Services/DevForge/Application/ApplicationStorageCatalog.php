<?php

namespace App\Services\DevForge\Application;

use App\Models\Application;
use App\Models\LocalFileVolume;
use App\Models\LocalPersistentVolume;
use App\Support\ValidationPatterns;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;

class ApplicationStorageCatalog
{
    /**
     * @return array{compose_managed: bool, is_swarm: bool, storages: array<int, array<string, mixed>>}
     */
    public function list(Application $application): array
    {
        $application->loadMissing(['destination.server', 'persistentStorages.resource', 'fileStorages.resource']);

        $persistent = $application->persistentStorages
            ->sortBy('id')
            ->map(fn (LocalPersistentVolume $storage): array => $this->presentPersistent($storage))
            ->values()
            ->all();

        $files = $application->fileStorages
            ->sortBy('id')
            ->map(fn (LocalFileVolume $storage): array => $this->presentFile($storage))
            ->values()
            ->all();

        return [
            'compose_managed' => $this->isComposeManaged($application),
            'is_swarm' => (bool) $application->destination?->server?->isSwarm(),
            'storages' => array_values([...$persistent, ...$files]),
        ];
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public function store(Application $application, array $input): array
    {
        if ($this->isComposeManaged($application)) {
            throw ValidationException::withMessages([
                'type' => 'Les storages sont gérés via le fichier docker-compose et ne peuvent pas être créés ici.',
            ]);
        }

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

        $application->loadMissing('destination.server');
        $isSwarm = (bool) $application->destination?->server?->isSwarm();

        if ($validated['type'] === 'persistent') {
            return $this->storePersistent($application, $validated, $isSwarm);
        }

        return $this->storeFile($application, $validated);
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public function update(Application $application, string $storageUuid, array $input): array
    {
        [$storage, $type] = $this->findStorage($application, $storageUuid);

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
                    $storage->name = $this->normalizePersistentName($application, (string) $validated['name']);
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

    public function destroy(Application $application, string $storageUuid): void
    {
        [$storage] = $this->findStorage($application, $storageUuid);
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
    private function storePersistent(Application $application, array $validated, bool $isSwarm): array
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

        if ($isSwarm && blank($validated['host_path'] ?? null)) {
            throw ValidationException::withMessages([
                'host_path' => 'Le chemin hôte est obligatoire sur un serveur Swarm.',
            ]);
        }

        $storage = LocalPersistentVolume::query()->create([
            'name' => $this->normalizePersistentName($application, (string) $validated['name']),
            'mount_path' => $validated['mount_path'],
            'host_path' => $validated['host_path'] ?? null,
            'resource_id' => $application->id,
            'resource_type' => $application->getMorphClass(),
        ]);

        return $this->presentPersistent($storage->load('resource'));
    }

    /**
     * @param  array<string, mixed>  $validated
     * @return array<string, mixed>
     */
    private function storeFile(Application $application, array $validated): array
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
                'resource_id' => $application->id,
                'resource_type' => get_class($application),
            ]);
        } else {
            $fsPath = application_configuration_dir().'/'.$application->uuid.$mountPath;

            $storage = LocalFileVolume::query()->create([
                'fs_path' => $fsPath,
                'mount_path' => $mountPath,
                'content' => $validated['content'] ?? null,
                'is_directory' => false,
                'resource_id' => $application->id,
                'resource_type' => get_class($application),
            ]);
        }

        return $this->presentFile($storage->load('resource'));
    }

    /**
     * @return array{0: LocalPersistentVolume|LocalFileVolume, 1: 'persistent'|'file'}
     */
    private function findStorage(Application $application, string $storageUuid): array
    {
        $persistent = $application->persistentStorages()->where('uuid', $storageUuid)->first();
        if ($persistent) {
            return [$persistent, 'persistent'];
        }

        $file = $application->fileStorages()->where('uuid', $storageUuid)->first();
        if ($file) {
            return [$file, 'file'];
        }

        throw new HttpException(404, 'Storage introuvable.');
    }

    private function normalizePersistentName(Application $application, string $name): string
    {
        $trimmed = trim($name);
        $prefix = $application->uuid.'-';

        if (str($trimmed)->startsWith($prefix)) {
            return $trimmed;
        }

        return $prefix.$trimmed;
    }

    private function isComposeManaged(Application $application): bool
    {
        return $application->build_pack === 'dockercompose';
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
