<?php

namespace App\Jobs;

use App\Models\Application;
use App\Services\DevForge\Sso\SyncApplicationOidcEnvironment;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class RefreshPocketIdAppClientsJob implements ShouldBeEncrypted, ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public $timeout = 60;

    public function __construct(public int $applicationId) {}

    public function handle(): void
    {
        $application = Application::query()->find($this->applicationId);
        if ($application === null) {
            return;
        }

        try {
            app(SyncApplicationOidcEnvironment::class)->sync($application);
        } catch (\Throwable $e) {
            Log::warning('Could not refresh Pocket ID callbacks after a domain change.', [
                'application_id' => $this->applicationId,
                'error' => $e->getMessage(),
            ]);
        }
    }
}
