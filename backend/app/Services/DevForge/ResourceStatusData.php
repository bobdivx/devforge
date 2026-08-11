<?php

namespace App\Services\DevForge;

use App\Models\Application;
use App\Models\Environment;
use App\Models\Service;
use App\Models\Team;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

class ResourceStatusData
{
    /**
     * @return array<string, array<int, array<string, mixed>>>
     */
    public function build(Team $team): array
    {
        $environmentIds = Environment::query()
            ->whereHas('project', fn (Builder $query): Builder => $query->where('team_id', $team->id))
            ->pluck('id');

        return [
            'applications' => Application::query()
                ->whereIn('environment_id', $environmentIds)
                ->orderBy('name')
                ->get(['uuid', 'name', 'status', 'updated_at'])
                ->map(fn (Application $application): array => $this->resource($application, 'application'))
                ->all(),
            'services' => Service::query()
                ->whereIn('environment_id', $environmentIds)
                ->with(['applications', 'databases'])
                ->orderBy('name')
                ->get(['id', 'uuid', 'name', 'updated_at'])
                ->map(fn (Service $service): array => $this->resource($service, 'service'))
                ->all(),
            'databases' => $this->databases($environmentIds),
            'servers' => $team->servers()
                ->with('settings')
                ->orderBy('name')
                ->get(['id', 'uuid', 'name', 'updated_at'])
                ->map(fn ($server): array => [
                    'uuid' => $server->uuid,
                    'name' => $server->name,
                    'type' => 'server',
                    'status' => data_get($server, 'settings.is_reachable')
                        && data_get($server, 'settings.is_usable')
                        && ! data_get($server, 'settings.force_disabled')
                            ? 'running'
                            : 'unavailable',
                    'reachable' => (bool) data_get($server, 'settings.is_reachable'),
                    'usable' => (bool) data_get($server, 'settings.is_usable'),
                    'updated_at' => $server->updated_at?->toISOString(),
                ])
                ->all(),
        ];
    }

    /**
     * @param  Collection<int, int>  $environmentIds
     * @return array<int, array<string, mixed>>
     */
    private function databases(Collection $environmentIds): array
    {
        return collect(STANDALONE_DATABASE_MODELS)->values()
            ->flatMap(fn (string $model): Collection => $model::query()
                ->whereIn('environment_id', $environmentIds)
                ->get(['uuid', 'name', 'status', 'updated_at'])
                ->map(fn (Model $database): array => $this->resource(
                    $database,
                    Str::of(class_basename($database))->after('Standalone')->lower()->value(),
                )))
            ->sortBy('name')
            ->values()
            ->all();
    }

    /**
     * @return array<string, mixed>
     */
    private function resource(Model $resource, string $type): array
    {
        return [
            'uuid' => $resource->getAttribute('uuid'),
            'name' => $resource->getAttribute('name'),
            'type' => $type,
            'status' => $this->statusFor($resource, $type),
            'updated_at' => $resource->getAttribute('updated_at')?->toISOString(),
        ];
    }

    private function statusFor(Model $resource, string $type): string
    {
        if ($type === 'service' && $resource instanceof Service) {
            try {
                return Str::before((string) $resource->status, ':') ?: 'unknown';
            } catch (\Throwable) {
                return 'unknown';
            }
        }

        return $resource->getAttribute('status') ?: 'unknown';
    }
}
