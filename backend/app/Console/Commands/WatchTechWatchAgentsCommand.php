<?php

namespace App\Console\Commands;

use App\Services\DevForge\Agent\TechWatchMissionDispatcher;
use Illuminate\Console\Command;

class WatchTechWatchAgentsCommand extends Command
{
    protected $signature = 'agents:watch-tech';

    protected $description = 'Scanne les agents tech-watch et crée des missions (demandes) sur le board.';

    public function __construct(private readonly TechWatchMissionDispatcher $dispatcher)
    {
        parent::__construct();
    }

    public function handle(): int
    {
        $result = $this->dispatcher->dispatchDue();

        if ($result['missions'] > 0 || $result['runs'] > 0) {
            $this->info("Tech-watch : {$result['checked']} agents — missions {$result['missions']} — runs {$result['runs']}");
        }

        return self::SUCCESS;
    }
}
