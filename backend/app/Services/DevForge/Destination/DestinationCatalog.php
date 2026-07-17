<?php

namespace App\Services\DevForge\Destination;

use App\Models\Application;
use App\Models\BaseModel;
use App\Models\Server;
use App\Models\Service;
use App\Models\StandaloneClickhouse;
use App\Models\StandaloneDocker;
use App\Models\StandaloneDragonfly;
use App\Models\StandaloneKeydb;
use App\Models\StandaloneMariadb;
use App\Models\StandaloneMongodb;
use App\Models\StandaloneMysql;
use App\Models\StandalonePostgresql;
use App\Models\StandaloneRedis;
use App\Models\SwarmDocker;
use App\Models\Team;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Collection;

class DestinationCatalog
{
    /**
     * @return array<int, array<string, mixed>>
     */
    public function destinationsForTeam(Team $team): array
    {
        return Server::query()
            ->where('team_id', $team->id)
            ->with(['standaloneDockers.server', 'swarmDockers.server'])
            ->orderBy('name')
            ->get()
            ->flatMap(fn (Server $server): Collection => $server->standaloneDockers
                ->concat($server->swarmDockers)
                ->map(fn (StandaloneDocker|SwarmDocker $destination): array => $this->presentSummary($destination)))
            ->sortBy('name')
            ->values()
            ->all();
    }

    public function destinationForTeam(Team $team, string $destinationUuid): StandaloneDocker|SwarmDocker
    {
        $destination = StandaloneDocker::ownedByCurrentTeamAPI($team->id)
            ->with('server')
            ->where('uuid', $destinationUuid)
            ->first()
            ?? SwarmDocker::ownedByCurrentTeamAPI($team->id)
                ->with('server')
                ->where('uuid', $destinationUuid)
                ->first();

        if (! $destination) {
            throw (new ModelNotFoundException)->setModel(StandaloneDocker::class, [$destinationUuid]);
        }

        return $destination;
    }

    /**
     * @return array<string, mixed>
     */
    public function present(StandaloneDocker|SwarmDocker $destination): array
    {
        $server = $destination->server;

        return [
            'uuid' => $destination->uuid,
            'name' => $destination->name,
            'type' => $destination instanceof SwarmDocker ? 'swarm' : 'standalone',
            'network' => $destination->network,
            'server' => [
                'uuid' => $server->uuid,
                'name' => $server->name,
                'ip' => $server->ip,
            ],
            'resource_count' => $this->resourceCount($destination),
            'has_attached_resources' => (bool) $destination->attachedTo(),
            'supports_resources_page' => $destination instanceof StandaloneDocker,
        ];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function resourcesForDestination(StandaloneDocker $destination): array
    {
        return $this->collectResources([
            $destination->applications()->with('environment.project')->get(),
            $destination->services()->with('environment.project')->get(),
            $destination->postgresqls()->with('environment.project')->get(),
            $destination->redis()->with('environment.project')->get(),
            $destination->mongodbs()->with('environment.project')->get(),
            $destination->mysqls()->with('environment.project')->get(),
            $destination->mariadbs()->with('environment.project')->get(),
            $destination->keydbs()->with('environment.project')->get(),
            $destination->dragonflies()->with('environment.project')->get(),
            $destination->clickhouses()->with('environment.project')->get(),
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function presentSummary(StandaloneDocker|SwarmDocker $destination): array
    {
        return [
            'uuid' => $destination->uuid,
            'name' => $destination->name,
            'type' => $destination instanceof SwarmDocker ? 'swarm' : 'standalone',
            'network' => $destination->network,
            'server' => [
                'uuid' => $destination->server->uuid,
                'name' => $destination->server->name,
            ],
            'resource_count' => $this->resourceCount($destination),
        ];
    }

    private function resourceCount(StandaloneDocker|SwarmDocker $destination): int
    {
        if ($destination instanceof StandaloneDocker) {
            return $destination->applications()->count()
                + $destination->services()->count()
                + $destination->databases()->count();
        }

        return $destination->applications()->count();
    }

    /**
     * @param  array<int, iterable<Application|Service|StandalonePostgresql|StandaloneRedis|StandaloneMongodb|StandaloneMysql|StandaloneMariadb|StandaloneKeydb|StandaloneDragonfly|StandaloneClickhouse>>  $groups
     * @return array<int, array<string, mixed>>
     */
    private function collectResources(array $groups): array
    {
        $rows = [];

        foreach ($groups as $group) {
            foreach ($group as $resource) {
                $rows[] = $this->resourceRow($resource);
            }
        }

        return $rows;
    }

    /**
     * @return array<string, mixed>
     */
    private function resourceRow(BaseModel $resource): array
    {
        $type = match (true) {
            $resource instanceof Application => 'application',
            $resource instanceof Service => 'service',
            default => 'database',
        };

        $environment = $resource->environment;
        $project = $environment?->project;

        return [
            'uuid' => $resource->uuid,
            'type' => $type,
            'name' => $resource->name,
            'project' => $project?->name,
            'environment' => $environment?->name,
        ];
    }
}
