<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\Application;
use App\Models\Team;
use App\Services\DevForge\Agent\Tool\AgentCustomTools;
use App\Services\DevForge\Agent\Tool\AgentGithubTools;
use App\Services\DevForge\Agent\Tool\AgentPermissionEngine;
use App\Services\DevForge\Agent\Tool\AgentServerExecutor;
use App\Services\DevForge\Agent\Tool\AgentToolApprovalGrant;
use App\Services\DevForge\Agent\Tool\AgentToolClassification;
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
        ?ApplicationEnvironmentVariableCatalog $envCatalog = null,
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
        $this->session = new AgentToolkitSession($this->agent);
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
        $decision = $engine->decide($this->agent, $toolName, $arguments, $classification);
        $decision = $engine->resolveForTrigger($decision, (string) ($this->run->trigger ?? 'manual'), $toolName);

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

            $message = "Approbation requise pour « {$toolName} » : {$decision['reason']} "
                .'Validez ou refusez dans l’UI chat, puis réessayez.';
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
            return $this->applicationSourceService()->writeFile(
                $this->team,
                $application,
                $path,
                $content,
                $commitMessage,
                $sha,
                $options,
            );
        } catch (ValidationException $exception) {
            $error = collect($exception->errors())->flatten()->first() ?? 'Écriture source impossible.';
            $payload = ['error' => $error];

            if ($this->isGithubPermissionError((string) $error)) {
                $payload['hint'] = 'Si tu voulais une variable Coolify (ex. PUPPETEER_SKIP_DOWNLOAD), utilise upsert_application_env_var puis control_resource deploy. Ne redéploie pas sans correction.';
            }

            return $payload;
        }
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
