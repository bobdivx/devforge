<?php

namespace App\Services\DevForge;

use App\Models\Server;
use App\Models\StandaloneDocker;
use App\Models\SwarmDocker;
use App\Models\Team;
use Illuminate\Support\Collection;

class DeploymentTargetData
{
    /**
     * @return array<int, array<string, mixed>>
     */
    public function forTeam(Team $team): array
    {
        return Server::query()
            ->where('team_id', $team->id)
            ->with(['standaloneDockers', 'swarmDockers'])
            ->orderBy('name')
            ->get()
            ->map(fn (Server $server): array => [
                'uuid' => $server->uuid,
                'name' => $server->name,
                'reachable' => (bool) $server->settings?->is_reachable,
                'usable' => (bool) $server->settings?->is_usable,
                'destinations' => $this->destinations($server),
            ])
            ->filter(fn (array $server): bool => $server['destinations'] !== [])
            ->values()
            ->all();
    }

    public function destinationForTeam(Team $team, string $destinationUuid): StandaloneDocker|SwarmDocker|null
    {
        return StandaloneDocker::ownedByCurrentTeamAPI($team->id)
            ->where('uuid', $destinationUuid)
            ->first()
            ?? SwarmDocker::ownedByCurrentTeamAPI($team->id)
                ->where('uuid', $destinationUuid)
                ->first();
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function destinations(Server $server): array
    {
        return $this->destinationCollection($server)
            ->map(fn (StandaloneDocker|SwarmDocker $destination): array => [
                'uuid' => $destination->uuid,
                'name' => $destination->name,
                'type' => $destination instanceof SwarmDocker ? 'swarm' : 'standalone',
            ])
            ->values()
            ->all();
    }

    /**
     * @return Collection<int, StandaloneDocker|SwarmDocker>
     */
    private function destinationCollection(Server $server): Collection
    {
        return $server->standaloneDockers
            ->concat($server->swarmDockers);
    }
}
