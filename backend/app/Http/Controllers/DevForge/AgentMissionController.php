<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\AiAgentMission;
use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\Agent\AgentMissionBoard;
use App\Services\DevForge\Core\CurrentTeamContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class AgentMissionController extends Controller
{
    public function __construct(
        private readonly CurrentTeamContext $currentTeamContext,
        private readonly AgentMissionBoard $missionBoard,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $team = $this->currentTeam($request);
        $this->authorize('viewAny', \App\Models\AiAgent::class);

        $filters = [
            'status' => is_string($request->query('status')) ? $request->query('status') : null,
            'kind' => is_string($request->query('kind')) ? $request->query('kind') : null,
            'q' => is_string($request->query('q')) ? $request->query('q') : null,
        ];

        $rows = $this->missionBoard->list($team, $filters, (int) $request->query('limit', 50));

        return response()->json([
            'data' => $rows->map(fn (AiAgentMission $m) => $this->present($m))->values(),
            'meta' => [
                'count' => $rows->count(),
                'available' => $this->missionBoard->available(),
                'kinds' => AgentMissionBoard::KINDS,
                'statuses' => AgentMissionBoard::STATUSES,
            ],
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $team = $this->currentTeam($request);
        $this->authorize('create', \App\Models\AiAgent::class);

        $validated = $request->validate([
            'title' => ['required', 'string', 'max:200'],
            'description' => ['nullable', 'string', 'max:8000'],
            'kind' => ['nullable', 'string', Rule::in(AgentMissionBoard::KINDS)],
            'status' => ['nullable', 'string', Rule::in(AgentMissionBoard::STATUSES)],
            'priority' => ['nullable', 'string', Rule::in(AgentMissionBoard::PRIORITIES)],
            'resource_uuid' => ['nullable', 'string', 'max:64'],
            'assignee_agent_uuid' => ['nullable', 'string', 'max:64'],
            'source' => ['nullable', 'string', 'max:64'],
            'dedupe_key' => ['nullable', 'string', 'max:190'],
            'metadata' => ['nullable', 'array'],
        ]);

        $result = $this->missionBoard->create($team, $validated);

        if (is_array($result) && isset($result['error'])) {
            abort(422, $result['error']);
        }

        /** @var AiAgentMission $result */
        return response()->json(['data' => $this->present($result)], 201);
    }

    public function update(Request $request, string $uuid): JsonResponse
    {
        $team = $this->currentTeam($request);
        $this->authorize('create', \App\Models\AiAgent::class);

        $validated = $request->validate([
            'title' => ['sometimes', 'string', 'max:200'],
            'description' => ['sometimes', 'nullable', 'string', 'max:8000'],
            'kind' => ['sometimes', 'string', Rule::in(AgentMissionBoard::KINDS)],
            'status' => ['sometimes', 'string', Rule::in(AgentMissionBoard::STATUSES)],
            'priority' => ['sometimes', 'string', Rule::in(AgentMissionBoard::PRIORITIES)],
            'resource_uuid' => ['sometimes', 'nullable', 'string', 'max:64'],
            'assignee_agent_uuid' => ['sometimes', 'nullable', 'string', 'max:64'],
            'metadata' => ['sometimes', 'nullable', 'array'],
        ]);

        $result = $this->missionBoard->update($team, $uuid, $validated);

        if (is_array($result) && isset($result['error'])) {
            abort(404, $result['error']);
        }

        /** @var AiAgentMission $result */
        return response()->json(['data' => $this->present($result)]);
    }

    private function currentTeam(Request $request): Team
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        return $this->currentTeamContext->resolve($user);
    }

    /** @return array<string, mixed> */
    private function present(AiAgentMission $mission): array
    {
        return [
            'uuid' => $mission->uuid,
            'kind' => $mission->kind,
            'status' => $mission->status,
            'priority' => $mission->priority,
            'title' => $mission->title,
            'description' => $mission->description,
            'source' => $mission->source,
            'resource_uuid' => $mission->resource_uuid,
            'agent_id' => $mission->agent_id,
            'assignee_agent_id' => $mission->assignee_agent_id,
            'metadata' => $mission->metadata ?? [],
            'created_at' => $mission->created_at?->toISOString(),
            'updated_at' => $mission->updated_at?->toISOString(),
            'completed_at' => $mission->completed_at?->toISOString(),
        ];
    }
}
