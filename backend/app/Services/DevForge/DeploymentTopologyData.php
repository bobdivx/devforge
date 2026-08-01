<?php

namespace App\Services\DevForge;

use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\Application;
use App\Models\ApplicationDeploymentQueue;
use App\Models\GithubApp;
use App\Models\Team;
use App\Services\DevForge\Github\GithubAppCatalog;
use App\Services\DevForge\Readiness\ApplicationDomainProbe;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class DeploymentTopologyData
{
    private const ACTIVE_DEPLOYMENT_STATUSES = [
        'queued',
        'in_progress',
        'running-pre-deployment-command',
        'running-docker-compose',
        'building',
    ];

    public function __construct(
        private readonly GithubAppCatalog $githubAppCatalog,
        private readonly ApplicationDomainProbe $domainProbe,
    ) {}

    /**
     * @return array{nodes: list<array<string, mixed>>, edges: list<array<string, mixed>>, summary: array<string, int|bool>}
     */
    public function build(Team $team): array
    {
        $nodes = [];
        $edges = [];

        $hubId = 'hub:devforge';
        $nodes[] = $this->node($hubId, 'hub', 'DevForge', 'Orchestrateur', [
            'tone' => 'primary',
            'href' => '/',
        ]);

        $applications = Application::query()
            ->whereRelation('environment.project', 'team_id', $team->id)
            ->with([
                'source',
                'destination.server',
                'environment.project',
                'readiness',
            ])
            ->orderBy('name')
            ->get();

        $githubApps = $this->githubAppCatalog->appsForTeam($team)
            ->keyBy(fn (GithubApp $app): string => (string) $app->uuid);

        foreach ($githubApps as $githubApp) {
            $githubNodeId = 'github:'.$githubApp->uuid;
            $nodes[] = $this->node($githubNodeId, 'github', (string) ($githubApp->name ?: 'GitHub App'), 'Connexion GitHub', [
                'tone' => 'info',
                'href' => '/connexions',
                'meta' => [
                    'organization' => $githubApp->organization,
                    'html_url' => $githubApp->html_url,
                ],
            ]);
            $edges[] = $this->edge($hubId, $githubNodeId, 'connecte', 'Connexion');
        }

        $applicationIds = $applications
            ->pluck('id')
            ->map(static fn (mixed $id): string => (string) $id)
            ->all();

        $deploymentsByApp = $this->recentDeploymentsByApplication($applicationIds);
        $agents = $this->agentsForTeam($team);
        $agentRuns = $this->recentAgentRuns($team);

        foreach ($agents as $agent) {
            $agentNodeId = 'agent:'.$agent->uuid;
            $nodes[] = $this->node($agentNodeId, 'agent', (string) $agent->name, $this->agentTypeLabel((string) $agent->type), [
                'tone' => $agent->status === 'running' ? 'warning' : ($agent->is_active ? 'success' : 'neutral'),
                'status' => (string) $agent->status,
                'href' => '/agents/'.$agent->uuid,
                'meta' => [
                    'type' => $agent->type,
                    'avatar_color' => $agent->avatar_color,
                    'is_active' => (bool) $agent->is_active,
                    'resource_uuid' => $agent->resource_uuid,
                ],
            ]);
            $edges[] = $this->edge($hubId, $agentNodeId, 'pilote', 'Pilote');

            if (is_string($agent->resource_uuid) && $agent->resource_uuid !== '') {
                $edges[] = $this->edge($agentNodeId, 'app:'.$agent->resource_uuid, 'assigne', 'Assigné à');
            }
        }

        foreach ($applications as $application) {
            $appNodeId = 'app:'.$application->uuid;
            $domains = $this->domains($application->fqdn);
            $probeUrl = $this->domainProbe->primaryUrl($application);
            $readiness = $application->readiness;
            $serverName = data_get($application, 'destination.server.name');

            $nodes[] = $this->node($appNodeId, 'application', (string) $application->name, $serverName ? 'Serveur · '.$serverName : 'Application', [
                'tone' => $this->statusTone((string) $application->status),
                'status' => (string) $application->status,
                'href' => '/applications/'.$application->uuid,
                'meta' => [
                    'git_repository' => $application->git_repository,
                    'git_branch' => $application->git_branch,
                    'domains' => $domains,
                    'project' => data_get($application, 'environment.project.name'),
                    'environment' => data_get($application, 'environment.name'),
                ],
            ]);
            $edges[] = $this->edge($hubId, $appNodeId, 'gere', 'Gère');

            $source = $application->source;
            if ($source instanceof GithubApp) {
                $githubNodeId = 'github:'.$source->uuid;
                if (! $githubApps->has($source->uuid)) {
                    $nodes[] = $this->node($githubNodeId, 'github', (string) ($source->name ?: 'GitHub App'), 'Connexion GitHub', [
                        'tone' => 'info',
                        'href' => '/connexions',
                    ]);
                    $edges[] = $this->edge($hubId, $githubNodeId, 'connecte', 'Connexion');
                    $githubApps->put($source->uuid, $source);
                }

                $repoLabel = $this->repositoryLabel($application->git_repository);
                if ($repoLabel !== null) {
                    $repoNodeId = 'repo:'.$application->uuid;
                    $nodes[] = $this->node($repoNodeId, 'repository', $repoLabel, 'Branche · '.($application->git_branch ?: '—'), [
                        'tone' => 'info',
                        'href' => $this->safeExternalUrl($application->git_branch_location) ?? null,
                        'meta' => [
                            'git_repository' => $application->git_repository,
                            'git_branch' => $application->git_branch,
                            'external' => true,
                        ],
                    ]);
                    $edges[] = $this->edge($githubNodeId, $repoNodeId, 'heberge', 'Héberge');
                    $edges[] = $this->edge($repoNodeId, $appNodeId, 'source', 'Source');
                } else {
                    $edges[] = $this->edge($githubNodeId, $appNodeId, 'source', 'Source');
                }
            } elseif (filled($application->git_repository)) {
                $repoLabel = $this->repositoryLabel($application->git_repository) ?? (string) $application->git_repository;
                $repoNodeId = 'repo:'.$application->uuid;
                $nodes[] = $this->node($repoNodeId, 'repository', $repoLabel, 'Branche · '.($application->git_branch ?: '—'), [
                    'tone' => 'info',
                    'href' => (string) $application->git_repository,
                    'meta' => [
                        'git_repository' => $application->git_repository,
                        'git_branch' => $application->git_branch,
                        'external' => true,
                    ],
                ]);
                $edges[] = $this->edge($repoNodeId, $appNodeId, 'source', 'Source');
            }

            $appDeployments = $deploymentsByApp->get((string) $application->id, collect());
            foreach ($appDeployments as $deployment) {
                /** @var ApplicationDeploymentQueue $deployment */
                $deploymentNodeId = 'deployment:'.$deployment->deployment_uuid;
                $nodes[] = $this->node(
                    $deploymentNodeId,
                    'deployment',
                    $this->shortCommit($deployment->commit) ?? 'Déploiement',
                    $this->deploymentStatusLabel((string) $deployment->status),
                    [
                        'tone' => $this->deploymentTone((string) $deployment->status),
                        'status' => (string) $deployment->status,
                        'href' => '/applications/'.$application->uuid.'?tab=deployments',
                        'meta' => [
                            'uuid' => $deployment->deployment_uuid,
                            'commit' => $deployment->commit,
                            'commit_message' => $deployment->commit_message,
                            'created_at' => $deployment->created_at?->toISOString(),
                            'finished_at' => $deployment->finished_at?->toISOString(),
                            'is_webhook' => (bool) $deployment->is_webhook,
                            'pull_request_id' => (int) ($deployment->pull_request_id ?? 0),
                        ],
                    ],
                );
                $edges[] = $this->edge($appNodeId, $deploymentNodeId, 'deploie', 'Déploie');

                if ((bool) $deployment->is_webhook) {
                    $repoNodeId = 'repo:'.$application->uuid;
                    if (collect($nodes)->contains(fn (array $node): bool => $node['id'] === $repoNodeId)) {
                        $edges[] = $this->edge($repoNodeId, $deploymentNodeId, 'webhook', 'Webhook / Actions');
                    }
                }
            }

            if ($probeUrl !== null) {
                $productionNodeId = 'production:'.$application->uuid;
                $reachable = $readiness?->last_probe_ok;
                $nodes[] = $this->node($productionNodeId, 'production', $this->hostFromUrl($probeUrl), 'URL en production', [
                    'tone' => $reachable === true ? 'success' : ($reachable === false ? 'error' : 'neutral'),
                    'status' => $reachable === true ? 'reachable' : ($reachable === false ? 'unreachable' : 'unknown'),
                    'href' => $probeUrl,
                    'meta' => [
                        'url' => $probeUrl,
                        'domains' => $domains,
                        'external' => true,
                        'readiness_status' => $readiness?->status,
                        'last_probe_at' => $readiness?->last_probe_at?->toISOString(),
                        'last_http_status' => $readiness?->last_http_status,
                        'last_probe_error' => $readiness?->last_probe_error,
                    ],
                ]);
                $edges[] = $this->edge($appNodeId, $productionNodeId, 'publie', 'Publie');

                $latestFinished = $appDeployments->first(
                    fn (ApplicationDeploymentQueue $deployment): bool => in_array($deployment->status, ['finished', 'failed', 'cancelled-by-user'], true),
                );
                if ($latestFinished && $latestFinished->status === 'finished') {
                    $edges[] = $this->edge('deployment:'.$latestFinished->deployment_uuid, $productionNodeId, 'met_en_ligne', 'Met en ligne');
                }
            }
        }

        foreach ($agentRuns as $run) {
            $agent = $run->agent;
            if (! $agent) {
                continue;
            }

            $agentNodeId = 'agent:'.$agent->uuid;
            $deploymentUuid = data_get($run->metadata, 'deployment_uuid');
            $resourceUuid = is_string($agent->resource_uuid) ? $agent->resource_uuid : null;
            $interventionId = 'intervention:'.$run->uuid;

            $nodes[] = $this->node(
                $interventionId,
                'intervention',
                $this->truncate((string) ($run->summary ?: 'Intervention agent'), 48),
                $this->runStatusLabel((string) $run->status),
                [
                    'tone' => $this->runTone((string) $run->status),
                    'status' => (string) $run->status,
                    'href' => '/agents/'.$agent->uuid,
                    'meta' => [
                        'trigger' => $run->trigger,
                        'created_at' => $run->created_at?->toISOString(),
                        'deployment_uuid' => is_string($deploymentUuid) ? $deploymentUuid : null,
                        'agent_uuid' => $agent->uuid,
                    ],
                ],
            );
            $edges[] = $this->edge($agentNodeId, $interventionId, 'intervient', 'Intervient');

            if (is_string($deploymentUuid) && $deploymentUuid !== '') {
                $edges[] = $this->edge($interventionId, 'deployment:'.$deploymentUuid, 'surveille', 'Surveille');
            } elseif (is_string($resourceUuid) && $resourceUuid !== '') {
                $edges[] = $this->edge($interventionId, 'app:'.$resourceUuid, 'agit_sur', 'Agit sur');
            }
        }

        $nodes = $this->uniqueById($nodes);
        $edges = $this->uniqueEdges($edges, $nodes);

        return [
            'nodes' => array_values($nodes),
            'edges' => array_values($edges),
            'summary' => [
                'applications' => $applications->count(),
                'deployments' => collect($nodes)->where('type', 'deployment')->count(),
                'production_urls' => collect($nodes)->where('type', 'production')->count(),
                'agents' => collect($nodes)->where('type', 'agent')->count(),
                'interventions' => collect($nodes)->where('type', 'intervention')->count(),
                'github_connections' => collect($nodes)->where('type', 'github')->count(),
                'repositories' => collect($nodes)->where('type', 'repository')->count(),
                'reachable_urls' => collect($nodes)->where('type', 'production')->where('status', 'reachable')->count(),
                'agents_enabled' => $this->agentsAvailable(),
            ],
        ];
    }

    /**
     * @param  list<string>  $applicationIds
     * @return Collection<string, Collection<int, ApplicationDeploymentQueue>>
     */
    private function recentDeploymentsByApplication(array $applicationIds): Collection
    {
        if ($applicationIds === []) {
            return collect();
        }

        $deployments = ApplicationDeploymentQueue::query()
            ->select([
                'id',
                'application_id',
                'deployment_uuid',
                'pull_request_id',
                'commit',
                'commit_message',
                'status',
                'is_webhook',
                'created_at',
                'finished_at',
            ])
            ->whereIn('application_id', $applicationIds)
            ->latest('id')
            ->limit(max(20, count($applicationIds) * 3))
            ->get();

        return $deployments
            ->groupBy(fn (ApplicationDeploymentQueue $deployment): string => (string) $deployment->application_id)
            ->map(function (Collection $group): Collection {
                $active = $group->filter(
                    fn (ApplicationDeploymentQueue $deployment): bool => in_array((string) $deployment->status, self::ACTIVE_DEPLOYMENT_STATUSES, true)
                        || str_contains((string) $deployment->status, 'progress')
                        || str_contains((string) $deployment->status, 'queued'),
                )->take(2);

                $latest = $group->take(2);

                return $active->concat($latest)->unique('deployment_uuid')->take(3)->values();
            });
    }

    /**
     * @return Collection<int, AiAgent>
     */
    private function agentsForTeam(Team $team): Collection
    {
        if (! $this->agentsAvailable()) {
            return collect();
        }

        return AiAgent::query()
            ->where('team_id', $team->id)
            ->whereNull('parent_agent_id')
            ->orderByDesc('is_active')
            ->orderBy('name')
            ->limit(30)
            ->get();
    }

    /**
     * @return Collection<int, AiAgentRun>
     */
    private function recentAgentRuns(Team $team): Collection
    {
        if (! $this->agentsAvailable()) {
            return collect();
        }

        return AiAgentRun::query()
            ->whereHas('agent', fn ($query) => $query->where('team_id', $team->id))
            ->with(['agent:id,uuid,name,type,avatar_color,resource_uuid,status,is_active'])
            ->latest()
            ->limit(12)
            ->get();
    }

    private function agentsAvailable(): bool
    {
        if (! config('devforge.agents_enabled', false)) {
            return false;
        }

        return Schema::hasTable('ai_agents') && Schema::hasTable('ai_agent_runs');
    }

    /**
     * @param  array<string, mixed>  $extra
     * @return array<string, mixed>
     */
    private function node(string $id, string $type, string $label, string $subtitle, array $extra = []): array
    {
        return [
            'id' => $id,
            'type' => $type,
            'label' => $label,
            'subtitle' => $subtitle,
            'tone' => $extra['tone'] ?? 'neutral',
            'status' => $extra['status'] ?? null,
            'href' => $extra['href'] ?? null,
            'meta' => $extra['meta'] ?? [],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function edge(string $from, string $to, string $kind, string $label): array
    {
        return [
            'id' => $kind.':'.$from.'>'.$to,
            'from' => $from,
            'to' => $to,
            'kind' => $kind,
            'label' => $label,
        ];
    }

    /**
     * @return list<string>
     */
    private function domains(?string $fqdn): array
    {
        if (! filled($fqdn)) {
            return [];
        }

        return collect(explode(',', (string) $fqdn))
            ->map(fn (string $part): string => trim($part))
            ->filter()
            ->values()
            ->all();
    }

    private function repositoryLabel(?string $repository): ?string
    {
        if (! filled($repository)) {
            return null;
        }

        $value = (string) $repository;
        $value = str_replace(['git@', ':', '.git'], ['', '/', ''], $value);
        $value = preg_replace('#^https?://#', '', $value) ?? $value;
        $value = trim($value, '/');

        if (str_contains($value, 'github.com/')) {
            $value = Str::after($value, 'github.com/');
        }

        return $value !== '' ? $value : null;
    }

    private function hostFromUrl(string $url): string
    {
        $host = parse_url($url, PHP_URL_HOST);

        return is_string($host) && $host !== '' ? $host : $url;
    }

    private function shortCommit(?string $commit): ?string
    {
        if (! filled($commit)) {
            return null;
        }

        return Str::substr((string) $commit, 0, 7);
    }

    private function truncate(string $value, int $limit): string
    {
        return Str::limit(trim($value), $limit, '…');
    }

    private function safeExternalUrl(mixed $value): ?string
    {
        if (! is_string($value) || $value === '') {
            return null;
        }

        return filter_var($value, FILTER_VALIDATE_URL) ? $value : null;
    }

    private function statusTone(string $status): string
    {
        $normalized = strtolower($status);

        if (str_contains($normalized, 'running') || str_contains($normalized, 'healthy')) {
            return 'success';
        }

        if (str_contains($normalized, 'degraded') || str_contains($normalized, 'restart')) {
            return 'warning';
        }

        if (str_contains($normalized, 'exited') || str_contains($normalized, 'error') || str_contains($normalized, 'unhealthy')) {
            return 'error';
        }

        return 'neutral';
    }

    private function deploymentTone(string $status): string
    {
        return match (true) {
            $status === 'finished' => 'success',
            $status === 'failed', $status === 'cancelled-by-user' => 'error',
            in_array($status, self::ACTIVE_DEPLOYMENT_STATUSES, true),
            str_contains($status, 'progress'),
            str_contains($status, 'queued') => 'warning',
            default => 'neutral',
        };
    }

    private function runTone(string $status): string
    {
        return match ($status) {
            'completed' => 'success',
            'failed' => 'error',
            'running', 'pending', 'waiting_for_input', 'waiting_for_subagents', 'awaiting_approval' => 'warning',
            default => 'neutral',
        };
    }

    private function deploymentStatusLabel(string $status): string
    {
        return match (true) {
            $status === 'finished' => 'Terminé',
            $status === 'failed' => 'Échoué',
            $status === 'cancelled-by-user' => 'Annulé',
            str_contains($status, 'queued') => 'En file',
            str_contains($status, 'progress'), str_contains($status, 'building') => 'En cours',
            default => $status,
        };
    }

    private function runStatusLabel(string $status): string
    {
        return match ($status) {
            'completed' => 'Terminée',
            'failed' => 'Échouée',
            'running' => 'En cours',
            'pending' => 'En attente',
            'awaiting_approval' => 'Approbation',
            'waiting_for_input' => 'Attend une entrée',
            'waiting_for_subagents' => 'Sous-agents',
            default => $status,
        };
    }

    private function agentTypeLabel(string $type): string
    {
        return match ($type) {
            'deployment' => 'Agent déploiement',
            'github' => 'Agent GitHub',
            'github-actions' => 'Agent GitHub Actions',
            'debug' => 'Agent debug',
            'security' => 'Agent sécurité',
            'tech-watch' => 'Veille tech',
            'devforge' => 'Agent DevForge',
            default => 'Agent',
        };
    }

    /**
     * @param  list<array<string, mixed>>  $nodes
     * @return list<array<string, mixed>>
     */
    private function uniqueById(array $nodes): array
    {
        $seen = [];
        $unique = [];

        foreach ($nodes as $node) {
            $id = (string) $node['id'];
            if (isset($seen[$id])) {
                continue;
            }
            $seen[$id] = true;
            $unique[] = $node;
        }

        return $unique;
    }

    /**
     * @param  list<array<string, mixed>>  $edges
     * @param  list<array<string, mixed>>  $nodes
     * @return list<array<string, mixed>>
     */
    private function uniqueEdges(array $edges, array $nodes): array
    {
        $nodeIds = collect($nodes)->pluck('id')->all();
        $seen = [];
        $unique = [];

        foreach ($edges as $edge) {
            if (! in_array($edge['from'], $nodeIds, true) || ! in_array($edge['to'], $nodeIds, true)) {
                continue;
            }

            $id = (string) $edge['id'];
            if (isset($seen[$id])) {
                continue;
            }
            $seen[$id] = true;
            $unique[] = $edge;
        }

        return $unique;
    }
}
