<?php

namespace App\Actions\Server;

use App\Models\Server;
use App\Services\DevForge\InstanceUpgradeService;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Sleep;
use Lorisleiva\Actions\Concerns\AsAction;

class UpdateDevForge
{
    use AsAction;

    public ?Server $server = null;

    public ?string $latestVersion = null;

    public ?string $currentVersion = null;

    public function handle($manual_update = false)
    {
        if (isDev()) {
            Sleep::for(10)->seconds();

            return;
        }
        $settings = instanceSettings();
        $this->server = Server::find(0);
        if (! $this->server) {
            return;
        }

        // Fetch fresh version from CDN instead of using cache
        try {
            $response = Http::retry(3, 1000)->timeout(10)
                ->get(config('constants.devforge.versions_url'));

            if ($response->successful()) {
                $versions = $response->json();
                $this->latestVersion = data_get($versions, 'devforge.version')
                    ?? data_get($versions, 'coolify.v4.version');
            } else {
                // Fallback to cache if CDN unavailable
                $cacheVersion = get_latest_version_of_coolify();

                // Validate cache version against current running version
                if ($cacheVersion && version_compare($cacheVersion, config('constants.devforge.version'), '<')) {
                    Log::error('Failed to fetch fresh version from CDN and cache is corrupted/outdated', [
                        'cached_version' => $cacheVersion,
                        'current_version' => config('constants.devforge.version'),
                    ]);
                    throw new \Exception(
                        'Cannot determine latest version: CDN unavailable and cache version '.
                        "({$cacheVersion}) is older than running version (".config('constants.devforge.version').')'
                    );
                }

                $this->latestVersion = $cacheVersion;
                Log::warning('Failed to fetch fresh version from CDN (unsuccessful response), using validated cache', [
                    'version' => $cacheVersion,
                ]);
            }
        } catch (\Throwable $e) {
            $cacheVersion = get_latest_version_of_coolify();

            // Validate cache version against current running version
            if ($cacheVersion && version_compare($cacheVersion, config('constants.devforge.version'), '<')) {
                Log::error('Failed to fetch fresh version from CDN and cache is corrupted/outdated', [
                    'error' => $e->getMessage(),
                    'cached_version' => $cacheVersion,
                    'current_version' => config('constants.devforge.version'),
                ]);
                throw new \Exception(
                    'Cannot determine latest version: CDN unavailable and cache version '.
                    "({$cacheVersion}) is older than running version (".config('constants.devforge.version').')'
                );
            }

            $this->latestVersion = $cacheVersion;
            Log::warning('Failed to fetch fresh version from CDN, using validated cache', [
                'error' => $e->getMessage(),
                'version' => $cacheVersion,
            ]);
        }

        $this->currentVersion = config('constants.devforge.version');
        if (! $manual_update) {
            if (! $settings->is_auto_update_enabled) {
                return;
            }
            if ($this->latestVersion === $this->currentVersion) {
                return;
            }
            if (version_compare($this->latestVersion, $this->currentVersion, '<')) {
                return;
            }
        }

        // ALWAYS check for downgrades (even for manual updates)
        if (version_compare($this->latestVersion, $this->currentVersion, '<')) {
            Log::error('Downgrade prevented', [
                'target_version' => $this->latestVersion,
                'current_version' => $this->currentVersion,
                'manual_update' => $manual_update,
            ]);
            throw new \Exception(
                "Cannot downgrade from {$this->currentVersion} to {$this->latestVersion}. ".
                'If you need to downgrade, please do so manually via Docker commands.'
            );
        }

        $this->update();
        $settings->new_version_available = false;
        $settings->save();
    }

    private function update()
    {
        $latestHelperImageVersion = getHelperVersion();
        $upgradeScriptUrl = config('constants.devforge.upgrade_script_url');

        $commands = [
            'mkdir -p /data/coolify/source /data/devforge /tmp 2>/dev/null || true',
            "curl -fsSL {$upgradeScriptUrl} -o /data/coolify/source/upgrade.sh 2>/dev/null || curl -fsSL {$upgradeScriptUrl} -o /data/devforge/upgrade.sh 2>/dev/null || curl -fsSL {$upgradeScriptUrl} -o /tmp/upgrade.sh",
            'chmod +x /data/coolify/source/upgrade.sh 2>/dev/null || chmod +x /data/devforge/upgrade.sh 2>/dev/null || chmod +x /tmp/upgrade.sh 2>/dev/null || true',
            "bash /data/coolify/source/upgrade.sh $this->latestVersion $latestHelperImageVersion 2>/dev/null || bash /data/devforge/upgrade.sh $this->latestVersion $latestHelperImageVersion 2>/dev/null || bash /tmp/upgrade.sh $this->latestVersion $latestHelperImageVersion",
        ];

        $reachable = (bool) data_get($this->server->settings, 'is_reachable', false);
        $canLocal = InstanceUpgradeService::canRunLocalDockerUpgrade();

        // CasaOS / Zima: SSH to host.docker.internal is often broken — prefer docker.sock.
        if ($this->server->isLocalhost() && $canLocal) {
            try {
                Log::info('Starting DevForge upgrade via local docker.sock');
                $this->updateViaLocalProcess($commands);

                return;
            } catch (\Throwable $e) {
                if (! $reachable) {
                    throw $e;
                }

                Log::warning('Local docker.sock upgrade failed, falling back to SSH', [
                    'error' => $e->getMessage(),
                ]);
            }
        }

        remote_process($commands, $this->server);
    }

    /**
     * @param  list<string>  $commands
     */
    private function updateViaLocalProcess(array $commands): void
    {
        $script = implode("\n", $commands);
        $result = InstanceUpgradeService::runLocalDockerCommand($script, timeout: 600);

        if ($result->failed()) {
            $detail = trim($result->errorOutput() ?: $result->output() ?: 'erreur inconnue');

            throw new \Exception('Mise à jour locale échouée : '.$detail);
        }
    }
}
