<?php

namespace App\Actions\Sso;

use App\Models\InstanceSettings;
use App\Models\Server;
use App\Services\DevForge\Sso\ProvisionPocketIdClients;
use App\Services\DevForge\Sso\SsoComposeGenerator;
use App\Services\DevForge\Sso\SsoProtection;
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

        $settings = SsoProtection::ensureSecrets($settings);
        $urls = SsoProtection::publicUrls($settings);
        if ($urls === null) {
            return 'NO_DOMAIN';
        }

        $settings->sso_pocket_id_url = $urls['pocket_id'];
        $settings->sso_oauth2_proxy_url = $urls['oauth2_proxy'];
        $settings->sso_forward_auth_address = SsoProtection::DEFAULT_FORWARD_AUTH_ADDRESS;
        $settings->save();

        $this->writeAndUp($server, $settings);

        try {
            $settings = app(ProvisionPocketIdClients::class)->handle($settings->fresh());
            if (filled($settings->sso_apps_client_id) && filled($settings->sso_apps_client_secret)) {
                $this->writeAndUp($server, $settings);
            }
        } catch (\Throwable $e) {
            Log::warning('SSO stack started but OIDC clients were not provisioned yet.', [
                'error' => $e->getMessage(),
            ]);
        }

        $server->setupSsoProxyConfiguration();

        return 'OK';
    }

    private function writeAndUp(Server $server, InstanceSettings $settings): void
    {
        $path = SsoProtection::stackPath();
        $compose = app(SsoComposeGenerator::class)->generate($server, $settings);
        $yaml = Yaml::dump($compose, 12, 2);
        $base64 = base64_encode($yaml);

        $commands = collect([
            "mkdir -p {$path}/data",
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
}
