<?php

namespace App\Jobs\DevForge;

use App\Services\DevForge\Application\ApplicationKeepAliveService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class ApplicationKeepAliveJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 1;

    public int $timeout = 120;

    public function __construct()
    {
        $this->onQueue('default');
    }

    public function handle(ApplicationKeepAliveService $keepAlive): void
    {
        $keepAlive->tickAllTeams();
    }
}
