<?php

namespace App\Http\Controllers\DevForge;

use App\Http\Controllers\Controller;
use App\Models\AiAgent;
use App\Models\AiAgentMessage;
use App\Models\AiAgentRun;
use App\Models\User;
use App\Services\DevForge\Core\CurrentTeamContext;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * SSE de progression d’un run agent (chat ou autonome).
 */
class AgentRunStreamController extends Controller
{
    public function __construct(private readonly CurrentTeamContext $currentTeamContext) {}

    public function __invoke(Request $request, string $agentUuid, string $runUuid): StreamedResponse
    {
        $agent = $this->findAgent($request, $agentUuid);
        $this->authorize('view', $agent);

        $run = AiAgentRun::query()
            ->where('agent_id', $agent->id)
            ->where('uuid', $runUuid)
            ->first();

        abort_unless($run, 404, 'Run introuvable.');

        $maxSeconds = max(30, min(900, (int) $request->query('timeout', 300)));

        return response()->stream(function () use ($run, $agent, $maxSeconds): void {
            @ini_set('zlib.output_compression', '0');
            @ini_set('output_buffering', 'off');
            while (ob_get_level() > 0) {
                ob_end_flush();
            }

            $started = time();
            $lastFingerprint = '';
            $terminal = ['completed', 'failed', 'awaiting_approval', 'waiting_for_input'];

            $this->emit('ping', ['t' => time()]);

            while ((time() - $started) < $maxSeconds) {
                $run->refresh();
                $steps = is_array($run->metadata['steps'] ?? null) ? $run->metadata['steps'] : [];
                $fingerprint = $run->status.'|'.$run->iterations.'|'.count($steps).'|'.mb_substr((string) $run->summary, 0, 80);

                if ($fingerprint !== $lastFingerprint) {
                    $lastFingerprint = $fingerprint;
                    $this->emit('status', [
                        'run_uuid' => $run->uuid,
                        'status' => $run->status,
                        'iterations' => $run->iterations,
                        'tokens_used' => $run->tokens_used,
                        'summary' => $run->summary,
                        'steps' => array_slice($steps, -20),
                        'model_routing' => $run->metadata['model_routing'] ?? null,
                        'pending_approval' => $run->metadata['pending_approval'] ?? null,
                    ]);
                }

                if (in_array($run->status, $terminal, true)) {
                    $assistant = null;
                    if ($run->session_id !== null) {
                        $assistant = AiAgentMessage::query()
                            ->where('run_id', $run->id)
                            ->where('role', 'assistant')
                            ->latest('id')
                            ->first();
                    }

                    $this->emit('done', [
                        'run_uuid' => $run->uuid,
                        'status' => $run->status,
                        'summary' => $run->summary,
                        'message_uuid' => $assistant?->uuid,
                        'session_uuid' => $assistant?->session?->uuid ?? $run->session?->uuid,
                        'agent_uuid' => $agent->uuid,
                    ]);

                    return;
                }

                $this->emit('ping', ['t' => time()]);
                usleep(750_000);
            }

            $this->emit('error', [
                'message' => 'Délai SSE dépassé — le run continue éventuellement en arrière-plan.',
                'run_uuid' => $run->uuid,
                'status' => $run->status,
            ]);
        }, 200, [
            'Content-Type' => 'text/event-stream; charset=utf-8',
            'Cache-Control' => 'no-cache, no-transform',
            'Connection' => 'keep-alive',
            'X-Accel-Buffering' => 'no',
        ]);
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function emit(string $event, array $data): void
    {
        echo "event: {$event}\n";
        echo 'data: '.json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)."\n\n";
        if (function_exists('flush')) {
            flush();
        }
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
}
