<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\Application;
use App\Models\User;
use App\Services\DevForge\Application\ApplicationContainerLogs;
use App\Services\DevForge\Application\ApplicationDatabaseConnector;
use App\Services\DevForge\Application\ApplicationFromGithubCreator;
use App\Services\DevForge\Core\CoreResourcePresenter;
use App\Services\DevForge\CurrentTeamContext;
use App\Services\DevForge\CurrentTeamResources;
use App\Services\DevForge\DeploymentTargetData;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ApplicationController extends Controller
{
    public function __construct(
        private readonly CurrentTeamContext $currentTeamContext,
        private readonly CurrentTeamResources $currentTeamResources,
        private readonly DeploymentTargetData $deploymentTargetData,
        private readonly ApplicationFromGithubCreator $applicationFromGithubCreator,
        private readonly ApplicationDatabaseConnector $applicationDatabaseConnector,
        private readonly ApplicationContainerLogs $applicationContainerLogs,
        private readonly CoreResourcePresenter $presenter,
    ) {}

    public function deploymentTargets(Request $request): JsonResponse
    {
        $team = $this->currentTeamContext->resolve($request->user());

        return response()->json([
            'data' => $this->deploymentTargetData->forTeam($team),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $this->authorize('create', Application::class);

        $team = $this->currentTeamContext->resolve($request->user());
        $user = $request->user();
        abort_unless($user instanceof User, 401);
        $result = $this->applicationFromGithubCreator->create($user, $team, $request->all());

        return response()->json([
            'data' => $this->presenter->present($result['application'], 'applications'),
            'meta' => [
                'instant_deploy' => $result['instant_deploy'],
            ],
        ], 201);
    }

    public function linkableDatabases(Request $request, string $applicationUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $application = $this->currentTeamResources->application($user, $applicationUuid);
        $this->authorize('view', $application);

        return response()->json([
            'data' => $this->applicationDatabaseConnector->linkableDatabases($application),
            'meta' => [
                'connections' => $this->applicationDatabaseConnector->connections($application),
                'turso_migration' => $this->applicationDatabaseConnector->tursoMigrationCandidate($application),
            ],
        ]);
    }

    public function connectDatabase(Request $request, string $applicationUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $application = $this->currentTeamResources->application($user, $applicationUuid);
        $this->authorize('update', $application);

        $team = $this->currentTeamContext->resolve($user);

        return response()->json([
            'data' => $this->applicationDatabaseConnector->connect($user, $team, $application, $request->all()),
        ]);
    }

    public function logs(Request $request, string $applicationUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $application = $this->currentTeamResources->application($user, $applicationUuid);
        $this->authorize('view', $application);

        $validated = $request->validate([
            'lines' => ['nullable', 'integer', 'min:10', 'max:1000'],
        ]);

        return response()->json([
            'data' => $this->applicationContainerLogs->fetch(
                $application->loadMissing('destination.server'),
                (int) ($validated['lines'] ?? 200),
            ),
        ]);
    }
}
