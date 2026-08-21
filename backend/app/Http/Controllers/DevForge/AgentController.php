<?php

namespace App\Http\Controllers\DevForge;

use App\Enums\AgentAvatarShape;
use App\Http\Controllers\Controller;
use App\Models\AiAgent;
use App\Models\AiProviderConfig;
use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\Agent\AgentDirectives;
use App\Services\DevForge\Agent\AgentRunLauncher;
use App\Services\DevForge\Agent\LlmModelResolver;
use App\Services\DevForge\Agent\Tool\AgentToolPackage;
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
            ->whereNull('parent_agent_id')
            ->with($this->agentRelations())
            ->withCount('subAgents')
            ->orderBy('type')
            ->orderBy('name')
            ->get();

        foreach ($agents as $agent) {
            $agent->recoverIfInterrupted();
            $agent->syncOperationalStatus();
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
            'type' => ['required', 'string', Rule::in(['debug', 'tech-watch', 'github', 'github-actions', 'devforge', 'deployment', 'security'])],
            'name' => ['required', 'string', 'max:100'],
            'description' => ['nullable', 'string', 'max:500'],
            'avatar_color' => ['nullable', 'string', 'max:20'],
            'avatar_shape' => ['nullable', 'string', Rule::in(AgentAvatarShape::values())],
            'system_prompt' => ['nullable', 'string', 'max:5000'],
            'provider_config_id' => ['nullable', 'integer', Rule::exists('ai_provider_configs', 'id')->where('team_id', $team->id)],
            'fallback_provider_config_id' => ['nullable', 'integer', Rule::exists('ai_provider_configs', 'id')->where('team_id', $team->id)],
            'preferred_model' => ['nullable', 'string', 'max:120'],
            'parent_agent_id' => ['nullable', 'integer', Rule::exists('ai_agents', 'id')->where('team_id', $team->id)],
            'resource_uuid' => ['nullable', 'string', 'max:64'],
            'schedule_minutes' => ['nullable', 'integer', 'min:0'],
            'schedule_cron' => ['nullable', 'string', 'max:120'],
            'heartbeat_enabled' => ['nullable', 'boolean'],
            'is_active' => ['nullable', 'boolean'],
        ]);

        if (! empty($validated['schedule_cron']) && function_exists('validate_cron_expression')
            && ! validate_cron_expression($validated['schedule_cron'])) {
            return response()->json(['message' => 'Expression cron invalide.', 'errors' => ['schedule_cron' => ['Expression cron invalide.']]], 422);
        }

        if (! empty($validated['parent_agent_id'])) {
            $parent = AiAgent::query()
                ->where('team_id', $team->id)
                ->whereKey($validated['parent_agent_id'])
                ->first();

            if (! $parent instanceof AiAgent) {
                return response()->json([
                    'message' => 'Agent parent introuvable.',
                    'errors' => ['parent_agent_id' => ['Agent parent introuvable.']],
                ], 422);
            }

            if ($parent->parent_agent_id !== null) {
                return response()->json([
                    'message' => 'Impossible d’ajouter un sous-agent à un sous-agent.',
                    'errors' => ['parent_agent_id' => ['Un seul niveau de sous-agents est autorisé.']],
                ], 422);
            }

            $validated['schedule_minutes'] = 0;
            $validated['schedule_cron'] = null;

            if (empty($validated['provider_config_id']) && $parent->provider_config_id) {
                $validated['provider_config_id'] = $parent->provider_config_id;
            }

            if (empty($validated['fallback_provider_config_id']) && $parent->fallback_provider_config_id) {
                $validated['fallback_provider_config_id'] = $parent->fallback_provider_config_id;
            }
        }

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
            ...$this->defaultAgentFields($validated),
        ]);

        return response()->json(['data' => $this->present($agent->load($this->agentRelations(false))->loadCount('subAgents'))], 201);
    }

    public function show(Request $request, string $uuid): JsonResponse
    {
        $agent = $this->findAgent($request, $uuid);
        $this->authorize('view', $agent);
        $agent->recoverIfInterrupted();
        $agent->syncOperationalStatus();
        $agent->refresh();

        return response()->json([
            'data' => $this->present($agent->load([
                ...$this->agentRelations(false),
                'subAgents',
                'runs' => fn ($q) => $q->latest()->limit(5),
            ])->loadCount('subAgents')),
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
            'avatar_shape' => ['sometimes', 'nullable', 'string', Rule::in(AgentAvatarShape::values())],
            'system_prompt' => ['sometimes', 'nullable', 'string', 'max:5000'],
            'provider_config_id' => ['sometimes', 'nullable', 'integer', Rule::exists('ai_provider_configs', 'id')->where('team_id', $team->id)],
            'fallback_provider_config_id' => ['sometimes', 'nullable', 'integer', Rule::exists('ai_provider_configs', 'id')->where('team_id', $team->id)],
            'preferred_model' => ['sometimes', 'nullable', 'string', 'max:120'],
            'schedule_minutes' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'schedule_cron' => ['sometimes', 'nullable', 'string', 'max:120'],
            'heartbeat_enabled' => ['sometimes', 'boolean'],
            'is_active' => ['sometimes', 'boolean'],
            'is_primary_chat' => ['sometimes', 'boolean'],
            'status' => ['sometimes', 'string', Rule::in(['idle', 'paused'])],
        ]);

        if (! empty($validated['schedule_cron']) && function_exists('validate_cron_expression')
            && ! validate_cron_expression($validated['schedule_cron'])) {
            return response()->json(['message' => 'Expression cron invalide.', 'errors' => ['schedule_cron' => ['Expression cron invalide.']]], 422);
        }

        if (array_key_exists('is_primary_chat', $validated)) {
            $this->setPrimaryChat($agent, (bool) $validated['is_primary_chat']);
            unset($validated['is_primary_chat']);
        }

        if ($validated !== []) {
            $agent->update($this->normalizeAgentInput($validated, $agent));
        } else {
            $agent->refresh();
        }

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
        abort_if(! $agent->hasLlmProvider(), 422, 'Aucun provider LLM configuré. Ajoutez un provider dans Paramètres → Intelligence Artificielle.');
        abort_if(! $agent->is_active, 422, 'L\'agent est inactif.');

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

        $displayProvider = $agent->providerConfig ?? $agent->effectiveProviderConfig();

        return [
            'id' => $agent->id,
            'uuid' => $agent->uuid,
            'type' => $agent->type,
            'name' => $agent->name,
            'description' => $agent->description,
            'avatar_color' => $agent->avatar_color,
            'avatar_shape' => AgentAvatarShape::resolve(
                Schema::hasColumn('ai_agents', 'avatar_shape') ? $agent->avatar_shape : null,
                (string) $agent->type,
            )->value,
            'system_prompt' => $agent->system_prompt,
            'schedule_minutes' => $agent->schedule_minutes,
            'schedule_cron' => Schema::hasColumn('ai_agents', 'schedule_cron')
                ? ($agent->schedule_cron ?? null)
                : null,
            'heartbeat_enabled' => Schema::hasColumn('ai_agents', 'heartbeat_enabled')
                ? (bool) ($agent->heartbeat_enabled ?? false)
                : false,
            'last_heartbeat_at' => Schema::hasColumn('ai_agents', 'last_heartbeat_at')
                ? $agent->last_heartbeat_at?->toISOString()
                : null,
            'trigger_mode' => $agent->triggerMode(),
            'event_trigger_label' => $agent->eventTriggerLabel(),
            'is_event_only' => $agent->isEventOnly(),
            'is_active' => $agent->is_active,
            'status' => $agent->status,
            'is_primary_chat' => (bool) ($agent->metadata['is_primary_chat'] ?? false),
            'llm_available' => $agent->hasLlmProvider(),
            'last_run_at' => $agent->last_run_at?->toISOString(),
            'preferred_model' => $agent->preferredLlmModel(),
            'provider' => $displayProvider ? $this->presentProvider($displayProvider, $agent->preferredLlmModel()) : null,
            'fallback_provider' => $agent->relationLoaded('fallbackProviderConfig') && $agent->fallbackProviderConfig
                ? $this->presentProvider($agent->fallbackProviderConfig)
                : null,
            'parent_agent_id' => $agent->parent_agent_id,
            'resource_uuid' => $agent->resource_uuid,
            'sub_agents_count' => (int) ($agent->sub_agents_count
                ?? ($agent->relationLoaded('subAgents') ? $agent->subAgents->count() : 0)),
            'sub_agents' => $agent->relationLoaded('subAgents')
                ? $agent->subAgents->map(fn (AiAgent $child): array => [
                    'id' => $child->id,
                    'uuid' => $child->uuid,
                    'type' => $child->type,
                    'name' => $child->name,
                    'avatar_color' => $child->avatar_color,
                    'avatar_shape' => AgentAvatarShape::resolve(
                        Schema::hasColumn('ai_agents', 'avatar_shape') ? $child->avatar_shape : null,
                        (string) $child->type,
                    )->value,
                    'status' => $child->status,
                    'is_active' => $child->is_active,
                ])->values()->all()
                : [],
            'latest_run' => $latestRun ? [
                'uuid' => $latestRun->uuid,
                'status' => $latestRun->status,
                'summary' => $latestRun->summary,
                'trigger' => $latestRun->trigger,
                'metadata' => $latestRun->metadata ?? [],
                'created_at' => $latestRun->created_at->toISOString(),
            ] : null,
            'default_directives' => AgentDirectives::defaultSystemPrompt($agent->type),
            'autonomous_playbook' => AgentDirectives::autonomousPlaybook($agent->type),
            'tool_packages' => AgentToolPackage::listForApi(),
            'enabled_tool_packages' => is_array($agent->metadata['tool_packages']['enabled'] ?? null)
                ? $agent->metadata['tool_packages']['enabled']
                : AgentToolPackage::defaultForAgentType($agent->type),
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
     * @return array{id: int, name: string, provider: string, model: string, model_label: string, base_url: string|null}
     */
    private function presentProvider(AiProviderConfig $provider, ?string $modelOverride = null): array
    {
        $effectiveModel = $modelOverride;
        if ($effectiveModel === null || LlmModelResolver::isAuto($effectiveModel)) {
            $effectiveModel = $provider->model;
        }

        $modelLabel = $modelOverride !== null && ! LlmModelResolver::isAuto($modelOverride)
            ? trim($modelOverride)
            : $provider->modelDisplayLabel();

        return [
            'id' => $provider->id,
            'name' => $provider->name,
            'provider' => $provider->provider,
            'base_url' => $provider->base_url,
            'model' => is_string($effectiveModel) && trim($effectiveModel) !== ''
                ? trim($effectiveModel)
                : LlmModelResolver::AUTO,
            'model_label' => $modelLabel !== '' ? $modelLabel : 'Auto',
        ];
    }

    /**
     * @param  array<string, mixed>  $validated
     * @return array<string, mixed>
     */
    private function normalizeAgentInput(array $validated, ?AiAgent $agent = null): array
    {
        $type = (string) ($validated['type'] ?? $agent?->type ?? '');

        if (in_array($type, ['devforge', 'github-actions'], true)) {
            $validated['schedule_minutes'] = 0;
            $validated['schedule_cron'] = null;
        }

        $parentId = $validated['parent_agent_id'] ?? $agent?->parent_agent_id;
        if (! empty($parentId)) {
            $validated['schedule_minutes'] = 0;
            $validated['schedule_cron'] = null;
        }

        if (array_key_exists('preferred_model', $validated)) {
            $preferred = $validated['preferred_model'];
            unset($validated['preferred_model']);

            $metadata = is_array($agent?->metadata) ? $agent->metadata : [];
            if (is_array($validated['metadata'] ?? null)) {
                $metadata = array_merge($metadata, $validated['metadata']);
            }

            $normalized = is_string($preferred) ? trim($preferred) : '';
            if ($normalized === '' || strtolower($normalized) === LlmModelResolver::AUTO) {
                unset($metadata['llm_model']);
            } else {
                $metadata['llm_model'] = $normalized;
            }

            $validated['metadata'] = $metadata === [] ? null : $metadata;
        }

        if (! Schema::hasColumn('ai_agents', 'avatar_shape')) {
            unset($validated['avatar_shape']);
        }

        return $validated;
    }

    /**
     * @param  array<string, mixed>  $validated
     * @return array<string, mixed>
     */
    private function defaultAgentFields(array $validated): array
    {
        $type = (string) ($validated['type'] ?? 'debug');
        $catalog = AgentDirectives::catalog()[$type] ?? null;

        $fields = [];

        if (empty($validated['system_prompt'])) {
            $fields['system_prompt'] = AgentDirectives::defaultSystemPrompt($type);
        }

        if (empty($validated['description']) && $catalog !== null) {
            $fields['description'] = $catalog['description'];
        }

        if (! array_key_exists('schedule_minutes', $validated) && $catalog !== null && ! in_array($type, ['devforge', 'github-actions'], true)) {
            $fields['schedule_minutes'] = $catalog['default_schedule'];
        }

        if (Schema::hasColumn('ai_agents', 'avatar_shape') && empty($validated['avatar_shape'])) {
            $fields['avatar_shape'] = AgentAvatarShape::defaultForType($type)->value;
        }

        return $fields;
    }

    private function setPrimaryChat(AiAgent $agent, bool $enabled): void
    {
        if ($enabled) {
            $siblings = AiAgent::query()
                ->where('team_id', $agent->team_id)
                ->where('id', '!=', $agent->id)
                ->get();

            foreach ($siblings as $sibling) {
                $meta = is_array($sibling->metadata) ? $sibling->metadata : [];
                if (! ($meta['is_primary_chat'] ?? false)) {
                    continue;
                }
                unset($meta['is_primary_chat']);
                $sibling->metadata = $meta === [] ? null : $meta;
                $sibling->save();
            }
        }

        $metadata = is_array($agent->metadata) ? $agent->metadata : [];
        if ($enabled) {
            $metadata['is_primary_chat'] = true;
        } else {
            unset($metadata['is_primary_chat']);
        }
        $agent->metadata = $metadata === [] ? null : $metadata;
        $agent->save();
    }
}