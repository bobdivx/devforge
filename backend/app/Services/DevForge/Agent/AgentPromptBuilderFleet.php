<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;

class AgentPromptBuilderFleet extends AgentPromptBuilder
{
    /**
     * @param  array<string, mixed>  $applicationContext
     */
    public function chatSystemPrompt(AiAgent $agent, ?string $latestUserMessage = null, array $applicationContext = []): string
    {
        $fleet = trim((string) ($applicationContext['fleet_brief'] ?? ''));
        $workspace = trim((string) ($applicationContext['workspace_brief'] ?? ''));
        if ($workspace === '' && $fleet !== '') {
            $applicationContext['workspace_brief'] = $fleet;
        }
        $brief = trim((string) ($applicationContext['workspace_brief'] ?? ''));
        if ($brief !== '') {
            $applicationContext['workspace_brief'] = self::withDeployStatusReadingRules($brief);
        }

        $prompt = parent::chatSystemPrompt($agent, $latestUserMessage, $applicationContext);

        return trim($prompt."\n\n".AgentChatStatusDirectives::systemAddendum($latestUserMessage));
    }

    public static function withDeployStatusReadingRules(string $brief): string
    {
        $rules = ApplicationWorkspaceChatContext::statusReadingRules();
        if (str_contains($brief, 'déploiement échoué, rollback')) {
            return $brief;
        }

        return trim($brief."\n\n".$rules);
    }
}
