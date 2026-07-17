<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Http\Requests\DevForge\SharedVariableRequest;
use App\Http\Requests\DevForge\UpdateSharedVariableRequest;
use App\Models\SharedEnvironmentVariable;
use App\Services\DevForge\CurrentTeamContext;
use App\Services\DevForge\SharedVariable\SharedVariablePresenter;
use App\Services\DevForge\SharedVariable\SharedVariableScopeResolver;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class SharedVariableController extends Controller
{
    public function __construct(
        private SharedVariablePresenter $presenter,
        private SharedVariableScopeResolver $scopeResolver,
    ) {}

    public function index(
        Request $request,
        CurrentTeamContext $currentTeamContext,
    ): JsonResponse {
        $team = $currentTeamContext->resolve($request->user());
        $this->authorize('viewAny', SharedEnvironmentVariable::class);

        $variables = SharedEnvironmentVariable::query()
            ->where('team_id', $team->id)
            ->with(['project:id,uuid,name', 'environment:id,uuid,name', 'server:id,uuid,name'])
            ->orderBy('type')
            ->orderBy('key')
            ->get()
            ->map(fn (SharedEnvironmentVariable $variable): array => $this->presenter->present($variable))
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

    public function store(
        SharedVariableRequest $request,
        CurrentTeamContext $currentTeamContext,
    ): JsonResponse {
        $team = $currentTeamContext->resolve($request->user());
        $this->authorize('create', SharedEnvironmentVariable::class);

        $payload = $request->payload();
        $this->assertAllowedServerKey($payload['scope'], $payload['key']);

        $scope = $this->scopeResolver->resolveForCreate($request->user(), $payload);
        $this->scopeResolver->assertUniqueKey($team, $payload['key'], $scope);

        $variable = SharedEnvironmentVariable::query()->create([
            'key' => $payload['key'],
            'value' => $payload['value'],
            'comment' => $payload['comment'],
            'is_multiline' => $payload['is_multiline'],
            'is_literal' => $payload['is_literal'],
            'is_shown_once' => $payload['is_shown_once'],
            'type' => $scope['type'],
            'team_id' => $team->id,
            'project_id' => $scope['project_id'],
            'environment_id' => $scope['environment_id'],
            'server_id' => $scope['server_id'],
        ]);

        return response()->json([
            'data' => $this->presenter->present($variable->refresh()),
        ], 201);
    }

    public function update(
        UpdateSharedVariableRequest $request,
        int $sharedVariable,
        CurrentTeamContext $currentTeamContext,
    ): JsonResponse {
        $team = $currentTeamContext->resolve($request->user());
        $variable = $this->variableForTeam($team->id, $sharedVariable);
        $this->authorize('update', $variable);

        $payload = $request->payload();
        abort_if($payload === [], 422, 'No updatable fields were provided.');

        if (array_key_exists('key', $payload)) {
            $this->scopeResolver->assertUniqueKey(
                $team,
                $payload['key'],
                $this->scopeResolver->scopeAttributes($variable),
                $variable->id,
            );
            $variable->key = $payload['key'];
        }

        if (array_key_exists('value', $payload)) {
            if ($variable->is_shown_once) {
                throw ValidationException::withMessages([
                    'value' => ['Locked secrets cannot be changed. Delete and recreate the variable instead.'],
                ]);
            }

            $variable->value = $payload['value'];
        }

        if (array_key_exists('comment', $payload)) {
            $variable->comment = $payload['comment'];
        }

        if (array_key_exists('is_multiline', $payload)) {
            $variable->is_multiline = $payload['is_multiline'];
        }

        if (array_key_exists('is_literal', $payload)) {
            $variable->is_literal = $payload['is_literal'];
        }

        $variable->save();

        return response()->json([
            'data' => $this->presenter->present($variable->refresh()),
        ]);
    }

    public function destroy(
        Request $request,
        int $sharedVariable,
        CurrentTeamContext $currentTeamContext,
    ): JsonResponse {
        $team = $currentTeamContext->resolve($request->user());
        $variable = $this->variableForTeam($team->id, $sharedVariable);
        $this->authorize('delete', $variable);

        $variable->delete();

        return response()->json(status: 204);
    }

    private function variableForTeam(int $teamId, int $variableId): SharedEnvironmentVariable
    {
        return SharedEnvironmentVariable::query()
            ->where('team_id', $teamId)
            ->where('id', $variableId)
            ->firstOrFail();
    }

    private function assertAllowedServerKey(string $scope, string $key): void
    {
        if ($scope !== 'server') {
            return;
        }

        if (in_array($key, ['COOLIFY_SERVER_UUID', 'COOLIFY_SERVER_NAME'], true)) {
            throw ValidationException::withMessages([
                'key' => ['This predefined server variable cannot be created manually.'],
            ]);
        }
    }
}
