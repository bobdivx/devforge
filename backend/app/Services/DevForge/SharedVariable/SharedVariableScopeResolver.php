<?php

namespace App\Services\DevForge\SharedVariable;

use App\Models\Environment;
use App\Models\Project;
use App\Models\Server;
use App\Models\SharedEnvironmentVariable;
use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\CurrentTeamContext;
use App\Services\DevForge\CurrentTeamResources;
use Illuminate\Validation\ValidationException;

class SharedVariableScopeResolver
{
    public function __construct(
        private CurrentTeamContext $currentTeamContext,
        private CurrentTeamResources $currentTeamResources,
    ) {}

    /**
     * @param  array{
     *     scope: string,
     *     project_uuid?: string|null,
     *     environment_uuid?: string|null,
     *     server_uuid?: string|null,
     * }  $input
     * @return array{
     *     type: string,
     *     project_id: int|null,
     *     environment_id: int|null,
     *     server_id: int|null,
     * }
     */
    public function resolveForCreate(User $user, array $input): array
    {
        $team = $this->currentTeamContext->resolve($user);
        $scope = $input['scope'];

        return match ($scope) {
            'team' => [
                'type' => 'team',
                'project_id' => null,
                'environment_id' => null,
                'server_id' => null,
            ],
            'project' => $this->resolveProjectScope($user, $team, $input['project_uuid'] ?? null),
            'environment' => $this->resolveEnvironmentScope(
                $user,
                $team,
                $input['project_uuid'] ?? null,
                $input['environment_uuid'] ?? null,
            ),
            'server' => $this->resolveServerScope($user, $team, $input['server_uuid'] ?? null),
            default => throw ValidationException::withMessages([
                'scope' => ['Unknown shared variable scope.'],
            ]),
        };
    }

    /**
     * @return array{
     *     type: string,
     *     project_id: int|null,
     *     environment_id: int|null,
     *     server_id: int|null,
     * }
     */
    private function resolveProjectScope(User $user, Team $team, ?string $projectUuid): array
    {
        if (! filled($projectUuid)) {
            throw ValidationException::withMessages([
                'project_uuid' => ['A project is required for project-scoped variables.'],
            ]);
        }

        $project = $this->currentTeamResources->project($user, $projectUuid);
        abort_unless($project->team_id === $team->id, 404);

        return [
            'type' => 'project',
            'project_id' => $project->id,
            'environment_id' => null,
            'server_id' => null,
        ];
    }

    /**
     * @return array{
     *     type: string,
     *     project_id: int|null,
     *     environment_id: int|null,
     *     server_id: int|null,
     * }
     */
    private function resolveEnvironmentScope(
        User $user,
        Team $team,
        ?string $projectUuid,
        ?string $environmentUuid,
    ): array {
        if (! filled($projectUuid) || ! filled($environmentUuid)) {
            throw ValidationException::withMessages([
                'environment_uuid' => ['A project and environment are required for environment-scoped variables.'],
            ]);
        }

        $environment = $this->currentTeamResources->environment($user, $projectUuid, $environmentUuid);
        abort_unless(
            Project::query()->whereKey($environment->project_id)->where('team_id', $team->id)->exists(),
            404
        );

        return [
            'type' => 'environment',
            'project_id' => $environment->project_id,
            'environment_id' => $environment->id,
            'server_id' => null,
        ];
    }

    /**
     * @return array{
     *     type: string,
     *     project_id: int|null,
     *     environment_id: int|null,
     *     server_id: int|null,
     * }
     */
    private function resolveServerScope(User $user, Team $team, ?string $serverUuid): array
    {
        if (! filled($serverUuid)) {
            throw ValidationException::withMessages([
                'server_uuid' => ['A server is required for server-scoped variables.'],
            ]);
        }

        $server = Server::query()
            ->where('team_id', $team->id)
            ->where('uuid', $serverUuid)
            ->firstOrFail();

        return [
            'type' => 'server',
            'project_id' => null,
            'environment_id' => null,
            'server_id' => $server->id,
        ];
    }

    public function assertUniqueKey(Team $team, string $key, array $scopeAttributes, ?int $ignoreId = null): void
    {
        $query = SharedEnvironmentVariable::query()
            ->where('team_id', $team->id)
            ->where('key', $key)
            ->where('type', $scopeAttributes['type']);

        if ($scopeAttributes['project_id']) {
            $query->where('project_id', $scopeAttributes['project_id']);
        } else {
            $query->whereNull('project_id');
        }

        if ($scopeAttributes['environment_id']) {
            $query->where('environment_id', $scopeAttributes['environment_id']);
        } else {
            $query->whereNull('environment_id');
        }

        if ($scopeAttributes['server_id']) {
            $query->where('server_id', $scopeAttributes['server_id']);
        } else {
            $query->whereNull('server_id');
        }

        if ($ignoreId) {
            $query->where('id', '!=', $ignoreId);
        }

        if ($query->exists()) {
            throw ValidationException::withMessages([
                'key' => ['A variable with this key already exists for the selected scope.'],
            ]);
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function scopeAttributes(SharedEnvironmentVariable $variable): array
    {
        return [
            'type' => $variable->type,
            'project_id' => $variable->project_id,
            'environment_id' => $variable->environment_id,
            'server_id' => $variable->server_id,
        ];
    }
}
