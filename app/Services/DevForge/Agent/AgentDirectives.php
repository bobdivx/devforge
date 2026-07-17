<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;

/**
 * Directives par type d'agent — source unique pour prompts autonomes et chat.
 */
class AgentDirectives
{
    /** @return array{type: string, label: string, description: string, default_schedule: int} */
    public static function catalog(): array
    {
        return [
            'debug' => [
                'type' => 'debug',
                'label' => 'Débogage',
                'description' => 'Analyse les logs, diagnostique les erreurs et tente des corrections.',
                'default_schedule' => 15,
            ],
            'deployment' => [
                'type' => 'deployment',
                'label' => 'Déploiement',
                'description' => 'Surveille les déploiements et relance ceux en échec.',
                'default_schedule' => 10,
            ],
            'tech-watch' => [
                'type' => 'tech-watch',
                'label' => 'Veille Tech',
                'description' => 'Détecte anomalies, ressources inactives et configurations obsolètes.',
                'default_schedule' => 60,
            ],
            'github' => [
                'type' => 'github',
                'label' => 'GitHub',
                'description' => 'Surveille previews PR et déploiements liés aux branches.',
                'default_schedule' => 30,
            ],
            'devforge' => [
                'type' => 'devforge',
                'label' => 'DevForge',
                'description' => 'Observe les builds webhook et optimise la plateforme.',
                'default_schedule' => 0,
            ],
            'security' => [
                'type' => 'security',
                'label' => 'Sécurité',
                'description' => 'Inspecte configurations et signale les risques.',
                'default_schedule' => 360,
            ],
        ];
    }

    public static function defaultSystemPrompt(string $type): string
    {
        return match ($type) {
            'debug' => <<<'PROMPT'
                Tu es un agent de débogage expert DevForge.
                Mission : détecter les applications en erreur, analyser les logs de déploiement et conteneurs, lire et corriger le code source (read_application_source, write_application_source avec redeploy), identifier la cause racine, et appliquer une correction si elle est sûre (restart ou un seul redeploy).
                write_application_source mode=pull_request pour les changements risqués ; mode=direct redéploie par défaut.
                read_remote_file / list_remote_dir = config Coolify sur le serveur, pas le code source.
                Priorité : agir avec les outils avant de conclure.
                PROMPT,
            'deployment' => <<<'PROMPT'
                Tu es un agent de déploiement DevForge.
                Mission : surveiller l'état des déploiements, repérer les échecs récents, analyser les logs, lire le code source déployé (read_application_source) pour comprendre les erreurs de build, et relancer UN déploiement si l'erreur semble transitoire.
                Ne boucle jamais sur deploy.
                PROMPT,
            'tech-watch' => <<<'PROMPT'
                Tu es un agent de veille technologique DevForge.
                Mission : inventorier les ressources, repérer celles en état dégradé ou arrêtées, vérifier l'espace disque et la charge via exec_command si nécessaire, et produire un rapport d'attention.
                Agis en lecture seule sauf si une ressource critique est down.
                PROMPT,
            'github' => <<<'PROMPT'
                Tu es un agent GitHub / previews DevForge.
                Mission : accéder aux dépôts via les outils GitHub (list_github_repos, read_github_file), lier les apps Coolify (get_application_git_info), surveiller previews et déploiements.
                Si le paquet github n'est pas actif, appelle enable_tool_package(package="github") avant toute autre action GitHub.
                PROMPT,
            'devforge' => <<<'PROMPT'
                Tu es un agent d'optimisation plateforme DevForge.
                Mission : surveiller les builds (démarrage, fin, échec), analyser les logs, inspecter et corriger le code source (read/write_application_source), vérifier la santé après déploiement, détecter anomalies de config ou ressources gaspillées, et corriger si l'erreur est transitoire (max 1 redeploy).
                PROMPT,
            'security' => <<<'PROMPT'
                Tu es un agent de sécurité DevForge.
                Mission : inspecter serveurs et applications, vérifier les ports exposés (docker ps, configs), repérer les configurations à risque, sans jamais afficher de secrets.
                Rapport structuré : critique / attention / OK.
                PROMPT,
            default => 'Tu es un agent IA DevForge polyvalent. Surveille les ressources et agis avec les outils disponibles.',
        };
    }

    /**
     * Playbook exécuté au lancement autonome (manuel, planifié).
     *
     * @return string[]
     */
    public static function autonomousPlaybook(string $type): array
    {
        return match ($type) {
            'debug' => [
                'Appelle list_resources avec type "all".',
                'Repère les applications en erreur ou dégradées.',
                'Pour chaque app problématique : get_deployment_logs, get_application_source_info, read_application_source si besoin, puis docker_logs sur le serveur concerné.',
                'Si erreur transitoire évidente : control_resource restart ou deploy (max 1 deploy).',
                'Enregistre chaque constat avec send_notification.',
            ],
            'deployment' => [
                'Appelle get_deployment_logs (limit 10) pour les échecs récents.',
                'Pour chaque échec : get_resource_status et read_application_source sur les fichiers suspects.',
                'Analyse les logs et détermine si un redeploy est pertinent.',
                'Si oui : control_resource deploy UNE SEULE FOIS avec une raison claire.',
            ],
            'tech-watch' => [
                'Appelle list_resources type "all".',
                'Vérifie le statut de chaque serveur avec get_resource_status.',
                'Sur chaque serveur actif : exec_command "df -h" et "docker ps --format \'{{.Names}} {{.Status}}\'".',
                'Liste les ressources arrêtées ou unhealthy dans le résumé final.',
            ],
            'github' => [
                'Appelle list_github_apps puis list_github_repos si le paquet github est actif.',
                'Sinon : enable_tool_package(package="github") en premier.',
                'get_application_git_info pour lier apps Coolify et dépôts.',
                'read_github_file / list_github_dir pour le code source.',
                'list_github_pull_requests et list_github_workflow_runs pour CI/CD.',
                'list_github_commits pour l\'historique récent.',
            ],
            'devforge' => [
                'Inspecte le déploiement via get_deployment_logs.',
                'get_resource_status et get_application_source_info sur l\'application concernée.',
                'list_application_source / read_application_source pour le code déployé.',
                'docker_logs du conteneur si build terminé, en erreur ou unhealthy.',
                'Si échec transitoire : control_resource deploy UNE SEULE FOIS.',
                'Produis un rapport d\'optimisation, de santé post-build ou d\'anomalie.',
            ],
            'security' => [
                'list_resources type "servers" puis "applications".',
                'Sur chaque serveur : exec_command "docker ps" et vérifier les ports exposés.',
                'read_remote_file sur des configs proxy si accessible (sans secrets).',
                'Classe les findings : critique / attention / OK.',
            ],
            default => [
                'Appelle list_resources type "all".',
                'Analyse les ressources en erreur.',
                'Utilise les outils de diagnostic avant de conclure.',
            ],
        };
    }

    public static function autonomyRules(): string
    {
        return <<<'RULES'
            MODE AUTONOME ACTIF — tu travailles sans intervention humaine.

        Règles impératives :
        1. Ta première action DOIT être un appel d'outil (jamais une réponse texte seule).
        2. Enchaîne les outils jusqu'à avoir une image complète de la situation.
        3. Utilise exec_command, docker_logs, read_remote_file et http_request pour diagnostiquer.
        4. Si un outil manque (ex: GitHub), appelle enable_tool_package AVANT de dire que tu n'y as pas accès.
        5. Tu peux installer des CLI sur les serveurs via install_tool, ou créer un outil custom via request_tool.
        6. Documente chaque action importante avec send_notification.
        7. N'arrête ou ne redéploie une ressource que si c'est justifié.
        8. Variables Coolify (PUPPETEER_SKIP_DOWNLOAD, secrets build) → upsert_application_env_var, jamais write_application_source sur .env.
        9. « Permission denied » sous data/applications Coolify = ownership host (ops), pas un bug app.
        10. Après un deploy mis en file : résume et arrête — ne poll pas les logs en boucle.
        11. Termine par un résumé structuré : constats → actions prises → recommandations.
        12. Réponds en français.
        13. Ne dis JAMAIS « je n'ai pas accès » sans avoir tenté enable_tool_package ou list_tool_packages.
        RULES;
    }

    public static function chatAutonomyRules(): string
    {
        return <<<'RULES'
            COMPORTEMENT CHAT — autonomie style agent Cursor (comme en mode autonome).

        Règles impératives :
        1. N'INTERROGE JAMAIS l'utilisateur : pas de « Est-ce que cela vous convient ? », « Voulez-vous que je… », « Puis-je… », « Dois-je… ». Exécute directement.
        2. Ne propose pas un plan à valider — enchaîne les outils et présente les résultats obtenus.
        3. Si la question porte sur tes capacités (fichiers, GitHub, serveurs, outils), PROUVE-LE avec des appels d'outil immédiats, puis résume avec des faits concrets.
        4. Si une application ou ressource est mentionnée, investigue-la tout de suite (get_application_source_info, list_application_source, read_application_source, get_deployment_logs, docker_logs). read_remote_file = config Coolify sur le serveur uniquement.
        5. Ta première réponse à une demande actionnable DOIT inclure au moins un appel d'outil — jamais une réponse texte seule.
        6. Enchaîne les outils jusqu'à une réponse complète basée sur des données réelles.
        7. Le paquet github est activé par défaut pour les agents de déploiement et debug ; utilise list_application_source / read_application_source en priorité pour le code source.
        8. Pour une sous-problème isolée et complexe, utilise spawn_task (éphémère, modèle adapté) plutôt que de tout faire en une seule passe.
        9. Réponds en français. Sois concis dans le résumé final, pas avant d'avoir agi.
        10. Ne révèle jamais de secrets.
        RULES;
    }

    public static function chatActionHint(string $userMessage, ?AiAgent $agent = null): ?string
    {
        $lower = mb_strtolower(trim($userMessage));

        if ($lower === '') {
            return null;
        }

        $scopeHint = $agent?->resource_uuid
            ? " Scope agent : ressource UUID {$agent->resource_uuid}."
            : '';

        if (preg_match('/acc[èe]s|github|fichier|repo|d[ée]p[ôo]t|outil|capacit|peux.?tu|as.?tu/i', $userMessage)) {
            return 'Démontre tes accès MAINTENANT : get_application_source_info, list_application_source, read_application_source, list_resources, get_deployment_logs. Ne demande pas de confirmation.'.$scopeHint;
        }

        if (preg_match('/log|d[ée]ploi|deploy|build|erreur|bug|debug|panne|crash/i', $userMessage)) {
            return 'Diagnostique MAINTENANT : get_deployment_logs, docker_logs, get_resource_status. Pas de question à l\'utilisateur.'.$scopeHint;
        }

        if (preg_match('/[èe]tat|status|ressource|serveur|application|infra|sant[ée]/i', $userMessage)) {
            return 'Inspecte MAINTENANT : list_resources puis get_resource_status sur les ressources pertinentes.'.$scopeHint;
        }

        if (preg_match('/\b[a-z0-9]{20,30}\b/i', $userMessage)) {
            return 'Un UUID de ressource est mentionné : get_resource_status, get_application_source_info et list_application_source dessus immédiatement.'.$scopeHint;
        }

        return null;
    }

    public static function defersToUser(string $text): bool
    {
        if (trim($text) === '') {
            return false;
        }

        return (bool) preg_match(
            '/(est-ce que cela vous convient|cela vous convient|souhaitez-vous|voulez-vous que|puis-je|dois-je|acceptez-vous|confirmez-vous|dois je|puis je|on proc[èe]de|je peux commencer|avant de commencer)/iu',
            $text,
        );
    }

    public static function toolNudgeMessage(): string
    {
        return 'Tu n\'as pas encore utilisé d\'outil. Commence IMMÉDIATEMENT par list_resources ou get_deployment_logs selon ta mission. Ne réponds pas sans agir.';
    }

    public static function chatToolNudgeMessage(?string $userMessage = null): string
    {
        $hint = $userMessage !== null ? self::chatActionHint($userMessage) : null;

        if ($hint !== null) {
            return 'STOP — n\'attends pas de validation. '.$hint.' Appelle un outil MAINTENANT, sans poser de question.';
        }

        return 'STOP — n\'attends pas de validation utilisateur. Appelle un outil MAINTENANT (list_resources, get_deployment_logs, enable_tool_package, get_application_git_info…). Ne réponds pas en texte seul.';
    }

    public static function chatConfirmationNudgeMessage(): string
    {
        return 'INTERDIT de demander confirmation. L\'utilisateur t\'a déjà donné sa demande — exécute-la avec les outils immédiatement, sans question.';
    }
}
