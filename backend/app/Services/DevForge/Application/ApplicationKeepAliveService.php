<?php

namespace App\Services\DevForge\Application;

use App\Models\Application;
use App\Models\Team;
use App\Services\DevForge\Core\CoreResourceCatalog;
use Illuminate\Support\Facades\Log;

class ApplicationKeepAliveService
{
    public function __construct(
        private readonly CoreResourceCatalog $catalog,
        private readonly ApplicationBootSequenceService $bootSequence,
        private readonly ApplicationDesiredRuntimeState $desiredRuntimeState,
    ) {}

    public function enabled(): bool
    {
        return (bool) config('devforge.application_keep_alive.enabled', true)
            && (bool) config('devforge.enabled', true);
    }

    public function tickAllTeams(): void
    {
        if (! $this->enabled()) {
            return;
        }

        if (! $this->bootSequence->enabled()) {
            return;
        }

        Team::query()
            ->select(['id'])
            ->orderBy('id')
            ->each(function (Team $team): void {
                try {
                    $this->tickTeam($team);
                } catch (\Throwable $exception) {
                    Log::warning('DevForge application keep-alive tick failed.', [
                        'team_id' => $team->id,
                        'error' => $exception->getMessage(),
                    ]);
                }
            });
    }

    public function tickTeam(Team $team): void
    {
        if (! $this->enabled()) {
            return;
        }

        $applications = $this->catalog->resources($team, 'applications');
        if ($applications->isEmpty()) {
            return;
        }

        $toRestart = [];

        foreach ($applications as $application) {
            if (! $application instanceof Application) {
                continue;
            }

            $status = (string) ($application->status ?? 'unknown');

            if ($this->isRunningStatus($status) || $this->isStartingStatus($status)) {
                $this->desiredRuntimeState->markDesiredRunning($application);

                continue;
            }

            if (! $this->isStoppedStatus($status)) {
                continue;
            }

            if (! $this->desiredRuntimeState->isDesiredRunning($application)) {
                continue;
            }

            $toRestart[] = $application;
        }

        if ($toRestart === []) {
            return;
        }

        $state = $this->bootSequence->statusForTeam($team, ensure: false);
        if (($state['status'] ?? null) === 'running') {
            return;
        }

        foreach ($toRestart as $application) {
            $this->desiredRuntimeState->markDesiredRunning($application);
        }

        $this->bootSequence->begin($team, $toRestart);
        $this->bootSequence->tickTeam($team);
    }

    private function isRunningStatus(string $status): bool
    {
        return str($status)->before(':')->lower()->trim()->value() === 'running';
    }

    private function isStartingStatus(string $status): bool
    {
        $primary = str($status)->before(':')->lower()->trim()->value();

        return in_array($primary, ['starting', 'restarting', 'created'], true);
    }

    private function isStoppedStatus(string $status): bool
    {
        $primary = str($status)->before(':')->lower()->trim()->value();

        return str($status)->startsWith('exited')
            || in_array($primary, ['stopped', 'dead', 'exited'], true);
    }
}
