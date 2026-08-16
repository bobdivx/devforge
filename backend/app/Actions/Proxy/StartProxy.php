<?php

namespace App\Actions\Proxy;

use App\Enums\ProxyTypes;
use App\Events\ProxyStatusChanged;
use App\Events\ProxyStatusChangedUI;
use App\Models\Server;
use Lorisleiva\Actions\Concerns\AsAction;
use Spatie\Activitylog\Models\Activity;

class StartProxy
{
    use AsAction;

    public function handle(Server $server, bool $async = true, bool $force = false, bool $restarting = false): string|Activity
    {
        $proxyType = $server->proxyType();
        if ((is_null($proxyType) || $proxyType === 'NONE' || $server->proxy->force_stop || $server->isBuildServer()) && $force === false) {
            return 'OK';
        }
        $server->proxy->set('status', 'starting');
        $server->save();
        $server->refresh();

        if (! $restarting) {
            ProxyStatusChangedUI::dispatch($server->team_id);
        }

        $commands = collect([]);
        $proxy_path = $server->proxyPath();
        $configuration = GetProxyConfiguration::run($server);
        if (! $configuration) {
            throw new \Exception('Configuration is not synced');
        }
        SaveProxyConfiguration::run($server, $configuration);
        $docker_compose_yml_base64 = base64_encode($configuration);
        $server->proxy->last_applied_settings = str($docker_compose_yml_base64)->pipe('md5')->value();
        $server->save();

        if ($server->isSwarmManager()) {
            $commands = $commands->merge([
                "mkdir -p $proxy_path/dynamic",
                "cd $proxy_path",
                "echo 'Creating required Docker Compose file.'",
                "echo 'Starting proxy.'",
                'docker stack deploy --detach=true -c docker-compose.yml '.devforge_proxy_stack_name(),
                "echo 'Successfully started proxy.'",
            ]);
        } else {
            if (isDev()) {
                if ($proxyType === ProxyTypes::CADDY->value) {
                    $proxy_path = '/data/coolify/proxy/caddy';
                }
            }
            $caddyfile = 'import /dynamic/*.caddy';
            $commands = $commands->merge([
                "mkdir -p $proxy_path/dynamic",
                "cd $proxy_path",
                "echo '$caddyfile' > $proxy_path/dynamic/Caddyfile",
                "echo 'Creating required Docker Compose file.'",
                "echo 'Pulling docker image.'",
                'docker compose pull',
            ]);
            $commands = $commands->merge(devforge_proxy_stop_commands($server));
            // Ensure required networks exist BEFORE docker compose up (networks are declared as external)
            $commands = $commands->merge(ensureProxyNetworksExist($server));
            $commands = $commands->merge([
                "echo 'Starting proxy.'",
                'docker compose up -d --wait --remove-orphans',
                "echo 'Successfully started proxy.'",
            ]);
            $commands = $commands->merge(connectProxyToNetworks($server));
        }

        if ($async) {
            return remote_process($commands, $server, callEventOnFinish: 'ProxyStatusChanged', callEventData: $server->id);
        } else {
            instant_remote_process($commands, $server);

            $server->proxy->set('type', $proxyType);
            $server->save();
            ProxyStatusChanged::dispatch($server->id);

            return 'OK';
        }
    }
}
