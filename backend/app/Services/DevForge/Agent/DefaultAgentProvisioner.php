<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;
use App\Models\AiProviderConfig;
use App\Models\Team;
use Illuminate\Support\Facades\Log;

/**
 * Provisionne les agents par défaut pour une team dès qu'un provider AI est actif.
 * Agents créés/mis à jour : Relanceur (fix provider si existant), Veille technique, Worker features.
 */
class DefaultAgentProvisioner
{
    /**
     * Provisionne les agents par défaut si manquants pour une team.
     * Retourne le nombre d'agents créés ou mis à jour.
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

        // 1. Relanceur de déploiements : ne PAS créer si existe, mais fixer le provider vers Gemini
        $created += $this->ensureOrFixRelanceur($team, $providerConfig);

        // 2. Veille technique (claime des missions du kanban)
        $created += $this->ensureAgent(
            team: $team,
            providerConfig: $providerConfig,
            type: 'tech-watch',
            slug: 'veille-technique',
            name: 'Veille',
            description: 'Agent de veille qui scanne les apps, détecte bugs/responsive/design, et crée des missions dans le kanban.',
            systemPrompt: implode("\n", [
                'Tu es l\'agent Veille — chercheur de qualité autonome.',
                'Ta mission : scanner les apps → créer des missions dans le kanban.',
                '',
                'Domaines de recherche :',
                '- Bugs fonctionnels ou d\'affichage',
                '- Problèmes responsive (mobile, tablet)',
                '- Problèmes de design ou UX',
                '- Features manquantes suggérées par l\'usage',
                '',
                'Workflow :',
                '1. Liste les applications de l\'équipe via list_applications.',
                '2. Pour chaque app : smoke test HTTP, browse pages, cherche anomalies.',
                '3. Pour chaque trouvaille : crée UNE mission via POST /api/v1/devforge/tasks.',
                '4. Set kind=bug (bugs), kind=tech_watch (design/responsive), kind=feature (opportunités).',
                '5. Le Worker la claimera plus tard depuis le kanban.',
                '',
                'Ne JAMAIS inventer d\'UUID. Utilise les outils CRUD tasks.',
                'Utilise skill_load(\'tech-watch-research\') pour le workflow complet.',
            ]),
            avatarColor: '#3b82f6',
            scheduleMinutes: 240,
            heartbeatEnabled: true,
            metadata: ['default_agent' => true, 'role' => 'tech_watch'],
        );

        // 3. Worker (claime des missions du kanban)
        $created += $this->ensureAgent(
            team: $team,
            providerConfig: $providerConfig,
            type: 'worker',
            slug: 'worker',
            name: 'Worker',
            description: 'Worker autonome qui claime des missions du kanban (bugs, features, ops) et les implémente via operator loop.',
            systemPrompt: implode("\n", [
                'Tu es le Worker — exécutant autonome de l\'équipe.',
                'Ta mission : claimer des missions du kanban → implémenter → marquer done.',
                '',
                'Workflow :',
                '1. Liste les missions via GET /api/v1/devforge/tasks?status=open.',
                '2. Claime une mission : PATCH /api/v1/devforge/tasks/{uuid} avec status=in_progress et assignee_agent_id={ton_id}.',
                '3. Implémente selon le kind :',
                '   - bug : diagnostique → fix minimal → smoke test.',
                '   - feature : clarifie scope → implémente → smoke test.',
                '   - ops : exécute la tâche d\'ops/maintenance.',
                '4. Operator loop : one change → verify → next.',
                '5. Marque done : PATCH /api/v1/devforge/tasks/{uuid} avec status=done.',
                '',
                'Ne JAMAIS faire plusieurs changements sans vérification.',
                'Utilise skill_load(\'user-feature-request\') pour features.',
            ]),
            avatarColor: '#10b981',
            scheduleMinutes: 0,
            heartbeatEnabled: false,
            metadata: ['default_agent' => true, 'role' => 'worker'],
        );

        if ($created > 0) {
            Log::info("[DefaultAgentProvisioner] Provisionné/mis à jour {$created} agents pour team {$team->id}.");
        }

        return $created;
    }

    /**
     * Relanceur : si existe déjà, fixer son provider vers Gemini. Sinon créer.
     * Retourne 1 si créé/modifié, 0 sinon.
     */
    private function ensureOrFixRelanceur(Team $team, AiProviderConfig $providerConfig): int
    {
        // Chercher Relanceur existant par nom ou type deployment/devforge
        $existing = AiAgent::query()
            ->where('team_id', $team->id)
            ->where(function ($q) {
                $q->where('name', 'like', '%Relanceur%')
                    ->orWhere('type', 'deployment')
                    ->orWhere('type', 'devforge');
            })
            ->first();

        if ($existing) {
            // Fixer provider_config_id vers Gemini (le provider par défaut passé en param)
            $updated = false;
            if ($existing->provider_config_id !== $providerConfig->id) {
                $existing->update(['provider_config_id' => $providerConfig->id]);
                $updated = true;
                Log::info("[DefaultAgentProvisioner] Relanceur #{$existing->id} : provider fixé vers config #{$providerConfig->id} ({$providerConfig->provider}).");
            }

            return $updated ? 1 : 0;
        }

        // Relanceur n'existe pas : le créer (cas rare, normalement il existe déjà)
        AiAgent::create([
            'team_id' => $team->id,
            'provider_config_id' => $providerConfig->id,
            'type' => 'devforge',
            'name' => 'Relanceur de déploiements',
            'description' => 'Agent opérateur qui corrige automatiquement les déploiements échoués via la boucle observe→fix→verify.',
            'system_prompt' => implode("\n", [
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
            'avatar_color' => '#ef4444',
            'schedule_minutes' => 0,
            'heartbeat_enabled' => false,
            'is_active' => true,
            'status' => 'idle',
            'metadata' => ['default_agent' => true, 'role' => 'deploy_operator'],
        ]);

        return 1;
    }

    /**
     * Crée un agent si absent (match par name).
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
