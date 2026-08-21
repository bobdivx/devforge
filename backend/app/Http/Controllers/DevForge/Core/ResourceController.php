<?php

namespace App\Http\Controllers\DevForge\Core;

use App\Http\Controllers\Controller;
use App\Http\Requests\DevForge\Core\ResourceActionRequest;
use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\Core\CoreResourceAction;
use App\Services\DevForge\Core\CoreResourceCatalog;
use App\Services\DevForge\Core\CoreResourcePresenter;
use App\Services\DevForge\Core\CurrentTeamContext;
use App\Services\DevForge\Database\StandaloneDatabaseRuntimeGuard;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ResourceController extends Controller
{
    public function __construct(
        private readonly CurrentTeamContext $currentTeamContext,
        private readonly CoreResourceCatalog $catalog,
        private readonly CoreResourcePresenter $presenter,
        private readonly CoreResourceAction $resourceAction,
        private readonly StandaloneDatabaseRuntimeGuard $databaseRuntimeGuard,
    ) {}

    public function catalog(Request $request): JsonResponse
    {
        $team = $this->currentTeam($request);
        $resources = collect();

        foreach (['servers', 'applications', 'databases', 'services'] as $type) {
            $models = $this->catalog->resources($team, $type);
            foreach ($models as $model) {
                $this->authorize('view', $model);
            }
            $resources = $resources->concat($this->presenter->presentCollection($models, $type));
        }

        return response()->json([
            'data' => $resources->values(),
            'meta' => [
                'count' => $resources->count(),
            ],
        ]);
    }

    public function index(Request $request, string $type): JsonResponse
    {
        $team = $this->currentTeam($request);
        $models = $this->catalog->resources($team, $type);
        foreach ($models as $model) {
            $this->authorize('view', $model);
        }

        $resources = collect($this->presenter->presentCollection($models, $type));

        return response()->json([
            'data' => $resources,
            'meta' => [
                'count' => $resources->count(),
                'resource_type' => str($type)->singular()->value(),
            ],
        ]);
    }

    public function show(Request $request, string $type, string $uuid): JsonResponse
    {
        $resource = $this->resource($request, $type, $uuid);
        $this->authorize('view', $resource);

        if ($type === 'databases') {
            $this->databaseRuntimeGuard->ensureRunning($resource);
            $resource->refresh();
        }

        return response()->json([
            'data' => $this->presenter->present($resource, $type),
        ]);
    }

    public function configuration(Request $request): JsonResponse
    {
        $this->currentTeam($request);

        return response()->json([
            'data' => $this->presenter->configuration(),
        ]);
    }

    public function action(
        ResourceActionRequest $request,
        string $type,
        string $uuid,
        string $action,
    ): JsonResponse {
        $resource = $this->resource($request, $type, $uuid);
        $this->authorize($this->ability($type, $action), $resource);
        $options = $request->safe()->except('action');

        return response()->json([
            'data' => $this->resourceAction->execute($resource, $type, $action, $options),
        ], $type === 'databases' ? 200 : 202);
    }

    private function currentTeam(Request $request): Team
    {
        $user = $request->user();

        abort_unless($user instanceof User, 401, 'Unauthenticated.');

        return $this->currentTeamContext->resolve($user);
    }

    private function resource(Request $request, string $type, string $uuid): Model
    {
        $resource = $this->catalog->find($this->currentTeam($request), $type, $uuid);

        abort_unless($resource, 404, 'Ressource introuvable.');

        return $resource;
    }

    private function ability(string $type, string $action): string
    {
        return match ($type) {
            'applications' => 'deploy',
            'services' => $action === 'stop' ? 'stop' : 'deploy',
            'databases' => 'manage',
            default => 'view',
        };
    }
}
