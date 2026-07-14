<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;

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
            - Analyse les logs fournis puis get_deployment_logs si besoin.
            - Un seul redeploy automatique maximum.
            - Si config utilisateur en cause, documente sans boucler.
            RULES,
            'deployment_build_started' => <<<'RULES'

            Contexte : build webhook en cours.
            - Surveille le déploiement actif et les ressources liées.
            - Analyse les logs si échec ou blocage.
            RULES,
            'deployment_build_completed' => <<<'RULES'

            Contexte : build terminé avec succès.
            - Vérifie que l'application est healthy (get_resource_status).
            - docker_logs si anomalie ou conteneur instable.
            - Rapport concis : OK ou points d'attention.
            - Pas de redeploy sauf anomalie critique détectée.
            RULES,
            'delegated' => <<<'RULES'

            Contexte : sous-tâche déléguée par un agent parent.
            - Concentre-toi sur l'objectif fourni.
            - Pas de delegate_task (tu es un worker).
            RULES,
            default => '',
        };

        $autonomyRules = AgentDirectives::autonomyRules();

        return trim(<<<PROMPT
        {$basePrompt}

        Tu es un agent IA autonome intégré dans DevForge (PaaS Coolify).
        Équipe : {$agent->team->name}
        Type : {$agent->type}

        {$eventRules}

        {$autonomyRules}
        PROMPT);
    }

    /**
     * @param  array<string, mixed>  $context
     */
    public function autonomousInitialMessage(AiAgent $agent, array $context = [], string $trigger = 'manual'): string
    {
        if (($context['event'] ?? null) === 'deployment_failed') {
            return $this->deploymentFailureContext($agent, $context);
        }

        if (($context['event'] ?? null) === 'deployment_build_started') {
            return $this->deploymentBuildStartedContext($agent, $context);
        }

        if (($context['event'] ?? null) === 'deployment_build_completed') {
            return $this->deploymentBuildCompletedContext($agent, $context);
        }

        if (($context['event'] ?? null) === 'delegated') {
            return $this->delegatedContext($agent, $context);
        }

        $now = now()->format('d/m/Y H:i');
        $triggerLabel = match ($trigger) {
            'scheduled' => 'planification automatique',
            'manual' => 'lancement manuel',
            'event' => 'événement système',
            default => $trigger,
        };

        $resourceContext = $agent->resource_uuid
            ? "Scope : ressource UUID {$agent->resource_uuid} uniquement."
            : 'Scope : toutes les ressources de l\'équipe.';

        $playbook = AgentDirectives::autonomousPlaybook($agent->type);
        $steps = implode("\n", array_map(
            fn (string $step, int $index): string => ($index + 1).'. '.$step,
            $playbook,
            array_keys($playbook),
        ));

        return trim(<<<CONTEXT
        DÉMARRAGE AUTONOME — {$triggerLabel}
        Date : {$now}
        Agent : {$agent->name} ({$agent->type})
        {$resourceContext}

        Playbook à exécuter maintenant :
        {$steps}

        Commence par la première étape avec un appel d'outil. Ne t'arrête pas avant d'avoir terminé le playbook ou atteint une conclusion actionnable.
        CONTEXT);
    }

    public function chatSystemPrompt(AiAgent $agent, ?string $latestUserMessage = null): string
    {
        $basePrompt = trim($agent->system_prompt ?: AgentDirectives::defaultSystemPrompt($agent->type));
        $teamName = $agent->team->name;
        $autonomyRules = AgentDirectives::chatAutonomyRules();
        $actionHint = $latestUserMessage !== null
            ? AgentDirectives::chatActionHint($latestUserMessage, $agent)
            : null;
        $hintBlock = $actionHint !== null
            ? "\n\nConsigne immédiate pour le message utilisateur en cours :\n{$actionHint}"
            : '';
        $scopeBlock = $agent->resource_uuid
            ? "\nScope agent : ressource UUID {$agent->resource_uuid} uniquement (sauf demande explicite de l'équipe entière)."
            : '';

        return trim(<<<PROMPT
        {$basePrompt}

        Tu es un agent IA intégré dans DevForge (PaaS auto-hébergé).
        Tu converses avec un membre de l'équipe « {$teamName} » dans une interface de chat.
        {$scopeBlock}

        {$autonomyRules}
        {$hintBlock}
        PROMPT);
    }

    /**
     * @param  array<string, mixed>  $context
     */
    private function deploymentFailureContext(AiAgent $agent, array $context): string
    {
        $applicationName = (string) ($context['application_name'] ?? 'Application');
        $applicationUuid = (string) ($context['application_uuid'] ?? '');
        $deploymentUuid = (string) ($context['deployment_uuid'] ?? '');
        $commit = (string) ($context['commit'] ?? 'inconnu');
        $failureExcerpt = json_encode($context['failure_excerpt'] ?? [], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);

        return trim(<<<CONTEXT
        ALERTE : déploiement en échec — agis immédiatement.

        Application : {$applicationName} ({$applicationUuid})
        Déploiement : {$deploymentUuid}
        Commit : {$commit}

        Logs d'échec :
        {$failureExcerpt}

        Étapes :
        1. get_deployment_logs avec deployment_uuid
        2. get_resource_status sur l'application
        3. docker_logs si conteneur identifiable
        4. control_resource deploy UNE FOIS si correction transitoire possible
        5. Résumé actionnable

        Première action : appel d'outil obligatoire.
        CONTEXT);
    }

    /**
     * @param  array<string, mixed>  $context
     */
    private function deploymentBuildStartedContext(AiAgent $agent, array $context): string
    {
        $applicationName = (string) ($context['application_name'] ?? 'Application');
        $applicationUuid = (string) ($context['application_uuid'] ?? '');
        $deploymentUuid = (string) ($context['deployment_uuid'] ?? '');
        $commit = (string) ($context['commit'] ?? 'inconnu');
        $buildPack = (string) ($context['build_pack'] ?? 'inconnu');
        $triggerSource = (string) ($context['trigger_source'] ?? 'webhook');

        return trim(<<<CONTEXT
        BUILD DÉMARRÉ ({$triggerSource})

        Application : {$applicationName} ({$applicationUuid})
        Déploiement : {$deploymentUuid}
        Commit : {$commit}
        Build pack : {$buildPack}

        Étapes :
        1. get_deployment_logs pour ce déploiement
        2. get_resource_status sur l'application
        3. Surveiller et analyser si échec
        4. Rapport concis

        Commence par get_deployment_logs.
        CONTEXT);
    }

    /**
     * @param  array<string, mixed>  $context
     */
    private function deploymentBuildCompletedContext(AiAgent $agent, array $context): string
    {
        $applicationName = (string) ($context['application_name'] ?? 'Application');
        $applicationUuid = (string) ($context['application_uuid'] ?? '');
        $deploymentUuid = (string) ($context['deployment_uuid'] ?? '');
        $commit = (string) ($context['commit'] ?? 'inconnu');
        $buildPack = (string) ($context['build_pack'] ?? 'inconnu');
        $triggerSource = (string) ($context['trigger_source'] ?? 'webhook');

        return trim(<<<CONTEXT
        BUILD TERMINÉ AVEC SUCCÈS ({$triggerSource})

        Application : {$applicationName} ({$applicationUuid})
        Déploiement : {$deploymentUuid}
        Commit : {$commit}
        Build pack : {$buildPack}

        Étapes :
        1. get_resource_status sur l'application
        2. get_deployment_logs pour confirmer la fin du déploiement
        3. docker_logs si le statut n'est pas healthy
        4. Rapport concis : OK ou points d'attention

        Commence par get_resource_status.
        CONTEXT);
    }

    /**
     * @param  array<string, mixed>  $context
     */
    private function delegatedContext(AiAgent $agent, array $context): string
    {
        $goal = (string) ($context['delegated_goal'] ?? '');
        $parentUuid = (string) ($context['parent_agent_uuid'] ?? 'inconnu');

        return trim(<<<CONTEXT
        DÉLÉGATION depuis agent parent ({$parentUuid}).

        Objectif :
        {$goal}

        Exécute avec les outils. Première action = appel d'outil.
        CONTEXT);
    }
}
