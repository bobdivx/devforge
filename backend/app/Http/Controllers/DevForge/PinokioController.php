<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\AiProviderConfig;
use App\Models\Team;
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
                'hint' => 'Serveurs Pinokio Uncensored Local Studio détectés sur votre réseau local.',
            ],
        ]);
    }

    public function status(Request $request): JsonResponse
    {
        $this->authorize('viewAny', AiProviderConfig::class);
        $team = $this->currentTeam($request);

        $baseUrl = (string) ($request->query('base_url') ?? '');
        if ($baseUrl === '') {
            $providerId = $request->query('provider_id');
            if (is_numeric($providerId)) {
                $baseUrl = $this->providerBaseUrl($team, (int) $providerId) ?? '';
            }
        }

        if ($baseUrl === '') {
            $baseUrl = 'http://10.1.0.88:10086';
        }

        $status = $this->pinokio->status($baseUrl);

        return response()->json(['data' => $status]);
    }

    public function start(Request $request): JsonResponse
    {
        $this->authorize('create', AiProviderConfig::class);
        $team = $this->currentTeam($request);

        $validated = $request->validate([
            'model' => ['required', 'string', 'max:255'],
            'base_url' => ['nullable', 'string', 'url'],
            'provider_id' => ['nullable', 'integer'],
            'context_size' => ['nullable', 'integer', 'min:512', 'max:131072'],
            'gpu_layers' => ['nullable', 'integer'],
            'flash_attn' => ['nullable', 'boolean'],
            'batch_size' => ['nullable', 'integer', 'min:128', 'max:4096'],
        ]);

        $baseUrl = $validated['base_url'] ?? null;
        if ($baseUrl === null && ! empty($validated['provider_id'])) {
            $baseUrl = $this->providerBaseUrl($team, (int) $validated['provider_id']);
        }

        if ($baseUrl === null) {
            $baseUrl = 'http://10.1.0.88:10086';
        }

        $result = $this->pinokio->startModel($baseUrl, $validated['model'], $validated);

        if (! $result['ok']) {
            return response()->json([
                'message' => $result['error'] ?? $result['message'] ?? 'Chargement Pinokio échoué.',
                'data' => $result,
            ], 422);
        }

        // Mettre à jour la configuration du provider dans DevForge si un provider_id a été fourni
        if (! empty($validated['provider_id'])) {
            $provider = AiProviderConfig::query()
                ->where('team_id', $team->id)
                ->find((int) $validated['provider_id']);

            if ($provider instanceof AiProviderConfig) {
                $provider->update(['model' => $validated['model']]);
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
            'provider_id' => ['nullable', 'integer'],
        ]);

        $baseUrl = $validated['base_url'] ?? null;
        if ($baseUrl === null && ! empty($validated['provider_id'])) {
            $baseUrl = $this->providerBaseUrl($team, (int) $validated['provider_id']);
        }

        if ($baseUrl === null) {
            $baseUrl = 'http://10.1.0.88:10086';
        }

        $result = $this->pinokio->stopModel($baseUrl);

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
        return $this->currentTeamContext->get($request->user());
    }

    private function providerBaseUrl(Team $team, int $providerId): ?string
    {
        $provider = AiProviderConfig::query()
            ->where('team_id', $team->id)
            ->find($providerId);

        if ($provider === null || ! is_string($provider->base_url) || trim($provider->base_url) === '') {
            return null;
        }

        return $provider->base_url;
    }
}
