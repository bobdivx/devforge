<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\Core\CurrentTeamContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AgentRunController extends Controller
{
    public function __construct(private readonly CurrentTeamContext $currentTeamContext) {}

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
        $data = [
            'uuid' => $run->uuid,
            'status' => $run->status,
            'trigger' => $run->trigger,
            'summary' => $run->summary,
            'actions_taken' => $run->actions_taken ?? [],
            'tokens_used' => $run->tokens_used,
            'iterations' => $run->iterations,
            'duration_seconds' => $run->duration_in_seconds,
            'metadata' => $run->metadata ?? [],
            'started_at' => $run->started_at?->toISOString(),
            'finished_at' => $run->finished_at?->toISOString(),
            'created_at' => $run->created_at->toISOString(),
        ];

        if ($withLogs) {
            $data['logs'] = $run->logs;
        }

        return $data;
    }
}
