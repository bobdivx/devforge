<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\AiProviderConfig;
use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\Agent\PinokioControlService;
use App\Services\DevForge\Core\CurrentTeamContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PinokioController extends Controller
{
    public function __construct(
        private readonly CurrentTeamContext $currentTeamContext,
        private readonly PinokioControlService $pinokio,
    ) {}

    public function instances(Request $request): JsonResponse
    {
        $this->authorize('viewAny', AiProviderConfig::class);
        $team = $this->currentTeam($request);

        return response()->json([
            'data' => $this->pinokio->listInstances($team),
            'meta' => [
                'hint' => 'Studio Pinokio (port ~420xx) pour le contrôle ; port 10086 pour l’inférence agents (/v1).',
            ],
        ]);
    }

    public function status(Request $request): JsonResponse
    {
        $this->authorize('viewAny', AiProviderConfig::class);
        $team = $this->currentTeam($request);

        [$baseUrl, $studioUrl] = $this->resolveUrls($request, $team);

        $status = $this->pinokio->status($baseUrl, $studioUrl);

        return response()->json(['data' => $status]);
    }

    public function start(Request $request): JsonResponse
    {
        $this->authorize('create', AiProviderConfig::class);
        $team = $this->currentTeam($request);

        $validated = $request->validate([
            'model' => ['required', 'string', 'max:255'],
            'base_url' => ['nullable', 'string', 'url'],
            'studio_url' => ['nullable', 'string', 'url'],
            'provider_id' => ['nullable', 'integer'],
            'context_size' => ['nullable', 'integer', 'min:512', 'max:131072'],
            'gpu_layers' => ['nullable', 'integer'],
            'flash_attn' => ['nullable', 'boolean'],
            'batch_size' => ['nullable', 'integer', 'min:128', 'max:4096'],
        ]);

        [$baseUrl, $studioUrl] = $this->resolveUrls($request, $team, $validated);

        $validated['studio_url'] = $studioUrl;

        $result = $this->pinokio->startModel($baseUrl, $validated['model'], $validated);

        if (! $result['ok']) {
            return response()->json([
                'message' => $result['error'] ?? $result['message'] ?? 'Chargement Pinokio échoué.',
                'data' => $result,
            ], 422);
        }

        if (! empty($validated['provider_id'])) {
            $provider = AiProviderConfig::query()
                ->where('team_id', $team->id)
                ->find((int) $validated['provider_id']);

            if ($provider instanceof AiProviderConfig) {
                $llmProviderUrl = $this->pinokio->normalizeLlmProviderUrl($baseUrl);
                $provider->update(array_filter([
                    'model' => $validated['model'],
                    'base_url' => $llmProviderUrl,
                    'studio_base_url' => $studioUrl,
                ]));
            }
        }

        return response()->json(['data' => $result]);
    }

    public function stop(Request $request): JsonResponse
    {
        $this->authorize('create', AiProviderConfig::class);
        $team = $this->currentTeam($request);

        $validated = $request->validate([
            'base_url' => ['nullable', 'string', 'url'],
            'studio_url' => ['nullable', 'string', 'url'],
            'provider_id' => ['nullable', 'integer'],
        ]);

        [$baseUrl, $studioUrl] = $this->resolveUrls($request, $team, $validated);

        $result = $this->pinokio->stopModel($baseUrl, $studioUrl);

        if (! $result['ok']) {
            return response()->json([
                'message' => $result['error'] ?? $result['message'] ?? 'Déchargement Pinokio échoué.',
                'data' => $result,
            ], 422);
        }

        return response()->json(['data' => $result]);
    }

    private function currentTeam(Request $request): Team
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        return $this->currentTeamContext->resolve($user);
    }

    /**
     * @param  array<string, mixed>  $validated
     * @return array{0: string, 1: string|null}
     */
    private function resolveUrls(Request $request, Team $team, array $validated = []): array
    {
        $baseUrl = (string) ($validated['base_url'] ?? $request->query('base_url') ?? '');
        $studioUrl = (string) ($validated['studio_url'] ?? $request->query('studio_url') ?? '');

        $providerId = $validated['provider_id'] ?? $request->query('provider_id');
        if (is_numeric($providerId)) {
            $provider = AiProviderConfig::query()
                ->where('team_id', $team->id)
                ->find((int) $providerId);

            if ($provider instanceof AiProviderConfig) {
                if ($baseUrl === '' && is_string($provider->base_url)) {
                    $baseUrl = $provider->base_url;
                }
                if ($studioUrl === '' && is_string($provider->studio_base_url)) {
                    $studioUrl = $provider->studio_base_url;
                }
            }
        }

        if ($baseUrl === '') {
            $baseUrl = 'http://10.1.0.88:10086';
        }

        return [
            $baseUrl,
            $studioUrl !== '' ? $studioUrl : null,
        ];
    }
}
