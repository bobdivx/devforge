<?php

namespace App\Jobs\DevForge;

use App\Services\DevForge\Docker\DockerImageAutoUpdater;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class CheckDockerImageUpdatesJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 1;

    public int $timeout = 600;

    public function __construct()
    {
        $this->onQueue('default');
    }

    public function handle(DockerImageAutoUpdater $updater): void
    {
        $summary = $updater->run();

        Log::info('CheckDockerImageUpdatesJob finished', [
            'checked' => $summary['checked'],
            'updated' => $summary['updated'],
            'skipped' => $summary['skipped'],
            'errors' => $summary['errors'],
        ]);
    }
}
