<?php

namespace App\Services\DevForge\Security;

use App\Models\InstanceSettings;
use App\Models\Team;
use App\Models\User;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\PersonalAccessToken;

class ApiTokenCatalog
{
    private const ALLOWED_ABILITIES = [
        'root',
        'write',
        'write:sensitive',
        'deploy',
        'read',
        'read:sensitive',
    ];

    private const EXPIRATION_DAYS = [7, 30, 60, 90, 365];

    /**
     * @return array{
     *     tokens: list<array<string, mixed>>,
     *     meta: array{is_api_enabled: bool, can_use_root: bool, can_use_write: bool}
     * }
     */
    public function list(User $user, Team $team): array
    {
        $tokens = $user->tokens()
            ->where('team_id', $team->id)
            ->orderByDesc('created_at')
            ->get()
            ->map(fn (PersonalAccessToken $token): array => $this->present($token))
            ->values()
            ->all();

        return [
            'tokens' => $tokens,
            'meta' => $this->meta($user),
        ];
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array{
     *     id: int,
     *     name: string,
     *     abilities: list<string>,
     *     team_id: int|null,
     *     last_used_at: string|null,
     *     expires_at: string|null,
     *     created_at: string|null,
     *     is_expired: bool,
     *     plain_text_token: string,
     *     message: string
     * }
     */
    public function store(User $user, Team $team, array $input): array
    {
        if (! InstanceSettings::get()->is_api_enabled) {
            throw ValidationException::withMessages([
                'api' => 'L’API est désactivée sur cette instance.',
            ]);
        }

        $validated = validator($input, [
            'name' => ['required', 'string', 'min:3', 'max:255'],
            'abilities' => ['sometimes', 'array', 'min:1'],
            'abilities.*' => ['string', 'in:'.implode(',', self::ALLOWED_ABILITIES)],
            'expires_in_days' => ['nullable', 'integer', 'in:'.implode(',', self::EXPIRATION_DAYS)],
        ])->validate();

        $abilities = $this->normalizeAbilities(
            $user,
            array_values($validated['abilities'] ?? ['read']),
        );

        // Default: if expires_in_days omitted → 30 days (Livewire default); null → never
        if (! array_key_exists('expires_in_days', $validated)) {
            $expiresAt = now()->addDays(30);
        } elseif ($validated['expires_in_days'] === null) {
            $expiresAt = null;
        } else {
            $expiresAt = now()->addDays((int) $validated['expires_in_days']);
        }

        $newToken = $user->createToken($validated['name'], $abilities, $expiresAt);
        /** @var PersonalAccessToken $token */
        $token = $newToken->accessToken;

        if ((int) $token->team_id !== (int) $team->id) {
            $token->forceFill(['team_id' => $team->id])->save();
        }

        return [
            ...$this->present($token->fresh()),
            'plain_text_token' => $newToken->plainTextToken,
            'message' => 'Jeton créé. Copiez-le maintenant — il ne sera plus affiché.',
        ];
    }

    public function destroy(User $user, Team $team, int $tokenId): void
    {
        $token = $user->tokens()
            ->where('team_id', $team->id)
            ->whereKey($tokenId)
            ->first();

        abort_unless($token instanceof PersonalAccessToken, 404);

        $token->delete();
    }

    /**
     * @return array{is_api_enabled: bool, can_use_root: bool, can_use_write: bool}
     */
    private function meta(User $user): array
    {
        return [
            'is_api_enabled' => (bool) InstanceSettings::get()->is_api_enabled,
            'can_use_root' => $user->can('useRootPermissions', PersonalAccessToken::class),
            'can_use_write' => $user->can('useWritePermissions', PersonalAccessToken::class),
        ];
    }

    /**
     * @param  list<string>  $abilities
     * @return list<string>
     */
    private function normalizeAbilities(User $user, array $abilities): array
    {
        $abilities = array_values(array_unique(array_filter($abilities, fn ($ability) => is_string($ability) && $ability !== '')));

        if ($abilities === []) {
            $abilities = ['read'];
        }

        if (in_array('root', $abilities, true) && ! $user->can('useRootPermissions', PersonalAccessToken::class)) {
            throw ValidationException::withMessages([
                'abilities' => 'Vous n’avez pas la permission d’utiliser les abilities root.',
            ]);
        }

        if (
            array_intersect(['write', 'write:sensitive'], $abilities) !== []
            && ! $user->can('useWritePermissions', PersonalAccessToken::class)
        ) {
            throw ValidationException::withMessages([
                'abilities' => 'Vous n’avez pas la permission d’utiliser les abilities write.',
            ]);
        }

        if (in_array('root', $abilities, true)) {
            return ['root'];
        }

        if (in_array('deploy', $abilities, true)) {
            return ['deploy'];
        }

        if (in_array('read:sensitive', $abilities, true) && ! in_array('read', $abilities, true)) {
            $abilities[] = 'read';
        }

        sort($abilities);

        return array_values($abilities);
    }

    /**
     * @return array{
     *     id: int,
     *     name: string,
     *     abilities: list<string>,
     *     team_id: int|null,
     *     last_used_at: string|null,
     *     expires_at: string|null,
     *     created_at: string|null,
     *     is_expired: bool
     * }
     */
    private function present(PersonalAccessToken $token): array
    {
        $expiresAt = $token->expires_at;

        return [
            'id' => $token->id,
            'name' => $token->name,
            'abilities' => array_values($token->abilities ?? []),
            'team_id' => $token->team_id !== null ? (int) $token->team_id : null,
            'last_used_at' => $token->last_used_at?->toIso8601String(),
            'expires_at' => $expiresAt?->toIso8601String(),
            'created_at' => $token->created_at?->toIso8601String(),
            'is_expired' => $expiresAt !== null && $expiresAt->isPast(),
        ];
    }
}
