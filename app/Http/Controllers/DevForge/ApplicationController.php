<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Jobs\DeleteResourceJob;
use App\Models\Application;
use App\Models\User;
use App\Services\DevForge\Application\ApplicationContainerLogs;
use App\Services\DevForge\Application\ApplicationDatabaseConnector;
use App\Services\DevForge\Application\ApplicationDomainService;
use App\Services\DevForge\Application\ApplicationEnvironmentVariableCatalog;
use App\Services\DevForge\Application\ApplicationFromGithubCreator;
use App\Services\DevForge\Application\ApplicationRuntimeSettingsService;
use App\Services\DevForge\Application\ApplicationSourceService;
use App\Services\DevForge\Core\CoreResourcePresenter;
use App\Services\DevForge\CurrentTeamContext;
use App\Services\DevForge\CurrentTeamResources;
use App\Services\DevForge\DeploymentTargetData;
use App\Services\DevForge\Readiness\ApplicationReadinessService;
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
        private readonly ApplicationEnvironmentVariableCatalog $applicationEnvironmentVariableCatalog,
        private readonly ApplicationDomainService $applicationDomainService,
        private readonly ApplicationSourceService $applicationSourceService,
        private readonly ApplicationRuntimeSettingsService $applicationRuntimeSettingsService,
        private readonly ApplicationReadinessService $applicationReadinessService,
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

    public function resetLinkedDatabase(
        Request $request,
        string $applicationUuid,
        string $databaseUuid,
    ): JsonResponse {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $application = $this->currentTeamResources->application($user, $applicationUuid);
        $this->authorize('update', $application);

        $validated = $request->validate([
            'redeploy' => ['nullable', 'boolean'],
        ]);

        $team = $this->currentTeamContext->resolve($user);
        $result = $this->applicationDatabaseConnector->resetLinkedDatabase(
            $application,
            $team,
            $databaseUuid,
            redeployApplication: (bool) ($validated['redeploy'] ?? true),
        );

        auditLog('devforge.application.database_reset', [
            'team_id' => $team->id,
            'application_uuid' => $application->uuid,
            'database_uuid' => $databaseUuid,
            'user_id' => $user->id,
        ]);

        return response()->json([
            'data' => $result,
        ]);
    }

    public function domains(Request $request, string $applicationUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $application = $this->currentTeamResources->application($user, $applicationUuid);
        $this->authorize('view', $application);

        return response()->json([
            'data' => $this->applicationDomainService->show($application),
        ]);
    }

    public function updateDomains(Request $request, string $applicationUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $application = $this->currentTeamResources->application($user, $applicationUuid);
        $this->authorize('update', $application);

        return response()->json([
            'data' => $this->applicationDomainService->update($application, $request->all()),
        ]);
    }

    public function generateDomain(Request $request, string $applicationUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $application = $this->currentTeamResources->application($user, $applicationUuid);
        $this->authorize('update', $application);

        return response()->json([
            'data' => $this->applicationDomainService->generate($application),
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

    public function environmentVariables(Request $request, string $applicationUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $application = $this->currentTeamResources->application($user, $applicationUuid);
        $this->authorize('view', $application);

        return response()->json([
            'data' => $this->applicationEnvironmentVariableCatalog->list($application),
        ]);
    }

    public function storeEnvironmentVariable(Request $request, string $applicationUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $application = $this->currentTeamResources->application($user, $applicationUuid);
        $this->authorize('manageEnvironment', $application);

        return response()->json([
            'data' => $this->applicationEnvironmentVariableCatalog->store($application, $request->all()),
        ], 201);
    }

    public function updateEnvironmentVariable(Request $request, string $applicationUuid, string $envUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $application = $this->currentTeamResources->application($user, $applicationUuid);
        $this->authorize('manageEnvironment', $application);

        return response()->json([
            'data' => $this->applicationEnvironmentVariableCatalog->update($application, $envUuid, $request->all()),
        ]);
    }

    public function destroyEnvironmentVariable(Request $request, string $applicationUuid, string $envUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $application = $this->currentTeamResources->application($user, $applicationUuid);
        $this->authorize('manageEnvironment', $application);

        $this->applicationEnvironmentVariableCatalog->destroy($application, $envUuid);

        return response()->json([
            'message' => 'Variable d’environnement supprimée.',
        ]);
    }

    public function revealEnvironmentVariable(Request $request, string $applicationUuid, string $envUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $application = $this->currentTeamResources->application($user, $applicationUuid);
        $this->authorize('view', $application);

        return response()->json([
            'data' => $this->applicationEnvironmentVariableCatalog->reveal($application, $envUuid),
        ]);
    }

    public function sourceInfo(Request $request, string $applicationUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $application = $this->applicationSourceService->applicationForUser($user, $applicationUuid);
        $this->authorize('view', $application);

        return response()->json([
            'data' => $this->applicationSourceService->info($application),
        ]);
    }

    public function sourceList(Request $request, string $applicationUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $validated = $request->validate([
            'path' => ['nullable', 'string', 'max:4096'],
        ]);

        $application = $this->applicationSourceService->applicationForUser($user, $applicationUuid);
        $this->authorize('view', $application);
        $team = $this->currentTeamContext->resolve($user);

        return response()->json([
            'data' => $this->applicationSourceService->listDirectory(
                $team,
                $application,
                $validated['path'] ?? null,
            ),
        ]);
    }

    public function sourceRead(Request $request, string $applicationUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $validated = $request->validate([
            'path' => ['required', 'string', 'max:4096'],
        ]);

        $application = $this->applicationSourceService->applicationForUser($user, $applicationUuid);
        $this->authorize('view', $application);
        $team = $this->currentTeamContext->resolve($user);

        return response()->json([
            'data' => $this->applicationSourceService->readFile(
                $team,
                $application,
                $validated['path'],
            ),
        ]);
    }

    public function sourceWrite(Request $request, string $applicationUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $validated = $request->validate([
            'path' => ['required', 'string', 'max:4096'],
            'content' => ['required', 'string', 'max:32768'],
            'commit_message' => ['required', 'string', 'max:500'],
            'sha' => ['nullable', 'string', 'max:64'],
            'mode' => ['nullable', 'string', 'in:direct,pull_request'],
            'redeploy' => ['nullable', 'boolean'],
            'branch_name' => ['nullable', 'string', 'max:120'],
            'pr_title' => ['nullable', 'string', 'max:256'],
            'pr_body' => ['nullable', 'string', 'max:4000'],
        ]);

        $application = $this->applicationSourceService->applicationForUser($user, $applicationUuid);
        $this->authorize('update', $application);
        $team = $this->currentTeamContext->resolve($user);

        $options = [
            'mode' => $validated['mode'] ?? 'direct',
            'branch_name' => $validated['branch_name'] ?? null,
            'pr_title' => $validated['pr_title'] ?? null,
            'pr_body' => $validated['pr_body'] ?? null,
        ];

        if (array_key_exists('redeploy', $validated)) {
            $options['redeploy'] = (bool) $validated['redeploy'];
        }

        return response()->json([
            'data' => $this->applicationSourceService->writeFile(
                $team,
                $application,
                $validated['path'],
                $validated['content'],
                $validated['commit_message'],
                $validated['sha'] ?? null,
                $options,
            ),
        ]);
    }

    public function destroy(Request $request, string $applicationUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $application = $this->currentTeamResources->application($user, $applicationUuid);
        $this->authorize('delete', $application);

        $validated = validator($request->all(), [
            'delete_volumes' => ['nullable', 'boolean'],
            'delete_connected_networks' => ['nullable', 'boolean'],
            'delete_configurations' => ['nullable', 'boolean'],
            'docker_cleanup' => ['nullable', 'boolean'],
        ])->validate();

        DeleteResourceJob::dispatch(
            resource: $application,
            deleteVolumes: (bool) ($validated['delete_volumes'] ?? true),
            deleteConnectedNetworks: (bool) ($validated['delete_connected_networks'] ?? true),
            deleteConfigurations: (bool) ($validated['delete_configurations'] ?? true),
            dockerCleanup: (bool) ($validated['docker_cleanup'] ?? true),
        );

        auditLog('devforge.application.deleted', [
            'team_id' => $this->currentTeamContext->resolve($user)->id,
            'application_uuid' => $application->uuid,
            'application_name' => $application->name,
            'user_id' => $user->id,
        ]);

        return response()->json([
            'data' => [
                'queued' => true,
                'message' => 'Suppression de l’application planifiée.',
            ],
        ]);
    }

    public function runtimeSettings(Request $request, string $applicationUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $application = $this->currentTeamResources->application($user, $applicationUuid);
        $this->authorize('view', $application);

        return response()->json([
            'data' => $this->applicationRuntimeSettingsService->show($application),
        ]);
    }

    public function updateRuntimeSettings(Request $request, string $applicationUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $application = $this->currentTeamResources->application($user, $applicationUuid);
        $this->authorize('update', $application);

        $result = $this->applicationRuntimeSettingsService->update($application, $request->all());

        return response()->json([
            'data' => $result['settings'],
            'meta' => [
                'redeploy' => $result['redeploy'],
            ],
        ]);
    }

    public function readiness(Request $request, string $applicationUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $application = $this->currentTeamResources->application($user, $applicationUuid);
        $this->authorize('view', $application);

        return response()->json([
            'data' => $this->applicationReadinessService->present($application),
        ]);
    }

    public function updateReadiness(Request $request, string $applicationUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $application = $this->currentTeamResources->application($user, $applicationUuid);
        $this->authorize('update', $application);

        $validated = $request->validate([
            'autonomous_enabled' => ['required', 'boolean'],
        ]);

        return response()->json([
            'data' => $this->applicationReadinessService->updateAutonomous(
                $application,
                (bool) $validated['autonomous_enabled'],
            ),
        ]);
    }

    public function probeReadiness(Request $request, string $applicationUuid): JsonResponse
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $application = $this->currentTeamResources->application($user, $applicationUuid);
        $this->authorize('update', $application);

        $result = $this->applicationReadinessService->runProbe($application, dispatchAgentOnFailure: true);

        return response()->json([
            'data' => $this->applicationReadinessService->present($application),
            'meta' => [
                'probe_ok' => $result['ok'],
                'probe_url' => $result['url'],
                'probe_status' => $result['status'],
                'probe_error' => $result['error'],
            ],
        ]);
    }

    public function acknowledgeReadinessIntervention(
        Request $request,
        string $applicationUuid,
        string $interventionUuid,
    ): JsonResponse {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $application = $this->currentTeamResources->application($user, $applicationUuid);
        $this->authorize('update', $application);

        $result = $this->applicationReadinessService->acknowledgeInterventionDone(
            $application,
            $interventionUuid,
        );

        return response()->json([
            'data' => $result['readiness'],
            'meta' => [
                'restart' => $result['restart'],
            ],
        ]);
    }
}
