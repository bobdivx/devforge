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
            - PROCÉDURE : skill_load('fix-deploy-failed') — boucle opérateur (observe → hypothèse → action → remesure).
            - Tu es un OPÉRATEUR : ne devine pas 4 causes. Mesure, change une chose, remesure.
            - Source de vérité = outils (logs, settings, status). Jamais inventer UUID/commit/logs.
            - Tu es ORCHESTRATEUR : pipeline obligé diagnose → fix → redeploy (1×).
            - Étape 1 : spawn_task(goal=…, leaf_profile=diagnose) puis yield_wait. REVIEW le handoff.
            - Étape 2 : spawn_task(goal=…, leaf_profile=fix) puis yield_wait. REVIEW le handoff.
            - Étape 3 : spawn_task(goal=…, leaf_profile=redeploy) puis yield_wait — un seul redeploy max.
            - INTERDIT de skipper la review entre étapes.
            - INTERDIT de terminer en diagnostic seul si une correction outil est possible.
            - Si clone Git échoue (Remote branch not found / Could not find remote branch) : get_application_git_info + list_github_branches puis update_application_git_branch (redeploy=true) via leaf fix.
            - Échec de BUILD (nixpacks/npm/yarn/pnpm/tsc/vite/dockerfile) :
              1) get_application_runtime_settings + read_application_source (package.json, Dockerfile, nixpacks.toml…)
              2) Corrige côté DevForge via update_application_runtime_settings (install_command, build_command, start_command, ports_exposes, base_directory, publish_directory, build_pack) si la config DevForge est en cause
              3) Ou upsert_application_env_var pour variables de build (PUPPETEER_SKIP_DOWNLOAD, NODE_OPTIONS, NODE_ENV…)
              4) Ou write_application_source pour un fix code évident (package.json scripts, Dockerfile) — jamais .env
              5) Puis redeploy (1 fois) via l’outil qui a corrigé ou control_resource deploy
            - Si write_application_source échoue (GitHub permissions) : bascule sur update_application_runtime_settings / upsert_application_env_var — ne redéploie pas sans correction.
            - « Permission denied » / « tee: … Permission denied » lors de l’écriture .env / applications/* :
              CORRIGE en autonomie avec fix_application_host_permissions (chown/chmod ciblé + redeploy).
              INTERDIT d’inventer une variable env factice (DUMMY_*, *_TRIGGER, FORCE_REDEPLOY…).
              INTERDIT de s’arrêter sur « intervention manuelle ops » sans avoir tenté fix_application_host_permissions.
            - « Read-only file system » pendant un mkdir DevForge (chemin hôte incorrect ou config cache) :
              CORRIGE avec fix_coolify_base_config_path (recharge BASE_CONFIG_PATH via config:clear + horizon:terminate + redeploy).
              Ne suppose pas un chemin NAS particulier — l’outil lit la config réelle.
            - Site statique qui sert la page nginx par défaut / publish_directory vide :
              Déduis le dossier de build depuis les logs (directory: /app/…, astro/vite/next) puis
              update_application_runtime_settings(publish_directory=…, redeploy=true).
            - Conteneur unhealthy + « Cannot find module … dist/server/entry.mjs » (Astro a build en static) :
              update_application_runtime_settings(is_static=true, start_command='', publish_directory=/dist, ports_exposes=80, health_check_port=80, redeploy=true)
              IMMÉDIATEMENT — ne pas relancer node ./dist/server/entry.mjs.
            - Conteneur unhealthy + « Healthcheck URL … :3000 » alors que les logs disent « listening on … :4321 » :
              update_application_runtime_settings(ports_exposes=4321, health_check_port=4321, redeploy=true)
              et upsert_application_env_var PORT=4321 (runtime). Astro SSR écoute souvent 4321, pas 3000.
              Puis sync_application_proxy_labels si les labels Traefik restent sur port 80.
            - HTTP 502 / Bad Gateway / Host Error (Cloudflare) alors que le conteneur est healthy :
              sync_application_proxy_labels (régénère Traefik loadbalancer.port depuis ports_exposes) puis redeploy.
              Cause typique : custom_labels figés sur port=80 alors que ports_exposes=4321.
            - npm E401 / unauthenticated sur npm.pkg.github.com :
              DevForge injecte NODE_AUTH_TOKEN au build via PAT enregistré (Connexions → token Packages)
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
            - Si workflow=feature_delivery (ou force_pull_request) :
              * TOUJOURS write_application_source mode=pull_request (jamais commit direct sur main).
              * Après la PR : get_application_preview pour récupérer l’URL preview DevForge.
              * INTERDIT merge_pull_request / merge GitHub — l’humain valide via l’UI « Valider & merger ».
              * Quand la PR est prête : mission_update(status=blocked, blocked_reason=« En attente de validation preview »).
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
            'deploy_graft_all_repos' => <<<'RULES'

            Contexte : Déploiement automatique de Graft sur tous les repos de l'équipe.
            - Utilise le skill `deploy-graft-all-repos`.
            - Pour chaque repo de l'équipe : vérifie package.json, configure .mcp.json, .gitignore et GRAFT.md.
            - Utilise write_github_file / read_github_file.
            - Fournis un résumé clair à la fin avec le nombre de repos configurés / PRs créées / erreurs.
            RULES,
            default => '',
        };
