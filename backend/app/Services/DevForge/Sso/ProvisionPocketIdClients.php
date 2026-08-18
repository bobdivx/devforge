<?php

namespace App\Services\DevForge\Sso;

use App\Models\InstanceSettings;
use App\Models\OauthSetting;
use App\Models\User;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class ProvisionPocketIdClients
{
    public const DEVFORGE_CLIENT_NAME = 'DevForge';

    public const APPS_CLIENT_NAME = 'DevForge Apps';

    public const ACCENT_COLOR = '#175b37';

    public function handle(?InstanceSettings $settings = null): InstanceSettings
    {
        $settings ??= instanceSettings();
        $urls = SsoProtection::publicUrls($settings);
        if ($urls === null || ! filled($settings->sso_static_api_key)) {
            return $settings;
        }

        $http = $this->client((string) $settings->sso_static_api_key);

        $devforgeCallback = rtrim((string) $settings->fqdn, '/');
        if ($devforgeCallback === '') {
            $devforgeCallback = $urls['pocket_id'];
        }
        $devforgeRedirect = $devforgeCallback.'/auth/pocketid/callback';

        $existingDevforge = OauthSetting::query()->firstWhere('provider', 'pocketid');
        $devforge = $this->ensureClient(
            $http,
            self::DEVFORGE_CLIENT_NAME,
            [$devforgeRedirect],
            [$devforgeCallback],
            $existingDevforge?->client_id,
            $existingDevforge?->client_secret,
        );
        $apps = $this->ensureClient(
            $http,
            self::APPS_CLIENT_NAME,
            SsoProtection::appsOidcCallbackUrls($settings),
            SsoProtection::appsOidcLogoutUrls($settings),
            $settings->sso_apps_client_id,
            $settings->sso_apps_client_secret,
        );

        if ($devforge !== null) {
            $oauth = OauthSetting::query()->firstWhere('provider', 'pocketid');
            if ($oauth) {
                $oauth->client_id = $devforge['id'];
                $oauth->client_secret = $devforge['secret'];
                $oauth->base_url = $urls['pocket_id'];
                $oauth->redirect_uri = $devforgeRedirect;
                $oauth->enabled = true;
                $oauth->save();
            }
        }

        if ($apps !== null) {
            $settings->sso_apps_client_id = $apps['id'];
            $settings->sso_apps_client_secret = $apps['secret'];
        }

        $settings->sso_pocket_id_url = $urls['pocket_id'];
        $settings->sso_oauth2_proxy_url = $urls['oauth2_proxy'];
        $settings->sso_forward_auth_address = SsoProtection::DEFAULT_FORWARD_AUTH_ADDRESS;
        $settings->save();

        $this->ensureAdminUser($http);
        $this->ensureBranding($http, $settings);

        return $settings->fresh() ?? $settings;
    }

    private function client(string $apiKey): PendingRequest
    {
        return Http::baseUrl(SsoProtection::INTERNAL_POCKET_ID_URL)
            ->timeout(10)
            ->connectTimeout(5)
            ->retry(5, 400)
            ->withHeaders([
                'X-API-Key' => $apiKey,
                'Accept' => 'application/json',
            ]);
    }

    /**
     * @param  list<string>  $callbackUrls
     * @param  list<string>  $logoutUrls
     * @return array{id: string, secret: string}|null
     */
    private function ensureClient(PendingRequest $http, string $name, array $callbackUrls, array $logoutUrls, ?string $knownId = null, ?string $knownSecret = null): ?array
    {
        try {
            $existing = filled($knownId) ? $knownId : $this->findClientId($http, $name);
            if ($existing === null) {
                $created = $http->post('/api/oidc/clients', [
                    'name' => $name,
                    'callbackURLs' => $callbackUrls,
                    'logoutCallbackURLs' => $logoutUrls,
                    'isPublic' => false,
                    'pkceEnabled' => false,
                ]);
                $created->throw();
                $existing = (string) $created->json('id');
            } else {
                $http->put('/api/oidc/clients/'.$existing, [
                    'name' => $name,
                    'callbackURLs' => $callbackUrls,
                    'logoutCallbackURLs' => $logoutUrls,
                    'isPublic' => false,
                    'pkceEnabled' => false,
                ])->throw();
            }

            if (filled($existing) && filled($knownSecret)) {
                return ['id' => (string) $existing, 'secret' => (string) $knownSecret];
            }

            $secretResponse = $http->send('POST', '/api/oidc/clients/'.$existing.'/secret', [
                'headers' => ['Content-Type' => 'application/json'],
                'body' => '{}',
            ]);
            $secretResponse->throw();
            $secret = (string) ($secretResponse->json('secret') ?? $secretResponse->json('clientSecret') ?? '');

            if ($existing === '' || $secret === '') {
                return null;
            }

            return ['id' => $existing, 'secret' => $secret];
        } catch (\Throwable $e) {
            Log::warning('Failed to provision Pocket ID OIDC client.', [
                'client' => $name,
                'error' => $e->getMessage(),
            ]);

            return null;
        }
    }

    private function findClientId(PendingRequest $http, string $name): ?string
    {
        $response = $http->get('/api/oidc/clients', ['pagination' => json_encode(['page' => 1, 'limit' => 100])]);
        if (! $response->successful()) {
            $response = $http->get('/api/oidc/clients');
        }
        $response->throw();

        $clients = $response->json('data') ?? $response->json();
        if (! is_array($clients)) {
            return null;
        }

        foreach ($clients as $client) {
            if (is_array($client) && ($client['name'] ?? null) === $name && filled($client['id'] ?? null)) {
                return (string) $client['id'];
            }
        }

        return null;
    }

    private function ensureAdminUser(PendingRequest $http): void
    {
        $user = User::query()->find(0);
        if (! $user || ! filled($user->email)) {
            return;
        }

        try {
            $http->post('/api/users', [
                'email' => $user->email,
                'firstName' => Str::of((string) $user->name)->before(' ')->value() ?: 'Admin',
                'lastName' => Str::of((string) $user->name)->after(' ')->value() ?: 'DevForge',
                'username' => Str::of((string) $user->email)->before('@')->value(),
                'isAdmin' => true,
            ]);
        } catch (\Throwable $e) {
            Log::debug('Pocket ID admin user already exists or cannot be created.', [
                'error' => $e->getMessage(),
            ]);
        }
    }

    private function ensureBranding(PendingRequest $http, InstanceSettings $settings): void
    {
        try {
            $this->applyApplicationName($http, $settings);
            $this->uploadBrandImages((string) $settings->sso_static_api_key);
        } catch (\Throwable $e) {
            Log::warning('Failed to apply DevForge branding to Pocket ID.', [
                'error' => $e->getMessage(),
            ]);
        }
    }

    private function applyApplicationName(PendingRequest $http, InstanceSettings $settings): void
    {
        $response = $http->get('/api/application-configuration/all');
        $response->throw();

        $items = $response->json();
        if (isset($items['data']) && is_array($items['data'])) {
            $items = $items['data'];
        }
        if (! is_array($items)) {
            return;
        }

        $config = [];
        foreach ($items as $item) {
            if (is_array($item) && filled($item['key'] ?? null)) {
                $config[(string) $item['key']] = (string) ($item['value'] ?? '');
            }
        }
        if ($config === []) {
            return;
        }

        $config['appName'] = $this->pocketIdAppName($settings);
        $config['accentColor'] = self::ACCENT_COLOR;
        unset($config['uiConfigDisabled'], $config['tracingEnabled']);

        $http->put('/api/application-configuration', $config)->throw();
    }

    private function pocketIdAppName(InstanceSettings $settings): string
    {
        $name = Str::of((string) ($settings->instance_name ?: self::DEVFORGE_CLIENT_NAME))
            ->trim()
            ->limit(30, '')
            ->value();

        return $name !== '' ? $name : self::DEVFORGE_CLIENT_NAME;
    }

    private function uploadBrandImages(string $apiKey): void
    {
        $logoPath = public_path('brand/logo.png');
        if (! is_file($logoPath)) {
            return;
        }

        $contents = file_get_contents($logoPath);
        if ($contents === false || $contents === '') {
            return;
        }

        $filename = $this->brandImageFilename($logoPath, $contents);

        foreach (['/api/application-images/logo?light=true', '/api/application-images/logo?light=false', '/api/application-images/email', '/api/application-images/favicon'] as $path) {
            $this->client($apiKey)
                ->attach('file', $contents, $filename)
                ->put($path)
                ->throw();
        }
    }

    private function brandImageFilename(string $path, string $contents): string
    {
        $mime = function_exists('mime_content_type') ? (mime_content_type($path) ?: '') : '';
        if ($mime === '' && str_starts_with($contents, "\xff\xd8\xff")) {
            $mime = 'image/jpeg';
        }

        return match ($mime) {
            'image/jpeg' => 'logo.jpg',
            'image/svg+xml' => 'logo.svg',
            'image/x-icon', 'image/vnd.microsoft.icon' => 'favicon.ico',
            default => 'logo.png',
        };
    }
}
