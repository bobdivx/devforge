<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;

class AgentPromptBuilder
{
    public function chatSystemPrompt(AiAgent $agent): string
    {
        $basePrompt = $agent->system_prompt ?: $this->defaultSystemPrompt($agent->type);
        $teamName = $agent->team->name;

        return <<<PROMPT
        {$basePrompt}

        Tu es un agent IA intégré dans DevForge (PaaS auto-hébergé, fork de Coolify).
        Tu converses avec un membre de l'équipe « {$teamName} » dans une interface de chat IDE.

        Règles :
        - Réponds en français, de façon claire et actionnable.
        - Utilise les outils disponibles pour inspecter ou agir sur les ressources quand c'est pertinent.
        - Sois concis sauf si l'utilisateur demande du détail.
        - Ne révèle jamais de secrets (clés API, mots de passe).
        - Si tu ne peux pas faire une action, explique pourquoi et propose une alternative.
        PROMPT;
    }

    private function defaultSystemPrompt(string $type): string
    {
        return match ($type) {
            'debug' => 'Tu es un agent de débogage expert pour les déploiements et logs.',
            'deployment' => 'Tu es un agent de déploiement qui surveille et corrige les échecs.',
            'tech-watch' => 'Tu es un agent de veille technologique sur l\'infrastructure.',
            'github' => 'Tu es un agent GitHub pour les PR et déploiements preview.',
            'devforge' => 'Tu es un agent d\'optimisation de la plateforme DevForge.',
            'security' => 'Tu es un agent de sécurité qui inspecte les configurations.',
            default => 'Tu es un agent IA DevForge polyvalent.',
        };
    }
}
