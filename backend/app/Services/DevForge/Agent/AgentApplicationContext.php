<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;
use App\Models\Application;
use App\Models\User;
use App\Services\DevForge\CurrentTeamResources;
use Illuminate\Database\Eloquent\ModelNotFoundException;

/**
 * Résout le contexte application pour un chat/run agent.
 *
 * Modèle produit :
 * - Agents racine (1 par type de travail : Relanceur, Veille, Worker…) → équipe entière ;
 *   `application_uuid` est un contexte de travail, pas un verrou.
 * - Sous-agents (tâche) → peuvent être scopés à une ressource ; mismatch = 422.
 */
class AgentApplicationContext
{
    public function __construct(
        private CurrentTeamResources $currentTeamResources,
    ) {}

    public function resolve(
        User $user,
        AiAgent $agent,
        ?string $applicationUuid,
        bool $abortOnMissing = true,
    ): ?Application {
        if ($applicationUuid === null || trim($applicationUuid) === '') {
            return null;
        }

        try {
            $application = $this->currentTeamResources->application($user, $applicationUuid);
        } catch (ModelNotFoundException) {
            if ($abortOnMissing) {
                abort(404, 'Application introuvable.');
            }

            return null;
        }

        if ($this->isTeamRoleAgent($agent)) {
            return $application;
        }

        if (
            is_string($agent->resource_uuid)
            && $agent->resource_uuid !== ''
            && $agent->resource_uuid !== $application->uuid
        ) {
            abort(422, 'Cet agent est lié à une autre application.');
        }

        return $application;
    }

    /**
     * Agent d’équipe (rôle) : pas de parent, ou sans verrou ressource.
     * Les sous-agents (parent_agent_id) restent scopables à une app.
     */
    public function isTeamRoleAgent(AiAgent $agent): bool
    {
        if ($agent->parent_agent_id !== null) {
            return false;
        }

        return true;
    }
}
