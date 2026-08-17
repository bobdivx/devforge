<?php

namespace App\Console\Commands;

use App\Enums\ActivityTypes;
use App\Enums\ApplicationDeploymentStatus;
use App\Jobs\CheckHelperImageJob;
use App\Jobs\PullChangelog;
use App\Models\ApplicationDeploymentQueue;
use App\Models\Environment;
use App\Models\InstanceSettings;
use App\Models\ScheduledDatabaseBackup;
use App\Models\ScheduledDatabaseBackupExecution;
use App\Models\ScheduledTaskExecution;
use App\Models\Server;
use App\Models\StandalonePostgresql;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Http;

class Init extends Command
{
    protected $signature = 'app:init';

    protected $description = 'Cleanup instance related stuffs';

    public $servers = null;

    public InstanceSettings $settings;

    public function handle()
    {
        Artisan::call('optimize:clear');
        Artisan::call('optimize');

        try {
            $this->pullTemplatesFromCDN();
        } catch (\Throwable $e) {
            echo "Could not pull templates from CDN: {$e->getMessage()}\n";
        }

        try {
            $this->pullChangelogFromGitHub();
        } catch (\Throwable $e) {
            echo "Could not changelogs from github: {$e->getMessage()}\n";
        }

        try {
            $this->pullHelperImage();
        } catch (\Throwable $e) {
            echo "Error in pullHelperImage command: {$e->getMessage()}\n";
        }

        if (isCloud()) {
            return;
        }

        $this->settings = instanceSettings();
        $this->servers = Server::all();

        $do_not_track = data_get($this->settings, 'do_not_track', true);
        if ($do_not_track == false) {
            $this->sendAliveSignal();
        }
        get_public_ips();

        // Backward compatibility
        $this->replaceSlashInEnvironmentName();
        $this->restoreCoolifyDbBackup();
        try {
            $this->call('devforge:ensure-s3-backup');
        } catch (\Throwable $e) {
            echo "Error in devforge:ensure-s3-backup: {$e->getMessage()}\n";
        }
        $this->updateUserEmails();
        //
        $this->updateTraefikLabels();
        try {
            $this->call('devforge:repair-fqdn-schemes', ['--redeploy' => true]);
        } catch (\Throwable $e) {
            echo "Error in devforge:repair-fqdn-schemes: {$e->getMessage()}\n";
        }
        $this->cleanupUnusedNetworkFromCoolifyProxy();

        try {
            $this->call('cleanup:redis', ['--restart' => true, '--clear-locks' => true]);
        } catch (\Throwable $e) {
            echo "Error in cleanup:redis command: {$e->getMessage()}\n";
        }
        try {
            $this->call('cleanup:names');
        } catch (\Throwable $e) {
            echo "Error in cleanup:names command: {$e->getMessage()}\n";
        }
        try {
            $this->call('cleanup:stucked-resources');
        } catch (\Throwable $e) {
            echo "Error in cleanup:stucked-resources command: {$e->getMessage()}\n";
            echo "Continuing with initialization - cleanup errors will not prevent DevForge from starting\n";
        }
        try {
            $updatedCount = ApplicationDeploymentQueue::whereIn('status', [
                ApplicationDeploymentStatus::IN_PROGRESS->value,
                ApplicationDeploymentStatus::QUEUED->value,
            ])->update([
                'status' => ApplicationDeploymentStatus::FAILED->value,
            ]);

            if ($updatedCount > 0) {
                echo "Marked {$updatedCount} stuck deployments as failed\n";
            }
        } catch (\Throwable $e) {
            echo "Could not cleanup inprogress deployments: {$e->getMessage()}\n";
        }

        try {
            $updatedTaskCount = ScheduledTaskExecution::where('status', 'running')->update([
                'status' => 'failed',
                'message' => 'Marked as failed during DevForge startup - job was interrupted',
                'finished_at' => Carbon::now(),
            ]);

            if ($updatedTaskCount > 0) {
                echo "Marked {$updatedTaskCount} stuck scheduled task executions as failed\n";
            }
        } catch (\Throwable $e) {
            echo "Could not cleanup stuck scheduled task executions: {$e->getMessage()}\n";
        }

        try {
            $updatedBackupCount = ScheduledDatabaseBackupExecution::where('status', 'running')->update([
                'status' => 'failed',
                'message' => 'Marked as failed during DevForge startup - job was interrupted',
                'finished_at' => Carbon::now(),
            ]);

            if ($updatedBackupCount > 0) {
                echo "Marked {$updatedBackupCount} stuck database backup executions as failed\n";
            }
        } catch (\Throwable $e) {
            echo "Could not cleanup stuck database backup executions: {$e->getMessage()}\n";
        }

        try {
            $localhost = $this->servers->where('id', 0)->first();
            if ($localhost) {
                $localhost->setupDynamicProxyConfiguration();
            }
        } catch (\Throwable $e) {
            echo "Could not setup dynamic configuration: {$e->getMessage()}\n";
        }

        if (! is_null(config('constants.coolify.autoupdate', null))) {
            if (config('constants.coolify.autoupdate') == true) {
                echo "Enabling auto-update\n";
                $this->settings->update(['is_auto_update_enabled' => true]);
            } else {
                echo "Disabling auto-update\n";
                $this->settings->update(['is_auto_update_enabled' => false]);
            }
        }
    }

    private function pullHelperImage()
    {
        CheckHelperImageJob::dispatch();
    }

    private function pullTemplatesFromCDN()
    {
        $response = Http::retry(3, 1000)->get(config('constants.services.official'));
        if ($response->successful()) {
            $services = $response->json();
            File::put(base_path('templates/'.config('constants.services.file_name')), json_encode($services));
        }
    }

    private function pullChangelogFromGitHub()
    {
        try {
            PullChangelog::dispatch();
            echo "Changelog fetch initiated\n";
        } catch (\Throwable $e) {
            echo "Could not fetch changelog from GitHub: {$e->getMessage()}\n";
        }
    }

    private function updateUserEmails()
    {
        try {
            User::whereRaw('email ~ \'[A-Z]\'')->get()->each(function (User $user) {
                $user->update(['email' => $user->email]);
            });
        } catch (\Throwable $e) {
            echo "Error in updating user emails: {$e->getMessage()}\n";
        }
    }

    private function updateTraefikLabels()
    {
        try {
            Server::where('proxy->type', 'TRAEFIK_V2')->update(['proxy->type' => 'TRAEFIK']);
        } catch (\Throwable $e) {
            echo "Error in updating traefik labels: {$e->getMessage()}\n";
        }
    }

    private function cleanupUnusedNetworkFromCoolifyProxy()
    {
        foreach ($this->servers as $server) {
            if (! $server->isFunctional()) {
                continue;
            }
            if (! $server->isProxyShouldRun()) {
                continue;
            }
            try {
                ['networks' => $networks, 'allNetworks' => $allNetworks] = collectDockerNetworksByServer($server);
                $removeNetworks = $allNetworks->diff($networks);
                $commands = collect();
                foreach ($removeNetworks as $network) {
                    $safe = escapeshellarg($network);
                    $out = instant_remote_process(["docker network inspect -f json {$safe} | jq '.[].Containers | if . == {} then null else . end'"], $server, false);
                    if (empty($out)) {
                        $commands = $commands->merge(devforge_proxy_network_disconnect_commands($network));
                        $commands->push("docker network rm {$safe} >/dev/null 2>&1 || true");
                    } else {
                        $data = collect(json_decode($out, true));
                        if ($data->count() === 1) {
                            $isProxyItself = is_devforge_proxy_container_name((string) data_get($data->first(), 'Name'));
                            if ($isProxyItself) {
                                $commands = $commands->merge(devforge_proxy_network_disconnect_commands($network));
                                $commands->push("docker network rm {$safe} >/dev/null 2>&1 || true");
                            }
                        }
                    }
                }
                if ($commands->isNotEmpty()) {
                    remote_process(command: $commands, type: ActivityTypes::INLINE->value, server: $server, ignore_errors: false);
                }
            } catch (\Throwable $e) {
                echo "Error in cleaning up unused networks from coolify proxy: {$e->getMessage()}\n";
            }
        }
    }

    private function restoreCoolifyDbBackup()
    {
        if (version_compare('4.0.0-beta.179', config('constants.coolify.version'), '<=')) {
            try {
                $database = StandalonePostgresql::withTrashed()->find(0);
                if ($database && $database->trashed()) {
                    $database->restore();
                    $scheduledBackup = ScheduledDatabaseBackup::find(0);
                    if (! $scheduledBackup) {
                        ScheduledDatabaseBackup::create([
                            'id' => 0,
                            'enabled' => true,
                            'save_s3' => false,
                            'frequency' => '0 0 * * *',
                            'database_id' => $database->id,
                            'database_type' => StandalonePostgresql::class,
                            'team_id' => 0,
                        ]);
                    }
                }
            } catch (\Throwable $e) {
                echo "Error in restoring instance db backup: {$e->getMessage()}\n";
            }
        }
    }

    private function sendAliveSignal()
    {
        // DevForge does not phone home.
    }

    private function replaceSlashInEnvironmentName()
    {
        if (version_compare('4.0.0-beta.298', config('constants.coolify.version'), '<=')) {
            $environments = Environment::all();
            foreach ($environments as $environment) {
                if (str_contains($environment->name, '/')) {
                    $environment->name = str_replace('/', '-', $environment->name);
                    $environment->save();
                }
            }
        }
    }
}
