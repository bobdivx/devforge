<?php

namespace App\Services\DevForge\Security;

use App\Models\CloudProviderToken;
use App\Models\Team;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;

class CloudProviderTokenCatalog
{
    /**
     * @return list<array{
     *     uuid: string,
     *     name: string,
     *     provider: string,
     *     team_id: int,
     *     servers_count: int,
     *     created_at: string|null,
     *     updated_at: string|null
     * }>
     */
    public function list(Team $team): array
    {
        return CloudProviderToken::query()
            ->where('team_id', $team->id)
            ->withCount('servers')
            ->orderBy('name')
            ->get()
            ->map(fn (CloudProviderToken $token): array => $this->present($token))
            ->all();
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array{
     *     uuid: string,
     *     name: string,
     *     provider: string,
     *     team_id: int,
     *     servers_count: int,
     *     created_at: string|null,
     *     updated_at: string|null,
     *     message: string
     * }
     */
    public function store(Team $team, array $input): array
    {
        $validated = validator($input, [
            'provider' => ['required', 'string', 'in:hetzner,digitalocean'],
            'token' => ['required', 'string'],
            'name' => ['required', 'string', 'max:255'],
        ])->validate();

        $validation = $this->validateProviderToken($validated['provider'], $validated['token']);
        if (! $validation['valid']) {
            throw ValidationException::withMessages([
                'token' => $validation['error'] ?? 'Jeton cloud invalide.',
            ]);
        }

        $token = CloudProviderToken::query()->create([
            'team_id' => $team->id,
            'provider' => $validated['provider'],
            'token' => $validated['token'],
            'name' => $validated['name'],
        ]);

        $token->loadCount('servers');

        return [
            ...$this->present($token),
            'message' => 'Jeton cloud ajouté.',
        ];
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array{
     *     uuid: string,
     *     name: string,
     *     provider: string,
     *     team_id: int,
     *     servers_count: int,
     *     created_at: string|null,
     *     updated_at: string|null,
     *     message: string
     * }
     */
    public function update(CloudProviderToken $token, array $input): array
    {
        $validated = validator($input, [
            'name' => ['required', 'string', 'max:255'],
        ])->validate();

        $token->name = $validated['name'];
        $token->save();
        $token->loadCount('servers');

        return [
            ...$this->present($token),
            'message' => 'Jeton cloud mis à jour.',
        ];
    }

    public function destroy(CloudProviderToken $token): void
    {
        if ($token->hasServers()) {
            throw ValidationException::withMessages([
                'token' => 'Ce jeton est encore lié à des serveurs.',
            ]);
        }

        $token->delete();
    }

    /**
     * @return array{valid: bool, message: string}
     */
    public function validateStored(CloudProviderToken $token): array
    {
        $validation = $this->validateProviderToken($token->provider, $token->token);

        return [
            'valid' => $validation['valid'],
            'message' => $validation['valid']
                ? 'Jeton valide auprès du fournisseur.'
                : ($validation['error'] ?? 'Jeton invalide.'),
        ];
    }

    /**
     * @return array{valid: bool, error: string|null}
     */
    private function validateProviderToken(string $provider, string $token): array
    {
        try {
            $response = match ($provider) {
                'hetzner' => Http::withHeaders([
                    'Authorization' => 'Bearer '.$token,
                ])->timeout(10)->get('https://api.hetzner.cloud/v1/servers'),
                'digitalocean' => Http::withHeaders([
                    'Authorization' => 'Bearer '.$token,
                ])->timeout(10)->get('https://api.digitalocean.com/v2/account'),
                default => null,
            };

            if ($response === null) {
                return ['valid' => false, 'error' => 'Fournisseur non supporté.'];
            }

            if ($response->successful()) {
                return ['valid' => true, 'error' => null];
            }

            return ['valid' => false, 'error' => "Jeton {$provider} invalide. Vérifiez votre token API."];
        } catch (\Throwable $e) {
            Log::error('Failed to validate cloud provider token', [
                'provider' => $provider,
                'exception' => $e->getMessage(),
            ]);

            return ['valid' => false, 'error' => 'Impossible de valider le jeton auprès de l’API du fournisseur.'];
        }
    }

    /**
     * @return array{
     *     uuid: string,
     *     name: string,
     *     provider: string,
     *     team_id: int,
     *     servers_count: int,
     *     created_at: string|null,
     *     updated_at: string|null
     * }
     */
    private function present(CloudProviderToken $token): array
    {
        return [
            'uuid' => $token->uuid,
            'name' => $token->name,
            'provider' => $token->provider,
            'team_id' => (int) $token->team_id,
            'servers_count' => (int) ($token->servers_count ?? 0),
            'created_at' => $token->created_at?->toIso8601String(),
            'updated_at' => $token->updated_at?->toIso8601String(),
        ];
    }
}
