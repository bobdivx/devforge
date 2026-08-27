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
        $attachments = $context['attachments'] ?? null;
        if (is_array($attachments) && $attachments !== []) {
            $trimmed = app(AgentChatAttachments::class)->appendToContent($trimmed, $attachments);
        }

        if ($trimmed === '') {
            throw new \InvalidArgumentException('Message vide.');
        }

        if (isset($context['chat_mode'])) {
            $session->update([
                'chat_mode' => AgentChatMode::parse($context['chat_mode']),
            ]);
            $session->refresh();
        }

        $this->sessionService->autoTitleFromMessage($session, $trimmed);

        $userMessage = AiAgentMessage::create([

            'agent_id' => $agent->id,

            'session_id' => $session->id,

            'role' => 'user',

            'content' => $trimmed,

            'metadata' => array_filter([
                'attachments' => is_array($attachments) && $attachments !== [] ? array_slice($attachments, 0, 8) : null,
                'chat_mode' => AgentChatMode::parse($session->chat_mode ?? ($context['chat_mode'] ?? 'build')),
            ]),

        ]);

        $run = AiAgentRun::create([

            'agent_id' => $agent->id,

            'session_id' => $session->id,

            'status' => 'running',

            'trigger' => 'chat',

            'started_at' => now(),

            'metadata' => $this->initialChatMetadata($context, $session),

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

            $reply = app(RigAgentClient::class)->enabled()
                ? app(RigChatRuntime::class)->completeFromChat($agent, $run, $userMessage, $this->promptBuilder)
                : $this->generateReply($agent, $run, $userMessage);

            $run->refresh();
            if ($run->status === AgentRunCancellation::STATUS || ! empty($reply['cancelled'])) {
                $assistantMessage = AiAgentMessage::create([
                    'agent_id' => $agent->id,
                    'session_id' => $userMessage->session_id,
                    'run_id' => $run->id,
                    'role' => 'assistant',
                    'content' => (string) ($reply['text'] ?? 'Run annulé.'),
                    'metadata' => [
                        'tokens_used' => $reply['tokens_used'] ?? 0,
                        'iterations' => $reply['iterations'] ?? 0,
                        'steps' => $reply['steps'] ?? [],
                        'cancelled' => true,
                    ],
                ]);
                $agent->update(['status' => 'idle', 'last_run_at' => now()]);

                return $assistantMessage;
            }

            $metadata = [

                'tokens_used' => $reply['tokens_used'],

                'iterations' => $reply['iterations'],

            ];

            if (isset($reply['pending_approval']) && is_array($reply['pending_approval'])) {

                $metadata['pending_approval'] = $reply['pending_approval'];

            }

            if (isset($reply['pending_plan']) && is_array($reply['pending_plan'])) {

                $metadata['pending_plan'] = $reply['pending_plan'];

            }

            if (isset($reply['steps']) && is_array($reply['steps']) && $reply['steps'] !== []) {

                $metadata['steps'] = $reply['steps'];

            }

            if (isset($reply['long_task_id'])) {

                $metadata['long_task_id'] = $reply['long_task_id'];

            }

            $assistantMessage = AiAgentMessage::create([

                'agent_id' => $agent->id,

                'session_id' => $userMessage->session_id,

                'run_id' => $run->id,

                'role' => 'assistant',

                'content' => $reply['text'],

                'metadata' => $metadata,

            ]);

            $runStatus = (isset($reply['pending_approval']) || isset($reply['pending_plan']))
                ? 'awaiting_approval'
                : (! empty($reply['waiting_for_subagents']) ? 'waiting_for_subagents' : 'completed');

            $run->refresh();
            if ($run->status === AgentRunCancellation::STATUS) {
                $agent->update(['status' => 'idle', 'last_run_at' => now()]);

                return $assistantMessage;
            }
            if ($run->status === 'waiting_for_subagents' && ! empty($reply['waiting_for_subagents'])) {
                // yield_wait a déjà posé le statut — ne pas écraser en completed
                $run->update([
                    'summary' => mb_substr($reply['text'], 0, 500),
                    'tokens_used' => $reply['tokens_used'],
                    'iterations' => $reply['iterations'],
                ]);
            } else {
                $run->update([
                    'status' => $runStatus,
                    'summary' => mb_substr($reply['text'], 0, 500),
                    'tokens_used' => $reply['tokens_used'],
                    'iterations' => $reply['iterations'],
                    'finished_at' => now(),
                ]);
            }

            if ($userMessage->session_id !== null) {

                AiAgentSession::query()

                    ->whereKey($userMessage->session_id)

                    ->update(['last_message_at' => now()]);

            }

            $agent->update(['status' => 'idle', 'last_run_at' => now()]);

            return $assistantMessage;

        } catch (\Throwable $exception) {

            $run->refresh();
            if ($run->status === AgentRunCancellation::STATUS) {
                $agent->update(['status' => 'idle', 'last_run_at' => now()]);

                throw $exception;
            }

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
    public function resolveToolApproval(AiAgent $agent, AiAgentMessage $message, string $decision, bool $remember = false): array
    {
        $decision = strtolower(trim($decision));
        if (! in_array($decision, ['approve', 'deny'], true)) {
            throw new \InvalidArgumentException('Décision invalide (approve|deny).');
        }

        $metadata = is_array($message->metadata) ? $message->metadata : [];
        $pendingPlan = is_array($metadata['pending_plan'] ?? null) ? $metadata['pending_plan'] : null;

        if ($pendingPlan !== null && ($pendingPlan['status'] ?? '') === 'ask' && empty($pendingPlan['resolved'])) {
            return $this->resolvePlanApproval($agent, $message, $decision, $pendingPlan, $metadata);
        }

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
            if ($remember) {
                AgentToolApprovalGrant::rememberTool((int) $session->id, $tool);
            }
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
     * @param  array<string, mixed>  $pendingPlan
     * @param  array<string, mixed>  $metadata
     * @return array{user: AiAgentMessage, run: AiAgentRun, decision: string}
     */
    private function resolvePlanApproval(
        AiAgent $agent,
        AiAgentMessage $message,
        string $decision,
        array $pendingPlan,
        array $metadata,
    ): array {
        $session = $message->session;
        if (! $session instanceof AiAgentSession) {
            throw new \InvalidArgumentException('Message sans session associée.');
        }

        $title = (string) ($pendingPlan['title'] ?? 'Plan');

        $pendingPlan['resolved'] = $decision === 'approve' ? 'approved' : 'denied';
        $pendingPlan['resolved_at'] = now()->toISOString();
        $metadata['pending_plan'] = $pendingPlan;
        $message->update(['metadata' => $metadata]);

        if ($message->run_id !== null) {
            $run = AiAgentRun::query()->whereKey($message->run_id)->first();
            if ($run instanceof AiAgentRun) {
                $plan = is_array($run->metadata['plan'] ?? null) ? $run->metadata['plan'] : [];
                $plan['status'] = $decision === 'approve' ? 'approved' : 'rejected';
                $plan['resolved_at'] = now()->toISOString();
                $run->mergeMetadata(['plan' => $plan]);
                $run->update(['status' => 'completed']);
            }
        }

        if ($decision === 'approve') {
            AgentToolApprovalGrant::grantPlanExecution((int) $session->id);
            $prompt = "J'approuve le plan « {$title} ». Exécute-le maintenant étape par étape avec les outils nécessaires.";
        } else {
            AgentToolApprovalGrant::revokePlanExecution((int) $session->id);
            $prompt = "Je refuse le plan « {$title} ». Propose une alternative ou reformule l'approche.";
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
            function (array $report) use ($run): void {
                $run->appendLog('Diagnostic '.(string) ($report['provider'] ?? 'llm').' : '.(string) ($report['summary'] ?? ''));
                foreach (array_slice($report['lines'] ?? [], 0, 6) as $line) {
                    if (is_string($line) && $line !== '') {
                        $run->appendLog($line);
                    }
                }
            },
        );

        $delegator = new AgentDelegator(

            app(AgentRunner::class),

            app(AgentSubagentRegistry::class),

            $this->taskModelRouter,

        );

        $chatContext = is_array($run->metadata) ? $run->metadata : [];

        $session = $userMessage->session;

        if (! $session instanceof AiAgentSession) {

            throw new \RuntimeException('Message de chat sans session associée.');
        }

        $runContext = array_filter([

            'application_uuid' => is_string($chatContext['application_uuid'] ?? null)

                ? $chatContext['application_uuid']

                : null,

            'chat_mode' => AgentChatMode::parse(
                $chatContext['chat_mode'] ?? $session->chat_mode ?? 'build'
            ),

            'user_email' => is_string($chatContext['user_email'] ?? null)

                ? $chatContext['user_email']

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

        $history = $this->history($agent, $session);

        $compactor = app(AgentContextCompactor::class);

        $messages = [

            ['role' => 'system', 'content' => $this->promptBuilder->chatSystemPrompt($agent, $userContent, [
                ...$chatContext,
                'chat_mode' => $runContext['chat_mode'] ?? 'build',
            ])],

            ...$history->map(function (AiAgentMessage $message) use ($compactor): array {
                $content = $message->content;
                if ($message->role === 'assistant') {
                    $content = $compactor->enrichAssistantContent(
                        $content,
                        is_array($message->metadata) ? $message->metadata : null,
                    );
                }

                return [
                    'role' => $message->role === 'assistant' ? 'assistant' : 'user',
                    'content' => $content,
                ];
            })->all(),

        ];

        $messages = $compactor->compact(
            $messages,
            (int) config('devforge.agents_chat_context_max_chars', 48000),
        );

        $budget = new IterationBudget((int) config('devforge.agents_chat_max_iterations', 40));

        $tokensUsed = 0;

        $summary = '';

        $toolNudgeUsed = false;

        $confirmationNudgeUsed = false;

        $proseToolNudgeUsed = false;

        $toolsUsedThisTurn = false;

        /** @var list<string> $toolsUsedThisRun */
        $toolsUsedThisRun = [];

        $continueNudges = 0;

        $maxContinueNudges = (int) config('devforge.agents_chat_max_continue_nudges', 4);

        $reachedDone = false;

        $untilDone = app(AgentUntilDonePolicy::class);

        /** @var list<array<string, mixed>> $steps */
        $steps = [];

        while ($budget->consume()) {

            if (app(AgentRunCancellation::class)->wasRequested($run)) {
                $run->appendLog('Arrêt chat : annulation demandée.');

                return [
                    'text' => 'Run annulé.',
                    'tokens_used' => $tokensUsed,
                    'iterations' => $budget->getUsed(),
                    'steps' => $steps,
                    'cancelled' => true,
                ];
            }

            $iterations = $budget->getUsed();

            $run->appendLog("Itération chat #{$iterations}...");

            /** @var LlmResponse $response */
            $response = $provider->chat($messages, $toolkit->definitions());

            $tokensUsed += $response->tokensUsed;

            if ($response->text) {

                $summary = $response->text;
                $run->mergeMetadata([
                    'live_assistant_text' => mb_substr($summary, 0, 4000),
                    'steps' => $steps,
                ]);
                $run->update([
                    'summary' => mb_substr($summary, 0, 1000),
                    'iterations' => $iterations,
                    'tokens_used' => $tokensUsed,
                ]);

            }

            if (! $response->hasToolCalls()) {

                $recoveredCalls = AgentDirectives::extractProseToolCalls($response->text);
                if ($recoveredCalls !== []) {
                    $run->appendLog('Chat : tool_calls récupérés depuis prose/JSON ('.count($recoveredCalls).').');
                    $response = new LlmResponse(
                        text: (string) ($response->text ?? ''),
                        toolCalls: $recoveredCalls,
                        tokensUsed: $response->tokensUsed,
                        isFinished: $response->isFinished,
                    );
                }
            }

            if (! $response->hasToolCalls()) {

                if (
                    AgentDirectives::isChatRepairIntent($userContent)
                    && ! AgentChatRepairStrategy::stepsIncludeCorrectiveAction($steps)
                    && ! AgentChatRepairStrategy::hasRecordedCorrection($run->metadata['correction_actions'] ?? null)
                ) {
                    $run->appendLog('Fallback chat : intention réparation sans correction — exécution autonome forcée.');

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
                        'steps' => [...$steps, ...$harness['steps']],
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

                if (
                    $proseToolNudgeUsed
                    && AgentDirectives::mentionsToolWithoutCalling($response->text)
                    && AgentDirectives::isChatRepairIntent($userContent)
                    && ! AgentChatRepairStrategy::stepsIncludeCorrectiveAction($steps)
                ) {
                    $run->appendLog('Fallback chat : prose outils persistante — harness forcé.');

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
                        'steps' => [...$steps, ...$harness['steps']],
                        ...isset($harness['pending_approval']) ? ['pending_approval' => $harness['pending_approval']] : [],
                    ];
                }

                if (! $confirmationNudgeUsed && AgentDirectives::defersToUser($response->text)) {

                    $confirmationNudgeUsed = true;

                    $messages[] = ['role' => 'assistant', 'content' => $response->text];

                    $messages[] = ['role' => 'user', 'content' => AgentDirectives::chatConfirmationNudgeMessage()];

                    $run->appendLog('Relance chat : demande de confirmation détectée — consigne d\'exécution immédiate.');

                    continue;

                }

                $decision = $untilDone->decide(
                    $userContent,
                    (string) ($response->text ?? ''),
                    $toolsUsedThisRun,
                    $continueNudges,
                    $maxContinueNudges,
                );

                if ($decision['continue'] === true) {
                    $continueNudges++;
                    $messages[] = ['role' => 'assistant', 'content' => $response->text ?: '…'];
                    $messages[] = ['role' => 'user', 'content' => $decision['nudge'] ?? AgentDirectives::chatToolNudgeMessage($userContent)];
                    $run->appendLog('Until-done : '.$decision['reason']." (nudge {$continueNudges}/{$maxContinueNudges}).");

                    continue;
                }

                if ($decision['reason'] === 'done') {
                    $reachedDone = true;
                    $summary = $untilDone->stripDoneMarker((string) ($response->text ?? $summary));
                }

                break;

            }

            $toolsUsedThisTurn = true;

            $toolResults = [];

            $hadToolFailure = false;

            $pendingApproval = null;

            $pendingPlan = null;

            foreach ($response->toolCalls as $toolCall) {

                $toolsUsedThisRun[] = (string) $toolCall['name'];

                if ($pendingApproval !== null || $pendingPlan !== null) {

                    $toolResults[] = [

                        'name' => $toolCall['name'],

                        'result' => [

                            'error' => 'En attente d’approbation — exécution reportée.',

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

                    if (is_array($result['diff_preview'] ?? null)) {

                        $pendingApproval['diff_preview'] = $result['diff_preview'];

                    }

                }

                if (! empty($result['pending_plan']) && is_array($result['plan'] ?? null)) {

                    $plan = $result['plan'];

                    $pendingPlan = [

                        'status' => 'ask',

                        'title' => (string) ($plan['title'] ?? 'Plan'),

                        'summary' => (string) ($plan['summary'] ?? ''),

                        'steps' => is_array($plan['steps'] ?? null) ? $plan['steps'] : [],

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
                        : (($result['status'] ?? null) === 'ask' || ! empty($result['pending_approval']) || ! empty($result['pending_plan'])
                            ? 'awaiting_approval'
                            : 'done'),
                ];

            }

            $run->mergeMetadata(['steps' => $steps]);
            $run->update([
                'iterations' => $budget->getUsed(),
                'tokens_used' => $tokensUsed,
            ]);

            if (! $hadToolFailure) {

                $budget->refund();

            }

            AgentToolTurnBuilder::append($messages, $response, $toolResults);

            if ($pendingPlan !== null) {

                $planTitle = $pendingPlan['title'];

                $summary = "📋 Plan proposé : **{$planTitle}**\n\n"
                    .$pendingPlan['summary']
                    ."\n\nUtilisez Approuver le plan ou Refuser pour continuer.";

                $run->appendLog("Chat en pause — plan « {$planTitle} » en attente d’approbation.");

                return [

                    'text' => $summary,

                    'tokens_used' => $tokensUsed,

                    'iterations' => $budget->getUsed(),

                    'pending_plan' => $pendingPlan,

                    'steps' => $steps,

                ];

            }

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

            $waitingForSubagents = collect($toolResults)->contains(
                fn (array $row): bool => ($row['result']['status'] ?? null) === 'waiting_for_subagents',
            );

            if ($waitingForSubagents) {
                $run->refresh();
                $run->mergeMetadata(['resume_context' => array_merge($runContext, [
                    'chat_mode' => $runContext['chat_mode'] ?? 'build',
                ])]);
                if ($run->status !== 'waiting_for_subagents') {
                    $run->update([
                        'status' => 'waiting_for_subagents',
                        'summary' => 'En attente des sous-agents…',
                        'finished_at' => now(),
                    ]);
                }
                $run->appendLog('Chat en pause — waiting_for_subagents (yield_wait).');

                return [
                    'text' => 'Sous-tâches en cours — reprise automatique après handoff.',
                    'tokens_used' => $tokensUsed,
                    'iterations' => $budget->getUsed(),
                    'waiting_for_subagents' => true,
                    'steps' => $steps,
                ];
            }

        }

        $iterations = $budget->getUsed();

        if ($summary === '') {
            $summary = 'Je n\'ai pas pu générer de réponse.';
        }

        $summary = $untilDone->stripDoneMarker($this->sanitizeAssistantReply($summary, $steps));

        if (
            AgentDirectives::isChatRepairIntent($userContent)
            && ! AgentChatRepairStrategy::stepsIncludeCorrectiveAction($steps)
            && ! AgentChatRepairStrategy::hasRecordedCorrection($run->metadata['correction_actions'] ?? null)
        ) {
            $run->appendLog('Fallback chat : réponse sans correction après boucle — exécution autonome forcée.');

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
                'steps' => [...$steps, ...$harness['steps']],
                ...isset($harness['pending_approval']) ? ['pending_approval' => $harness['pending_approval']] : [],
            ];
        }

        $longTaskId = null;
        $incomplete = ! $reachedDone
            && (
                $budget->getRemaining() === 0
                || $continueNudges >= $maxContinueNudges
            )
            && $untilDone->isActionOriented($userContent)
            && (string) ($run->trigger ?? '') !== 'chat_continue'
            && (bool) config('devforge.agents_chat_enqueue_long_tasks', true);

        if ($incomplete && $session instanceof AiAgentSession) {
            $enqueued = app(AgentChatLongTaskEnqueuer::class)->enqueue(
                $agent,
                $session,
                $userContent,
                mb_substr($summary, 0, 4000),
                $toolsUsedThisRun,
                is_array($chatContext) ? $chatContext : [],
            );
            if (($enqueued['ok'] ?? false) === true) {
                $longTaskId = $enqueued['run']->id;
                $run->appendLog("Tâche longue enqueued — run #{$longTaskId}.");
                $summary .= "\n\n---\n⏳ Tâche longue relancée en arrière-plan (run #{$longTaskId}). "
                    .'Le chat continue automatiquement dans cette session.';
            }
        }

        return [
            'text' => $summary,
            'tokens_used' => $tokensUsed,
            'iterations' => $iterations,
            'steps' => $steps,
            ...$longTaskId !== null ? ['long_task_id' => $longTaskId] : [],
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
    private function initialChatMetadata(array $context, ?AiAgentSession $session = null): ?array
    {
        $metadata = array_filter([
            'application_uuid' => is_string($context['application_uuid'] ?? null) ? $context['application_uuid'] : null,
            'application_name' => is_string($context['application_name'] ?? null) ? $context['application_name'] : null,
            'git_repository' => is_string($context['git_repository'] ?? null) ? $context['git_repository'] : null,
            'git_branch' => is_string($context['git_branch'] ?? null) ? $context['git_branch'] : null,
            'build_pack' => is_string($context['build_pack'] ?? null) ? $context['build_pack'] : null,
            'fqdn' => is_string($context['fqdn'] ?? null) ? $context['fqdn'] : null,
            'chat_mode' => AgentChatMode::parse($context['chat_mode'] ?? $session?->chat_mode ?? 'build'),
            'user_email' => is_string($context['user_email'] ?? null) ? $context['user_email'] : null,
        ], fn (?string $value): bool => $value !== null && $value !== '');

        return $metadata === [] ? null : $metadata;
    }
}
