<?php

namespace App\Console\Commands;

use App\Services\DevForge\Agent\GithubPrWatchDispatcher;
use Illuminate\Console\Command;

class WatchGithubPrAgentsCommand extends Command
{
    protected $signature = 'agents:watch-github-prs';

    protected $description = 'Surveille les PR GitHub des agents type github et déclenche des runs event.';

    public function __construct(private readonly GithubPrWatchDispatcher $dispatcher)
    {
        parent::__construct();
    }

    public function handle(): int
    {
        $result = $this->dispatcher->dispatchDue();

        if ($result['dispatched'] > 0) {
            $this->info("PR surveillées : {$result['checked']} — runs : {$result['dispatched']}");
        }

        return self::SUCCESS;
    }
}
