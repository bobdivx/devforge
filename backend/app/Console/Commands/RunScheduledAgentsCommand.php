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
            ->where('status', '!=', 'running')
            ->where(function ($query) {
                $query->where('schedule_minutes', '>', 0);
                if (\Illuminate\Support\Facades\Schema::hasColumn('ai_agents', 'schedule_cron')) {
                    $query->orWhere(function ($q) {
                        $q->whereNotNull('schedule_cron')->where('schedule_cron', '!=', '');
                    });
                }
            })
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
