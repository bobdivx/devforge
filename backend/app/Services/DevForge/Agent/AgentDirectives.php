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
            'github-actions' => [
                'type' => 'github-actions',
                'label' => 'GitHub Actions',
                'description' => 'Réagit aux échecs de workflows CI (webhook workflow_run), lit les logs, corrige les YAML et relance.',
                'default_schedule' => 0,
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
                Mission : accéder aux dépôts via les outils GitHub (list_github_repos, read_github_file), lier les apps DevForge (get_application_git_info), surveiller previews et déploiements.
                Si le paquet github n'est pas actif, appelle enable_tool_package(package="github") avant toute autre action GitHub.
                Émets de VRAIS tool_calls — jamais de Python ni de refus.
                PROMPT,
            'github-actions' => <<<'PROMPT'
                Tu es un agent GitHub Actions / CI DevForge.
                Mission : diagnostiquer les échecs CI, lire les logs jobs, corriger .github/workflows via write_github_file, relancer avec rerun_github_workflow_run(failed_only=true).
                Boucle max : 2 cycles correction→relance ; ensuite résumé et stop.
                Ne modifie que les YAML CI / actions — pas le code métier sauf preuve claire.
                Si le paquet github n'est pas actif : enable_tool_package(package="github") en premier.
                INTERDIT : écrire du Python, inventer des placeholders (your-owner…), refuser en citant Coolify ou un produit inconnu.
                Ta première sortie DOIT être un tool_call natif (list_github_apps ou get_github_workflow_run).
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
                'get_application_git_info pour lier apps DevForge et dépôts.',
                'read_github_file / list_github_dir pour le code source.',
                'list_github_pull_requests et list_github_workflow_runs pour CI/CD.',
                'list_github_commits pour l\'historique récent.',
            ],
            'github-actions' => [
                'PREMIER tool_call obligatoire : list_github_apps (ou get_github_workflow_run si workflow_run_id est dans le contexte).',
                'Puis list_github_repos et list_github_workflow_runs(conclusion=failure) si lancement manuel.',
                'Sur chaque échec : list_github_workflow_jobs + get_github_workflow_job_logs.',
                'read_github_file sur .github/workflows/*.yml, corrige via write_github_file si clair.',
                'rerun_github_workflow_run(failed_only=true), max 2 cycles, puis résumé.',
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
        9. « Permission denied » sur écriture .env / applications/* = fix_application_host_permissions (autonomie),
           jamais de DUMMY_* / *_TRIGGER. Si l’outil échoue, documente l’erreur SSH concrète.
        10. « Read-only file system » pendant mkdir d’une app Coolify = fix_coolify_base_config_path
            (recharge la config BASE_CONFIG_PATH réelle — ne suppose pas un chemin hôte).
        11. Site statique qui sert la page nginx par défaut / publish_directory vide :
            déduis le dossier depuis les logs de build (get_deployment_logs / get_application_runtime_settings)
            puis update_application_runtime_settings(publish_directory=…, redeploy=true).
        12. Après un deploy mis en file : résume et arrête — ne poll pas les logs en boucle.
        13. Termine par un résumé structuré : constats → actions prises → recommandations.
        14. Réponds en français.
        15. Ne dis JAMAIS « je n'ai pas accès » sans avoir tenté enable_tool_package, list_tool_packages, fix_application_host_permissions ou fix_coolify_base_config_path.
        16. INTERDIT de refuser la tâche en citant Coolify ou un « produit non renseigné » — tu es dans DevForge avec des outils réels.
        17. INTERDIT d'écrire du Python, du pseudo-code ou des playbooks texte : émets uniquement des tool_calls natifs.
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
        6. INTERDIT de décrire un outil en prose ou JSON (`{"method":"spawn_task"...}`) : émets un vrai tool_call.
           L’UI affiche automatiquement une carte Actions — ne réécris pas la commande pour l’utilisateur.
        7. Enchaîne les outils jusqu'à une réponse complète basée sur des données réelles.
        8. Le paquet github est activé par défaut pour les agents de déploiement et debug ; utilise list_application_source / read_application_source en priorité pour le code source.
        9. Pour une sous-problème isolée et complexe, utilise spawn_task (async) puis yield_wait ; review le handoff avant de répondre à l’utilisateur.
        10. Réponds en français. Sois concis dans le résumé final, pas avant d'avoir agi.
        11. Ne révèle jamais de secrets.
        RULES;
    }

    public static function chatPlanFirstRules(): string
    {
        return <<<'RULES'
            MODE PLAN-FIRST (style Grok Build) — diagnostique librement, modifie seulement après plan approuvé.

        Règles impératives :
        1. Tu peux lire librement : logs, source, status, métriques, GitHub, etc.
        2. Avant toute modification (deploy, write, env, exec destructif, fix permissions…), appelle propose_plan
           avec title, summary et steps concrets (action + outil prévu + risk).
        3. Après propose_plan, ARRÊTE — n’enchaîne pas d’outils mutateurs dans le même tour.
        4. Une fois le plan approuvé par l’utilisateur, exécute les steps avec de vrais tool_calls.
        5. INTERDIT de décrire un outil en prose : émets un vrai tool_call.
        6. Réponds en français. Ne révèle jamais de secrets.
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

        if (preg_match('/r[ée]par|fix|corrige|branche|git_branch|remote branch|spawn_task|red[ée]ploi|permission denied/i', $userMessage)) {
            return 'Agis MAINTENANT avec de VRAIS tool_calls (pas de JSON en texte) : get_deployment_logs, fix_application_host_permissions, update_application_git_branch, update_application_runtime_settings, control_resource, spawn_task.'.$scopeHint;
        }

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

    public static function isChatRepairIntent(string $userMessage): bool
    {
        $message = trim($userMessage);
        if ($message === '') {
            return false;
        }

        // Impératif / demande explicite de réparation ou redéploiement.
        if (preg_match('/\b(?:r[ée]par(?:e|er|é|ée|ation)?|fix(?:er)?|corrige(?:r)?|red[ée]ploi(?:e|er)?)\b/iu', $message) === 1) {
            return true;
        }

        // Problèmes host / permissions souvent collés tels quels depuis les logs.
        return (bool) preg_match('/permission\s+denied|\bchown\b|\bchmod\b|droits?\s+(?:host|fichier)/iu', $message);
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

    /**
     * Detects when the model writes about tools (or JSON tool payloads) instead of emitting tool_calls.
     */
    public static function mentionsToolWithoutCalling(?string $text): bool
    {
        if ($text === null || trim($text) === '') {
            return false;
        }

        $names = implode('|', array_map(
            static fn (string $name): string => preg_quote($name, '/'),
            self::chatKnownToolNames(),
        ));

        if (preg_match('/\b(?:'.$names.')\b/i', $text) === 1) {
            return true;
        }

        return (bool) preg_match(
            '/("method"\s*:\s*"(?:spawn_task|control_resource|update_application_git_branch|fix_application_host_permissions)")|```(?:json)?\s*\{[^}]*"(?:spawn_task|control_resource|method)"/iu',
            $text,
        );
    }

    /**
     * @return list<string>
     */
    public static function chatKnownToolNames(): array
    {
        return [
            'fix_application_host_permissions',
            'fix_coolify_base_config_path',
            'spawn_task',
            'control_resource',
            'update_application_git_branch',
            'upsert_application_env_var',
            'update_application_runtime_settings',
            'get_application_runtime_settings',
            'write_application_source',
            'get_deployment_logs',
            'list_resources',
            'get_resource_status',
            'list_github_branches',
            'list_github_apps',
            'list_github_repos',
            'list_github_workflow_runs',
            'get_github_workflow_run',
            'list_github_workflow_jobs',
            'get_github_workflow_job_logs',
            'rerun_github_workflow_run',
            'dispatch_github_workflow',
            'read_github_file',
            'write_github_file',
            'list_github_dir',
            'list_github_pull_requests',
            'list_github_commits',
            'get_application_git_info',
            'enable_tool_package',
            'delegate_task',
            'http_request',
            'docker_logs',
            'memory_read',
            'memory_write',
        ];
    }

    public static function isModelRefusal(?string $text): bool
    {
        if ($text === null || trim($text) === '') {
            return false;
        }

        return (bool) preg_match(
            '/je ne peux pas (?:poursuivre|continuer)|cannot (?:continue|proceed|help)|'
            .'n[\'’]est pas renseign|apparently\s+coolify|hors de (?:mon|ce) (?:champ|p[ée]rim[èe]tre)|'
            .'je (?:ne )?suis pas (?:en mesure|capable)|i (?:can\'t|cannot|am unable) (?:help|assist|continue)/iu',
            $text,
        );
    }

    public static function isHostPermissionDiagnosis(?string $text): bool
    {
        if ($text === null || trim($text) === '') {
            return false;
        }

        // Symptôme (permission) + cible typique Coolify (.env / tee / applications), sans path hôte figé.
        $hasPermissionSignal = (bool) preg_match(
            '/permission\s+denied|operation not permitted|tee:.*(?:denied|permission)|ownership|\bchown\b|\bchmod\b/iu',
            $text,
        );
        $hasCoolifyTarget = (bool) preg_match(
            '/\bapplications\/|\.env\b|(?:cr[ée]ation|écriture|ecriture).*\.env|\.env.*(?:permission|denied|échec|echec)/iu',
            $text,
        );

        // Diagnostic LLM sans recopier l’erreur OS : « problème de création/écriture .env ».
        $hasEnvWriteDiagnosis = (bool) preg_match(
            '/(?:cr[ée]ation|écriture|ecriture|owned?ership).*\.env|\.env.*(?:échec|echec|permission|denied)/iu',
            $text,
        );

        return ($hasPermissionSignal && $hasCoolifyTarget) || $hasEnvWriteDiagnosis;
    }

    /**
     * @param  array<int, mixed>  $failureExcerpt
     */
    public static function failureExcerptHasHostPermissionIssue(array $failureExcerpt): bool
    {
        return self::failureExcerptMatches($failureExcerpt, [self::class, 'isHostPermissionDiagnosis'])
            || self::failureExcerptContextMatches(
                $failureExcerpt,
                static fn (string $blob): bool => (bool) preg_match('/permission\s+denied|tee:.*permission/iu', $blob)
                    && (bool) preg_match('/\bapplications\/|\.env\b/iu', $blob),
            );
    }

    public static function isCoolifyBaseConfigPathIssue(?string $text): bool
    {
        if ($text === null || trim($text) === '') {
            return false;
        }

        // Symptôme FS en lecture seule lors d'un mkdir Coolify — le chemin exact varie (NAS, Docker, volume).
        $readOnly = (bool) preg_match('/read-only\s+file\s+system/iu', $text);
        $mkdir = (bool) preg_match('/\bmkdir\b|cannot create directory/iu', $text);
        $coolifyContext = (bool) preg_match('/\bcoolify\b|\bapplications\//iu', $text);

        return $readOnly && $mkdir && $coolifyContext;
    }

    /**
     * @param  array<int, mixed>  $failureExcerpt
     */
    public static function failureExcerptHasCoolifyBaseConfigPathIssue(array $failureExcerpt): bool
    {
        // Une ligne peut dire « Read-only », une autre « mkdir …/applications/… » — juger le blob entier.
        return self::failureExcerptContextMatches(
            $failureExcerpt,
            static function (string $blob): bool {
                $readOnly = (bool) preg_match('/read-only\s+file\s+system/iu', $blob);
                $mkdirOrCreate = (bool) preg_match('/\bmkdir\b|cannot create directory/iu', $blob);
                $coolifyContext = (bool) preg_match('/\bcoolify\b|\bapplications\//iu', $blob);

                return $readOnly && $mkdirOrCreate && $coolifyContext;
            },
        ) || self::failureExcerptMatches($failureExcerpt, [self::class, 'isCoolifyBaseConfigPathIssue']);
    }

    public static function isMissingStaticPublishDirectoryIssue(?string $text): bool
    {
        if ($text === null || trim($text) === '') {
            return false;
        }

        // Page d'accueil nginx stock / message probe — pas de chemin de build hardcodé.
        return (bool) preg_match(
            '/Welcome to nginx!|publish_directory probablement incorrect|Page nginx par d[ée]faut|nginx is successfully installed/iu',
            $text,
        );
    }

    /**
     * @param  array<int, mixed>  $failureExcerpt
     */
    public static function failureExcerptHasMissingStaticPublishDirectoryIssue(array $failureExcerpt): bool
    {
        return self::failureExcerptMatches($failureExcerpt, [self::class, 'isMissingStaticPublishDirectoryIssue']);
    }

    public static function isReadinessPlatformCrash(?string $text): bool
    {
        if ($text === null || trim($text) === '') {
            return false;
        }

        return (bool) preg_match(
            '/ApplicationReadiness(?:Service)?[^\n]{0,80}not found|Class\s+[^\n]{0,40}ApplicationReadiness/iu',
            $text,
        );
    }

    /**
     * @param  array<int, mixed>  $failureExcerpt
     */
    public static function failureExcerptHasReadinessPlatformCrash(array $failureExcerpt): bool
    {
        return self::failureExcerptMatches($failureExcerpt, [self::class, 'isReadinessPlatformCrash']);
    }

    public static function isInvalidChownGroupIssue(?string $text): bool
    {
        if ($text === null || trim($text) === '') {
            return false;
        }

        return (bool) preg_match('/chown:\s*invalid group:/iu', $text);
    }

    /**
     * @param  array<int, mixed>  $failureExcerpt
     */
    public static function failureExcerptHasInvalidChownGroupIssue(array $failureExcerpt): bool
    {
        return self::failureExcerptMatches($failureExcerpt, [self::class, 'isInvalidChownGroupIssue']);
    }

    public static function isNpmPrivateRegistryAuthIssue(?string $text): bool
    {
        if ($text === null || trim($text) === '') {
            return false;
        }

        $blob = mb_strtolower($text);

        $authFailure = str_contains($blob, 'npm error code e401')
            || str_contains($blob, '401 unauthorized')
            || str_contains($blob, 'unauthenticated: user cannot be authenticated')
            || (str_contains($blob, 'e401') && str_contains($blob, 'npm'));

        $privateRegistry = str_contains($blob, 'npm.pkg.github.com')
            || str_contains($blob, 'github.com/download/@')
            || str_contains($blob, 'pkgs.dev.azure.com')
            || str_contains($blob, 'registry.gitlab.com');

        return $authFailure && $privateRegistry;
    }

    /**
     * @param  array<int, mixed>  $failureExcerpt
     */
    public static function failureExcerptHasNpmPrivateRegistryAuthIssue(array $failureExcerpt): bool
    {
        return self::failureExcerptContextMatches(
            $failureExcerpt,
            static fn (string $blob): bool => self::isNpmPrivateRegistryAuthIssue($blob),
        ) || self::failureExcerptMatches($failureExcerpt, [self::class, 'isNpmPrivateRegistryAuthIssue']);
    }

    /**
     * Infer publish directory from build output (framework-agnostic), never assume a host path.
     *
     * @param  array<int, mixed>  $failureExcerpt
     */
    public static function inferStaticPublishDirectory(array $failureExcerpt = [], ?string $hint = null): ?string
    {
        $blob = $hint ?? '';
        foreach ($failureExcerpt as $line) {
            $blob .= "\n".(is_array($line) ? (string) ($line['message'] ?? '') : (is_string($line) ? $line : ''));
        }

        // Astro / Vite / Next export / generic "build directory: /app/<dir>"
        if (preg_match('/directory:\s*\/app\/([A-Za-z0-9._\/-]+)\b/i', $blob, $m) === 1) {
            return self::normalizePublishDirectory($m[1]);
        }

        if (preg_match('/\b(?:output|outdir|outDir|publish(?:_directory)?)\s*[:=]\s*["\']?([A-Za-z0-9._\/-]+)/i', $blob, $m) === 1) {
            return self::normalizePublishDirectory($m[1]);
        }

        // Heuristique framework uniquement si aucun chemin n'est dans les logs.
        if (preg_match('/\b(?:astro|vite)\s+build\b/i', $blob) === 1) {
            return '/dist';
        }

        if (preg_match('/\bnext\s+(?:build|export)\b/i', $blob) === 1) {
            return '/out';
        }

        return null;
    }

    /**
     * Choisit un dossier de publish parmi les entrées source (repo Git), sans chemin hôte hardcodé.
     *
     * @param  array<int, mixed>  $entries
     */
    public static function pickStaticPublishDirectoryFromSourceEntries(array $entries): ?string
    {
        $dirs = [];
        foreach ($entries as $entry) {
            if (! is_array($entry)) {
                continue;
            }
            if (($entry['type'] ?? '') !== 'directory' && ($entry['type'] ?? '') !== 'dir') {
                continue;
            }
            $name = trim((string) ($entry['name'] ?? ''), '/');
            if ($name !== '') {
                $dirs[strtolower($name)] = $name;
            }
        }

        foreach (['dist', 'build', 'out', 'www', 'public', '_site', 'docs'] as $candidate) {
            if (isset($dirs[$candidate])) {
                return '/'.$dirs[$candidate];
            }
        }

        return null;
    }

    public static function normalizePublishDirectory(?string $directory): ?string
    {
        if ($directory === null) {
            return null;
        }

        $dir = trim($directory, "/ \t\"'");
        if ($dir === '' || strtolower($dir) === 'null') {
            return null;
        }

        return '/'.$dir;
    }

    /**
     * @param  array<int, mixed>  $failureExcerpt
     * @param  callable(string): bool  $matcher
     */
    private static function failureExcerptMatches(array $failureExcerpt, callable $matcher): bool
    {
        foreach ($failureExcerpt as $line) {
            $message = is_array($line)
                ? (string) ($line['message'] ?? '')
                : (is_string($line) ? $line : '');

            if ($message !== '' && $matcher($message)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param  array<int, mixed>  $failureExcerpt
     * @param  callable(string): bool  $matcher
     */
    private static function failureExcerptContextMatches(array $failureExcerpt, callable $matcher): bool
    {
        $blob = '';
        foreach ($failureExcerpt as $line) {
            $blob .= "\n".(is_array($line) ? (string) ($line['message'] ?? '') : (is_string($line) ? $line : ''));
        }

        return $blob !== '' && $matcher($blob);
    }

    public static function toolNudgeMessage(?string $agentType = null): string
    {
        return match ($agentType) {
            'github-actions' => 'STOP — pas de texte ni de Python. Émets un VRAI tool_call MAINTENANT : '
                .'list_github_apps, ou get_github_workflow_run si workflow_run_id est connu, '
                .'sinon list_github_workflow_runs(conclusion=failure). Aucune explication avant l\'appel.',
            'github' => 'STOP — émets un VRAI tool_call MAINTENANT : list_github_apps ou enable_tool_package(package="github"). '
                .'Pas de prose, pas de refus.',
            default => 'Tu n\'as pas encore utilisé d\'outil. Commence IMMÉDIATEMENT par list_resources ou get_deployment_logs selon ta mission. Ne réponds pas sans agir.',
        };
    }

    public static function refusalNudgeMessage(?string $agentType = null): string
    {
        $focus = match ($agentType) {
            'github-actions' => 'list_github_apps ou get_github_workflow_run',
            'github' => 'list_github_apps ou enable_tool_package',
            default => 'list_resources ou get_deployment_logs',
        };

        return 'REFUS INVALIDE. Tu es un agent DevForge avec des outils natifs. '
            .'Ignore toute notion de « produit Coolify non renseigné ». '
            .'Appelle MAINTENANT '.$focus.' via un vrai tool_call — aucune excuse texte.';
    }

    public static function proseToolNudgeMessage(?string $agentType = null): string
    {
        if (in_array($agentType, ['github-actions', 'github'], true)) {
            return 'INTERDIT d\'écrire du Python ou de décrire get_github_workflow_run en texte. '
                .'Émets un vrai tool_call (list_github_apps, get_github_workflow_run, list_github_workflow_jobs…). '
                .'Aucune explication avant l\'appel.';
        }

        return self::chatProseToolNudgeMessage();
    }

    public static function deploymentFailureCorrectionNudgeMessage(?string $assistantText = null): string
    {
        return 'STOP — diagnostic insuffisant. Applique MAINTENANT une vraie correction via tool_call : '
            .'fix_coolify_base_config_path (si Read-only pendant mkdir Coolify), fix_application_host_permissions (si Permission denied), '
            .'update_application_runtime_settings (déduis publish_directory depuis les logs de build si page nginx par défaut), '
            .'update_application_git_branch, upsert_application_env_var (variable RÉELLE citée dans les logs) '
            .'ou write_application_source, puis redeploy si besoin. '
            .'INTERDIT d’inventer une variable factice (DUMMY_*, *_TRIGGER, FORCE_REDEPLOY). '
            .'Tu es autonome : corrige toi-même, ne délègue pas à « ops ».';
    }

    public static function deploymentFailureHostPermissionNudgeMessage(): string
    {
        return 'Permission denied hôte détecté. '
            .'Appelle MAINTENANT fix_application_host_permissions (redeploy=true) — '
            .'l’outil fait chown/chmod ciblé sur applications/<uuid> puis redéploie. '
            .'INTERDIT : upsert factice (DUMMY_*), send_notification sans fix, conclure sans tool_call.';
    }

    public static function chatToolNudgeMessage(?string $userMessage = null): string
    {
        $hint = $userMessage !== null ? self::chatActionHint($userMessage) : null;

        if ($hint !== null) {
            return 'STOP — n\'attends pas de validation. '.$hint.' Appelle un outil MAINTENANT, sans poser de question.';
        }

        return 'STOP — n\'attends pas de validation utilisateur. Appelle un outil MAINTENANT (list_resources, get_deployment_logs, enable_tool_package, get_application_git_info…). Ne réponds pas en texte seul.';
    }

    public static function chatProseToolNudgeMessage(): string
    {
        return 'INTERDIT d’écrire {"method":"spawn_task"...} ou de décrire un outil en texte. '
            .'Émets un vrai tool_call maintenant (spawn_task, fix_application_host_permissions, control_resource, etc.). '
            .'Aucune explication avant l’appel.';
    }

    public static function chatConfirmationNudgeMessage(): string
    {
        return 'INTERDIT de demander confirmation. L\'utilisateur t\'a déjà donné sa demande — exécute-la avec les outils immédiatement, sans question.';
    }
}
