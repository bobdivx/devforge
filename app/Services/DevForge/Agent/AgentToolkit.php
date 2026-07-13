<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgentRun;
use App\Models\Team;
use App\Services\DevForge\Core\CoreResourceAction;
use App\Services\DevForge\Core\CoreResourceCatalog;
use App\Services\DevForge\DeploymentData;
use Illuminate\Database\Eloquent\Model;

class AgentToolkit
{
    private const MAX_DEPLOY_ACTIONS_PER_RUN = 1;

    private int $deployActionsTaken = 0;

    public function __construct(
        private readonly Team $team,
        private readonly AiAgentRun $run,
        private readonly CoreResourceCatalog $catalog,
        private readonly CoreResourceAction $resourceAction,
        private readonly DeploymentData $deploymentData,
        private readonly ?string $assignedResourceUuid = null,
        /** @var array<string, mixed> */
        private readonly array $runContext = [],
    ) {}

    /**
     * Retourne la liste des outils disponibles au format JSON Schema.
     *
     * @return array<array{name: string, description: string, parameters: array<mixed>}>
     */
    public function definitions(): array
    {
        return [
            [
                'name' => 'list_resources',
                'description' => 'Liste toutes les ressources de l\'équipe (serveurs, applications, bases de données, services) avec leur statut actuel.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'type' => [
                            'type' => 'string',
                            'enum' => ['servers', 'applications', 'databases', 'services', 'all'],
                            'description' => 'Type de ressource à lister. "all" retourne tous les types.',
                        ],
                    ],
                    'required' => ['type'],
                ],
            ],
            [
                'name' => 'get_resource_status',
                'description' => 'Obtient le statut détaillé d\'une ressource par son UUID.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'uuid' => ['type' => 'string', 'description' => 'UUID de la ressource'],
                        'type' => [
                            'type' => 'string',
                            'enum' => ['servers', 'applications', 'databases', 'services'],
                            'description' => 'Type de la ressource',
                        ],
                    ],
                    'required' => ['uuid', 'type'],
                ],
            ],
            [
                'name' => 'get_deployment_logs',
                'description' => 'Récupère les déploiements récents et, si deployment_uuid est fourni, les lignes de logs associées.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'application_uuid' => ['type' => 'string', 'description' => 'UUID de l\'application. Si omis, retourne les derniers déploiements de toutes les apps.'],
                        'deployment_uuid' => ['type' => 'string', 'description' => 'UUID d\'un déploiement précis pour inclure les logs.'],
                        'limit' => ['type' => 'integer', 'description' => 'Nombre de déploiements à retourner (défaut: 5)', 'default' => 5],
                        'log_lines' => ['type' => 'integer', 'description' => 'Nombre de lignes de logs à inclure pour deployment_uuid (défaut: 80)', 'default' => 80],
                    ],
                    'required' => [],
                ],
            ],
            [
                'name' => 'control_resource',
                'description' => 'Contrôle une ressource : démarrer, arrêter, redémarrer ou déployer une application/base de données/service.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'uuid' => ['type' => 'string', 'description' => 'UUID de la ressource'],
                        'type' => [
                            'type' => 'string',
                            'enum' => ['applications', 'databases', 'services'],
                            'description' => 'Type de la ressource',
                        ],
                        'action' => [
                            'type' => 'string',
                            'enum' => ['start', 'stop', 'restart', 'deploy'],
                            'description' => 'Action à effectuer',
                        ],
                        'reason' => ['type' => 'string', 'description' => 'Raison de l\'action (pour les logs)'],
                    ],
                    'required' => ['uuid', 'type', 'action', 'reason'],
                ],
            ],
            [
                'name' => 'get_server_metrics',
                'description' => 'Récupère les métriques d\'un serveur : CPU, RAM, disque. (Disponibilité limitée — retourne le statut actuel.)',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'server_uuid' => ['type' => 'string', 'description' => 'UUID du serveur'],
                    ],
                    'required' => ['server_uuid'],
                ],
            ],
            [
                'name' => 'send_notification',
                'description' => 'Enregistre une notification/observation dans les logs du run actuel.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'message' => ['type' => 'string', 'description' => 'Message à enregistrer'],
                        'level' => [
                            'type' => 'string',
                            'enum' => ['info', 'warning', 'error', 'success'],
                            'description' => 'Niveau du message',
                        ],
                    ],
                    'required' => ['message', 'level'],
                ],
            ],
        ];
    }

    /**
     * Exécute un outil et retourne le résultat.
     *
     * @param  array<string, mixed>  $arguments
     * @return array<string, mixed>
     */
    public function execute(string $toolName, array $arguments): array
    {
        $this->run->appendLog('  → Outil: '.$toolName.'('.json_encode($this->redactArguments($arguments)).')');

        $result = match ($toolName) {
            'list_resources' => $this->listResources($arguments['type'] ?? 'all'),
            'get_resource_status' => $this->getResourceStatus($arguments['uuid'], $arguments['type']),
            'get_deployment_logs' => $this->getDeploymentLogs(
                $arguments['application_uuid'] ?? null,
                (int) ($arguments['limit'] ?? 5),
                $arguments['deployment_uuid'] ?? null,
                (int) ($arguments['log_lines'] ?? 80),
            ),
            'control_resource' => $this->controlResource($arguments['uuid'], $arguments['type'], $arguments['action'], $arguments['reason'] ?? ''),
            'get_server_metrics' => $this->getServerMetrics($arguments['server_uuid']),
            'send_notification' => $this->sendNotification($arguments['message'], $arguments['level'] ?? 'info'),
            default => ['error' => "Outil inconnu: {$toolName}"],
        };

        $this->run->appendLog('  ← Résultat: '.mb_substr(json_encode($result), 0, 200));

        return $result;
    }

    /** @return array<mixed> */
    private function listResources(string $type): array
    {
        $types = $type === 'all'
            ? ['servers', 'applications', 'databases', 'services']
            : [$type];

        $resources = [];
        foreach ($types as $t) {
            $items = $this->catalog->resources($this->team, $t);
            $resources[$t] = $items
                ->filter(fn (Model $resource): bool => $this->matchesAssignedResource($resource))
                ->map(fn (Model $r) => [
                'uuid' => $r->getAttribute('uuid'),
                'name' => $r->getAttribute('name'),
                'status' => AgentResourceStatusResolver::resolve($r, $t),
                'type' => $t,
            ])->values()->all();
        }

        return ['resources' => $resources, 'total' => array_sum(array_map('count', $resources))];
    }

    /** @return array<mixed> */
    private function getResourceStatus(string $uuid, string $type): array
    {
        $resource = $this->catalog->find($this->team, $type, $uuid);

        if (! $resource || ! $this->matchesAssignedResource($resource)) {
            return ['error' => "Ressource {$uuid} introuvable."];
        }

        return [
            'uuid' => $resource->getAttribute('uuid'),
            'name' => $resource->getAttribute('name'),
            'status' => AgentResourceStatusResolver::resolve($resource, $type),
            'type' => $type,
        ];
    }

    /** @return array<mixed> */
    private function getDeploymentLogs(?string $applicationUuid, int $limit, ?string $deploymentUuid = null, int $logLines = 80): array
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
                $logs = $this->deploymentData->logs($deployment, 0);
                $entry['logs'] = collect($logs['items'] ?? [])
                    ->take(-$logLines)
                    ->values()
                    ->all();
            }

            return $entry;
        }, $paginator->items());

        if ($deploymentUuid !== null && ! collect($deployments)->contains(fn (array $item): bool => ($item['uuid'] ?? null) === $deploymentUuid)) {
            try {
                $deployment = $this->deploymentData->find($this->team, $deploymentUuid);
                $logs = $this->deploymentData->logs($deployment, 0);

                $deployments[] = [
                    'uuid' => $deployment->deployment_uuid,
                    'application_uuid' => $deployment->application?->uuid,
                    'application_name' => $deployment->application?->name,
                    'status' => $deployment->status,
                    'started_at' => optional($deployment->created_at)->toDateTimeString(),
                    'logs' => collect($logs['items'] ?? [])
                        ->take(-$logLines)
                        ->values()
                        ->all(),
                ];
            } catch (\Throwable) {
                // Ignore missing deployment in catalog lookup.
            }
        }

        return ['deployments' => $deployments];
    }

    /** @return array<mixed> */
    private function controlResource(string $uuid, string $type, string $action, string $reason): array
    {
        if ($action === 'deploy' && $this->deployActionsTaken >= self::MAX_DEPLOY_ACTIONS_PER_RUN) {
            return ['error' => 'Limite de redéploiements automatiques atteinte pour ce run (max '.self::MAX_DEPLOY_ACTIONS_PER_RUN.').'];
        }

        $resource = $this->catalog->find($this->team, $type, $uuid);

        if (! $resource || ! $this->matchesAssignedResource($resource)) {
            return ['error' => "Ressource {$uuid} introuvable."];
        }

        try {
            $result = $this->resourceAction->execute($resource, $type, $action, ['is_api' => true]);
            $this->run->appendLog("  ✓ Action {$action} sur {$uuid} : {$reason}");

            $actionsTaken = $this->run->actions_taken ?? [];
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

            $actionsTaken[] = $actionEntry;
            $this->run->actions_taken = $actionsTaken;
            $this->run->saveQuietly();

            if ($action === 'deploy') {
                $this->deployActionsTaken++;
            }

            return $result;
        } catch (\Throwable $e) {
            return ['error' => $e->getMessage()];
        }
    }

    /** @return array<mixed> */
    private function getServerMetrics(string $serverUuid): array
    {
        $server = $this->catalog->find($this->team, 'servers', $serverUuid);

        if (! $server) {
            return ['error' => "Serveur {$serverUuid} introuvable."];
        }

        return [
            'uuid' => $serverUuid,
            'name' => $server->getAttribute('name'),
            'status' => AgentResourceStatusResolver::resolve($server, 'servers'),
            'note' => 'Métriques temps réel disponibles via le canal WebSocket team.',
        ];
    }

    /** @return array<mixed> */
    private function sendNotification(string $message, string $level): array
    {
        $icon = match ($level) {
            'warning' => '⚠',
            'error' => '✗',
            'success' => '✓',
            default => 'ℹ',
        };
        $this->run->appendLog("{$icon} [{$level}] {$message}");

        return ['logged' => true, 'message' => $message];
    }

    private function matchesAssignedResource(Model $resource): bool
    {
        if ($this->assignedResourceUuid === null || $this->assignedResourceUuid === '') {
            return true;
        }

        return (string) $resource->getAttribute('uuid') === $this->assignedResourceUuid;
    }

    /**
     * @param  array<string, mixed>  $arguments
     * @return array<string, mixed>
     */
    private function redactArguments(array $arguments): array
    {
        $redacted = [];

        foreach ($arguments as $key => $value) {
            if (is_string($key) && preg_match('/(password|secret|token|key|api_key)/i', $key)) {
                $redacted[$key] = '********';
                continue;
            }

            $redacted[$key] = is_array($value) ? $this->redactArguments($value) : $value;
        }

        return $redacted;
    }
}
