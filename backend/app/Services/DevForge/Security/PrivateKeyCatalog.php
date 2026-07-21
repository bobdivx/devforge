<?php

namespace App\Services\DevForge\Security;

use App\Models\PrivateKey;
use App\Models\Team;
use App\Support\ValidationPatterns;
use Illuminate\Validation\ValidationException;

class PrivateKeyCatalog
{
    /**
     * @return list<array{
     *     id: int,
     *     uuid: string,
     *     name: string,
     *     description: string|null,
     *     fingerprint: string|null,
     *     is_git_related: bool,
     *     private_key: string,
     *     created_at: mixed
     * }>
     */
    public function list(Team $team): array
    {
        return PrivateKey::query()
            ->where('team_id', $team->id)
            ->orderBy('name')
            ->get()
            ->map(fn (PrivateKey $key): array => $this->present($key))
            ->all();
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array{
     *     id: int,
     *     uuid: string,
     *     name: string,
     *     description: string|null,
     *     fingerprint: string|null,
     *     is_git_related: bool,
     *     private_key: string,
     *     created_at: mixed,
     *     message: string
     * }
     */
    public function store(Team $team, array $input): array
    {
        $validated = validator($input, [
            'name' => ValidationPatterns::nameRules(required: false),
            'description' => ValidationPatterns::descriptionRules(),
            'private_key' => ['required', 'string'],
        ], ValidationPatterns::combinedMessages())->validate();

        $privateKeyValue = trim((string) $validated['private_key'])."\n";

        if (! PrivateKey::validatePrivateKey($privateKeyValue)) {
            throw ValidationException::withMessages([
                'private_key' => 'Clé privée invalide.',
            ]);
        }

        $key = PrivateKey::createAndStore([
            'name' => filled($validated['name'] ?? null)
                ? (string) $validated['name']
                : generate_random_name(),
            'description' => $validated['description'] ?? null,
            'private_key' => $privateKeyValue,
            'team_id' => $team->id,
        ]);

        return [
            ...$this->present($key),
            'message' => 'Clé privée créée.',
        ];
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array{
     *     id: int,
     *     uuid: string,
     *     name: string,
     *     description: string|null,
     *     fingerprint: string|null,
     *     is_git_related: bool,
     *     private_key: string,
     *     created_at: mixed,
     *     message: string
     * }
     */
    public function update(PrivateKey $key, array $input): array
    {
        $validated = validator($input, [
            'name' => ValidationPatterns::nameRules(required: false),
            'description' => ValidationPatterns::descriptionRules(),
            'private_key' => ['sometimes', 'string'],
        ], ValidationPatterns::combinedMessages())->validate();

        if ($validated === []) {
            throw ValidationException::withMessages([
                'input' => 'Au moins un champ doit être fourni.',
            ]);
        }

        if (array_key_exists('name', $validated) && filled($validated['name'])) {
            $key->name = (string) $validated['name'];
        }

        if (array_key_exists('description', $validated)) {
            $key->description = $validated['description'];
        }

        if (array_key_exists('private_key', $validated) && filled($validated['private_key'])) {
            $privateKeyValue = trim((string) $validated['private_key'])."\n";
            if (! PrivateKey::validatePrivateKey($privateKeyValue)) {
                throw ValidationException::withMessages([
                    'private_key' => 'Clé privée invalide.',
                ]);
            }
            $key->private_key = $privateKeyValue;
        }

        $key->save();

        return [
            ...$this->present($key->fresh()),
            'message' => 'Clé privée mise à jour.',
        ];
    }

    public function destroy(PrivateKey $key): void
    {
        if (! $key->safeDelete()) {
            throw ValidationException::withMessages([
                'key' => 'Cette clé est encore utilisée par un serveur, une application ou une source Git.',
            ]);
        }
    }

    /**
     * @return array{
     *     name: string,
     *     description: string,
     *     private_key: string,
     *     public_key: string
     * }
     */
    public function generate(string $type = 'ed25519'): array
    {
        $normalized = in_array($type, ['rsa', 'ed25519'], true) ? $type : 'ed25519';

        return PrivateKey::generateNewKeyPair($normalized);
    }

    /**
     * @return array{
     *     id: int,
     *     uuid: string,
     *     name: string,
     *     description: string|null,
     *     fingerprint: string|null,
     *     is_git_related: bool,
     *     private_key: string,
     *     created_at: mixed
     * }
     */
    private function present(PrivateKey $key): array
    {
        return [
            'id' => $key->id,
            'uuid' => $key->uuid,
            'name' => $key->name,
            'description' => $key->description,
            'fingerprint' => $key->fingerprint,
            'is_git_related' => (bool) $key->is_git_related,
            'private_key' => '********',
            'created_at' => $key->created_at,
        ];
    }
}
