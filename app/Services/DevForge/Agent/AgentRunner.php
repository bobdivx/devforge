<?php

namespace App\Services\DevForge\Agent;

use App\Events\AgentRunUpdated;
use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Services\DevForge\Agent\Contracts\LlmResponse;
use App\Services\DevForge\Core\CoreResourceAction;
use App\Services\DevForge\Core\CoreResourceCatalog;
use App\Services\DevForge\DeploymentData;
use App\Services\DevForge\Agent\Tool\IterationBudget;

class AgentRunner
{
    /** @var array<array{role: string, content: string}> */
    private array $messages = [];

    private bool $toolNudgeUsed = false;

    public function __construct(
        private readonly LlmProviderFactory $providerFactory,
        private readonly CoreResourceCatalog $catalog,
        private readonly CoreResourceAction $resourceAction,
        private readonly DeploymentData $deploymentData,
        private readonly AgentPromptBuilder $promptBuilder,
    ) {}

    public function run(AiAgent $agent, AiAgentRun $run, array $context = []): void
    {
        $this->toolNudgeUsed = false;
        $providerConfig = $agent->effectiveProviderConfig();

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
        $delegator = new AgentDelegator($this, new \App\Services\DevForge\Agent\Tool\AgentSubagentRegistry);
        $toolkit = new AgentToolkit(
            team: $agent->team,
            run: $run,
            catalog: $this->catalog,
            resourceAction: $this->resourceAction,
            deploymentData: $this->deploymentData,
            agent: $agent,
            assignedResourceUuid: $agent->resource_uuid,
            runContext: $context,
            delegator: $delegator,
        );

        $this->messages = [
            ['role' => 'system', 'content' => $this->promptBuilder->autonomousSystemPrompt($agent, $context)],
            ['role' => 'user', 'content' => $this->promptBuilder->autonomousInitialMessage($agent, $context, $run->trigger)],
        ];

        $run->update(['status' => 'running', 'started_at' => now()]);
        $run->appendLog('Agent démarré — provider: '.$providerConfig->provider.'/Auto');

        $budget = new IterationBudget((int) config('devforge.agents_max_iterations', 30));
        $summary = '';

        try {
            while ($budget->consume()) {
                $iterations = $budget->getUsed();
                $run->appendLog("Itération #{$iterations}...");

                broadcast(new AgentRunUpdated($agent, $run, "Itération #{$iterations}"));

                /** @var LlmResponse $response */
                $response = $provider->chat($this->messages, $toolkit->definitions());

                $run->update([
                    'tokens_used' => $run->tokens_used + $response->tokensUsed,
                    'iterations' => $iterations,
                ]);

                if ($response->text) {
                    $run->appendLog("Raisonnement: {$response->text}");
                    $summary = $response->text;
                }

                if (! $response->hasToolCalls()) {
                    if ($iterations === 1 && ! $this->toolNudgeUsed) {
                        $this->toolNudgeUsed = true;
                        $this->messages[] = ['role' => 'assistant', 'content' => $response->text ?: 'En attente d\'action.'];
                        $this->messages[] = ['role' => 'user', 'content' => AgentDirectives::toolNudgeMessage()];
                        $run->appendLog('Relance autonome : premier tour sans outil — nouvelle consigne envoyée.');
                        continue;
                    }

                    $run->appendLog('Agent terminé — aucun appel d\'outil supplémentaire.');
                    break;
                }

                $toolResults = [];
                $hadToolFailure = false;
                foreach ($response->toolCalls as $toolCall) {
                    $result = $toolkit->execute($toolCall['name'], $toolCall['arguments']);
                    if (isset($result['error'])) {
                        $hadToolFailure = true;
                    }
                    $toolResults[] = [
                        'name' => $toolCall['name'],
                        'result' => $result,
                    ];
                }

                if (! $hadToolFailure) {
                    $budget->refund();
                }

                AgentToolTurnBuilder::append($this->messages, $response, $toolResults);
            }

            if ($budget->getRemaining() === 0) {
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
}
