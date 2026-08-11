<?php

namespace App\Services\DevForge\Service;

use App\Models\Service;
use Illuminate\Validation\ValidationException;

class ServiceSettingsCatalog
{
    /**
     * @return array{
     *     is_image_auto_update_enabled: bool,
     *     message?: string
     * }
     */
    public function show(Service $service): array
    {
        return $this->present($service);
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array{
     *     is_image_auto_update_enabled: bool,
     *     message: string
     * }
     */
    public function update(Service $service, array $input): array
    {
        $validated = validator($input, [
            'is_image_auto_update_enabled' => ['sometimes', 'boolean'],
        ])->validate();

        if ($validated === []) {
            throw ValidationException::withMessages([
                'input' => 'Au moins un champ doit être fourni.',
            ]);
        }

        if (array_key_exists('is_image_auto_update_enabled', $validated)) {
            $service->is_image_auto_update_enabled = (bool) $validated['is_image_auto_update_enabled'];
        }

        $service->save();

        return [
            ...$this->present($service->fresh()),
            'message' => 'Paramètres du service mis à jour.',
        ];
    }

    /**
     * @return array{is_image_auto_update_enabled: bool}
     */
    private function present(Service $service): array
    {
        return [
            'is_image_auto_update_enabled' => (bool) ($service->is_image_auto_update_enabled ?? false),
        ];
    }
}
