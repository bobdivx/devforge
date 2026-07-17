<?php

namespace App\Policies;

use App\Models\AiProviderConfig;
use App\Models\User;
use App\Support\DevForge\DevForgeAuthorization;

class AiProviderConfigPolicy
{
    public function viewAny(User $user): bool
    {
        return DevForgeAuthorization::memberOfCurrentTeam($user);
    }

    public function view(User $user, AiProviderConfig $provider): bool
    {
        return $this->ownsTeam($user, $provider);
    }

    public function create(User $user): bool
    {
        return $user->isAdmin() || $user->isOwner();
    }

    public function update(User $user, AiProviderConfig $provider): bool
    {
        return ($user->isAdmin() || $user->isOwner()) && $this->ownsTeam($user, $provider);
    }

    public function delete(User $user, AiProviderConfig $provider): bool
    {
        return ($user->isAdmin() || $user->isOwner()) && $this->ownsTeam($user, $provider);
    }

    private function ownsTeam(User $user, AiProviderConfig $provider): bool
    {
        return $user->teams()->whereKey($provider->team_id)->exists();
    }
}
