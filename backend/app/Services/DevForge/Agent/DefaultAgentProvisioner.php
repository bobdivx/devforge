<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;
use App\Models\AiProviderConfig;
use App\Models\Team;
use Illuminate\Support\Facades\Log;

/**
 * Provisionne les agents par défaut pour une team dès qu'un provider AI est actif.
 * Agents créés : Relanceur de déploiements, Veille technique, Agent features.
 */
class DefaultAgentProvisioner
{
    /**
     * Provisionne les agents par défaut si manquants pour une team.
     * Retourne le nombre d'agents créés.
     */
    public function ensureDefaultAgents(Team $team): int
    {
        $providerConfig = AiProviderConfig::query()
            ->where('team_id', $team->id)
            ->orderByDesc('is_default')
            ->orderBy('id')
            ->first();

        if (! $providerConfig) {
            return 0;
        }

        $created = 0;

        // 1. Relanceur de déploiements (deploy operator)
        $created += $this->ensureAgent(
            team: $team,
            providerConfig: $providerConfig,
            type: 'devforge',
            slug: 'relanceur-deployments',
            name: 'Relanceur de déploiements',
            description: 'Agent opérateur qui corrige automatiquement les déploiements échoués via la boucle observe→fix→verify.',
            systemPrompt: implode("\n", [
                'Tu es l\'agent Relanceur — un opérateur DevOps autonome.',
                'Ta mission : réparer les déploiements échoués via la boucle opérateur.',
                '',
                'Workflow :',
                '1. Observe l\'état réel (pas d\'invention) : get_deployment_logs, get_application.',
                '2. Une seule hypothèse → un seul fix minimal.',
                '3. Applique via update_application_runtime_settings ou write_application_source.',
                '4. Redéploie et remesure.',
                '',
                'TOUJOURS utiliser skill_load(\'fix-deploy-failed\') pour les déploiements échoués.',
                'Ne JAMAIS empiler 3 correctifs. Un changement → une vérification.',
                'JAMAIS de secrets dans un commit ou le chat.',
            ]),
            avatarColor: '#ef4444',
            scheduleMinutes: 0,
            heartbeatEnabled: false,
            metadata: ['default_agent' => true, 'role' => 'deploy_operator'],
        );

        // 2. Veille technique (tech watch)
        $created += $this->ensureAgent(
            team: $team,
            providerConfig: $providerConfig,
            type: 'tech-watch',
            slug: 'veille-technique',
            name: 'Veille technique',
            description: 'Agent de recherche autonome qui identifie bugs, problèmes responsive/design et opportunités de features.',
            systemPrompt: implode("\n", [
                'Tu es l\'agent Veille technique — un chercheur autonome.',
                'Ta mission : scanner les applications et créer des tâches pour améliorer la qualité.',
                '',
                'Domaines de recherche :',
                '- Bugs fonctionnels ou d\'affichage',
                '- Problèmes responsive (mobile, tablet)',
                '- Problèmes de design ou UX',
                '- Features manquantes suggérées par l\'usage',
                '',
                'Workflow :',
                '1. Liste les applications de l\'équipe.',
                '2. Pour chaque app : smoke test HTTP, browse pages, cherche anomalies.',
                '3. Pour chaque trouvaille : crée UNE tâche via POST /api/v1/devforge/tasks.',
                '4. Ne JAMAIS inventer d\'UUID. Utilise les outils CRUD tasks.',
                '',
                'Utilise skill_load(\'tech-watch-research\') pour le workflow complet.',
            ]),
            avatarColor: '#3b82f6',
            scheduleMinutes: 240,
            heartbeatEnabled: true,
            metadata: ['default_agent' => true, 'role' => 'tech_watch'],
        );

        // 3. Agent features (user feature requests)
        $created += $this->ensureAgent(
            team: $team,
            providerConfig: $providerConfig,
            type: 'feature',
            slug: 'agent-features',
            name: 'Agent features',
            description: 'Agent qui transforme les demandes utilisateurs en tâches puis les implémente via operator loop.',
            systemPrompt: implode("\n", [
                'Tu es l\'agent Features — interface entre l\'utilisateur et l\'équipe technique.',
                'Ta mission : comprendre la demande → créer une tâche → implémenter.',
                '',
                'Workflow :',
                '1. Utilisateur demande une feature dans le chat.',
                '2. Clarifie si besoin (scope, app cible, contraintes).',
                '3. Crée une tâche via POST /api/v1/devforge/tasks avec kind=feature.',
                '4. Implémente via operator loop : one change → verify → next.',
                '5. Marque la tâche done via PATCH /api/v1/devforge/tasks/{uuid}.',
                '',
                'Ne JAMAIS faire plusieurs changements sans vérification.',
                'Utilise skill_load(\'user-feature-request\') pour la procédure complète.',
            ]),
            avatarColor: '#10b981',
            scheduleMinutes: 0,
            heartbeatEnabled: false,
            metadata: ['default_agent' => true, 'role' => 'feature_implementer'],
        );

        if ($created > 0) {
            Log::info("[DefaultAgentProvisioner] Provisionné {$created} agents par défaut pour team {$team->id}.");
        }

        return $created;
    }

    /**
     * Crée un agent si absent (match par slug dans metadata).
     * Retourne 1 si créé, 0 si existant.
     *
     * @param  array<string, mixed>  $metadata
     */
    private function ensureAgent(
        Team $team,
        AiProviderConfig $providerConfig,
        string $type,
        string $slug,
        string $name,
        string $description,
        string $systemPrompt,
        string $avatarColor,
        int $scheduleMinutes,
        bool $heartbeatEnabled,
        array $metadata,
    ): int {
        $existing = AiAgent::query()
            ->where('team_id', $team->id)
            ->where('type', $type)
            ->where('name', $name)
            ->first();

        if ($existing) {
            return 0;
        }

        AiAgent::create([
            'team_id' => $team->id,
            'provider_config_id' => $providerConfig->id,
            'type' => $type,
            'name' => $name,
            'description' => $description,
            'system_prompt' => $systemPrompt,
            'avatar_color' => $avatarColor,
            'schedule_minutes' => $scheduleMinutes,
            'heartbeat_enabled' => $heartbeatEnabled,
            'is_active' => true,
            'status' => 'idle',
            'metadata' => $metadata,
        ]);

        return 1;
    }
}
