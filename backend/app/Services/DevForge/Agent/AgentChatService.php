<?php

namespace App\Services\DevForge\Agent;

use App\Jobs\Agent\RunAgentChatJob;
use App\Models\AiAgent;
use App\Models\AiAgentMessage;
use App\Models\AiAgentRun;
use App\Models\AiAgentSession;
use App\Models\User;
use App\Services\DevForge\Agent\Contracts\LlmResponse;
use App\Services\DevForge\Agent\Tool\AgentSubagentRegistry;
use App\Services\DevForge\Agent\Tool\AgentToolApprovalGrant;
use App\Services\DevForge\Agent\Tool\IterationBudget;
use App\Services\DevForge\Core\CoreResourceAction;
use App\Services\DevForge\Core\CoreResourceCatalog;
use App\Services\DevForge\DeploymentData;
use Illuminate\Support\Collection;

class AgentChatService
{
    private const MAX_HISTORY = 30;

    public function __construct(

        private readonly LlmProviderFactory $providerFactory,

        private readonly CoreResourceCatalog $catalog,

        private readonly CoreResourceAction $resourceAction,

        private readonly DeploymentData $deploymentData,

        private readonly AgentPromptBuilder $promptBuilder,

        private readonly TaskModelRouter $taskModelRouter,

        private readonly AgentSessionService $sessionService,

    ) {}

    /**
     * @return Collection<int, AiAgentMessage>
     */
    public function history(AiAgent $agent, AiAgentSession $session): Collection
    {

        return AiAgentMessage::query()

            ->where('agent_id', $agent->id)

            ->where('session_id', $session->id)

            ->orderBy('created_at')

            ->limit(self::MAX_HISTORY)

            ->get();

    }

    /**
     * @param  array<string, mixed>  $context
     * @return array{user: AiAgentMessage, run: AiAgentRun}
     */
    public function queueMessage(AiAgent $agent, AiAgentSession $session, string $content, array $context = []): array
    {

        $agent->loadMissing(['team', 'providerConfig']);

        if (! $agent->hasLlmProvider()) {

            throw new \InvalidArgumentException('Aucun provider LLM configuré pour cet agent.');
        }

        $trimmed = trim($content);

        $this->sessionService->autoTitleFromMessage($session, $trimmed);

        $userMessage = AiAgentMessage::create([

            'agent_id' => $agent->id,

            'session_id' => $session->id,

            'role' => 'user',

            'content' => $trimmed,

        ]);

        $run = AiAgentRun::create([

            'agent_id' => $agent->id,

            'session_id' => $session->id,

            'status' => 'running',

            'trigger' => 'chat',

            'started_at' => now(),

            'metadata' => $this->initialChatMetadata($context),

        ]);

        $session->touchLastMessage();

        $agent->update(['status' => 'running']);

        RunAgentChatJob::dispatch($agent, $run, $userMessage);

        return [

            'user' => $userMessage,

            'run' => $run,

        ];

    }

    public function processQueuedRun(AiAgent $agent, AiAgentRun $run, AiAgentMessage $userMessage): AiAgentMessage
    {

        try {

            $reply = $this->generateReply($agent, $run, $userMessage);

            $metadata = [

                'tokens_used' => $reply['tokens_used'],

                'iterations' => $reply['iterations'],

            ];

            if (isset($reply['pending_approval']) && is_array($reply['pending_approval'])) {

                $metadata['pending_approval'] = $reply['pending_approval'];

            }

            if (isset($reply['steps']) && is_array($reply['steps']) && $reply['steps'] !== []) {

                $metadata['steps'] = $reply['steps'];

            }

            $assistantMessage = AiAgentMessage::create([

                'agent_id' => $agent->id,

                'session_id' => $userMessage->session_id,

                'run_id' => $run->id,

                'role' => 'assistant',

                'content' => $reply['text'],

                'metadata' => $metadata,

            ]);

            $runStatus = isset($reply['pending_approval']) ? 'awaiting_approval' : 'completed';

            $run->update([

                'status' => $runStatus,

                'summary' => mb_substr($reply['text'], 0, 500),

                'tokens_used' => $reply['tokens_used'],

                'iterations' => $reply['iterations'],

                'finished_at' => now(),

            ]);

            if ($userMessage->session_id !== null) {

                AiAgentSession::query()

                    ->whereKey($userMessage->session_id)

                    ->update(['last_message_at' => now()]);

            }

            $agent->update(['status' => 'idle', 'last_run_at' => now()]);

            return $assistantMessage;

        } catch (\Throwable $exception) {

            $run->appendLog('Erreur: '.$exception->getMessage());

            $run->update([

                'status' => 'failed',

                'summary' => 'Erreur: '.mb_substr($exception->getMessage(), 0, 500),

                'finished_at' => now(),

            ]);

            $agent->update(['status' => 'error', 'last_run_at' => now()]);

            throw $exception;
        }

    }

    /**
     * @return array{user: AiAgentMessage, assistant: AiAgentMessage}
     *

     * @deprecated Prefer queueMessage() for HTTP requests.
     */
    public function send(AiAgent $agent, User $user, AiAgentSession $session, string $content): array
    {

        $queued = $this->queueMessage($agent, $session, $content);

        $assistantMessage = $this->processQueuedRun($agent, $queued['run'], $queued['user']);

        return [

            'user' => $queued['user'],

            'assistant' => $assistantMessage,

        ];

    }

    /**
     * Approve or deny a pending tool permission ask from chat UI.
     *
     * @return array{user: AiAgentMessage, run: AiAgentRun, decision: string}
     */
    public function resolveToolApproval(AiAgent $agent, AiAgentMessage $message, string $decision): array
    {
        $decision = strtolower(trim($decision));
        if (! in_array($decision, ['approve', 'deny'], true)) {
            throw new \InvalidArgumentException('Décision invalide (approve|deny).');
        }

        $metadata = is_array($message->metadata) ? $message->metadata : [];
        $pending = is_array($metadata['pending_approval'] ?? null) ? $metadata['pending_approval'] : null;

        if ($pending === null || ($pending['status'] ?? '') !== 'ask') {
            throw new \InvalidArgumentException('Aucun outil en attente d’approbation sur ce message.');
        }

        if (! empty($pending['resolved'])) {
            throw new \InvalidArgumentException('Cette demande d’approbation a déjà été traitée.');
        }

        $session = $message->session;
        if (! $session instanceof AiAgentSession) {
            throw new \InvalidArgumentException('Message sans session associée.');
        }

        $tool = (string) ($pending['tool'] ?? 'outil');
        $approvalKey = (string) ($pending['approval_key'] ?? '');

        $pending['resolved'] = $decision === 'approve' ? 'approved' : 'denied';
        $pending['resolved_at'] = now()->toISOString();
        $metadata['pending_approval'] = $pending;
        $message->update(['metadata' => $metadata]);

        if ($message->run_id !== null) {
            AiAgentRun::query()->whereKey($message->run_id)->update(['status' => 'completed']);
        }

        if ($decision === 'approve') {
            if ($approvalKey === '') {
                throw new \InvalidArgumentException('Clé d’approbation manquante.');
            }

            AgentToolApprovalGrant::grant((int) $session->id, $approvalKey);
            $prompt = "J'approuve l'exécution de l'outil « {$tool} ». Réessaie maintenant avec les mêmes paramètres.";
        } else {
            $prompt = "Je refuse l'exécution de l'outil « {$tool} ». Continues sans l'exécuter et propose une alternative si possible.";
        }

        $queued = $this->queueMessage($agent, $session, $prompt);

        return [
            'user' => $queued['user'],
            'run' => $queued['run'],
            'decision' => $decision,
        ];
    }

    /**
     * @return array{text: string, tokens_used: int, iterations: int, pending_approval?: array<string, mixed>}
     */
    private function generateReply(AiAgent $agent, AiAgentRun $run, AiAgentMessage $userMessage): array
    {

        $userContent = trim($userMessage->content);

        $tier = $this->taskModelRouter->classify($userContent, 'chat', $agent->type, []);

        $reason = $this->taskModelRouter->reason($userContent, 'chat', $agent->type, [], $tier);

        $routing = $this->taskModelRouter->routingPayload($tier, $reason);

        $run->mergeMetadata(['model_routing' => $routing]);

        $run->appendLog('Chat — '.$routing['display'].' ('.$routing['tier_label'].') : '.$reason);

        $provider = $this->providerFactory->makeForAgent(

            $agent,

            function (\Throwable $exception, string $primaryLabel, string $fallbackLabel) use ($run): void {

                $run->appendLog("Provider {$primaryLabel} indisponible, bascule vers {$fallbackLabel}.");

            },

            config('devforge.agents_smart_routing', true) ? $tier : null,

        );

        $delegator = new AgentDelegator(

            app(AgentRunner::class),

            app(AgentSubagentRegistry::class),

            $this->taskModelRouter,

        );

        $chatContext = is_array($run->metadata) ? $run->metadata : [];

        $runContext = array_filter([

            'application_uuid' => is_string($chatContext['application_uuid'] ?? null)

                ? $chatContext['application_uuid']

                : null,

        ], fn (?string $value): bool => $value !== null && $value !== '');

        $toolkit = new AgentToolkit(

            team: $agent->team,

            run: $run,

            catalog: $this->catalog,

            resourceAction: $this->resourceAction,

            deploymentData: $this->deploymentData,

            agent: $agent,

            assignedResourceUuid: $agent->resource_uuid,

            delegator: $delegator,

            runContext: $runContext,

        );

        $session = $userMessage->session;

        if (! $session instanceof AiAgentSession) {

            throw new \RuntimeException('Message de chat sans session associée.');
        }

        $history = $this->history($agent, $session);

        $messages = [

            ['role' => 'system', 'content' => $this->promptBuilder->chatSystemPrompt($agent, $userContent, $chatContext)],

            ...$history->map(fn (AiAgentMessage $message): array => [

                'role' => $message->role === 'assistant' ? 'assistant' : 'user',

                'content' => $message->content,

            ])->all(),

        ];

        $budget = new IterationBudget((int) config('devforge.agents_chat_max_iterations', 20));

        $tokensUsed = 0;

        $summary = '';

        $toolNudgeUsed = false;

        $confirmationNudgeUsed = false;

        $proseToolNudgeUsed = false;

        $toolsUsedThisTurn = false;

        /** @var list<array<string, mixed>> $steps */
        $steps = [];

        while ($budget->consume()) {

            $iterations = $budget->getUsed();

            $run->appendLog("Itération chat #{$iterations}...");

            /** @var LlmResponse $response */
            $response = $provider->chat($messages, $toolkit->definitions());

            $tokensUsed += $response->tokensUsed;

            if ($response->text) {

                $summary = $response->text;

            }

            if (! $response->hasToolCalls()) {

                // Intention réparation + aucun tool_call → exécution déterministe (ne dépend pas du LLM).
                if ($steps === [] && AgentDirectives::isChatRepairIntent($userContent)) {
                    $run->appendLog('Fallback chat : intention réparation sans tool_call — exécution autonome forcée.');

                    $harness = app(AgentRepairHarness::class)->execute(
                        $toolkit,
                        $agent,
                        $run,
                        $runContext,
                        $userContent,
                    );

                    return [
                        'text' => $harness['text'],
                        'tokens_used' => $tokensUsed,
                        'iterations' => $budget->getUsed(),
                        'steps' => $harness['steps'],
                        ...isset($harness['pending_approval']) ? ['pending_approval' => $harness['pending_approval']] : [],
                    ];
                }

                if (! $toolNudgeUsed && ! $toolsUsedThisTurn) {

                    $toolNudgeUsed = true;

                    $messages[] = ['role' => 'assistant', 'content' => $response->text ?: 'En attente d\'action.'];

                    $messages[] = ['role' => 'user', 'content' => AgentDirectives::chatToolNudgeMessage($userContent)];

                    $run->appendLog('Relance chat : premier tour sans outil — consigne d\'action envoyée.');

                    continue;

                }

                if (! $proseToolNudgeUsed && AgentDirectives::mentionsToolWithoutCalling($response->text)) {

                    $proseToolNudgeUsed = true;

                    $messages[] = ['role' => 'assistant', 'content' => $response->text];

                    $messages[] = ['role' => 'user', 'content' => AgentDirectives::chatProseToolNudgeMessage()];

                    $run->appendLog('Relance chat : outils décrits en texte — consigne tool_call forcée.');

                    continue;

                }

                if (! $confirmationNudgeUsed && AgentDirectives::defersToUser($response->text)) {

                    $confirmationNudgeUsed = true;

                    $messages[] = ['role' => 'assistant', 'content' => $response->text];

                    $messages[] = ['role' => 'user', 'content' => AgentDirectives::chatConfirmationNudgeMessage()];

                    $run->appendLog('Relance chat : demande de confirmation détectée — consigne d\'exécution immédiate.');

                    continue;

                }

                break;

            }

            $toolsUsedThisTurn = true;

            $toolResults = [];

            $hadToolFailure = false;

            $pendingApproval = null;

            foreach ($response->toolCalls as $toolCall) {

                if ($pendingApproval !== null) {

                    $toolResults[] = [

                        'name' => $toolCall['name'],

                        'result' => [

                            'error' => 'En attente d’approbation d’un outil précédent — exécution reportée.',

                            'skipped' => true,

                        ],

                    ];

                    $hadToolFailure = true;

                    $steps[] = [
                        'type' => 'tool',
                        'name' => (string) $toolCall['name'],
                        'args_summary' => $this->summarizeToolArgs($toolCall['arguments'] ?? []),
                        'result_summary' => 'Reporté (approbation en cours)',
                        'status' => 'skipped',
                    ];

                    continue;

                }

                $result = $toolkit->execute($toolCall['name'], $toolCall['arguments']);

                if (isset($result['error'])) {

                    $hadToolFailure = true;

                }

                if (($result['status'] ?? null) === 'ask' || ! empty($result['pending_approval'])) {

                    $pendingApproval = [

                        'status' => 'ask',

                        'tool' => (string) ($result['tool'] ?? $toolCall['name']),

                        'reason' => (string) ($result['reason'] ?? 'Approbation requise.'),

                        'rule_id' => (string) ($result['rule_id'] ?? ''),

                        'approval_key' => (string) ($result['approval_key'] ?? ''),

                    ];

                }

                $toolResults[] = [

                    'name' => $toolCall['name'],

                    'result' => $result,

                ];

                $steps[] = [
                    'type' => 'tool',
                    'name' => (string) $toolCall['name'],
                    'args_summary' => $this->summarizeToolArgs($toolCall['arguments'] ?? []),
                    'result_summary' => $this->summarizeToolResult($result),
                    'status' => isset($result['error'])
                        ? 'error'
                        : (($result['status'] ?? null) === 'ask' || ! empty($result['pending_approval']) ? 'awaiting_approval' : 'done'),
                ];

            }

            if (! $hadToolFailure) {

                $budget->refund();

            }

            AgentToolTurnBuilder::append($messages, $response, $toolResults);

            if ($pendingApproval !== null) {

                $toolLabel = $pendingApproval['tool'];

                $summary = "⏸ Approbation requise pour l’outil **{$toolLabel}**.\n\n"
                    .$pendingApproval['reason']
                    ."\n\nUtilisez Approuver ou Refuser pour continuer.";

                $run->appendLog("Chat en pause — approbation requise pour « {$toolLabel} ».");

                return [

                    'text' => $summary,

                    'tokens_used' => $tokensUsed,

                    'iterations' => $budget->getUsed(),

                    'pending_approval' => $pendingApproval,

                    'steps' => $steps,

                ];

            }

        }

        $iterations = $budget->getUsed();

        if ($summary === '') {
            $summary = 'Je n\'ai pas pu générer de réponse.';
        }

        $summary = $this->sanitizeAssistantReply($summary, $steps);

        if ($steps === [] && AgentDirectives::isChatRepairIntent($userContent)) {
            $run->appendLog('Fallback chat : réponse sans outils après boucle — exécution autonome forcée.');

            $harness = app(AgentRepairHarness::class)->execute(
                $toolkit,
                $agent,
                $run,
                $runContext,
                $userContent,
            );

            return [
                'text' => $harness['text'],
                'tokens_used' => $tokensUsed,
                'iterations' => $iterations,
                'steps' => $harness['steps'],
                ...isset($harness['pending_approval']) ? ['pending_approval' => $harness['pending_approval']] : [],
            ];
        }

        return [
            'text' => $summary,
            'tokens_used' => $tokensUsed,
            'iterations' => $iterations,
            'steps' => $steps,
        ];
    }

    /**
     * @param  list<array<string, mixed>>  $steps
     */
    private function sanitizeAssistantReply(string $text, array $steps): string
    {
        $cleaned = preg_replace('/```(?:json)?\s*\{[\s\S]*?\}\s*```/u', '', $text) ?? $text;
        $cleaned = preg_replace('/^\s*\{[^{}]*"method"\s*:\s*"[^"]+"[^{}]*\}\s*$/mu', '', $cleaned) ?? $cleaned;
        $cleaned = trim(preg_replace("/\n{3,}/", "\n\n", $cleaned) ?? $cleaned);

        if ($steps !== [] && ($cleaned === '' || AgentDirectives::mentionsToolWithoutCalling($cleaned))) {
            return 'Actions exécutées. Voir le détail ci-dessus.';
        }

        if ($steps === [] && AgentDirectives::mentionsToolWithoutCalling($cleaned)) {
            return 'Les actions n’ont pas été exécutées (description d’outil au lieu d’un appel réel). Réessayez avec une consigne plus directe, par exemple « corrige le déploiement maintenant ».';
        }

        return $cleaned !== '' ? $cleaned : $text;
    }

    /**
     * @param  array<string, mixed>  $arguments
     */
    private function summarizeToolArgs(array $arguments): string
    {
        $parts = [];
        foreach ($arguments as $key => $value) {
            if (! is_scalar($value) && $value !== null) {
                continue;
            }
            $parts[] = $key.'='.mb_substr((string) $value, 0, 48);
            if (count($parts) >= 3) {
                break;
            }
        }

        return implode(', ', $parts);
    }

    /**
     * @param  array<string, mixed>  $result
     */
    private function summarizeToolResult(array $result): string
    {
        if (isset($result['error']) && is_string($result['error'])) {
            return mb_substr($result['error'], 0, 160);
        }

        if (($result['status'] ?? null) === 'ask' || ! empty($result['pending_approval'])) {
            return 'Approbation requise';
        }

        if (isset($result['ok']) && $result['ok'] === true) {
            $hint = is_string($result['hint'] ?? null) ? $result['hint'] : null;

            return $hint !== null ? mb_substr($hint, 0, 160) : 'OK';
        }

        if (is_string($result['message'] ?? null)) {
            return mb_substr($result['message'], 0, 160);
        }

        if (is_string($result['deployment_uuid'] ?? null)) {
            return 'Déploiement '.$result['deployment_uuid'];
        }

        return 'Terminé';
    }

    /**
     * @param  array<string, mixed>  $context
     * @return array<string, string>|null
     */
    private function initialChatMetadata(array $context): ?array
    {
        $metadata = array_filter([
            'application_uuid' => is_string($context['application_uuid'] ?? null) ? $context['application_uuid'] : null,
            'application_name' => is_string($context['application_name'] ?? null) ? $context['application_name'] : null,
            'git_repository' => is_string($context['git_repository'] ?? null) ? $context['git_repository'] : null,
            'git_branch' => is_string($context['git_branch'] ?? null) ? $context['git_branch'] : null,
            'build_pack' => is_string($context['build_pack'] ?? null) ? $context['build_pack'] : null,
            'fqdn' => is_string($context['fqdn'] ?? null) ? $context['fqdn'] : null,
        ], fn (?string $value): bool => $value !== null && $value !== '');

        return $metadata === [] ? null : $metadata;
    }
}
