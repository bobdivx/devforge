<?php

namespace App\Jobs\DevForge;

use App\Jobs\DockerCleanupJob;
use App\Models\Server;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\Middleware\WithoutOverlapping;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Laravel\Horizon\Contracts\Silenced;

/**
 * Garde-fou disque pour le serveur localhost (NAS / ZimaOS).
 *
 * Surveille /media/Docker (workload Docker) et déclenche un cleanup
 * dès que le seuil critique est atteint, sans attendre le cron horaire.
 */
class InstanceHostDiskGuardJob implements ShouldBeUnique, ShouldQueue, Silenced
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 1;

    public int $timeout = 120;

    public int $uniqueFor = 240;

    /** Seuil (%) pour déclencher un cleanup d'urgence. */
    public const CRITICAL_THRESHOLD = 85;

    /** Seuil (%) pour un prune buildx/images plus agressif. */
    public const EMERGENCY_THRESHOLD = 92;

    public function __construct()
    {
        $this->onQueue('high');
    }

    public function middleware(): array
    {
        return [(new WithoutOverlapping('instance-host-disk-guard'))->expireAfter(240)->dontRelease()];
    }

    public function handle(): void
    {
        $server = Server::find(0) ?? Server::where('ip', 'host.docker.internal')->first();

        if ($server === null || ! $server->isFunctional()) {
            return;
        }

        $usage = (int) ($server->getWorkloadDiskUsage() ?? 0);

        if ($usage < self::CRITICAL_THRESHOLD) {
            return;
        }

        Log::warning('InstanceHostDiskGuardJob: disk usage critical', [
            'server_id' => $server->id,
            'disk_usage_percent' => $usage,
            'threshold' => self::CRITICAL_THRESHOLD,
        ]);

        $cacheKey = 'instance-host-disk-guard:cleanup:'.$server->id;
        if (! Cache::add($cacheKey, true, 900)) {
            return;
        }

        DockerCleanupJob::dispatch(
            $server,
            manualCleanup: true,
            deleteUnusedVolumes: false,
            deleteUnusedNetworks: true,
        );

        if ($usage >= self::EMERGENCY_THRESHOLD) {
            $this->runEmergencyPrune($server);
        }
    }

    /**
     * Prune build cache only — never docker image prune -af here:
     * that can delete postgres/redis while containers are restarting.
     */
    private function runEmergencyPrune(Server $server): void
    {
        $commands = [
            'docker builder prune -af 2>/dev/null || true',
            'sudo DOCKER_CONFIG=/DATA/.docker docker buildx prune -af 2>/dev/null || true',
            'docker container prune -f 2>/dev/null || true',
            'docker image prune -f 2>/dev/null || true',
        ];

        foreach ($commands as $command) {
            try {
                instant_remote_process([$command], $server, false);
            } catch (\Throwable $e) {
                Log::warning('InstanceHostDiskGuardJob: emergency prune step failed', [
                    'command' => $command,
                    'error' => $e->getMessage(),
                ]);
            }
        }
    }
}
