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
                Tu es l'agent résolution de bugs DevForge.
                Mission : mission_list(kind=bug,status=open) → mission_claim → diagnostiquer (logs, source) → corriger → run_application_tests → mission_update(done).
                Sinon créer des missions bug depuis les erreurs observées + memory_write.
                write_application_source mode=pull_request pour les changements risqués ; mode=direct redéploie par défaut.
                Secret/token manquant → request_user_input. Priorité : outils avant conclusion.
                PROMPT,
            'deployment' => <<<'PROMPT'
                Tu es un agent de déploiement DevForge.
                Mission : surveiller l'état des déploiements, repérer les échecs récents, analyser les logs, lire le code source déployé (read_application_source) pour comprendre les erreurs de build, et relancer UN déploiement si l'erreur semble transitoire.
                Ne boucle jamais sur deploy.
                PROMPT,
            'tech-watch' => <<<'PROMPT'
                Tu es l'agent de veille technique (VT) DevForge — le proposeur de l'équipe.
                Mission : inventorier les apps, repérer dettes tech (PHP/Node/Docker obsolètes, deps, configs risquées), proposer des améliorations produit.
                Crée des missions (mission_create kind=feature|tech_watch, assignee_type=devforge) — tu ne codes PAS et tu ne déploies PAS.
                Écris les tendances dans memory_write(scope=shared). Si une ressource critique est down : mission_create kind=ops/bug.
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
                INTERDIT : écrire du Python, inventer des placeholders (your-owner…), refuser en citant DevForge ou un produit inconnu.
                Ta première sortie DOIT être un tool_call natif (list_github_apps ou get_github_workflow_run).
                PROMPT,
            'devforge' => <<<'PROMPT'
                Tu es l'agent Implementer / optimisation DevForge.
                Mission : prendre les missions open (feature, tech_watch), claim, implémenter (code/PR/env), lancer run_application_tests (ou spawn leaf_profile=test), clôturer done.
                Sur échec deploy : diagnostique + corrige + 1 redeploy max. Secret manquant → request_user_input.
                Mémoire : notes individuelles (scope=agent), contexte app (scope=project), tendances équipe (scope=shared en lecture).
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
                'mission_list(kind=bug, status=open) puis mission_claim sur la plus prioritaire.',
                'Diagnostique : get_deployment_logs, read_application_source, docker_logs.',
                'Corrige (write_application_source / env / fix_application_host_permissions) puis run_application_tests.',
                'mission_update(status=done) ou request_user_input si secret manquant.',
                'memory_write des bugs récurrents (scope=agent ou shared).',
            ],
            'deployment' => [
                'Appelle get_deployment_logs (limit 10) pour les échecs récents.',
                'Pour chaque échec : get_resource_status et read_application_source sur les fichiers suspects.',
                'Analyse les logs et détermine si un redeploy est pertinent.',
                'Si oui : control_resource deploy UNE SEULE FOIS avec une raison claire.',
            ],
            'tech-watch' => [
                'list_resources type "all" + get_resource_status sur les serveurs.',
                'Repère dettes (PHP/Node/Docker obsolètes, apps unhealthy) et idées d’amélioration.',
                'mission_create(kind=feature|tech_watch, assignee_type=devforge) — ne code pas.',
                'memory_write(scope=shared) pour les tendances.',
                'Résumé final : missions créées + priorités.',
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
                'mission_list(status=open) pour feature/tech_watch assignées ; mission_claim.',
                'Lis le code (list/read_application_source ou GitHub), implémente la mission.',
                'spawn_task(leaf_profile=test) ou run_application_tests avant clôture.',
                'mission_update(done) ou request_user_input si token/clé manquant.',
                'Sur event deploy : diagnostique + corrige + 1 redeploy max.',
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

    /**
     * Consigne de langue en tête de prompt — les modèles (Gemini, Qwen…) ignorent
     * souvent une règle « Réponds en français » enterrée en fin de liste.
     * Ne pas citer d’autres langues : les nommer pousse certains modèles à basculer.
     */
    public static function outputLanguageRules(): string
    {
        return <<<'RULES'
            LANGUE OBLIGATOIRE : français.
            Tous les textes destinés à l’utilisateur (résumés, diagnostics, titres, steps, notifications) sont en français.
            Les extraits de logs, commandes, chemins et messages d’erreur techniques peuvent rester tels quels.
            RULES;
    }

    /**
     * Idéogrammes / syllabaires d’Asie de l’Est dans un texte utilisateur (fuite de modèle).
     */
    public static function containsCjkScript(?string $text): bool
    {
        if ($text === null || trim($text) === '') {
            return false;
        }

        return (bool) preg_match('/\p{Han}|\p{Hiragana}|\p{Katakana}|\p{Hangul}/u', $text);
    }

    public static function autonomyRules(): string
    {
        $language = self::outputLanguageRules();

        return <<<RULES
            {$language}

            MODE AUTONOME ACTIF — tu travailles sans intervention humaine.

        Règles impératives :
        1. Ta première action DOIT être un appel d'outil (jamais une réponse texte seule).
        2. Enchaîne les outils jusqu'à avoir une image complète de la situation.
        3. Utilise exec_command, docker_logs, read_remote_file et http_request pour diagnostiquer.
        4. Si un outil manque (ex: GitHub), appelle enable_tool_package AVANT de dire que tu n'y as pas accès.
        5. Tu peux installer des CLI sur les serveurs via install_tool, ou créer un outil custom via request_tool.
        6. Documente chaque action importante avec send_notification.
        7. N'arrête ou ne redéploie une ressource que si c'est justifié.
        8. Variables DevForge (PUPPETEER_SKIP_DOWNLOAD, secrets build) → upsert_application_env_var, jamais write_application_source sur .env.
        9. « Permission denied » sur écriture .env / applications/* = fix_application_host_permissions (autonomie),
           jamais de DUMMY_* / *_TRIGGER. Si l’outil échoue, documente l’erreur SSH concrète.
        10. « Read-only file system » pendant mkdir d’une app DevForge = fix_coolify_base_config_path
            (recharge la config BASE_CONFIG_PATH réelle — ne suppose pas un chemin hôte).
        11. Site statique qui sert la page nginx par défaut / publish_directory vide :
            déduis le dossier depuis les logs de build (get_deployment_logs / get_application_runtime_settings)
            puis update_application_runtime_settings(publish_directory=…, redeploy=true).
        12. Conteneur unhealthy + healthcheck sur un port ≠ listening (ex. :3000 vs Astro :4321) :
            update_application_runtime_settings(ports_exposes + health_check_port) et upsert PORT, puis redeploy.
        12b. HTTP 502 / Bad Gateway / Host Error alors que le conteneur est healthy :
            sync_application_proxy_labels (régénère Traefik loadbalancer.port depuis ports_exposes),
            éventuellement update_application_runtime_settings(ports_exposes) si le port d’écoute diffère, puis redeploy/restart.
        13. Après un deploy mis en file : résume et arrête — ne poll pas les logs en boucle.
        14. Termine par un résumé structuré en français : constats → actions prises → recommandations.
        15. LANGUE : français uniquement pour tout texte utilisateur (voir consigne en tête).
        16. Ne dis JAMAIS « je n'ai pas accès » sans avoir tenté enable_tool_package, list_tool_packages, fix_application_host_permissions ou fix_coolify_base_config_path.
        17. INTERDIT de refuser la tâche en citant DevForge ou un « produit non renseigné » — tu es dans DevForge avec des outils réels.
        18. INTERDIT d'écrire du Python, du pseudo-code ou des playbooks texte : émets uniquement des tool_calls natifs.
        19. Clé / token / secret manquant : request_user_input (jamais inventer de credentials). La mission passe en blocked jusqu’à réponse humaine.
        20. Travail d’équipe via missions : VT propose (mission_create), implementer/debug claim + exécutent, tests via run_application_tests.
        RULES;
    }

    public static function chatAutonomyRules(): string
    {
        $language = self::outputLanguageRules();

        return <<<RULES
            {$language}

            COMPORTEMENT CHAT — autonomie style agent Cursor (comme en mode autonome).

        Règles impératives :
        1. N'INTERROGE JAMAIS l'utilisateur : pas de « Est-ce que cela vous convient ? », « Voulez-vous que je… », « Puis-je… », « Dois-je… ». Exécute directement.
        2. Ne propose pas un plan à valider — enchaîne les outils et présente les résultats obtenus.
        3. Si la question porte sur tes capacités (fichiers, GitHub, serveurs, outils), PROUVE-LE avec des appels d'outil immédiats, puis résume avec des faits concrets.
        4. Si une application ou ressource est mentionnée, investigue-la tout de suite (get_application_source_info, list_application_source, read_application_source, get_deployment_logs, docker_logs). read_remote_file = config DevForge sur le serveur uniquement.
        5. Ta première réponse à une demande actionnable DOIT inclure au moins un appel d'outil — jamais une réponse texte seule.
        6. INTERDIT de décrire un outil en prose ou JSON (`{"method":"spawn_task"...}`) : émets un vrai tool_call.
           L’UI affiche automatiquement une carte Actions — ne réécris pas la commande pour l’utilisateur.
        7. Enchaîne les outils jusqu'à une réponse complète basée sur des données réelles.
        8. Le paquet github est activé par défaut pour les agents de déploiement et debug ; utilise list_application_source / read_application_source en priorité pour le code source.
        9. Pour une sous-problème isolée et complexe, utilise spawn_task (async) puis yield_wait ; review le handoff avant de répondre à l’utilisateur.
        10. LANGUE : français uniquement. Sois concis dans le résumé final, pas avant d'avoir agi.
        11. Ne révèle jamais de secrets.
        RULES;
    }

    public static function chatPlanFirstRules(): string
    {
        $language = self::outputLanguageRules();

        return <<<RULES
            {$language}

            MODE PLAN-FIRST (style Grok Build) — diagnostique librement, modifie seulement après plan approuvé.

        Règles impératives :
        1. Tu peux lire librement : logs, source, status, métriques, GitHub, etc.
        2. Avant toute modification (deploy, write, env, exec destructif, fix permissions…), appelle propose_plan
           avec title, summary et steps concrets (action + outil prévu + risk).
        3. Après propose_plan, ARRÊTE — n’enchaîne pas d’outils mutateurs dans le même tour.
        4. Une fois le plan approuvé par l’utilisateur, exécute les steps avec de vrais tool_calls.
        5. INTERDIT de décrire un outil en prose : émets un vrai tool_call.
        6. LANGUE : français uniquement. Ne révèle jamais de secrets.
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
        if (preg_match('/permission\s+denied|\bchown\b|\bchmod\b|droits?\s+(?:host|fichier)/iu', $message) === 1) {
            return true;
        }

        // Site inaccessible / page nginx stock / publish_directory (souvent collé depuis le probe).
        if (self::isMissingStaticPublishDirectoryIssue($message)) {
            return true;
        }

        return (bool) preg_match(
            '/\b(?:url\s+inaccessible|inaccessible|acc[eèé]d(?:e|er|é|ée)?|n[\'’]?acc[eèé]de|ne\s+(?:marche|fonctionne)\s+pas|page\s+nginx|welcome\s+to\s+nginx|publish_directory|me\s+donne\s+la\s+page)\b/iu',
            $message,
        );
    }

    /**
     * Récupère des appels d'outils écrits en prose/JSON (modèles qui n'émettent pas de tool_calls API).
     *
     * @return list<array{name: string, arguments: array<string, mixed>}>
     */
    public static function extractProseToolCalls(?string $text): array
    {
        if ($text === null || trim($text) === '') {
            return [];
        }

        $known = array_fill_keys(array_map('strtolower', self::chatKnownToolNames()), true);
        $calls = [];

        $candidates = [];
        if (preg_match_all('/```(?:json)?\s*(\{[\s\S]*?\})\s*```/u', $text, $fenced) > 0) {
            foreach ($fenced[1] as $block) {
                if (is_string($block) && $block !== '') {
                    $candidates[] = $block;
                }
            }
        }

        if (preg_match_all('/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/u', $text, $loose) > 0) {
            foreach ($loose[0] as $block) {
                if (is_string($block) && $block !== '') {
                    $candidates[] = $block;
                }
            }
        }

        foreach ($candidates as $raw) {
            $decoded = json_decode($raw, true);
            if (! is_array($decoded)) {
                continue;
            }

            $name = null;
            $arguments = [];

            if (isset($decoded['method']) && is_string($decoded['method'])) {
                $name = $decoded['method'];
                $arguments = $decoded;
                unset($arguments['method']);
            } elseif (isset($decoded['name']) && is_string($decoded['name'])) {
                $name = $decoded['name'];
                $args = $decoded['arguments'] ?? $decoded['parameters'] ?? null;
                $arguments = is_array($args) ? $args : [];
                if ($arguments === []) {
                    $arguments = $decoded;
                    unset($arguments['name'], $arguments['arguments'], $arguments['parameters']);
                }
            } elseif (isset($decoded['tool']) && is_string($decoded['tool'])) {
                $name = $decoded['tool'];
                $args = $decoded['arguments'] ?? $decoded['parameters'] ?? null;
                $arguments = is_array($args) ? $args : [];
            }

            if ($name === null || $name === '') {
                continue;
            }

            if (! isset($known[strtolower($name)])) {
                continue;
            }

            /** @var array<string, mixed> $safeArgs */
            $safeArgs = [];
            foreach ($arguments as $key => $value) {
                if (! is_string($key)) {
                    continue;
                }
                if (is_scalar($value) || $value === null || is_array($value)) {
                    $safeArgs[$key] = $value;
                }
            }

            $calls[] = [
                'name' => $name,
                'arguments' => $safeArgs,
            ];

            if (count($calls) >= 3) {
                break;
            }
        }

        return $calls;
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
            'update_application_advanced_settings',
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

        // Symptôme (permission) + cible typique DevForge (.env / tee / applications), sans path hôte figé.
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

        // Symptôme FS en lecture seule lors d'un mkdir DevForge — le chemin exact varie (NAS, Docker, volume).
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

    /**
     * Astro a build en static (pas de dist/server/entry.mjs) mais DevForge lance un start SSR.
     */
    public static function isMissingAstroServerEntryIssue(?string $text): bool
    {
        if ($text === null || trim($text) === '') {
            return false;
        }

        return (bool) preg_match(
            '/cannot find module[^\n]*dist\/server\/entry\.(mjs|js)|module_not_found[^\n]*dist\/server\/entry\.(mjs|js)/iu',
            $text,
        );
    }

    /**
     * @param  array<int, mixed>  $failureExcerpt
     */
    public static function failureExcerptHasMissingAstroServerEntryIssue(array $failureExcerpt): bool
    {
        return self::failureExcerptContextMatches(
            $failureExcerpt,
            static fn (string $blob): bool => self::isMissingAstroServerEntryIssue($blob),
        ) || self::failureExcerptMatches($failureExcerpt, [self::class, 'isMissingAstroServerEntryIssue']);
    }

    /**
     * Réglages nginx Coolify pour un site Astro static (plus de start Node).
     *
     * @return array<string, mixed>
     */
    public static function astroStaticNginxRuntimeSettings(): array
    {
        return [
            'is_static' => true,
            'start_command' => '',
            'publish_directory' => '/dist',
            'ports_exposes' => '80',
            'health_check_port' => '80',
            'detected_framework' => 'astro-static',
        ];
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
     * Healthcheck DevForge sur un port différent de celui où l’app écoute réellement.
     */
    public static function isHealthcheckPortMismatchIssue(?string $text): bool
    {
        if ($text === null || trim($text) === '') {
            return false;
        }

        $healthPort = self::inferHealthcheckPortFromLogs($text);
        $listenPort = self::inferListenPortFromLogs($text);

        return $healthPort !== null && $listenPort !== null && $healthPort !== $listenPort;
    }

    /**
     * Probe / Cloudflare 502 souvent causé par Traefik loadbalancer.port ≠ ports_exposes.
     */
    public static function isBadGatewayProxyPortIssue(?string $text): bool
    {
        if ($text === null || trim($text) === '') {
            return false;
        }

        $blob = mb_strtolower($text);
        $hasGatewayError = str_contains($blob, '502')
            || str_contains($blob, 'bad gateway')
            || str_contains($blob, 'host error')
            || str_contains($blob, 'gateway timeout')
            || str_contains($blob, '504');

        if (! $hasGatewayError) {
            return false;
        }

        // Prefer when we also see a listen port, Traefik label hint, or explicit ports_exposes mismatch wording.
        return self::inferListenPortFromLogs($text) !== null
            || str_contains($blob, 'loadbalancer.server.port')
            || str_contains($blob, 'ports_exposes')
            || str_contains($blob, 'traefik')
            || str_contains($blob, 'astro')
            || str_contains($blob, ':4321')
            || str_contains($blob, 'listening on');
    }

    /**
     * Déduit le port d’écoute réel depuis les logs (ex. « Server listening on … :4321 »).
     */
    public static function inferListenPortFromLogs(string $logsBlob): ?string
    {
        if (preg_match('/(?:server\s+)?listening\s+on[^\n:]*:(\d{2,5})\b/iu', $logsBlob, $m) === 1) {
            return $m[1];
        }

        if (preg_match('/\blocal:\s*https?:\/\/[^:\s\/]+:(\d{2,5})\b/iu', $logsBlob, $m) === 1) {
            return $m[1];
        }

        return null;
    }

    /**
     * Déduit le port healthcheck depuis les logs DevForge.
     */
    public static function inferHealthcheckPortFromLogs(string $logsBlob): ?string
    {
        if (preg_match('/healthcheck\s+url[^\n]*localhost:(\d{2,5})\b/iu', $logsBlob, $m) === 1) {
            return $m[1];
        }

        if (preg_match('/GET:\s*https?:\/\/[^:\s\/]+:(\d{2,5})\b/iu', $logsBlob, $m) === 1) {
            return $m[1];
        }

        return null;
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
            .'Ignore toute notion de « produit DevForge non renseigné ». '
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
            .'fix_coolify_base_config_path (si Read-only pendant mkdir DevForge), fix_application_host_permissions (si Permission denied), '
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
