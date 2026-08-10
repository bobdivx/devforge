<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\AiAgentMission;
use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\Agent\AgentFeatureDelivery;
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
        private readonly AgentFeatureDelivery $featureDelivery,
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
            'assignee_type' => ['nullable', 'string', 'max:64'],
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
            'assignee_type' => ['sometimes', 'nullable', 'string', 'max:64'],
            'blocked_reason' => ['sometimes', 'nullable', 'string', 'max:1000'],
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
        $mission->loadMissing(['assignee:id,uuid,name,type', 'agent:id,uuid,name,type']);
        $metadata = $mission->metadata ?? [];

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
            'agent_uuid' => $mission->agent?->uuid,
            'agent_name' => $mission->agent?->name,
            'agent_type' => $mission->agent?->type,
            'assignee_agent_id' => $mission->assignee_agent_id,
            'assignee_uuid' => $mission->assignee?->uuid,
            'assignee_name' => $mission->assignee?->name,
            'assignee_type' => $mission->assignee?->type
                ?? (is_array($metadata) ? ($metadata['assignee_type'] ?? null) : null),
            'blocked_reason' => is_array($metadata) ? ($metadata['blocked_reason'] ?? null) : null,
            'run_uuid' => is_array($metadata) ? ($metadata['run_uuid'] ?? null) : null,
            'timeline' => is_array($metadata) && is_array($metadata['timeline'] ?? null)
                ? $metadata['timeline']
                : $this->buildTimeline($mission, is_array($metadata) ? $metadata : []),
            'metadata' => $metadata,
            'is_feature_delivery' => $this->featureDelivery->isFeatureDelivery($mission),
            'created_at' => $mission->created_at?->toISOString(),
            'updated_at' => $mission->updated_at?->toISOString(),
            'completed_at' => $mission->completed_at?->toISOString(),
        ];
    }

    /**
     * @param  array<string, mixed>  $metadata
     * @return list<array{at: string|null, label: string}>
     */
    private function buildTimeline(AiAgentMission $mission, array $metadata): array
    {
        $events = [];
        $events[] = [
            'at' => $mission->created_at?->toISOString(),
            'label' => 'Créée'.($mission->agent?->name ? ' par '.$mission->agent->name : ''),
        ];
        if (! empty($metadata['claimed_at'])) {
            $events[] = [
                'at' => (string) $metadata['claimed_at'],
                'label' => 'Prise en charge'.($mission->assignee?->name ? ' par '.$mission->assignee->name : ''),
            ];
        }
        if (! empty($metadata['blocked_reason'])) {
            $events[] = [
                'at' => $mission->updated_at?->toISOString(),
                'label' => 'Bloquée — '.$metadata['blocked_reason'],
            ];
        }
        if ($mission->status === 'done') {
            $events[] = [
                'at' => $mission->completed_at?->toISOString() ?? $mission->updated_at?->toISOString(),
                'label' => 'Terminée',
            ];
        }

        return $events;
    }
}
