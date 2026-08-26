<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\AiAgentSubagentRun;
use App\Models\User;
use App\Services\DevForge\Agent\AgentRunCancellation;
use App\Services\DevForge\Agent\AgentRunLauncher;
use App\Services\DevForge\Core\CurrentTeamContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AgentRunController extends Controller
{
    public function __construct(
        private readonly CurrentTeamContext $currentTeamContext,
        private readonly AgentRunLauncher $runLauncher,
        private readonly AgentRunCancellation $cancellation,
    ) {}

    public function teamIndex(Request $request): JsonResponse
    {
        $team = $this->currentTeamContext->resolve($request->user());

        $runs = AiAgentRun::query()
            ->whereHas('agent', fn ($query) => $query->where('team_id', $team->id))
            ->with(['agent:id,uuid,name,type,avatar_color,avatar_shape'])
            ->latest()
            ->paginate(50);

        return response()->json([
            'data' => $runs->items() === [] ? [] : array_map(
                fn (AiAgentRun $run) => $this->presentRunWithAgent($run),
                $runs->items(),
            ),
            'meta' => [
                'total' => $runs->total(),
                'per_page' => $runs->perPage(),
                'current_page' => $runs->currentPage(),
                'last_page' => $runs->lastPage(),
            ],
        ]);
    }

    public function index(Request $request, string $agentUuid): JsonResponse
    {
        $agent = $this->findAgent($request, $agentUuid);

        $runs = AiAgentRun::query()
            ->where('agent_id', $agent->id)
            ->latest()
            ->paginate(20);

        return response()->json([
            'data' => $runs->items() === [] ? [] : array_map(
                fn (AiAgentRun $run) => $this->presentRun($run),
                $runs->items(),
            ),
            'meta' => [
                'total' => $runs->total(),
                'per_page' => $runs->perPage(),
                'current_page' => $runs->currentPage(),
                'last_page' => $runs->lastPage(),
            ],
        ]);
    }

    public function clear(Request $request, string $agentUuid): JsonResponse
    {
        $agent = $this->findAgent($request, $agentUuid);
        $this->authorize('update', $agent);

        $count = AiAgentRun::query()
            ->where('agent_id', $agent->id)
            ->delete();

        AiAgentSubagentRun::query()
            ->where('parent_agent_id', $agent->id)
            ->orWhere('child_agent_id', $agent->id)
            ->delete();

        $agent->update(['last_run_at' => null]);
        $agent->syncOperationalStatus();

        return response()->json([
            'data' => [
                'cleared' => $count,
            ],
        ]);
    }

    public function show(Request $request, string $agentUuid, string $runUuid): JsonResponse
    {
        $agent = $this->findAgent($request, $agentUuid);

        $run = AiAgentRun::query()
            ->where('agent_id', $agent->id)
            ->where('uuid', $runUuid)
            ->first();

        abort_unless($run, 404, 'Run introuvable.');

        return response()->json(['data' => $this->presentRun($run, withLogs: true)]);
    }

    public function destroy(Request $request, string $agentUuid, string $runUuid): JsonResponse
    {
        $agent = $this->findAgent($request, $agentUuid);
        $this->authorize('update', $agent);

        $run = AiAgentRun::query()
            ->where('agent_id', $agent->id)
            ->where('uuid', $runUuid)
            ->first();

        abort_unless($run, 404, 'Run introuvable.');

        $run->delete();
        $agent->syncOperationalStatus();

        return response()->json([
            'data' => [
                'deleted' => true,
            ],
        ]);
    }

    public function cancel(Request $request, string $agentUuid, string $runUuid): JsonResponse
    {
        $agent = $this->findAgent($request, $agentUuid);
        $this->authorize('chat', $agent);

        $run = AiAgentRun::query()
            ->where('agent_id', $agent->id)
            ->where('uuid', $runUuid)
            ->first();

        abort_unless($run, 404, 'Run introuvable.');

        $validated = $request->validate([
            'reason' => ['nullable', 'string', 'max:500'],
        ]);

        if (in_array($run->status, ['completed', 'failed', AgentRunCancellation::STATUS], true)) {
            return response()->json([
                'data' => [
                    'cancelled' => $run->status === AgentRunCancellation::STATUS,
                    'already_finished' => true,
                    'run' => $this->presentRun($run),
                ],
            ]);
        }

        $run = $this->cancellation->request(
            $run,
            is_string($validated['reason'] ?? null) ? $validated['reason'] : 'Run annulé par l’utilisateur.',
        );

        return response()->json([
            'data' => [
                'cancelled' => true,
                'already_finished' => false,
                'run' => $this->presentRun($run),
            ],
        ]);
    }

    public function resolveApproval(Request $request, string $agentUuid, string $runUuid): JsonResponse
    {
        $agent = $this->findAgent($request, $agentUuid);
        $this->authorize('chat', $agent);

        $validated = $request->validate([
            'decision' => ['required', 'string', 'in:approve,deny'],
        ]);

        $run = AiAgentRun::query()
            ->where('agent_id', $agent->id)
            ->where('uuid', $runUuid)
            ->first();

        abort_unless($run, 404, 'Run introuvable.');
        abort_unless($run->status === 'awaiting_approval', 422, 'Ce run n’attend pas d’approbation.');

        $metadata = is_array($run->metadata) ? $run->metadata : [];
        $pending = is_array($metadata['pending_approval'] ?? null) ? $metadata['pending_approval'] : null;
        abort_unless($pending !== null && ($pending['status'] ?? '') === 'ask', 422, 'Aucune d’approbation absente.');
        abort_unless(empty($pending['resolved']), 422, 'Approbation déjà traitée.');

        $decision = $validated['decision'];
        $pending['resolved'] = $decision === 'approve' ? 'approved' : 'denied';
        $pending['resolved_at'] = now()->toISOString();
        $metadata['pending_approval'] = $pending;
        $run->update([
            'metadata' => $metadata,
            'status' => 'completed',
            'summary' => $decision === 'approve'
                ? 'Approbation accordée — relance en cours.'
                : 'Approbation refusée.',
            'finished_at' => now(),
        ]);

        if ($decision === 'deny') {
            return response()->json([
                'data' => [
                    'decision' => $decision,
                    'run' => $this->presentRun($run->fresh() ?? $run),
                    'follow_up_run_uuid' => null,
                ],
            ]);
        }

        $approvalKey = (string) ($pending['approval_key'] ?? '');
        abort_unless($approvalKey !== '', 422, 'Clé d’approbation manquante.');

        $context = array_filter([
            'event' => is_string($metadata['event'] ?? null) ? $metadata['event'] : null,
            'application_uuid' => is_string($metadata['application_uuid'] ?? null) ? $metadata['application_uuid'] : null,
            'deployment_uuid' => is_string($metadata['deployment_uuid'] ?? null) ? $metadata['deployment_uuid'] : null,
            'approved_approval_keys' => [$approvalKey],
            'resume_after_approval' => true,
            'parent_run_uuid' => $run->uuid,
        ], fn (mixed $value): bool => $value !== null && $value !== '' && $value !== []);

        $followUp = $this->runLauncher->queue($agent, (string) ($run->trigger ?: 'manual'), $context);

        return response()->json([
            'data' => [
                'decision' => $decision,
                'run' => $this->presentRun($run->fresh() ?? $run),
                'follow_up_run_uuid' => $followUp?->uuid,
            ],
        ]);
    }

    private function findAgent(Request $request, string $uuid): AiAgent
    {
        $user = $request->user();
        abort_unless($user instanceof User, 401);

        $team = $this->currentTeamContext->resolve($user);
        $agent = AiAgent::where('uuid', $uuid)->where('team_id', $team->id)->first();
        abort_unless($agent, 404, 'Agent introuvable.');

        return $agent;
    }

    /** @return array<string, mixed> */
    private function presentRun(AiAgentRun $run, bool $withLogs = false): array
    {
        $metadata = is_array($run->metadata) ? $run->metadata : [];
        $data = [
            'uuid' => $run->uuid,
            'status' => $run->status,
            'trigger' => $run->trigger,
            'summary' => $run->summary,
            'actions_taken' => $run->actions_taken ?? [],
            'tokens_used' => $run->tokens_used,
            'iterations' => $run->iterations,
            'duration_seconds' => $run->duration_in_seconds,
            'metadata' => $metadata,
            'active_subagent_count' => $this->cancellation->activeSubagentCount($run),
            'live_assistant_text' => is_string($metadata['live_assistant_text'] ?? null)
                ? $metadata['live_assistant_text']
                : (is_string($run->summary) ? $run->summary : null),
            'started_at' => $run->started_at?->toISOString(),
            'finished_at' => $run->finished_at?->toISOString(),
            'created_at' => $run->created_at->toISOString(),
        ];

        if ($withLogs) {
            $data['logs'] = $run->logs;
        }

        return $data;
    }

    /** @return array<string, mixed> */
    private function presentRunWithAgent(AiAgentRun $run): array
    {
        $data = $this->presentRun($run, withLogs: false);
        $data['agent'] = $run->agent ? [
            'uuid' => $run->agent->uuid,
            'name' => $run->agent->name,
            'type' => $run->agent->type,
            'avatar_color' => $run->agent->avatar_color,
            'avatar_shape' => $run->agent->avatar_shape,
        ] : null;

        return $data;
    }
}
