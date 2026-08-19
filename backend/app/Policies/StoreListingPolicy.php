<?php

namespace App\Policies;

use App\Models\StoreListing;
use App\Models\Team;
use App\Models\User;

class StoreListingPolicy
{
    public function viewAny(User $user): bool
    {
        return true;
    }

    public function view(User $user, StoreListing $listing, ?Team $team = null): bool
    {
        if ($listing->isPublished()) {
            return true;
        }

        if ($team instanceof Team) {
            return $listing->isOwnedBy($team);
        }

        return $user->teams->contains('id', $listing->team_id);
    }

    public function create(User $user): bool
    {
        return true;
    }

    public function update(User $user, StoreListing $listing, ?Team $team = null): bool
    {
        if ($team instanceof Team) {
            return $listing->isOwnedBy($team);
        }

        return $user->teams->contains('id', $listing->team_id);
    }

    public function delete(User $user, StoreListing $listing, ?Team $team = null): bool
    {
        return $this->update($user, $listing, $team);
    }

    public function install(User $user, StoreListing $listing): bool
    {
        return $listing->isPublished() || $user->teams->contains('id', $listing->team_id);
    }
}
