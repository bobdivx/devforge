<?php

namespace App\Services\DevForge;

use App\Models\Application;
use App\Models\ApplicationDeploymentQueue;
use App\Models\Team;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;

class DeploymentData
{
    public function __construct(private readonly SecretRedactor $secretRedactor) {}

    public function paginate(Team $team, int $page, int $perPage, ?string $applicationUuid, ?string $status): LengthAwarePaginator
    {
        return $this->queryFor($team)
            ->when($applicationUuid, fn (Builder $query, string $uuid): Builder => $query->whereIn(
                'application_id',
                Application::query()
                    ->where('uuid', $uuid)
                    ->pluck('id')
                    ->map(static fn (mixed $id): string => (string) $id)
                    ->all(),
            ))
            ->when($status, fn (Builder $query, string $deploymentStatus): Builder => $query->where('status', $deploymentStatus))
            ->latest('id')
            ->paginate(perPage: $perPage, page: $page);
    }

    public function find(Team $team, string $deploymentUuid): ApplicationDeploymentQueue
    {
        $deployment = $this->queryFor($team)
            ->with('application')
            ->where('deployment_uuid', $deploymentUuid)
            ->first();

        abort_if(is_null($deployment), 404, 'Deployment not found.');

        return $deployment;
    }

    /**
     * @return array<string, mixed>
     */
    public function deployment(ApplicationDeploymentQueue $deployment): array
    {
        $application = $deployment->application;

        return [
            'uuid' => $deployment->deployment_uuid,
            'status' => $deployment->status,
            'pull_request_id' => (int) ($deployment->pull_request_id ?? 0),
            'commit' => $deployment->commit ?: null,
            'commit_message' => $deployment->commit_message && $application
                ? $this->secretRedactor->redact($deployment->commit_message, $application)
                : $deployment->commit_message,
            'force_rebuild' => (bool) $deployment->force_rebuild,
            'rollback' => (bool) $deployment->rollback,
            'created_at' => $deployment->created_at?->toISOString(),
            'updated_at' => $deployment->updated_at?->toISOString(),
            'finished_at' => $deployment->finished_at?->toISOString(),
            'application' => $application ? [
                'uuid' => $application->uuid,
                'name' => $application->name,
            ] : null,
            'is_debug_enabled' => (bool) data_get($application, 'settings.is_debug_enabled', false),
        ];
    }

    /**
     * @return array{items: array<int, array<string, mixed>>, next_cursor: int, complete: bool}
     */
    public function logs(ApplicationDeploymentQueue $deployment, int $after): array
    {
        $application = $deployment->application;
        $lines = decode_remote_command_output($deployment)
            ->values()
            ->map(function (array $line, int $index) use ($application): array {
                return [
                    'cursor' => $index + 1,
                    'timestamp' => data_get($line, 'timestamp'),
                    'stream' => data_get($line, 'stderr', false) ? 'stderr' : 'stdout',
                    'message' => $this->secretRedactor->redact((string) data_get($line, 'line', ''), $application),
                    'command' => (bool) data_get($line, 'command', false),
                    'hidden' => (bool) data_get($line, 'hidden', false),
                ];
            });

        return [
            'items' => $lines->where('cursor', '>', $after)->values()->all(),
            'next_cursor' => (int) ($lines->last()['cursor'] ?? $after),
            'complete' => in_array($deployment->status, ['finished', 'failed', 'cancelled-by-user'], true),
        ];
    }

    private function queryFor(Team $team): Builder
    {
        $applicationIds = Application::query()
            ->whereHas(
                'environment.project',
                fn (Builder $query): Builder => $query->where('team_id', $team->id),
            )
            ->pluck('id')
            ->map(static fn (mixed $id): string => (string) $id)
            ->all();

        return ApplicationDeploymentQueue::query()
            ->select([
                'id',
                'application_id',
                'deployment_uuid',
                'pull_request_id',
                'force_rebuild',
                'commit',
                'status',
                'logs',
                'rollback',
                'commit_message',
                'created_at',
                'updated_at',
                'finished_at',
            ])
            ->with('application:id,uuid,name,environment_id', 'application.settings')
            ->whereIn('application_id', $applicationIds);
    }
}
