<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\CloudInitScript;
use App\Models\CloudProviderToken;
use App\Models\PrivateKey;
use App\Models\User;
use App\Services\DevForge\CurrentTeamContext;
use App\Services\DevForge\Security\ApiTokenCatalog;
use App\Services\DevForge\Security\CloudInitScriptCatalog;
use App\Services\DevForge\Security\CloudProviderTokenCatalog;
use App\Services\DevForge\Security\PrivateKeyCatalog;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Laravel\Sanctum\PersonalAccessToken;

class SecurityController extends Controller
{
    public function __construct(
        private readonly CurrentTeamContext $currentTeamContext,
        private readonly PrivateKeyCatalog $privateKeyCatalog,
        private readonly ApiTokenCatalog $apiTokenCatalog,
        private readonly CloudProviderTokenCatalog $cloudProviderTokenCatalog,
        private readonly CloudInitScriptCatalog $cloudInitScriptCatalog,
    ) {}

    public function keys(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $team = $this->currentTeamContext->resolve($user);
        $this->authorize('viewAny', PrivateKey::class);

        return response()->json([
            'data' => $this->privateKeyCatalog->list($team),
        ]);
    }

    public function storeKey(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $team = $this->currentTeamContext->resolve($user);
        $this->authorize('create', PrivateKey::class);

        return response()->json([
            'data' => $this->privateKeyCatalog->store($team, $request->all()),
        ], 201);
    }

    public function updateKey(Request $request, string $keyUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $team = $this->currentTeamContext->resolve($user);
        $key = $this->findKey($team->id, $keyUuid);
        $this->authorize('update', $key);

        return response()->json([
            'data' => $this->privateKeyCatalog->update($key, $request->all()),
        ]);
    }

    public function destroyKey(Request $request, string $keyUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $team = $this->currentTeamContext->resolve($user);
        $key = $this->findKey($team->id, $keyUuid);
        $this->authorize('delete', $key);

        $this->privateKeyCatalog->destroy($key);

        return response()->json([
            'message' => 'Clé privée supprimée.',
        ]);
    }

    public function generateKey(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $this->authorize('create', PrivateKey::class);

        $type = (string) $request->input('type', 'ed25519');

        return response()->json([
            'data' => $this->privateKeyCatalog->generate($type),
        ]);
    }

    public function apiTokens(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $team = $this->currentTeamContext->resolve($user);
        $this->authorize('viewAny', PersonalAccessToken::class);

        $payload = $this->apiTokenCatalog->list($user, $team);

        return response()->json([
            'data' => $payload['tokens'],
            'meta' => $payload['meta'],
        ]);
    }

    public function storeApiToken(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $team = $this->currentTeamContext->resolve($user);
        $this->authorize('create', PersonalAccessToken::class);

        return response()->json([
            'data' => $this->apiTokenCatalog->store($user, $team, $request->all()),
        ], 201);
    }

    public function destroyApiToken(Request $request, int $tokenId): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $team = $this->currentTeamContext->resolve($user);
        $token = $user->tokens()
            ->where('team_id', $team->id)
            ->whereKey($tokenId)
            ->first();
        abort_unless($token instanceof PersonalAccessToken, 404);
        $this->authorize('delete', $token);

        $this->apiTokenCatalog->destroy($user, $team, $tokenId);

        return response()->json([
            'message' => 'Jeton API révoqué.',
        ]);
    }

    public function cloudTokens(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $team = $this->currentTeamContext->resolve($user);
        $this->authorize('viewAny', CloudProviderToken::class);

        return response()->json([
            'data' => $this->cloudProviderTokenCatalog->list($team),
        ]);
    }

    public function storeCloudToken(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $team = $this->currentTeamContext->resolve($user);
        $this->authorize('create', CloudProviderToken::class);

        return response()->json([
            'data' => $this->cloudProviderTokenCatalog->store($team, $request->all()),
        ], 201);
    }

    public function updateCloudToken(Request $request, string $tokenUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $team = $this->currentTeamContext->resolve($user);
        $token = $this->findCloudToken($team->id, $tokenUuid);
        $this->authorize('update', $token);

        return response()->json([
            'data' => $this->cloudProviderTokenCatalog->update($token, $request->all()),
        ]);
    }

    public function destroyCloudToken(Request $request, string $tokenUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $team = $this->currentTeamContext->resolve($user);
        $token = $this->findCloudToken($team->id, $tokenUuid);
        $this->authorize('delete', $token);

        $this->cloudProviderTokenCatalog->destroy($token);

        return response()->json([
            'message' => 'Jeton cloud supprimé.',
        ]);
    }

    public function validateCloudToken(Request $request, string $tokenUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $team = $this->currentTeamContext->resolve($user);
        $token = $this->findCloudToken($team->id, $tokenUuid);
        $this->authorize('view', $token);

        return response()->json([
            'data' => $this->cloudProviderTokenCatalog->validateStored($token),
        ]);
    }

    public function cloudInitScripts(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $team = $this->currentTeamContext->resolve($user);
        $this->authorize('viewAny', CloudInitScript::class);

        return response()->json([
            'data' => $this->cloudInitScriptCatalog->list($team),
        ]);
    }

    public function storeCloudInitScript(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $team = $this->currentTeamContext->resolve($user);
        $this->authorize('create', CloudInitScript::class);

        return response()->json([
            'data' => $this->cloudInitScriptCatalog->store($team, $request->all()),
        ], 201);
    }

    public function updateCloudInitScript(Request $request, int $scriptId): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $team = $this->currentTeamContext->resolve($user);
        $script = $this->findCloudInitScript($team->id, $scriptId);
        $this->authorize('update', $script);

        return response()->json([
            'data' => $this->cloudInitScriptCatalog->update($script, $request->all()),
        ]);
    }

    public function destroyCloudInitScript(Request $request, int $scriptId): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $team = $this->currentTeamContext->resolve($user);
        $script = $this->findCloudInitScript($team->id, $scriptId);
        $this->authorize('delete', $script);

        $this->cloudInitScriptCatalog->destroy($script);

        return response()->json([
            'message' => 'Script cloud-init supprimé.',
        ]);
    }

    private function findCloudInitScript(int $teamId, int $scriptId): CloudInitScript
    {
        $script = CloudInitScript::query()
            ->where('team_id', $teamId)
            ->whereKey($scriptId)
            ->first();

        abort_unless($script instanceof CloudInitScript, 404);

        return $script;
    }

    private function findCloudToken(int $teamId, string $tokenUuid): CloudProviderToken
    {
        $token = CloudProviderToken::query()
            ->where('team_id', $teamId)
            ->where('uuid', $tokenUuid)
            ->first();

        abort_unless($token instanceof CloudProviderToken, 404);

        return $token;
    }

    private function findKey(int $teamId, string $keyUuid): PrivateKey
    {
        $key = PrivateKey::query()
            ->where('team_id', $teamId)
            ->where('uuid', $keyUuid)
            ->first();

        abort_unless($key instanceof PrivateKey, 404);

        return $key;
    }
}
