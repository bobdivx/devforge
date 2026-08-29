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
