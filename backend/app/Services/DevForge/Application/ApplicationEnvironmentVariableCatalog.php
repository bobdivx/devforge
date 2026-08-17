<?php

namespace App\Services\DevForge\Application;

use App\Models\Application;
use App\Models\EnvironmentVariable;
use App\Support\ValidationPatterns;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;

class ApplicationEnvironmentVariableCatalog
{
    /**
     * @return array{production: array<int, array<string, mixed>>, preview: array<int, array<string, mixed>>}
     */
    public function list(Application $application): array
    {
        $production = $application->environment_variables()
            ->orderBy('key')
            ->get()
            ->map(fn (EnvironmentVariable $variable): array => $this->present($variable))
            ->values()
            ->all();

        $preview = $application->environment_variables_preview()
            ->orderBy('key')
            ->get()
            ->map(fn (EnvironmentVariable $variable): array => $this->present($variable))
            ->values()
            ->all();

        return [
            'production' => $production,
            'preview' => $preview,
        ];
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public function store(Application $application, array $input): array
    {
        $validated = $this->validateInput($input, creating: true);
        $isPreview = (bool) ($validated['is_preview'] ?? false);
        $key = ValidationPatterns::normalizeEnvironmentVariableKey($validated['key']);

        $collection = $isPreview
            ? $application->environment_variables_preview
            : $application->environment_variables;

        if ($collection->contains('key', $key)) {
            throw ValidationException::withMessages([
                'key' => 'Cette variable existe déjà. Utilisez la mise à jour pour la modifier.',
            ]);
        }

        [$value, $isMultiline] = $this->normalizeStoredValue(
            $validated['value'] ?? null,
            (bool) ($validated['is_multiline'] ?? false),
        );

        $variable = $application->environment_variables()->create([
            'key' => $key,
            'value' => $value,
            'is_preview' => $isPreview,
            'is_literal' => (bool) ($validated['is_literal'] ?? false),
            'is_multiline' => $isMultiline,
            'is_shown_once' => (bool) ($validated['is_shown_once'] ?? false),
            'is_runtime' => (bool) ($validated['is_runtime'] ?? true),
            'is_buildtime' => (bool) ($validated['is_buildtime'] ?? true),
            'comment' => $validated['comment'] ?? null,
            'resourceable_type' => Application::class,
            'resourceable_id' => $application->id,
        ]);

        return $this->present($variable->fresh());
    }

    /**
     * Crée ou met à jour une variable DevForge (préféré à un fichier .env Git).
     *
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public function upsert(Application $application, array $input): array
    {
        $validated = $this->validateInput($input, creating: true);
        $isPreview = (bool) ($validated['is_preview'] ?? false);
        $key = $validated['key'];

        $existing = ($isPreview
            ? $application->environment_variables_preview()
            : $application->environment_variables()
        )->where('key', $key)->first();

        if ($existing instanceof EnvironmentVariable) {
            return $this->update($application, $existing->uuid, $validated);
        }

        return $this->store($application, $validated);
    }

    /**
     * Importe un fichier .env (contenu texte) dans le scope production ou preview.
     *
     * @param  array<string, mixed>  $input
     * @return array{
     *     created: int,
     *     updated: int,
     *     skipped: array<int, array{key: string, reason: string}>,
     *     variables: array{production: array<int, array<string, mixed>>, preview: array<int, array<string, mixed>>}
     * }
     */
    public function import(Application $application, array $input): array
    {
        $validated = validator($input, [
            'contents' => ['required', 'string', 'max:262144'],
            'is_preview' => ['sometimes', 'boolean'],
        ])->validate();

        $isPreview = (bool) ($validated['is_preview'] ?? false);
        $parsed = parseEnvFormatToArray($validated['contents']);

        if ($parsed === []) {
            throw ValidationException::withMessages([
                'contents' => 'Aucune variable KEY=VALUE n’a été trouvée dans ce fichier.',
            ]);
        }

        if (count($parsed) > 500) {
            throw ValidationException::withMessages([
                'contents' => 'Ce fichier contient trop de variables (maximum 500).',
            ]);
        }

        $created = 0;
        $updated = 0;
        $skipped = [];

        DB::transaction(function () use ($application, $parsed, $isPreview, &$created, &$updated, &$skipped): void {
            foreach ($parsed as $rawKey => $entry) {
                $key = $this->normalizeImportedKey((string) $rawKey);

                if ($key === '' || ! ValidationPatterns::isValidEnvironmentVariableKey($key)) {
                    $skipped[] = ['key' => (string) $rawKey, 'reason' => 'invalid_key'];

                    continue;
                }

                $value = is_array($entry) ? (string) ($entry['value'] ?? '') : (string) $entry;
                $comment = is_array($entry) ? ($entry['comment'] ?? null) : null;
                $payload = [
                    'key' => $key,
                    'value' => $value,
                    'comment' => is_string($comment) && $comment !== '' ? mb_substr($comment, 0, 256) : null,
                    'is_preview' => $isPreview,
                    'is_runtime' => true,
                    'is_buildtime' => true,
                    'is_multiline' => str_contains($value, "\n") || str_contains($value, "\r"),
                    'is_literal' => false,
                ];

                $existing = ($isPreview
                    ? $application->environment_variables_preview()
                    : $application->environment_variables()
                )->where('key', $key)->first();

                try {
                    if ($existing instanceof EnvironmentVariable) {
                        if (! $this->isEditable($existing)) {
                            $skipped[] = ['key' => $key, 'reason' => 'protected'];

                            continue;
                        }

                        $this->update($application, $existing->uuid, $payload);
                        $updated++;

                        continue;
                    }

                    $this->store($application, $payload);
                    $created++;
                } catch (ValidationException) {
                    $skipped[] = ['key' => $key, 'reason' => 'invalid'];
                }
            }
        });

        return [
            'created' => $created,
            'updated' => $updated,
            'skipped' => $skipped,
            'variables' => $this->list($application->fresh()),
        ];
    }

    private function normalizeImportedKey(string $rawKey): string
    {
        $key = trim($rawKey);

        if (str_starts_with(strtolower($key), 'export ')) {
            $key = trim(substr($key, 7));
        }

        return ValidationPatterns::normalizeEnvironmentVariableKey($key);
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public function update(Application $application, string $envUuid, array $input): array
    {
        $variable = $this->findVariable($application, $envUuid);
        $this->assertEditable($variable);

        $validated = $this->validateInput($input, creating: false);

        if (array_key_exists('value', $validated)) {
            $isMultiline = array_key_exists('is_multiline', $validated)
                ? (bool) $validated['is_multiline']
                : (bool) $variable->is_multiline;

            [$value, $isMultiline] = $this->normalizeStoredValue($validated['value'], $isMultiline);
            $variable->value = $value;
            $variable->is_multiline = $isMultiline;
            unset($validated['is_multiline']);
        }

        foreach (['is_literal', 'is_multiline', 'is_runtime', 'is_buildtime'] as $flag) {
            if (array_key_exists($flag, $validated)) {
                $variable->{$flag} = (bool) $validated[$flag];
            }
        }

        if (array_key_exists('comment', $validated)) {
            $variable->comment = $validated['comment'];
        }

        $variable->save();

        return $this->present($variable->fresh());
    }

    public function destroy(Application $application, string $envUuid): void
    {
        $variable = $this->findVariable($application, $envUuid);
        $this->assertDeletable($variable);

        $variable->forceDelete();
    }

    /**
     * @return array{uuid: string, value: string|null}
     */
    public function reveal(Application $application, string $envUuid): array
    {
        $variable = $this->findVariable($application, $envUuid);

        if ($variable->is_shown_once) {
            throw new HttpException(403, 'Cette valeur ne peut plus être affichée.');
        }

        if (! filled($variable->getRawOriginal('value'))) {
            return [
                'uuid' => $variable->uuid,
                'value' => null,
            ];
        }

        $variable->loadMissing('resourceable');

        return [
            'uuid' => $variable->uuid,
            'value' => $variable->value,
        ];
    }

    private function findVariable(Application $application, string $envUuid): EnvironmentVariable
    {
        $variable = EnvironmentVariable::query()
            ->where('uuid', $envUuid)
            ->where('resourceable_type', Application::class)
            ->where('resourceable_id', $application->id)
            ->first();

        if (! $variable) {
            throw new HttpException(404, 'Variable d’environnement introuvable.');
        }

        return $variable;
    }

    private function assertEditable(EnvironmentVariable $variable): void
    {
        if (! $this->isEditable($variable)) {
            throw new HttpException(422, 'Cette variable est gérée automatiquement et ne peut pas être modifiée.');
        }
    }

    private function assertDeletable(EnvironmentVariable $variable): void
    {
        if (! $this->isDeletable($variable)) {
            throw new HttpException(422, 'Cette variable est gérée automatiquement et ne peut pas être supprimée.');
        }
    }

    private function isEditable(EnvironmentVariable $variable): bool
    {
        if ($variable->is_coolify) {
            return false;
        }

        if ($variable->is_buildpack_control && ! $this->isNodeVersionControlKey($variable->key)) {
            return false;
        }

        return $this->isUserManaged($variable);
    }

    private function isNodeVersionControlKey(?string $key): bool
    {
        return in_array($key, ['NIXPACKS_NODE_VERSION', 'RAILPACK_NODE_VERSION'], true);
    }

    /**
     * Les variables buildpack (NIXPACKS_*, RAILPACK_*) restent non éditables
     * sauf NIXPACKS_NODE_VERSION / RAILPACK_NODE_VERSION, et peuvent être supprimées.
     */
    private function isDeletable(EnvironmentVariable $variable): bool
    {
        if ($variable->is_coolify) {
            return false;
        }

        return $this->isUserManaged($variable);
    }

    private function isUserManaged(EnvironmentVariable $variable): bool
    {
        if ($variable->is_shared) {
            return false;
        }

        if (str($variable->comment ?? '')->startsWith('devforge:database:')) {
            return false;
        }

        if (str($variable->key)->startsWith('SERVICE_FQDN')
            || str($variable->key)->startsWith('SERVICE_URL')
            || str($variable->key)->startsWith('SERVICE_NAME')) {
            return false;
        }

        return true;
    }

    /**
     * @return array<string, mixed>
     */
    private function present(EnvironmentVariable $variable): array
    {
        return [
            'uuid' => $variable->uuid,
            'key' => $variable->key,
            'value' => filled($variable->getRawOriginal('value')) ? '********' : null,
            'has_value' => filled($variable->getRawOriginal('value')),
            'is_revealable' => filled($variable->getRawOriginal('value')) && ! $variable->is_shown_once,
            'comment' => $variable->comment,
            'is_preview' => (bool) $variable->is_preview,
            'is_runtime' => (bool) $variable->is_runtime,
            'is_buildtime' => (bool) $variable->is_buildtime,
            'is_multiline' => (bool) $variable->is_multiline,
            'is_literal' => (bool) $variable->is_literal,
            'is_shown_once' => (bool) $variable->is_shown_once,
            'is_shared' => (bool) $variable->is_shared,
            'is_coolify' => (bool) $variable->is_coolify,
            'is_buildpack_control' => (bool) $variable->is_buildpack_control,
            'is_editable' => $this->isEditable($variable),
            'is_deletable' => $this->isDeletable($variable),
            'updated_at' => $variable->updated_at?->toIso8601String(),
        ];
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    private function validateInput(array $input, bool $creating): array
    {
        $rules = [
            'value' => ['nullable', 'string'],
            'is_preview' => ['sometimes', 'boolean'],
            'is_literal' => ['sometimes', 'boolean'],
            'is_multiline' => ['sometimes', 'boolean'],
            'is_shown_once' => ['sometimes', 'boolean'],
            'is_runtime' => ['sometimes', 'boolean'],
            'is_buildtime' => ['sometimes', 'boolean'],
            'comment' => ['nullable', 'string', 'max:256'],
        ];

        if ($creating) {
            $rules['key'] = ValidationPatterns::environmentVariableKeyRules();
        }

        $validated = validator($input, $rules, ValidationPatterns::environmentVariableKeyMessages('key'))->validate();

        if ($creating) {
            $validated['key'] = ValidationPatterns::normalizeEnvironmentVariableKey($validated['key']);
        }

        return $validated;
    }

    /**
     * Empêche les valeurs avec retours à la ligne de casser le .env Compose
     * (ligne orpheline lue comme nom de variable, ex. base64 Tesla avec `/`).
     *
     * @return array{0: string|null, 1: bool}
     */
    private function normalizeStoredValue(?string $value, bool $isMultiline): array
    {
        if ($value === null) {
            return [null, $isMultiline];
        }

        $hasNewline = str_contains($value, "\n") || str_contains($value, "\r");

        if (! $hasNewline) {
            return [$value, $isMultiline];
        }

        // PEM / blocs structurés : conserver les lignes, forcer multiligne.
        if (str_contains($value, '-----BEGIN ')) {
            return [str_replace(["\r\n", "\r"], "\n", $value), true];
        }

        // Corps base64 wrapé (ex. clé HA collée) : une seule ligne pour Compose.
        return [preg_replace('/\s+/', '', $value) ?? $value, false];
    }
}
