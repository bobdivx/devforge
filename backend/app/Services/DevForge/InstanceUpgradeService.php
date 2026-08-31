<?php

namespace App\Services\DevForge;

use App\Actions\Server\UpdateDevForge;
use App\Models\InstanceSettings;
use App\Models\Server;
use DateTimeInterface;
use Illuminate\Process\ProcessResult;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Process;
use Illuminate\Validation\ValidationException;

class InstanceUpgradeService
{
    /**
     * @return array{
     *     available: bool,
     *     current_version: string,
     *     latest_version: string,
     *     status: string,
     *     step: int,
     *     message: string|null
     * }
     */
    public function status(?InstanceSettings $settings = null): array
    {
        return [
            ...$this->availability($settings),
            ...$this->progress(),
        ];
    }

    /**
     * @return array{available: bool, current_version: string, latest_version: string}
     */
    public function availability(?InstanceSettings $settings = null): array
    {
        $currentVersion = (string) config('constants.devforge.version');
        $latestVersion = $this->latestVersion();
        $resolved = self::resolveAvailability(
            $currentVersion,
            $latestVersion,
            (bool) data_get($settings ?? InstanceSettings::get(), 'new_version_available', false),
            isCloud(),
        );

        if ($resolved['stale_flag']) {
            $settings ??= InstanceSettings::get();
            $settings->update(['new_version_available' => false]);
        }

        return [
            'available' => $resolved['available'],
            'current_version' => $resolved['current_version'],
            'latest_version' => $resolved['latest_version'],
        ];
    }

    /**
     * @return array{available: bool, current_version: string, latest_version: string, stale_flag: bool}
     */
    public static function resolveAvailability(
        string $currentVersion,
        string $latestVersion,
        bool $flagged,
        bool $cloud,
    ): array {
        $hasNewerVersion = version_compare($latestVersion, $currentVersion, '>');

        return [
            'available' => ! $cloud && ($flagged || $hasNewerVersion) && $hasNewerVersion,
            'current_version' => $currentVersion,
            'latest_version' => $latestVersion,
            'stale_flag' => $flagged && ! $hasNewerVersion,
        ];
    }

    /**
     * @return array{status: string, step: int, message: string|null}
     */
    public function progress(): array
    {
        foreach (self::statusFileCandidates() as $path) {
            if (! is_readable($path)) {
                continue;
            }

            $parsed = self::parseStatusFile(@file_get_contents($path) ?: null);
            if ($parsed['status'] !== 'none') {
                return $parsed;
            }
        }

        $server = Server::find(0);
        if (! $server) {
            return self::idleProgress();
        }

        try {
            $content = instant_remote_process(
                ["cat /data/coolify/source/.upgrade-status 2>/dev/null || cat /data/devforge/.upgrade-status 2>/dev/null || cat /tmp/.upgrade-status 2>/dev/null || cat /DATA/AppData/devforge/.upgrade-status 2>/dev/null || cat /media/Docker/AppData/devforge/.upgrade-status 2>/dev/null || echo ''"],
                $server,
                false
            );
        } catch (\Throwable) {
            return self::idleProgress();
        }

        return self::parseStatusFile(is_string($content) ? $content : null);
    }

    /**
     * @return list<string>
     */
    public static function statusFileCandidates(): array
    {
        return [
            '/data/coolify/source/.upgrade-status',
            '/data/devforge/.upgrade-status',
            '/tmp/.upgrade-status',
            '/DATA/AppData/devforge/.upgrade-status',
            '/media/Docker/AppData/devforge/.upgrade-status',
        ];
    }

    /**
     * @return list<string>
     */
    public static function dockerSocketCandidates(): array
    {
        return [
            '/var/run/docker.sock',
            '/run/docker.sock',
        ];
    }

    public static function detectDockerSocket(): ?string
    {
        foreach (self::dockerSocketCandidates() as $path) {
            if (is_socket($path) || file_exists($path)) {
                return $path;
            }
        }

        return null;
    }

    /**
     * Socket is usable when it exists AND (PHP can read it OR `docker info` talks to the engine).
     * Do not rely on is_readable() alone: 660 root:docker is unreadable for www-data until
     * the entrypoint grants the sock GID / ACL.
     */
    public static function evaluateLocalDockerUpgrade(bool $socketExists, bool $socketReadable, bool $dockerCliWorks): bool
    {
        return $socketExists && ($socketReadable || $dockerCliWorks);
    }

    public static function canRunLocalDockerUpgrade(): bool
    {
        $socket = self::detectDockerSocket();

        return self::evaluateLocalDockerUpgrade(
            socketExists: $socket !== null,
            socketReadable: $socket !== null && is_readable($socket),
            dockerCliWorks: self::dockerCliWorks(),
        );
    }

    public static function dockerCliWorks(): bool
    {
        if (self::detectDockerSocket() === null) {
            return false;
        }

        try {
            $result = Process::timeout(8)->run(['docker', 'info', '-f', '{{.ServerVersion}}']);
            if ($result->successful()) {
                return true;
            }

            $group = self::dockerSocketGroupName();
            $sg = self::sgBinary();
            if ($group !== null && $sg !== null) {
                $retry = Process::timeout(8)->run([$sg, $group, '-c', 'docker info -f "{{.ServerVersion}}"']);

                return $retry->successful();
            }
        } catch (\Throwable) {
            return false;
        }

        return false;
    }

    public static function dockerSocketGroupName(): ?string
    {
        $socket = self::detectDockerSocket();
        if ($socket === null || ! function_exists('posix_getgrgid')) {
            return null;
        }

        $gid = @filegroup($socket);
        if (! is_int($gid)) {
            return null;
        }

        $info = posix_getgrgid($gid);

        return is_array($info) && ! empty($info['name']) ? (string) $info['name'] : null;
    }

    public static function sgBinary(): ?string
    {
        foreach (['/usr/bin/sg', '/bin/sg'] as $path) {
            if (is_executable($path)) {
                return $path;
            }
        }

        return null;
    }

    public static function runLocalDockerCommand(string $script, int $timeout = 600): ProcessResult
    {
        $attempts = [
            ['bash', '-lc', $script],
        ];

        $group = self::dockerSocketGroupName();
        $sg = self::sgBinary();
        if ($group !== null && $sg !== null) {
            $attempts[] = [$sg, $group, '-c', $script];
        }

        $last = Process::timeout($timeout)->run($attempts[0]);
        if ($last->successful()) {
            return $last;
        }

        foreach (array_slice($attempts, 1) as $command) {
            $last = Process::timeout($timeout)->run($command);
            if ($last->successful()) {
                return $last;
            }
        }

        return $last;
    }

    /**
     * @return array{status: string, step: int, message: string|null}
     */
    public static function parseStatusFile(?string $content, ?DateTimeInterface $now = null): array
    {
        $content = trim((string) $content);
        if ($content === '') {
            return self::idleProgress();
        }

        $parts = explode('|', $content);
        if (count($parts) < 3) {
            return self::idleProgress();
        }

        [$step, $message, $timestamp] = $parts;

        try {
            $statusTime = Carbon::parse($timestamp);
            $reference = $now instanceof DateTimeInterface ? Carbon::parse($now) : now();
            $diffMinutes = ($reference->getTimestamp() - $statusTime->getTimestamp()) / 60;
            if ($diffMinutes > 10) {
                return self::idleProgress();
            }
        } catch (\Throwable) {
            return self::idleProgress();
        }

        $message = filled($message) ? (string) $message : null;

        if ($step === 'error') {
            return [
                'status' => 'error',
                'step' => 0,
                'message' => $message,
            ];
        }

        $stepInt = (int) $step;

        return [
            'status' => $stepInt >= 6 ? 'complete' : 'in_progress',
            'step' => $stepInt,
            'message' => $message,
        ];
    }

    /**
     * @return array{
     *     available: bool,
     *     current_version: string,
     *     latest_version: string,
     *     status: string,
     *     step: int,
     *     message: string|null
     * }
     */
    public function start(?InstanceSettings $settings = null): array
    {
        $current = $this->status($settings);

        if ($current['status'] === 'in_progress') {
            return $current;
        }

        if (! $current['available']) {
            throw ValidationException::withMessages([
                'upgrade' => ['Aucune mise à jour n’est disponible.'],
            ]);
        }

        $server = Server::find(0);
        if (! $server) {
            throw ValidationException::withMessages([
                'upgrade' => ['Serveur localhost introuvable. Impossible de lancer la mise à jour.'],
            ]);
        }

        $reachable = (bool) data_get($server->settings, 'is_reachable', false);
        $canLocal = self::canRunLocalDockerUpgrade();

        if (! $reachable && ! $canLocal) {
            throw ValidationException::withMessages([
                'upgrade' => [
                    'Serveur localhost injoignable en SSH, et Docker n’est pas accessible depuis le conteneur. '
                    .'Réparez le SSH (host.docker.internal:22) ou mettez à jour DevForge depuis CasaOS/ZimaOS.',
                ],
            ]);
        }

        $latest = $this->latestVersion();

        try {
            UpdateDevForge::run(manual_update: true, targetVersion: $latest !== '0.0.0' ? $latest : null);
        } catch (\Throwable $e) {
            throw ValidationException::withMessages([
                'upgrade' => [$e->getMessage()],
            ]);
        }

        return $this->status($settings);
    }

    /**
     * @return array{status: string, step: int, message: string|null}
     */
    private static function idleProgress(): array
    {
        return [
            'status' => 'none',
            'step' => 0,
            'message' => null,
        ];
    }

    private function latestVersion(): string
    {
        try {
            $latest = trim((string) get_latest_version_of_coolify());

            return $latest !== '' ? $latest : '0.0.0';
        } catch (\Throwable) {
            return '0.0.0';
        }
    }
}
