<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\Application;
use App\Models\ApplicationDeploymentQueue;
use App\Models\Team;
use App\Services\DevForge\DeploymentData;
use App\Services\DevForge\SecretRedactor;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Log;

class DeploymentFailureAgentDispatcher
{
    private const CONTEXT_MARKER = 'deployment_uuid';

    public function __construct(
        private readonly DeploymentData $deploymentData,
        private readonly AgentRunLauncher $agentRunLauncher,
        private readonly DeploymentAgentResolver $agentResolver,
        private readonly DeploymentAgentDispatchLimiter $dispatchLimiter,
        private readonly SecretRedactor $secretRedactor,
    ) {}

    public function dispatch(
        Application $application,
        string $deploymentUuid,
        ApplicationDeploymentQueue $deploymentQueue,
    ): ?AiAgentRun {
        if (! config('devforge.agents_enabled') || ! config('devforge.agents_auto_fix_deployments')) {
            return null;
        }

        $team = $this->agentResolver->resolveTeam($application);

        if (! $team instanceof Team) {
            Log::warning('DevForge: impossible de résoudre l\'équipe pour l\'échec de déploiement.', [
                'application_uuid' => $application->uuid,
                'deployment_uuid' => $deploymentUuid,
            ]);

            return null;
        }

        if ($this->wasRecentlyHandled($team, $deploymentUuid)) {
            return null;
        }

        if (! $this->dispatchLimiter->allows(DeploymentAgentDispatchLimiter::EVENT_FAILED, $team, $deploymentUuid)) {
            return null;
        }

        $agent = $this->agentResolver->resolve($team, $application->uuid, DeploymentAgentResolver::FAILURE_TYPES);

        if (! $agent instanceof AiAgent) {
            Log::warning('DevForge: aucun agent éligible pour traiter l\'échec de déploiement.', [
                'team_id' => $team->id,
                'application_uuid' => $application->uuid,
                'deployment_uuid' => $deploymentUuid,
                'diagnostics' => $this->agentResolver->diagnostics($team, $application->uuid),
            ]);

            return null;
        }

        $context = $this->buildContext($application, $deploymentUuid, $deploymentQueue);

        $run = $this->agentRunLauncher->queue($agent, 'event', $context);

        if ($run === null) {
            Log::warning('DevForge: agent trouvé mais indisponible pour l\'échec (déjà en cours).', [
                'agent_uuid' => $agent->uuid,
                'deployment_uuid' => $deploymentUuid,
            ]);

            return null;
        }

        try {
            app(ApplicationOverviewChatBridge::class)->postFailureAnnouncement(
                $agent,
                $run,
                $application,
                $context,
            );
        } catch (\Throwable $e) {
            Log::warning('DevForge: impossible de publier l’échec dans le chat overview.', [
                'deployment_uuid' => $deploymentUuid,
                'error' => $e->getMessage(),
            ]);
        }

        Log::info('DevForge: agent IA déclenché après échec de déploiement.', [
            'agent_uuid' => $agent->uuid,
            'run_uuid' => $run->uuid,
            'application_uuid' => $application->uuid,
            'deployment_uuid' => $deploymentUuid,
        ]);

        return $run;
    }

    private function wasRecentlyHandled(Team $team, string $deploymentUuid): bool
    {
        return AiAgentRun::query()
            ->where('trigger', 'event')
            ->where('created_at', '>=', now()->subHour())
            ->where(function ($query) use ($deploymentUuid): void {
                $query->where('metadata->deployment_uuid', $deploymentUuid)
                    ->orWhere('logs', 'like', '%"'.self::CONTEXT_MARKER.'":"'.$deploymentUuid.'"%');
            })
            ->where(function ($query): void {
                $query->where('metadata->event', 'deployment_failed')
                    ->orWhere('logs', 'like', '%"event":"deployment_failed"%');
            })
            // Un run avorté (0 itération / job mort) ne doit pas bloquer une relance.
            ->where(function ($query): void {
                $query->whereIn('status', ['pending', 'running', 'completed'])
                    ->orWhere(function ($failed): void {
                        $failed->where('status', 'failed')
                            ->where('iterations', '>', 0);
                    });
            })
            ->whereHas('agent', fn ($query) => $query->where('team_id', $team->id))
            ->exists();
    }

    /**
     * @return array<string, mixed>
     */
    private function buildContext(
        Application $application,
        string $deploymentUuid,
        ApplicationDeploymentQueue $deploymentQueue,
    ): array {
        $logExcerpt = $this->extractFailureLogExcerpt($application, $deploymentQueue);

        return [
            'event' => 'deployment_failed',
            self::CONTEXT_MARKER => $deploymentUuid,
            'application_uuid' => $application->uuid,
            'application_name' => $application->name,
            'git_branch' => $application->git_branch ?: null,
            'build_pack' => $application->build_pack ?: null,
            'install_command' => $application->install_command ?: null,
            'build_command' => $application->build_command ?: null,
            'start_command' => $application->start_command ?: null,
            'ports_exposes' => $application->ports_exposes ?: null,
            'base_directory' => $application->base_directory ?: null,
            'publish_directory' => $application->publish_directory ?: null,
            'is_static' => (bool) ($application->settings?->is_static ?? false),
            'workdir' => $application->workdir(),
            'commit' => $deploymentQueue->commit ?: null,
            'commit_message' => $deploymentQueue->commit_message ?: null,
            'status' => $deploymentQueue->status,
            'failure_excerpt' => $logExcerpt,
            'subagent_role' => \App\Services\DevForge\Agent\Tool\AgentSubagentCapabilities::ROLE_ORCHESTRATOR,
            'spawn_depth' => 0,
            'deploy_pipeline' => ['diagnose', 'fix', 'redeploy'],
            'max_redeploy' => 1,
            'standing_order_hint' => app(AgentStandingOrders::class)->defaultDeployFailureBody(),
        ];
    }

    /**
     * Extrait léger pour éviter de bloquer le dispatch sur des builds Nixpacks
     * avec des milliers de lignes de warnings. Les messages sont redactés
     * (SecretRedactor) avant injection dans le contexte LLM.
     *
     * @return array<int, array{stream: string, message: string, timestamp: string|null}>
     */
    private function extractFailureLogExcerpt(
        Application $application,
        ApplicationDeploymentQueue $deploymentQueue,
        int $maxLines = 40,
    ): array {
        $lines = $this->rawDeploymentLogLines($deploymentQueue);

        if ($lines->isEmpty()) {
            $payload = $this->deploymentData->logs($deploymentQueue, 0);
            $lines = collect($payload['items'] ?? [])->map(fn (array $line): array => [
                'stream' => (string) ($line['stream'] ?? 'stdout'),
                'message' => (string) ($line['message'] ?? ''),
                'timestamp' => isset($line['timestamp']) ? (string) $line['timestamp'] : null,
            ]);
        }

        $stderrLines = $lines
            ->filter(fn (array $line): bool => ($line['stream'] ?? '') === 'stderr')
            ->values();

        $candidatePool = $stderrLines->isNotEmpty() ? $stderrLines : $lines;

        $signalLines = $candidatePool
            ->filter(fn (array $line): bool => $this->isFailureSignal((string) ($line['message'] ?? '')))
            ->values();

        $usefulLines = $candidatePool
            ->reject(fn (array $line): bool => $this->isBuildNoise((string) ($line['message'] ?? '')))
            ->values();

        if ($signalLines->isNotEmpty()) {
            $selected = $usefulLines
                ->filter(fn (array $line): bool => $this->isFailureSignal((string) ($line['message'] ?? ''))
                    || $this->isFailureContext((string) ($line['message'] ?? '')))
                ->take(-$maxLines);
        } else {
            $selected = $usefulLines->isNotEmpty()
                ? $usefulLines->take(-$maxLines)
                : $candidatePool->take(-$maxLines);
        }

        if ($selected->isEmpty()) {
            $selected = $lines->take(-$maxLines);
        }

        return $selected
            ->map(fn (array $line): array => [
                'stream' => (string) ($line['stream'] ?? 'stdout'),
                'message' => mb_substr(
                    $this->secretRedactor->redact((string) ($line['message'] ?? ''), $application),
                    0,
                    2000,
                ),
                'timestamp' => isset($line['timestamp']) ? (string) $line['timestamp'] : null,
            ])
            ->values()
            ->all();
    }

    /**
     * Parse le format brut DevForge ({command,output,type,...}).
     *
     * @return Collection<int, array{stream: string, message: string, timestamp: string|null}>
     */
    private function rawDeploymentLogLines(ApplicationDeploymentQueue $deploymentQueue): Collection
    {
        $raw = $deploymentQueue->logs;

        if (is_string($raw) && $raw !== '') {
            $decoded = json_decode($raw, true);
        } elseif (is_array($raw)) {
            $decoded = $raw;
        } else {
            $decoded = null;
        }

        if (! is_array($decoded)) {
            return collect();
        }

        return collect($decoded)
            ->filter(fn (mixed $item): bool => is_array($item))
            ->flatMap(function (array $item): array {
                $stream = (($item['type'] ?? '') === 'stderr' || ! empty($item['stderr']))
                    ? 'stderr'
                    : 'stdout';
                $timestamp = isset($item['timestamp']) ? (string) $item['timestamp'] : null;
                $rows = [];

                $command = $item['command'] ?? null;
                if (is_string($command) && $command !== '') {
                    $rows[] = [
                        'stream' => $stream,
                        'message' => $command,
                        'timestamp' => $timestamp,
                    ];
                }

                $output = (string) ($item['output'] ?? $item['line'] ?? $item['message'] ?? '');
                foreach (preg_split("/\r\n|\n|\r/", $output) ?: [] as $line) {
                    if ($line === '') {
                        continue;
                    }
                    $rows[] = [
                        'stream' => $stream,
                        'message' => $line,
                        'timestamp' => $timestamp,
                    ];
                }

                return $rows;
            })
            ->values();
    }

    private function isBuildNoise(string $message): bool
    {
        return (bool) preg_match(
            '/SecretsUsedInArgOrEnv|UndefinedVar|warnings found \(use docker|Do not use ARG or ENV instructions|npm warn\b|No such container:/i',
            $message,
        );
    }

    private function isFailureSignal(string $message): bool
    {
        return (bool) preg_match(
            '/\bERROR\b|npm ERR!|ELIFECYCLE|ERESOLVE|ENOENT|Permission denied|EACCES|tee:.*Permission|Read-only file system|cannot create directory|failed to (build|solve)|did not complete successfully|exit code:\s*[1-9]|exit status [1-9]|Remote branch .+ not found|Could not find remote branch/i',
            $message,
        );
    }

    private function isFailureContext(string $message): bool
    {
        return (bool) preg_match(
            '/^Dockerfile:|^\s*-{3,}\s*$|^\s*\d+\s*\||>>>\s*RUN|npm ci|package-lock|npm error|docker-compose\.ya?ml|\.env\b|data\/applications|AppData\/coolify/i',
            $message,
        );
    }
}
