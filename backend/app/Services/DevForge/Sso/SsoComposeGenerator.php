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
                        'ENCRYPTION_KEY' => (string) $settings->sso_encryption_key,
                        'STATIC_API_KEY' => (string) $settings->sso_static_api_key,
                        'ANALYTICS_DISABLED' => 'true',
                        'VERSION_CHECK_DISABLED' => 'true',
                        'ALLOW_INSECURE_CALLBACK_URLS' => $urls['scheme'] === 'http' ? 'true' : 'false',
                    ],
                    'volumes' => [
                        $dataPath.':/app/data',
                    ],
                    'networks' => [
                        $network => [
                            'aliases' => [
                                'devforge-sso-pocket-id',
                            ],
                        ],
                    ],
                    'labels' => [
                        'devforge.managed=true',
                        'devforge.type=sso',
                    ],
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
                    'image' => 'quay.io/oauth2-proxy/oauth2-proxy:v7.8.2',
                    'restart' => RESTART_MODE,
                    'environment' => [
                        'OAUTH2_PROXY_HTTP_ADDRESS' => '0.0.0.0:4180',
                        'OAUTH2_PROXY_PROVIDER' => 'oidc',
                        'OAUTH2_PROXY_OIDC_ISSUER_URL' => $urls['pocket_id'],
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
                    'labels' => [
                        'devforge.managed=true',
                        'devforge.type=sso',
                    ],
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
}
