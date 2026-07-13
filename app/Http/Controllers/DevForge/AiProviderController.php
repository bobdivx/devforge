<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\AiProviderConfig;
use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\Agent\LlmEndpointResolver;
use App\Services\DevForge\Agent\LlmModelCatalog;
use App\Services\DevForge\Agent\LlmProviderFactory;
use App\Services\DevForge\Core\CurrentTeamContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class AiProviderController extends Controller
{
    public function __construct(
        private readonly CurrentTeamContext $currentTeamContext,
        private readonly LlmProviderFactory $providerFactory,
        private readonly LlmModelCatalog $modelCatalog,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $this->authorize('viewAny', AiProviderConfig::class);
        $team = $this->currentTeam($request);

        $configs = AiProviderConfig::where('team_id', $team->id)
            ->orderBy('provider')
            ->orderBy('name')
            ->get()
            ->map(fn (AiProviderConfig $c) => $this->present($c));

        return response()->json(['data' => $configs]);
    }

    public function discoverModels(Request $request): JsonResponse
    {
        $this->authorize('create', AiProviderConfig::class);

        $validated = $request->validate([
            'provider' => ['required', 'string', Rule::in(['gemini', 'ollama'])],
            'api_key' => ['nullable', 'string'],
            'base_url' => ['nullable', 'string', 'url'],
            'provider_id' => ['nullable', 'integer'],
        ]);

        $apiKey = $validated['api_key'] ?? null;
        $baseUrl = $validated['base_url'] ?? null;

        if (! empty($validated['provider_id'])) {
            $config = $this->findConfig($this->currentTeam($request), (int) $validated['provider_id']);
            $this->authorize('view', $config);
            $apiKey = $apiKey ?: $config->api_key;
            $baseUrl = $baseUrl ?: $config->base_url;
        }

        if ($validated['provider'] === 'gemini' && empty($apiKey)) {
            abort(422, 'Une clé API est requise pour lister les modèles Gemini.');
        }

        if ($validated['provider'] === 'ollama' && empty($baseUrl)) {
            abort(422, 'Une URL de base est requise pour lister les modèles Ollama.');
        }

        try {
            $models = $this->modelCatalog->listForProvider(
                $validated['provider'],
                $apiKey,
                $validated['provider'] === 'ollama'
                    ? LlmEndpointResolver::ollamaBaseUrl($baseUrl)
                    : LlmEndpointResolver::geminiBaseUrl($baseUrl),
            );
        } catch (\Throwable $e) {
            return response()->json([
                'message' => $e->getMessage(),
                'data' => ['models' => []],
            ], 422);
        }

        return response()->json(['data' => ['models' => $models]]);
    }

    public function store(Request $request): JsonResponse
    {
        $this->authorize('create', AiProviderConfig::class);
        $team = $this->currentTeam($request);

        $validated = $request->validate([
            'provider' => ['required', 'string', Rule::in(['gemini', 'ollama'])],
            'name' => ['required', 'string', 'max:100'],
            'api_key' => ['nullable', 'string'],
            'base_url' => ['nullable', 'string', 'url'],
            'model' => ['required', 'string', 'max:100'],
            'is_default' => ['nullable', 'boolean'],
        ]);

        $this->validateProviderConfig($validated);

        $validated = array_merge($validated, LlmEndpointResolver::sanitizeProviderConfig($validated));

        if (! empty($validated['is_default'])) {
            AiProviderConfig::where('team_id', $team->id)->update(['is_default' => false]);
        }

        $config = AiProviderConfig::create(['team_id' => $team->id, ...$validated]);

        return response()->json(['data' => $this->present($config)], 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $team = $this->currentTeam($request);
        $config = $this->findConfig($team, $id);
        $this->authorize('update', $config);

        $validated = $request->validate([
            'name' => ['sometimes', 'string', 'max:100'],
            'api_key' => ['sometimes', 'nullable', 'string'],
            'base_url' => ['sometimes', 'nullable', 'string', 'url'],
            'model' => ['sometimes', 'string', 'max:100'],
            'is_default' => ['sometimes', 'boolean'],
        ]);

        if (! empty($validated['is_default'])) {
            AiProviderConfig::where('team_id', $team->id)
                ->where('id', '!=', $id)
                ->update(['is_default' => false]);
        }

        if (array_key_exists('base_url', $validated) || array_key_exists('provider', $validated)) {
            $merged = array_merge($config->only(['provider', 'base_url']), $validated);
            $validated = array_merge($validated, LlmEndpointResolver::sanitizeProviderConfig($merged));
        }

        $config->update($validated);

        return response()->json(['data' => $this->present($config->fresh())]);
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $config = $this->findConfig($this->currentTeam($request), $id);
        $this->authorize('delete', $config);
        $config->delete();

        return response()->json(['data' => ['deleted' => true]]);
    }

    public function test(Request $request, int $id): JsonResponse
    {
        $config = $this->findConfig($this->currentTeam($request), $id);
        $this->authorize('view', $config);

        try {
            $provider = $this->providerFactory->make($config);
            $connected = $provider->testConnection();

            return response()->json([
                'data' => [
                    'success' => $connected,
                    'message' => $connected ? 'Connexion réussie.' : 'Connexion échouée.',
                ],
            ]);
        } catch (\Throwable $e) {
            return response()->json([
                'data' => ['success' => false, 'message' => $e->getMessage()],
            ]);
        }
    }

    private function currentTeam(Request $request): Team
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        return $this->currentTeamContext->resolve($user);
    }

    private function findConfig(Team $team, int $id): AiProviderConfig
    {
        $config = AiProviderConfig::where('id', $id)->where('team_id', $team->id)->first();
        abort_unless($config, 404, 'Configuration introuvable.');

        return $config;
    }

    /** @param array<string, mixed> $config */
    private function validateProviderConfig(array $config): void
    {
        if ($config['provider'] === 'gemini' && empty($config['api_key'])) {
            abort(422, 'Une clé API est requise pour Gemini.');
        }

        if ($config['provider'] === 'ollama' && empty($config['base_url'])) {
            abort(422, 'Une URL de base est requise pour Ollama.');
        }
    }

    /** @return array<string, mixed> */
    private function present(AiProviderConfig $config): array
    {
        return [
            'id' => $config->id,
            'provider' => $config->provider,
            'name' => $config->name,
            'model' => $config->model,
            'base_url' => $config->base_url,
            'has_api_key' => ! empty($config->api_key),
            'is_default' => $config->is_default,
            'created_at' => $config->created_at->toISOString(),
        ];
    }
}
