<?php

namespace App\Services\DevForge\Server;

use App\Jobs\DockerCleanupJob;
use App\Models\DockerCleanupExecution;
use App\Models\Server;
use App\Models\Team;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Validation\ValidationException;

class ServerStorageService
{
    /**
     * @return array<int, array<string, mixed>>
     */
    public function overview(Team $team, bool $refreshDisk = false): array
    {
        return $this->serversForTeam($team)
            ->map(fn (Server $server): array => $this->presentServer($server, $refreshDisk, includeExecutions: false))
            ->values()
            ->all();
    }

    /**
     * @return array<string, mixed>
     */
    public function show(Server $server, bool $refreshDisk = false, bool $includeDockerReport = false): array
    {
        $payload = $this->presentServer($server, $refreshDisk, includeExecutions: true);

        if ($includeDockerReport) {
            $payload['docker_disk_report'] = $this->getDockerDiskReport($server);
        }

        return $payload;
    }

    /**
     * @return array<string, mixed>
     */
    public function refreshDiskUsage(Server $server): array
    {
        return [
            'disk_usage_percent' => $this->resolveDiskUsagePercent($server),
            'disk_partitions' => $this->resolveDiskPartitions($server),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function updateCleanupSettings(Server $server, array $input): array
    {
        $validated = validator($input, [
            'force_docker_cleanup' => ['sometimes', 'boolean'],
            'docker_cleanup_frequency' => ['sometimes', 'string', 'required'],
            'docker_cleanup_threshold' => ['sometimes', 'integer', 'min:1', 'max:99'],
            'delete_unused_volumes' => ['sometimes', 'boolean'],
            'delete_unused_networks' => ['sometimes', 'boolean'],
            'disable_application_image_retention' => ['sometimes', 'boolean'],
            'server_disk_usage_notification_threshold' => ['sometimes', 'integer', 'min:1', 'max:99'],
            'server_disk_usage_check_frequency' => ['sometimes', 'string', 'required'],
        ])->validate();

        if (isset($validated['docker_cleanup_frequency']) && ! validate_cron_expression($validated['docker_cleanup_frequency'])) {
            throw ValidationException::withMessages([
                'docker_cleanup_frequency' => ['Expression cron invalide pour la fréquence de nettoyage Docker.'],
            ]);
        }

        if (isset($validated['server_disk_usage_check_frequency']) && ! validate_cron_expression($validated['server_disk_usage_check_frequency'])) {
            throw ValidationException::withMessages([
                'server_disk_usage_check_frequency' => ['Expression cron invalide pour la surveillance du disque.'],
            ]);
        }

        $settings = $server->settings;
        abort_if(is_null($settings), 404, 'Server settings not found.');

        $settings->fill($validated);
        $settings->save();

        auditLog('devforge.server_storage.updated', [
            'server_uuid' => $server->uuid,
        ]);

        return $this->presentServer($server->fresh(['settings']), false, includeExecutions: true);
    }

    public function runCleanup(Server $server, array $input = []): array
    {
        $validated = validator($input, [
            'delete_unused_volumes' => ['sometimes', 'boolean'],
            'delete_unused_networks' => ['sometimes', 'boolean'],
            'force_docker_cleanup' => ['sometimes', 'boolean'],
            'disable_application_image_retention' => ['sometimes', 'boolean'],
            'aggressive' => ['sometimes', 'boolean'],
        ])->validate();

        if ((bool) ($validated['aggressive'] ?? false)) {
            $validated['delete_unused_volumes'] = true;
            $validated['delete_unused_networks'] = true;
            $validated['disable_application_image_retention'] = true;
            $validated['force_docker_cleanup'] = true;
        }

        $settings = $server->settings;
        abort_if(is_null($settings), 404, 'Server settings not found.');

        $cleanupSettings = collect($validated)->only([
            'delete_unused_volumes',
            'delete_unused_networks',
            'force_docker_cleanup',
            'disable_application_image_retention',
        ])->filter(fn ($value) => $value !== null)->all();

        if ($cleanupSettings !== []) {
            $settings->fill($cleanupSettings);
            $settings->save();
            $server->load('settings');
        }

        $execution = DockerCleanupExecution::create([
            'server_id' => $server->id,
            'status' => 'running',
            'message' => isset($validated['aggressive']) && $validated['aggressive']
                ? 'Nettoyage Docker agressif en file d\'attente…'
                : 'Nettoyage Docker en file d\'attente…',
        ]);

        DockerCleanupJob::dispatch(
            server: $server->fresh(['settings']),
            manualCleanup: true,
            deleteUnusedVolumes: (bool) ($settings->delete_unused_volumes ?? false),
            deleteUnusedNetworks: (bool) ($settings->delete_unused_networks ?? false),
            executionId: $execution->id,
        );

        auditLog('devforge.server_storage.cleanup_dispatched', [
            'server_uuid' => $server->uuid,
            'execution_id' => $execution->id,
            'aggressive' => (bool) ($validated['aggressive'] ?? false),
        ]);

        $aggressive = (bool) ($validated['aggressive'] ?? false);

        return [
            'queued' => true,
            'execution_id' => $execution->id,
            'aggressive' => $aggressive,
            'message' => $aggressive
                ? 'Nettoyage agressif lancé (volumes inutilisés, sans rétention d’images). Cela peut prendre plusieurs minutes.'
                : 'Nettoyage Docker lancé. Cela peut prendre plusieurs minutes selon le volume de données.',
        ];
    }

    public function findForTeam(Team $team, string $serverUuid): Server
    {
        $server = Server::query()
            ->where('team_id', $team->id)
            ->where('uuid', $serverUuid)
            ->with('settings')
            ->first();

        abort_if(is_null($server), 404, 'Server not found.');

        return $server;
    }

    /**
     * @return Collection<int, Server>
     */
    private function serversForTeam(Team $team): Collection
    {
        return Server::query()
            ->where('team_id', $team->id)
            ->with('settings')
            ->orderBy('name')
            ->get();
    }

    /**
     * @return array<string, mixed>
     */
    private function presentServer(Server $server, bool $refreshDisk, bool $includeExecutions): array
    {
        $settings = $server->settings;
        $lastExecution = DockerCleanupExecution::query()
            ->where('server_id', $server->id)
            ->latest('id')
            ->first();

        $diskUsage = $refreshDisk ? $this->resolveDiskUsagePercent($server) : null;
        $diskPartitions = $refreshDisk ? $this->resolveDiskPartitions($server) : null;

        $payload = [
            'uuid' => $server->uuid,
            'name' => $server->name,
            'description' => $server->description,
            'status' => [
                'reachable' => (bool) $settings?->is_reachable,
                'usable' => (bool) $settings?->is_usable,
                'functional' => $server->isFunctional(),
            ],
            'disk_usage_percent' => $diskUsage,
            'disk_partitions' => $diskPartitions,
            'disk_alert_threshold' => (int) ($settings?->server_disk_usage_notification_threshold ?? 80),
            'cleanup' => [
                'force_docker_cleanup' => (bool) ($settings?->force_docker_cleanup ?? false),
                'docker_cleanup_frequency' => (string) ($settings?->docker_cleanup_frequency ?? '0 0 * * *'),
                'docker_cleanup_threshold' => (int) ($settings?->docker_cleanup_threshold ?? 80),
                'delete_unused_volumes' => (bool) ($settings?->delete_unused_volumes ?? false),
                'delete_unused_networks' => (bool) ($settings?->delete_unused_networks ?? false),
                'disable_application_image_retention' => (bool) ($settings?->disable_application_image_retention ?? false),
            ],
            'monitoring' => [
                'server_disk_usage_notification_threshold' => (int) ($settings?->server_disk_usage_notification_threshold ?? 80),
                'server_disk_usage_check_frequency' => (string) ($settings?->server_disk_usage_check_frequency ?? '0 23 * * *'),
            ],
            'last_cleanup' => $lastExecution ? $this->presentExecution($lastExecution) : null,
        ];

        if ($includeExecutions) {
            $payload['executions'] = DockerCleanupExecution::query()
                ->where('server_id', $server->id)
                ->latest('id')
                ->limit(20)
                ->get()
                ->map(fn (DockerCleanupExecution $execution): array => $this->presentExecution($execution))
                ->values()
                ->all();
        }

        return $payload;
    }

    /**
     * @return array<string, mixed>
     */
    private function presentExecution(DockerCleanupExecution $execution): array
    {
        return [
            'id' => $execution->id,
            'status' => $execution->status,
            'message' => $execution->message,
            'cleanup_log' => $execution->cleanup_log,
            'created_at' => $this->formatTimestamp($execution->created_at),
            'finished_at' => $this->formatTimestamp($execution->finished_at),
        ];
    }

    private function formatTimestamp(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        if ($value instanceof \DateTimeInterface) {
            return $value->format(\DateTimeInterface::ATOM);
        }

        try {
            return Carbon::parse((string) $value)->toIso8601String();
        } catch (\Throwable) {
            return (string) $value;
        }
    }

    private function resolveDiskUsagePercent(Server $server): ?int
    {
        if (! $server->isFunctional()) {
            return null;
        }

        $partitions = $this->resolveDiskPartitions($server);

        if ($partitions === null) {
            return null;
        }

        foreach (['/media/Docker', '/'] as $mount) {
            if (isset($partitions[$mount])) {
                return $partitions[$mount];
            }
        }

        return null;
    }

    /**
     * @return array<string, int>|null
     */
    private function resolveDiskPartitions(Server $server): ?array
    {
        if (! $server->isFunctional()) {
            return null;
        }

        $partitions = [];

        foreach (['/' => '/', '/media/Docker' => '/media/Docker'] as $key => $mount) {
            try {
                $usage = $server->getDiskUsageForMount($mount);

                if ($usage !== null && $usage !== '') {
                    $partitions[$key] = (int) $usage;
                }
            } catch (\Throwable) {
                continue;
            }
        }

        return $partitions === [] ? null : $partitions;
    }

    /**
     * @return array{report: string|null}
     */
    public function diskBreakdown(Server $server): array
    {
        return [
            'report' => $this->getHostDiskBreakdown($server),
        ];
    }

    private function getHostDiskBreakdown(Server $server): ?string
    {
        if (! $server->isFunctional()) {
            return null;
        }

        $sections = [
            ['Espace racine (df -h /)', 'df -h / 2>/dev/null | tail -1 || echo "(indisponible)"'],
            ['Docker data (df -h /media/Docker)', 'df -h /media/Docker 2>/dev/null | tail -1 || echo "(non monté)"'],
            ['Inodes (df -i /)', 'df -i / 2>/dev/null | tail -1 || echo "(indisponible)"'],
            ['Répertoires clés', 'du -xh --max-depth=1 /DATA/.devforge /data/coolify /var/lib/docker /var/log /tmp 2>/dev/null | sort -hr | head -25 || echo "(du indisponible)"'],
            ['Docker (docker system df)', 'docker system df 2>/dev/null || echo "(docker indisponible)"'],
        ];

        $lines = [];

        foreach ($sections as [$title, $command]) {
            $lines[] = "=== {$title} ===";

            try {
                $output = instant_remote_process([$command], $server, false, timeout: 45);
                $lines[] = is_string($output) && trim($output) !== '' ? trim($output) : '(aucune sortie)';
            } catch (\Throwable $exception) {
                $lines[] = '(erreur: '.$exception->getMessage().')';
            }
        }

        return implode("\n", $lines);
    }

    private function getDockerDiskReport(Server $server): ?string
    {
        if (! $server->isFunctional()) {
            return null;
        }

        try {
            $report = instant_remote_process(['docker system df 2>/dev/null || true'], $server, false);

            return is_string($report) && trim($report) !== '' ? trim($report) : null;
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function meta(): array
    {
        return [
            'scheduler_healthy' => Cache::get('scheduled-job-manager:heartbeat') !== null,
        ];
    }
}
