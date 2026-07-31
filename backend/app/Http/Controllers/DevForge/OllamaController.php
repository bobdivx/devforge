<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\AiAgent;
use App\Models\AiProviderConfig;
use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\Agent\LlmModelResolver;
use App\Services\DevForge\Agent\OllamaControlService;
use App\Services\DevForge\Core\CurrentTeamContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class OllamaController extends Controller
{
    public function __construct(
        private readonly CurrentTeamContext $currentTeamContext,
        private readonly OllamaControlService $ollama,
    ) {}

    public function instances(Request $request): JsonResponse
    {
        $this->authorize('viewAny', AiProviderConfig::class);
        $team = $this->currentTeam($request);

        return response()->json([
            'data' => $this->ollama->listInstances($team),
            'meta' => [
                'hint' => 'Créez un provider Ollama par machine (ex. PC 3090 + NAS A2000), puis sélectionnez-le ici.',
            ],
        ]);
    }

    public function status(Request $request): JsonResponse
    {
        $this->authorize('viewAny', AiProviderConfig::class);
        $team = $this->currentTeam($request);

        $providerId = $request->query('provider_id');
        $status = $this->ollama->status(
            $team,
            is_string($request->query('base_url')) ? $request->query('base_url') : null,
            is_numeric($providerId) ? (int) $providerId : null,
        );

        return response()->json(['data' => $status]);
    }

    public function pull(Request $request): JsonResponse
    {
        $this->authorize('create', AiProviderConfig::class);
        $team = $this->currentTeam($request);

        $validated = $request->validate([
            'model' => ['required', 'string', 'max:120'],
            'base_url' => ['nullable', 'string', 'url'],
            'provider_id' => ['nullable', 'integer'],
        ]);

        $baseUrl = $validated['base_url'] ?? null;
        if ($baseUrl === null && ! empty($validated['provider_id'])) {
            $baseUrl = $this->providerBaseUrl($team, (int) $validated['provider_id']);
        }

        $result = $this->ollama->pull($team, $validated['model'], $baseUrl);

        if (! $result['ok']) {
            return response()->json([
                'message' => $result['error'] ?? 'Pull Ollama échoué.',
                'data' => $result,
            ], 422);
        }

        return response()->json(['data' => $result]);
    }

    public function destroyModel(Request $request): JsonResponse
    {
        $this->authorize('create', AiProviderConfig::class);
        $team = $this->currentTeam($request);

        $validated = $request->validate([
            'model' => ['required', 'string', 'max:120'],
            'base_url' => ['nullable', 'string', 'url'],
            'provider_id' => ['nullable', 'integer'],
        ]);

        $baseUrl = $validated['base_url'] ?? null;
        if ($baseUrl === null && ! empty($validated['provider_id'])) {
            $baseUrl = $this->providerBaseUrl($team, (int) $validated['provider_id']);
        }

        $result = $this->ollama->delete($team, $validated['model'], $baseUrl);

        if (! $result['ok']) {
            return response()->json([
                'message' => $result['error'] ?? 'Suppression Ollama échouée.',
                'data' => $result,
            ], 422);
        }

        return response()->json(['data' => $result]);
    }

    public function setProviderModel(Request $request): JsonResponse
    {
        $team = $this->currentTeam($request);

        $validated = $request->validate([
            'provider_id' => ['required', 'integer', Rule::exists('ai_provider_configs', 'id')->where('team_id', $team->id)->where('provider', 'ollama')],
            'model' => ['required', 'string', 'max:120'],
        ]);

        $provider = AiProviderConfig::query()
            ->where('team_id', $team->id)
            ->where('provider', 'ollama')
            ->whereKey($validated['provider_id'])
            ->firstOrFail();

        $this->authorize('update', $provider);

        $model = trim($validated['model']);
        $provider->update([
            'model' => $model === '' || strtolower($model) === LlmModelResolver::AUTO
                ? LlmModelResolver::AUTO
                : $model,
        ]);

        return response()->json([
            'data' => [
                'id' => $provider->id,
                'name' => $provider->name,
                'model' => $provider->model,
                'model_label' => $provider->modelDisplayLabel(),
            ],
        ]);
    }

    public function assignToAgent(Request $request): JsonResponse
    {
        $team = $this->currentTeam($request);

        $validated = $request->validate([
            'agent_uuid' => ['required', 'string', 'max:64'],
            'provider_id' => ['required', 'integer', Rule::exists('ai_provider_configs', 'id')->where('team_id', $team->id)->where('provider', 'ollama')],
            'model' => ['nullable', 'string', 'max:120'],
        ]);

        $agent = AiAgent::query()
            ->where('team_id', $team->id)
            ->where('uuid', $validated['agent_uuid'])
            ->firstOrFail();

        $this->authorize('update', $agent);

        $provider = AiProviderConfig::query()
            ->where('team_id', $team->id)
            ->where('provider', 'ollama')
            ->whereKey($validated['provider_id'])
            ->firstOrFail();

        $agent->provider_config_id = $provider->id;
        $agent->setPreferredLlmModel($validated['model'] ?? null);
        $agent->save();

        return response()->json([
            'data' => [
                'agent_uuid' => $agent->uuid,
                'agent_name' => $agent->name,
                'provider_id' => $provider->id,
                'provider_name' => $provider->name,
                'preferred_model' => $agent->preferredLlmModel(),
            ],
        ]);
    }

    private function providerBaseUrl(Team $team, int $providerId): ?string
    {
        $url = AiProviderConfig::query()
            ->where('team_id', $team->id)
            ->where('provider', 'ollama')
            ->whereKey($providerId)
            ->value('base_url');

        return is_string($url) && trim($url) !== '' ? $url : null;
    }

    private function currentTeam(Request $request): Team
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        return $this->currentTeamContext->resolve($user);
    }
}
