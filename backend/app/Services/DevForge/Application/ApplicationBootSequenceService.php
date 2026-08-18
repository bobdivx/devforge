<?php

namespace App\Services\DevForge\Application;

use App\Models\Application;
use App\Models\Team;
use App\Services\DevForge\Core\CoreResourceAction;
use App\Services\DevForge\Core\CoreResourceCatalog;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Throwable;

class ApplicationBootSequenceService
{
    public const PHASE_WAITING = 'waiting';

    public const PHASE_STARTING = 'starting';

    public const PHASE_RUNNING = 'running';

    public const PHASE_FAILED = 'failed';

    public const PHASE_SKIPPED = 'skipped';

    private const CACHE_PREFIX = 'devforge:application_boot_sequence:';

    public function __construct(
        private readonly CoreResourceCatalog $catalog,
        private readonly CoreResourceAction $resourceAction,
        private readonly ApplicationDesiredRuntimeState $desiredRuntimeState,
    ) {}

    public function enabled(): bool
    {
        return (bool) config('devforge.application_boot_sequence.enabled', true)
            && (bool) config('devforge.enabled', true);
    }

    /**
     * @return array{
     *     active: bool,
     *     status: string,
     *     started_at: string|null,
     *     finished_at: string|null,
     *     current_uuid: string|null,
     *     completed: int,
     *     total: int,
     *     poll_interval_ms: int,
     *     items: list<array{
     *         uuid: string,
     *         name: string,
     *         order: int,
     *         phase: string,
     *         status: string,
     *         message: string|null,
     *         started_at: string|null,
     *         finished_at: string|null
     *     }>
     * }
     */
    public function statusForTeam(Team $team, bool $ensure = true, bool $tick = true): array
    {
        if (! $this->enabled()) {
            return $this->inactivePayload();
        }

        if ($ensure) {
            $this->ensureForTeam($team);
            if ($tick) {
                $this->tickTeam($team);
            }
        }

        $state = $this->readState($team->id);

        if ($state === null) {
            return $this->inactivePayload();
        }

        return $this->present($state);
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
                $this->ensureForTeam($team);
                $this->tickTeam($team);
            });
    }

    /**
     * Force le démarrage séquentiel de toutes les applications de l’équipe
     * (y compris une minorité volontairement arrêtée).
     *
     * @return array{
     *     active: bool,
     *     status: string,
     *     started_at: string|null,
     *     finished_at: string|null,
     *     current_uuid: string|null,
     *     completed: int,
     *     total: int,
     *     poll_interval_ms: int,
     *     items: list<array<string, mixed>>
     * }
     */
    public function startAllForTeam(Team $team): array
    {
        if (! $this->enabled()) {
            return $this->inactivePayload();
        }

        $applications = $this->catalog->resources($team, 'applications')->all();
        if ($applications === []) {
            return $this->inactivePayload();
        }

        $existing = $this->readState($team->id);
        if ($existing !== null && ($existing['status'] ?? null) === 'running') {
            foreach ($applications as $application) {
                if ($application instanceof Application) {
                    $this->desiredRuntimeState->markDesiredRunning($application);
                }
            }

            $this->tickTeam($team);

            $state = $this->readState($team->id);

            return $state === null ? $this->inactivePayload() : $this->present($state);
        }

        foreach ($applications as $application) {
            if ($application instanceof Application) {
                $this->desiredRuntimeState->markDesiredRunning($application);
            }
        }

        $this->begin($team, $applications);

        $maxTicks = count($applications) + 1;
        for ($i = 0; $i < $maxTicks; $i++) {
            $this->tickTeam($team);
            $state = $this->readState($team->id);
            if ($state === null || ($state['status'] ?? null) !== 'running') {
                break;
            }
            if (($state['current_uuid'] ?? null) !== null) {
                break;
            }
        }

        return $this->statusForTeam($team, ensure: false);
    }

    public function ensureForTeam(Team $team): void
    {
        if (! $this->enabled()) {
            return;
        }

        $existing = $this->readState($team->id);
        if ($existing !== null && ($existing['status'] ?? null) === 'running') {
            return;
        }

        if ($existing !== null && ($existing['status'] ?? null) === 'completed') {
            $finishedAt = isset($existing['finished_at'])
                ? Carbon::parse((string) $existing['finished_at'])
                : null;

            if ($finishedAt !== null && $finishedAt->gt(now()->subSeconds(60))) {
                return;
            }
        }

        $applications = $this->catalog->resources($team, 'applications');
        if ($applications->isEmpty()) {
            return;
        }

        $total = $applications->count();
        $notReady = $applications->filter(
            fn (Application $application): bool => ! $this->isRunningStatus((string) $application->status)
        )->count();

        if ($notReady === 0) {
            return;
        }

        $hasStarting = $applications->contains(
            fn (Application $application): bool => $this->isStartingStatus((string) $application->status)
        );

        // Évite de relancer une app arrêtée volontairement pendant que le reste tourne.
        if (! $hasStarting && $notReady < $total && ($notReady / $total) < 0.5) {
            return;
        }

        $this->begin($team, $applications->all());
    }

    /**
     * @param  list<Application>  $applications
     */
    public function begin(Team $team, array $applications): void
    {
        $items = [];
        $order = 0;

        foreach ($applications as $application) {
            if (! $application instanceof Application) {
                continue;
            }

            $status = (string) ($application->status ?? 'unknown');

            $items[] = [
                'uuid' => (string) $application->uuid,
                'name' => (string) $application->name,
                'order' => $order,
                // Toujours waiting au départ : la révélation / le start se font une par une.
                'phase' => self::PHASE_WAITING,
                'status' => $status,
                'message' => null,
                'started_at' => null,
                'finished_at' => null,
                'deployment_uuid' => null,
            ];
            $order++;
        }

        if ($items === []) {
            return;
        }

        $state = [
            'team_id' => $team->id,
            'status' => 'running',
            'started_at' => now()->toIso8601String(),
            'finished_at' => null,
            'current_uuid' => null,
            'items' => $items,
        ];

        $this->writeState($team->id, $state);
    }

    public function tickTeam(Team $team): void
    {
        $state = $this->readState($team->id);
        if ($state === null || ($state['status'] ?? null) !== 'running') {
            return;
        }

        $applications = $this->catalog->resources($team, 'applications')
            ->keyBy(fn (Application $application): string => (string) $application->uuid);

        $items = $state['items'] ?? [];
        $itemTimeout = max(60, (int) config('devforge.application_boot_sequence.item_timeout_seconds', 300));
        $currentUuid = $state['current_uuid'] ?? null;
        $changed = false;

        foreach ($items as $index => $item) {
            $uuid = (string) ($item['uuid'] ?? '');
            /** @var Application|null $application */
            $application = $applications->get($uuid);
            if ($application === null) {
                $items[$index]['phase'] = self::PHASE_SKIPPED;
                $items[$index]['message'] = 'Application introuvable.';
                $items[$index]['finished_at'] = now()->toIso8601String();
                $changed = true;

                continue;
            }

            $liveStatus = (string) ($application->status ?? 'unknown');
            if (($items[$index]['status'] ?? null) !== $liveStatus) {
                $items[$index]['status'] = $liveStatus;
                $changed = true;
            }

            if (in_array($items[$index]['phase'] ?? null, [self::PHASE_FAILED, self::PHASE_SKIPPED], true)) {
                continue;
            }

            if ($currentUuid === $uuid && $this->isReadyStatus($liveStatus)) {
                $items[$index]['phase'] = self::PHASE_RUNNING;
                $items[$index]['finished_at'] = now()->toIso8601String();
                $items[$index]['message'] = null;
                $currentUuid = null;
                $changed = true;
            }
        }

        if ($currentUuid !== null) {
            $currentIndex = $this->indexOfUuid($items, $currentUuid);
            if ($currentIndex === null) {
                $currentUuid = null;
                $changed = true;
            } else {
                $current = $items[$currentIndex];
                $startedAt = isset($current['started_at']) ? Carbon::parse((string) $current['started_at']) : null;
                $timedOut = $startedAt !== null && $startedAt->lte(now()->subSeconds($itemTimeout));
                /** @var Application|null $currentApplication */
                $currentApplication = $applications->get($currentUuid);
                $deploying = $currentApplication instanceof Application
                    && $this->applicationHasActiveDeployment($currentApplication);

                if (($current['phase'] ?? null) === self::PHASE_RUNNING) {
                    $currentUuid = null;
                    $changed = true;
                } elseif ($deploying) {
                    $items[$currentIndex]['message'] = 'Déploiement en cours…';
                    $items[$currentIndex]['started_at'] = now()->toIso8601String();
                    $changed = true;
                } elseif ($timedOut) {
                    $items[$currentIndex]['phase'] = self::PHASE_FAILED;
                    $items[$currentIndex]['message'] = 'Délai de démarrage dépassé.';
                    $items[$currentIndex]['finished_at'] = now()->toIso8601String();
                    $currentUuid = null;
                    $changed = true;
                }
            }
        }

        if ($currentUuid === null) {
            while (($nextIndex = $this->nextActionableIndex($items)) !== null) {
                $uuid = (string) $items[$nextIndex]['uuid'];
                /** @var Application|null $application */
                $application = $applications->get($uuid);
                if ($application === null) {
                    $items[$nextIndex]['phase'] = self::PHASE_SKIPPED;
                    $items[$nextIndex]['message'] = 'Application introuvable.';
                    $items[$nextIndex]['finished_at'] = now()->toIso8601String();
                    $changed = true;

                    continue;
                }

                $liveStatus = (string) ($application->status ?? 'unknown');
                $items[$nextIndex]['status'] = $liveStatus;

                if ($this->isReadyStatus($liveStatus)) {
                    $items[$nextIndex]['phase'] = self::PHASE_RUNNING;
                    $items[$nextIndex]['finished_at'] = now()->toIso8601String();
                    $changed = true;

                    // Une révélation par tick pour l’animation « une par une ».
                    break;
                }

                if ($this->isStartingStatus($liveStatus)) {
                    $items[$nextIndex]['phase'] = self::PHASE_STARTING;
                    $items[$nextIndex]['started_at'] = $items[$nextIndex]['started_at'] ?? now()->toIso8601String();
                    $currentUuid = $uuid;
                    $changed = true;
                    break;
                }

                if ($this->isStoppedStatus($liveStatus)) {
                    $this->desiredRuntimeState->markDesiredRunning($application);
                    $startResult = $this->startApplication($application);
                    $items[$nextIndex]['phase'] = self::PHASE_STARTING;
                    $items[$nextIndex]['started_at'] = now()->toIso8601String();
                    $items[$nextIndex]['deployment_uuid'] = $startResult['deployment_uuid'] ?? null;
                    $items[$nextIndex]['message'] = $startResult['message'] ?? 'Démarrage demandé.';
                    if (($startResult['failed'] ?? false) === true) {
                        $items[$nextIndex]['phase'] = self::PHASE_FAILED;
                        $items[$nextIndex]['finished_at'] = now()->toIso8601String();
                        $changed = true;

                        continue;
                    }

                    $currentUuid = $uuid;
                    $changed = true;
                    break;
                }

                $items[$nextIndex]['phase'] = self::PHASE_STARTING;
                $items[$nextIndex]['started_at'] = $items[$nextIndex]['started_at'] ?? now()->toIso8601String();
                $currentUuid = $uuid;
                $changed = true;
                break;
            }
        }

        $completed = collect($items)->filter(
            fn (array $item): bool => in_array($item['phase'] ?? null, [
                self::PHASE_RUNNING,
                self::PHASE_FAILED,
                self::PHASE_SKIPPED,
            ], true)
        )->count();

        $state['items'] = $items;
        $state['current_uuid'] = $currentUuid;
        $state['status'] = $completed >= count($items) ? 'completed' : 'running';
        if ($state['status'] === 'completed') {
            $state['finished_at'] = now()->toIso8601String();
            $state['current_uuid'] = null;
        }

        if ($changed || ($state['status'] ?? null) === 'completed') {
            $this->writeState($team->id, $state);
        }
    }

    /**
     * @return array{deployment_uuid: string|null, message: string|null, failed: bool}
     */
    private function startApplication(Application $application): array
    {
        try {
            $result = $this->resourceAction->execute($application, 'applications', 'deploy', [
                'instant_deploy' => true,
            ]);

            return [
                'deployment_uuid' => isset($result['deployment_uuid']) ? (string) $result['deployment_uuid'] : null,
                'message' => isset($result['message']) ? (string) $result['message'] : 'Démarrage demandé.',
                'failed' => false,
            ];
        } catch (Throwable $exception) {
            return [
                'deployment_uuid' => null,
                'message' => $exception->getMessage(),
                'failed' => true,
            ];
        }
    }

    /**
     * @param  list<array<string, mixed>>  $items
     */
    private function nextActionableIndex(array $items): ?int
    {
        foreach ($items as $index => $item) {
            if (($item['phase'] ?? null) === self::PHASE_WAITING) {
                return $index;
            }
        }

        return null;
    }

    /**
     * @param  list<array<string, mixed>>  $items
     */
    private function indexOfUuid(array $items, string $uuid): ?int
    {
        foreach ($items as $index => $item) {
            if ((string) ($item['uuid'] ?? '') === $uuid) {
                return $index;
            }
        }

        return null;
    }

    /**
     * @return array<string, mixed>|null
     */
    private function readState(int $teamId): ?array
    {
        $state = Cache::get($this->cacheKey($teamId));

        return is_array($state) ? $state : null;
    }

    /**
     * @param  array<string, mixed>  $state
     */
    private function writeState(int $teamId, array $state): void
    {
        $ttl = max(120, (int) config('devforge.application_boot_sequence.window_seconds', 900));
        Cache::put($this->cacheKey($teamId), $state, now()->addSeconds($ttl));
    }

    private function cacheKey(int $teamId): string
    {
        return self::CACHE_PREFIX.'team:'.$teamId;
    }

    private function applicationHasActiveDeployment(Application $application): bool
    {
        try {
            return (bool) $application->isDeploymentInprogress();
        } catch (Throwable) {
            return false;
        }
    }

    private function isReadyStatus(string $status): bool
    {
        $primary = str($status)->before(':')->lower()->trim()->value();

        return $primary === 'running' || $primary === 'degraded';
    }

    private function isRunningStatus(string $status): bool
    {
        return $this->isReadyStatus($status);
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

    /**
     * @param  array<string, mixed>  $state
     * @return array{
     *     active: bool,
     *     status: string,
     *     started_at: string|null,
     *     finished_at: string|null,
     *     current_uuid: string|null,
     *     completed: int,
     *     total: int,
     *     poll_interval_ms: int,
     *     items: list<array{
     *         uuid: string,
     *         name: string,
     *         order: int,
     *         phase: string,
     *         status: string,
     *         message: string|null,
     *         started_at: string|null,
     *         finished_at: string|null
     *     }>
     * }
     */
    private function present(array $state): array
    {
        $items = collect($state['items'] ?? [])
            ->map(function (array $item): array {
                return [
                    'uuid' => (string) ($item['uuid'] ?? ''),
                    'name' => (string) ($item['name'] ?? ''),
                    'order' => (int) ($item['order'] ?? 0),
                    'phase' => (string) ($item['phase'] ?? self::PHASE_WAITING),
                    'status' => (string) ($item['status'] ?? 'unknown'),
                    'message' => isset($item['message']) ? (string) $item['message'] : null,
                    'started_at' => isset($item['started_at']) ? (string) $item['started_at'] : null,
                    'finished_at' => isset($item['finished_at']) ? (string) $item['finished_at'] : null,
                ];
            })
            ->values()
            ->all();

        $completed = collect($items)->filter(
            fn (array $item): bool => in_array($item['phase'], [
                self::PHASE_RUNNING,
                self::PHASE_FAILED,
                self::PHASE_SKIPPED,
            ], true)
        )->count();

        $status = (string) ($state['status'] ?? 'idle');
        $active = $status === 'running';

        return [
            'active' => $active,
            'status' => $status,
            'started_at' => isset($state['started_at']) ? (string) $state['started_at'] : null,
            'finished_at' => isset($state['finished_at']) ? (string) $state['finished_at'] : null,
            'current_uuid' => isset($state['current_uuid']) ? (string) $state['current_uuid'] : null,
            'completed' => $completed,
            'total' => count($items),
            'poll_interval_ms' => max(1000, (int) config('devforge.application_boot_sequence.poll_interval_ms', 2500)),
            'items' => $items,
        ];
    }

    /**
     * @return array{
     *     active: bool,
     *     status: string,
     *     started_at: string|null,
     *     finished_at: string|null,
     *     current_uuid: string|null,
     *     completed: int,
     *     total: int,
     *     poll_interval_ms: int,
     *     items: list<array<string, mixed>>
     * }
     */
    private function inactivePayload(): array
    {
        return [
            'active' => false,
            'status' => 'idle',
            'started_at' => null,
            'finished_at' => null,
            'current_uuid' => null,
            'completed' => 0,
            'total' => 0,
            'poll_interval_ms' => max(1000, (int) config('devforge.application_boot_sequence.poll_interval_ms', 2500)),
            'items' => [],
        ];
    }
}
