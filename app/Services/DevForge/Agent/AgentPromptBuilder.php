<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;

class AgentPromptBuilder
{
    /**
     * @param  array<string, mixed>  $context
     */
    public function autonomousSystemPrompt(AiAgent $agent, array $context = []): string
    {
        $basePrompt = trim($agent->system_prompt ?: AgentDirectives::defaultSystemPrompt($agent->type));

        $eventRules = match ($context['event'] ?? null) {
            'deployment_failed' => <<<'RULES'

            Contexte : échec de déploiement détecté.
            - Analyse les logs fournis puis get_deployment_logs si besoin.
            - Pour une variable de build (PUPPETEER_SKIP_DOWNLOAD, NODE_ENV, etc.) : upsert_application_env_var (Coolify), jamais un fichier .env Git.
            - write_application_source seulement pour du code (package.json, Dockerfile, etc.). Jamais .env / .env.*.
            - Si write_application_source échoue (GitHub « Resource not accessible », permissions) : bascule immédiatement sur upsert_application_env_var pour les variables, ou documente le besoin d'accès Git — ne redéploie pas sans correction.
            - « Permission denied » sur /data/coolify/applications/... ou data/applications/... = problème d’ownership host (chown / ops), PAS Puppeteer ni code app.
            - Après control_resource deploy mis en file : résume les prochaines étapes et ARRÊTE — ne poll pas les logs en boucle.
            - Un seul redeploy automatique maximum via control_resource.
            - Si config utilisateur en cause, documente sans boucler.
            RULES,
            'deployment_build_started' => <<<'RULES'

            Contexte : build webhook en cours.
            - Surveille le déploiement actif et les ressources liées.
            - Analyse les logs si échec ou blocage.
            RULES,
            'deployment_build_completed' => <<<'RULES'

            Contexte : build terminé avec succès.
            - Vérifie que l'application est healthy (get_resource_status).
            - docker_logs si anomalie ou conteneur instable.
            - Rapport concis : OK ou points d'attention.
            - Pas de redeploy sauf anomalie critique détectée.
            RULES,
            'delegated' => <<<'RULES'

            Contexte : sous-tâche déléguée par un agent parent.
            - Concentre-toi sur l'objectif fourni.
            - Pas de delegate_task (tu es un worker).
            RULES,
            default => '',
        };

        $autonomyRules = AgentDirectives::autonomyRules();

        return trim(<<<PROMPT
        {$basePrompt}

        Tu es un agent IA autonome intégré dans DevForge (PaaS Coolify).
        Équipe : {$agent->team->name}
        Type : {$agent->type}

        {$eventRules}

        {$autonomyRules}
        PROMPT);
    }

    /**
     * @param  array<string, mixed>  $context
     */
    public function autonomousInitialMessage(AiAgent $agent, array $context = [], string $trigger = 'manual'): string
    {
        if (($context['event'] ?? null) === 'deployment_failed') {
            return $this->deploymentFailureContext($agent, $context);
        }

        if (($context['event'] ?? null) === 'deployment_build_started') {
            return $this->deploymentBuildStartedContext($agent, $context);
        }

        if (($context['event'] ?? null) === 'deployment_build_completed') {
            return $this->deploymentBuildCompletedContext($agent, $context);
        }

        if (($context['event'] ?? null) === 'delegated') {
            return $this->delegatedContext($agent, $context);
        }

        $now = now()->format('d/m/Y H:i');
        $triggerLabel = match ($trigger) {
            'scheduled' => 'planification automatique',
            'manual' => 'lancement manuel',
            'event' => 'événement système',
            default => $trigger,
        };

        $resourceContext = $agent->resource_uuid
            ? "Scope : ressource UUID {$agent->resource_uuid} uniquement."
            : 'Scope : toutes les ressources de l\'équipe.';

        $playbook = AgentDirectives::autonomousPlaybook($agent->type);
        $steps = implode("\n", array_map(
            fn (string $step, int $index): string => ($index + 1).'. '.$step,
            $playbook,
            array_keys($playbook),
        ));

        return trim(<<<CONTEXT
        DÉMARRAGE AUTONOME — {$triggerLabel}
        Date : {$now}
        Agent : {$agent->name} ({$agent->type})
        {$resourceContext}

        Playbook à exécuter maintenant :
        {$steps}

        Commence par la première étape avec un appel d'outil. Ne t'arrête pas avant d'avoir terminé le playbook ou atteint une conclusion actionnable.
        CONTEXT);
    }

    /**
     * @param  array<string, mixed>  $applicationContext
     */
    public function chatSystemPrompt(AiAgent $agent, ?string $latestUserMessage = null, array $applicationContext = []): string
    {
        $basePrompt = trim($agent->system_prompt ?: AgentDirectives::defaultSystemPrompt($agent->type));
        $teamName = $agent->team->name;
        $autonomyRules = AgentDirectives::chatAutonomyRules();
        $actionHint = $latestUserMessage !== null
            ? AgentDirectives::chatActionHint($latestUserMessage, $agent)
            : null;
        $hintBlock = $actionHint !== null
            ? "\n\nConsigne immédiate pour le message utilisateur en cours :\n{$actionHint}"
            : '';
        $scopeBlock = $agent->resource_uuid
            ? "\nScope agent : ressource UUID {$agent->resource_uuid} uniquement (sauf demande explicite de l'équipe entière)."
            : '';
        $applicationBlock = $this->chatApplicationContextBlock($applicationContext);

        return trim(<<<PROMPT
        {$basePrompt}

        Tu es un agent IA intégré dans DevForge (PaaS auto-hébergé).
        Tu converses avec un membre de l'équipe « {$teamName} » dans une interface de chat.
        {$scopeBlock}
        {$applicationBlock}

        {$autonomyRules}
        {$hintBlock}
        PROMPT);
    }

    /**
     * @param  array<string, mixed>  $context
     */
    private function chatApplicationContextBlock(array $context): string
    {
        $applicationUuid = trim((string) ($context['application_uuid'] ?? ''));
        if ($applicationUuid === '') {
            return '';
        }

        $applicationName = (string) ($context['application_name'] ?? 'Application');
        $gitRepository = (string) ($context['git_repository'] ?? 'inconnu');
        $gitBranch = (string) ($context['git_branch'] ?? 'inconnu');
        $buildPack = (string) ($context['build_pack'] ?? 'inconnu');
        $fqdn = (string) ($context['fqdn'] ?? 'aucun');

        return trim(<<<CONTEXT

        Champ d'application (scope obligatoire pour ce chat) :
        - Application : {$applicationName} ({$applicationUuid})
        - Dépôt : {$gitRepository}
        - Branche : {$gitBranch}
        - Build pack : {$buildPack}
        - Domaines : {$fqdn}

        Traite chaque demande comme portant sur CETTE application.
        Pour les outils (read_application_source, write_application_source, upsert_application_env_var, control_resource, get_deployment_logs, get_resource_status, etc.), utilise application_uuid={$applicationUuid} sans redemander l'UUID.
        CONTEXT);
    }

    /**
     * @param  array<string, mixed>  $context
     */
    private function deploymentFailureContext(AiAgent $agent, array $context): string
    {
        $applicationName = (string) ($context['application_name'] ?? 'Application');
        $applicationUuid = (string) ($context['application_uuid'] ?? '');
        $deploymentUuid = (string) ($context['deployment_uuid'] ?? '');
        $commit = (string) ($context['commit'] ?? 'inconnu');
        $failureExcerpt = json_encode($context['failure_excerpt'] ?? [], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);

        return trim(<<<CONTEXT
        ALERTE : déploiement en échec — agis immédiatement.

        Application : {$applicationName} ({$applicationUuid})
        Déploiement : {$deploymentUuid}
        Commit : {$commit}

        Logs d'échec :
        {$failureExcerpt}

        Étapes :
        1. get_deployment_logs avec deployment_uuid
        2. get_resource_status sur l'application
        3. Si l'erreur cite une variable d'env (PUPPETEER_SKIP_DOWNLOAD, NODE_OPTIONS, etc.) : upsert_application_env_var puis control_resource deploy — JAMAIS write_application_source sur .env
        4. Si « Permission denied » sur le répertoire Coolify data/applications : diagnostiquer ownership (ops/chown), ne pas chercher Puppeteer
        5. Sinon read_application_source sur les fichiers liés (package.json, Dockerfile, etc.)
        6. write_application_source si correction code évidente (jamais .env) ; en cas d'erreur GitHub permissions → upsert_application_env_var ou résumé bloquant
        7. control_resource deploy UNE FOIS si correction appliquée, puis STOP (pas de polling interminable des logs)
        8. Résumé actionnable

        Première action : appel d'outil obligatoire.
        CONTEXT);
    }

    /**
     * @param  array<string, mixed>  $context
     */
    private function deploymentBuildStartedContext(AiAgent $agent, array $context): string
    {
        $applicationName = (string) ($context['application_name'] ?? 'Application');
        $applicationUuid = (string) ($context['application_uuid'] ?? '');
        $deploymentUuid = (string) ($context['deployment_uuid'] ?? '');
        $commit = (string) ($context['commit'] ?? 'inconnu');
        $buildPack = (string) ($context['build_pack'] ?? 'inconnu');
        $triggerSource = (string) ($context['trigger_source'] ?? 'webhook');

        return trim(<<<CONTEXT
        BUILD DÉMARRÉ ({$triggerSource})

        Application : {$applicationName} ({$applicationUuid})
        Déploiement : {$deploymentUuid}
        Commit : {$commit}
        Build pack : {$buildPack}

        Étapes :
        1. get_deployment_logs pour ce déploiement
        2. get_resource_status sur l'application
        3. Surveiller et analyser si échec
        4. Rapport concis

        Commence par get_deployment_logs.
        CONTEXT);
    }

    /**
     * @param  array<string, mixed>  $context
     */
    private function deploymentBuildCompletedContext(AiAgent $agent, array $context): string
    {
        $applicationName = (string) ($context['application_name'] ?? 'Application');
        $applicationUuid = (string) ($context['application_uuid'] ?? '');
        $deploymentUuid = (string) ($context['deployment_uuid'] ?? '');
        $commit = (string) ($context['commit'] ?? 'inconnu');
        $buildPack = (string) ($context['build_pack'] ?? 'inconnu');
        $triggerSource = (string) ($context['trigger_source'] ?? 'webhook');

        return trim(<<<CONTEXT
        BUILD TERMINÉ AVEC SUCCÈS ({$triggerSource})

        Application : {$applicationName} ({$applicationUuid})
        Déploiement : {$deploymentUuid}
        Commit : {$commit}
        Build pack : {$buildPack}

        Étapes :
        1. get_resource_status sur l'application
        2. get_deployment_logs pour confirmer la fin du déploiement
        3. docker_logs si le statut n'est pas healthy
        4. Rapport concis : OK ou points d'attention

        Commence par get_resource_status.
        CONTEXT);
    }

    /**
     * @param  array<string, mixed>  $context
     */
    private function delegatedContext(AiAgent $agent, array $context): string
    {
        $goal = (string) ($context['delegated_goal'] ?? '');
        $parentUuid = (string) ($context['parent_agent_uuid'] ?? 'inconnu');

        return trim(<<<CONTEXT
        DÉLÉGATION depuis agent parent ({$parentUuid}).

        Objectif :
        {$goal}

        Exécute avec les outils. Première action = appel d'outil.
        CONTEXT);
    }
}
