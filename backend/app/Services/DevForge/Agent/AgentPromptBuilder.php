<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;
use App\Services\DevForge\Agent\Tool\AgentPermissionEngine;

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
            - Tu es ORCHESTRATEUR : pipeline obligé diagnose → fix → redeploy (1×).
            - Étape 1 : spawn_task(goal=…, leaf_profile=diagnose) puis yield_wait. REVIEW le handoff.
            - Étape 2 : spawn_task(goal=…, leaf_profile=fix) puis yield_wait. REVIEW le handoff.
            - Étape 3 : spawn_task(goal=…, leaf_profile=redeploy) puis yield_wait — un seul redeploy max.
            - INTERDIT de skipper la review entre étapes.
            - INTERDIT de terminer en diagnostic seul si une correction outil est possible.
            - Si clone Git échoue (Remote branch not found / Could not find remote branch) : get_application_git_info + list_github_branches puis update_application_git_branch (redeploy=true) via leaf fix.
            - Échec de BUILD (nixpacks/npm/yarn/pnpm/tsc/vite/dockerfile) :
              1) get_application_runtime_settings + read_application_source (package.json, Dockerfile, nixpacks.toml…)
              2) Corrige côté Coolify via update_application_runtime_settings (install_command, build_command, start_command, ports_exposes, base_directory, publish_directory, build_pack) si la config Coolify est en cause
              3) Ou upsert_application_env_var pour variables de build (PUPPETEER_SKIP_DOWNLOAD, NODE_OPTIONS, NODE_ENV…)
              4) Ou write_application_source pour un fix code évident (package.json scripts, Dockerfile) — jamais .env
              5) Puis redeploy (1 fois) via l’outil qui a corrigé ou control_resource deploy
            - Si write_application_source échoue (GitHub permissions) : bascule sur update_application_runtime_settings / upsert_application_env_var — ne redéploie pas sans correction.
            - « Permission denied » / « tee: … Permission denied » lors de l’écriture .env / applications/* :
              CORRIGE en autonomie avec fix_application_host_permissions (chown/chmod ciblé + redeploy).
              INTERDIT d’inventer une variable env factice (DUMMY_*, *_TRIGGER, FORCE_REDEPLOY…).
              INTERDIT de s’arrêter sur « intervention manuelle ops » sans avoir tenté fix_application_host_permissions.
            - « Read-only file system » pendant un mkdir Coolify (chemin hôte incorrect ou config cache) :
              CORRIGE avec fix_coolify_base_config_path (recharge BASE_CONFIG_PATH via config:clear + horizon:terminate + redeploy).
              Ne suppose pas un chemin NAS particulier — l’outil lit la config réelle.
            - Site statique qui sert la page nginx par défaut / publish_directory vide :
              Déduis le dossier de build depuis les logs (directory: /app/…, astro/vite/next) puis
              update_application_runtime_settings(publish_directory=…, redeploy=true).
            - Conteneur unhealthy + « Healthcheck URL … :3000 » alors que les logs disent « listening on … :4321 » :
              update_application_runtime_settings(ports_exposes=4321, health_check_port=4321, redeploy=true)
              et upsert_application_env_var PORT=4321 (runtime). Astro SSR écoute souvent 4321, pas 3000.
              Puis sync_application_proxy_labels si les labels Traefik restent sur port 80.
            - HTTP 502 / Bad Gateway / Host Error (Cloudflare) alors que le conteneur est healthy :
              sync_application_proxy_labels (régénère Traefik loadbalancer.port depuis ports_exposes) puis redeploy.
              Cause typique : custom_labels figés sur port=80 alors que ports_exposes=4321.
            - npm E401 / unauthenticated sur npm.pkg.github.com :
              Coolify injecte NODE_AUTH_TOKEN au build via PAT enregistré (Connexions → token Packages)
              ou token GitHub App si packages:read est accordé.
              Si aucun des deux → needs_user : guider vers DevForge → Connexions (PAT read:packages),
              avec steps numérotées et pill href /connexions.
              Sinon → control_resource deploy (1×). Ne invente PAS de PAT.
            - Crash post-deploy « Class ApplicationReadiness not found » (rollback du conteneur) :
              control_resource deploy après diagnostic — la plateforme ne doit pas détruire un conteneur sain.
            - INTERDIT d’inventer des corrections cosmétiques (variables dummy, redeploy à l’aveugle) pour « faire une action ».
            - Après deploy mis en file : résume et ARRÊTE — ne poll pas les logs en boucle.
            - Un seul redeploy automatique maximum.
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
            'heartbeat' => <<<'RULES'

            Contexte : heartbeat idle.
            - Vérifie rapidement les standing orders et la santé des ressources assignées.
            - Si rien à faire : termine avec le résumé exact HEARTBEAT_OK (pas de spam chat).
            - Si action nécessaire : agis, puis résume clairement.
            RULES,
            'application_readiness_failed' => <<<'RULES'

            Contexte : le déploiement a réussi mais la probe HTTP du domaine public a échoué.
            - get_resource_status puis docker_logs sur l'application.
            - http_request vers le FQDN fourni pour confirmer l'erreur.
            - Si page nginx par défaut / publish_directory vide sur site statique :
              déduis le dossier depuis get_deployment_logs / get_application_runtime_settings puis
              update_application_runtime_settings(publish_directory=…, is_static=true, redeploy=true) IMMÉDIATEMENT.
            - Si HTTP 502 / Bad Gateway / Host Error et conteneur healthy :
              sync_application_proxy_labels (Traefik port ≠ ports_exposes, souvent 80 vs 4321) puis redeploy.
            - Cherche env manquantes (ex. ASTRO_DB_*, DATABASE_URL, secrets).
            - Corrige via outils autorisés : sync_application_proxy_labels, update_application_runtime_settings, upsert_application_env_var, control_resource restart/redeploy (1 fois max).
            - Si correction automatique possible : applique puis termine avec outcome auto_fixed.
            - Si une action humaine est nécessaire : outcome needs_user avec :
              - title = action concrète attendue (ex. « Ajouter ASTRO_DB_REMOTE_URL »), JAMAIS « Intervention requise »
              - summary = erreur observée (HTTP/status + cause) en 1-2 phrases, sans secrets
              - steps = 2 à 5 actions utilisateur précises et ordonnées
            - Termine TOUJOURS par un bloc JSON unique :
              {"outcome":"auto_fixed|needs_user|failed","title":"...","summary":"...","steps":["..."]}
            RULES,
            'delegated' => <<<'RULES'

            Contexte : sous-tâche leaf déléguée par un agent parent.
            - Concentre-toi sur l'objectif fourni.
            - INTERDIT : spawn_task, delegate_task, yield_wait (tu es un leaf).
            - Produis un résumé clair et actionnable pour le parent (preuves, erreurs, prochaines étapes suggérées).
            RULES,
            'mission_work' => <<<'RULES'

            Contexte : mission assignée via le board (équipe autonome).
            - mission_show sur mission_uuid, puis travaille jusqu'à done ou blocked.
            - Si kind=feature|tech_watch : implémente (read/write_application_source ou GitHub), puis run_application_tests (ou spawn_task leaf_profile=test + yield_wait).
            - Si kind=bug : diagnostique, corrige, teste, mission_update(done).
            - Secret/token manquant : request_user_input (jamais inventer de credentials).
            - Termine par mission_update(status=done|blocked) avec blocked_reason si besoin.
            RULES,
            'user_input_resolved' => <<<'RULES'

            Contexte : l'utilisateur a fourni une clé/token/confirmation.
            - La valeur N'EST PAS dans ce prompt (sécurité) — elle a été injectée côté plateforme.
            - Reprends la mission / le travail en cours immédiatement avec les outils.
            - Ne redemande pas le même secret.
            RULES,
            'tech_watch_missions' => <<<'RULES'

            Contexte : nouvelles missions veille créées.
            - Tu es proposeur : mission_list, enrichis les descriptions, memory_write(scope=shared).
            - INTERDIT write_application_source / control_resource deploy — assigne assignee_type=devforge.
            RULES,
            default => '',
        };

        $roleRules = match (\App\Services\DevForge\Agent\Tool\AgentSubagentCapabilities::resolveRole($context)) {
            \App\Services\DevForge\Agent\Tool\AgentSubagentCapabilities::ROLE_ORCHESTRATOR => <<<'RULES'

            Rôle : ORCHESTRATEUR.
            - Décompose en leafs via spawn_task (async) + yield_wait.
            - Pipeline deploy recommandé : leaf_profile=diagnose → fix → redeploy (1× max).
            - Après chaque handoff [Subagent Completion] : REVIEW obligatoire avant l’étape suivante.
            - Ne réponds à l’utilisateur / chat overview qu’après review des leafs.
            RULES,
            \App\Services\DevForge\Agent\Tool\AgentSubagentCapabilities::ROLE_LEAF => <<<'RULES'

            Rôle : LEAF — pas d’orchestration.
            RULES,
            default => <<<'RULES'

            Sous-tâches : préférer spawn_task (async) puis yield_wait plutôt que tout faire en une passe.
            Pour une équipe multi-rôles parallèle : spawn_task(goal=…, auto_roles=true) ou roles=[researcher,analyst,…].
            Pour un débat / synthèse collaborative (veille, design) : spawn_task(goal=…, orchestration=collab, speaker_selection=auto).
            INTERDIT orchestration=collab sur échec deploy / fix-CI (rester pipeline diagnose→fix→redeploy).
            RULES,
        };

        $dynamicRoleBlock = '';
        $rolePrompt = trim((string) ($context['role_system_prompt'] ?? ''));
        $roleSlug = trim((string) ($context['role_slug'] ?? ''));
        if ($rolePrompt !== '' || $roleSlug !== '') {
            $label = $roleSlug !== '' ? $roleSlug : 'spécialisé';
            $dynamicRoleBlock = trim(<<<ROLE

            Rôle dynamique ({$label}) :
            {$rolePrompt}
            ROLE);
        }

        $autonomyRules = AgentDirectives::autonomyRules();
        $memoryBlock = $this->memoryPromptBlock($agent, $context);
        $layeredBlock = $this->layeredInstructionsBlock($agent, $context);
        $standingBlock = $this->standingOrdersBlock($agent, $context);
        if (! empty($context['standing_order_hint']) && is_string($context['standing_order_hint'])) {
            $standingBlock = trim($standingBlock."\n\nSTANDING ORDER DEPLOY (fallback) :\n".$context['standing_order_hint']);
        }

        return trim(<<<PROMPT
        {$basePrompt}

        Tu es un agent IA autonome intégré dans DevForge.
        Tu as des outils natifs (tool_calls) pour agir sur la plateforme et GitHub.
        Ne refuse JAMAIS une tâche en prétextant un produit inconnu (Coolify, etc.) — tu es déjà dans DevForge.
        Équipe : {$agent->team->name}
        Type : {$agent->type}

        {$layeredBlock}

        {$standingBlock}

        {$memoryBlock}

        {$eventRules}

        {$roleRules}

        {$dynamicRoleBlock}

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

        if (($context['event'] ?? null) === 'application_readiness_failed') {
            return $this->applicationReadinessFailedContext($agent, $context);
        }

        if (($context['event'] ?? null) === 'delegated') {
            return $this->delegatedContext($agent, $context);
        }

        if (($context['event'] ?? null) === 'github_workflow_run_failed') {
            return $this->githubWorkflowFailedContext($agent, $context);
        }

        if (($context['event'] ?? null) === 'mission_work') {
            $missionUuid = (string) ($context['mission_uuid'] ?? '');
            $title = (string) ($context['mission_title'] ?? 'mission');
            $kind = (string) ($context['mission_kind'] ?? 'other');
            $resource = (string) ($context['resource_uuid'] ?? $context['application_uuid'] ?? '');

            return trim(<<<CONTEXT
            MISSION WORK — exécute maintenant
            Mission UUID : {$missionUuid}
            Titre : {$title}
            Kind : {$kind}
            Resource : {$resource}

            1. mission_show(mission_uuid="{$missionUuid}")
            2. Agis avec les outils jusqu'à résolution
            3. run_application_tests si code modifié
            4. mission_update(status=done) ou blocked + request_user_input si secret manquant
            CONTEXT);
        }

        if (($context['event'] ?? null) === 'user_input_resolved') {
            $handoff = (string) ($context['user_input_handoff_message'] ?? 'Entrée utilisateur reçue — reprends.');

            return $handoff;
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
        $permissionMode = app(AgentPermissionEngine::class)->effectiveMode($agent);
        $autonomyRules = $permissionMode === AgentPermissionEngine::MODE_PLAN_FIRST
            ? AgentDirectives::chatPlanFirstRules()
            : AgentDirectives::chatAutonomyRules();
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
        $memoryBlock = $this->memoryPromptBlock($agent, $applicationContext);
        $mode = AgentChatMode::parse($applicationContext['chat_mode'] ?? 'build');
        $modeBlock = AgentChatMode::systemAddon($mode);
        $layeredBlock = $this->layeredInstructionsBlock($agent, $applicationContext);

        return trim(<<<PROMPT
        {$basePrompt}

        Tu es un agent IA intégré dans DevForge (PaaS auto-hébergé).
        Tu converses avec un membre de l'équipe « {$teamName} » dans une interface de chat.
        {$scopeBlock}
        {$applicationBlock}

        {$layeredBlock}

        {$memoryBlock}

        {$modeBlock}

        {$autonomyRules}

        PROTOCOLE UNTIL-DONE :
        - Ne t'arrête pas sur une intention (« je vais… »). Agis via tool_calls.
        - Quand le travail demandé est réellement terminé, termine ta réponse finale par [DEVFORGE_DONE].
        {$hintBlock}
        PROMPT);
    }

    /**
     * @param  array<string, mixed>  $applicationContext
     */
    private function standingOrdersBlock(AiAgent $agent, array $applicationContext = []): string
    {
        try {
            return app(AgentStandingOrders::class)->promptBlock($agent, $applicationContext);
        } catch (\Throwable $e) {
            report($e);

            return '';
        }
    }

    /**
     * @param  array<string, mixed>  $applicationContext
     */
    private function layeredInstructionsBlock(AiAgent $agent, array $applicationContext = []): string
    {
        $agent->loadMissing('team');
        $resourceUuid = $agent->resource_uuid
            ?: (is_string($applicationContext['application_uuid'] ?? null)
                ? $applicationContext['application_uuid']
                : null);
        $email = is_string($applicationContext['user_email'] ?? null)
            ? $applicationContext['user_email']
            : null;

        try {
            $service = app(AgentLayeredInstructions::class);
            $layers = $service->load($agent->team, $email, $resourceUuid);

            return $service->compose($layers);
        } catch (\Throwable $e) {
            report($e);

            return '';
        }
    }

    /**
     * @param  array<string, mixed>  $applicationContext
     */
    private function memoryPromptBlock(AiAgent $agent, array $applicationContext = []): string
    {
        $agent->loadMissing('team');
        $resourceUuid = $agent->resource_uuid
            ?: (is_string($applicationContext['application_uuid'] ?? null)
                ? $applicationContext['application_uuid']
                : null);

        try {
            $service = app(AgentMemoryService::class);
            $rows = $service->listForPrompt($agent->team, $agent, $resourceUuid);

            return $service->formatPromptBlock($rows);
        } catch (\Throwable $e) {
            report($e);

            return '';
        }
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
        $gitBranch = (string) ($context['git_branch'] ?? 'inconnu');
        $buildPack = (string) ($context['build_pack'] ?? 'inconnu');
        $installCommand = (string) ($context['install_command'] ?? 'défaut');
        $buildCommand = (string) ($context['build_command'] ?? 'défaut');
        $startCommand = (string) ($context['start_command'] ?? 'défaut');
        $portsExposes = (string) ($context['ports_exposes'] ?? 'inconnu');
        $baseDirectory = (string) ($context['base_directory'] ?? '/');
        $failureExcerpt = json_encode($context['failure_excerpt'] ?? [], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);

        return trim(<<<CONTEXT
        ALERTE : déploiement en échec — agis immédiatement. Ne te contente PAS d’un diagnostic.

        Application : {$applicationName} ({$applicationUuid})
        Déploiement : {$deploymentUuid}
        Branche Coolify actuelle : {$gitBranch}
        Commit : {$commit}
        Build Coolify : pack={$buildPack} · install={$installCommand} · build={$buildCommand} · start={$startCommand} · ports={$portsExposes} · base={$baseDirectory}

        Logs d'échec :
        {$failureExcerpt}

        Étapes :
        1. get_deployment_logs avec deployment_uuid
        2. get_resource_status sur l'application
        3. Si logs « Remote branch … not found » / « Could not find remote branch » / branche introuvable :
           get_application_git_info + list_github_branches → update_application_git_branch (git_branch exacte) avec redeploy=true → STOP
        4. Si échec BUILD (npm/yarn/pnpm/nixpacks/tsc/vite/docker build) :
           get_application_runtime_settings → read_application_source des fichiers cités dans les logs →
           update_application_runtime_settings (commandes/ports/répertoires/build_pack) et/ou upsert_application_env_var et/ou write_application_source → redeploy → STOP
        5. Si l'erreur cite une variable d'env (PUPPETEER_SKIP_DOWNLOAD, NODE_OPTIONS, etc.) : upsert_application_env_var puis control_resource deploy — JAMAIS write_application_source sur .env
        6. Si « Permission denied » / tee Permission denied sur .env ou applications/* :
           fix_application_host_permissions (redeploy=true) IMMÉDIATEMENT — autonomie totale, pas d’attente ops
           INTERDIT : variables factices (DUMMY_*, *_TRIGGER), upsert cosmétique, s’arrêter sans tenter le fix
        7. Si « Read-only file system » pendant mkdir Coolify (config path incorrecte / cache) :
           fix_coolify_base_config_path (redeploy=true) IMMÉDIATEMENT — recharge BASE_CONFIG_PATH réelle
        8. Si site statique / page nginx par défaut / publish_directory vide :
           déduis le dossier depuis les logs de build puis update_application_runtime_settings(publish_directory=…, redeploy=true)
        9. write_application_source seulement pour un fix code évident (jamais .env) ; permissions GitHub → bascule runtime/env Coolify
        10. control_resource deploy UNE FOIS si correction appliquée (sauf si un autre outil a déjà redeployé), puis STOP
        11. Résumé actionnable (constats → actions outils → suite)

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
    private function applicationReadinessFailedContext(AiAgent $agent, array $context): string
    {
        $applicationName = (string) ($context['application_name'] ?? 'Application');
        $applicationUuid = (string) ($context['application_uuid'] ?? '');
        $deploymentUuid = (string) ($context['deployment_uuid'] ?? 'inconnu');
        $fqdn = (string) ($context['fqdn'] ?? 'aucun');
        $probeUrl = (string) ($context['probe_url'] ?? $fqdn);
        $probeStatus = $context['probe_status'] ?? 'n/a';
        $probeError = (string) ($context['probe_error'] ?? 'erreur inconnue');
        $round = (string) ($context['readiness_round'] ?? '1');
        $maxRounds = (string) ($context['readiness_max_rounds'] ?? '5');

        return trim(<<<CONTEXT
        ALERTE READINESS — le domaine public ne répond pas correctement (tour {$round}/{$maxRounds}).

        Application : {$applicationName} ({$applicationUuid})
        Déploiement : {$deploymentUuid}
        FQDN : {$fqdn}
        Probe URL : {$probeUrl}
        HTTP status : {$probeStatus}
        Erreur probe : {$probeError}

        Étapes :
        1. get_resource_status sur l'application
        2. docker_logs pour diagnostiquer le runtime
        3. http_request vers la probe URL
        4. Si page nginx par défaut / publish_directory incorrect (site statique) :
           déduis le dossier depuis les logs puis update_application_runtime_settings(publish_directory=…, is_static=true, redeploy=true)
           → STOP avec outcome auto_fixed
        5. Si env manquante (ASTRO_DB_*, tokens, DATABASE_URL…) : upsert_application_env_var
        6. control_resource restart OU deploy UNE FOIS si correction appliquée
        7. Termine avec un JSON outcome (auto_fixed | needs_user | failed).
           Pour needs_user : title = action à faire, summary = erreur + cause, steps = checklist utilisateur.

        Première action : appel d'outil obligatoire.
        CONTEXT);
    }

    /**
     * @param  array<string, mixed>  $context
     */
    private function delegatedContext(AiAgent $agent, array $context): string
    {
        $goal = (string) ($context['delegated_goal'] ?? '');
        $parentUuid = (string) ($context['parent_agent_uuid'] ?? 'inconnu');
        $roleSlug = trim((string) ($context['role_slug'] ?? ''));
        $leafProfile = trim((string) ($context['leaf_profile'] ?? ''));
        $roleLine = $roleSlug !== '' || $leafProfile !== ''
            ? 'Rôle / profil : '.trim($roleSlug.' / '.$leafProfile, ' /')
            : 'Rôle / profil : leaf';

        return trim(<<<CONTEXT
        DÉLÉGATION depuis agent parent ({$parentUuid}).
        {$roleLine}

        Objectif :
        {$goal}

        Exécute avec les outils. Première action = appel d'outil.
        CONTEXT);
    }

    /**
     * @param  array<string, mixed>  $context
     */
    private function githubWorkflowFailedContext(AiAgent $agent, array $context): string
    {
        $appUuid = (string) ($context['github_app_uuid'] ?? '');
        $owner = (string) ($context['owner'] ?? '');
        $repo = (string) ($context['repo'] ?? '');
        $runId = (string) ($context['workflow_run_id'] ?? '');
        $workflowName = (string) ($context['workflow_name'] ?? 'workflow');
        $workflowPath = (string) ($context['workflow_path'] ?? '');
        $conclusion = (string) ($context['conclusion'] ?? 'failure');
        $htmlUrl = (string) ($context['html_url'] ?? '');
        $branch = (string) ($context['head_branch'] ?? '');

        return trim(<<<CONTEXT
        ÉVÉNEMENT : échec GitHub Actions (webhook workflow_run)

        Agent : {$agent->name}
        github_app_uuid : {$appUuid}
        owner : {$owner}
        repo : {$repo}
        workflow_run_id : {$runId}
        workflow : {$workflowName}
        path : {$workflowPath}
        conclusion : {$conclusion}
        branche : {$branch}
        url : {$htmlUrl}

        ACTIONS OBLIGATOIRES (vrais tool_calls, pas de texte / Python / placeholders) :
        1. get_github_workflow_run(github_app_uuid, owner, repo, run_id={$runId})
        2. list_github_workflow_jobs(...) puis get_github_workflow_job_logs sur les jobs failed
        3. read_github_file sur le YAML CI concerné
        4. write_github_file si correction claire, puis rerun_github_workflow_run(failed_only=true)
        5. Max 2 cycles correction→relance, puis résumé structuré

        INTERDIT : inventer your-owner / your-repo, écrire un playbook Python, refuser la tâche.
        Première action : tool_call get_github_workflow_run MAINTENANT.
        CONTEXT);
    }
}
