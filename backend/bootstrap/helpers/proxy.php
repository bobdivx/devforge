<?php

use App\Actions\Proxy\SaveProxyConfiguration;
use App\Enums\ProxyTypes;
use App\Models\Application;
use App\Models\Server;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Log;
use Symfony\Component\Yaml\Yaml;

/**
 * Check if a network name is a Docker predefined system network.
 * These networks cannot be created, modified, or managed by docker network commands.
 *
 * @param  string  $network  Network name to check
 * @return bool True if it's a predefined network that should be skipped
 */
function isDockerPredefinedNetwork(string $network): bool
{
    // Only filter 'default' and 'host' to match existing codebase patterns
    // See: bootstrap/helpers/parsers.php:891, bootstrap/helpers/shared.php:689,748
    return in_array($network, ['default', 'host'], true);
}

function devforge_proxy_stack_name(): string
{
    return 'devforge-traefik';
}

function devforge_proxy_container_name(?Server $server = null): string
{
    if ($server?->isSwarm()) {
        return 'devforge-traefik_traefik';
    }

    return 'devforge-traefik';
}

/**
 * @return list<string>
 */
function devforge_proxy_legacy_container_names(?Server $server = null): array
{
    if ($server?->isSwarm()) {
        return ['coolify-proxy_traefik'];
    }

    return ['coolify-proxy'];
}

/**
 * @return list<string>
 */
function devforge_proxy_container_names(?Server $server = null): array
{
    return array_values(array_unique([
        devforge_proxy_container_name($server),
        ...devforge_proxy_legacy_container_names($server),
    ]));
}

function is_managed_devforge_proxy_container_name(string $name): bool
{
    $normalized = ltrim($name, '/');

    return in_array($normalized, [
        'devforge-traefik',
        'devforge-traefik_traefik',
    ], true);
}

function is_devforge_proxy_container_name(string $name): bool
{
    $normalized = ltrim($name, '/');

    return in_array($normalized, [
        'devforge-traefik',
        'devforge-traefik_traefik',
        'coolify-proxy',
        'coolify-proxy_traefik',
    ], true);
}

function proxy_configuration_uses_legacy_container(?string $configuration): bool
{
    if (blank($configuration)) {
        return false;
    }

    return (bool) preg_match('/(?:container_name|name):\s*[\'"]?coolify-proxy(?:_traefik)?[\'"]?/', $configuration);
}

/**
 * @return list<string>
 */
function devforge_proxy_stop_commands(?Server $server = null, int $timeout = 30): array
{
    $commands = [];

    foreach (devforge_proxy_container_names($server) as $name) {
        $commands = [
            ...$commands,
            "if docker ps -a --format \"{{.Names}}\" | grep -q \"^{$name}$\"; then",
            "    echo 'Stopping and removing existing {$name}.'",
            "    docker stop -t {$timeout} {$name} 2>/dev/null || true",
            "    docker rm -f {$name} 2>/dev/null || true",
            '    for i in {1..10}; do',
            "        if ! docker ps -a --format \"{{.Names}}\" | grep -q \"^{$name}$\"; then",
            '            break',
            '        fi',
            "        echo \"Waiting for {$name} to be removed... (\$i/10)\"",
            '        sleep 1',
            '    done',
            "    echo 'Successfully stopped and removed existing {$name}.'",
            'fi',
        ];
    }

    return $commands;
}

/**
 * @return list<string>
 */
function devforge_proxy_network_disconnect_commands(string $network): array
{
    $safe = escapeshellarg($network);

    return array_map(
        fn (string $name): string => "docker network disconnect {$safe} {$name} >/dev/null 2>&1 || true",
        devforge_proxy_container_names(),
    );
}

function collectProxyDockerNetworksByServer(Server $server)
{
    if (! $server->isFunctional()) {
        return collect();
    }
    $proxyType = $server->proxyType();
    if (is_null($proxyType) || $proxyType === 'NONE') {
        return collect();
    }
    $inspect = collect(devforge_proxy_container_names($server))
        ->map(fn (string $name): ?string => instant_remote_process(
            ["docker inspect --format=\"{{json .NetworkSettings.Networks }}\" {$name} 2>/dev/null"],
            $server,
            false,
        ))
        ->first(fn (?string $output): bool => filled($output));

    $networks = $inspect;

    return collect($networks)->map(function ($network) {
        return collect(json_decode($network))->keys();
    })->flatten()->unique();
}
function collectDockerNetworksByServer(Server $server)
{
    $allNetworks = collect([]);
    if ($server->isSwarm()) {
        $networks = collect($server->swarmDockers)->map(function ($docker) {
            return $docker['network'];
        });
    } else {
        // Standalone networks
        $networks = collect($server->standaloneDockers)->map(function ($docker) {
            return $docker['network'];
        });
    }
    $allNetworks = $allNetworks->merge($networks);
    // Service networks
    foreach ($server->services()->get() as $service) {
        if ($service->isRunning()) {
            $networks->push($service->networks());
        }
        $allNetworks->push($service->networks());
    }
    // Docker compose based apps
    $docker_compose_apps = $server->dockerComposeBasedApplications();
    foreach ($docker_compose_apps as $app) {
        if ($app->isRunning()) {
            $networks->push($app->uuid);
        }
        $allNetworks->push($app->uuid);
    }
    // Docker compose based preview deployments
    $docker_compose_previews = $server->dockerComposeBasedPreviewDeployments();
    foreach ($docker_compose_previews as $preview) {
        if (! $preview->isRunning()) {
            continue;
        }
        $pullRequestId = $preview->pull_request_id;
        $applicationId = $preview->application_id;
        $application = Application::find($applicationId);
        if (! $application) {
            continue;
        }
        $network = "{$application->uuid}-{$pullRequestId}";
        $networks->push($network);
        $allNetworks->push($network);
    }
    $networks = collect($networks)->flatten()->unique()->filter(function ($network) {
        return ! isDockerPredefinedNetwork($network);
    });
    $allNetworks = $allNetworks->flatten()->unique()->filter(function ($network) {
        return ! isDockerPredefinedNetwork($network);
    });
    if ($server->isSwarm()) {
        if ($networks->count() === 0) {
            $networks = collect(['coolify-overlay']);
            $allNetworks = collect(['coolify-overlay']);
        }
    } else {
        if ($networks->count() === 0) {
            $networks = collect(['coolify']);
            $allNetworks = collect(['coolify']);
        }
    }

    return [
        'networks' => $networks,
        'allNetworks' => $allNetworks,
    ];
}
function connectProxyToNetworks(Server $server)
{
    ['networks' => $networks] = collectDockerNetworksByServer($server);
    $proxyContainerName = devforge_proxy_container_name($server);
    if ($server->isSwarm()) {
        $commands = $networks->map(function ($network) use ($proxyContainerName) {
            $safe = escapeshellarg($network);

            return [
                "docker network ls --format '{{.Name}}' | grep '^{$network}$' >/dev/null || docker network create --driver overlay --attachable {$safe} >/dev/null",
                "docker network connect {$safe} {$proxyContainerName} >/dev/null 2>&1 || true",
                "echo 'Successfully connected {$proxyContainerName} to {$safe} network.'",
            ];
        });
    } else {
        $commands = $networks->map(function ($network) use ($proxyContainerName) {
            $safe = escapeshellarg($network);

            return [
                "docker network ls --format '{{.Name}}' | grep '^{$network}$' >/dev/null || docker network create --attachable {$safe} >/dev/null",
                "docker network connect {$safe} {$proxyContainerName} >/dev/null 2>&1 || true",
                "echo 'Successfully connected {$proxyContainerName} to {$safe} network.'",
            ];
        });
    }

    return $commands->flatten();
}

/**
 * Ensures all required networks exist before docker compose up.
 * This must be called BEFORE docker compose up since the compose file declares networks as external.
 *
 * @param  Server  $server  The server to ensure networks on
 * @return Collection Commands to create networks if they don't exist
 */
function ensureProxyNetworksExist(Server $server)
{
    ['allNetworks' => $networks] = collectDockerNetworksByServer($server);

    if ($server->isSwarm()) {
        $commands = $networks->map(function ($network) {
            $safe = escapeshellarg($network);

            return [
                "echo 'Ensuring network {$safe} exists...'",
                "docker network ls --format '{{.Name}}' | grep -q '^{$network}$' || docker network create --driver overlay --attachable {$safe}",
            ];
        });
    } else {
        $commands = $networks->map(function ($network) {
            $safe = escapeshellarg($network);

            return [
                "echo 'Ensuring network {$safe} exists...'",
                "docker network ls --format '{{.Name}}' | grep -q '^{$network}$' || docker network create --attachable {$safe}",
            ];
        });
    }

    return $commands->flatten();
}

function extractCustomProxyCommands(Server $server, string $existing_config): array
{
    $custom_commands = [];
    $proxy_type = $server->proxyType();

    if ($proxy_type !== ProxyTypes::TRAEFIK->value || empty($existing_config)) {
        return $custom_commands;
    }

    try {
        $yaml = Yaml::parse($existing_config);
        $existing_commands = data_get($yaml, 'services.traefik.command', []);

        if (empty($existing_commands)) {
            return $custom_commands;
        }

        // Define default commands that DevForge generates
        $default_command_prefixes = [
            '--ping=',
            '--api.',
            '--entrypoints.http.address=',
            '--entrypoints.https.address=',
            '--entrypoints.http.http.encodequerysemicolons=',
            '--entryPoints.http.http2.maxConcurrentStreams=',
            '--entrypoints.https.http.encodequerysemicolons=',
            '--entryPoints.https.http2.maxConcurrentStreams=',
            '--entrypoints.https.http3',
            '--providers.file.',
            '--certificatesresolvers.',
            '--providers.docker',
            '--providers.swarm',
            '--log.level=',
            '--accesslog.',
        ];

        // Extract commands that don't match default prefixes (these are custom)
        foreach ($existing_commands as $command) {
            $is_default = false;
            foreach ($default_command_prefixes as $prefix) {
                if (str_starts_with($command, $prefix)) {
                    $is_default = true;
                    break;
                }
            }
            if (! $is_default) {
                $custom_commands[] = $command;
            }
        }
    } catch (Exception $e) {
        // If we can't parse the config, return empty array
        // Silently fail to avoid breaking the proxy regeneration
    }

    return $custom_commands;
}
function generateDefaultProxyConfiguration(Server $server, array $custom_commands = [])
{
    Log::info('Generating default proxy configuration', [
        'server_id' => $server->id,
        'server_name' => $server->name,
        'custom_commands_count' => count($custom_commands),
        'caller' => debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 3)[1]['class'] ?? 'unknown',
    ]);

    $proxy_path = $server->proxyPath();
    $proxy_type = $server->proxyType();

    if ($server->isSwarm()) {
        $networks = collect($server->swarmDockers)->map(function ($docker) {
            return $docker['network'];
        })->unique();
        if ($networks->count() === 0) {
            $networks = collect(['coolify-overlay']);
        }
    } else {
        $networks = collect($server->standaloneDockers)->map(function ($docker) {
            return $docker['network'];
        })->unique();
        if ($networks->count() === 0) {
            $networks = collect(['coolify']);
        }
    }

    $array_of_networks = collect([]);
    $filtered_networks = collect([]);
    $networks->map(function ($network) use ($array_of_networks, $filtered_networks) {
        if (isDockerPredefinedNetwork($network)) {
            return; // Predefined networks cannot be used in network configuration
        }

        $array_of_networks[$network] = [
            'external' => true,
        ];
        $filtered_networks->push($network);
    });
    if ($proxy_type === ProxyTypes::TRAEFIK->value) {
        $labels = [
            'traefik.enable=true',
            'traefik.http.routers.traefik.entrypoints=http',
            'traefik.http.routers.traefik.service=api@internal',
            'traefik.http.services.traefik.loadbalancer.server.port=8080',
            'devforge.managed=true',
            'devforge.proxy=true',
        ];
        $config = [
            'name' => devforge_proxy_stack_name(),
            'networks' => $array_of_networks->toArray(),
            'services' => [
                'traefik' => [
                    'container_name' => devforge_proxy_container_name(),
                    'image' => 'traefik:v3.6',
                    'restart' => RESTART_MODE,
                    'extra_hosts' => [
                        'host.docker.internal:host-gateway',
                    ],
                    'networks' => $filtered_networks->toArray(),
                    'ports' => [
                        '80:80',
                        '443:443',
                        '443:443/udp',
                    ],
                    'healthcheck' => [
                        'test' => 'wget -qO- http://localhost:80/ping || exit 1',
                        'interval' => '4s',
                        'timeout' => '2s',
                        'retries' => 5,
                    ],
                    'volumes' => [
                        '/var/run/docker.sock:/var/run/docker.sock:ro',

                    ],
                    'command' => [
                        '--ping=true',
                        '--ping.entrypoint=http',
                        '--api.dashboard=true',
                        '--entrypoints.http.address=:80',
                        '--entrypoints.https.address=:443',
                        '--entrypoints.http.http.encodequerysemicolons=true',
                        '--entryPoints.http.http2.maxConcurrentStreams=250',
                        '--entrypoints.https.http.encodequerysemicolons=true',
                        '--entryPoints.https.http2.maxConcurrentStreams=250',
                        '--entrypoints.https.http3',
                        '--providers.file.directory=/traefik/dynamic/',
                        '--providers.file.watch=true',
                        '--certificatesresolvers.letsencrypt.acme.httpchallenge=true',
                        '--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=http',
                        '--certificatesresolvers.letsencrypt.acme.storage=/traefik/acme.json',
                    ],
                    'labels' => $labels,
                ],
            ],
        ];
        if (isDev()) {
            $config['services']['traefik']['command'][] = '--api.insecure=true';
            $config['services']['traefik']['command'][] = '--log.level=debug';
            $config['services']['traefik']['command'][] = '--accesslog.filepath=/traefik/access.log';
            $config['services']['traefik']['command'][] = '--accesslog.bufferingsize=100';
            $config['services']['traefik']['volumes'][] = '/var/lib/docker/volumes/coolify_dev_coolify_data/_data/proxy/:/traefik';
        } else {
            $config['services']['traefik']['command'][] = '--api.insecure=false';
            $config['services']['traefik']['volumes'][] = "{$proxy_path}:/traefik";
        }
        if ($server->isSwarm()) {
            data_forget($config, 'services.traefik.container_name');
            data_forget($config, 'services.traefik.restart');
            data_forget($config, 'services.traefik.labels');

            $config['services']['traefik']['command'][] = '--providers.swarm.endpoint=unix:///var/run/docker.sock';
            $config['services']['traefik']['command'][] = '--providers.swarm.exposedbydefault=false';
            $config['services']['traefik']['deploy'] = [
                'labels' => $labels,
                'placement' => [
                    'constraints' => [
                        'node.role==manager',
                    ],
                ],
            ];
        } else {
            $config['services']['traefik']['command'][] = '--providers.docker=true';
            $config['services']['traefik']['command'][] = '--providers.docker.exposedbydefault=false';
            $primaryNetwork = $filtered_networks->first();
            if (is_string($primaryNetwork) && $primaryNetwork !== '') {
                $config['services']['traefik']['command'][] = "--providers.docker.network={$primaryNetwork}";
            }
        }

        // Append custom commands (e.g., trustedIPs for Cloudflare)
        if (! empty($custom_commands)) {
            foreach ($custom_commands as $custom_command) {
                $config['services']['traefik']['command'][] = $custom_command;
            }
        }
    } elseif ($proxy_type === 'CADDY') {
        $config = [
            'name' => devforge_proxy_stack_name(),
            'networks' => $array_of_networks->toArray(),
            'services' => [
                'caddy' => [
                    'container_name' => devforge_proxy_container_name(),
                    'image' => 'lucaslorentz/caddy-docker-proxy:2.8-alpine',
                    'restart' => RESTART_MODE,
                    'extra_hosts' => [
                        'host.docker.internal:host-gateway',
                    ],
                    'environment' => [
                        'CADDY_DOCKER_POLLING_INTERVAL=5s',
                        'CADDY_DOCKER_CADDYFILE_PATH=/dynamic/Caddyfile',
                    ],
                    'networks' => $filtered_networks->toArray(),
                    'ports' => [
                        '80:80',
                        '443:443',
                        '443:443/udp',
                    ],
                    'labels' => [
                        'devforge.managed=true',
                        'devforge.proxy=true',
                    ],
                    'volumes' => [
                        '/var/run/docker.sock:/var/run/docker.sock:ro',
                        "{$proxy_path}/dynamic:/dynamic",
                        "{$proxy_path}/config:/config",
                        "{$proxy_path}/data:/data",
                    ],
                ],
            ],
        ];
    } else {
        return null;
    }

    $config = Yaml::dump($config, 12, 2);
    SaveProxyConfiguration::run($server, $config);

    return $config;
}

function getExactTraefikVersionFromContainer(Server $server): ?string
{
    try {
        Log::debug("getExactTraefikVersionFromContainer: Server '{$server->name}' (ID: {$server->id}) - Checking for exact version");

        // Method A: Execute traefik version command (most reliable)
        $versionCommand = collect(devforge_proxy_container_names($server))
            ->map(fn (string $name): string => "docker exec {$name} traefik version 2>/dev/null")
            ->implode(' || ')
            ." | grep -oP 'Version:\\s+\\K\\d+\\.\\d+\\.\\d+'";
        Log::debug("getExactTraefikVersionFromContainer: Server '{$server->name}' (ID: {$server->id}) - Running: {$versionCommand}");

        $output = instant_remote_process([$versionCommand], $server, false);

        if (! empty(trim($output))) {
            $version = trim($output);
            Log::debug("getExactTraefikVersionFromContainer: Server '{$server->name}' (ID: {$server->id}) - Detected exact version from command: {$version}");

            return $version;
        }

        // Method B: Try OCI label as fallback
        $labelCommand = collect(devforge_proxy_container_names($server))
            ->map(fn (string $name): string => "docker inspect {$name} --format '{{index .Config.Labels \"org.opencontainers.image.version\"}}' 2>/dev/null")
            ->implode(' || ');
        Log::debug("getExactTraefikVersionFromContainer: Server '{$server->name}' (ID: {$server->id}) - Trying OCI label");

        $label = instant_remote_process([$labelCommand], $server, false);

        if (! empty(trim($label))) {
            // Extract version number from label (might have 'v' prefix)
            if (preg_match('/(\d+\.\d+\.\d+)/', trim($label), $matches)) {
                Log::debug("getExactTraefikVersionFromContainer: Server '{$server->name}' (ID: {$server->id}) - Detected from OCI label: {$matches[1]}");

                return $matches[1];
            }
        }

        Log::debug("getExactTraefikVersionFromContainer: Server '{$server->name}' (ID: {$server->id}) - Could not detect exact version");

        return null;
    } catch (Exception $e) {
        Log::error("getExactTraefikVersionFromContainer: Server '{$server->name}' (ID: {$server->id}) - Error: ".$e->getMessage());

        return null;
    }
}

function getTraefikVersionFromDockerCompose(Server $server): ?string
{
    try {
        Log::debug("getTraefikVersionFromDockerCompose: Server '{$server->name}' (ID: {$server->id}) - Starting version detection");

        // Try to get exact version from running container (e.g., "3.6.0")
        $exactVersion = getExactTraefikVersionFromContainer($server);
        if ($exactVersion) {
            Log::debug("getTraefikVersionFromDockerCompose: Server '{$server->name}' (ID: {$server->id}) - Using exact version: {$exactVersion}");

            return $exactVersion;
        }

        // Fallback: Check image tag (current method)
        Log::debug("getTraefikVersionFromDockerCompose: Server '{$server->name}' (ID: {$server->id}) - Falling back to image tag detection");

        $containerName = devforge_proxy_container_name($server);
        $inspectCommand = collect(devforge_proxy_container_names($server))
            ->map(fn (string $name): string => "docker inspect {$name} --format '{{.Config.Image}}' 2>/dev/null")
            ->implode(' || ');

        $image = instant_remote_process([$inspectCommand], $server, false);

        if (empty(trim($image))) {
            Log::debug("getTraefikVersionFromDockerCompose: Server '{$server->name}' (ID: {$server->id}) - Container '{$containerName}' not found or not running");

            return null;
        }

        $image = trim($image);
        Log::debug("getTraefikVersionFromDockerCompose: Server '{$server->name}' (ID: {$server->id}) - Running container image: {$image}");

        // Extract version from image string (e.g., "traefik:v3.6" or "traefik:3.6.0" or "traefik:latest")
        if (preg_match('/traefik:(v?\d+\.\d+(?:\.\d+)?|latest)/i', $image, $matches)) {
            Log::debug("getTraefikVersionFromDockerCompose: Server '{$server->name}' (ID: {$server->id}) - Extracted version from image tag: {$matches[1]}");

            return $matches[1];
        }

        Log::debug("getTraefikVersionFromDockerCompose: Server '{$server->name}' (ID: {$server->id}) - Image format doesn't match expected pattern: {$image}");

        return null;
    } catch (Exception $e) {
        Log::error("getTraefikVersionFromDockerCompose: Server '{$server->name}' (ID: {$server->id}) - Error: ".$e->getMessage());

        return null;
    }
}
