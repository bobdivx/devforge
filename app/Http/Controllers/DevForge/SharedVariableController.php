<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\SharedEnvironmentVariable;
use App\Services\DevForge\CurrentTeamContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SharedVariableController extends Controller
{
    public function __invoke(
        Request $request,
        CurrentTeamContext $currentTeamContext,
    ): JsonResponse {
        $team = $currentTeamContext->resolve($request->user());
        $this->authorize('viewAny', SharedEnvironmentVariable::class);

        $variables = SharedEnvironmentVariable::query()
            ->where('team_id', $team->id)
            ->orderBy('type')
            ->orderBy('key')
            ->get()
            ->map(fn (SharedEnvironmentVariable $variable): array => [
                'id' => $variable->id,
                'key' => $variable->key,
                'scope' => $variable->type,
                'project_id' => $variable->project_id,
                'environment_id' => $variable->environment_id,
                'server_id' => $variable->server_id,
                'comment' => $variable->comment,
                'is_multiline' => (bool) $variable->is_multiline,
                'is_literal' => (bool) $variable->is_literal,
                'is_shown_once' => (bool) $variable->is_shown_once,
                'value' => filled($variable->getRawOriginal('value')) ? '********' : null,
            ])
            ->groupBy('scope')
            ->map->values();

        return response()->json([
            'data' => [
                'team' => $variables->get('team', collect()),
                'project' => $variables->get('project', collect()),
                'environment' => $variables->get('environment', collect()),
                'server' => $variables->get('server', collect()),
            ],
        ]);
    }
}
