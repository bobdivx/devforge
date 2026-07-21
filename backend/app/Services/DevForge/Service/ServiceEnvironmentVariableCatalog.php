<?php

namespace App\Services\DevForge\Service;

use App\Models\EnvironmentVariable;
use App\Models\Service;
use App\Support\ValidationPatterns;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;

class ServiceEnvironmentVariableCatalog
{
    /**
     * @return array<int, array<string, mixed>>
     */
    public function list(Service $service): array
    {
        return $service->environment_variables()
            ->orderBy('key')
            ->get()
            ->map(fn (EnvironmentVariable $variable): array => $this->present($variable))
            ->values()
            ->all();
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public function store(Service $service, array $input): array
    {
        $validated = $this->validateInput($input, creating: true);
        $key = ValidationPatterns::normalizeEnvironmentVariableKey($validated['key']);

        if ($this->isProtectedKey($key)) {
            throw ValidationException::withMessages([
                'key' => 'Cette clé est réservée au système et ne peut pas être créée manuellement.',
            ]);
        }

        if ($service->environment_variables()->where('key', $key)->exists()) {
            throw ValidationException::withMessages([
                'key' => 'Cette variable existe déjà. Utilisez la mise à jour pour la modifier.',
            ]);
        }

        $variable = $service->environment_variables()->create([
            'key' => $key,
            'value' => $validated['value'] ?? null,
            'is_preview' => false,
            'is_literal' => (bool) ($validated['is_literal'] ?? false),
            'is_multiline' => (bool) ($validated['is_multiline'] ?? false),
            'is_shown_once' => (bool) ($validated['is_shown_once'] ?? false),
            'is_runtime' => (bool) ($validated['is_runtime'] ?? true),
            'is_buildtime' => (bool) ($validated['is_buildtime'] ?? false),
            'comment' => $validated['comment'] ?? null,
            'resourceable_type' => $service->getMorphClass(),
            'resourceable_id' => $service->getKey(),
        ]);

        return $this->present($variable->fresh());
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public function update(Service $service, string $envUuid, array $input): array
    {
        $variable = $this->findVariable($service, $envUuid);
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

    public function destroy(Service $service, string $envUuid): void
    {
        $variable = $this->findVariable($service, $envUuid);
        $this->assertEditable($variable);

        $variable->forceDelete();
    }

    /**
     * @return array{uuid: string, value: string|null}
     */
    public function reveal(Service $service, string $envUuid): array
    {
        $variable = $this->findVariable($service, $envUuid);

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

    private function findVariable(Service $service, string $envUuid): EnvironmentVariable
    {
        $variable = EnvironmentVariable::query()
            ->where('uuid', $envUuid)
            ->where('resourceable_type', $service->getMorphClass())
            ->where('resourceable_id', $service->getKey())
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

        return ! $this->isProtectedKey((string) $variable->key);
    }

    private function isProtectedKey(string $key): bool
    {
        return str($key)->startsWith('SERVICE_FQDN')
            || str($key)->startsWith('SERVICE_URL')
            || str($key)->startsWith('SERVICE_NAME');
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
            'is_preview' => false,
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
