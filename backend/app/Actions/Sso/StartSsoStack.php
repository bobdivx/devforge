<?php

namespace App\Actions\Sso;

use App\Models\InstanceSettings;
use App\Models\Server;
use App\Services\DevForge\Sso\ProvisionPocketIdClients;
use App\Services\DevForge\Sso\SsoComposeGenerator;
use App\Services\DevForge\Sso\SsoProtection;
use App\Services\DevForge\Sso\SyncApplicationOidcEnvironment;
use Illuminate\Support\Facades\Log;
use Lorisleiva\Actions\Concerns\AsAction;
use Symfony\Component\Yaml\Yaml;

class StartSsoStack
{
    use AsAction;

    public function handle(Server $server): string
    {
        if (! $server->isLocalhost() || $server->isSwarm() || $server->isBuildServer()) {
            return 'SKIPPED';
        }

        $settings = instanceSettings();
        if (! SsoProtection::canStartStack($settings)) {
            return 'NO_DOMAIN';
        }

        $settings = $this->alignEncryptionKey($server, $settings);
        $urls = SsoProtection::publicUrls($settings);
        if ($urls === null) {
            return 'NO_DOMAIN';
        }

        $settings->sso_pocket_id_url = $urls['pocket_id'];
        $settings->sso_oauth2_proxy_url = $urls['oauth2_proxy'];
        $settings->sso_forward_auth_address = SsoProtection::DEFAULT_FORWARD_AUTH_ADDRESS;
        $settings->save();

        $this->writeAndUp($server, $settings);
        $this->provisionClients($server);
        $server->setupSsoProxyConfiguration();

        return 'OK';
    }

    public function provisionClients(Server $server): void
    {
        try {
            $settings = instanceSettings();
            $previousAppsId = $settings->sso_apps_client_id;
            $previousAppsSecret = $settings->sso_apps_client_secret;
            $settings = app(ProvisionPocketIdClients::class)->handle($settings->fresh());
            $appsCredentialsChanged = $settings->sso_apps_client_id !== $previousAppsId
                || $settings->sso_apps_client_secret !== $previousAppsSecret;

            if (
                filled($settings->sso_apps_client_id)
                && filled($settings->sso_apps_client_secret)
                && $appsCredentialsChanged
            ) {
                $this->writeAndUp($server, $settings);
            }

            app(SyncApplicationOidcEnvironment::class)->sync();
        } catch (\Throwable $e) {
            Log::warning('SSO stack started but OIDC clients were not provisioned yet.', [
                'error' => $e->getMessage(),
            ]);
        }
    }

    private function writeAndUp(Server $server, InstanceSettings $settings): void
    {
        $path = SsoProtection::stackPath();
        $compose = app(SsoComposeGenerator::class)->generate($server, $settings);
        $yaml = Yaml::dump($compose, 12, 2);
        $base64 = base64_encode($yaml);

        $commands = collect(SsoProtection::persistEncryptionKeyCommands((string) $settings->sso_encryption_key));
        $commands = $commands->merge([
            "cd {$path}",
            "echo '{$base64}' | base64 -d | tee {$path}/docker-compose.yml > /dev/null",
        ]);
        $commands = $commands->merge(ensureProxyNetworksExist($server));
        $commands = $commands->merge([
            'docker compose -p '.SsoProtection::COMPOSE_PROJECT.' up -d --wait --remove-orphans',
        ]);
        $commands = $commands->merge(connectProxyToNetworks($server));

        instant_remote_process($commands, $server);
    }

    private function alignEncryptionKey(Server $server, InstanceSettings $settings): InstanceSettings
    {
        $keyFile = SsoProtection::encryptionKeyFilePath();
        $hostKey = trim((string) instant_remote_process(
            ["cat {$keyFile} 2>/dev/null || true"],
            $server,
            throwError: false,
        ));

        if ($hostKey !== '') {
            $settings->sso_encryption_key = $hostKey;
            $settings->save();
        }

        return SsoProtection::ensureSecrets($settings->fresh() ?? $settings);
    }
}
