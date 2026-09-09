<?php

namespace App\Jobs;

use App\Actions\Sso\StartSsoStack;
use App\Models\Server;
use App\Services\DevForge\Sso\SsoProtection;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class CheckAndStartSsoJob implements ShouldBeEncrypted, ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public $timeout = 180;

    public function __construct(public Server $server) {}

    public function handle(): void
    {
        if (! $this->server->isLocalhost() || ! SsoProtection::canStartStack()) {
            return;
        }

        $inspect = instant_remote_process_with_timeout(
            ['docker inspect '.SsoProtection::POCKET_ID_CONTAINER.' '.SsoProtection::OAUTH2_PROXY_CONTAINER],
            $this->server,
            false,
            10,
        );
        $status = collect(json_decode($inspect, true) ?: [])
            ->pluck('State.Status')
            ->filter()
            ->values();

        $containersRunning = $status->count() === 2
            && $status->every(fn (mixed $value): bool => $value === 'running');

        try {
            if ($containersRunning) {
                app(StartSsoStack::class)->provisionClients($this->server);

                return;
            }

            StartSsoStack::run($this->server);
        } catch (\Throwable $e) {
            Log::warning('Could not start the managed SSO stack.', [
                'server_id' => $this->server->id,
                'error' => $e->getMessage(),
            ]);
        }
    }
}
