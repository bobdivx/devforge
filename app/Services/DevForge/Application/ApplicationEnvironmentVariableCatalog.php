<?php

namespace App\Services\DevForge\Application;

use App\Models\Application;
use App\Models\EnvironmentVariable;
use App\Support\ValidationPatterns;
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

        $variable = $application->environment_variables()->create([
            'key' => $key,
            'value' => $validated['value'] ?? null,
            'is_preview' => $isPreview,
            'is_literal' => (bool) ($validated['is_literal'] ?? false),
            'is_multiline' => (bool) ($validated['is_multiline'] ?? false),
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
     * Crée ou met à jour une variable Coolify (préféré à un fichier .env Git).
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
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public function update(Application $application, string $envUuid, array $input): array
    {
        $variable = $this->findVariable($application, $envUuid);
        $this->assertEditable($variable);

        $validated = $this->validateInput($input, creating: false);

        if (array_key_exists('value', $validated)) {
            $variable->value = $validated['value'];
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
        $this->assertEditable($variable);

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

    private function isEditable(EnvironmentVariable $variable): bool
    {
        if ($variable->is_coolify || $variable->is_buildpack_control) {
            return false;
        }

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
}
