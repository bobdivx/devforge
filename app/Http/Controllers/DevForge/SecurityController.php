<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\PrivateKey;
use App\Services\DevForge\CurrentTeamContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SecurityController extends Controller
{
    public function keys(
        Request $request,
        CurrentTeamContext $currentTeamContext,
    ): JsonResponse {
        $team = $currentTeamContext->resolve($request->user());
        $this->authorize('viewAny', PrivateKey::class);

        return response()->json([
            'data' => PrivateKey::query()
                ->where('team_id', $team->id)
                ->select([
                    'id',
                    'uuid',
                    'name',
                    'description',
                    'fingerprint',
                    'is_git_related',
                    'created_at',
                ])
                ->orderBy('name')
                ->get()
                ->map(fn (PrivateKey $key): array => [
                    'id' => $key->id,
                    'uuid' => $key->uuid,
                    'name' => $key->name,
                    'description' => $key->description,
                    'fingerprint' => $key->fingerprint,
                    'is_git_related' => (bool) $key->is_git_related,
                    'private_key' => '********',
                    'created_at' => $key->created_at,
                ])
                ->all(),
        ]);
    }
}
