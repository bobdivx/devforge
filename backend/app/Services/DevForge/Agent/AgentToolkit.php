<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\AiAgentKeyRequest;
use App\Models\Application;
use App\Models\Team;
use App\Services\DevForge\Agent\AgentFeatureDelivery;
use App\Services\DevForge\Agent\Tool\AgentCustomTools;
use App\Services\DevForge\Agent\Tool\AgentGithubTools;
use App\Services\DevForge\Agent\Tool\AgentPermissionEngine;
use App\Services\DevForge\Agent\Tool\AgentServerExecutor;
use App\Services\DevForge\Agent\Tool\AgentSubagentCapabilities;
use App\Services\DevForge\Agent\Tool\AgentToolApprovalGrant;
use App\Services\DevForge\Agent\Tool\AgentToolClassification;
use App\Services\DevForge\Agent\Tool\ApplicationSourceWritePreview;
use App\Services\DevForge\Agent\Tool\AgentToolInstaller;
use App\Services\DevForge\Agent\Tool\AgentToolkitSession;
use App\Services\DevForge\Agent\Tool\AgentToolPackage;
use App\Services\DevForge\Application\ApplicationEnvironmentVariableCatalog;
use App\Services\DevForge\Application\ApplicationRepairActions;
use App\Services\DevForge\Application\ApplicationRuntimeSettingsService;
use App\Services\DevForge\Application\ApplicationSourceService;
use App\Services\DevForge\Core\CoreResourceAction;
use App\Services\DevForge\Core\CoreResourceCatalog;
use App\Services\DevForge\DeploymentData;
use App\Services\DevForge\Docker\DockerImageUpdateChecker;
use App\Services\DevForge\Github\GithubAppCatalog;
use App\Services\DevForge\Server\ServerPathValidator;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\Http;
use Illuminate\Validation\ValidationException;

class AgentToolkit
{
    private const MAX_DEPLOY_ACTIONS_PER_RUN = 1;

    private readonly AgentServerExecutor $serverExecutor;

    private readonly ApplicationRepairActions $repairActions;

    private readonly AgentToolkitSession $session;

    private readonly AgentGithubTools $githubTools;

    private readonly AgentToolInstaller $toolInstaller;

    private readonly AgentCustomTools $customTools;

    private readonly ApplicationEnvironmentVariableCatalog $envCatalog;

    /**
     * @param  array<string, mixed>  $runContext
     * @param  list<string>  $extraToolPackages
     */
    public function __construct(
        private readonly Team $team,
        private readonly AiAgentRun $run,
        private readonly CoreResourceCatalog $catalog,
        private readonly CoreResourceAction $resourceAction,
        private readonly DeploymentData $deploymentData,
        private readonly ?AiAgent $agent = null,
        private readonly ?string $assignedResourceUuid = null,
        private readonly array $runContext = [],
        private readonly ?AgentPermissionEngine $permissionEngine = null,
        private readonly ?AgentDelegator $delegator = null,
        ?GithubAppCatalog $githubAppCatalog = null,
        ?ApplicationEnvironmentVariableCatalog $envCatalog = null,
        array $extraToolPackages = [],
    ) {
        $this->serverExecutor = new AgentServerExecutor(
            team: $this->team,
            catalog: $this->catalog,
            assignedResourceUuid: $this->assignedResourceUuid,
        );
        $this->repairActions = new ApplicationRepairActions(
            team: $this->team,
            catalog: $this->catalog,
            resourceAction: $this->resourceAction,
            deploymentData: $this->deploymentData,
            serverExecutor: $this->serverExecutor,
            run: $this->run,
            assignedResourceUuid: $this->assignedResourceUuid,
            runContext: $this->runContext,
            maxDeployActions: self::MAX_DEPLOY_ACTIONS_PER_RUN,
        );
        $this->session = new AgentToolkitSession($this->agent, $extraToolPackages);
        $this->githubTools = new AgentGithubTools(
            $this->team,
            $this->catalog,
            $githubAppCatalog ?? app(GithubAppCatalog::class),
        );
        $this->toolInstaller = new AgentToolInstaller($this->serverExecutor);
        $this->customTools = new AgentCustomTools($this->serverExecutor);
        $this->envCatalog = $envCatalog ?? app(ApplicationEnvironmentVariableCatalog::class);
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

        $mcpRegistry = app(AgentMcpClientRegistry::class);
        if ($mcpRegistry->enabled()) {
            $tools = [...$tools, ...$mcpRegistry->toolDefinitions($this->agent)];
        }

        $chatMode = AgentChatMode::parse($this->runContext['chat_mode'] ?? 'build');
        $leafAllowed = AgentSubagentCapabilities::leafAllowedTools($this->runContext);
        $role = AgentSubagentCapabilities::resolveRole($this->runContext);

        return array_values(array_filter(
            $tools,
            function (array $tool) use ($chatMode, $leafAllowed, $role): bool {
                $name = (string) ($tool['name'] ?? '');
                if (! AgentChatMode::isToolAllowed($name, $chatMode)) {
                    return false;
                }
                if ($role === AgentSubagentCapabilities::ROLE_LEAF
                    && AgentSubagentCapabilities::isOrchestrationTool($name)) {
                    return false;
                }
                if ($role === AgentSubagentCapabilities::ROLE_LEAF
                    && (str_starts_with($name, 'mcp__') || str_starts_with($name, 'mcp_'))) {
                    return false;
                }
                if ($leafAllowed !== null && ! in_array($name, $leafAllowed, true)) {
                    return false;
                }

                return true;
            },
        ));
    }

    /** @return array<array{name: string, description: string, parameters: array<mixed>}> */
    private function metaToolDefinitions(): array
    {
        $tools = [
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
            [
                'name' => 'request_api_key',
                'description' => 'Demande une clé API ou un token (ex: OPENAI_API_KEY, GITHUB_TOKEN) à l\'utilisateur. L\'agent sera suspendu jusqu\'à ce que la clé soit fournie.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'key_name' => ['type' => 'string', 'description' => 'Le nom de la variable d\'environnement (en MAJUSCULES)'],
                        'reason' => ['type' => 'string', 'description' => 'Raison claire pour laquelle cette clé est nécessaire'],
                    ],
                    'required' => ['key_name', 'reason'],
                ],
            ],
            [
                'name' => 'memory_read',
                'description' => 'Lit la mémoire persistante. scope=agent (toi), shared (équipe), project (ressource), ou all.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'scope' => [
                            'type' => 'string',
                            'enum' => ['agent', 'shared', 'project', 'all'],
                            'description' => 'Portée de lecture (défaut: all)',
                        ],
                        'limit' => ['type' => 'integer', 'description' => 'Nombre max d’entrées (défaut 20)'],
                        'query' => ['type' => 'string', 'description' => 'Filtre texte optionnel'],
                        'resource_uuid' => ['type' => 'string', 'description' => 'UUID ressource pour scope=project'],
                    ],
                ],
            ],
            [
                'name' => 'memory_write',
                'description' => 'Enregistre un fait durable. scope=agent (privé), shared (équipe), project (ressource). Préfère shared pour les conventions d’équipe.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'content' => ['type' => 'string', 'description' => 'Fait concis à mémoriser'],
                        'scope' => [
                            'type' => 'string',
                            'enum' => ['agent', 'shared', 'project'],
                            'description' => 'Portée (défaut: agent)',
                        ],
                        'resource_uuid' => ['type' => 'string', 'description' => 'UUID ressource si scope=project'],
                        'tags' => [
                            'type' => 'array',
                            'items' => ['type' => 'string'],
                            'description' => 'Tags optionnels',
                        ],
                    ],
                    'required' => ['content'],
                ],
            ],
            [
                'name' => 'todo_read',
                'description' => 'Lit la todo list de la tâche / run en cours.',
                'parameters' => ['type' => 'object', 'properties' => (object) []],
            ],
            [
                'name' => 'todo_write',
                'description' => 'Met à jour la todo list du run. Passe items[] pour remplacer, ou content(+id/status) pour upsert.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'items' => [
                            'type' => 'array',
                            'description' => 'Liste complète de todos (remplace)',
                            'items' => [
                                'type' => 'object',
                                'properties' => [
                                    'id' => ['type' => 'string'],
                                    'content' => ['type' => 'string'],
                                    'status' => [
                                        'type' => 'string',
                                        'enum' => ['pending', 'in_progress', 'completed', 'cancelled'],
                                    ],
                                ],
                            ],
                        ],
                        'content' => ['type' => 'string', 'description' => 'Contenu d’un todo (upsert)'],
                        'id' => ['type' => 'string', 'description' => 'Id du todo à mettre à jour'],
                        'status' => [
                            'type' => 'string',
                            'enum' => ['pending', 'in_progress', 'completed', 'cancelled'],
                        ],
                    ],
                ],
            ],
            [
                'name' => 'web_search',
                'description' => 'Recherche web (docs, erreurs, changelogs). Préfère pour infos externes à Coolify.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'query' => ['type' => 'string', 'description' => 'Requête de recherche'],
                        'limit' => ['type' => 'integer', 'description' => 'Nombre de résultats (1-10, défaut 5)'],
                    ],
                    'required' => ['query'],
                ],
            ],
            [
                'name' => 'mission_list',
                'description' => 'Liste les missions du tableau (bugs, features, veille tech, PR).',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'status' => ['type' => 'string', 'enum' => ['open', 'in_progress', 'blocked', 'done', 'cancelled']],
                        'kind' => ['type' => 'string', 'enum' => ['bug', 'feature', 'tech_watch', 'github_pr', 'ops', 'other']],
                        'q' => ['type' => 'string', 'description' => 'Recherche texte'],
                        'limit' => ['type' => 'integer', 'default' => 20],
                    ],
                ],
            ],
            [
                'name' => 'mission_show',
                'description' => 'Détail d’une mission (assignee, statut, blocked_reason, metadata).',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'mission_uuid' => ['type' => 'string'],
                    ],
                    'required' => ['mission_uuid'],
                ],
            ],
            [
                'name' => 'mission_create',
                'description' => 'Crée une mission sur le board. Assigne via assignee_agent_uuid ou assignee_type (devforge, debug, deployment…).',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'title' => ['type' => 'string'],
                        'description' => ['type' => 'string'],
                        'kind' => ['type' => 'string', 'enum' => ['bug', 'feature', 'tech_watch', 'github_pr', 'ops', 'other']],
                        'priority' => ['type' => 'string', 'enum' => ['low', 'normal', 'high', 'urgent']],
                        'resource_uuid' => ['type' => 'string'],
                        'dedupe_key' => ['type' => 'string', 'description' => 'Clé anti-doublon'],
                        'assignee_agent_uuid' => ['type' => 'string', 'description' => 'UUID agent assignee'],
                        'assignee_type' => [
                            'type' => 'string',
                            'description' => 'Type d’agent cible (ex: devforge, debug, deployment, github)',
                        ],
                    ],
                    'required' => ['title'],
                ],
            ],
            [
                'name' => 'mission_claim',
                'description' => 'Prend en charge une mission open (passe en in_progress et t’assigne).',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'mission_uuid' => ['type' => 'string'],
                    ],
                    'required' => ['mission_uuid'],
                ],
            ],
            [
                'name' => 'mission_update',
                'description' => 'Met à jour une mission (statut, priorité, assignee, blocked_reason…).',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'mission_uuid' => ['type' => 'string'],
                        'title' => ['type' => 'string'],
                        'description' => ['type' => 'string'],
                        'status' => ['type' => 'string', 'enum' => ['open', 'in_progress', 'blocked', 'done', 'cancelled']],
                        'priority' => ['type' => 'string', 'enum' => ['low', 'normal', 'high', 'urgent']],
                        'kind' => ['type' => 'string', 'enum' => ['bug', 'feature', 'tech_watch', 'github_pr', 'ops', 'other']],
                        'assignee_agent_uuid' => ['type' => 'string'],
                        'assignee_type' => ['type' => 'string'],
                        'blocked_reason' => ['type' => 'string', 'description' => 'Raison si status=blocked (ex: secret manquant)'],
                    ],
                    'required' => ['mission_uuid'],
                ],
            ],
            [
                'name' => 'request_user_input',
                'description' => 'Demande une clé, un token ou une confirmation à l’utilisateur. Met le run en pause (waiting_for_input) et bloque la mission associée.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'kind' => [
                            'type' => 'string',
                            'enum' => ['secret', 'token', 'confirm', 'text'],
                            'description' => 'Type de demande (défaut: secret)',
                        ],
                        'key' => ['type' => 'string', 'description' => 'Nom de variable (ex: NPM_TOKEN, OPENAI_API_KEY)'],
                        'message' => ['type' => 'string', 'description' => 'Message clair pour l’utilisateur'],
                        'resource_uuid' => ['type' => 'string', 'description' => 'UUID application pour injecter l’env'],
                        'mission_uuid' => ['type' => 'string', 'description' => 'Mission à bloquer en attendant la réponse'],
                    ],
                    'required' => ['key', 'message'],
                ],
            ],
            [
                'name' => 'run_application_tests',
                'description' => 'Détecte et exécute les tests d’une application (composer test / pest / npm test / pnpm test) via SSH sur le serveur.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'application_uuid' => ['type' => 'string'],
                        'server_uuid' => ['type' => 'string', 'description' => 'Serveur (défaut: destination de l’app)'],
                        'command' => ['type' => 'string', 'description' => 'Commande de test forcée (optionnel)'],
                        'timeout' => ['type' => 'integer', 'description' => 'Timeout secondes (défaut 180, max 300)'],
                    ],
                    'required' => ['application_uuid'],
                ],
            ],
        ];

        if (app(AgentCodeSandbox::class)->enabled()) {
            $tools[] = [
                'name' => 'execute_code',
                'description' => 'Exécute un snippet php/node/python dans un conteneur Docker isolé (sans réseau, sans docker.sock). Distinct de exec_command SSH et run_application_tests.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'language' => [
                            'type' => 'string',
                            'enum' => ['php', 'node', 'python'],
                            'description' => 'Runtime sandbox',
                        ],
                        'code' => [
                            'type' => 'string',
                            'description' => 'Source complète à exécuter (stdout pour le résultat)',
                        ],
                        'timeout' => [
                            'type' => 'integer',
                            'description' => 'Timeout secondes (défaut 15, max 60)',
                        ],
                    ],
                    'required' => ['language', 'code'],
                ],
            ];
        }

        if (app(AgentMcpClientRegistry::class)->enabled()) {
            $tools[] = [
                'name' => 'mcp_list_servers',
                'description' => 'Liste les serveurs MCP distants configurés pour cet agent (client P6).',
                'parameters' => ['type' => 'object', 'properties' => (object) []],
            ];
            $tools[] = [
                'name' => 'mcp_list_remote_tools',
                'description' => 'Liste (et rafraîchit) les outils exposés par les serveurs MCP distants.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'refresh' => [
                            'type' => 'boolean',
                            'description' => 'Si true, invalide le cache et re-interroge les serveurs.',
                        ],
                    ],
                ],
            ];
        }

        return $tools;
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
                'name' => 'check_docker_image_update',
                'description' => 'Vérifie si une image Docker (app dockerimage ou image=repo:tag) est à jour vs Docker Hub/Quay. Compare tags semver et digests ; inspecte le conteneur running si possible.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'application_uuid' => [
                            'type' => 'string',
                            'description' => 'UUID d\'une application (idéal build_pack=dockerimage).',
                        ],
                        'image' => [
                            'type' => 'string',
                            'description' => 'Image explicite repo:tag (ex: nginx:1.25, library/redis:7). Prioritaire sur l\'app.',
                        ],
                        'inspect_running' => [
                            'type' => 'boolean',
                            'description' => 'Inspecter le conteneur running pour comparer les digests (défaut: true si application_uuid).',
                        ],
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
                'description' => 'Lit un fichier de configuration de déploiement sur le serveur (docker-compose, .env Coolify). Pour le code source de l\'app, préfère read_application_source.',
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
                'description' => 'Liste un répertoire de déploiement Coolify sur le serveur (applications/{uuid}/). Pour le code source, préfère list_application_source.',
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
            [
                'name' => 'get_application_source_info',
                'description' => 'Retourne dépôt Git, branche déployée, base_directory et disponibilité du code source d\'une application Coolify.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'application_uuid' => [
                            'type' => 'string',
                            'description' => 'UUID de l\'application. Omis si contexte déploiement ou agent lié à l\'app.',
                        ],
                    ],
                ],
            ],
            [
                'name' => 'list_application_source',
                'description' => 'Liste le code source Git d\'une application (branche déployée, base_directory). Préféré à list_github_dir.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'application_uuid' => [
                            'type' => 'string',
                            'description' => 'UUID de l\'application. Omis si contexte déploiement ou agent lié à l\'app.',
                        ],
                        'path' => [
                            'type' => 'string',
                            'description' => 'Chemin relatif dans le repo (défaut: base_directory de l\'app)',
                        ],
                    ],
                ],
            ],
            [
                'name' => 'read_application_source',
                'description' => 'Lit un fichier du code source Git d\'une application (branche déployée). Préféré à read_github_file.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'application_uuid' => [
                            'type' => 'string',
                            'description' => 'UUID de l\'application. Omis si contexte déploiement ou agent lié à l\'app.',
                        ],
                        'path' => [
                            'type' => 'string',
                            'description' => 'Chemin relatif du fichier dans le repo',
                        ],
                    ],
                    'required' => ['path'],
                ],
            ],
            [
                'name' => 'list_application_env_vars',
                'description' => 'Liste les variables d\'environnement Coolify d\'une application (pas le .env Git).',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'application_uuid' => [
                            'type' => 'string',
                            'description' => 'UUID de l\'application. Omis si contexte déploiement ou agent lié à l\'app.',
                        ],
                    ],
                ],
            ],
            [
                'name' => 'upsert_application_env_var',
                'description' => 'Crée ou met à jour une variable Coolify (build/runtime). Préférer ceci à write_application_source pour .env / PUPPETEER_SKIP_DOWNLOAD / secrets de build.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'application_uuid' => [
                            'type' => 'string',
                            'description' => 'UUID de l\'application. Omis si contexte déploiement ou agent lié à l\'app.',
                        ],
                        'key' => [
                            'type' => 'string',
                            'description' => 'Nom de la variable (ex: PUPPETEER_SKIP_DOWNLOAD)',
                        ],
                        'value' => [
                            'type' => 'string',
                            'description' => 'Valeur',
                        ],
                        'is_buildtime' => [
                            'type' => 'boolean',
                            'description' => 'Disponible au build (défaut: true)',
                        ],
                        'is_runtime' => [
                            'type' => 'boolean',
                            'description' => 'Disponible au runtime (défaut: true)',
                        ],
                        'is_literal' => [
                            'type' => 'boolean',
                            'description' => 'Valeur littérale non interpolée (défaut: true)',
                        ],
                    ],
                    'required' => ['key', 'value'],
                ],
            ],
            [
                'name' => 'update_application_git_branch',
                'description' => 'Change la branche Git déployée par Coolify (Application.git_branch), puis redéploie par défaut. À utiliser quand le clone échoue (branche introuvable / Remote branch not found).',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'application_uuid' => [
                            'type' => 'string',
                            'description' => 'UUID de l\'application. Omis si contexte déploiement ou agent lié à l\'app.',
                        ],
                        'git_branch' => [
                            'type' => 'string',
                            'description' => 'Nom exact de la branche Git à déployer (ex: feat/my-feature)',
                        ],
                        'redeploy' => [
                            'type' => 'boolean',
                            'description' => 'Queue un redéploiement après la mise à jour (défaut: true)',
                        ],
                        'reason' => [
                            'type' => 'string',
                            'description' => 'Raison courte pour les logs',
                        ],
                    ],
                    'required' => ['git_branch'],
                ],
            ],
            [
                'name' => 'get_application_runtime_settings',
                'description' => 'Lit la config build/runtime Coolify (build_pack, install/build/start_command, ports_exposes, base/publish_directory, healthcheck). Utile avant de corriger un échec de build.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'application_uuid' => [
                            'type' => 'string',
                            'description' => 'UUID de l\'application. Omis si contexte déploiement ou agent lié à l\'app.',
                        ],
                    ],
                ],
            ],
            [
                'name' => 'update_application_runtime_settings',
                'description' => 'Met à jour la config build Coolify (commandes, ports, répertoires, build_pack, static). À préférer à un commit Git quand l’échec vient de la config Coolify. Redéploie par défaut.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'application_uuid' => [
                            'type' => 'string',
                            'description' => 'UUID de l\'application. Omis si contexte déploiement ou agent lié à l\'app.',
                        ],
                        'build_pack' => [
                            'type' => 'string',
                            'enum' => ['nixpacks', 'railpack', 'static', 'dockerfile', 'dockercompose', 'dockerimage'],
                        ],
                        'is_static' => ['type' => 'boolean'],
                        'install_command' => ['type' => 'string', 'description' => 'Commande install (nullable via chaîne vide)'],
                        'build_command' => ['type' => 'string'],
                        'start_command' => ['type' => 'string'],
                        'ports_exposes' => ['type' => 'string', 'description' => 'Ports exposés, ex: 3000 ou 80,443'],
                        'base_directory' => ['type' => 'string'],
                        'publish_directory' => ['type' => 'string'],
                        'health_check_enabled' => ['type' => 'boolean'],
                        'health_check_path' => ['type' => 'string'],
                        'health_check_port' => ['type' => 'string'],
                        'redeploy' => [
                            'type' => 'boolean',
                            'description' => 'Queue un redéploiement après la mise à jour (défaut: true)',
                        ],
                        'reason' => [
                            'type' => 'string',
                            'description' => 'Raison courte pour les logs',
                        ],
                    ],
                ],
            ],
            [
                'name' => 'sync_application_proxy_labels',
                'description' => 'Régénère les labels Traefik/Caddy (custom_labels) depuis ports_exposes. À utiliser sur HTTP 502 / Bad Gateway / Host Error quand le conteneur est healthy mais le proxy pointe encore vers le mauvais port (souvent 80 vs 4321 Astro). Redéploie par défaut.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'application_uuid' => [
                            'type' => 'string',
                            'description' => 'UUID de l\'application. Omis si contexte déploiement ou agent lié à l\'app.',
                        ],
                        'redeploy' => [
                            'type' => 'boolean',
                            'description' => 'Queue un redéploiement après sync (défaut: true)',
                        ],
                        'reason' => [
                            'type' => 'string',
                            'description' => 'Raison courte pour les logs',
                        ],
                    ],
                ],
            ],
            [
                'name' => 'fix_application_host_permissions',
                'description' => 'Corrige de façon autonome les Permission denied sur le répertoire Coolify de l’application (chown/chmod ciblé via SSH), puis redéploie par défaut. À utiliser dès que tee/.env/docker-compose.yaml échoue en écriture sur le host.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'application_uuid' => [
                            'type' => 'string',
                            'description' => 'UUID de l\'application. Omis si contexte déploiement ou agent lié à l\'app.',
                        ],
                        'path' => [
                            'type' => 'string',
                            'description' => 'Chemin host du répertoire applications/<uuid> (extrait des logs si omis). Fichier (.env) accepté → répertoire parent.',
                        ],
                        'redeploy' => [
                            'type' => 'boolean',
                            'description' => 'Queue un redéploiement après correction (défaut: true)',
                        ],
                        'reason' => [
                            'type' => 'string',
                            'description' => 'Raison courte pour les logs',
                        ],
                    ],
                ],
            ],
            [
                'name' => 'fix_coolify_base_config_path',
                'description' => 'Recharge BASE_CONFIG_PATH dans Coolify (php artisan config:clear + horizon:terminate via docker exec), puis redéploie. À utiliser si mkdir des dossiers applications Coolify échoue avec Read-only file system (chemin hôte incorrect ou config cache) — sans présumer le chemin NAS.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'application_uuid' => [
                            'type' => 'string',
                            'description' => 'UUID de l\'application. Omis si contexte déploiement ou agent lié à l\'app.',
                        ],
                        'container' => [
                            'type' => 'string',
                            'description' => 'Nom du conteneur Coolify (défaut: coolify)',
                        ],
                        'redeploy' => [
                            'type' => 'boolean',
                            'description' => 'Queue un redéploiement après correction (défaut: true)',
                        ],
                        'reason' => [
                            'type' => 'string',
                            'description' => 'Raison courte pour les logs',
                        ],
                    ],
                ],
            ],
            [
                'name' => 'write_application_source',
                'description' => 'Modifie un fichier Git (commit direct sur la branche déployée ou PR). mode=direct redéploie par défaut ; mode=pull_request ouvre une PR sans redeploy. Ne pas utiliser pour créer un .env — utiliser upsert_application_env_var.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'application_uuid' => [
                            'type' => 'string',
                            'description' => 'UUID de l\'application. Omis si contexte déploiement ou agent lié à l\'app.',
                        ],
                        'path' => [
                            'type' => 'string',
                            'description' => 'Chemin relatif du fichier dans le repo',
                        ],
                        'content' => [
                            'type' => 'string',
                            'description' => 'Nouveau contenu complet du fichier (max 32 Ko)',
                        ],
                        'commit_message' => [
                            'type' => 'string',
                            'description' => 'Message de commit Git',
                        ],
                        'sha' => [
                            'type' => 'string',
                            'description' => 'SHA du blob actuel (depuis read_application_source) pour éviter les conflits',
                        ],
                        'mode' => [
                            'type' => 'string',
                            'enum' => ['direct', 'pull_request'],
                            'description' => 'direct = commit sur branche déployée ; pull_request = branche + PR',
                        ],
                        'redeploy' => [
                            'type' => 'boolean',
                            'description' => 'Redéployer après commit direct (défaut: true en mode direct)',
                        ],
                        'branch_name' => [
                            'type' => 'string',
                            'description' => 'Nom de branche pour pull_request (auto-généré si omis)',
                        ],
                        'pr_title' => [
                            'type' => 'string',
                            'description' => 'Titre de la PR (défaut: commit_message)',
                        ],
                        'pr_body' => [
                            'type' => 'string',
                            'description' => 'Description de la PR',
                        ],
                    ],
                    'required' => ['path', 'content', 'commit_message'],
                ],
            ],
            [
                'name' => 'get_application_preview',
                'description' => 'Récupère l’URL preview Coolify liée à une PR (après write_application_source mode=pull_request). Retourne fqdn + status.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'application_uuid' => ['type' => 'string'],
                        'pull_request_id' => [
                            'type' => 'integer',
                            'description' => 'Numéro de PR GitHub (sinon utilise la PR de la mission en cours)',
                        ],
                    ],
                ],
            ],
            [
                'name' => 'search_remote_files',
                'description' => 'Recherche des fichiers par nom (find) ou contenu (grep) sur un serveur distant.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'server_uuid' => ['type' => 'string', 'description' => 'UUID du serveur'],
                        'pattern' => ['type' => 'string', 'description' => 'Motif (glob ou texte)'],
                        'mode' => ['type' => 'string', 'enum' => ['name', 'content'], 'default' => 'name'],
                        'path' => ['type' => 'string', 'description' => 'Racine de recherche (défaut: /data/coolify)'],
                    ],
                    'required' => ['server_uuid', 'pattern'],
                ],
            ],
        ];

        if ($this->canDelegate()) {
            $tools[] = [
                'name' => 'delegate_task',
                'description' => 'Délègue une sous-tâche (ou plusieurs via tasks[]) à un agent enfant. Plusieurs tâches → parallèle via la queue.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'goal' => ['type' => 'string', 'description' => 'Objectif précis pour le sous-agent'],
                        'child_agent_uuid' => ['type' => 'string', 'description' => 'UUID du sous-agent (optionnel si un seul enfant existe)'],
                        'tasks' => [
                            'type' => 'array',
                            'description' => 'Batch parallèle : [{goal, child_agent_uuid?}, ...]',
                            'items' => [
                                'type' => 'object',
                                'properties' => [
                                    'goal' => ['type' => 'string'],
                                    'child_agent_uuid' => ['type' => 'string'],
                                ],
                                'required' => ['goal'],
                            ],
                        ],
                    ],
                ],
            ];
        }

        if ($this->canSpawnEphemeral()) {
            $tools[] = [
                'name' => 'spawn_task',
                'description' => 'Lance une sous-tâche leaf (async par défaut). Retourne run_uuid immédiatement ; appeler yield_wait pour attendre. wait=true pour sync. Batch via tasks[]. auto_roles=true ou roles[] pour équipe dynamique. orchestration=collab pour débat multi-rôles borné (interdit sur deploy/CI).',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'goal' => ['type' => 'string', 'description' => 'Objectif précis et autonome pour la sous-tâche (ou tâche parent si auto_roles/collab)'],
                        'difficulty' => [
                            'type' => 'string',
                            'enum' => ['auto', 'light', 'standard', 'heavy'],
                            'description' => 'Difficulté : light (inspection), standard (diagnostic), heavy (analyse profonde). Défaut auto.',
                        ],
                        'wait' => [
                            'type' => 'boolean',
                            'description' => 'Si true, bloque jusqu’à fin du leaf (sync). Défaut false (async).',
                        ],
                        'leaf_profile' => [
                            'type' => 'string',
                            'enum' => [
                                'diagnose', 'fix', 'redeploy', 'fix-ci', 'implement', 'test', 'research',
                                'researcher', 'analyst', 'writer', 'reviewer', 'implementer', 'tester',
                            ],
                            'description' => 'Profil / rôle leaf (pipeline deploy ou rôles métier).',
                        ],
                        'orchestration' => [
                            'type' => 'string',
                            'enum' => ['pipeline', 'collab'],
                            'description' => 'pipeline = spawn/yield classique. collab = tours séquentiels multi-rôles (tech-watch/design).',
                        ],
                        'speaker_selection' => [
                            'type' => 'string',
                            'enum' => ['auto', 'round_robin'],
                            'description' => 'Collab seulement : auto (NEXT_SPEAKER) ou round_robin.',
                        ],
                        'auto_roles' => [
                            'type' => 'boolean',
                            'description' => 'Si true, propose 2–N rôles adaptés à goal et les spawn en parallèle (puis yield_wait).',
                        ],
                        'roles' => [
                            'type' => 'array',
                            'description' => 'Rôles explicites (ex. researcher, analyst, writer). Ignore l’inférence auto si fourni.',
                            'items' => [
                                'type' => 'string',
                                'enum' => [
                                    'researcher', 'analyst', 'writer', 'reviewer', 'implementer', 'tester',
                                    'diagnose', 'fix', 'redeploy', 'fix-ci', 'implement', 'test', 'research',
                                ],
                            ],
                        ],
                        'tasks' => [
                            'type' => 'array',
                            'description' => 'Batch parallèle async : [{goal, difficulty?, leaf_profile?, role_slug?, wait?}, ...]',
                            'items' => [
                                'type' => 'object',
                                'properties' => [
                                    'goal' => ['type' => 'string'],
                                    'difficulty' => ['type' => 'string', 'enum' => ['auto', 'light', 'standard', 'heavy']],
                                    'wait' => ['type' => 'boolean'],
                                    'leaf_profile' => [
                                        'type' => 'string',
                                        'enum' => [
                                            'diagnose', 'fix', 'redeploy', 'fix-ci', 'implement', 'test', 'research',
                                            'researcher', 'analyst', 'writer', 'reviewer', 'implementer', 'tester',
                                        ],
                                    ],
                                    'role_slug' => ['type' => 'string'],
                                ],
                                'required' => ['goal'],
                            ],
                        ],
                    ],
                ],
            ];
        }

        if ($this->canYieldWait()) {
            $tools[] = [
                'name' => 'yield_wait',
                'description' => 'Met le run parent en pause (waiting_for_subagents), dispatch les leafs async, et reprend automatiquement au handoff avec instruction de review.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => (object) [],
                ],
            ];
        }

        $tools[] = [
            'name' => 'propose_plan',
            'description' => 'Propose un plan d’actions structuré avant toute modification (mode plan-first). L’utilisateur doit approuver le plan dans le chat avant les outils mutateurs.',
            'parameters' => [
                'type' => 'object',
                'properties' => [
                    'title' => ['type' => 'string', 'description' => 'Titre court du plan'],
                    'summary' => ['type' => 'string', 'description' => 'Résumé de l’approche (1-3 phrases)'],
                    'steps' => [
                        'type' => 'array',
                        'description' => 'Étapes ordonnées à exécuter après approbation',
                        'items' => [
                            'type' => 'object',
                            'properties' => [
                                'action' => ['type' => 'string', 'description' => 'Description de l’étape'],
                                'tool' => ['type' => 'string', 'description' => 'Outil prévu (optionnel)'],
                                'risk' => ['type' => 'string', 'enum' => ['low', 'medium', 'high'], 'description' => 'Niveau de risque'],
                            ],
                            'required' => ['action'],
                        ],
                    ],
                ],
                'required' => ['title', 'summary', 'steps'],
            ],
        ];

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
                'description' => 'Liste les exécutions GitHub Actions récentes d\'un dépôt (filtrable status/conclusion/branche).',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'github_app_uuid' => ['type' => 'string'],
                        'owner' => ['type' => 'string'],
                        'repo' => ['type' => 'string'],
                        'branch' => ['type' => 'string', 'description' => 'Filtrer par branche (optionnel)'],
                        'status' => ['type' => 'string', 'description' => 'queued|in_progress|completed…'],
                        'conclusion' => ['type' => 'string', 'description' => 'success|failure|cancelled…'],
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
                'name' => 'list_github_workflows',
                'description' => 'Liste les workflows GitHub Actions définis dans un dépôt (.github/workflows).',
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
                'name' => 'list_github_workflow_jobs',
                'description' => 'Liste les jobs (et steps) d\'une exécution GitHub Actions.',
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
                'name' => 'get_github_workflow_job_logs',
                'description' => 'Lit les logs texte d\'un job GitHub Actions (fin du log si trop long).',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'github_app_uuid' => ['type' => 'string'],
                        'owner' => ['type' => 'string'],
                        'repo' => ['type' => 'string'],
                        'job_id' => ['type' => 'integer'],
                        'max_chars' => ['type' => 'integer', 'default' => 12000],
                    ],
                    'required' => ['github_app_uuid', 'owner', 'repo', 'job_id'],
                ],
            ],
            [
                'name' => 'rerun_github_workflow_run',
                'description' => 'Relance une exécution GitHub Actions (tous les jobs ou seulement les échecs).',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'github_app_uuid' => ['type' => 'string'],
                        'owner' => ['type' => 'string'],
                        'repo' => ['type' => 'string'],
                        'run_id' => ['type' => 'integer'],
                        'failed_only' => ['type' => 'boolean', 'default' => true],
                    ],
                    'required' => ['github_app_uuid', 'owner', 'repo', 'run_id'],
                ],
            ],
            [
                'name' => 'dispatch_github_workflow',
                'description' => 'Déclenche un workflow_dispatch (fichier .yml ou workflow_id + ref branche).',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'github_app_uuid' => ['type' => 'string'],
                        'owner' => ['type' => 'string'],
                        'repo' => ['type' => 'string'],
                        'workflow_id' => ['type' => 'string', 'description' => 'ID numérique ou nom de fichier ex. build.yml'],
                        'ref' => ['type' => 'string', 'description' => 'Branche ou tag'],
                        'inputs' => ['type' => 'object', 'description' => 'Inputs workflow_dispatch (optionnel)'],
                    ],
                    'required' => ['github_app_uuid', 'owner', 'repo', 'workflow_id', 'ref'],
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
            [
                'name' => 'create_github_branch',
                'description' => 'Crée une branche GitHub à partir d\'un SHA.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'github_app_uuid' => ['type' => 'string'],
                        'owner' => ['type' => 'string'],
                        'repo' => ['type' => 'string'],
                        'branch_name' => ['type' => 'string'],
                        'sha' => ['type' => 'string', 'description' => 'SHA de départ'],
                    ],
                    'required' => ['github_app_uuid', 'owner', 'repo', 'branch_name', 'sha'],
                ],
            ],
            [
                'name' => 'write_github_file',
                'description' => 'Crée ou met à jour un fichier via l\'API GitHub contents (commit).',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'github_app_uuid' => ['type' => 'string'],
                        'owner' => ['type' => 'string'],
                        'repo' => ['type' => 'string'],
                        'path' => ['type' => 'string'],
                        'content' => ['type' => 'string'],
                        'message' => ['type' => 'string', 'description' => 'Message de commit'],
                        'sha' => ['type' => 'string', 'description' => 'SHA du fichier existant (requis pour update)'],
                        'branch' => ['type' => 'string'],
                    ],
                    'required' => ['github_app_uuid', 'owner', 'repo', 'path', 'content', 'message'],
                ],
            ],
            [
                'name' => 'create_github_pull_request',
                'description' => 'Ouvre une Pull Request GitHub.',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'github_app_uuid' => ['type' => 'string'],
                        'owner' => ['type' => 'string'],
                        'repo' => ['type' => 'string'],
                        'title' => ['type' => 'string'],
                        'head' => ['type' => 'string', 'description' => 'Branche source'],
                        'base' => ['type' => 'string', 'description' => 'Branche cible'],
                        'body' => ['type' => 'string'],
                    ],
                    'required' => ['github_app_uuid', 'owner', 'repo', 'title', 'head', 'base'],
                ],
            ],
            [
                'name' => 'merge_github_pull_request',
                'description' => 'Merge une Pull Request (merge|squash|rebase).',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'github_app_uuid' => ['type' => 'string'],
                        'owner' => ['type' => 'string'],
                        'repo' => ['type' => 'string'],
                        'number' => ['type' => 'integer'],
                        'merge_method' => ['type' => 'string', 'enum' => ['merge', 'squash', 'rebase'], 'default' => 'squash'],
                        'commit_title' => ['type' => 'string'],
                    ],
                    'required' => ['github_app_uuid', 'owner', 'repo', 'number'],
                ],
            ],
            [
                'name' => 'close_github_pull_request',
                'description' => 'Ferme une Pull Request sans merge.',
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
                'name' => 'comment_github_pull_request',
                'description' => 'Commente une Pull Request (issue comment).',
                'parameters' => [
                    'type' => 'object',
                    'properties' => [
                        'github_app_uuid' => ['type' => 'string'],
                        'owner' => ['type' => 'string'],
                        'repo' => ['type' => 'string'],
                        'number' => ['type' => 'integer'],
                        'body' => ['type' => 'string'],
                    ],
                    'required' => ['github_app_uuid', 'owner', 'repo', 'number', 'body'],
                ],
            ],
        ];
    }

    private function canDelegate(): bool
    {
        if ($this->delegator === null || $this->agent === null) {
            return false;
        }

        return AgentSubagentCapabilities::canSpawn(
            $this->runContext,
            $this->agent->parent_agent_id !== null,
        );
    }

    private function canSpawnEphemeral(): bool
    {
        return $this->canDelegate();
    }

    private function canYieldWait(): bool
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

        $chatMode = AgentChatMode::parse($this->runContext['chat_mode'] ?? 'build');
        if (! AgentChatMode::isToolAllowed($toolName, $chatMode)) {
            return [
                'error' => "Outil « {$toolName} » interdit en mode ".AgentChatMode::label($chatMode).'. Passez en Build ou Debug.',
                'denied' => true,
                'chat_mode' => $chatMode,
            ];
        }

        $role = AgentSubagentCapabilities::resolveRole($this->runContext);
        if ($role === AgentSubagentCapabilities::ROLE_LEAF
            && AgentSubagentCapabilities::isOrchestrationTool($toolName)) {
            return [
                'error' => 'Outil d’orchestration interdit pour un leaf.',
                'denied' => true,
                'subagent_role' => $role,
            ];
        }

        $leafAllowed = AgentSubagentCapabilities::leafAllowedTools($this->runContext);
        if ($leafAllowed !== null && ! in_array($toolName, $leafAllowed, true)) {
            return [
                'error' => "Outil « {$toolName} » hors profil leaf.",
                'denied' => true,
                'leaf_profile' => $this->runContext['leaf_profile'] ?? null,
            ];
        }

        if ($role === AgentSubagentCapabilities::ROLE_LEAF
            && (str_starts_with($toolName, 'mcp__') || in_array($toolName, ['mcp_list_servers', 'mcp_list_remote_tools'], true))) {
            return [
                'error' => 'Outils MCP distants interdits pour un leaf.',
                'denied' => true,
            ];
        }

        $permissionResult = $this->checkPermission($toolName, $arguments);
        if ($permissionResult !== null) {
            return $this->enrichSourceWriteApproval($toolName, $arguments, $permissionResult);
        }

        $previewGate = $this->checkSourceWritePreviewGate($toolName, $arguments);
        if ($previewGate !== null) {
            return $previewGate;
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
            'request_api_key' => $this->requestApiKey(
                (string) ($arguments['key_name'] ?? ''),
                (string) ($arguments['reason'] ?? '')
            ),
            'memory_read' => $this->memoryRead($arguments),
            'memory_write' => $this->memoryWrite($arguments),
            'todo_read' => $this->todoRead(),
            'todo_write' => $this->todoWrite($arguments),
            'web_search' => app(AgentWebSearchService::class)->search(
                (string) ($arguments['query'] ?? ''),
                (int) ($arguments['limit'] ?? 5),
            ),
            'mission_list' => $this->missionList($arguments),
            'mission_show' => $this->missionShow($arguments),
            'mission_create' => $this->missionCreate($arguments),
            'mission_claim' => $this->missionClaim($arguments),
            'mission_update' => $this->missionUpdate($arguments),
            'request_user_input' => $this->requestUserInput($arguments),
            'run_application_tests' => $this->runApplicationTests($arguments),
            'execute_code' => $this->executeCode($arguments),
            'mcp_list_servers' => $this->mcpListServers(),
            'mcp_list_remote_tools' => $this->mcpListRemoteTools($arguments),
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
                isset($arguments['status']) ? (string) $arguments['status'] : null,
                isset($arguments['conclusion']) ? (string) $arguments['conclusion'] : null,
            ),
            'get_github_workflow_run' => $this->githubTools->getWorkflowRun(
                (string) ($arguments['github_app_uuid'] ?? ''),
                (string) ($arguments['owner'] ?? ''),
                (string) ($arguments['repo'] ?? ''),
                (int) ($arguments['run_id'] ?? 0),
            ),
            'list_github_workflows' => $this->githubTools->listWorkflows(
                (string) ($arguments['github_app_uuid'] ?? ''),
                (string) ($arguments['owner'] ?? ''),
                (string) ($arguments['repo'] ?? ''),
            ),
            'list_github_workflow_jobs' => $this->githubTools->listWorkflowJobs(
                (string) ($arguments['github_app_uuid'] ?? ''),
                (string) ($arguments['owner'] ?? ''),
                (string) ($arguments['repo'] ?? ''),
                (int) ($arguments['run_id'] ?? 0),
            ),
            'get_github_workflow_job_logs' => $this->githubTools->getWorkflowJobLogs(
                (string) ($arguments['github_app_uuid'] ?? ''),
                (string) ($arguments['owner'] ?? ''),
                (string) ($arguments['repo'] ?? ''),
                (int) ($arguments['job_id'] ?? 0),
                (int) ($arguments['max_chars'] ?? 12000),
            ),
            'rerun_github_workflow_run' => $this->githubTools->rerunWorkflowRun(
                (string) ($arguments['github_app_uuid'] ?? ''),
                (string) ($arguments['owner'] ?? ''),
                (string) ($arguments['repo'] ?? ''),
                (int) ($arguments['run_id'] ?? 0),
                (bool) ($arguments['failed_only'] ?? true),
            ),
            'dispatch_github_workflow' => $this->githubTools->dispatchWorkflow(
                (string) ($arguments['github_app_uuid'] ?? ''),
                (string) ($arguments['owner'] ?? ''),
                (string) ($arguments['repo'] ?? ''),
                (string) ($arguments['workflow_id'] ?? ''),
                (string) ($arguments['ref'] ?? ''),
                is_array($arguments['inputs'] ?? null) ? $arguments['inputs'] : [],
            ),
            'list_github_commits' => $this->githubTools->listCommits(
                (string) ($arguments['github_app_uuid'] ?? ''),
                (string) ($arguments['owner'] ?? ''),
                (string) ($arguments['repo'] ?? ''),
                isset($arguments['branch']) ? (string) $arguments['branch'] : null,
                (int) ($arguments['limit'] ?? 10),
            ),
            'create_github_branch' => $this->githubTools->createBranch(
                (string) ($arguments['github_app_uuid'] ?? ''),
                (string) ($arguments['owner'] ?? ''),
                (string) ($arguments['repo'] ?? ''),
                (string) ($arguments['branch_name'] ?? ''),
                (string) ($arguments['sha'] ?? ''),
            ),
            'write_github_file' => $this->githubTools->writeFile(
                (string) ($arguments['github_app_uuid'] ?? ''),
                (string) ($arguments['owner'] ?? ''),
                (string) ($arguments['repo'] ?? ''),
                (string) ($arguments['path'] ?? ''),
                (string) ($arguments['content'] ?? ''),
                (string) ($arguments['message'] ?? ''),
                isset($arguments['sha']) ? (string) $arguments['sha'] : null,
                isset($arguments['branch']) ? (string) $arguments['branch'] : null,
            ),
            'create_github_pull_request' => $this->githubTools->createPullRequest(
                (string) ($arguments['github_app_uuid'] ?? ''),
                (string) ($arguments['owner'] ?? ''),
                (string) ($arguments['repo'] ?? ''),
                (string) ($arguments['title'] ?? ''),
                (string) ($arguments['head'] ?? ''),
                (string) ($arguments['base'] ?? ''),
                (string) ($arguments['body'] ?? ''),
            ),
            'merge_github_pull_request' => $this->githubTools->mergePullRequest(
                (string) ($arguments['github_app_uuid'] ?? ''),
                (string) ($arguments['owner'] ?? ''),
                (string) ($arguments['repo'] ?? ''),
                (int) ($arguments['number'] ?? 0),
                (string) ($arguments['merge_method'] ?? 'squash'),
                isset($arguments['commit_title']) ? (string) $arguments['commit_title'] : null,
            ),
            'close_github_pull_request' => $this->githubTools->closePullRequest(
                (string) ($arguments['github_app_uuid'] ?? ''),
                (string) ($arguments['owner'] ?? ''),
                (string) ($arguments['repo'] ?? ''),
                (int) ($arguments['number'] ?? 0),
            ),
            'comment_github_pull_request' => $this->githubTools->commentPullRequest(
                (string) ($arguments['github_app_uuid'] ?? ''),
                (string) ($arguments['owner'] ?? ''),
                (string) ($arguments['repo'] ?? ''),
                (int) ($arguments['number'] ?? 0),
                (string) ($arguments['body'] ?? ''),
            ),
            'list_resources' => $this->listResources($arguments['type'] ?? 'all'),
            'get_resource_status' => $this->getResourceStatus(
                (string) ($arguments['uuid'] ?? ''),
                (string) ($arguments['type'] ?? ''),
            ),
            'get_deployment_logs' => $this->getDeploymentLogs(
                $arguments['application_uuid'] ?? null,
                (int) ($arguments['limit'] ?? 5),
                $arguments['deployment_uuid'] ?? null,
                (int) ($arguments['log_lines'] ?? 80),
            ),
            'check_docker_image_update' => $this->checkDockerImageUpdate($arguments),
            'control_resource' => $this->controlResource(
                (string) ($arguments['uuid'] ?? ''),
                (string) ($arguments['type'] ?? ''),
                (string) ($arguments['action'] ?? ''),
                (string) ($arguments['reason'] ?? ''),
            ),
            'get_server_metrics' => $this->getServerMetrics((string) ($arguments['server_uuid'] ?? '')),
            'send_notification' => $this->sendNotification((string) ($arguments['message'] ?? ''), $arguments['level'] ?? 'info'),
            'exec_command' => $this->execCommand(
                (string) ($arguments['server_uuid'] ?? ''),
                (string) ($arguments['command'] ?? ''),
                (int) ($arguments['timeout'] ?? 60),
            ),
            'read_remote_file' => $this->serverExecutor->readRemoteFile(
                (string) ($arguments['server_uuid'] ?? ''),
                (string) ($arguments['path'] ?? ''),
            ),
            'list_remote_dir' => $this->serverExecutor->listRemoteDir(
                (string) ($arguments['server_uuid'] ?? ''),
                $arguments['path'] ?? '.',
            ),
            'docker_logs' => $this->serverExecutor->dockerLogs(
                (string) ($arguments['server_uuid'] ?? ''),
                (string) ($arguments['container'] ?? ''),
                (int) ($arguments['lines'] ?? 100),
            ),
            'http_request' => $this->httpRequest(
                (string) ($arguments['url'] ?? ''),
                $arguments['method'] ?? 'GET',
                $arguments['body'] ?? null,
                is_array($arguments['headers'] ?? null) ? $arguments['headers'] : [],
            ),
            'write_remote_file' => $this->serverExecutor->writeRemoteFile(
                (string) ($arguments['server_uuid'] ?? ''),
                (string) ($arguments['path'] ?? ''),
                $arguments['content'] ?? '',
            ),
            'search_remote_files' => $this->searchRemoteFiles(
                (string) ($arguments['server_uuid'] ?? ''),
                (string) ($arguments['pattern'] ?? ''),
                $arguments['mode'] ?? 'name',
                $arguments['path'] ?? null,
            ),
            'get_application_source_info' => $this->getApplicationSourceInfo(
                isset($arguments['application_uuid']) ? (string) $arguments['application_uuid'] : null,
            ),
            'list_application_source' => $this->listApplicationSource(
                isset($arguments['application_uuid']) ? (string) $arguments['application_uuid'] : null,
                isset($arguments['path']) ? (string) $arguments['path'] : null,
            ),
            'read_application_source' => $this->readApplicationSource(
                isset($arguments['application_uuid']) ? (string) $arguments['application_uuid'] : null,
                (string) ($arguments['path'] ?? ''),
            ),
            'write_application_source' => $this->writeApplicationSource(
                isset($arguments['application_uuid']) ? (string) $arguments['application_uuid'] : null,
                (string) ($arguments['path'] ?? ''),
                (string) ($arguments['content'] ?? ''),
                (string) ($arguments['commit_message'] ?? ''),
                isset($arguments['sha']) ? (string) $arguments['sha'] : null,
                is_string($arguments['mode'] ?? null) ? (string) $arguments['mode'] : null,
                array_key_exists('redeploy', $arguments) ? (bool) $arguments['redeploy'] : null,
                isset($arguments['branch_name']) ? (string) $arguments['branch_name'] : null,
                isset($arguments['pr_title']) ? (string) $arguments['pr_title'] : null,
                isset($arguments['pr_body']) ? (string) $arguments['pr_body'] : null,
            ),
            'get_application_preview' => $this->getApplicationPreview($arguments),
            'list_application_env_vars' => $this->listApplicationEnvVars(
                isset($arguments['application_uuid']) ? (string) $arguments['application_uuid'] : null,
            ),
            'upsert_application_env_var' => $this->upsertApplicationEnvVar(
                isset($arguments['application_uuid']) ? (string) $arguments['application_uuid'] : null,
                (string) ($arguments['key'] ?? ''),
                (string) ($arguments['value'] ?? ''),
                array_key_exists('is_buildtime', $arguments) ? (bool) $arguments['is_buildtime'] : true,
                array_key_exists('is_runtime', $arguments) ? (bool) $arguments['is_runtime'] : true,
                array_key_exists('is_literal', $arguments) ? (bool) $arguments['is_literal'] : true,
            ),
            'update_application_git_branch' => $this->updateApplicationGitBranch(
                isset($arguments['application_uuid']) ? (string) $arguments['application_uuid'] : null,
                (string) ($arguments['git_branch'] ?? ''),
                array_key_exists('redeploy', $arguments) ? (bool) $arguments['redeploy'] : true,
                (string) ($arguments['reason'] ?? ''),
            ),
            'get_application_runtime_settings' => $this->getApplicationRuntimeSettings(
                isset($arguments['application_uuid']) ? (string) $arguments['application_uuid'] : null,
            ),
            'update_application_runtime_settings' => $this->updateApplicationRuntimeSettings(
                isset($arguments['application_uuid']) ? (string) $arguments['application_uuid'] : null,
                is_array($arguments) ? $arguments : [],
            ),
            'sync_application_proxy_labels' => $this->syncApplicationProxyLabels(
                isset($arguments['application_uuid']) ? (string) $arguments['application_uuid'] : null,
                array_key_exists('redeploy', $arguments) ? (bool) $arguments['redeploy'] : true,
                (string) ($arguments['reason'] ?? ''),
            ),
            'fix_application_host_permissions' => $this->fixApplicationHostPermissions(
                isset($arguments['application_uuid']) ? (string) $arguments['application_uuid'] : null,
                isset($arguments['path']) ? (string) $arguments['path'] : null,
                array_key_exists('redeploy', $arguments) ? (bool) $arguments['redeploy'] : true,
                (string) ($arguments['reason'] ?? ''),
            ),
            'fix_coolify_base_config_path' => $this->fixCoolifyBaseConfigPath(
                isset($arguments['application_uuid']) ? (string) $arguments['application_uuid'] : null,
                array_key_exists('redeploy', $arguments) ? (bool) $arguments['redeploy'] : true,
                (string) ($arguments['reason'] ?? ''),
                isset($arguments['container']) ? (string) $arguments['container'] : null,
            ),
            'delegate_task' => $this->delegateTask($arguments),
            'spawn_task' => $this->spawnTask($arguments),
            'yield_wait' => $this->yieldWait($arguments),
            'propose_plan' => $this->proposePlan(is_array($arguments) ? $arguments : []),
            default => str_starts_with($toolName, 'mcp__')
                ? $this->executeMcpTool($toolName, $arguments)
                : $this->executeCustomTool($toolName, $arguments),
        };

        $this->run->appendLog('  ← Résultat: '.mb_substr(json_encode($result), 0, 200));

        app(AgentRunCorrectionSummarizer::class)->recordToolResult(
            $this->run,
            $toolName,
            is_array($arguments) ? $arguments : [],
            is_array($result) ? $result : [],
        );

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
        $sessionId = $this->run->session_id !== null ? (int) $this->run->session_id : null;
        $decision = $engine->decide($this->agent, $toolName, $arguments, $classification, $sessionId);
        $decision = $engine->resolveForTrigger($decision, (string) ($this->run->trigger ?? 'manual'), $toolName);
        $decision = $engine->resolveForAutoDeployFix(
            $decision,
            (string) ($this->run->trigger ?? 'manual'),
            is_array($this->runContext) ? $this->runContext : [],
        );

        if ($decision['decision'] === AgentPermissionEngine::DECISION_ALLOW) {
            return null;
        }

        if ($decision['decision'] === AgentPermissionEngine::DECISION_ASK) {
            $approvalKey = AgentToolApprovalGrant::fingerprint($toolName, $arguments);
            $sessionId = $this->run->session_id;

            if ($sessionId !== null && AgentToolApprovalGrant::consume((int) $sessionId, $approvalKey)) {
                $this->run->appendLog("  ✓ Approbation chat consommée [{$decision['rule_id']}] pour « {$toolName} »");

                return null;
            }

            if (AgentToolApprovalGrant::consumeForRun((int) $this->run->id, $approvalKey)) {
                $this->run->appendLog("  ✓ Approbation run consommée [{$decision['rule_id']}] pour « {$toolName} »");

                return null;
            }

            $message = "Approbation requise pour « {$toolName} » : {$decision['reason']} "
                .'Validez ou refusez dans l’UI, puis réessayez.';
            $this->run->appendLog("  ⏸ Approbation requise [{$decision['rule_id']}]: {$message}");

            return [
                'status' => AgentPermissionEngine::DECISION_ASK,
                'pending_approval' => true,
                'tool' => $toolName,
                'reason' => $decision['reason'],
                'rule_id' => $decision['rule_id'],
                'approval_key' => $approvalKey,
                'error' => $message,
            ];
        }

        $suffix = ! empty($decision['approval_unavailable']) ? ' (pas d’UI d’approbation)' : '';
        $this->run->appendLog("  ✗ Refusé{$suffix} [{$decision['rule_id']}]: {$decision['reason']}");

        return [
            'error' => $decision['reason'],
            'denied' => true,
            'rule_id' => $decision['rule_id'],
            'approval_unavailable' => (bool) ($decision['approval_unavailable'] ?? false),
        ];
    }

    /**
     * @param  array<string, mixed>  $arguments
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    private function enrichSourceWriteApproval(string $toolName, array $arguments, array $payload): array
    {
        if ($toolName !== 'write_application_source') {
            return $payload;
        }

        if (($payload['status'] ?? null) !== AgentPermissionEngine::DECISION_ASK) {
            return $payload;
        }

        $preview = $this->buildSourceWriteDiffPreview($arguments);
        if ($preview !== null) {
            $payload['diff_preview'] = $preview;
        }

        return $payload;
    }

    /**
     * @param  array<string, mixed>  $arguments
     * @return array<string, mixed>|null
     */
    private function checkSourceWritePreviewGate(string $toolName, array $arguments): ?array
    {
        if (! $this->shouldPreviewSourceWrite($toolName)) {
            return null;
        }

        $path = (string) ($arguments['path'] ?? '');
        if ($path === '' || $this->isEnvFilePath($path)) {
            return null;
        }

        $sessionId = $this->run->session_id;
        if ($sessionId === null) {
            return null;
        }

        $approvalKey = AgentToolApprovalGrant::fingerprint($toolName, $arguments);
        if (AgentToolApprovalGrant::consume((int) $sessionId, $approvalKey)) {
            $this->run->appendLog('  ✓ Approbation diff source consommée pour « write_application_source »');

            return null;
        }

        $preview = $this->buildSourceWriteDiffPreview($arguments);
        $message = 'Modification de fichier source — vérifiez le diff puis approuvez dans le chat.';

        $this->run->appendLog('  ⏸ Aperçu diff requis avant écriture Git.');

        return [
            'status' => AgentPermissionEngine::DECISION_ASK,
            'pending_approval' => true,
            'tool' => $toolName,
            'reason' => $message,
            'rule_id' => 'chat:source_write_preview',
            'approval_key' => $approvalKey,
            'diff_preview' => $preview,
            'error' => $message,
        ];
    }

    private function shouldPreviewSourceWrite(string $toolName): bool
    {
        if ($toolName !== 'write_application_source'
            || (string) ($this->run->trigger ?? '') !== 'chat'
            || ! config('devforge.agents_chat_source_write_preview', true)
            || $this->agent === null) {
            return false;
        }

        $engine = $this->permissionEngine ?? new AgentPermissionEngine;
        $mode = $engine->effectiveMode($this->agent);

        if ($mode === AgentPermissionEngine::MODE_TIERED) {
            return false;
        }

        if ($mode === AgentPermissionEngine::MODE_PLAN_FIRST) {
            $sessionId = $this->run->session_id !== null ? (int) $this->run->session_id : null;

            return $sessionId !== null && AgentToolApprovalGrant::hasPlanExecution($sessionId);
        }

        return true;
    }

    /**
     * @param  array<string, mixed>  $arguments
     * @return array<string, mixed>|null
     */
    private function buildSourceWriteDiffPreview(array $arguments): ?array
    {
        $path = (string) ($arguments['path'] ?? '');
        $content = (string) ($arguments['content'] ?? '');

        if ($path === '' || $this->isEnvFilePath($path)) {
            return null;
        }

        return app(ApplicationSourceWritePreview::class)->build(
            $this->team,
            $this->agent,
            isset($arguments['application_uuid']) ? (string) $arguments['application_uuid'] : null,
            $this->assignedResourceUuid,
            $path,
            $content,
        );
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
        if ($uuid === '' || $type === '') {
            return ['error' => 'Paramètres uuid et type requis pour get_resource_status.'];
        }

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
        return $this->repairActions->getDeploymentLogs($applicationUuid, $limit, $deploymentUuid, $logLines);
    }

    /** @return array<mixed> */
    private function controlResource(string $uuid, string $type, string $action, string $reason): array
    {
        return $this->repairActions->controlResource($uuid, $type, $action, $reason);
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

    /** @param array<string, mixed> $arguments
     * @return array<mixed> */
    private function delegateTask(array $arguments): array
    {
        if (! $this->canDelegate()) {
            return ['error' => 'Délégation non disponible pour cet agent.'];
        }

        if (isset($arguments['tasks']) && is_array($arguments['tasks']) && $arguments['tasks'] !== []) {
            return $this->delegator->delegateMany($this->agent, $this->run, $arguments['tasks']);
        }

        $goal = trim((string) ($arguments['goal'] ?? ''));
        if ($goal === '') {
            return ['error' => 'Objectif de délégation vide (goal ou tasks[]).'];
        }

        return $this->delegator->delegate(
            $this->agent,
            $this->run,
            $goal,
            isset($arguments['child_agent_uuid']) ? (string) $arguments['child_agent_uuid'] : null,
            ($arguments['wait'] ?? true) !== false,
        );
    }

    /** @param array<string, mixed> $arguments
     * @return array<mixed> */
    private function spawnTask(array $arguments): array
    {
        if (! $this->canSpawnEphemeral()) {
            return ['error' => 'Sous-tâches éphémères non disponibles pour cet agent.'];
        }

        $wait = ($arguments['wait'] ?? false) === true
            || ($arguments['wait'] ?? null) === 'true'
            || ($arguments['wait'] ?? null) === 1;

        $orchestration = strtolower(trim((string) ($arguments['orchestration'] ?? 'pipeline')));
        $autoRoles = ($arguments['auto_roles'] ?? false) === true
            || ($arguments['auto_roles'] ?? null) === 'true'
            || ($arguments['auto_roles'] ?? null) === 1;

        $explicitRoles = null;
        if (isset($arguments['roles']) && is_array($arguments['roles']) && $arguments['roles'] !== []) {
            $explicitRoles = array_values(array_filter(
                $arguments['roles'],
                fn ($role): bool => is_string($role) || is_numeric($role),
            ));
            $explicitRoles = array_map(fn ($role): string => (string) $role, $explicitRoles);
        }

        if ($orchestration === AgentCollabOrchestrator::MODE_COLLAB
            || ($arguments['collab'] ?? false) === true) {
            $goal = trim((string) ($arguments['goal'] ?? ''));
            if ($goal === '') {
                return ['error' => 'Objectif parent requis pour orchestration=collab (goal).'];
            }

            $selection = isset($arguments['speaker_selection'])
                ? (string) $arguments['speaker_selection']
                : (string) config('devforge.agents_collab_speaker_selection', 'auto');

            return app(AgentCollabOrchestrator::class)->run(
                $this->agent,
                $this->run,
                $goal,
                $explicitRoles,
                $selection,
                [
                    'event' => $this->runContext['event'] ?? $this->run->metadata['event'] ?? null,
                    'mission_kind' => $this->runContext['mission_kind'] ?? $this->run->metadata['mission_kind'] ?? null,
                ],
            );
        }

        if ($autoRoles || $explicitRoles !== null) {
            $goal = trim((string) ($arguments['goal'] ?? ''));
            if ($goal === '') {
                return ['error' => 'Objectif parent requis pour auto_roles / roles[] (goal).'];
            }

            return $this->delegator->spawnDynamicRoles(
                $this->agent,
                $this->run,
                $goal,
                $explicitRoles,
                [
                    'event' => $this->runContext['event'] ?? null,
                    'mission_kind' => $this->runContext['mission_kind'] ?? $this->run->metadata['mission_kind'] ?? null,
                ],
                $wait,
            );
        }

        if (isset($arguments['tasks']) && is_array($arguments['tasks']) && $arguments['tasks'] !== []) {
            return $this->delegator->spawnMany($this->agent, $this->run, $arguments['tasks']);
        }

        $goal = trim((string) ($arguments['goal'] ?? ''));
        if ($goal === '') {
            return ['error' => 'Objectif de sous-tâche vide (goal ou tasks[]).'];
        }

        $leafProfile = isset($arguments['leaf_profile']) ? (string) $arguments['leaf_profile'] : null;
        $roleMeta = [];
        if ($leafProfile !== null && $leafProfile !== '') {
            $roleMeta['role_slug'] = $leafProfile;
        }

        return $this->delegator->spawnEphemeral(
            $this->agent,
            $this->run,
            $goal,
            isset($arguments['difficulty']) ? (string) $arguments['difficulty'] : 'auto',
            $wait,
            $leafProfile,
            $roleMeta,
        );
    }

    /**
     * @param  array<string, mixed>  $arguments
     * @return array<string, mixed>
     */
    private function yieldWait(array $arguments): array
    {
        if (! $this->canYieldWait()) {
            return ['error' => 'yield_wait non disponible pour cet agent.'];
        }

        return $this->delegator->yieldWait($this->agent, $this->run, $this->runContext);
    }

    /**
     * @param  array<string, mixed>  $arguments
     * @return array<string, mixed>
     */
    private function missionList(array $arguments): array
    {
        $board = app(AgentMissionBoard::class);
        if (! $board->available()) {
            return ['error' => 'Missions indisponibles (migration manquante).', 'missions' => []];
        }

        $mineOnly = filter_var($arguments['mine_only'] ?? false, FILTER_VALIDATE_BOOLEAN);
        $rows = $board->list($this->agent->team, [
            'status' => $arguments['status'] ?? null,
            'kind' => $arguments['kind'] ?? null,
            'q' => $arguments['q'] ?? null,
            'agent_id' => $mineOnly ? $this->agent->id : null,
        ], (int) ($arguments['limit'] ?? 20));

        return [
            'count' => $rows->count(),
            'missions' => $rows->map(fn ($m) => $this->presentMissionRow($m))->values()->all(),
        ];
    }

    /**
     * @param  array<string, mixed>  $arguments
     * @return array<string, mixed>
     */
    private function missionShow(array $arguments): array
    {
        $uuid = trim((string) ($arguments['mission_uuid'] ?? ''));
        if ($uuid === '') {
            return ['error' => 'mission_uuid requis'];
        }

        $board = app(AgentMissionBoard::class);
        $result = $board->show($this->agent->team, $uuid);

        if (is_array($result) && isset($result['error'])) {
            return $result;
        }

        return [
            'mission' => $this->presentMissionRow($result, detailed: true),
        ];
    }

    /**
     * @param  array<string, mixed>  $arguments
     * @return array<string, mixed>
     */
    private function missionCreate(array $arguments): array
    {
        $board = app(AgentMissionBoard::class);
        $payload = [
            'title' => $arguments['title'] ?? '',
            'description' => $arguments['description'] ?? null,
            'kind' => $arguments['kind'] ?? 'other',
            'priority' => $arguments['priority'] ?? 'normal',
            'resource_uuid' => $arguments['resource_uuid'] ?? $this->agent->resource_uuid,
            'dedupe_key' => $arguments['dedupe_key'] ?? null,
            'source' => 'agent',
        ];

        if (! empty($arguments['assignee_agent_uuid'])) {
            $payload['assignee_agent_uuid'] = (string) $arguments['assignee_agent_uuid'];
        } elseif (! empty($arguments['assignee_type'])) {
            $payload['assignee_type'] = (string) $arguments['assignee_type'];
        } else {
            // VT propose → implementer ; sinon défaut par kind (pas auto-assignation au créateur).
            $payload['assignee_type'] = $board->defaultAssigneeTypeForKind((string) ($payload['kind'] ?? 'other'));
        }

        $result = $board->create($this->agent->team, $payload, $this->agent);

        if (is_array($result) && isset($result['error'])) {
            return $result;
        }

        return [
            'created' => true,
            'uuid' => $result->uuid,
            'title' => $result->title,
            'status' => $result->status,
            'kind' => $result->kind,
            'assignee_agent_id' => $result->assignee_agent_id,
            'assignee_type' => is_array($result->metadata) ? ($result->metadata['assignee_type'] ?? null) : null,
        ];
    }

    /**
     * @param  array<string, mixed>  $arguments
     * @return array<string, mixed>
     */
    private function missionClaim(array $arguments): array
    {
        $uuid = trim((string) ($arguments['mission_uuid'] ?? ''));
        if ($uuid === '') {
            return ['error' => 'mission_uuid requis'];
        }

        $board = app(AgentMissionBoard::class);
        $result = $board->claim($this->agent->team, $uuid, $this->agent);

        if (is_array($result) && isset($result['error'])) {
            return $result;
        }

        return [
            'claimed' => true,
            'mission' => $this->presentMissionRow($result, detailed: true),
        ];
    }

    /**
     * @param  array<string, mixed>  $arguments
     * @return array<string, mixed>
     */
    private function missionUpdate(array $arguments): array
    {
        $uuid = trim((string) ($arguments['mission_uuid'] ?? ''));
        if ($uuid === '') {
            return ['error' => 'mission_uuid requis'];
        }

        $board = app(AgentMissionBoard::class);
        $result = $board->update($this->agent->team, $uuid, $arguments);

        if (is_array($result) && isset($result['error'])) {
            return $result;
        }

        return [
            'updated' => true,
            'uuid' => $result->uuid,
            'title' => $result->title,
            'status' => $result->status,
            'kind' => $result->kind,
            'priority' => $result->priority,
            'assignee_agent_id' => $result->assignee_agent_id,
        ];
    }

    /**
     * @param  array<string, mixed>  $arguments
     * @return array<string, mixed>
     */
    private function requestUserInput(array $arguments): array
    {
        $key = strtoupper(trim((string) ($arguments['key'] ?? $arguments['key_name'] ?? '')));
        $message = trim((string) ($arguments['message'] ?? $arguments['reason'] ?? ''));
        $kind = strtolower(trim((string) ($arguments['kind'] ?? 'secret')));
        if (! in_array($kind, ['secret', 'token', 'confirm', 'text'], true)) {
            $kind = 'secret';
        }

        if ($key === '' || $message === '') {
            return ['error' => 'Paramètres key et message requis pour request_user_input.'];
        }

        $resourceUuid = isset($arguments['resource_uuid'])
            ? trim((string) $arguments['resource_uuid'])
            : (is_string($this->agent->resource_uuid ?? null) ? $this->agent->resource_uuid : null);
        $missionUuid = isset($arguments['mission_uuid'])
            ? trim((string) $arguments['mission_uuid'])
            : (is_string($this->run->metadata['mission_uuid'] ?? null) ? $this->run->metadata['mission_uuid'] : null);

        $payload = [
            'team_id' => $this->team->id,
            'agent_id' => $this->agent->id,
            'run_id' => $this->run->id,
            'key_name' => mb_substr($key, 0, 190),
            'reason' => mb_substr($message, 0, 2000),
            'status' => 'pending',
        ];

        if (\Illuminate\Support\Facades\Schema::hasColumn('ai_agent_key_requests', 'kind')) {
            $payload['kind'] = $kind;
        }
        if (\Illuminate\Support\Facades\Schema::hasColumn('ai_agent_key_requests', 'resource_uuid')
            && $resourceUuid !== null && $resourceUuid !== '') {
            $payload['resource_uuid'] = mb_substr($resourceUuid, 0, 64);
        }
        if (\Illuminate\Support\Facades\Schema::hasColumn('ai_agent_key_requests', 'mission_uuid')
            && $missionUuid !== null && $missionUuid !== '') {
            $payload['mission_uuid'] = mb_substr($missionUuid, 0, 64);
        }

        $request = AiAgentKeyRequest::create($payload);

        if ($missionUuid !== null && $missionUuid !== '') {
            app(AgentMissionBoard::class)->update($this->agent->team, $missionUuid, [
                'status' => 'blocked',
                'blocked_reason' => "En attente utilisateur ({$kind}): {$key} — {$message}",
            ]);
        }

        $this->run->mergeMetadata([
            'pending_user_input' => [
                'request_uuid' => $request->uuid,
                'key' => $key,
                'kind' => $kind,
                'mission_uuid' => $missionUuid,
            ],
        ]);
        $this->run->appendLog("Demande utilisateur ({$kind}/{$key}) — run en pause.");

        return [
            'status' => 'waiting_for_input',
            'message' => "Demande « {$key} » soumise à l'utilisateur. Le run se met en pause jusqu'à réponse.",
            'request_uuid' => $request->uuid,
            'kind' => $kind,
            'key' => $key,
        ];
    }

    /**
     * @param  array<string, mixed>  $arguments
     * @return array<string, mixed>
     */
    private function executeCode(array $arguments): array
    {
        $sandbox = app(AgentCodeSandbox::class);
        $language = (string) ($arguments['language'] ?? '');
        $code = (string) ($arguments['code'] ?? '');
        $timeout = isset($arguments['timeout']) ? (int) $arguments['timeout'] : null;

        $result = $sandbox->execute($language, $code, $timeout);

        if (isset($result['error'])) {
            $this->run->appendLog('  ✗ execute_code: '.mb_substr((string) $result['error'], 0, 200));

            return $result;
        }

        $ok = ($result['ok'] ?? false) === true;
        $this->run->appendLog(
            ($ok ? '  ✓' : '  ✗').' execute_code '.$language
            .' exit='.(string) ($result['exit_code'] ?? '?'),
        );

        return $result;
    }

    /**
     * @return array<string, mixed>
     */
    private function mcpListServers(): array
    {
        $registry = app(AgentMcpClientRegistry::class);
        if (! $registry->enabled()) {
            return ['error' => 'Client MCP désactivé (Paramètres → Avancé → Agents).'];
        }

        $servers = $registry->listServers($this->agent);

        return [
            'ok' => true,
            'servers' => $servers,
            'count' => count($servers),
            'hint' => $servers === []
                ? 'Aucun serveur — ajoute-en dans Paramètres → Avancé → Agents (JSON) ou metadata.mcp_servers.'
                : 'Les outils distants apparaissent comme mcp__{server}__{tool}.',
        ];
    }

    /**
     * @param  array<string, mixed>  $arguments
     * @return array<string, mixed>
     */
    private function mcpListRemoteTools(array $arguments): array
    {
        $registry = app(AgentMcpClientRegistry::class);
        if (! $registry->enabled()) {
            return ['error' => 'Client MCP désactivé (Paramètres → Avancé → Agents).'];
        }

        if (($arguments['refresh'] ?? false) === true) {
            $registry->refresh($this->agent);
        }

        $defs = $registry->toolDefinitions($this->agent);

        return [
            'ok' => true,
            'tools' => array_map(static fn (array $tool): array => [
                'name' => $tool['name'],
                'description' => $tool['description'],
                'mcp_server' => $tool['mcp_server'],
                'mcp_tool' => $tool['mcp_tool'],
            ], $defs),
            'count' => count($defs),
        ];
    }

    /**
     * @param  array<string, mixed>  $arguments
     * @return array<string, mixed>
     */
    private function executeMcpTool(string $toolName, array $arguments): array
    {
        $registry = app(AgentMcpClientRegistry::class);
        $result = $registry->callEncodedTool($toolName, $arguments, $this->agent);

        if (isset($result['error'])) {
            $this->run->appendLog('  ✗ '.$toolName.': '.mb_substr((string) $result['error'], 0, 200));
        } else {
            $this->run->appendLog('  ✓ '.$toolName);
        }

        return $result;
    }

    /**
     * @param  array<string, mixed>  $arguments
     * @return array<string, mixed>
     */
    private function runApplicationTests(array $arguments): array
    {
        $applicationUuid = trim((string) ($arguments['application_uuid'] ?? ''));
        $application = $this->resolveApplication($applicationUuid !== '' ? $applicationUuid : null);
        if (is_array($application)) {
            return $application;
        }

        $serverUuid = trim((string) ($arguments['server_uuid'] ?? ''));
        if ($serverUuid === '') {
            $destination = $application->destination;
            $server = $destination?->server ?? null;
            $serverUuid = is_object($server) && isset($server->uuid) ? (string) $server->uuid : '';
        }

        if ($serverUuid === '') {
            return ['error' => 'Impossible de résoudre le serveur de l’application.'];
        }

        $timeout = max(30, min(300, (int) ($arguments['timeout'] ?? 180)));
        $forced = trim((string) ($arguments['command'] ?? ''));

        $detectAndRun = $forced !== ''
            ? $forced
            : 'if [ -f composer.json ] && grep -qE "pestphp/pest|phpunit/phpunit" composer.json 2>/dev/null; then '
                .'if [ -f vendor/bin/pest ]; then ./vendor/bin/pest --compact; '
                .'elif [ -f vendor/bin/phpunit ]; then ./vendor/bin/phpunit; '
                .'else composer test 2>/dev/null || composer run test 2>/dev/null; fi; '
                .'elif [ -f pnpm-lock.yaml ]; then pnpm test; '
                .'elif [ -f yarn.lock ]; then yarn test; '
                .'elif [ -f package.json ]; then npm test --if-present; '
                .'else echo "NO_TEST_RUNNER"; exit 2; fi';

        $appUuid = preg_replace('/[^a-zA-Z0-9_-]/', '', (string) $application->uuid) ?: 'app';
        $script = 'set +e; '
            .'APP_DIR=""; '
            .'for d in /data/devforge/applications/'.$appUuid
            .' /data/coolify/applications/'.$appUuid
            .' /var/www/html /app; do '
            .'  if [ -d "$d" ]; then APP_DIR="$d"; break; fi; '
            .'done; '
            .'if [ -z "$APP_DIR" ]; then '
            .'  CID=$(docker ps -q --filter "name='.$appUuid.'" | head -1); '
            .'  if [ -n "$CID" ]; then docker exec "$CID" sh -lc '.escapeshellarg($detectAndRun).'; exit $?; fi; '
            .'  echo "NO_APP_WORKDIR"; exit 3; '
            .'fi; '
            .'cd "$APP_DIR" && '.$detectAndRun;

        $result = $this->serverExecutor->execOnServer($serverUuid, $script, $timeout);
        $output = mb_substr((string) ($result['output'] ?? $result['error'] ?? ''), 0, 6000);
        $success = (bool) ($result['success'] ?? false);

        if (str_contains($output, 'NO_TEST_RUNNER')) {
            return [
                'ok' => false,
                'skipped' => true,
                'reason' => 'Aucun runner de tests détecté (composer/npm/pnpm).',
                'output' => $output,
            ];
        }

        if (str_contains($output, 'NO_APP_WORKDIR')) {
            return [
                'ok' => false,
                'skipped' => true,
                'reason' => 'Répertoire source / conteneur introuvable pour exécuter les tests.',
                'output' => $output,
            ];
        }

        $this->run->appendLog($success
            ? '  ✓ Tests application OK'
            : '  ✗ Tests application en échec');

        return [
            'ok' => $success,
            'application_uuid' => $application->uuid,
            'server_uuid' => $serverUuid,
            'output' => $output,
            'hint' => $success
                ? 'Tests passés — tu peux clôturer la mission (done).'
                : 'Tests en échec — corrige puis relance run_application_tests.',
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function presentMissionRow(mixed $mission, bool $detailed = false): array
    {
        $metadata = is_array($mission->metadata ?? null) ? $mission->metadata : [];
        $row = [
            'uuid' => $mission->uuid,
            'kind' => $mission->kind,
            'status' => $mission->status,
            'priority' => $mission->priority,
            'title' => $mission->title,
            'description' => mb_substr((string) ($mission->description ?? ''), 0, $detailed ? 4000 : 400),
            'resource_uuid' => $mission->resource_uuid,
            'assignee_agent_id' => $mission->assignee_agent_id,
            'assignee_uuid' => $mission->assignee?->uuid,
            'assignee_type' => $metadata['assignee_type'] ?? ($mission->assignee?->type),
            'blocked_reason' => $metadata['blocked_reason'] ?? null,
            'run_uuid' => $metadata['run_uuid'] ?? null,
        ];

        if ($detailed) {
            $row['metadata'] = $metadata;
            $row['source'] = $mission->source;
            $row['created_at'] = $mission->created_at?->toISOString();
            $row['updated_at'] = $mission->updated_at?->toISOString();
        }

        return $row;
    }

    /**
     * @param  array<string, mixed>  $arguments
     * @return array<string, mixed>
     */
    private function proposePlan(array $arguments): array
    {
        $title = trim((string) ($arguments['title'] ?? ''));
        $summary = trim((string) ($arguments['summary'] ?? ''));
        $steps = $arguments['steps'] ?? null;

        if ($title === '' || $summary === '') {
            return ['error' => 'Paramètres title et summary requis pour propose_plan.'];
        }

        if (! is_array($steps) || $steps === []) {
            return ['error' => 'Paramètre steps (liste non vide) requis pour propose_plan.'];
        }

        $normalizedSteps = [];
        foreach ($steps as $index => $step) {
            if (! is_array($step)) {
                continue;
            }

            $action = trim((string) ($step['action'] ?? ''));
            if ($action === '') {
                continue;
            }

            $risk = is_string($step['risk'] ?? null) ? strtolower((string) $step['risk']) : 'medium';
            if (! in_array($risk, ['low', 'medium', 'high'], true)) {
                $risk = 'medium';
            }

            $tool = isset($step['tool']) && is_string($step['tool']) && trim($step['tool']) !== ''
                ? trim($step['tool'])
                : null;

            $normalizedSteps[] = [
                'id' => is_string($step['id'] ?? null) && $step['id'] !== ''
                    ? (string) $step['id']
                    : (string) (count($normalizedSteps) + 1),
                'action' => mb_substr($action, 0, 500),
                'tool' => $tool,
                'risk' => $risk,
            ];
        }

        if ($normalizedSteps === []) {
            return ['error' => 'Aucun step valide (chaque step doit avoir une action).'];
        }

        $plan = [
            'status' => 'proposed',
            'title' => mb_substr($title, 0, 200),
            'summary' => mb_substr($summary, 0, 2000),
            'steps' => $normalizedSteps,
            'proposed_at' => now()->toISOString(),
        ];

        $this->run->mergeMetadata(['plan' => $plan]);
        $this->run->appendLog('Plan proposé : '.$plan['title'].' ('.count($normalizedSteps).' étapes)');

        return [
            'ok' => true,
            'pending_plan' => true,
            'plan' => $plan,
            'hint' => 'Plan proposé — en attente d’approbation utilisateur dans le chat.',
        ];
    }

    /** @return array<mixed> */
    private function execCommand(string $serverUuid, string $command, int $timeout): array
    {
        $timeout = max(5, min($timeout, 120));

        return $this->serverExecutor->execOnServer($serverUuid, $command, $timeout);
    }

    /** @return array<mixed> */
    private function searchRemoteFiles(string $serverUuid, string $pattern, string $mode = 'name', ?string $path = null): array
    {
        $pattern = trim($pattern);
        if ($pattern === '') {
            return ['error' => 'Motif de recherche requis.'];
        }

        $root = ServerPathValidator::normalizeDirectory($path);
        $escapedRoot = escapeshellarg($root);
        $escapedPattern = escapeshellarg($pattern);

        $command = $mode === 'content'
            ? "cd {$escapedRoot} && grep -rIn --exclude-dir=node_modules --exclude-dir=.git {$escapedPattern} . 2>/dev/null | head -200"
            : "find {$escapedRoot} -name {$escapedPattern} -not -path '*/node_modules/*' -not -path '*/.git/*' 2>/dev/null | head -200";

        $result = $this->serverExecutor->execOnServer($serverUuid, $command, 45);

        if (! $result['success']) {
            return ['error' => $result['error'] ?? 'Recherche impossible.'];
        }

        $lines = array_values(array_filter(
            explode("\n", trim($result['output'] ?? '')),
            fn (string $line): bool => $line !== '',
        ));

        return [
            'path' => $root,
            'pattern' => $pattern,
            'mode' => $mode,
            'results' => $lines,
            'result_count' => count($lines),
        ];
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

    private function requestApiKey(string $keyName, string $reason): array
    {
        return $this->requestUserInput([
            'kind' => 'token',
            'key' => $keyName,
            'message' => $reason,
        ]);
    }

    /**
     * @param  array<string, mixed>  $arguments
     * @return array<string, mixed>
     */
    private function memoryRead(array $arguments): array
    {
        $service = app(AgentMemoryService::class);
        $scopeRaw = strtolower(trim((string) ($arguments['scope'] ?? 'all')));
        $limit = max(1, min(50, (int) ($arguments['limit'] ?? 20)));
        $query = isset($arguments['query']) ? trim((string) $arguments['query']) : null;
        $resourceUuid = $this->resolveMemoryResourceUuid($arguments);

        if ($scopeRaw === 'all') {
            $rows = $service->listForPrompt($this->team, $this->agent, $resourceUuid, $limit);
            if ($query) {
                $rows = $rows->filter(
                    fn ($row): bool => str_contains(mb_strtolower($row->content), mb_strtolower($query)),
                )->values();
            }

            return [
                'scope' => 'all',
                'count' => $rows->count(),
                'memories' => $service->formatToolOutput('all', $rows),
            ];
        }

        $scope = $service->parseScope($scopeRaw);
        if ($scope === AgentMemoryService::SCOPE_PROJECT && ($resourceUuid === null || $resourceUuid === '')) {
            return ['error' => 'resource_uuid requis pour scope=project (ou assignez une ressource à l\'agent).'];
        }

        $rows = $service->listByScope($this->team, $scope, $this->agent, $resourceUuid, $limit, $query);

        return [
            'scope' => $scope,
            'count' => $rows->count(),
            'memories' => $service->formatToolOutput($scope, $rows),
        ];
    }

    /**
     * @param  array<string, mixed>  $arguments
     * @return array<string, mixed>
     */
    private function memoryWrite(array $arguments): array
    {
        $service = app(AgentMemoryService::class);
        $content = trim((string) ($arguments['content'] ?? $arguments['fact'] ?? ''));
        $scope = $service->parseScope($arguments['scope'] ?? 'agent');
        $resourceUuid = $this->resolveMemoryResourceUuid($arguments);
        $tags = is_array($arguments['tags'] ?? null)
            ? array_map('strval', $arguments['tags'])
            : null;

        $result = $service->write(
            team: $this->team,
            content: $content,
            scope: $scope,
            agent: $this->agent,
            resourceUuid: $resourceUuid,
            tags: $tags,
        );

        if (is_array($result)) {
            return $result;
        }

        $this->run->appendLog("  ✓ Mémoire #{$result->id} enregistrée (scope={$scope}).");

        return [
            'saved' => true,
            'id' => $result->id,
            'scope' => $scope,
            'message' => "Mémoire #{$result->id} enregistrée (scope={$scope}).",
        ];
    }

    /** @return array<string, mixed> */
    private function todoRead(): array
    {
        $items = app(AgentTodoService::class)->list($this->run);

        return [
            'count' => count($items),
            'todos' => $items,
        ];
    }

    /**
     * @param  array<string, mixed>  $arguments
     * @return array<string, mixed>
     */
    private function todoWrite(array $arguments): array
    {
        $service = app(AgentTodoService::class);

        if (isset($arguments['items']) && is_array($arguments['items'])) {
            $items = $service->replace($this->run, $arguments['items']);

            return [
                'replaced' => true,
                'count' => count($items),
                'todos' => $items,
            ];
        }

        $content = trim((string) ($arguments['content'] ?? ''));
        if ($content === '') {
            return ['error' => 'Passe items[] ou content.'];
        }

        $result = $service->upsert(
            $this->run,
            $content,
            (string) ($arguments['status'] ?? 'pending'),
            isset($arguments['id']) ? (string) $arguments['id'] : null,
        );

        if (isset($result['error'])) {
            return $result;
        }

        return [
            'saved' => true,
            'todo' => $result,
            'todos' => $service->list($this->run),
        ];
    }

    /**
     * @param  array<string, mixed>  $arguments
     */
    private function resolveMemoryResourceUuid(array $arguments): ?string
    {
        $fromArgs = trim((string) ($arguments['resource_uuid'] ?? $arguments['application_uuid'] ?? ''));
        if ($fromArgs !== '') {
            return $fromArgs;
        }

        if (is_string($this->assignedResourceUuid) && $this->assignedResourceUuid !== '') {
            return $this->assignedResourceUuid;
        }

        $fromContext = trim((string) ($this->runContext['application_uuid'] ?? ''));

        return $fromContext !== '' ? $fromContext : null;
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

    private function applicationSourceService(): ApplicationSourceService
    {
        return app(ApplicationSourceService::class);
    }

    private function resolveApplicationUuid(?string $applicationUuid): ?string
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

    /**
     * @return array<string, mixed>|Application
     */
    private function resolveApplication(?string $applicationUuid): array|Application
    {
        $uuid = $this->resolveApplicationUuid($applicationUuid);

        if ($uuid === null) {
            return ['error' => 'application_uuid requis (ou contexte déploiement / agent lié à une application).'];
        }

        try {
            $application = $this->applicationSourceService()->applicationForTeam($this->team, $uuid);
        } catch (ModelNotFoundException) {
            return ['error' => "Application {$uuid} introuvable."];
        }

        if (! $this->matchesAssignedResource($application)) {
            return ['error' => 'Agent limité à une autre ressource — accès refusé.'];
        }

        return $application;
    }

    /** @return array<string, mixed> */
    private function getApplicationSourceInfo(?string $applicationUuid): array
    {
        $application = $this->resolveApplication($applicationUuid);
        if (is_array($application)) {
            return $application;
        }

        return $this->applicationSourceService()->info($application);
    }

    /** @return array<string, mixed> */
    private function listApplicationEnvVars(?string $applicationUuid): array
    {
        $application = $this->resolveApplication($applicationUuid);
        if (is_array($application)) {
            return $application;
        }

        return $this->envCatalog->list($application);
    }

    /** @return array<string, mixed> */
    private function upsertApplicationEnvVar(
        ?string $applicationUuid,
        string $key,
        string $value,
        bool $isBuildtime = true,
        bool $isRuntime = true,
        bool $isLiteral = true,
    ): array {
        if ($key === '') {
            return ['error' => 'Paramètre key requis pour upsert_application_env_var.'];
        }

        if (preg_match('/^(DUMMY_|FORCE_REDEPLOY|REDEPLOY_TRIGGER)|(_TRIGGER|_DUMMY)$/i', $key) === 1
            || strcasecmp($key, 'DUMMY_REDEPLOY_TRIGGER') === 0) {
            return [
                'error' => 'Variable factice refusée. Ne crée pas de DUMMY_*/_TRIGGER pour forcer un redeploy — corrige la vraie cause (permissions hôte, branche, build, env citée dans les logs).',
                'hint' => 'host_permission_or_real_fix',
            ];
        }

        $application = $this->resolveApplication($applicationUuid);
        if (is_array($application)) {
            return $application;
        }

        try {
            $variable = $this->envCatalog->upsert($application, [
                'key' => $key,
                'value' => $value,
                'is_buildtime' => $isBuildtime,
                'is_runtime' => $isRuntime,
                'is_literal' => $isLiteral,
            ]);

            $this->run->appendLog("  ✓ Variable Coolify {$key} mise à jour sur {$application->uuid}");

            return [
                'ok' => true,
                'variable' => $variable,
                'hint' => 'Variable Coolify enregistrée. Utilise control_resource deploy pour reconstruire.',
            ];
        } catch (ValidationException $exception) {
            return ['error' => collect($exception->errors())->flatten()->first() ?? 'Variable invalide.'];
        } catch (\Throwable $exception) {
            return ['error' => mb_substr($exception->getMessage(), 0, 300)];
        }
    }

    /** @return array<string, mixed> */
    private function updateApplicationGitBranch(
        ?string $applicationUuid,
        string $gitBranch,
        bool $redeploy = true,
        string $reason = '',
    ): array {
        return $this->repairActions->updateApplicationGitBranch($applicationUuid, $gitBranch, $redeploy, $reason);
    }

    /**
     * @param  array<string, mixed>  $arguments
     * @return array<string, mixed>
     */
    private function checkDockerImageUpdate(array $arguments): array
    {
        $applicationUuid = isset($arguments['application_uuid'])
            ? (string) $arguments['application_uuid']
            : ($this->assignedResourceUuid ?? (is_string($this->runContext['application_uuid'] ?? null) ? $this->runContext['application_uuid'] : null));
        $image = isset($arguments['image']) ? (string) $arguments['image'] : null;
        $inspectRunning = array_key_exists('inspect_running', $arguments)
            ? (bool) $arguments['inspect_running']
            : true;

        return app(DockerImageUpdateChecker::class)->check(
            team: $this->team,
            applicationUuid: is_string($applicationUuid) && $applicationUuid !== '' ? $applicationUuid : null,
            image: is_string($image) && $image !== '' ? $image : null,
            inspectRunning: $inspectRunning,
        );
    }

    /** @return array<string, mixed> */
    private function getApplicationRuntimeSettings(?string $applicationUuid): array
    {
        $application = $this->resolveApplication($applicationUuid);
        if (is_array($application)) {
            return $application;
        }

        return [
            'ok' => true,
            'application_uuid' => $application->uuid,
            'settings' => app(ApplicationRuntimeSettingsService::class)->show($application),
        ];
    }

    /**
     * @param  array<string, mixed>  $arguments
     * @return array<string, mixed>
     */
    private function updateApplicationRuntimeSettings(?string $applicationUuid, array $arguments): array
    {
        $application = $this->resolveApplication($applicationUuid);
        if (is_array($application)) {
            return $application;
        }

        $allowed = [
            'build_pack',
            'is_static',
            'install_command',
            'build_command',
            'start_command',
            'ports_exposes',
            'base_directory',
            'publish_directory',
            'health_check_enabled',
            'health_check_type',
            'health_check_path',
            'health_check_port',
        ];

        $input = [];
        foreach ($allowed as $key) {
            if (! array_key_exists($key, $arguments)) {
                continue;
            }

            $value = $arguments[$key];
            if (is_string($value) && $value === '' && in_array($key, ['install_command', 'build_command', 'start_command', 'health_check_port'], true)) {
                $input[$key] = null;
            } else {
                $input[$key] = $value;
            }
        }

        if ($input === []) {
            return ['error' => 'Aucun réglage runtime/build fourni pour update_application_runtime_settings.'];
        }

        $redeploy = array_key_exists('redeploy', $arguments) ? (bool) $arguments['redeploy'] : true;
        $reason = trim((string) ($arguments['reason'] ?? ''));
        $input['redeploy'] = false;

        try {
            $result = app(ApplicationRuntimeSettingsService::class)->update($application, $input);
        } catch (ValidationException $exception) {
            return ['error' => collect($exception->errors())->flatten()->first() ?? 'Réglages invalides.'];
        } catch (\Throwable $exception) {
            return ['error' => mb_substr($exception->getMessage(), 0, 300)];
        }

        $changedKeys = array_keys(array_diff_key($input, ['redeploy' => true]));
        $this->run->appendLog('  ✓ Runtime/build Coolify mis à jour ('.implode(', ', $changedKeys).") sur {$application->uuid}");

        $actionsTaken = $this->run->actions_taken ?? [];
        $actionsTaken[] = [
            'tool' => 'update_application_runtime_settings',
            'uuid' => $application->uuid,
            'type' => 'applications',
            'action' => 'update_runtime_settings',
            'reason' => $reason !== '' ? $reason : 'Correction config build Coolify',
            'keys' => $changedKeys,
            'at' => now()->toISOString(),
        ];
        $this->run->actions_taken = $actionsTaken;
        $this->run->saveQuietly();

        $payload = [
            'ok' => true,
            'application_uuid' => $application->uuid,
            'settings' => $result['settings'] ?? null,
            'updated_keys' => $changedKeys,
        ];

        if (! $redeploy) {
            return [
                ...$payload,
                'hint' => 'Réglages enregistrés. Utilise control_resource deploy pour reconstruire.',
            ];
        }

        $deploy = $this->controlResource(
            $application->uuid,
            'applications',
            'deploy',
            $reason !== '' ? $reason : 'Redeploy après correction runtime/build Coolify',
        );

        if (isset($deploy['error'])) {
            return [
                ...$payload,
                'redeploy' => $deploy,
                'hint' => 'Réglages mis à jour, mais le redeploy a échoué — réessaie control_resource deploy.',
            ];
        }

        return [...$payload, 'redeploy' => $deploy];
    }

    /** @return array<string, mixed> */
    private function syncApplicationProxyLabels(
        ?string $applicationUuid,
        bool $redeploy = true,
        string $reason = '',
    ): array {
        return $this->repairActions->syncApplicationProxyLabels($applicationUuid, $redeploy, $reason);
    }

    /** @return array<string, mixed> */
    private function fixApplicationHostPermissions(
        ?string $applicationUuid,
        ?string $pathHint,
        bool $redeploy = true,
        string $reason = '',
    ): array {
        return $this->repairActions->fixApplicationHostPermissions($applicationUuid, $pathHint, $redeploy, $reason);
    }

    /** @return array<string, mixed> */
    private function fixCoolifyBaseConfigPath(
        ?string $applicationUuid,
        bool $redeploy = true,
        string $reason = '',
        ?string $container = null,
    ): array {
        return $this->repairActions->fixCoolifyBaseConfigPath($applicationUuid, $redeploy, $reason, $container);
    }

    /** @return array<string, mixed> */
    private function listApplicationSource(?string $applicationUuid, ?string $path): array
    {
        $application = $this->resolveApplication($applicationUuid);
        if (is_array($application)) {
            return $application;
        }

        try {
            return $this->applicationSourceService()->listDirectory($this->team, $application, $path);
        } catch (ValidationException $exception) {
            return ['error' => collect($exception->errors())->flatten()->first() ?? 'Source indisponible.'];
        }
    }

    /** @return array<string, mixed> */
    private function readApplicationSource(?string $applicationUuid, string $path): array
    {
        if ($path === '') {
            return ['error' => 'Paramètre path requis pour read_application_source.'];
        }

        $application = $this->resolveApplication($applicationUuid);
        if (is_array($application)) {
            return $application;
        }

        try {
            return $this->applicationSourceService()->readFile($this->team, $application, $path);
        } catch (ValidationException $exception) {
            return ['error' => collect($exception->errors())->flatten()->first() ?? 'Fichier source indisponible.'];
        }
    }

    /** @return array<string, mixed> */
    private function writeApplicationSource(
        ?string $applicationUuid,
        string $path,
        string $content,
        string $commitMessage,
        ?string $sha,
        ?string $mode = null,
        ?bool $redeploy = null,
        ?string $branchName = null,
        ?string $prTitle = null,
        ?string $prBody = null,
    ): array {
        if ($path === '') {
            return ['error' => 'Paramètre path requis pour write_application_source.'];
        }

        if (trim($commitMessage) === '') {
            return ['error' => 'Paramètre commit_message requis pour write_application_source.'];
        }

        if ($this->isEnvFilePath($path)) {
            return [
                'error' => 'Interdit d’écrire un fichier .env via Git. Utilise upsert_application_env_var (variables Coolify build/runtime), puis control_resource deploy.',
                'hint' => 'upsert_application_env_var',
            ];
        }

        $application = $this->resolveApplication($applicationUuid);
        if (is_array($application)) {
            return $application;
        }

        if ($this->shouldForcePullRequest()) {
            $mode = 'pull_request';
            $redeploy = false;
        }

        $options = [];
        if ($mode !== null && $mode !== '') {
            $options['mode'] = $mode;
        }
        if ($redeploy !== null) {
            $options['redeploy'] = $redeploy;
        }
        if ($branchName !== null && $branchName !== '') {
            $options['branch_name'] = $branchName;
        }
        if ($prTitle !== null && $prTitle !== '') {
            $options['pr_title'] = $prTitle;
        }
        if ($prBody !== null && $prBody !== '') {
            $options['pr_body'] = $prBody;
        }

        try {
            $result = $this->applicationSourceService()->writeFile(
                $this->team,
                $application,
                $path,
                $content,
                $commitMessage,
                $sha,
                $options,
            );
            $this->syncMissionPullRequestFromWrite($result);

            return $result;
        } catch (ValidationException $exception) {
            $error = collect($exception->errors())->flatten()->first() ?? 'Écriture source impossible.';
            $payload = ['error' => $error];

            if ($this->isGithubPermissionError((string) $error)) {
                $payload['hint'] = 'Si tu voulais une variable Coolify (ex. PUPPETEER_SKIP_DOWNLOAD), utilise upsert_application_env_var puis control_resource deploy. Ne redéploie pas sans correction.';
            }

            return $payload;
        }
    }

    private function shouldForcePullRequest(): bool
    {
        if (($this->runContext['force_pull_request'] ?? false) === true) {
            return true;
        }

        if (($this->runContext['workflow'] ?? null) === AgentFeatureDelivery::WORKFLOW) {
            return true;
        }

        if (($this->runContext['mission_kind'] ?? null) === 'feature') {
            return true;
        }

        $missionUuid = $this->runContext['mission_uuid'] ?? null;
        if (! is_string($missionUuid) || $missionUuid === '') {
            return false;
        }

        $mission = \App\Models\AiAgentMission::query()
            ->where('team_id', $this->team->id)
            ->where('uuid', $missionUuid)
            ->first();

        return $mission instanceof \App\Models\AiAgentMission
            && app(AgentFeatureDelivery::class)->isFeatureDelivery($mission);
    }

    /**
     * @param  array<string, mixed>  $result
     */
    private function syncMissionPullRequestFromWrite(array $result): void
    {
        $prNumber = (int) ($result['pull_request_number'] ?? 0);
        if ($prNumber <= 0) {
            return;
        }

        $missionUuid = $this->runContext['mission_uuid'] ?? null;
        if (! is_string($missionUuid) || $missionUuid === '') {
            return;
        }

        $mission = \App\Models\AiAgentMission::query()
            ->where('team_id', $this->team->id)
            ->where('uuid', $missionUuid)
            ->first();

        if (! $mission instanceof \App\Models\AiAgentMission) {
            return;
        }

        app(AgentFeatureDelivery::class)->attachPullRequest(
            $mission,
            $prNumber,
            isset($result['pull_request_url']) ? (string) $result['pull_request_url'] : null,
            isset($result['branch']) ? (string) $result['branch'] : null,
        );

        $meta = is_array($this->run->metadata) ? $this->run->metadata : [];
        $meta['pull_request_number'] = $prNumber;
        if (! empty($result['pull_request_url'])) {
            $meta['pull_request_url'] = $result['pull_request_url'];
        }
        $this->run->metadata = $meta;
        $this->run->save();
    }

    /**
     * @param  array<string, mixed>  $arguments
     * @return array<string, mixed>
     */
    private function getApplicationPreview(array $arguments): array
    {
        $application = $this->resolveApplication(
            isset($arguments['application_uuid']) ? (string) $arguments['application_uuid'] : null,
        );
        if (is_array($application)) {
            return $application;
        }

        $prId = isset($arguments['pull_request_id']) ? (int) $arguments['pull_request_id'] : 0;
        if ($prId <= 0) {
            $prId = (int) ($this->run->metadata['pull_request_number'] ?? 0);
        }
        if ($prId <= 0) {
            $missionUuid = $this->runContext['mission_uuid'] ?? null;
            if (is_string($missionUuid) && $missionUuid !== '') {
                $mission = \App\Models\AiAgentMission::query()
                    ->where('team_id', $this->team->id)
                    ->where('uuid', $missionUuid)
                    ->first();
                $prId = (int) (($mission?->metadata['pull_request_number'] ?? 0));
            }
        }

        if ($prId <= 0) {
            return [
                'error' => 'Aucun pull_request_id — passe le numéro de PR ou crée d’abord une PR via write_application_source mode=pull_request.',
            ];
        }

        $delivery = app(AgentFeatureDelivery::class);
        $preview = $delivery->findPreview($application, $prId);
        $settings = app(\App\Services\DevForge\Application\ApplicationPreviewCatalog::class)->settings($application);

        if ($preview === null) {
            return [
                'ok' => false,
                'pull_request_id' => $prId,
                'preview_deployments_enabled' => (bool) $settings['is_preview_deployments_enabled'],
                'message' => (bool) $settings['is_preview_deployments_enabled']
                    ? 'Preview pas encore créée — le webhook GitHub PR peut prendre quelques secondes/minutes.'
                    : 'Preview deployments désactivés sur cette app (Paramètres → Previews). La PR reste testable via GitHub.',
            ];
        }

        return [
            'ok' => true,
            'pull_request_id' => $prId,
            'preview' => $preview,
            'preview_url' => $preview['fqdn'] ?? null,
            'preview_deployments_enabled' => true,
        ];
    }

    private function isEnvFilePath(string $path): bool
    {
        $normalized = strtolower(str_replace('\\', '/', trim($path)));
        $basename = basename($normalized);

        return $basename === '.env' || str_starts_with($basename, '.env.');
    }

    private function isGithubPermissionError(string $error): bool
    {
        $normalized = strtolower($error);

        return str_contains($normalized, 'resource not accessible')
            || str_contains($normalized, 'permission')
            || str_contains($normalized, 'not accessible by integration')
            || str_contains($normalized, '403')
            || str_contains($normalized, 'forbidden');
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
