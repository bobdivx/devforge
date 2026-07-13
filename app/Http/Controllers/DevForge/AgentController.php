<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\AiAgent;
use App\Models\AiProviderConfig;
use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\Agent\AgentRunLauncher;
use App\Services\DevForge\Core\CurrentTeamContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\Rule;

class AgentController extends Controller
{
    public function __construct(
        private readonly CurrentTeamContext $currentTeamContext,
        private readonly AgentRunLauncher $agentRunLauncher,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $this->authorize('viewAny', AiAgent::class);
        $team = $this->currentTeam($request);

        $agents = AiAgent::query()
            ->where('team_id', $team->id)
            ->with($this->agentRelations())
            ->orderBy('type')
            ->orderBy('name')
            ->get();

        foreach ($agents as $agent) {
            $agent->recoverIfInterrupted();
            $agent->refresh();
        }

        $presented = $agents->map(fn (AiAgent $agent) => $this->present($agent));

        return response()->json([
            'data' => $presented,
            'meta' => ['count' => $presented->count()],
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $this->authorize('create', AiAgent::class);
        $team = $this->currentTeam($request);

        $validated = $request->validate([
            'type' => ['required', 'string', Rule::in(['debug', 'tech-watch', 'github', 'devforge', 'deployment', 'security'])],
            'name' => ['required', 'string', 'max:100'],
            'description' => ['nullable', 'string', 'max:500'],
            'avatar_color' => ['nullable', 'string', 'max:20'],
            'system_prompt' => ['nullable', 'string', 'max:5000'],
            'provider_config_id' => ['nullable', 'integer', Rule::exists('ai_provider_configs', 'id')->where('team_id', $team->id)],
            'fallback_provider_config_id' => ['nullable', 'integer', Rule::exists('ai_provider_configs', 'id')->where('team_id', $team->id)],
            'parent_agent_id' => ['nullable', 'integer', Rule::exists('ai_agents', 'id')->where('team_id', $team->id)],
            'resource_uuid' => ['nullable', 'string', 'max:64'],
            'schedule_minutes' => ['nullable', 'integer', 'min:0'],
            'is_active' => ['nullable', 'boolean'],
        ]);

        if (empty($validated['provider_config_id'])) {
            $defaultProvider = AiProviderConfig::query()
                ->where('team_id', $team->id)
                ->where('is_default', true)
                ->first();

            if ($defaultProvider) {
                $validated['provider_config_id'] = $defaultProvider->id;
            }
        }

        $agent = AiAgent::create([
            'team_id' => $team->id,
            ...$this->normalizeAgentInput($validated),
        ]);

        return response()->json(['data' => $this->present($agent->load($this->agentRelations(false)))], 201);
    }

    public function show(Request $request, string $uuid): JsonResponse
    {
        $agent = $this->findAgent($request, $uuid);
        $this->authorize('view', $agent);

        return response()->json([
            'data' => $this->present($agent->load([
                ...$this->agentRelations(false),
                'subAgents',
                'runs' => fn ($q) => $q->latest()->limit(5),
            ])),
        ]);
    }

    public function update(Request $request, string $uuid): JsonResponse
    {
        $team = $this->currentTeam($request);
        $agent = $this->findAgent($request, $uuid);
        $this->authorize('update', $agent);

        $validated = $request->validate([
            'name' => ['sometimes', 'string', 'max:100'],
            'description' => ['sometimes', 'nullable', 'string', 'max:500'],
            'avatar_color' => ['sometimes', 'nullable', 'string', 'max:20'],
            'system_prompt' => ['sometimes', 'nullable', 'string', 'max:5000'],
            'provider_config_id' => ['sometimes', 'nullable', 'integer', Rule::exists('ai_provider_configs', 'id')->where('team_id', $team->id)],
            'fallback_provider_config_id' => ['sometimes', 'nullable', 'integer', Rule::exists('ai_provider_configs', 'id')->where('team_id', $team->id)],
            'schedule_minutes' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'is_active' => ['sometimes', 'boolean'],
            'status' => ['sometimes', 'string', Rule::in(['idle', 'paused'])],
        ]);

        $agent->update($this->normalizeAgentInput($validated, $agent));

        return response()->json(['data' => $this->present($agent->fresh($this->agentRelations(false)))]);
    }

    public function destroy(Request $request, string $uuid): JsonResponse
    {
        $agent = $this->findAgent($request, $uuid);
        $this->authorize('delete', $agent);
        $agent->delete();

        return response()->json(['data' => ['deleted' => true]]);
    }

    public function run(Request $request, string $uuid): JsonResponse
    {
        $agent = $this->findAgent($request, $uuid);
        $this->authorize('run', $agent);

        $agent->prepareForManualRun();
        $agent->refresh();

        abort_if($agent->status === 'running', 409, 'L\'agent est déjà en cours d\'exécution. Attendez la fin ou réessayez dans un instant.');
        abort_if(! $agent->is_active, 422, 'L\'agent est inactif.');
        abort_if(! $agent->provider_config_id, 422, 'Aucun provider LLM configuré.');

        $run = $this->agentRunLauncher->queue($agent, 'manual');

        abort_if($run === null, 409, 'L\'agent est déjà en cours d\'exécution. Attendez la fin ou réessayez dans un instant.');

        return response()->json([
            'data' => [
                'queued' => true,
                'agent_uuid' => $uuid,
                'run_uuid' => $run->uuid,
                'status' => 'running',
            ],
        ], 202);
    }

    private function currentTeam(Request $request): Team
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        return $this->currentTeamContext->resolve($user);
    }

    private function findAgent(Request $request, string $uuid): AiAgent
    {
        $team = $this->currentTeam($request);
        $agent = AiAgent::where('uuid', $uuid)->where('team_id', $team->id)->first();
        abort_unless($agent, 404, 'Agent introuvable.');

        return $agent;
    }

    /** @return array<string, mixed> */
    private function present(AiAgent $agent): array
    {
        $latestRun = $agent->relationLoaded('runs') ? $agent->runs->first() : null;

        return [
            'uuid' => $agent->uuid,
            'type' => $agent->type,
            'name' => $agent->name,
            'description' => $agent->description,
            'avatar_color' => $agent->avatar_color,
            'system_prompt' => $agent->system_prompt,
            'schedule_minutes' => $agent->schedule_minutes,
            'trigger_mode' => $agent->triggerMode(),
            'is_active' => $agent->is_active,
            'status' => $agent->status,
            'last_run_at' => $agent->last_run_at?->toISOString(),
            'provider' => $agent->providerConfig ? [
                'id' => $agent->providerConfig->id,
                'name' => $agent->providerConfig->name,
                'provider' => $agent->providerConfig->provider,
                'model' => $agent->providerConfig->model,
            ] : null,
            'fallback_provider' => $agent->relationLoaded('fallbackProviderConfig') && $agent->fallbackProviderConfig ? [
                'id' => $agent->fallbackProviderConfig->id,
                'name' => $agent->fallbackProviderConfig->name,
                'provider' => $agent->fallbackProviderConfig->provider,
                'model' => $agent->fallbackProviderConfig->model,
            ] : null,
            'parent_agent_id' => $agent->parent_agent_id,
            'resource_uuid' => $agent->resource_uuid,
            'sub_agents_count' => $agent->relationLoaded('subAgents') ? $agent->subAgents->count() : 0,
            'latest_run' => $latestRun ? [
                'uuid' => $latestRun->uuid,
                'status' => $latestRun->status,
                'summary' => $latestRun->summary,
                'trigger' => $latestRun->trigger,
                'created_at' => $latestRun->created_at->toISOString(),
            ] : null,
            'created_at' => $agent->created_at->toISOString(),
        ];
    }

    /**
     * @return array<int|string, mixed>
     */
    private function agentRelations(bool $withLatestRun = true): array
    {
        $relations = ['providerConfig'];

        if (Schema::hasColumn('ai_agents', 'fallback_provider_config_id')) {
            $relations[] = 'fallbackProviderConfig';
        }

        if ($withLatestRun) {
            $relations['runs'] = fn ($q) => $q->latest()->limit(1);
        }

        return $relations;
    }

    /**
     * @param  array<string, mixed>  $validated
     * @return array<string, mixed>
     */
    private function normalizeAgentInput(array $validated, ?AiAgent $agent = null): array
    {
        $type = (string) ($validated['type'] ?? $agent?->type ?? '');

        if ($type === 'devforge') {
            $validated['schedule_minutes'] = 0;
        }

        return $validated;
    }
}
