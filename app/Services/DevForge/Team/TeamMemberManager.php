<?php

namespace App\Services\DevForge\Team;

use App\Actions\User\RevokeUserTeamTokens;
use App\Enums\Role;
use App\Models\Team;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

class TeamMemberManager
{
    public function updateRole(User $actor, Team $team, User $member, string $role): void
    {
        Gate::forUser($actor)->authorize('manageMembers', $team);
        $this->assertCanManageTarget($actor, $team, $member);

        $normalizedRole = Role::from($role);
        $actorRole = Role::from((string) $actor->role());

        if ($actorRole->lt(Role::ADMIN)) {
            throw ValidationException::withMessages([
                'role' => ['You are not authorized to change member roles.'],
            ]);
        }

        if ($normalizedRole === Role::OWNER && $actorRole->lt(Role::OWNER)) {
            throw ValidationException::withMessages([
                'role' => ['Only owners can assign the owner role.'],
            ]);
        }

        $team->members()->updateExistingPivot($member->id, ['role' => $normalizedRole->value]);
        RevokeUserTeamTokens::forUserTeam($member, $team->id);
    }

    public function remove(User $actor, Team $team, User $member): void
    {
        Gate::forUser($actor)->authorize('manageMembers', $team);
        $this->assertCanManageTarget($actor, $team, $member);

        if ($member->id === $actor->id) {
            throw ValidationException::withMessages([
                'member' => ['You cannot remove yourself from the team.'],
            ]);
        }

        $member->teams()->detach($team);
        RevokeUserTeamTokens::forUserTeam($member, $team->id);
        Cache::forget("team:{$member->id}");
        Cache::forget("user:{$member->id}:team:{$team->id}");
    }

    private function assertCanManageTarget(User $actor, Team $team, User $member): void
    {
        if (! $team->members()->whereKey($member->id)->exists()) {
            throw ValidationException::withMessages([
                'member' => ['This user is not a member of the team.'],
            ]);
        }

        $actorRole = Role::from((string) $actor->role());
        $memberRole = Role::from((string) $this->memberRole($team, $member));

        if ($actorRole->lt(Role::ADMIN) || $memberRole->gt($actorRole)) {
            throw new AuthorizationException('You are not authorized to manage this member.');
        }
    }

    private function memberRole(Team $team, User $member): string
    {
        return (string) $member->teams()
            ->whereKey($team->id)
            ->first()
            ?->pivot
            ?->role;
    }
}
