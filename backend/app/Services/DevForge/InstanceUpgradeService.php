<?php

namespace App\Services\DevForge;

use App\Actions\Server\UpdateDevForge;
use App\Models\InstanceSettings;
use App\Models\Server;
use DateTimeInterface;
use Illuminate\Support\Carbon;
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

    public static function canRunLocalDockerUpgrade(): bool
    {
        return is_readable('/var/run/docker.sock') || is_readable('/run/docker.sock');
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
