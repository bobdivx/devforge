<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\AiAgentMission;
use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\Agent\AgentFeatureDelivery;
use App\Services\DevForge\Agent\AgentMissionBoard;
use App\Services\DevForge\Application\ApplicationSourceService;
use App\Services\DevForge\Core\CurrentTeamContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class AgentFeatureDeliveryController extends Controller
{
    public function __construct(
        private readonly CurrentTeamContext $currentTeamContext,
        private readonly AgentFeatureDelivery $featureDelivery,
        private readonly AgentMissionBoard $missionBoard,
        private readonly ApplicationSourceService $applicationSourceService,
    ) {}

    public function storeForApplication(Request $request, string $applicationUuid): JsonResponse
    {
        $team = $this->currentTeam($request);
        $this->authorize('create', \App\Models\AiAgent::class);

        $application = $this->applicationSourceService->applicationForTeam($team, $applicationUuid);

        $validated = $request->validate([
            'title' => ['required', 'string', 'max:200'],
            'description' => ['nullable', 'string', 'max:8000'],
            'priority' => ['nullable', 'string', Rule::in(AgentMissionBoard::PRIORITIES)],
            'dispatch_now' => ['nullable', 'boolean'],
        ]);

        $result = $this->featureDelivery->createRequest(
            $team,
            $application,
            (string) $validated['title'],
            $validated['description'] ?? null,
            (string) ($validated['priority'] ?? 'normal'),
            ($validated['dispatch_now'] ?? true) !== false,
        );

        if (isset($result['error'])) {
            return response()->json(['message' => $result['error']], 422);
        }

        /** @var AiAgentMission $mission */
        $mission = $result['mission'];

        return response()->json([
            'data' => [
                'mission' => $this->presentMission($mission),
                'dispatched' => (bool) $result['dispatched'],
                'run_uuid' => $result['run_uuid'],
                'feature_delivery' => $this->featureDelivery->deliveryStatus($team, $mission),
            ],
        ], 201);
    }

    public function show(Request $request, string $uuid): JsonResponse
    {
        $team = $this->currentTeam($request);
        $this->authorize('viewAny', \App\Models\AiAgent::class);
        $mission = $this->findMission($team, $uuid);

        return response()->json([
            'data' => [
                'mission' => $this->presentMission($mission),
                'feature_delivery' => $this->featureDelivery->deliveryStatus($team, $mission),
            ],
        ]);
    }

    public function validateMerge(Request $request, string $uuid): JsonResponse
    {
        $team = $this->currentTeam($request);
        $this->authorize('create', \App\Models\AiAgent::class);
        $mission = $this->findMission($team, $uuid);

        $validated = $request->validate([
            'merge_method' => ['nullable', 'string', Rule::in(['merge', 'squash', 'rebase'])],
        ]);

        $result = $this->featureDelivery->validateAndMerge(
            $team,
            $mission,
            (string) ($validated['merge_method'] ?? 'squash'),
        );

        if (isset($result['error'])) {
            return response()->json(['message' => $result['error']], 422);
        }

        return response()->json([
            'data' => [
                ...$result,
                'mission' => $this->presentMission($mission->fresh(['assignee', 'agent'])),
                'feature_delivery' => $this->featureDelivery->deliveryStatus($team, $mission->fresh()),
            ],
        ]);
    }

    public function requestChanges(Request $request, string $uuid): JsonResponse
    {
        $team = $this->currentTeam($request);
        $this->authorize('create', \App\Models\AiAgent::class);
        $mission = $this->findMission($team, $uuid);

        $validated = $request->validate([
            'feedback' => ['required', 'string', 'max:4000'],
        ]);

        $result = $this->featureDelivery->requestChanges($team, $mission, (string) $validated['feedback']);

        if (isset($result['error'])) {
            return response()->json(['message' => $result['error']], 422);
        }

        return response()->json([
            'data' => [
                ...$result,
                'mission' => $this->presentMission($mission->fresh(['assignee', 'agent'])),
                'feature_delivery' => $this->featureDelivery->deliveryStatus($team, $mission->fresh()),
            ],
        ]);
    }

    private function currentTeam(Request $request): Team
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        return $this->currentTeamContext->resolve($user);
    }

    private function findMission(Team $team, string $uuid): AiAgentMission
    {
        $mission = AiAgentMission::query()
            ->where('team_id', $team->id)
            ->where('uuid', $uuid)
            ->first();
        abort_unless($mission, 404, 'Mission introuvable.');

        return $mission;
    }

    /** @return array<string, mixed> */
    private function presentMission(AiAgentMission $mission): array
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
            'assignee_uuid' => $mission->assignee?->uuid,
            'assignee_name' => $mission->assignee?->name,
            'run_uuid' => is_array($metadata) ? ($metadata['run_uuid'] ?? null) : null,
            'metadata' => $metadata,
            'is_feature_delivery' => $this->featureDelivery->isFeatureDelivery($mission),
            'created_at' => $mission->created_at?->toISOString(),
            'updated_at' => $mission->updated_at?->toISOString(),
            'completed_at' => $mission->completed_at?->toISOString(),
        ];
    }
}
