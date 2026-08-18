<?php

namespace App\Services\DevForge\Core;

use App\Models\Application;
use App\Models\Server;
use App\Models\Service;
use App\Models\Team;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Collection;

class CoreResourceCatalog
{
    /**
     * @return Collection<int, Model>
     */
    public function resources(Team $team, string $type): Collection
    {
        return match ($type) {
            'servers' => Server::query()
                ->where('team_id', $team->id)
                ->with('settings')
                ->orderBy('name')
                ->get(),
            'applications' => Application::query()
                ->whereRelation('environment.project', 'team_id', $team->id)
                ->with(['environment.project', 'destination.server', 'settings', 'additional_servers'])
                ->orderBy('name')
                ->get(),
            'services' => Service::query()
                ->whereRelation('environment.project', 'team_id', $team->id)
                ->with(['environment.project', 'destination.server', 'applications'])
                ->orderBy('name')
                ->get(),
            'databases' => $this->databases($team),
            default => collect(),
        };
    }

    public function find(Team $team, string $type, string $uuid): ?Model
    {
        return match ($type) {
            'servers' => Server::query()
                ->where('team_id', $team->id)
                ->where('uuid', $uuid)
                ->with('settings')
                ->first(),
            'applications' => Application::query()
                ->where('uuid', $uuid)
                ->whereRelation('environment.project', 'team_id', $team->id)
                ->with(['environment.project', 'destination.server', 'settings', 'additional_servers'])
                ->first(),
            'services' => Service::query()
                ->where('uuid', $uuid)
                ->whereRelation('environment.project', 'team_id', $team->id)
                ->with(['environment.project', 'destination.server', 'applications'])
                ->first(),
            'databases' => $this->findDatabase($team, $uuid),
            default => null,
        };
    }

    private function findDatabase(Team $team, string $uuid): ?Model
    {
        foreach (STANDALONE_DATABASE_MODELS as $modelClass) {
            $database = $modelClass::query()
                ->where('uuid', $uuid)
                ->whereRelation('environment.project', 'team_id', $team->id)
                ->with(['environment.project', 'destination.server'])
                ->first();

            if ($database) {
                return $database;
            }
        }

        return null;
    }

    /**
     * @return Collection<int, Model>
     */
    public function all(Team $team): Collection
    {
        return collect(['servers', 'applications', 'databases', 'services'])
            ->flatMap(fn (string $type): Collection => $this->resources($team, $type)
                ->map(function (Model $resource) use ($type): Model {
                    $resource->setAttribute('devforge_resource_type', $type);

                    return $resource;
                }))
            ->sortBy(fn (Model $resource): string => mb_strtolower((string) $resource->name))
            ->values();
    }

    /**
     * @return Collection<int, Model>
     */
    private function databases(Team $team): Collection
    {
        return collect(STANDALONE_DATABASE_MODELS)
            ->flatMap(fn (string $modelClass): Collection => $modelClass::query()
                ->whereRelation('environment.project', 'team_id', $team->id)
                ->with(['environment.project', 'destination.server'])
                ->orderBy('name')
                ->get())
            ->sortBy(fn (Model $database): string => mb_strtolower((string) $database->name))
            ->values();
    }
}
