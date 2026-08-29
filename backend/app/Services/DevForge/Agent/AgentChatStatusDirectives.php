<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;

class AgentChatStatusDirectives
{
    public static function isChatStatusOrFleetIntent(string $userMessage): bool
    {
        $message = trim($userMessage);
        if ($message === '') {
            return false;
        }

        return (bool) preg_match(
            '/non\s+d[ée]ploy|pas\s+d[ée]ploy|n[\'\x{2019}]as\s+pas\s+vu|tu\s+n[\'\x{2019}]as\s+pas|'
            .'sant[ée](?:\s+des\s+applications)?|\bstatut\b|\bstatus\b|'
            .'[ée]tat\s+(?:de\s+)?(?:l[\'\x{2019}]app|des\s+app|des\s+ressources)|'
            .'d[ée]ploiement\s+[ée]chou/iu',
            $message,
        );
    }

    public static function requiresChatTools(string $userMessage): bool
    {
        return AgentDirectives::isChatRepairIntent($userMessage) || self::isChatStatusOrFleetIntent($userMessage);
    }

    public static function chatActionHint(string $userMessage, ?AiAgent $agent = null): ?string
    {
        $scopeHint = $agent !== null && filled($agent->resource_uuid)
            ? ' Scope : ressource '.$agent->resource_uuid.'.'
            : '';

        if (self::isChatStatusOrFleetIntent($userMessage)) {
            return 'Inspecte MAINTENANT avec de VRAIS tool_calls : list_resources, get_resource_status, get_deployment_logs. '
                .'INTERDIT de demander plus de contexte. Un déploiement failed + conteneur running/healthy ≠ non déployée '
                .'(dis « déploiement échoué, rollback, l\'app tourne encore »). Réponds en français.'.$scopeHint;
        }

        return AgentDirectives::chatActionHint($userMessage, $agent);
    }

    public static function chatToolNudgeMessage(string $userMessage): string
    {
        if (self::isChatStatusOrFleetIntent($userMessage)) {
            return (string) self::chatActionHint($userMessage);
        }

        return AgentDirectives::chatToolNudgeMessage($userMessage);
    }

    public static function systemAddendum(?string $latestUserMessage): string
    {
        $hint = $latestUserMessage !== null ? self::chatActionHint($latestUserMessage) : null;
        $hintBlock = $hint !== null
            ? "Consigne statut/santé :\n{$hint}"
            : '';

        return trim(<<<ADDENDUM
INTERDIT de répondre en anglais (sauf extraits de logs, commandes, chemins et messages d'erreur techniques).
Ne demande jamais à l'utilisateur de coller plus de contexte pour un statut de déploiement — utilise les outils.
INTERDIT de demander plus de contexte à l'utilisateur pour « non déployé », santé ou statut : list_resources / get_resource_status / get_deployment_logs d'abord.
Dernier déploiement failed + conteneur running/healthy ≠ application non déployée : dis « déploiement échoué, rollback, l'app tourne encore ».
{$hintBlock}
ADDENDUM);
    }
}
