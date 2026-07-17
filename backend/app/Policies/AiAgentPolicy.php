<?php

namespace App\Policies;

use App\Models\AiAgent;
use App\Models\User;
use App\Support\DevForge\DevForgeAuthorization;

class AiAgentPolicy
{
    public function viewAny(User $user): bool
    {
        return DevForgeAuthorization::memberOfCurrentTeam($user);
    }

    public function view(User $user, AiAgent $agent): bool
    {
        return $this->ownsTeam($user, $agent);
    }

    public function create(User $user): bool
    {
        return $user->isAdmin() || $user->isOwner();
    }

    public function update(User $user, AiAgent $agent): bool
    {
        return ($user->isAdmin() || $user->isOwner()) && $this->ownsTeam($user, $agent);
    }

    public function delete(User $user, AiAgent $agent): bool
    {
        return ($user->isAdmin() || $user->isOwner()) && $this->ownsTeam($user, $agent);
    }

    public function run(User $user, AiAgent $agent): bool
    {
        return ($user->isAdmin() || $user->isOwner()) && $this->ownsTeam($user, $agent);
    }

    public function chat(User $user, AiAgent $agent): bool
    {
        return $this->ownsTeam($user, $agent);
    }

    private function ownsTeam(User $user, AiAgent $agent): bool
    {
        return $user->teams()->whereKey($agent->team_id)->exists();
    }
}
