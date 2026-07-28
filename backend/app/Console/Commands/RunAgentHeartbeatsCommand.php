<?php

namespace App\Console\Commands;

use App\Models\AiAgent;
use App\Services\DevForge\Agent\AgentRunLauncher;
use Illuminate\Console\Command;

class RunAgentHeartbeatsCommand extends Command
{
    protected $signature = 'agents:heartbeat';

    protected $description = 'Dispatch les heartbeats idle des agents (standing orders / santé).';

    public function __construct(private readonly AgentRunLauncher $agentRunLauncher)
    {
        parent::__construct();
    }

    public function handle(): int
    {
        if ((int) config('devforge.agents_heartbeat_minutes', 30) <= 0) {
            return self::SUCCESS;
        }

        if (! \Illuminate\Support\Facades\Schema::hasColumn('ai_agents', 'heartbeat_enabled')) {
            return self::SUCCESS;
        }

        $agents = AiAgent::query()
            ->where('is_active', true)
            ->where('heartbeat_enabled', true)
            ->where('status', '!=', 'running')
            ->with('providerConfig')
            ->get()
            ->filter(fn (AiAgent $agent) => $agent->isDueForHeartbeat());

        foreach ($agents as $agent) {
            $run = $this->agentRunLauncher->queue($agent, 'heartbeat', [
                'event' => 'heartbeat',
                'subagent_role' => 'main',
                'spawn_depth' => 0,
                'heartbeat' => true,
            ]);

            if ($run !== null) {
                $agent->update(['last_heartbeat_at' => now()]);
                $this->info("Heartbeat : {$agent->name} ({$agent->uuid})");
            }
        }

        return self::SUCCESS;
    }
}
