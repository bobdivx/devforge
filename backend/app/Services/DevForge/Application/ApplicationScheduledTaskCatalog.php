<?php

namespace App\Services\DevForge\Application;

use App\Jobs\ScheduledTaskJob;
use App\Models\Application;
use App\Models\ScheduledTask;
use App\Models\ScheduledTaskExecution;
use App\Models\Service;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;

class ApplicationScheduledTaskCatalog
{
    /**
     * @return array<int, array<string, mixed>>
     */
    public function list(Application|Service $resource): array
    {
        return $resource->scheduled_tasks()
            ->with('latest_log')
            ->orderBy('name')
            ->get()
            ->map(fn (ScheduledTask $task): array => $this->present($task))
            ->values()
            ->all();
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public function store(Application|Service $resource, array $input): array
    {
        $validated = $this->validateInput($input, creating: true);
        $resource->loadMissing('environment.project');

        $attributes = [
            'name' => trim((string) $validated['name']),
            'command' => trim((string) $validated['command']),
            'frequency' => trim((string) $validated['frequency']),
            'container' => $this->nullableTrim($validated['container'] ?? null),
            'timeout' => (int) ($validated['timeout'] ?? 300),
            'enabled' => (bool) ($validated['enabled'] ?? true),
            'team_id' => $resource->environment?->project?->team_id,
        ];

        if ($resource instanceof Application) {
            $attributes['application_id'] = $resource->id;
        } else {
            $attributes['service_id'] = $resource->id;
        }

        $task = ScheduledTask::query()->create($attributes);

        return $this->present($task->load('latest_log'));
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public function update(Application|Service $resource, string $taskUuid, array $input): array
    {
        $task = $this->findTask($resource, $taskUuid);
        $validated = $this->validateInput($input, creating: false);

        if ($validated === []) {
            throw ValidationException::withMessages([
                'input' => 'Au moins un champ doit être fourni.',
            ]);
        }

        foreach (['name', 'command', 'frequency', 'container'] as $field) {
            if (! array_key_exists($field, $validated)) {
                continue;
            }

            $task->{$field} = $field === 'container'
                ? $this->nullableTrim($validated[$field])
                : trim((string) $validated[$field]);
        }

        if (array_key_exists('timeout', $validated)) {
            $task->timeout = (int) $validated['timeout'];
        }

        if (array_key_exists('enabled', $validated)) {
            $task->enabled = (bool) $validated['enabled'];
        }

        $task->save();

        return $this->present($task->fresh()->load('latest_log'));
    }

    public function destroy(Application|Service $resource, string $taskUuid): void
    {
        $this->findTask($resource, $taskUuid)->delete();
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function executions(Application|Service $resource, string $taskUuid, int $limit = 20): array
    {
        $task = $this->findTask($resource, $taskUuid);
        $limit = max(1, min($limit, 100));

        return $task->executions()
            ->limit($limit)
            ->get()
            ->map(fn (ScheduledTaskExecution $execution): array => $this->presentExecution($execution))
            ->values()
            ->all();
    }

    /**
     * @return array{queued: bool, task_uuid: string, message: string}
     */
    public function run(Application|Service $resource, string $taskUuid): array
    {
        $task = $this->findTask($resource, $taskUuid);

        ScheduledTaskJob::dispatch($task);

        return [
            'queued' => true,
            'task_uuid' => $task->uuid,
            'message' => 'Exécution de la tâche planifiée mise en file.',
        ];
    }

    private function findTask(Application|Service $resource, string $taskUuid): ScheduledTask
    {
        $task = $resource->scheduled_tasks()->where('uuid', $taskUuid)->first();

        if (! $task) {
            throw new HttpException(404, 'Tâche planifiée introuvable.');
        }

        return $task;
    }

    /**
     * @return array<string, mixed>
     */
    private function present(ScheduledTask $task): array
    {
        $latest = $task->relationLoaded('latest_log')
            ? $task->latest_log
            : $task->latest_log()->first();

        return [
            'uuid' => $task->uuid,
            'name' => $task->name,
            'command' => $task->command,
            'frequency' => $task->frequency,
            'container' => $task->container,
            'timeout' => (int) ($task->timeout ?? 300),
            'enabled' => (bool) $task->enabled,
            'latest_execution' => $latest instanceof ScheduledTaskExecution
                ? $this->presentExecution($latest)
                : null,
            'created_at' => $task->created_at?->toIso8601String(),
            'updated_at' => $task->updated_at?->toIso8601String(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function presentExecution(ScheduledTaskExecution $execution): array
    {
        return [
            'uuid' => $execution->uuid,
            'status' => $execution->status,
            'message' => $execution->message,
            'started_at' => $execution->started_at?->toIso8601String(),
            'finished_at' => $execution->finished_at?->toIso8601String(),
            'duration' => $execution->duration,
            'retry_count' => (int) ($execution->retry_count ?? 0),
            'created_at' => $execution->created_at?->toIso8601String(),
        ];
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    private function validateInput(array $input, bool $creating): array
    {
        $rules = [
            'name' => [$creating ? 'required' : 'sometimes', 'string', 'max:255'],
            'command' => [$creating ? 'required' : 'sometimes', 'string', 'max:5000'],
            'frequency' => [$creating ? 'required' : 'sometimes', 'string', 'max:255'],
            'container' => ['sometimes', 'nullable', 'string', 'max:255'],
            'timeout' => ['sometimes', 'integer', 'min:60', 'max:36000'],
            'enabled' => ['sometimes', 'boolean'],
        ];

        $validated = validator($input, $rules)->validate();

        if (array_key_exists('frequency', $validated) && ! validate_cron_expression($validated['frequency'])) {
            throw ValidationException::withMessages([
                'frequency' => 'Expression cron ou fréquence invalide.',
            ]);
        }

        return $validated;
    }

    private function nullableTrim(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $trimmed = trim((string) $value);

        return $trimmed === '' ? null : $trimmed;
    }
}
