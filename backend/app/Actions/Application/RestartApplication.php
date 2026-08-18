<?php

namespace App\Actions\Application;

use App\Models\Application;
use Lorisleiva\Actions\Concerns\AsAction;

class RestartApplication
{
    use AsAction;

    /**
     * Restart existing application containers without rebuilding or queueing a deployment.
     */
    public function handle(Application $application): int
    {
        $restarted = 0;
        $servers = collect([$application->destination->server]);

        if ($application->additional_servers?->count() > 0) {
            $servers = $servers->merge($application->additional_servers);
        }

        foreach ($servers as $server) {
            if (! $server->isFunctional()) {
                continue;
            }

            if ($server->isSwarm()) {
                continue;
            }

            $containers = getCurrentApplicationContainerStatus($server, $application->id, 0);

            foreach ($containers as $container) {
                $containerName = data_get($container, 'Names');
                if (! is_string($containerName) || $containerName === '') {
                    continue;
                }

                $server->restartContainer($containerName);
                $restarted++;
            }
        }

        return $restarted;
    }
}
