<?php

namespace App\Jobs\DevForge;

use App\Services\DevForge\Database\DatabaseKeepAliveService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class DatabaseKeepAliveJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 1;

    public int $timeout = 180;

    public function __construct()
    {
        $this->onQueue('default');
    }

    public function handle(DatabaseKeepAliveService $keepAlive): void
    {
        $keepAlive->tickAllTeams();
    }
}
