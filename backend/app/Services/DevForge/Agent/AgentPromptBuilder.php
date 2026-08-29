<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;
use App\Services\DevForge\Agent\Tool\AgentPermissionEngine;

class AgentPromptBuilder
{
    /**
     * @param  array<string, mixed>  $context
     */
    public function autonomousSystemPrompt(AiAgent $agent, array $context = []): string
    {
        $basePrompt = trim($agent->system_prompt ?: AgentDirectives::defaultSystemPrompt($agent->type));

        $eventRules = match ($context['event'] ?? null) {
            'deployment_failed' => <<<'RULES'

            Contexte : échec de déploiement détecté.
            RULES,
            default => '',
        };
        return $basePrompt;
    }

    private function chatApplicationContextBlock(array $context): string
    {
        $brief = trim((string) ($context['workspace_brief'] ?? ''));
        if ($brief !== '') {
            return $brief;
        }

        $applicationUuid = trim((string) ($context['application_uuid'] ?? ''));
        if ($applicationUuid === '') {
            return '';
        }

        try {
            return app(ApplicationWorkspaceChatContext::class)->formatPromptBlock($context);
        } catch (\Throwable) {
        }

        $applicationName = (string) ($context['application_name'] ?? 'Application');
        $gitRepository = (string) ($context['git_repository'] ?? 'inconnu');
        $gitBranch = (string) ($context['git_branch'] ?? 'inconnu');
        $buildPack = (string) ($context['build_pack'] ?? 'inconnu');
        $fqdn = (string) ($context['fqdn'] ?? 'aucun');
        $status = (string) ($context['application_status'] ?? '');

        $statusLine = $status !== '' ? "\n        - Statut ressource : {$status}" : '';

        return trim(<<<CONTEXT

        Champ d'application (scope obligatoire pour ce chat) :
        Tu es dans le workspace de CETTE application. Tu as déjà son statut, ses variables d'environnement (clés et formes, jamais les secrets), ses logs de déploiement et ses paramètres runtime. Si l'utilisateur dit « corrige » (ou équivalent), diagnostique à partir de CE contexte : ne redemande pas le status.
        - Application : {$applicationName} ({$applicationUuid}){$statusLine}
        - Dépôt : {$gitRepository}
        - Branche : {$gitBranch}
        - Build pack : {$buildPack}
        - Domaines : {$fqdn}

        Traite chaque demande comme portant sur CETTE application.
        Pour les outils (read_application_source, write_application_source, upsert_application_env_var, control_resource, get_deployment_logs, get_resource_status, etc.), utilise application_uuid={$applicationUuid} sans redemander l'UUID.
        CONTEXT);
    }
}
