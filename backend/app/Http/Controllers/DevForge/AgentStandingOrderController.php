<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\AiAgent;
use App\Models\AiAgentStandingOrder;
use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\Core\CurrentTeamContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;

class AgentStandingOrderController extends Controller
{
    public function __construct(
        private readonly CurrentTeamContext $currentTeamContext,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $this->ensureTable();
        $team = $this->currentTeam($request);
        $this->authorize('viewAny', AiAgent::class);

        $query = AiAgentStandingOrder::query()
            ->where('team_id', $team->id)
            ->orderByDesc('priority')
            ->orderBy('id');

        if ($request->filled('resource_uuid')) {
            $query->where('resource_uuid', (string) $request->input('resource_uuid'));
        }

        if ($request->filled('agent_uuid')) {
            $agentId = AiAgent::query()
                ->where('team_id', $team->id)
                ->where('uuid', (string) $request->input('agent_uuid'))
                ->value('id');
            $query->where(function ($q) use ($agentId) {
                $q->whereNull('agent_id');
                if ($agentId) {
                    $q->orWhere('agent_id', $agentId);
                }
            });
        }

        return response()->json([
            'data' => $query->limit(100)->get()->map(fn (AiAgentStandingOrder $row) => $this->present($row))->values(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $this->ensureTable();
        $team = $this->currentTeam($request);

        $validated = $request->validate([
            'title' => ['required', 'string', 'max:200'],
            'body' => ['required', 'string', 'max:20000'],
            'scope' => ['nullable', 'string', 'max:50'],
            'resource_uuid' => ['nullable', 'string', 'max:64'],
            'agent_uuid' => ['nullable', 'string', 'max:64'],
            'triggers' => ['nullable', 'array'],
            'triggers.*' => ['string', 'max:80'],
            'approval_gates' => ['nullable', 'string', 'max:2000'],
            'escalation' => ['nullable', 'string', 'max:2000'],
            'priority' => ['nullable', 'integer', 'min:0', 'max:1000'],
            'is_active' => ['nullable', 'boolean'],
        ]);

        $agentId = null;
        if (! empty($validated['agent_uuid'])) {
            $agentId = AiAgent::query()
                ->where('team_id', $team->id)
                ->where('uuid', $validated['agent_uuid'])
                ->value('id');
            abort_unless($agentId, 422, 'Agent introuvable.');
        }

        $row = AiAgentStandingOrder::create([
            'team_id' => $team->id,
            'agent_id' => $agentId,
            'resource_uuid' => $validated['resource_uuid'] ?? null,
            'title' => $validated['title'],
            'scope' => $validated['scope'] ?? 'app',
            'triggers' => $validated['triggers'] ?? ['deploy_failed', 'heartbeat', 'cron'],
            'approval_gates' => $validated['approval_gates'] ?? null,
            'escalation' => $validated['escalation'] ?? null,
            'body' => $validated['body'],
            'priority' => (int) ($validated['priority'] ?? 0),
            'is_active' => $validated['is_active'] ?? true,
        ]);

        return response()->json(['data' => $this->present($row)], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $this->ensureTable();
        $team = $this->currentTeam($request);
        $row = AiAgentStandingOrder::query()->where('team_id', $team->id)->whereKey($id)->firstOrFail();

        $validated = $request->validate([
            'title' => ['sometimes', 'string', 'max:200'],
            'body' => ['sometimes', 'string', 'max:20000'],
            'scope' => ['nullable', 'string', 'max:50'],
            'resource_uuid' => ['nullable', 'string', 'max:64'],
            'triggers' => ['nullable', 'array'],
            'triggers.*' => ['string', 'max:80'],
            'approval_gates' => ['nullable', 'string', 'max:2000'],
            'escalation' => ['nullable', 'string', 'max:2000'],
            'priority' => ['nullable', 'integer', 'min:0', 'max:1000'],
            'is_active' => ['nullable', 'boolean'],
        ]);

        $row->fill($validated);
        $row->save();

        return response()->json(['data' => $this->present($row->fresh())]);
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $this->ensureTable();
        $team = $this->currentTeam($request);
        $row = AiAgentStandingOrder::query()->where('team_id', $team->id)->whereKey($id)->firstOrFail();
        $row->delete();

        return response()->json(['ok' => true]);
    }

    private function currentTeam(Request $request): Team
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        return $this->currentTeamContext->resolve($user);
    }

    private function ensureTable(): void
    {
        abort_unless(Schema::hasTable('ai_agent_standing_orders'), 503, 'Standing orders indisponibles (migration manquante).');
    }

    /** @return array<string, mixed> */
    private function present(AiAgentStandingOrder $row): array
    {
        return [
            'id' => $row->id,
            'title' => $row->title,
            'scope' => $row->scope,
            'resource_uuid' => $row->resource_uuid,
            'agent_id' => $row->agent_id,
            'triggers' => $row->triggers ?? [],
            'approval_gates' => $row->approval_gates,
            'escalation' => $row->escalation,
            'body' => $row->body,
            'priority' => $row->priority,
            'is_active' => $row->is_active,
            'created_at' => $row->created_at?->toISOString(),
            'updated_at' => $row->updated_at?->toISOString(),
        ];
    }
}
