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
