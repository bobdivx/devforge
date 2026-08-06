<?php

namespace App\Services\DevForge\Application;

use App\Enums\BuildPackTypes;
use App\Jobs\LoadComposeFile;
use App\Models\Application;
use App\Models\GithubApp;
use App\Models\StandaloneDocker;
use App\Models\SwarmDocker;
use App\Models\Team;
use App\Models\User;
use App\Rules\ValidGitBranch;
use App\Services\DevForge\CurrentTeamResources;
use App\Services\DevForge\DeploymentTargetData;
use App\Services\DevForge\Github\GithubAppCatalog;
use App\Services\DevForge\Readiness\ApplicationReadinessService;
use Illuminate\Support\Facades\Http;
use Illuminate\Validation\Rule;
use Throwable;
use Visus\Cuid2\Cuid2;

class ApplicationFromGithubCreator
{
    public function __construct(
        private readonly CurrentTeamResources $currentTeamResources,
        private readonly DeploymentTargetData $deploymentTargetData,
        private readonly GithubAppCatalog $githubAppCatalog,
    ) {}

    /**
     * @param  array<string, mixed>  $input
     * @return array{application: Application, instant_deploy: bool}
     */
    public function create(User $user, Team $team, array $input): array
    {
        $validated = validator($input, [
            'project_uuid' => ['required', 'string'],
            'environment_uuid' => ['required', 'string'],
            'destination_uuid' => ['required', 'string'],
            'github_app_uuid' => ['required', 'string'],
            'git_repository' => ['required', 'string', 'regex:/^[a-zA-Z0-9\-_.]+\/[a-zA-Z0-9\-_.]+$/'],
            'repository_id' => ['nullable', 'integer'],
            'git_branch' => ['required', 'string', new ValidGitBranch],
            'build_pack' => ['required', Rule::enum(BuildPackTypes::class)],
            'ports_exposes' => ['nullable', 'integer', 'min:1', 'max:65535'],
            'name' => ['nullable', 'string', 'max:255'],
            'instant_deploy' => ['nullable', 'boolean'],
        ])->validate();

        $project = $this->currentTeamResources->project($user, $validated['project_uuid']);
        $environment = $this->currentTeamResources->environment(
            $user,
            $validated['project_uuid'],
            $validated['environment_uuid'],
        );

        $destination = $this->deploymentTargetData->destinationForTeam($team, $validated['destination_uuid']);
        abort_unless($destination instanceof StandaloneDocker || $destination instanceof SwarmDocker, 404, 'Destination not found.');

        $githubApp = $this->githubAppCatalog->appForTeam($team, $validated['github_app_uuid']);
        $repositoryId = $this->resolveRepositoryId($githubApp, $validated);

        $buildPack = $validated['build_pack'];
        $portsExposes = (int) ($validated['ports_exposes'] ?? ($buildPack === BuildPackTypes::STATIC->value ? 80 : 3000));
        $instantDeploy = (bool) ($validated['instant_deploy'] ?? false);

        $name = filled($validated['name'] ?? null)
            ? trim((string) $validated['name'])
            : generate_application_name($validated['git_repository'], $validated['git_branch']);

        $application = Application::create([
            'name' => $name,
            'repository_project_id' => $repositoryId,
            'git_repository' => $validated['git_repository'],
            'git_branch' => $validated['git_branch'],
            'build_pack' => $buildPack,
            'ports_exposes' => $portsExposes,
            'environment_id' => $environment->id,
            'destination_id' => $destination->id,
            'destination_type' => $destination->getMorphClass(),
            'source_id' => $githubApp->id,
            'source_type' => $githubApp->getMorphClass(),
        ]);

        $server = $destination->server;
        abort_unless($server !== null, 422, 'Destination server not found.');
        $server->loadMissing('settings');
        $application->fqdn = generateUrl(server: $server, random: $application->uuid);
        $application->save();

        app(ApplicationReadinessService::class)->ensureFor($application, autonomousEnabled: true);

        try {
            app(ApplicationDeploySettingsReconciler::class)->reconcile($application);
            $application->refresh();
        } catch (Throwable) {
            // Detection must never block app creation.
        }

        if ($buildPack === BuildPackTypes::DOCKERCOMPOSE->value) {
            LoadComposeFile::dispatch($application);
        }

        if ($instantDeploy) {
            queue_application_deployment(
                application: $application,
                deployment_uuid: new Cuid2,
                no_questions_asked: true,
                is_api: true,
            );
        }

        auditLog('devforge.application.created', [
            'team_id' => $team->id,
            'application_uuid' => $application->uuid,
            'application_name' => $application->name,
            'build_pack' => $application->build_pack,
            'instant_deploy' => $instantDeploy,
        ]);

        return [
            'application' => $application->load(['environment.project', 'destination.server']),
            'instant_deploy' => $instantDeploy,
        ];
    }

    /**
     * @param  array<string, mixed>  $validated
     */
    private function resolveRepositoryId(GithubApp $githubApp, array $validated): int
    {
        if (isset($validated['repository_id'])) {
            return (int) $validated['repository_id'];
        }

        $token = generateGithubInstallationToken($githubApp);
        abort_unless($token, 400, 'Failed to generate GitHub App token.');

        $response = Http::GitHub($githubApp->api_url, $token)
            ->timeout(20)
            ->retry(3, 200, throw: false)
            ->get("/repos/{$validated['git_repository']}");

        abort_if(
            in_array($response->status(), [403, 404], true),
            404,
            'Repository not found or not accessible by the GitHub App.',
        );
        abort_unless($response->successful(), 400, $response->json('message', 'Failed to verify repository access.'));

        return (int) data_get($response->json(), 'id');
    }
}
