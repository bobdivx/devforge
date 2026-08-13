<?php

namespace App\Services\DevForge\Database;

use App\Models\Application;
use App\Models\EnvironmentVariable;
use App\Models\Team;
use App\Services\DevForge\Core\CoreResourceCatalog;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Log;

class DatabaseKeepAliveService
{
    public function __construct(
        private readonly CoreResourceCatalog $catalog,
        private readonly StandaloneDatabaseRuntimeGuard $runtimeGuard,
        private readonly DatabaseDesiredRuntimeState $desiredRuntimeState,
    ) {}

    public function enabled(): bool
    {
        return (bool) config('devforge.database_keep_alive.enabled', true)
            && (bool) config('devforge.enabled', true);
    }

    public function tickAllTeams(): void
    {
        if (! $this->enabled()) {
            return;
        }

        Team::query()
            ->select(['id'])
            ->orderBy('id')
            ->each(function (Team $team): void {
                try {
                    $this->tickTeam($team);
                } catch (\Throwable $exception) {
                    Log::warning('DevForge database keep-alive tick failed.', [
                        'team_id' => $team->id,
                        'error' => $exception->getMessage(),
                    ]);
                }
            });
    }

    /**
     * @return array{restarted: array<int, string>}
     */
    public function tickTeam(Team $team): array
    {
        if (! $this->enabled()) {
            return ['restarted' => []];
        }

        $databases = $this->catalog->resources($team, 'databases');
        if ($databases->isEmpty()) {
            return ['restarted' => []];
        }

        $restarted = [];

        foreach ($databases as $database) {
            if (! $database instanceof Model || blank($database->uuid)) {
                continue;
            }

            $status = (string) ($database->status ?? 'unknown');

            if ($this->isRunningStatus($status) || $this->isStartingStatus($status)) {
                $this->desiredRuntimeState->markDesiredRunning($database);

                continue;
            }

            if (! $this->isStoppedStatus($status)) {
                continue;
            }

            if (! $this->shouldRestart($database)) {
                continue;
            }

            try {
                if ($this->runtimeGuard->ensureRunning($database)) {
                    $this->desiredRuntimeState->markDesiredRunning($database);
                    $restarted[] = (string) $database->uuid;
                }
            } catch (\Throwable $exception) {
                Log::warning('DevForge database keep-alive failed to start database.', [
                    'team_id' => $team->id,
                    'database_uuid' => $database->uuid,
                    'error' => $exception->getMessage(),
                ]);
            }
        }

        return ['restarted' => $restarted];
    }

    private function shouldRestart(Model $database): bool
    {
        $cached = $this->desiredRuntimeState->cachedDesired($database);

        if ($cached === false) {
            return false;
        }

        if ($cached === true) {
            return true;
        }

        // Crash without prior desired flag: restart if a linked application is up.
        return $this->hasRunningLinkedApplication($database);
    }

    private function hasRunningLinkedApplication(Model $database): bool
    {
        $comment = LibsqlConnectionEnvSync::LINK_COMMENT_PREFIX.$database->uuid;

        $applicationIds = EnvironmentVariable::query()
            ->where('is_preview', false)
            ->where('comment', $comment)
            ->where('resourceable_type', Application::class)
            ->pluck('resourceable_id')
            ->unique()
            ->filter()
            ->values();

        if ($applicationIds->isEmpty()) {
            return false;
        }

        return Application::query()
            ->whereIn('id', $applicationIds)
            ->get(['id', 'status'])
            ->contains(fn (Application $application): bool => $this->isRunningStatus((string) ($application->status ?? ''))
                || $this->isStartingStatus((string) ($application->status ?? '')));
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
