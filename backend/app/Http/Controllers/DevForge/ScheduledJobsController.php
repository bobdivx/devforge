<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\DockerCleanupExecution;
use App\Models\ScheduledDatabaseBackup;
use App\Models\ScheduledDatabaseBackupExecution;
use App\Models\ScheduledTask;
use App\Models\ScheduledTaskExecution;
use App\Models\Server;
use App\Models\ServiceDatabase;
use App\Models\StandaloneClickhouse;
use App\Models\StandaloneDragonfly;
use App\Models\StandaloneKeydb;
use App\Models\StandaloneMariadb;
use App\Models\StandaloneMongodb;
use App\Models\StandaloneMysql;
use App\Models\StandalonePostgresql;
use App\Models\StandaloneRedis;
use App\Services\SchedulerLogParser;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

class ScheduledJobsController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $teamId = currentTeam()->id;
        $filterType = $request->query('type', 'all');
        $filterDate = $request->query('date', 'last_24h');
        $skipPage = (int) $request->query('skip', 0);
        $skipDefaultTake = 20;

        $dateFrom = $this->getDateFrom($filterDate);

        $executions = $this->getExecutions($dateFrom, $filterType, $teamId);

        $parser = new SchedulerLogParser();
        $allSkips = $parser->getRecentSkips(500, $teamId);
        $skipTotalCount = $allSkips->count();
        $skipLogs = $this->enrichSkipLogsWithLinks(
            $allSkips->slice($skipPage, $skipDefaultTake)->values()
        );

        $managerRuns = $parser->getRecentRuns(30, $teamId);

        return response()->json([
            'data' => [
                'executions' => $executions,
                'skips' => [
                    'logs' => $skipLogs,
                    'totalCount' => $skipTotalCount,
                    'hasPrev' => $skipPage > 0,
                    'hasNext' => ($skipPage + $skipDefaultTake) < $skipTotalCount,
                    'currentPage' => intval($skipPage / $skipDefaultTake) + 1,
                ],
                'managerRuns' => $managerRuns,
            ]
        ]);
    }

    public function definitions(): JsonResponse
    {
        $teamId = currentTeam()->id;

        $tasks = ScheduledTask::with(['application.environment.project', 'service.environment.project'])
            ->where('team_id', $teamId)
            ->orderBy('created_at', 'desc')
            ->get();

        $backups = ScheduledDatabaseBackup::with(['database'])
            ->where('team_id', $teamId)
            ->orderBy('created_at', 'desc')
            ->get()
            ->loadMorph('database', [
                ServiceDatabase::class => ['service.environment.project'],
                StandaloneClickhouse::class => ['environment.project'],
                StandaloneDragonfly::class => ['environment.project'],
                StandaloneKeydb::class => ['environment.project'],
                StandaloneMariadb::class => ['environment.project'],
                StandaloneMongodb::class => ['environment.project'],
                StandaloneMysql::class => ['environment.project'],
                StandalonePostgresql::class => ['environment.project'],
                StandaloneRedis::class => ['environment.project'],
            ]);

        $formattedTasks = $tasks->map(function ($task) {
            $resource = $task->application ?? $task->service;
            $environment = $resource?->environment;
            $project = $environment?->project;

            return [
                'id' => $task->id,
                'uuid' => $task->uuid,
                'type' => 'task',
                'name' => $task->name,
                'command' => $task->command,
                'frequency' => $task->frequency,
                'enabled' => $task->enabled,
                'resource_name' => $resource?->name ?? 'Inconnu',
                'resource_type' => $task->application_id ? 'applications' : 'services',
                'resource_uuid' => $resource?->uuid,
                'project_name' => $project?->name,
                'environment_name' => $environment?->name,
                'link' => ($project && $environment && $resource) 
                    ? "/projects/{$project->uuid}/environments/{$environment->uuid}/" . 
                      ($task->application_id ? "applications" : "services") . 
                      "/{$resource->uuid}?tab=scheduled-tasks" 
                    : null,
            ];
        });

        $formattedBackups = $backups->map(function ($backup) {
            $database = $backup->database;
            $isService = $database instanceof ServiceDatabase;
            
            $resource = $isService ? $database->service : $database;
            $environment = $resource?->environment;
            $project = $environment?->project;

            return [
                'id' => $backup->id,
                'uuid' => $backup->uuid,
                'type' => 'backup',
                'name' => 'Sauvegarde BDD',
                'command' => null,
                'frequency' => $backup->frequency,
                'enabled' => $backup->enabled,
                'resource_name' => $database?->name ?? 'Inconnu',
                'resource_type' => $isService ? 'services' : 'databases',
                'resource_uuid' => $isService ? $resource?->uuid : $database?->uuid,
                'project_name' => $project?->name,
                'environment_name' => $environment?->name,
                'link' => ($project && $environment && $resource)
                    ? "/projects/{$project->uuid}/environments/{$environment->uuid}/" . 
                      ($isService ? "services" : "databases") . 
                      "/{$resource->uuid}?tab=backups"
                    : null,
            ];
        });

        $definitions = $formattedTasks->concat($formattedBackups)
            ->sortByDesc('created_at')
            ->values();

        return response()->json([
            'data' => [
                'definitions' => $definitions,
            ]
        ]);
    }

    private function getExecutions(?Carbon $dateFrom, string $filterType, ?int $teamId): Collection
    {
        $backups = collect();
        $tasks = collect();
        $cleanups = collect();

        if ($filterType === 'all' || $filterType === 'backup') {
            $backups = $this->getBackupExecutions($dateFrom, $teamId);
        }

        if ($filterType === 'all' || $filterType === 'task') {
            $tasks = $this->getTaskExecutions($dateFrom, $teamId);
        }

        if ($filterType === 'all' || $filterType === 'cleanup') {
            $cleanups = $this->getCleanupExecutions($dateFrom, $teamId);
        }

        return $backups->concat($tasks)->concat($cleanups)
            ->sortByDesc('created_at')
            ->values()
            ->take(100);
    }

    private function getBackupExecutions(?Carbon $dateFrom, ?int $teamId): Collection
    {
        $query = ScheduledDatabaseBackupExecution::with(['scheduledDatabaseBackup.database', 'scheduledDatabaseBackup.team'])
            ->where('status', 'failed')
            ->when($dateFrom, fn ($q) => $q->where('created_at', '>=', $dateFrom))
            ->when($teamId, fn ($q) => $q->whereRelation('scheduledDatabaseBackup.team', 'id', $teamId))
            ->orderBy('created_at', 'desc')
            ->limit(100)
            ->get();

        return $query->map(function ($execution) {
            $backup = $execution->scheduledDatabaseBackup;
            $database = $backup?->database;
            $server = $backup?->server();

            return [
                'id' => $execution->id,
                'type' => 'backup',
                'status' => $execution->status ?? 'unknown',
                'resource_name' => $database?->name ?? 'Deleted database',
                'resource_type' => $database ? class_basename($database) : null,
                'server_name' => $server?->name ?? 'Unknown',
                'server_id' => $server?->id,
                'team_id' => $backup?->team_id,
                'created_at' => $execution->created_at,
                'finished_at' => $execution->updated_at,
                'message' => $execution->message,
                'size' => $execution->size ?? null,
            ];
        });
    }

    private function getTaskExecutions(?Carbon $dateFrom, ?int $teamId): Collection
    {
        $query = ScheduledTaskExecution::with(['scheduledTask.application', 'scheduledTask.service'])
            ->where('status', 'failed')
            ->when($dateFrom, fn ($q) => $q->where('created_at', '>=', $dateFrom))
            ->when($teamId, function ($q) use ($teamId) {
                $q->whereRelation('scheduledTask', 'team_id', $teamId);
            })
            ->orderBy('created_at', 'desc')
            ->limit(100)
            ->get();

        return $query->map(function ($execution) {
            $task = $execution->scheduledTask;
            $resource = $task?->application ?? $task?->service;
            $server = $task?->server();
            $teamId = $server?->team_id;

            return [
                'id' => $execution->id,
                'type' => 'task',
                'status' => $execution->status ?? 'unknown',
                'resource_name' => $task?->name ?? 'Deleted task',
                'resource_type' => $resource ? class_basename($resource) : null,
                'server_name' => $server?->name ?? 'Unknown',
                'server_id' => $server?->id,
                'team_id' => $teamId,
                'created_at' => $execution->created_at,
                'finished_at' => $execution->finished_at,
                'message' => $execution->message,
                'size' => null,
            ];
        });
    }

    private function getCleanupExecutions(?Carbon $dateFrom, ?int $teamId): Collection
    {
        $query = DockerCleanupExecution::with(['server'])
            ->where('status', 'failed')
            ->when($dateFrom, fn ($q) => $q->where('created_at', '>=', $dateFrom))
            ->when($teamId, fn ($q) => $q->whereRelation('server', 'team_id', $teamId))
            ->orderBy('created_at', 'desc')
            ->limit(100)
            ->get();

        return $query->map(function ($execution) {
            $server = $execution->server;

            return [
                'id' => $execution->id,
                'type' => 'cleanup',
                'status' => $execution->status ?? 'unknown',
                'resource_name' => $server?->name ?? 'Deleted server',
                'resource_type' => 'Server',
                'server_name' => $server?->name ?? 'Unknown',
                'server_id' => $server?->id,
                'team_id' => $server?->team_id,
                'created_at' => $execution->created_at,
                'finished_at' => $execution->finished_at ?? $execution->updated_at,
                'message' => $execution->message,
                'size' => null,
            ];
        });
    }

    private function enrichSkipLogsWithLinks(Collection $skipLogs): Collection
    {
        $taskIds = $skipLogs->where('type', 'task')->pluck('context.task_id')->filter()->unique()->values();
        $backupIds = $skipLogs->where('type', 'backup')->pluck('context.backup_id')->filter()->unique()->values();
        $serverIds = $skipLogs->where('type', 'docker_cleanup')->pluck('context.server_id')->filter()->unique()->values();

        $tasks = $taskIds->isNotEmpty()
            ? ScheduledTask::with(['application.environment.project', 'service.environment.project'])->whereIn('id', $taskIds)->get()->keyBy('id')
            : collect();

        $backups = $backupIds->isNotEmpty()
            ? ScheduledDatabaseBackup::with('database')
                ->whereIn('id', $backupIds)
                ->get()
                ->loadMorph('database', [
                    ServiceDatabase::class => ['service.environment.project'],
                    StandaloneClickhouse::class => ['environment.project'],
                    StandaloneDragonfly::class => ['environment.project'],
                    StandaloneKeydb::class => ['environment.project'],
                    StandaloneMariadb::class => ['environment.project'],
                    StandaloneMongodb::class => ['environment.project'],
                    StandaloneMysql::class => ['environment.project'],
                    StandalonePostgresql::class => ['environment.project'],
                    StandaloneRedis::class => ['environment.project'],
                ])
                ->keyBy('id')
            : collect();

        $servers = $serverIds->isNotEmpty()
            ? Server::whereIn('id', $serverIds)->get()->keyBy('id')
            : collect();

        return $skipLogs->map(function (array $skip) use ($tasks, $backups, $servers): array {
            $skip['link'] = null;
            $skip['resource_name'] = null;

            if ($skip['type'] === 'task') {
                $task = $tasks->get($skip['context']['task_id'] ?? null);
                if ($task) {
                    $skip['resource_name'] = $skip['context']['task_name'] ?? $task->name;
                    $resource = $task->application ?? $task->service;
                    $environment = $resource?->environment;
                    $project = $environment?->project;
                    if ($project && $environment && $resource) {
                        $skip['link'] = "/projects/{$project->uuid}/environments/{$environment->uuid}/" . 
                            ($task->application_id ? "applications" : "services") . 
                            "/{$resource->uuid}?tab=scheduled-tasks";
                    }
                }
            } elseif ($skip['type'] === 'backup') {
                $backup = $backups->get($skip['context']['backup_id'] ?? null);
                if ($backup) {
                    $database = $backup->database;
                    $skip['resource_name'] = $database?->name ?? 'Database backup';

                    if ($database instanceof ServiceDatabase) {
                        $service = $database->service;
                        $environment = $service?->environment;
                        $project = $environment?->project;
                        if ($project && $environment && $service) {
                            $skip['link'] = "/projects/{$project->uuid}/environments/{$environment->uuid}/services/{$service->uuid}?tab=backups";
                        }
                    } else {
                        $environment = $database?->environment;
                        $project = $environment?->project;
                        if ($project && $environment && $database) {
                            $skip['link'] = "/projects/{$project->uuid}/environments/{$environment->uuid}/databases/{$database->uuid}?tab=backups";
                        }
                    }
                }
            } elseif ($skip['type'] === 'docker_cleanup') {
                $server = $servers->get($skip['context']['server_id'] ?? null);
                if ($server) {
                    $skip['resource_name'] = $server->name;
                    $skip['link'] = "/servers/{$server->uuid}";
                }
            }

            return $skip;
        });
    }

    private function getDateFrom(string $filterDate): ?Carbon
    {
        return match ($filterDate) {
            'last_24h' => now()->subDay(),
            'last_7d' => now()->subWeek(),
            'last_30d' => now()->subMonth(),
            default => null,
        };
    }
}
