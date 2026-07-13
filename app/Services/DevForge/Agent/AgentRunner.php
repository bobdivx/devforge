<?php

namespace App\Services\DevForge\Agent;

use App\Events\AgentRunUpdated;
use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Services\DevForge\Agent\Contracts\LlmResponse;
use App\Services\DevForge\Core\CoreResourceAction;
use App\Services\DevForge\Core\CoreResourceCatalog;
use App\Services\DevForge\DeploymentData;

class AgentRunner
{
    private const MAX_ITERATIONS = 10;

    /** @var array<array{role: string, content: string}> */
    private array $messages = [];

    public function __construct(
        private readonly LlmProviderFactory $providerFactory,
        private readonly CoreResourceCatalog $catalog,
        private readonly CoreResourceAction $resourceAction,
        private readonly DeploymentData $deploymentData,
    ) {}

    public function run(AiAgent $agent, AiAgentRun $run, array $context = []): void
    {
        $providerConfig = $agent->providerConfig;

        if (! $providerConfig) {
            $run->update([
                'status' => 'failed',
                'summary' => 'Aucun provider LLM configuré pour cet agent.',
                'finished_at' => now(),
            ]);
            $agent->update(['status' => 'error']);

            return;
        }

        $provider = $this->providerFactory->makeForAgent(
            $agent,
            function (\Throwable $exception, string $primaryLabel, string $fallbackLabel) use ($run): void {
                $run->appendLog("Provider {$primaryLabel} indisponible : ".mb_substr($exception->getMessage(), 0, 200));
                $run->appendLog("Bascule vers le provider de secours : {$fallbackLabel}");
            },
        );
        $toolkit = new AgentToolkit(
            team: $agent->team,
            run: $run,
            catalog: $this->catalog,
            resourceAction: $this->resourceAction,
            deploymentData: $this->deploymentData,
            assignedResourceUuid: $agent->resource_uuid,
            runContext: $context,
        );

        $this->messages = [
            ['role' => 'system', 'content' => $this->buildSystemPrompt($agent, $context)],
            ['role' => 'user', 'content' => $this->buildInitialContext($agent, $context)],
        ];

        $run->update(['status' => 'running', 'started_at' => now()]);
        $run->appendLog('Agent démarré — provider: '.$providerConfig->provider.' / '.$providerConfig->model);

        $toolDefinitions = $toolkit->definitions();
        $iterations = 0;
        $summary = '';

        try {
            while ($iterations < self::MAX_ITERATIONS) {
                $iterations++;
                $run->appendLog("Itération #{$iterations}...");

                broadcast(new AgentRunUpdated($agent, $run, "Itération #{$iterations}"));

                /** @var LlmResponse $response */
                $response = $provider->chat($this->messages, $toolDefinitions);

                $run->update([
                    'tokens_used' => $run->tokens_used + $response->tokensUsed,
                    'iterations' => $iterations,
                ]);

                if ($response->text) {
                    $run->appendLog("Raisonnement: {$response->text}");
                    $summary = $response->text;
                }

                if (! $response->hasToolCalls()) {
                    $run->appendLog('Agent terminé — aucun appel d\'outil supplémentaire.');
                    break;
                }

                $toolResults = [];
                foreach ($response->toolCalls as $toolCall) {
                    $result = $toolkit->execute($toolCall['name'], $toolCall['arguments']);
                    $toolResults[] = [
                        'name' => $toolCall['name'],
                        'result' => $result,
                    ];
                }

                AgentToolTurnBuilder::append($this->messages, $response, $toolResults);
            }

            if ($iterations >= self::MAX_ITERATIONS) {
                $run->appendLog('Limite d\'itérations atteinte.');
                $summary = $summary ?: 'Limite d\'itérations atteinte sans conclusion.';
            }

            $run->update([
                'status' => 'completed',
                'summary' => mb_substr($summary, 0, 1000),
                'finished_at' => now(),
            ]);

            $agent->update(['status' => 'idle', 'last_run_at' => now()]);
            broadcast(new AgentRunUpdated($agent, $run, 'completed'));

        } catch (\Throwable $e) {
            $run->appendLog('Erreur: '.$e->getMessage());
            $run->update([
                'status' => 'failed',
                'summary' => 'Erreur: '.mb_substr($e->getMessage(), 0, 500),
                'finished_at' => now(),
            ]);
            $agent->update(['status' => 'error', 'last_run_at' => now()]);
            broadcast(new AgentRunUpdated($agent, $run, 'failed'));
        }
    }

    private function buildSystemPrompt(AiAgent $agent, array $context = []): string
    {
        $basePrompt = $agent->system_prompt ?: $this->defaultSystemPrompt($agent->type);

        $deploymentRules = ($context['event'] ?? null) === 'deployment_failed'
            ? <<<'RULES'

        Contexte d'échec de déploiement :
        - Analyse d'abord les logs fournis et utilise get_deployment_logs si nécessaire.
        - Identifie la cause probable (build, config, healthcheck, réseau, etc.).
        - N'effectue qu'un seul redéploiement automatique maximum.
        - Si la cause est une erreur de configuration utilisateur, documente-la sans boucler sur deploy.
        - Termine par un résumé actionnable pour l'équipe.
        RULES
            : '';

        return <<<PROMPT
        {$basePrompt}

        Tu es un agent IA autonome intégré dans Coolify/DevForge, une plateforme PaaS auto-hébergée.
        Tu as accès à des outils pour surveiller et gérer les ressources de l'équipe.

        Règles importantes :
        - Sois proactif mais prudent : analyse d'abord, agis ensuite.
        - Documente chaque action avec l'outil send_notification.
        - N'arrête une application que si c'est absolument nécessaire.
        - Termine ta mission avec un résumé clair de ce que tu as trouvé et fait.
        - Réponds en français.
        {$deploymentRules}
        PROMPT;
    }

    private function defaultSystemPrompt(string $type): string
    {
        return match ($type) {
            'debug' => 'Tu es un agent de débogage expert. Tu analyses les logs de déploiement, identifies les erreurs, et proposes ou appliques des corrections. Tu surveilles les ressources en erreur et tentes de les redémarrer si approprié.',
            'deployment' => 'Tu es un agent de déploiement. Tu surveilles l\'état des déploiements, détectes les échecs, et tentes automatiquement de redéployer les applications en erreur. Tu respectes les limites de tentatives pour éviter les boucles.',
            'tech-watch' => 'Tu es un agent de veille technologique. Tu surveilles les ressources, identifies les services potentiellement obsolètes ou mal configurés, et signales les points d\'attention sans agir de façon intrusive.',
            'github' => 'Tu es un agent GitHub. Tu surveilles les déploiements liés à des pull requests, vérifies l\'état des previews, et signale les branches obsolètes ou les déploiements en attente.',
            'devforge' => 'Tu es un agent d\'optimisation de plateforme. Tu analyses l\'utilisation des ressources, identifies les ressources inactives ou surdimensionnées, et produis un rapport d\'optimisation.',
            'security' => 'Tu es un agent de sécurité. Tu inspectes les configurations, signale les problèmes potentiels (ports exposés, configurations sensibles), sans jamais afficher les secrets. Tu produis un rapport de sécurité.',
            default => 'Tu es un agent IA généraliste. Tu surveilles les ressources et signales les problèmes détectés.',
        };
    }

    private function buildInitialContext(AiAgent $agent, array $context = []): string
    {
        if (($context['event'] ?? null) === 'deployment_failed') {
            return $this->buildDeploymentFailureContext($agent, $context);
        }

        if (($context['event'] ?? null) === 'deployment_build_started') {
            return $this->buildDeploymentBuildStartedContext($agent, $context);
        }

        $teamName = $agent->team->name;
        $now = now()->format('d/m/Y H:i');

        $resourceContext = $agent->resource_uuid
            ? "Tu as été assigné à la ressource UUID: {$agent->resource_uuid}. Concentre-toi sur cette ressource."
            : "Tu as accès à toutes les ressources de l'équipe.";

        return <<<CONTEXT
        Date et heure actuelles : {$now}
        Équipe : {$teamName}
        Type d'agent : {$agent->type}
        {$resourceContext}

        Effectue ta mission en utilisant les outils disponibles. Commence par lister les ressources pertinentes,
        analyse la situation, et prend les actions nécessaires. Termine avec un résumé.
        CONTEXT;
    }

    /**
     * @param  array<string, mixed>  $context
     */
    private function buildDeploymentFailureContext(AiAgent $agent, array $context): string
    {
        $teamName = $agent->team->name;
        $applicationName = (string) ($context['application_name'] ?? 'Application');
        $applicationUuid = (string) ($context['application_uuid'] ?? '');
        $deploymentUuid = (string) ($context['deployment_uuid'] ?? '');
        $commit = (string) ($context['commit'] ?? 'inconnu');
        $failureExcerpt = json_encode($context['failure_excerpt'] ?? [], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);

        return <<<CONTEXT
        ALERTE : un déploiement vient d'échouer et tu dois tenter de le résoudre.

        Équipe : {$teamName}
        Type d'agent : {$agent->type}
        Application : {$applicationName} ({$applicationUuid})
        Déploiement : {$deploymentUuid}
        Commit : {$commit}

        Extrait des logs d'échec :
        {$failureExcerpt}

        Étapes attendues :
        1. Analyser les logs et confirmer la cause probable.
        2. Vérifier le statut de l'application avec get_resource_status.
        3. Si une correction automatique est possible (ex. redéploiement après erreur transitoire), utilise control_resource avec action deploy UNE SEULE FOIS.
        4. Sinon, produire un diagnostic clair et les actions manuelles recommandées.

        Commence immédiatement ton analyse.
        CONTEXT;
    }

    /**
     * @param  array<string, mixed>  $context
     */
    private function buildDeploymentBuildStartedContext(AiAgent $agent, array $context): string
    {
        $teamName = $agent->team->name;
        $applicationName = (string) ($context['application_name'] ?? 'Application');
        $applicationUuid = (string) ($context['application_uuid'] ?? '');
        $deploymentUuid = (string) ($context['deployment_uuid'] ?? '');
        $commit = (string) ($context['commit'] ?? 'inconnu');
        $buildPack = (string) ($context['build_pack'] ?? 'inconnu');

        $triggerSource = (string) ($context['trigger_source'] ?? ($context['is_webhook'] ?? false ? 'webhook' : 'manual'));

        return <<<CONTEXT
        ÉVÉNEMENT : un déploiement d'application vient de démarrer (source : {$triggerSource}).

        Équipe : {$teamName}
        Type d'agent : {$agent->type}
        Application : {$applicationName} ({$applicationUuid})
        Déploiement : {$deploymentUuid}
        Commit : {$commit}
        Build pack : {$buildPack}

        Mission :
        1. Surveiller l'état du déploiement en cours et des ressources liées.
        2. Si le build échoue ou reste bloqué, analyser les logs et tenter une correction automatique si possible (ex. redéploiement UNE SEULE FOIS).
        3. Identifier les optimisations ou anomalies pertinentes pour la plateforme DevForge.
        4. Produire un rapport concis et actionnable.

        Commence par inspecter le déploiement en cours et le statut de l'application.
        CONTEXT;
    }
}
