<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\Team;
use App\Services\DevForge\Agent\Tool\AgentCustomTools;
use App\Services\DevForge\Agent\Tool\AgentGithubTools;
use App\Services\DevForge\Agent\Tool\AgentPermissionEngine;
use App\Services\DevForge\Agent\Tool\AgentServerExecutor;
use App\Services\DevForge\Agent\Tool\AgentToolClassification;
use App\Services\DevForge\Agent\Tool\AgentToolInstaller;
use App\Services\DevForge\Agent\Tool\AgentToolPackage;
use App\Services\DevForge\Agent\Tool\AgentToolkitSession;
use App\Services\DevForge\Core\CoreResourceAction;
use App\Services\DevForge\Core\CoreResourceCatalog;
use App\Services\DevForge\DeploymentData;
use App\Services\DevForge\Github\GithubAppCatalog;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Http;

class AgentToolkit
{
    private const MAX_DEPLOY_ACTIONS_PER_RUN = 1;

    private int $deployActionsTaken = 0;

    private readonly AgentServerExecutor $serverExecutor;

    private readonly AgentToolkitSession $session;

    private readonly AgentGithubTools $githubTools;

    private readonly AgentToolInstaller $toolInstaller;

    private readonly AgentCustomTools $customTools;

    public function __construct(
        private readonly Team $team,
        private readonly AiAgentRun $run,
        private readonly CoreResourceCatalog $catalog,
        private readonly CoreResourceAction $resourceAction,
        private readonly DeploymentData $deploymentData,
        private readonly ?AiAgent $agent = null,
        private readonly ?string $assignedResourceUuid = null,
        /** @var array<string, mixed> */
        private readonly array $runContext = [],
        private readonly ?AgentPermissionEngine $permissionEngine = null,
        private readonly ?AgentDelegator $delegator = null,
        ?GithubAppCatalog $githubAppCatalog = null,
    ) {
        $this->serverExecutor = new AgentServerExecutor(
            team: $this->team,
            catalog: $this->catalog,
            assignedResourceUuid: $this->assignedResourceUuid,
        );
        $this->session = new AgentToolkitSession($this->agent);
        $this->githubTools = new AgentGithubTools(
            $this->team,
            $this->catalog,
            $githubAppCatalog ?? app(GithubAppCatalog::class),
        );
        $this->toolInstaller = new AgentToolInstaller($this->serverExecutor);
        $this->customTools = new AgentCustomTools($this->serverExecutor);
    }

    /**
     * Retourne la liste des outils disponibles au format JSON Schema.
     *
     * @return array<array{name: string, description: string, parameters: array<mixed>}>
     */
    public function definitions(): array
    {
        $tools = $this->metaToolDefinitions();

        if ($this->session->isPackageEnabled(AgentToolPackage::PACKAGE_CORE)) {
            $tools = [...$tools, ...$this->coreToolDefinitions()];
        }

        if ($this->session->isPackageEnabled(AgentToolPackage::PACKAGE_GITHUB)) {
            $tools = [...$tools, ...$this->githubToolDefinitions()];
        }

        foreach ($this->session->customTools() as $customTool) {
            $tools[] = $this->customTools->definitionFromTool($customTool);
        }

        return $tools;
    }

    /** @return array<array{name: string, description: string, parameters: array<mixed>}> */
    private function metaToolDefinitions(): array
    {
        return [
            [
                'name' => 'enable_tool_package',
                'description' => 'Active un paquet d\'outils manquant (ex: github). Persisté pour les prochains runs. À utiliser dès qu\'un besoin n\'est pas couvert.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'package' => [
                            'type' => 'string',
                            'enum' => array_keys(AgentToolPackage::catalog()),
                            'description' => 'Identifiant du paquet à activer',
                        ],
                        'reason' => ['type' => 'string', 'description' => 'Pourquoi ce paquet est nécessaire'],
                    ],
                    'required' => ['package', 'reason'],
                ],
            ],
            [
                'name' => 'list_tool_packages',
                'description' => 'Liste les paquets d\'outils disponibles et ceux déjà activés pour cet agent.',
                'parameters' => ['type' => 'object', 'properties' => (object) []],
            ],
            [
                'name' => 'install_tool',
                'description' => 'Installe un paquet CLI sur un serveur géré (apt/apk/npm/pip). Ex: jq, gh, ripgrep.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'server_uuid' => ['type' => 'string', 'description' => 'UUID du serveur'],
                        'pkg' => ['type' => 'string', 'description' => 'Nom du paquet'],
                        'manager' => [
                            'type' => 'string',
                            'enum' => ['auto', 'apt', 'apk', 'npm', 'pip'],
                            'description' => 'Gestionnaire (auto par défaut)',
                        ],
                    ],
                    'required' => ['server_uuid', 'pkg'],
                ],
            ],
            [
                'name' => 'request_tool',
                'description' => 'Crée un outil custom (template shell) immédiatement disponible. Utilise {{param}} dans command_template.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'name' => ['type' => 'string', 'description' => 'Nom snake_case unique'],
                        'description' => ['type' => 'string', 'description' => 'Ce que fait l\'outil'],
                        'command_template' => ['type' => 'string', 'description' => 'Commande shell, ex: docker logs --tail {{lines|100}} {{container}}'],
                        'server_uuid' => ['type' => 'string', 'description' => 'Serveur par défaut (optionnel)'],
                        'parameters' => ['type' => 'string', 'description' => 'JSON Schema des paramètres (optionnel)'],
                    ],
                    'required' => ['name', 'command_template'],
                ],
            ],
        ];
    }

    /** @return array<array{name: string, description: string, parameters: array<mixed>}> */
    private function coreToolDefinitions(): array
    {
        $tools = [
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
            [
                'name' => 'exec_command',
                'description' => 'Exécute une commande shell sur un serveur géré via SSH. Utilise pour diagnostiquer (df, ps, docker ps, curl, etc.).',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'server_uuid' => ['type' => 'string', 'description' => 'UUID du serveur cible'],
                        'command' => ['type' => 'string', 'description' => 'Commande shell à exécuter'],
                        'timeout' => ['type' => 'integer', 'description' => 'Timeout en secondes (défaut: 60, max: 120)', 'default' => 60],
                    ],
                    'required' => ['server_uuid', 'command'],
                ],
            ],
            [
                'name' => 'read_remote_file',
                'description' => 'Lit un fichier sur un serveur distant (logs, configs). Max 32 Ko.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'server_uuid' => ['type' => 'string', 'description' => 'UUID du serveur'],
                        'path' => ['type' => 'string', 'description' => 'Chemin absolu du fichier'],
                    ],
                    'required' => ['server_uuid', 'path'],
                ],
            ],
            [
                'name' => 'list_remote_dir',
                'description' => 'Liste le contenu d\'un répertoire sur un serveur distant.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'server_uuid' => ['type' => 'string', 'description' => 'UUID du serveur'],
                        'path' => ['type' => 'string', 'description' => 'Chemin du répertoire (défaut: .)', 'default' => '.'],
                    ],
                    'required' => ['server_uuid'],
                ],
            ],
            [
                'name' => 'docker_logs',
                'description' => 'Récupère les logs Docker d\'un conteneur ou service sur un serveur.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'server_uuid' => ['type' => 'string', 'description' => 'UUID du serveur'],
                        'container' => ['type' => 'string', 'description' => 'Nom du conteneur ou service Docker'],
                        'lines' => ['type' => 'integer', 'description' => 'Nombre de lignes (défaut: 100, max: 500)', 'default' => 100],
                    ],
                    'required' => ['server_uuid', 'container'],
                ],
            ],
            [
                'name' => 'http_request',
                'description' => 'Effectue une requête HTTP (GET/POST/PUT/DELETE) vers une URL. Utile pour healthchecks et APIs.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'url' => ['type' => 'string', 'description' => 'URL complète'],
                        'method' => ['type' => 'string', 'enum' => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], 'default' => 'GET'],
                        'body' => ['type' => 'string', 'description' => 'Corps de la requête (JSON ou texte)'],
                        'headers' => ['type' => 'object', 'description' => 'En-têtes HTTP additionnels'],
                    ],
                    'required' => ['url'],
                ],
            ],
            [
                'name' => 'write_remote_file',
                'description' => 'Écrit un fichier sur un serveur distant (max 32 Ko). Réservé aux corrections de config.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'server_uuid' => ['type' => 'string', 'description' => 'UUID du serveur'],
                        'path' => ['type' => 'string', 'description' => 'Chemin absolu du fichier'],
                        'content' => ['type' => 'string', 'description' => 'Contenu à écrire'],
                    ],
                    'required' => ['server_uuid', 'path', 'content'],
                ],
            ],
        ];

        if ($this->canDelegate()) {
            $tools[] = [
                'name' => 'delegate_task',
                'description' => 'Délègue une sous-tâche à un agent enfant (synchrone). L\'agent parent attend le résumé du sous-agent.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'goal' => ['type' => 'string', 'description' => 'Objectif précis pour le sous-agent'],
                        'child_agent_uuid' => ['type' => 'string', 'description' => 'UUID du sous-agent (optionnel si un seul enfant existe)'],
                    ],
                    'required' => ['goal'],
                ],
            ];
        }

        if ($this->canSpawnEphemeral()) {
            $tools[] = [
                'name' => 'spawn_task',
                'description' => 'Lance une sous-tâche éphémère avec un modèle adapté à la difficulté (Auto · Flash-Lite / Flash / Pro). Isolée, synchrone, visible dans les logs du run.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'goal' => ['type' => 'string', 'description' => 'Objectif précis et autonome pour la sous-tâche'],
                        'difficulty' => [
                            'type' => 'string',
                            'enum' => ['auto', 'light', 'standard', 'heavy'],
                            'description' => 'Difficulté : light (inspection), standard (diagnostic), heavy (analyse profonde). Défaut auto.',
                        ],
                    ],
                    'required' => ['goal'],
                ],
            ];
        }

        return $tools;
    }

    /** @return array<array{name: string, description: string, parameters: array<mixed>}> */
    private function githubToolDefinitions(): array
    {
        return [
            [
                'name' => 'list_github_apps',
                'description' => 'Liste les GitHub Apps connectées à l\'équipe.',
                'parameters' => ['type' => 'object', 'properties' => (object) []],
            ],
            [
                'name' => 'list_github_repos',
                'description' => 'Liste les dépôts accessibles via une GitHub App.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'github_app_uuid' => ['type' => 'string', 'description' => 'UUID de la GitHub App'],
                    ],
                    'required' => ['github_app_uuid'],
                ],
            ],
            [
                'name' => 'list_github_branches',
                'description' => 'Liste les branches d\'un dépôt GitHub.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'github_app_uuid' => ['type' => 'string'],
                        'owner' => ['type' => 'string'],
                        'repo' => ['type' => 'string'],
                    ],
                    'required' => ['github_app_uuid', 'owner', 'repo'],
                ],
            ],
            [
                'name' => 'read_github_file',
                'description' => 'Lit un fichier source depuis GitHub (API contents). Max 32 Ko.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'github_app_uuid' => ['type' => 'string'],
                        'owner' => ['type' => 'string'],
                        'repo' => ['type' => 'string'],
                        'path' => ['type' => 'string', 'description' => 'Chemin du fichier dans le repo'],
                        'ref' => ['type' => 'string', 'description' => 'Branche, tag ou SHA (optionnel)'],
                    ],
                    'required' => ['github_app_uuid', 'owner', 'repo', 'path'],
                ],
            ],
            [
                'name' => 'list_github_dir',
                'description' => 'Liste le contenu d\'un répertoire GitHub.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'github_app_uuid' => ['type' => 'string'],
                        'owner' => ['type' => 'string'],
                        'repo' => ['type' => 'string'],
                        'path' => ['type' => 'string', 'description' => 'Chemin du dossier (vide = racine)'],
                        'ref' => ['type' => 'string', 'description' => 'Branche ou ref (optionnel)'],
                    ],
                    'required' => ['github_app_uuid', 'owner', 'repo'],
                ],
            ],
            [
                'name' => 'get_application_git_info',
                'description' => 'Retourne repo, branche, commit et GitHub App liés à une application Coolify.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'application_uuid' => ['type' => 'string'],
                    ],
                    'required' => ['application_uuid'],
                ],
            ],
            [
                'name' => 'list_github_pull_requests',
                'description' => 'Liste les Pull Requests d\'un dépôt GitHub.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'github_app_uuid' => ['type' => 'string'],
                        'owner' => ['type' => 'string'],
                        'repo' => ['type' => 'string'],
                        'state' => ['type' => 'string', 'enum' => ['open', 'closed', 'all'], 'default' => 'open'],
                        'limit' => ['type' => 'integer', 'default' => 10],
                    ],
                    'required' => ['github_app_uuid', 'owner', 'repo'],
                ],
            ],
            [
                'name' => 'get_github_pull_request',
                'description' => 'Détails d\'une Pull Request GitHub par numéro.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'github_app_uuid' => ['type' => 'string'],
                        'owner' => ['type' => 'string'],
                        'repo' => ['type' => 'string'],
                        'number' => ['type' => 'integer'],
                    ],
                    'required' => ['github_app_uuid', 'owner', 'repo', 'number'],
                ],
            ],
            [
                'name' => 'list_github_workflow_runs',
                'description' => 'Liste les exécutions GitHub Actions récentes d\'un dépôt.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'github_app_uuid' => ['type' => 'string'],
                        'owner' => ['type' => 'string'],
                        'repo' => ['type' => 'string'],
                        'branch' => ['type' => 'string', 'description' => 'Filtrer par branche (optionnel)'],
                        'limit' => ['type' => 'integer', 'default' => 10],
                    ],
                    'required' => ['github_app_uuid', 'owner', 'repo'],
                ],
            ],
            [
                'name' => 'get_github_workflow_run',
                'description' => 'Détails d\'une exécution GitHub Actions par ID.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'github_app_uuid' => ['type' => 'string'],
                        'owner' => ['type' => 'string'],
                        'repo' => ['type' => 'string'],
                        'run_id' => ['type' => 'integer'],
                    ],
                    'required' => ['github_app_uuid', 'owner', 'repo', 'run_id'],
                ],
            ],
            [
                'name' => 'list_github_commits',
                'description' => 'Liste les commits récents d\'un dépôt GitHub.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'github_app_uuid' => ['type' => 'string'],
                        'owner' => ['type' => 'string'],
                        'repo' => ['type' => 'string'],
                        'branch' => ['type' => 'string', 'description' => 'Branche ou SHA (optionnel)'],
                        'limit' => ['type' => 'integer', 'default' => 10],
                    ],
                    'required' => ['github_app_uuid', 'owner', 'repo'],
                ],
            ],
        ];
    }

    private function canDelegate(): bool
    {
        return $this->delegator !== null
            && $this->agent !== null
            && $this->agent->parent_agent_id === null
            && ! ($this->runContext['ephemeral'] ?? false);
    }

    private function canSpawnEphemeral(): bool
    {
        return $this->canDelegate();
    }

    /**
     * Exécute un outil et retourne le résultat.
     *
     * @param  array<string, mixed>  $arguments
     * @return array<string, mixed>
     */
    public function execute(string $toolName, array $arguments): array
    {
        if (! $this->session->isToolEnabled($toolName)) {
            $hint = $this->missingToolHint($toolName);

            return [
                'error' => "Outil « {$toolName} » non activé. {$hint}",
                'hint' => $hint,
            ];
        }

        $permissionResult = $this->checkPermission($toolName, $arguments);
        if ($permissionResult !== null) {
            return $permissionResult;
        }

        $this->run->appendLog('  → Outil: '.$toolName.'('.json_encode($this->redactArguments($arguments)).')');

        $result = match ($toolName) {
            'enable_tool_package' => $this->enableToolPackage(
                (string) ($arguments['package'] ?? ''),
                (string) ($arguments['reason'] ?? ''),
            ),
            'list_tool_packages' => $this->listToolPackages(),
            'install_tool' => $this->toolInstaller->install(
                (string) ($arguments['server_uuid'] ?? ''),
                (string) ($arguments['pkg'] ?? ''),
                (string) ($arguments['manager'] ?? 'auto'),
            ),
            'request_tool' => $this->requestTool($arguments),
            'list_github_apps' => $this->githubTools->listApps(),
            'list_github_repos' => $this->githubTools->listRepos((string) ($arguments['github_app_uuid'] ?? '')),
            'list_github_branches' => $this->githubTools->listBranches(
                (string) ($arguments['github_app_uuid'] ?? ''),
                (string) ($arguments['owner'] ?? ''),
                (string) ($arguments['repo'] ?? ''),
            ),
            'read_github_file' => $this->githubTools->readFile(
                (string) ($arguments['github_app_uuid'] ?? ''),
                (string) ($arguments['owner'] ?? ''),
                (string) ($arguments['repo'] ?? ''),
                (string) ($arguments['path'] ?? ''),
                isset($arguments['ref']) ? (string) $arguments['ref'] : null,
            ),
            'list_github_dir' => $this->githubTools->listDir(
                (string) ($arguments['github_app_uuid'] ?? ''),
                (string) ($arguments['owner'] ?? ''),
                (string) ($arguments['repo'] ?? ''),
                (string) ($arguments['path'] ?? ''),
                isset($arguments['ref']) ? (string) $arguments['ref'] : null,
            ),
            'get_application_git_info' => $this->githubTools->applicationGitInfo((string) ($arguments['application_uuid'] ?? '')),
            'list_github_pull_requests' => $this->githubTools->listPullRequests(
                (string) ($arguments['github_app_uuid'] ?? ''),
                (string) ($arguments['owner'] ?? ''),
                (string) ($arguments['repo'] ?? ''),
                (string) ($arguments['state'] ?? 'open'),
                (int) ($arguments['limit'] ?? 10),
            ),
            'get_github_pull_request' => $this->githubTools->getPullRequest(
                (string) ($arguments['github_app_uuid'] ?? ''),
                (string) ($arguments['owner'] ?? ''),
                (string) ($arguments['repo'] ?? ''),
                (int) ($arguments['number'] ?? 0),
            ),
            'list_github_workflow_runs' => $this->githubTools->listWorkflowRuns(
                (string) ($arguments['github_app_uuid'] ?? ''),
                (string) ($arguments['owner'] ?? ''),
                (string) ($arguments['repo'] ?? ''),
                isset($arguments['branch']) ? (string) $arguments['branch'] : null,
                (int) ($arguments['limit'] ?? 10),
            ),
            'get_github_workflow_run' => $this->githubTools->getWorkflowRun(
                (string) ($arguments['github_app_uuid'] ?? ''),
                (string) ($arguments['owner'] ?? ''),
                (string) ($arguments['repo'] ?? ''),
                (int) ($arguments['run_id'] ?? 0),
            ),
            'list_github_commits' => $this->githubTools->listCommits(
                (string) ($arguments['github_app_uuid'] ?? ''),
                (string) ($arguments['owner'] ?? ''),
                (string) ($arguments['repo'] ?? ''),
                isset($arguments['branch']) ? (string) $arguments['branch'] : null,
                (int) ($arguments['limit'] ?? 10),
            ),
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
            'exec_command' => $this->execCommand(
                $arguments['server_uuid'],
                $arguments['command'],
                (int) ($arguments['timeout'] ?? 60),
            ),
            'read_remote_file' => $this->serverExecutor->readRemoteFile(
                $arguments['server_uuid'],
                $arguments['path'],
            ),
            'list_remote_dir' => $this->serverExecutor->listRemoteDir(
                $arguments['server_uuid'],
                $arguments['path'] ?? '.',
            ),
            'docker_logs' => $this->serverExecutor->dockerLogs(
                $arguments['server_uuid'],
                $arguments['container'],
                (int) ($arguments['lines'] ?? 100),
            ),
            'http_request' => $this->httpRequest(
                $arguments['url'],
                $arguments['method'] ?? 'GET',
                $arguments['body'] ?? null,
                is_array($arguments['headers'] ?? null) ? $arguments['headers'] : [],
            ),
            'write_remote_file' => $this->serverExecutor->writeRemoteFile(
                $arguments['server_uuid'],
                $arguments['path'],
                $arguments['content'] ?? '',
            ),
            'delegate_task' => $this->delegateTask(
                $arguments['goal'] ?? '',
                $arguments['child_agent_uuid'] ?? null,
            ),
            'spawn_task' => $this->spawnTask(
                $arguments['goal'] ?? '',
                $arguments['difficulty'] ?? 'auto',
            ),
            default => $this->executeCustomTool($toolName, $arguments),
        };

        $this->run->appendLog('  ← Résultat: '.mb_substr(json_encode($result), 0, 200));

        return $result;
    }

    /**
     * @param  array<string, mixed>  $arguments
     * @return array<string, mixed>|null
     */
    private function checkPermission(string $toolName, array $arguments): ?array
    {
        if ($this->agent === null) {
            return null;
        }

        $engine = $this->permissionEngine ?? new AgentPermissionEngine;
        $classification = AgentToolClassification::forTool($toolName);
        $decision = $engine->decide($this->agent, $toolName, $arguments, $classification);

        if ($decision['decision'] === AgentPermissionEngine::DECISION_ALLOW) {
            return null;
        }

        if ($decision['decision'] === AgentPermissionEngine::DECISION_ASK) {
            $this->run->appendLog("  ⏸ Approbation requise [{$decision['rule_id']}]: {$decision['reason']}");

            return [
                'error' => $decision['reason'],
                'pending_approval' => true,
                'rule_id' => $decision['rule_id'],
            ];
        }

        $this->run->appendLog("  ✗ Refusé [{$decision['rule_id']}]: {$decision['reason']}");

        return [
            'error' => $decision['reason'],
            'denied' => true,
            'rule_id' => $decision['rule_id'],
        ];
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

    /** @return array<mixed> */
    private function delegateTask(string $goal, ?string $childAgentUuid): array
    {
        if (! $this->canDelegate()) {
            return ['error' => 'Délégation non disponible pour cet agent.'];
        }

        $goal = trim($goal);
        if ($goal === '') {
            return ['error' => 'Objectif de délégation vide.'];
        }

        return $this->delegator->delegate(
            $this->agent,
            $this->run,
            $goal,
            $childAgentUuid,
        );
    }

    /** @return array<mixed> */
    private function spawnTask(string $goal, ?string $difficulty): array
    {
        if (! $this->canSpawnEphemeral()) {
            return ['error' => 'Sous-tâches éphémères non disponibles pour cet agent.'];
        }

        $goal = trim($goal);
        if ($goal === '') {
            return ['error' => 'Objectif de sous-tâche vide.'];
        }

        return $this->delegator->spawnEphemeral(
            $this->agent,
            $this->run,
            $goal,
            $difficulty ?? 'auto',
        );
    }

    /** @return array<mixed> */
    private function execCommand(string $serverUuid, string $command, int $timeout): array
    {
        $timeout = max(5, min($timeout, 120));

        return $this->serverExecutor->execOnServer($serverUuid, $command, $timeout);
    }

    /**
     * @param  array<string, string>  $headers
     * @return array<mixed>
     */
    private function httpRequest(string $url, string $method, ?string $body, array $headers): array
    {
        if (! filter_var($url, FILTER_VALIDATE_URL)) {
            return ['error' => 'URL invalide.'];
        }

        $scheme = parse_url($url, PHP_URL_SCHEME);
        if (! in_array(strtolower((string) $scheme), ['http', 'https'], true)) {
            return ['error' => 'Seuls les schémas http et https sont autorisés.'];
        }

        try {
            $request = Http::timeout(30)->withHeaders($headers);
            $method = strtoupper($method);

            $response = match ($method) {
                'POST' => $request->withBody((string) $body, 'application/json')->post($url),
                'PUT' => $request->withBody((string) $body, 'application/json')->put($url),
                'PATCH' => $request->withBody((string) $body, 'application/json')->patch($url),
                'DELETE' => $request->delete($url),
                default => $request->get($url),
            };

            return [
                'status' => $response->status(),
                'body' => mb_substr($response->body(), 0, 16000),
                'success' => $response->successful(),
            ];
        } catch (\Throwable $exception) {
            return ['error' => mb_substr($exception->getMessage(), 0, 500)];
        }
    }

    /** @return array<mixed> */
    private function enableToolPackage(string $packageId, string $reason): array
    {
        $packageId = trim($packageId);
        if (! AgentToolPackage::exists($packageId)) {
            return [
                'error' => "Paquet inconnu: {$packageId}",
                'available' => array_keys(AgentToolPackage::catalog()),
            ];
        }

        if ($this->session->isPackageEnabled($packageId)) {
            return [
                'already_enabled' => true,
                'package' => $packageId,
                'tools' => AgentToolPackage::toolNames($packageId),
            ];
        }

        $this->session->enablePackage($packageId);
        $this->session->persistToAgent();
        $this->run->appendLog("  ✓ Paquet activé: {$packageId} — {$reason}");

        return [
            'enabled' => true,
            'package' => $packageId,
            'tools' => AgentToolPackage::toolNames($packageId),
            'message' => 'Paquet activé. Les outils sont disponibles immédiatement pour la suite de ce run.',
        ];
    }

    /** @return array<mixed> */
    private function listToolPackages(): array
    {
        return [
            'enabled' => $this->session->enabledPackages(),
            'available' => AgentToolPackage::listForApi(),
            'custom_tools' => array_map(
                fn (array $tool): string => (string) ($tool['name'] ?? ''),
                $this->session->customTools(),
            ),
        ];
    }

    /**
     * @param  array<string, mixed>  $arguments
     * @return array<mixed>
     */
    private function requestTool(array $arguments): array
    {
        $registration = $this->customTools->register($arguments);
        if (isset($registration['error'])) {
            return $registration;
        }

        $tool = $registration['tool'];
        $this->session->registerCustomTool($tool);
        $this->session->persistToAgent();
        $this->run->appendLog('  ✓ Outil custom créé: '.$tool['name']);

        return [
            'registered' => true,
            'name' => $tool['name'],
            'message' => "Outil « {$tool['name']} » disponible immédiatement.",
        ];
    }

    /**
     * @param  array<string, mixed>  $arguments
     * @return array<mixed>
     */
    private function executeCustomTool(string $toolName, array $arguments): array
    {
        foreach ($this->session->customTools() as $customTool) {
            if (($customTool['name'] ?? '') === $toolName) {
                return $this->customTools->execute($customTool, $arguments);
            }
        }

        return ['error' => "Outil inconnu: {$toolName}"];
    }

    private function missingToolHint(string $toolName): string
    {
        foreach (AgentToolPackage::catalog() as $packageId => $package) {
            if (in_array($toolName, $package['tools'], true)) {
                return "Appelle enable_tool_package(package=\"{$packageId}\", reason=\"...\") pour l'activer.";
            }
        }

        return 'Utilise list_tool_packages, enable_tool_package ou request_tool pour combler le manque.';
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
