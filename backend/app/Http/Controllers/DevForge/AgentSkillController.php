<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\AiAgent;
use App\Models\AiAgentSkill;
use App\Models\User;
use App\Services\DevForge\Agent\AgentSkillService;
use App\Services\DevForge\Core\CurrentTeamContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;

class AgentSkillController extends Controller
{
    public function __construct(
        private readonly CurrentTeamContext $currentTeamContext,
        private readonly AgentSkillService $skills,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $this->ensureTable();
        $user = $request->user();
        abort_unless($user instanceof User, 401);
        $team = $this->currentTeamContext->resolve($user);
        $this->authorize('viewAny', AiAgent::class);

        $agent = null;
        if ($request->filled('agent_uuid')) {
            $agent = AiAgent::query()
                ->where('team_id', $team->id)
                ->where('uuid', (string) $request->input('agent_uuid'))
                ->first();
        }

        $query = is_string($request->query('q')) ? $request->query('q') : null;
        $rows = $this->skills->catalog($team, $agent, $query, 100);

        return response()->json([
            'data' => $rows->map(fn (AiAgentSkill $row) => $this->present($row))->values(),
            'meta' => ['count' => $rows->count()],
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $this->ensureTable();
        $user = $request->user();
        abort_unless($user instanceof User, 401);
        $team = $this->currentTeamContext->resolve($user);
        $this->authorize('viewAny', AiAgent::class);

        $validated = $request->validate([
            'slug' => ['required', 'string', 'max:120'],
            'name' => ['required', 'string', 'max:200'],
            'description' => ['required', 'string', 'max:500'],
            'body' => ['required', 'string', 'max:40000'],
            'tags' => ['nullable', 'array'],
            'tags.*' => ['string', 'max:64'],
            'agent_uuid' => ['nullable', 'string', 'max:64'],
            'is_active' => ['nullable', 'boolean'],
            'priority' => ['nullable', 'integer', 'min:0', 'max:1000'],
        ]);

        $agent = null;
        if (! empty($validated['agent_uuid'])) {
            $agent = AiAgent::query()
                ->where('team_id', $team->id)
                ->where('uuid', $validated['agent_uuid'])
                ->first();
            abort_unless($agent, 422, 'Agent introuvable.');
            $this->authorize('update', $agent);
        }

        $result = $this->skills->write(
            team: $team,
            slug: $validated['slug'],
            name: $validated['name'],
            description: $validated['description'],
            body: $validated['body'],
            agent: $agent,
            tags: $validated['tags'] ?? null,
            isActive: $validated['is_active'] ?? true,
            priority: (int) ($validated['priority'] ?? 0),
        );

        if (is_array($result) && isset($result['error'])) {
            abort(422, $result['error']);
        }

        /** @var AiAgentSkill $result */
        return response()->json(['data' => $this->present($result)], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $this->ensureTable();
        $user = $request->user();
        abort_unless($user instanceof User, 401);
        $team = $this->currentTeamContext->resolve($user);

        $row = AiAgentSkill::query()->where('team_id', $team->id)->whereKey($id)->first();
        abort_unless($row, 404, 'Skill introuvable.');

        if ($row->agent_id) {
            $agent = AiAgent::query()->where('team_id', $team->id)->whereKey($row->agent_id)->first();
            abort_unless($agent, 404);
            $this->authorize('update', $agent);
        } else {
            $this->authorize('viewAny', AiAgent::class);
        }

        $validated = $request->validate([
            'name' => ['sometimes', 'string', 'max:200'],
            'description' => ['sometimes', 'string', 'max:500'],
            'body' => ['sometimes', 'string', 'max:40000'],
            'tags' => ['nullable', 'array'],
            'tags.*' => ['string', 'max:64'],
            'is_active' => ['nullable', 'boolean'],
            'priority' => ['nullable', 'integer', 'min:0', 'max:1000'],
        ]);

        $row->fill([
            'name' => $validated['name'] ?? $row->name,
            'description' => $validated['description'] ?? $row->description,
            'body' => $validated['body'] ?? $row->body,
            'tags' => array_key_exists('tags', $validated) ? ($validated['tags'] ?? []) : $row->tags,
            'is_active' => $validated['is_active'] ?? $row->is_active,
            'priority' => array_key_exists('priority', $validated) ? (int) $validated['priority'] : $row->priority,
            'is_builtin' => false,
        ]);
        $row->save();

        return response()->json(['data' => $this->present($row->fresh())]);
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $this->ensureTable();
        $user = $request->user();
        abort_unless($user instanceof User, 401);
        $team = $this->currentTeamContext->resolve($user);

        $row = AiAgentSkill::query()->where('team_id', $team->id)->whereKey($id)->first();
        abort_unless($row, 404, 'Skill introuvable.');

        if ($row->agent_id) {
            $agent = AiAgent::query()->where('team_id', $team->id)->whereKey($row->agent_id)->first();
            if ($agent) {
                $this->authorize('update', $agent);
            }
        } else {
            $this->authorize('viewAny', AiAgent::class);
        }

        $row->delete();

        return response()->json(['ok' => true]);
    }

    /** @return array<string, mixed> */
    private function present(AiAgentSkill $row): array
    {
        return [
            'id' => $row->id,
            'slug' => $row->slug,
            'name' => $row->name,
            'description' => $row->description,
            'body' => $row->body,
            'tags' => $row->tags ?? [],
            'agent_id' => $row->agent_id,
            'is_active' => (bool) $row->is_active,
            'is_builtin' => (bool) $row->is_builtin,
            'priority' => (int) $row->priority,
            'created_at' => $row->created_at?->toISOString(),
            'updated_at' => $row->updated_at?->toISOString(),
        ];
    }

    private function ensureTable(): void
    {
        abort_unless(Schema::hasTable('ai_agent_skills'), 503, 'Skills indisponibles (migration manquante).');
    }
}
