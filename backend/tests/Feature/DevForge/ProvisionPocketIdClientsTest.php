<?php

use App\Models\InstanceSettings;
use App\Models\OauthSetting;
use App\Services\DevForge\Sso\ProvisionPocketIdClients;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Once;

uses(RefreshDatabase::class);

beforeEach(function () {
    InstanceSettings::unguarded(fn (): InstanceSettings => InstanceSettings::query()->create([
        'id' => 0,
        'fqdn' => 'https://forge.exemple.com',
        'apps_wildcard_domain' => 'https://apps.exemple.com',
        'instance_name' => 'DevForge',
        'instance_timezone' => 'UTC',
        'public_port_min' => 1025,
        'public_port_max' => 65535,
        'is_registration_enabled' => false,
        'disable_two_step_confirmation' => false,
        'is_auto_update_enabled' => false,
        'auto_update_frequency' => '0 0 * * *',
        'update_check_frequency' => '0 * * * *',
        'sso_static_api_key' => 'static-api-key',
        'sso_protect_apps_by_default' => true,
        'sso_hide_local_login' => false,
    ]));
    OauthSetting::create([
        'provider' => 'pocketid',
        'enabled' => false,
    ]);
    Once::flush();
});

it('creates pocket id oidc clients and enables the devforge login provider', function () {
    $created = [];

    Http::fake(function (Request $request) use (&$created) {
        $path = (string) parse_url($request->url(), PHP_URL_PATH);

        if ($request->method() === 'GET' && str_ends_with($path, '/api/oidc/clients')) {
            $clients = [];
            foreach ($created as $name => $id) {
                $clients[] = ['id' => $id, 'name' => $name];
            }

            return Http::response(['data' => $clients], 200);
        }

        if ($request->method() === 'POST' && str_ends_with($path, '/api/oidc/clients')) {
            $name = (string) $request['name'];
            $id = $name === ProvisionPocketIdClients::DEVFORGE_CLIENT_NAME ? 'devforge-client' : 'apps-client';
            $created[$name] = $id;

            return Http::response(['id' => $id], 201);
        }

        if ($request->method() === 'POST' && str_ends_with($path, '/secret')) {
            $secret = str_contains($path, 'devforge-client') ? 'dev-secret' : 'apps-secret';

            return Http::response(['secret' => $secret], 200);
        }

        if ($request->method() === 'PUT' && str_contains($path, '/api/oidc/clients/')) {
            return Http::response([], 200);
        }

        if ($request->method() === 'POST' && str_ends_with($path, '/api/users')) {
            return Http::response([], 201);
        }

        return Http::response(['error' => $path], 404);
    });

    $settings = app(ProvisionPocketIdClients::class)->handle(InstanceSettings::get());

    expect($settings->sso_pocket_id_url)->toBe('https://id.apps.exemple.com')
        ->and($settings->sso_oauth2_proxy_url)->toBe('https://sso.apps.exemple.com')
        ->and($settings->sso_forward_auth_address)->toBe('http://devforge-sso-proxy:4180/')
        ->and($settings->sso_apps_client_id)->toBe('apps-client');

    $oauth = OauthSetting::query()->firstWhere('provider', 'pocketid');
    expect($oauth->enabled)->toBeTrue()
        ->and($oauth->client_id)->toBe('devforge-client')
        ->and($oauth->client_secret)->toBe('dev-secret')
        ->and($oauth->base_url)->toBe('https://id.apps.exemple.com');

    Http::assertSent(function (Request $request): bool {
        if ($request->method() !== 'POST' || ! str_ends_with((string) parse_url($request->url(), PHP_URL_PATH), '/api/oidc/clients')) {
            return false;
        }

        return $request['name'] === ProvisionPocketIdClients::APPS_CLIENT_NAME
            && in_array('https://*.apps.exemple.com/**', $request['callbackURLs'], true)
            && in_array('https://sso.apps.exemple.com/oauth2/callback', $request['callbackURLs'], true);
    });

    Http::assertSent(function (Request $request): bool {
        $path = (string) parse_url($request->url(), PHP_URL_PATH);

        return $request->method() === 'POST'
            && str_ends_with($path, '/secret')
            && $request->body() === '{}';
    });
});
