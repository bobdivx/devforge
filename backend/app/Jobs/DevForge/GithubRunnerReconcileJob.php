<?php

namespace App\Jobs\DevForge;

use App\Services\DevForge\Github\GithubRunnerReconcileService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class GithubRunnerReconcileJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 1;

    public int $timeout = 300;

    public function __construct()
    {
        $this->onQueue('default');
    }

    public function handle(GithubRunnerReconcileService $reconcile): void
    {
        $stats = $reconcile->tickAllTeams();

        if (($stats['started'] ?? 0) > 0 || ($stats['failed'] ?? 0) > 0) {
            Log::info('github_runner.reconcile_tick', $stats);
        }
    }
}
