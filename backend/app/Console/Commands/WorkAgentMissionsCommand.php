<?php

namespace App\Console\Commands;

use App\Services\DevForge\Agent\MissionWorkDispatcher;
use Illuminate\Console\Command;

class WorkAgentMissionsCommand extends Command
{
    protected $signature = 'agents:work-missions {--limit=10 : Nombre max de missions à traiter}';

    protected $description = 'Claim les missions open et lance les runs sur les agents assignees.';

    public function __construct(private readonly MissionWorkDispatcher $dispatcher)
    {
        parent::__construct();
    }

    public function handle(): int
    {
        $result = $this->dispatcher->dispatchDue((int) $this->option('limit'));

        if ($result['claimed'] > 0 || $result['runs'] > 0) {
            $this->info(
                "Missions : checked {$result['checked']} — claimed {$result['claimed']} — runs {$result['runs']} — skipped {$result['skipped']}"
            );
        }

        return self::SUCCESS;
    }
}
