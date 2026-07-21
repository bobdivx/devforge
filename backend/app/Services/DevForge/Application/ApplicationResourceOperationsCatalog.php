<?php

namespace App\Services\DevForge\Application;

use App\Models\Application;
use App\Models\Environment;
use App\Models\Project;
use App\Models\Team;
use App\Services\DevForge\Destination\DestinationCatalog;
use Illuminate\Validation\ValidationException;
use Visus\Cuid2\Cuid2;

class ApplicationResourceOperationsCatalog
{
    public function __construct(
        private readonly DestinationCatalog $destinationCatalog,
    ) {}

    /**
     * @return array{
     *     current_destination_uuid: string|null,
     *     current_environment_uuid: string|null,
     *     destinations: list<array{uuid: string, name: string, type: string, server: array{uuid: string, name: string}}>,
     *     environments: list<array{uuid: string, name: string, project_uuid: string, project_name: string}>
     * }
     */
    public function options(Team $team, Application $application): array
    {
        $destinations = collect($this->destinationCatalog->destinationsForTeam($team))
            ->filter(function (array $destination) use ($team): bool {
                $serverUuid = data_get($destination, 'server.uuid');
                if (! is_string($serverUuid) || $serverUuid === '') {
                    return false;
                }

                $server = $team->servers()->where('uuid', $serverUuid)->first();

                return $server !== null && ! $server->isBuildServer();
            })
            ->map(fn (array $destination): array => [
                'uuid' => $destination['uuid'],
                'name' => $destination['name'],
                'type' => $destination['type'],
                'server' => [
                    'uuid' => $destination['server']['uuid'],
                    'name' => $destination['server']['name'],
                ],
            ])
            ->values()
            ->all();

        $environments = Project::query()
            ->where('team_id', $team->id)
            ->with('environments')
            ->orderBy('name')
            ->get()
            ->flatMap(fn (Project $project) => $project->environments
                ->sortBy('name')
                ->map(fn (Environment $environment): array => [
                    'uuid' => $environment->uuid,
                    'name' => $environment->name,
                    'project_uuid' => $project->uuid,
                    'project_name' => $project->name,
                ]))
            ->values()
            ->all();

        return [
            'current_destination_uuid' => $application->destination?->uuid,
            'current_environment_uuid' => $application->environment?->uuid,
            'destinations' => $destinations,
            'environments' => $environments,
        ];
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array{
     *     uuid: string,
     *     name: string,
     *     project_uuid: string|null,
     *     environment_uuid: string|null,
     *     message: string
     * }
     */
    public function clone(Team $team, Application $application, array $input): array
    {
        $validated = validator($input, [
            'destination_uuid' => ['required', 'string', 'max:64'],
            'clone_volume_data' => ['sometimes', 'boolean'],
        ])->validate();

        $destination = $this->destinationCatalog->destinationForTeam($team, $validated['destination_uuid']);

        if ($destination->server?->isBuildServer()) {
            throw ValidationException::withMessages([
                'destination_uuid' => 'Impossible de cloner vers un serveur de build.',
            ]);
        }

        $uuid = (string) new Cuid2;
        $cloneVolumeData = (bool) ($validated['clone_volume_data'] ?? false);
        $cloned = clone_application($application, $destination, ['uuid' => $uuid], $cloneVolumeData);
        $cloned->load(['environment.project']);

        return [
            'uuid' => $cloned->uuid,
            'name' => $cloned->name,
            'project_uuid' => $cloned->environment?->project?->uuid,
            'environment_uuid' => $cloned->environment?->uuid,
            'message' => 'Application clonée.',
        ];
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array{
     *     uuid: string,
     *     name: string,
     *     project_uuid: string|null,
     *     environment_uuid: string|null,
     *     message: string
     * }
     */
    public function move(Team $team, Application $application, array $input): array
    {
        $validated = validator($input, [
            'environment_uuid' => ['required', 'string', 'max:64'],
        ])->validate();

        $environment = Environment::query()
            ->where('uuid', $validated['environment_uuid'])
            ->whereHas('project', fn ($query) => $query->where('team_id', $team->id))
            ->with('project')
            ->first();

        if ($environment === null) {
            throw ValidationException::withMessages([
                'environment_uuid' => 'Environnement introuvable pour cette équipe.',
            ]);
        }

        $application->environment_id = $environment->id;
        $application->save();

        return [
            'uuid' => $application->uuid,
            'name' => $application->name,
            'project_uuid' => $environment->project?->uuid,
            'environment_uuid' => $environment->uuid,
            'message' => 'Application déplacée.',
        ];
    }
}
