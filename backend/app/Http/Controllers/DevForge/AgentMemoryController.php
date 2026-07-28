<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\AiAgent;
use App\Models\AiAgentMemory;
use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\Agent\AgentMemoryService;
use App\Services\DevForge\Core\CurrentTeamContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;

class AgentMemoryController extends Controller
{
    public function __construct(
        private readonly CurrentTeamContext $currentTeamContext,
        private readonly AgentMemoryService $memoryService,
    ) {}

    public function index(Request $request, string $uuid): JsonResponse
    {
        $agent = $this->findAgent($request, $uuid);
        $this->authorize('view', $agent);

        if (! Schema::hasTable('ai_agent_memories')) {
            return response()->json(['data' => [], 'meta' => ['degraded' => true]]);
        }

        $scope = $this->memoryService->parseScope($request->query('scope', 'agent'));
        $resourceUuid = is_string($request->query('resource_uuid')) ? $request->query('resource_uuid') : $agent->resource_uuid;
        $query = is_string($request->query('q')) ? $request->query('q') : null;

        $rows = $this->memoryService->listByScope(
            $agent->team,
            $scope,
            $agent,
            $resourceUuid,
            40,
            $query,
        );

        return response()->json([
            'data' => $rows->map(fn (AiAgentMemory $row) => $this->present($row))->values(),
            'meta' => ['scope' => $scope, 'count' => $rows->count()],
        ]);
    }

    public function store(Request $request, string $uuid): JsonResponse
    {
        $agent = $this->findAgent($request, $uuid);
        $this->authorize('update', $agent);

        $validated = $request->validate([
            'content' => ['required', 'string', 'max:8000'],
            'scope' => ['nullable', 'string', 'max:32'],
            'resource_uuid' => ['nullable', 'string', 'max:64'],
            'tags' => ['nullable', 'array'],
            'tags.*' => ['string', 'max:64'],
        ]);

        $result = $this->memoryService->write(
            $agent->team,
            $validated['content'],
            $validated['scope'] ?? AgentMemoryService::SCOPE_AGENT,
            $agent,
            $validated['resource_uuid'] ?? $agent->resource_uuid,
            $validated['tags'] ?? null,
        );

        if (is_array($result) && isset($result['error'])) {
            abort(422, $result['error']);
        }

        /** @var AiAgentMemory $result */
        return response()->json(['data' => $this->present($result)], 201);
    }

    public function destroy(Request $request, string $uuid, int $memoryId): JsonResponse
    {
        $agent = $this->findAgent($request, $uuid);
        $this->authorize('update', $agent);

        $deleted = AiAgentMemory::query()
            ->where('team_id', $agent->team_id)
            ->whereKey($memoryId)
            ->where(function ($q) use ($agent) {
                $q->where('agent_id', $agent->id)
                    ->orWhere('scope', AgentMemoryService::SCOPE_SHARED)
                    ->orWhere(function ($inner) use ($agent) {
                        $inner->where('scope', AgentMemoryService::SCOPE_PROJECT)
                            ->where('resource_uuid', $agent->resource_uuid);
                    });
            })
            ->delete();

        abort_unless($deleted > 0, 404, 'Mémoire introuvable.');

        return response()->json(['data' => ['deleted' => true]]);
    }

    public function clear(Request $request, string $uuid): JsonResponse
    {
        $agent = $this->findAgent($request, $uuid);
        $this->authorize('update', $agent);

        $validated = $request->validate([
            'scope' => ['required', 'string', 'max:32'],
        ]);

        $scope = $this->memoryService->parseScope($validated['scope']);
        $query = AiAgentMemory::query()->where('team_id', $agent->team_id)->where('scope', $scope);

        if ($scope === AgentMemoryService::SCOPE_AGENT) {
            $query->where('agent_id', $agent->id);
        } elseif ($scope === AgentMemoryService::SCOPE_PROJECT) {
            abort_unless(is_string($agent->resource_uuid) && $agent->resource_uuid !== '', 422, 'resource_uuid requis');
            $query->where('resource_uuid', $agent->resource_uuid);
        }

        $count = $query->delete();

        return response()->json(['data' => ['cleared' => $count, 'scope' => $scope]]);
    }

    /** @return array<string, mixed> */
    private function present(AiAgentMemory $row): array
    {
        return [
            'id' => $row->id,
            'scope' => $row->scope,
            'content' => $row->content,
            'tags' => $row->tags ?? [],
            'resource_uuid' => $row->resource_uuid,
            'created_at' => $row->created_at?->toISOString(),
        ];
    }

    private function findAgent(Request $request, string $uuid): AiAgent
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);
        $team = $this->currentTeamContext->resolve($user);
        $agent = AiAgent::where('uuid', $uuid)->where('team_id', $team->id)->first();
        abort_unless($agent, 404, 'Agent introuvable.');

        return $agent;
    }
}
