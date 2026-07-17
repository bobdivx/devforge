<?php

namespace App\Services\DevForge\Application;

use App\Models\AiAgentRun;
use App\Models\Application;
use App\Models\ApplicationDeploymentQueue;
use App\Models\Server;
use App\Models\Team;
use App\Rules\ValidGitBranch;
use App\Services\DevForge\Agent\Tool\AgentServerExecutor;
use App\Services\DevForge\Core\CoreResourceAction;
use App\Services\DevForge\Core\CoreResourceCatalog;
use App\Services\DevForge\DeploymentData;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\Validator;

/**
 * Actions de réparation application partagées entre AgentToolkit et MCP DevForge.
 */
class ApplicationRepairActions
{
    private int $deployActionsTaken = 0;

    /**
     * @param  array<string, mixed>  $runContext
     */
    public function __construct(
        private readonly Team $team,
        private readonly CoreResourceCatalog $catalog,
        private readonly CoreResourceAction $resourceAction,
        private readonly DeploymentData $deploymentData,
        private readonly AgentServerExecutor $serverExecutor,
        private readonly ?AiAgentRun $run = null,
        private readonly ?string $assignedResourceUuid = null,
        private readonly array $runContext = [],
        private readonly int $maxDeployActions = 1,
    ) {}

    /** @return array<mixed> */
    public function getDeploymentLogs(?string $applicationUuid, int $limit, ?string $deploymentUuid = null, int $logLines = 80): array
    {
        $contextApplicationUuid = is_string($this->runContext['application_uuid'] ?? null)
            ? $this->runContext['application_uuid']
            : null;
        $contextDeploymentUuid = is_string($this->runContext['deployment_uuid'] ?? null)
            ? $this->runContext['deployment_uuid']
            : null;

        $applicationUuid = $applicationUuid ?: $contextApplicationUuid;
        $deploymentUuid = $deploymentUuid ?: $contextDeploymentUuid;

        $paginator = $this->deploymentData->paginate($this->team, 1, $limit, $applicationUuid, null);

        $deployments = array_map(function ($deployment) use ($deploymentUuid, $logLines): array {
            $entry = [
                'uuid' => $deployment->deployment_uuid ?? null,
                'application_uuid' => $deployment->application?->uuid ?? null,
                'application_name' => $deployment->application?->name ?? null,
                'status' => $deployment->status ?? null,
                'started_at' => optional($deployment->created_at)->toDateTimeString(),
            ];

            if ($deploymentUuid !== null && $deployment->deployment_uuid === $deploymentUuid) {
                $entry['logs'] = $this->recentDeploymentLogLines($deployment, $logLines);
            }

            return $entry;
        }, $paginator->items());

        if ($deploymentUuid !== null && ! collect($deployments)->contains(fn (array $item): bool => ($item['uuid'] ?? null) === $deploymentUuid)) {
            try {
                $deployment = $this->deploymentData->find($this->team, $deploymentUuid);

                $deployments[] = [
                    'uuid' => $deployment->deployment_uuid,
                    'application_uuid' => $deployment->application?->uuid,
                    'application_name' => $deployment->application?->name,
                    'status' => $deployment->status,
                    'started_at' => optional($deployment->created_at)->toDateTimeString(),
                    'logs' => $this->recentDeploymentLogLines($deployment, $logLines),
                ];
            } catch (\Throwable) {
                // Ignore missing deployment in catalog lookup.
            }
        }

        return ['deployments' => $deployments];
    }

    /** @return array<mixed> */
    public function controlResource(string $uuid, string $type, string $action, string $reason): array
    {
        if ($uuid === '' || $type === '' || $action === '') {
            return ['error' => 'Paramètres uuid, type et action requis pour control_resource.'];
        }

        if ($action === 'deploy' && $this->deployActionsTaken >= $this->maxDeployActions) {
            return ['error' => 'Limite de redéploiements automatiques atteinte pour ce run (max '.$this->maxDeployActions.').'];
        }

        $resource = $this->catalog->find($this->team, $type, $uuid);

        if (! $resource || ! $this->matchesAssignedResource($resource)) {
            return ['error' => "Ressource {$uuid} introuvable."];
        }

        try {
            $result = $this->resourceAction->execute($resource, $type, $action, ['is_api' => true]);
            $this->appendRunLog("  ✓ Action {$action} sur {$uuid} : {$reason}");

            $actionEntry = [
                'tool' => 'control_resource',
                'uuid' => $uuid,
                'type' => $type,
                'action' => $action,
                'reason' => $reason,
                'at' => now()->toISOString(),
            ];

            if (is_string($result['deployment_uuid'] ?? null)) {
                $actionEntry['deployment_uuid'] = $result['deployment_uuid'];
            }

            if (array_key_exists('queued', $result)) {
                $actionEntry['queued'] = (bool) $result['queued'];
            }

            $this->recordAction($actionEntry);

            if ($action === 'deploy') {
                $this->deployActionsTaken++;
            }

            return $result;
        } catch (\Throwable $e) {
            return ['error' => $e->getMessage()];
        }
    }

    /**
     * MCP v1 : uniquement deploy sur applications.
     *
     * @return array<mixed>
     */
    public function deployApplication(string $uuid, string $reason = 'MCP DevForge redeploy'): array
    {
        return $this->controlResource($uuid, 'applications', 'deploy', $reason);
    }

    /** @return array<string, mixed> */
    public function updateApplicationGitBranch(
        ?string $applicationUuid,
        string $gitBranch,
        bool $redeploy = true,
        string $reason = '',
    ): array {
        $branch = trim($gitBranch);
        if ($branch === '') {
            return ['error' => 'Paramètre git_branch requis pour update_application_git_branch.'];
        }

        $validator = Validator::make(
            ['git_branch' => $branch],
            ['git_branch' => ['required', 'string', 'max:255', new ValidGitBranch]],
        );

        if ($validator->fails()) {
            return ['error' => $validator->errors()->first('git_branch') ?? 'Branche Git invalide.'];
        }

        $application = $this->resolveApplication($applicationUuid);
        if (is_array($application)) {
            return $application;
        }

        $previousBranch = (string) ($application->git_branch ?? '');
        if ($previousBranch === $branch) {
            $payload = [
                'ok' => true,
                'unchanged' => true,
                'application_uuid' => $application->uuid,
                'git_branch' => $branch,
                'previous_git_branch' => $previousBranch,
            ];

            if ($redeploy) {
                $deploy = $this->controlResource(
                    $application->uuid,
                    'applications',
                    'deploy',
                    $reason !== '' ? $reason : "Redéploiement sur branche {$branch}",
                );
                if (isset($deploy['error'])) {
                    return [...$payload, 'redeploy' => $deploy, 'hint' => 'Branche déjà configurée, mais le redeploy a échoué.'];
                }

                return [...$payload, 'redeploy' => $deploy];
            }

            return $payload;
        }

        try {
            $application->git_branch = $branch;
            $application->save();
        } catch (\Throwable $exception) {
            return ['error' => mb_substr($exception->getMessage(), 0, 300)];
        }

        $this->appendRunLog("  ✓ Branche Coolify {$previousBranch} → {$branch} sur {$application->uuid}");

        $this->recordAction([
            'tool' => 'update_application_git_branch',
            'uuid' => $application->uuid,
            'type' => 'applications',
            'action' => 'update_git_branch',
            'reason' => $reason !== '' ? $reason : "Branche {$previousBranch} → {$branch}",
            'git_branch' => $branch,
            'previous_git_branch' => $previousBranch,
            'at' => now()->toISOString(),
        ]);

        $payload = [
            'ok' => true,
            'application_uuid' => $application->uuid,
            'git_branch' => $branch,
            'previous_git_branch' => $previousBranch,
        ];

        if (! $redeploy) {
            return [
                ...$payload,
                'hint' => 'Branche mise à jour. Utilise control_resource deploy pour reconstruire.',
            ];
        }

        $deploy = $this->controlResource(
            $application->uuid,
            'applications',
            'deploy',
            $reason !== '' ? $reason : "Redeploy après passage sur {$branch}",
        );

        if (isset($deploy['error'])) {
            return [
                ...$payload,
                'redeploy' => $deploy,
                'hint' => 'Branche mise à jour, mais le redeploy a échoué — réessaie control_resource deploy.',
            ];
        }

        return [...$payload, 'redeploy' => $deploy];
    }

    /** @return array<string, mixed> */
    public function fixApplicationHostPermissions(
        ?string $applicationUuid,
        ?string $pathHint,
        bool $redeploy = true,
        string $reason = '',
    ): array {
        $application = $this->resolveApplication($applicationUuid);
        if (is_array($application)) {
            return $application;
        }

        $serverResolution = $this->serverExecutor->resolveServerForApplication($application->uuid);
        if (! ($serverResolution['success'] ?? false)) {
            return ['error' => (string) ($serverResolution['error'] ?? 'Serveur introuvable pour cette application.')];
        }

        $serverUuid = (string) $serverResolution['server_uuid'];
        $path = $this->resolveApplicationHostDirectory($application, $pathHint);
        if (isset($path['error'])) {
            return $path;
        }

        /** @var string $hostPath */
        $hostPath = $path['path'];
        $escapedPath = escapeshellarg($hostPath);

        $server = $this->catalog->find($this->team, 'servers', $serverUuid);
        $owner = $server instanceof Server && is_string($server->user) && $server->user !== ''
            ? $server->user
            : 'root';
        $escapedOwner = escapeshellarg($owner);

        // Use semicolons + bash -c so parseCommandsByLineForSudo does not inject
        // `sudo` into shell assignments (TARGET=… / OWNER=…) via `&&` rewriting.
        $script = implode('; ', [
            'set -e',
            "TARGET={$escapedPath}",
            "OWNER={$escapedOwner}",
            'echo "ssh_user=$OWNER effective=$(id -un)"',
            'mkdir -p "$TARGET"',
            'ls -lad "$TARGET" || true',
            'chown -R "$OWNER:$OWNER" "$TARGET"',
            'chmod -R u+rwX "$TARGET"',
            'touch "$TARGET/.coolify-write-test"',
            'rm -f "$TARGET/.coolify-write-test"',
            'ls -lad "$TARGET"',
            'echo OK_HOST_PERMISSIONS_FIXED',
        ]);
        $command = 'bash -c '.escapeshellarg($script);

        $result = $this->serverExecutor->execOnServer($serverUuid, $command, 90);
        if (! ($result['success'] ?? false)) {
            return [
                'error' => (string) ($result['error'] ?? 'Échec de correction des permissions host.'),
                'path' => $hostPath,
                'server_uuid' => $serverUuid,
                'exit_code' => $result['exit_code'] ?? null,
                'hint' => 'Vérifie que le terminal SSH Coolify peut chown ce chemin (sudo/non-root).',
            ];
        }

        $this->appendRunLog("  ✓ Permissions host corrigées sur {$hostPath} ({$application->uuid})");

        $this->recordAction([
            'tool' => 'fix_application_host_permissions',
            'uuid' => $application->uuid,
            'type' => 'applications',
            'action' => 'fix_host_permissions',
            'reason' => $reason !== '' ? $reason : 'Permission denied host',
            'path' => $hostPath,
            'server_uuid' => $serverUuid,
            'at' => now()->toISOString(),
        ]);

        $payload = [
            'ok' => true,
            'application_uuid' => $application->uuid,
            'server_uuid' => $serverUuid,
            'path' => $hostPath,
            'output' => mb_substr((string) ($result['output'] ?? ''), 0, 2000),
        ];

        if (! $redeploy) {
            return [
                ...$payload,
                'hint' => 'Permissions corrigées. Utilise control_resource deploy pour reconstruire.',
            ];
        }

        $deploy = $this->controlResource(
            $application->uuid,
            'applications',
            'deploy',
            $reason !== '' ? $reason : 'Redeploy après correction permissions host',
        );

        if (isset($deploy['error'])) {
            return [
                ...$payload,
                'redeploy' => $deploy,
                'hint' => 'Permissions corrigées, mais le redeploy a échoué — réessaie control_resource deploy.',
            ];
        }

        return [...$payload, 'redeploy' => $deploy];
    }

    /**
     * Recharge BASE_CONFIG_PATH dans Coolify (config:clear + horizon:terminate) quand
     * les déploiements écrivent encore sous /data/coolify alors que CasaOS expose /media/Docker/...
     *
     * @return array<string, mixed>
     */
    public function fixCoolifyBaseConfigPath(
        ?string $applicationUuid,
        bool $redeploy = true,
        string $reason = '',
        ?string $container = null,
    ): array {
        $application = $this->resolveApplication($applicationUuid);
        if (is_array($application)) {
            return $application;
        }

        $serverResolution = $this->serverExecutor->resolveServerForApplication($application->uuid);
        if (! ($serverResolution['success'] ?? false)) {
            return ['error' => (string) ($serverResolution['error'] ?? 'Serveur introuvable pour cette application.')];
        }

        $serverUuid = (string) $serverResolution['server_uuid'];
        $containerName = is_string($container) && trim($container) !== '' ? trim($container) : 'coolify';
        if (preg_match('/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/', $containerName) !== 1) {
            return ['error' => 'Nom de conteneur Coolify invalide.'];
        }

        $escapedContainer = escapeshellarg($containerName);
        $script = implode('; ', [
            'set -e',
            "C={$escapedContainer}",
            'echo "ENV_BASE=$(docker exec \"$C\" printenv BASE_CONFIG_PATH 2>/dev/null || echo MISSING)"',
            'test -d /media/Docker/AppData/coolify/data && echo MEDIA_PATH_OK=1 || echo MEDIA_PATH_OK=0',
            'docker exec -w /var/www/html "$C" php artisan config:clear',
            'docker exec -w /var/www/html "$C" php artisan horizon:terminate || true',
            'echo OK_COOLIFY_BASE_CONFIG_RELOADED',
        ]);
        $command = 'bash -c '.escapeshellarg($script);

        $result = $this->serverExecutor->execOnServer($serverUuid, $command, 120);
        if (! ($result['success'] ?? false)) {
            return [
                'error' => (string) ($result['error'] ?? 'Échec du rechargement BASE_CONFIG_PATH.'),
                'server_uuid' => $serverUuid,
                'container' => $containerName,
                'exit_code' => $result['exit_code'] ?? null,
                'hint' => 'Vérifie docker.sock / conteneur coolify et BASE_CONFIG_PATH dans CasaOS.',
            ];
        }

        $output = (string) ($result['output'] ?? '');
        if (! str_contains($output, 'OK_COOLIFY_BASE_CONFIG_RELOADED')) {
            return [
                'error' => 'Rechargement BASE_CONFIG_PATH non confirmé.',
                'output' => mb_substr($output, 0, 2000),
                'server_uuid' => $serverUuid,
                'container' => $containerName,
            ];
        }

        if (
            preg_match('/ENV_BASE=(MISSING|\/data\/coolify)\b/', $output) === 1
            && str_contains($output, 'MEDIA_PATH_OK=1')
        ) {
            return [
                'error' => 'BASE_CONFIG_PATH Docker vaut encore /data/coolify (ou est absent) alors que /media/Docker/AppData/coolify/data existe.',
                'output' => mb_substr($output, 0, 2000),
                'server_uuid' => $serverUuid,
                'container' => $containerName,
                'hint' => 'Dans CasaOS, force BASE_CONFIG_PATH=/media/Docker/AppData/coolify/data puis redémarre le conteneur coolify.',
            ];
        }

        $this->appendRunLog("  ✓ Coolify BASE_CONFIG_PATH rechargé (config:clear + horizon:terminate) sur {$containerName}");

        $this->recordAction([
            'tool' => 'fix_coolify_base_config_path',
            'uuid' => $application->uuid,
            'type' => 'applications',
            'action' => 'fix_coolify_base_config_path',
            'reason' => $reason !== '' ? $reason : 'Read-only /data Coolify path',
            'container' => $containerName,
            'server_uuid' => $serverUuid,
            'at' => now()->toISOString(),
        ]);

        $payload = [
            'ok' => true,
            'application_uuid' => $application->uuid,
            'server_uuid' => $serverUuid,
            'container' => $containerName,
            'output' => mb_substr($output, 0, 2000),
        ];

        if (! $redeploy) {
            return [
                ...$payload,
                'hint' => 'Config rechargée. Utilise control_resource deploy pour reconstruire.',
            ];
        }

        $deploy = $this->controlResource(
            $application->uuid,
            'applications',
            'deploy',
            $reason !== '' ? $reason : 'Redeploy après rechargement BASE_CONFIG_PATH',
        );

        if (isset($deploy['error'])) {
            return [
                ...$payload,
                'redeploy' => $deploy,
                'hint' => 'Config rechargée, mais le redeploy a échoué — réessaie control_resource deploy.',
            ];
        }

        return [...$payload, 'redeploy' => $deploy];
    }

    /**
     * @return array{path: string}|array{error: string}
     */
    public function resolveApplicationHostDirectory(Application $application, ?string $pathHint): array
    {
        $candidates = [];

        if (is_string($pathHint) && trim($pathHint) !== '') {
            $candidates[] = trim($pathHint);
        }

        foreach ($this->runContext['failure_excerpt'] ?? [] as $line) {
            if (! is_array($line)) {
                continue;
            }
            $message = (string) ($line['message'] ?? '');
            if ($message === '') {
                continue;
            }
            if (preg_match('#((?:/[^\s:\"\']+)+/applications/'.preg_quote($application->uuid, '#').')(?:/[^\s:\"\']*)?#', $message, $match) === 1) {
                $candidates[] = $match[1];
            }
        }

        $candidates[] = $application->workdir();
        $candidates[] = '/media/Docker/AppData/coolify/data/applications/'.$application->uuid;
        $candidates[] = '/data/coolify/applications/'.$application->uuid;

        foreach ($candidates as $candidate) {
            $normalized = $this->normalizeApplicationHostPath($application, $candidate);
            if ($normalized !== null) {
                return ['path' => $normalized];
            }
        }

        return ['error' => 'Impossible de résoudre un chemin host sûr pour cette application.'];
    }

    /**
     * @return array<string, mixed>|Application
     */
    public function resolveApplication(?string $applicationUuid): array|Application
    {
        $uuid = $this->resolveApplicationUuid($applicationUuid);

        if ($uuid === null) {
            return ['error' => 'application_uuid requis (ou contexte déploiement / agent lié à une application).'];
        }

        try {
            $application = app(ApplicationSourceService::class)->applicationForTeam($this->team, $uuid);
        } catch (ModelNotFoundException) {
            return ['error' => "Application {$uuid} introuvable."];
        }

        if (! $this->matchesAssignedResource($application)) {
            return ['error' => 'Agent limité à une autre ressource — accès refusé.'];
        }

        return $application;
    }

    public function resolveApplicationUuid(?string $applicationUuid): ?string
    {
        if ($applicationUuid !== null && $applicationUuid !== '') {
            return $applicationUuid;
        }

        $contextUuid = $this->runContext['application_uuid'] ?? null;
        if (is_string($contextUuid) && $contextUuid !== '') {
            return $contextUuid;
        }

        if ($this->assignedResourceUuid !== null
            && $this->assignedResourceUuid !== ''
            && $this->catalog->find($this->team, 'applications', $this->assignedResourceUuid) !== null) {
            return $this->assignedResourceUuid;
        }

        return null;
    }

    private function matchesAssignedResource(Model $resource): bool
    {
        if ($this->assignedResourceUuid === null || $this->assignedResourceUuid === '') {
            return true;
        }

        return (string) $resource->getAttribute('uuid') === $this->assignedResourceUuid;
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function recentDeploymentLogLines(ApplicationDeploymentQueue $deployment, int $logLines): array
    {
        $logs = $this->deploymentData->logs($deployment, 0);

        return collect($logs['items'] ?? [])
            ->take(-max(1, min($logLines, 120)))
            ->values()
            ->all();
    }

    private function normalizeApplicationHostPath(Application $application, string $rawPath): ?string
    {
        $path = str_replace('\\', '/', trim($rawPath));
        $path = preg_replace('#^tee:\s*#i', '', $path) ?? $path;
        $path = rtrim($path, '/');

        if ($path === '' || str_contains($path, '..') || ! str_starts_with($path, '/')) {
            return null;
        }

        if (! str_contains($path, '/applications/'.$application->uuid)) {
            return null;
        }

        if (preg_match('#/applications/'.preg_quote($application->uuid, '#').'/(.+)$#', $path, $match) === 1) {
            $remainder = $match[1];
            if ($remainder !== '' && ! str_contains($remainder, '/')) {
                if (str_contains($remainder, '.')) {
                    $path = preg_replace('#/[^/]+$#', '', $path) ?? $path;
                }
            } elseif ($remainder !== '') {
                if (preg_match('#^(.*/applications/'.preg_quote($application->uuid, '#').')(?:/|$)#', $path, $root) === 1) {
                    $path = $root[1];
                }
            }
        }

        if (! str_ends_with($path, '/applications/'.$application->uuid)) {
            return null;
        }

        return $path;
    }

    private function appendRunLog(string $message): void
    {
        $this->run?->appendLog($message);
    }

    /**
     * @param  array<string, mixed>  $actionEntry
     */
    private function recordAction(array $actionEntry): void
    {
        if ($this->run === null) {
            return;
        }

        $actionsTaken = $this->run->actions_taken ?? [];
        $actionsTaken[] = $actionEntry;
        $this->run->actions_taken = $actionsTaken;
        $this->run->saveQuietly();
    }
}
