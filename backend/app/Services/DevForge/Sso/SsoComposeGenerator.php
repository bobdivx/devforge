<?php

namespace App\Services\DevForge\Sso;

use App\Models\InstanceSettings;
use App\Models\Server;

class SsoComposeGenerator
{
    /**
     * @return array<string, mixed>
     */
    public function generate(Server $server, InstanceSettings $settings): array
    {
        $urls = SsoProtection::publicUrls($settings);
        if ($urls === null) {
            throw new \RuntimeException('A domain is required before starting the SSO stack.');
        }

        $network = $server->standaloneDockers()->value('network') ?: 'devforge';
        $dataPath = SsoProtection::stackPath().'/data';
        $appsClientId = (string) $settings->sso_apps_client_id;
        $appsClientSecret = (string) $settings->sso_apps_client_secret;

        return [
            'name' => SsoProtection::COMPOSE_PROJECT,
            'networks' => [
                $network => [
                    'external' => true,
                ],
            ],
            'services' => [
                'pocket-id' => [
                    'container_name' => SsoProtection::POCKET_ID_CONTAINER,
                    'image' => 'ghcr.io/pocket-id/pocket-id:v2',
                    'restart' => RESTART_MODE,
                    'environment' => [
                        'APP_URL' => $urls['pocket_id'],
                        'TRUST_PROXY' => 'true',
                        'PUID' => '1000',
                        'PGID' => '1000',
                        'ENCRYPTION_KEY_FILE' => '/run/secrets/encryption.key',
                        'STATIC_API_KEY' => (string) $settings->sso_static_api_key,
                        'ANALYTICS_DISABLED' => 'true',
                        'VERSION_CHECK_DISABLED' => 'true',
                        'ALLOW_INSECURE_CALLBACK_URLS' => $urls['scheme'] === 'http' ? 'true' : 'false',
                    ],
                    'volumes' => [
                        $dataPath.':/app/data',
                        SsoProtection::encryptionKeyFilePath().':/run/secrets/encryption.key:ro',
                    ],
                    'networks' => [
                        $network => [
                            'aliases' => [
                                'devforge-sso-pocket-id',
                            ],
                        ],
                    ],
                    'labels' => $this->traefikLabels(
                        router: 'devforge-sso-pocket-id',
                        host: (string) parse_url($urls['pocket_id'], PHP_URL_HOST),
                        port: 1411,
                        https: $urls['scheme'] === 'https',
                    ),
                    'healthcheck' => [
                        'test' => ['CMD', '/app/pocket-id', 'healthcheck'],
                        'interval' => '10s',
                        'timeout' => '5s',
                        'retries' => 12,
                        'start_period' => '10s',
                    ],
                ],
                'oauth2-proxy' => [
                    'container_name' => SsoProtection::OAUTH2_PROXY_CONTAINER,
                    'image' => 'quay.io/oauth2-proxy/oauth2-proxy:v7.8.2-alpine',
                    'restart' => RESTART_MODE,
                    'environment' => [
                        'OAUTH2_PROXY_HTTP_ADDRESS' => '0.0.0.0:4180',
                        'OAUTH2_PROXY_PROVIDER' => 'oidc',
                        'OAUTH2_PROXY_OIDC_ISSUER_URL' => SsoProtection::INTERNAL_POCKET_ID_URL,
                        'OAUTH2_PROXY_INSECURE_OIDC_SKIP_ISSUER_VERIFICATION' => 'true',
                        'OAUTH2_PROXY_CLIENT_ID' => $appsClientId !== '' ? $appsClientId : 'pending',
                        'OAUTH2_PROXY_CLIENT_SECRET' => $appsClientSecret !== '' ? $appsClientSecret : 'pending',
                        'OAUTH2_PROXY_COOKIE_SECRET' => (string) $settings->sso_oauth2_cookie_secret,
                        'OAUTH2_PROXY_REDIRECT_URL' => $urls['oauth2_proxy'].'/oauth2/callback',
                        'OAUTH2_PROXY_EMAIL_DOMAINS' => '*',
                        'OAUTH2_PROXY_REVERSE_PROXY' => 'true',
                        'OAUTH2_PROXY_SET_XAUTHREQUEST' => 'true',
                        'OAUTH2_PROXY_SET_AUTHORIZATION_HEADER' => 'true',
                        'OAUTH2_PROXY_SKIP_PROVIDER_BUTTON' => 'true',
                        'OAUTH2_PROXY_WHITELIST_DOMAINS' => '*',
                        'OAUTH2_PROXY_COOKIE_SECURE' => $urls['scheme'] === 'https' ? 'true' : 'false',
                        'OAUTH2_PROXY_COOKIE_DOMAINS' => $urls['cookie_domain'],
                    ],
                    'networks' => [
                        $network => [
                            'aliases' => [
                                'devforge-sso-proxy',
                            ],
                        ],
                    ],
                    'labels' => $this->traefikLabels(
                        router: 'devforge-sso-proxy',
                        host: (string) parse_url($urls['oauth2_proxy'], PHP_URL_HOST),
                        port: 4180,
                        https: $urls['scheme'] === 'https',
                    ),
                    'depends_on' => [
                        'pocket-id' => [
                            'condition' => 'service_healthy',
                        ],
                    ],
                    'healthcheck' => [
                        'test' => ['CMD', 'wget', '-q', '--spider', 'http://127.0.0.1:4180/ping'],
                        'interval' => '10s',
                        'timeout' => '5s',
                        'retries' => 6,
                    ],
                ],
            ],
        ];
    }

    /**
     * @return list<string>
     */
    private function traefikLabels(string $router, string $host, int $port, bool $https): array
    {
        $labels = [
            'devforge.managed=true',
            'devforge.type=sso',
            'traefik.enable=true',
            "traefik.http.services.{$router}.loadbalancer.server.port={$port}",
            "traefik.http.routers.{$router}.rule=Host(`{$host}`)",
            "traefik.http.routers.{$router}.service={$router}",
            "traefik.http.routers.{$router}-http.rule=Host(`{$host}`)",
            "traefik.http.routers.{$router}-http.entrypoints=http",
            "traefik.http.routers.{$router}-http.service={$router}",
        ];

        if ($https) {
            $labels[] = "traefik.http.routers.{$router}.entrypoints=https";
            $labels[] = "traefik.http.routers.{$router}.tls=true";
            $labels[] = "traefik.http.routers.{$router}.tls.certresolver=letsencrypt";
        } else {
            $labels[] = "traefik.http.routers.{$router}.entrypoints=http";
        }

        return $labels;
    }
}
