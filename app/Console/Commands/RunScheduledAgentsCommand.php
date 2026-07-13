<?php

namespace App\Console\Commands;

use App\Models\AiAgent;
use App\Services\DevForge\Agent\AgentRunLauncher;
use Illuminate\Console\Command;

class RunScheduledAgentsCommand extends Command
{
    protected $signature = 'agents:run-scheduled';

    protected $description = 'Dispatch les agents IA dont la planification est échue.';

    public function __construct(private readonly AgentRunLauncher $agentRunLauncher)
    {
        parent::__construct();
    }

    public function handle(): int
    {
        $agents = AiAgent::query()
            ->where('is_active', true)
            ->where('schedule_minutes', '>', 0)
            ->where('status', '!=', 'running')
            ->with('providerConfig')
            ->get()
            ->filter(fn (AiAgent $agent) => $agent->isDueForScheduledRun());

        if ($agents->isEmpty()) {
            return self::SUCCESS;
        }

        foreach ($agents as $agent) {
            $run = $this->agentRunLauncher->queue($agent, 'scheduled');

            if ($run !== null) {
                $this->info("Agent dispatché : {$agent->name} ({$agent->uuid})");
            }
        }

        return self::SUCCESS;
    }
}
