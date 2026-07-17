<?php

namespace App\Jobs\DevForge;

use App\Models\Application;
use App\Services\DevForge\Readiness\ApplicationReadinessService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class ApplicationDomainProbeJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 1;

    public int $timeout = 60;

    public function __construct(
        public readonly string $applicationUuid,
        public readonly bool $dispatchAgentOnFailure = true,
    ) {
        $this->onQueue('default');
    }

    public function handle(ApplicationReadinessService $readinessService): void
    {
        if (! (bool) config('devforge.readiness_enabled', true)) {
            return;
        }

        $application = Application::query()->where('uuid', $this->applicationUuid)->first();

        if (! $application instanceof Application) {
            Log::warning('DevForge readiness probe: application introuvable.', [
                'application_uuid' => $this->applicationUuid,
            ]);

            return;
        }

        $readinessService->runProbe($application, $this->dispatchAgentOnFailure);
    }
}
