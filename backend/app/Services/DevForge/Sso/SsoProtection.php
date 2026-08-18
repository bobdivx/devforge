<?php

namespace App\Services\DevForge\Sso;

use App\Models\Application;
use App\Models\InstanceSettings;
use App\Models\OauthSetting;
use App\Models\Server;
use App\Models\ServiceApplication;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;
use Spatie\Url\Url;

class SsoProtection
{
    public const MIDDLEWARE_NAME = 'devforge-sso-auth';

    public const DEFAULT_FORWARD_AUTH_ADDRESS = 'http://devforge-sso-proxy:4180/';

    public const POCKET_ID_CONTAINER = 'devforge-sso-pocket-id';

    public const OAUTH2_PROXY_CONTAINER = 'devforge-sso-proxy';

    public const COMPOSE_PROJECT = 'devforge-sso';

    public const INTERNAL_POCKET_ID_URL = 'http://devforge-sso-pocket-id:1411';

    /**
     * @var list<string>
     */
    private const EXCLUDED_IMAGE_NEEDLES = [
        'pocket-id',
        'pocketid',
        'oauth2-proxy',
        'traefik-forward-auth',
        'tinyauth',
    ];

    public static function middlewareName(): string
    {
        return self::MIDDLEWARE_NAME;
    }

    public static function stackPath(): string
    {
        if (function_exists('isDev') && isDev()) {
            return '/var/lib/docker/volumes/coolify_dev_coolify_data/_data/sso';
        }

        return rtrim((string) config('constants.coolify.base_config_path'), '/').'/sso';
    }

    public static function encryptionKeyFilePath(): string
    {
        return self::stackPath().'/encryption.key';
    }

    /**
     * Host commands that persist the Pocket ID encryption key without a trailing newline.
     *
     * @return list<string>
     */
    public static function persistEncryptionKeyCommands(string $key): array
    {
        $path = self::encryptionKeyFilePath();
        $base64 = base64_encode($key);

        return [
            'mkdir -p '.self::stackPath().'/data/application-images',
            'chmod -R ug+rwX '.self::stackPath().'/data',
            'chown -R 1000:1000 '.self::stackPath().'/data || true',
            "echo '{$base64}' | base64 -d | tee {$path} > /dev/null",
        ];
    }

    /**
     * Host commands that drop the SQLite files so Pocket ID can boot with a new key.
     *
     * @return list<string>
     */
    public static function resetPocketIdDatabaseCommands(): array
    {
        $data = self::stackPath().'/data';

        return [
            "rm -f {$data}/pocket-id.db {$data}/pocket-id.db-shm {$data}/pocket-id.db-wal",
        ];
    }

    public static function canStartStack(?InstanceSettings $settings = null): bool
    {
        if (function_exists('isCloud') && isCloud()) {
            return false;
        }

        $settings ??= instanceSettings();

        return self::publicUrls($settings) !== null;
    }

    /**
     * @return array{scheme: string, host: string, pocket_id: string, oauth2_proxy: string, cookie_domain: string}|null
     */
    public static function publicUrls(?InstanceSettings $settings = null): ?array
    {
        $settings ??= instanceSettings();
        $base = filled($settings->apps_wildcard_domain)
            ? (string) $settings->apps_wildcard_domain
            : (string) $settings->fqdn;

        if (! filled($base)) {
            return null;
        }

        if (! str_contains($base, '://')) {
            $base = 'https://'.$base;
        }

        try {
            $url = Url::fromString($base);
        } catch (\Throwable) {
            return null;
        }

        $host = $url->getHost();
        if (! filled($host)) {
            return null;
        }

        $scheme = $url->getScheme() ?: 'https';
        $pocketHost = 'id.'.$host;
        $ssoHost = 'sso.'.$host;

        return [
            'scheme' => $scheme,
            'host' => $host,
            'pocket_id' => $scheme.'://'.$pocketHost,
            'oauth2_proxy' => $scheme.'://'.$ssoHost,
            'cookie_domain' => '.'.$host,
        ];
    }

    public static function ensureSecrets(InstanceSettings $settings): InstanceSettings
    {
        $dirty = false;

        if (! filled($settings->sso_static_api_key)) {
            $settings->sso_static_api_key = Str::password(64, symbols: false);
            $dirty = true;
        }

        if (! filled($settings->sso_encryption_key)) {
            $settings->sso_encryption_key = base64_encode(random_bytes(32));
            $dirty = true;
        }

        if (! filled($settings->sso_oauth2_cookie_secret)) {
            $settings->sso_oauth2_cookie_secret = base64_encode(random_bytes(24));
            $dirty = true;
        }

        if ($dirty) {
            $settings->save();
        }

        return $settings->fresh() ?? $settings;
    }

    public static function isAppsProtectionConfigured(?InstanceSettings $settings = null): bool
    {
        $settings ??= instanceSettings();

        return filled($settings->sso_forward_auth_address);
    }

    public static function isAppsOidcConfigured(?InstanceSettings $settings = null): bool
    {
        $settings ??= instanceSettings();

        return filled($settings->sso_apps_client_id) && filled($settings->sso_apps_client_secret);
    }

    public static function pocketIdLoginEnabled(): bool
    {
        $oauth = OauthSetting::query()->firstWhere('provider', 'pocketid');

        return $oauth !== null && $oauth->enabled && $oauth->couldBeEnabled();
    }

    public static function hideLocalLogin(?InstanceSettings $settings = null): bool
    {
        $settings ??= instanceSettings();

        return (bool) $settings->sso_hide_local_login && self::pocketIdLoginEnabled();
    }

    public static function shouldProtectApplicationsByDefault(?InstanceSettings $settings = null): bool
    {
        $settings ??= instanceSettings();

        return self::isAppsProtectionConfigured($settings) && (bool) $settings->sso_protect_apps_by_default;
    }

    public static function shouldProtectApplication(Application $application): bool
    {
        if (! self::isAppsProtectionConfigured()) {
            return false;
        }
        if ($application->is_sso_protected === false) {
            return false;
        }
        if ($application->is_sso_protected === true) {
            return true;
        }

        return self::shouldProtectApplicationsByDefault();
    }

    public static function shouldProtectServiceApplication(ServiceApplication $serviceApplication): bool
    {
        if (! self::shouldProtectApplicationsByDefault()) {
            return false;
        }
        $image = (string) $serviceApplication->image;
        $name = strtolower((string) $serviceApplication->name);
        foreach (self::EXCLUDED_IMAGE_NEEDLES as $needle) {
            if (str_contains(strtolower($image), $needle) || str_contains($name, $needle)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Callback URLs accepted by the shared Pocket ID client used by every deployed app.
     *
     * @return list<string>
     */
    public static function appsOidcCallbackUrls(?InstanceSettings $settings = null): array
    {
        $urls = self::publicUrls($settings);
        if ($urls === null) {
            return [];
        }

        $scheme = $urls['scheme'];
        $host = $urls['host'];
        $callbacks = [
            $urls['oauth2_proxy'].'/oauth2/callback',
            "{$scheme}://{$host}/**",
            "{$scheme}://*.{$host}/**",
        ];

        $labels = explode('.', $host);
        if (count($labels) >= 3) {
            $parent = implode('.', array_slice($labels, 1));
            $callbacks[] = "{$scheme}://{$parent}/**";
            $callbacks[] = "{$scheme}://*.{$parent}/**";
        }

        return array_values(array_unique($callbacks));
    }

    /**
     * Logout URLs accepted by the shared Pocket ID client used by every deployed app.
     *
     * @return list<string>
     */
    public static function appsOidcLogoutUrls(?InstanceSettings $settings = null): array
    {
        $urls = self::publicUrls($settings);
        if ($urls === null) {
            return [];
        }

        $scheme = $urls['scheme'];
        $host = $urls['host'];
        $logout = [
            $urls['oauth2_proxy'],
            "{$scheme}://{$host}",
            "{$scheme}://*.{$host}",
        ];

        $labels = explode('.', $host);
        if (count($labels) >= 3) {
            $parent = implode('.', array_slice($labels, 1));
            $logout[] = "{$scheme}://{$parent}";
            $logout[] = "{$scheme}://*.{$parent}";
        }

        return array_values(array_unique($logout));
    }

    /**
     * Standard OIDC variables injected into every deployed app so it can talk to Pocket ID.
     *
     * @return array<string, string>
     */
    public static function oidcEnvironmentForApps(?InstanceSettings $settings = null): array
    {
        $settings ??= instanceSettings();
        $urls = self::publicUrls($settings);
        $clientId = (string) $settings->sso_apps_client_id;
        $clientSecret = (string) $settings->sso_apps_client_secret;

        if ($urls === null || $clientId === '' || $clientSecret === '') {
            return [];
        }

        $issuer = $urls['pocket_id'];

        return [
            'OIDC_ISSUER' => $issuer,
            'OIDC_ISSUER_URL' => $issuer,
            'OIDC_DISCOVERY_URL' => $issuer.'/.well-known/openid-configuration',
            'OIDC_CLIENT_ID' => $clientId,
            'OIDC_CLIENT_SECRET' => $clientSecret,
            'OIDC_SCOPES' => 'openid email profile',
            'POCKET_ID_URL' => $issuer,
            'AUTH_POCKET_ID_ID' => $clientId,
            'AUTH_POCKET_ID_SECRET' => $clientSecret,
            'AUTH_POCKET_ID_ISSUER' => $issuer,
        ];
    }

    /**
     * @param  Collection<string|int, mixed>  $envs
     * @param  Collection<int, mixed>|null  $userVariables
     * @return Collection<string|int, mixed>
     */
    public static function mergeOidcEnvironment(Collection $envs, ?Collection $userVariables = null, ?InstanceSettings $settings = null): Collection
    {
        foreach (self::oidcEnvironmentForApps($settings) as $key => $value) {
            if ($envs->has($key)) {
                continue;
            }
            if ($userVariables?->contains(fn (mixed $item): bool => is_object($item) && (string) data_get($item, 'key') === $key)) {
                continue;
            }
            $envs->put($key, $value);
        }

        return $envs;
    }

    /**
     * @return list<string>
     */
    public static function traefikMiddlewareLabels(): array
    {
        return ['coolify.traefik.middlewares='.self::MIDDLEWARE_NAME];
    }

    public static function forwardAuthAddressForServer(Server $server, ?InstanceSettings $settings = null): string
    {
        $settings ??= instanceSettings();

        if ($server->isLocalhost()) {
            return $settings->sso_forward_auth_address ?: self::DEFAULT_FORWARD_AUTH_ADDRESS;
        }

        $public = rtrim((string) $settings->sso_oauth2_proxy_url, '/');
        if ($public !== '') {
            return $public.'/';
        }

        return $settings->sso_forward_auth_address ?: self::DEFAULT_FORWARD_AUTH_ADDRESS;
    }

    /**
     * @return array<string, mixed>
     */
    public static function traefikForwardAuthMiddleware(?InstanceSettings $settings = null, ?Server $server = null): array
    {
        $settings ??= instanceSettings();
        $address = $server
            ? self::forwardAuthAddressForServer($server, $settings)
            : ($settings->sso_forward_auth_address ?: self::DEFAULT_FORWARD_AUTH_ADDRESS);

        return [
            'forwardAuth' => [
                'address' => $address,
                'trustForwardHeader' => true,
                'authResponseHeaders' => [
                    'X-Auth-Request-User',
                    'X-Auth-Request-Email',
                    'X-Auth-Request-Preferred-Username',
                    'Authorization',
                ],
            ],
        ];
    }

    /**
     * Dedicated Traefik dynamic file payload (no Coolify UI routers).
     *
     * @return array<string, mixed>
     */
    public static function traefikDynamicConfiguration(?InstanceSettings $settings = null, ?Server $server = null): array
    {
        $settings ??= instanceSettings();
        $conf = [
            'http' => [
                'middlewares' => [
                    self::MIDDLEWARE_NAME => self::traefikForwardAuthMiddleware($settings, $server),
                ],
            ],
        ];

        if (! $server?->isLocalhost()) {
            return $conf;
        }

        $urls = self::publicUrls($settings);
        if ($urls === null) {
            return $conf;
        }

        $pocketHost = parse_url($urls['pocket_id'], PHP_URL_HOST);
        $ssoHost = parse_url($urls['oauth2_proxy'], PHP_URL_HOST);
        $https = $urls['scheme'] === 'https';

        // HTTP routers stay live (no HTTPS redirect): Cloudflare Flexible SSL
        // fetches origin :80, and a redirect-to-https loop would 404 the public hostname.
        $pocketHttpRouter = [
            'entryPoints' => ['http'],
            'service' => 'devforge-sso-pocket-id',
            'rule' => "Host(`{$pocketHost}`)",
        ];
        $ssoHttpRouter = [
            'entryPoints' => ['http'],
            'service' => 'devforge-sso-proxy',
            'rule' => "Host(`{$ssoHost}`)",
        ];
        $pocketRouter = [
            'entryPoints' => [$https ? 'https' : 'http'],
            'service' => 'devforge-sso-pocket-id',
            'rule' => "Host(`{$pocketHost}`)",
        ];
        $ssoRouter = [
            'entryPoints' => [$https ? 'https' : 'http'],
            'service' => 'devforge-sso-proxy',
            'rule' => "Host(`{$ssoHost}`)",
        ];

        if ($https) {
            $tls = ['certresolver' => 'letsencrypt'];
            $pocketRouter['tls'] = $tls;
            $ssoRouter['tls'] = $tls;
        }

        $conf['http']['routers'] = $https
            ? [
                'devforge-sso-pocket-id-http' => $pocketHttpRouter,
                'devforge-sso-pocket-id' => $pocketRouter,
                'devforge-sso-proxy-http' => $ssoHttpRouter,
                'devforge-sso-proxy' => $ssoRouter,
            ]
            : [
                'devforge-sso-pocket-id' => $pocketRouter,
                'devforge-sso-proxy' => $ssoRouter,
            ];
        $conf['http']['services'] = [
            'devforge-sso-pocket-id' => [
                'loadBalancer' => [
                    'servers' => [
                        ['url' => self::INTERNAL_POCKET_ID_URL],
                    ],
                ],
            ],
            'devforge-sso-proxy' => [
                'loadBalancer' => [
                    'servers' => [
                        ['url' => rtrim(self::DEFAULT_FORWARD_AUTH_ADDRESS, '/')],
                    ],
                ],
            ],
        ];

        return $conf;
    }
}
