<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\AiAgent;
use App\Models\AiAgentMission;
use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\Core\CurrentTeamContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class TaskBoardController extends Controller
{
    public function __construct(
        private readonly CurrentTeamContext $currentTeamContext,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $this->authorize('viewAny', AiAgentMission::class);
        $team = $this->currentTeam($request);

        $query = AiAgentMission::query()
            ->where('team_id', $team->id)
            ->with(['agent', 'assignee']);

        if ($request->has('status')) {
            $query->where('status', $request->input('status'));
        }

        if ($request->has('kind')) {
            $query->where('kind', $request->input('kind'));
        }

        if ($request->has('agent_id')) {
            $query->where('agent_id', $request->input('agent_id'));
        }

        $tasks = $query
            ->orderByRaw("CASE status WHEN 'in_progress' THEN 0 WHEN 'open' THEN 1 WHEN 'blocked' THEN 2 WHEN 'done' THEN 3 ELSE 4 END")
            ->orderByDesc('priority')
            ->orderByDesc('created_at')
            ->limit(200)
            ->get();

        return response()->json([
            'data' => $tasks->map(fn (AiAgentMission $task) => $this->present($task)),
            'meta' => ['count' => $tasks->count()],
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $this->authorize('create', AiAgentMission::class);
        $team = $this->currentTeam($request);

        $validated = $request->validate([
            'kind' => ['nullable', 'string', Rule::in(['bug', 'feature', 'tech_watch', 'github_pr', 'ops', 'other'])],
            'title' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:5000'],
            'priority' => ['nullable', 'string', Rule::in(['low', 'normal', 'high', 'urgent'])],
            'agent_id' => ['nullable', 'integer', Rule::exists('ai_agents', 'id')->where('team_id', $team->id)],
            'assignee_agent_id' => ['nullable', 'integer', Rule::exists('ai_agents', 'id')->where('team_id', $team->id)],
            'resource_uuid' => ['nullable', 'string', 'max:64'],
            'source' => ['nullable', 'string', 'max:64'],
            'due_at' => ['nullable', 'date'],
            'metadata' => ['nullable', 'array'],
        ]);

        $validated['team_id'] = $team->id;
        $validated['kind'] = $validated['kind'] ?? 'other';
        $validated['priority'] = $validated['priority'] ?? 'normal';
        $validated['status'] = 'open';

        if (! empty($validated['title'])) {
            $dedupeKey = $this->generateDedupeKey($validated['title'], $validated['kind']);
            $existing = AiAgentMission::query()
                ->where('team_id', $team->id)
                ->where('dedupe_key', $dedupeKey)
                ->first();

            if ($existing) {
                return response()->json([
                    'message' => 'Une tâche similaire existe déjà.',
                    'data' => $this->present($existing),
                ], 409);
            }

            $validated['dedupe_key'] = $dedupeKey;
        }

        $task = AiAgentMission::create($validated);

        return response()->json(['data' => $this->present($task)], 201);
    }

    public function show(Request $request, string $uuid): JsonResponse
    {
        $task = $this->findTask($this->currentTeam($request), $uuid);
        $this->authorize('view', $task);

        return response()->json(['data' => $this->present($task)]);
    }

    public function update(Request $request, string $uuid): JsonResponse
    {
        $team = $this->currentTeam($request);
        $task = $this->findTask($team, $uuid);
        $this->authorize('update', $task);

        $validated = $request->validate([
            'kind' => ['sometimes', 'string', Rule::in(['bug', 'feature', 'tech_watch', 'github_pr', 'ops', 'other'])],
            'status' => ['sometimes', 'string', Rule::in(['open', 'in_progress', 'blocked', 'done', 'cancelled'])],
            'priority' => ['sometimes', 'string', Rule::in(['low', 'normal', 'high', 'urgent'])],
            'title' => ['sometimes', 'string', 'max:255'],
            'description' => ['sometimes', 'nullable', 'string', 'max:5000'],
            'agent_id' => ['sometimes', 'nullable', 'integer', Rule::exists('ai_agents', 'id')->where('team_id', $team->id)],
            'assignee_agent_id' => ['sometimes', 'nullable', 'integer', Rule::exists('ai_agents', 'id')->where('team_id', $team->id)],
            'resource_uuid' => ['sometimes', 'nullable', 'string', 'max:64'],
            'due_at' => ['sometimes', 'nullable', 'date'],
            'metadata' => ['sometimes', 'nullable', 'array'],
        ]);

        if (isset($validated['status']) && $validated['status'] === 'done' && $task->status !== 'done') {
            $validated['completed_at'] = now();
        }

        $task->update($validated);

        return response()->json(['data' => $this->present($task->fresh())]);
    }

    public function destroy(Request $request, string $uuid): JsonResponse
    {
        $task = $this->findTask($this->currentTeam($request), $uuid);
        $this->authorize('delete', $task);
        $task->delete();

        return response()->json(['data' => ['deleted' => true]]);
    }

    private function currentTeam(Request $request): Team
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        return $this->currentTeamContext->resolve($user);
    }

    private function findTask(Team $team, string $uuid): AiAgentMission
    {
        $task = AiAgentMission::query()
            ->where('uuid', $uuid)
            ->where('team_id', $team->id)
            ->with(['agent', 'assignee'])
            ->first();

        abort_unless($task, 404, 'Tâche introuvable.');

        return $task;
    }

    /**
     * @param  array<string, mixed>  $task
     * @return array<string, mixed>
     */
    private function present(AiAgentMission $task): array
    {
        return [
            'uuid' => $task->uuid,
            'kind' => $task->kind,
            'status' => $task->status,
            'priority' => $task->priority,
            'title' => $task->title,
            'description' => $task->description,
            'source' => $task->source,
            'resource_uuid' => $task->resource_uuid,
            'agent' => $task->agent ? [
                'uuid' => $task->agent->uuid,
                'name' => $task->agent->name,
                'type' => $task->agent->type,
            ] : null,
            'assignee' => $task->assignee ? [
                'uuid' => $task->assignee->uuid,
                'name' => $task->assignee->name,
                'type' => $task->assignee->type,
            ] : null,
            'metadata' => $task->metadata,
            'due_at' => $task->due_at?->toISOString(),
            'completed_at' => $task->completed_at?->toISOString(),
            'created_at' => $task->created_at->toISOString(),
            'updated_at' => $task->updated_at->toISOString(),
        ];
    }

    private function generateDedupeKey(string $title, string $kind): string
    {
        $normalized = mb_strtolower(trim($title));
        $normalized = preg_replace('/[^a-z0-9]+/', '-', $normalized) ?? $normalized;
        $normalized = trim($normalized, '-');

        return substr($kind.'-'.$normalized, 0, 255);
    }
}
