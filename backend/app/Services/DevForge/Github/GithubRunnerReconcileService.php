<?php

namespace App\Services\DevForge\Github;

use App\Models\GithubManagedRunner;
use App\Models\Server;
use App\Models\Team;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Log;
use Throwable;

class GithubRunnerReconcileService
{
    public function __construct(
        private readonly GithubRunnerInventory $inventory,
    ) {}

    /**
     * @return array{checked: int, started: int, already_running: int, failed: int}
     */
    public function tickAllTeams(): array
    {
        $stats = [
            'checked' => 0,
            'started' => 0,
            'already_running' => 0,
            'failed' => 0,
        ];

        GithubManagedRunner::query()
            ->where('enabled', true)
            ->orderBy('id')
            ->chunkById(50, function (Collection $runners) use (&$stats): void {
                foreach ($runners as $runner) {
                    $stats['checked']++;
                    try {
                        $result = $this->ensureRunning($runner);
                        if ($result === 'started') {
                            $stats['started']++;
                        } else {
                            $stats['already_running']++;
                        }
                    } catch (Throwable $e) {
                        $stats['failed']++;
                        Log::warning('github_runner.reconcile_failed', [
                            'runner_id' => $runner->id,
                            'container' => $runner->container_name,
                            'server_uuid' => $runner->server_uuid,
                            'error' => $e->getMessage(),
                        ]);
                        $runner->forceFill([
                            'last_reconcile_error' => mb_substr($e->getMessage(), 0, 2000),
                            'last_reconciled_at' => now(),
                        ])->save();
                    }
                }
            });

        return $stats;
    }

    /**
     * @return 'started'|'already_running'
     */
    public function ensureRunning(GithubManagedRunner $managed): string
    {
        $team = Team::query()->find($managed->team_id);
        if (! $team) {
            throw new \RuntimeException('Team introuvable pour le runner géré.');
        }

        $server = Server::query()
            ->where('uuid', $managed->server_uuid)
            ->where('team_id', $managed->team_id)
            ->first();

        if (! $server) {
            // Root/localhost servers may be team_id 0 while also being the only host.
            $server = Server::query()->where('uuid', $managed->server_uuid)->first();
        }

        if (! $server) {
            throw new \RuntimeException('Serveur introuvable pour le runner géré.');
        }

        if (! $server->isFunctional()) {
            throw new \RuntimeException('Le serveur n’est pas joignable.');
        }

        if ($this->inventory->isContainerRunning($server, $managed->container_name)) {
            $managed->forceFill([
                'last_reconciled_at' => now(),
                'last_reconcile_error' => null,
            ])->save();

            return 'already_running';
        }

        $this->inventory->recreateFromManaged($team, $server, $managed);

        $managed->forceFill([
            'last_reconciled_at' => now(),
            'last_reconcile_error' => null,
        ])->save();

        return 'started';
    }
}
