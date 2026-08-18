<?php

use App\Models\InstanceSettings;
use App\Models\OauthSetting;
use App\Models\Server;
use App\Services\DevForge\Sso\SsoComposeGenerator;
use App\Services\DevForge\Sso\SsoProtection;

it('builds public pocket id urls from the apps wildcard domain', function () {
    $settings = new InstanceSettings([
        'apps_wildcard_domain' => 'https://apps.exemple.com',
    ]);

    expect(SsoProtection::publicUrls($settings))->toMatchArray([
        'scheme' => 'https',
        'host' => 'apps.exemple.com',
        'pocket_id' => 'https://id.apps.exemple.com',
        'oauth2_proxy' => 'https://sso.apps.exemple.com',
        'cookie_domain' => '.apps.exemple.com',
    ]);
});

it('builds wildcard oidc callbacks so every deployed app can use pocket id', function () {
    $settings = new InstanceSettings([
        'apps_wildcard_domain' => 'https://apps.exemple.com',
    ]);

    expect(SsoProtection::appsOidcCallbackUrls($settings))->toContain(
        'https://sso.apps.exemple.com/oauth2/callback',
        'https://*.apps.exemple.com/**',
        'https://*.exemple.com/**',
    );
});

it('injects standard oidc variables for deployed apps', function () {
    $settings = new InstanceSettings([
        'apps_wildcard_domain' => 'https://apps.exemple.com',
        'sso_apps_client_id' => 'apps-id',
        'sso_apps_client_secret' => 'apps-secret',
    ]);

    $envs = SsoProtection::mergeOidcEnvironment(collect(['EXISTING' => 'keep']), settings: $settings);

    expect($envs->get('EXISTING'))->toBe('keep')
        ->and($envs->get('OIDC_ISSUER'))->toBe('https://id.apps.exemple.com')
        ->and($envs->get('OIDC_CLIENT_ID'))->toBe('apps-id')
        ->and($envs->get('OIDC_CLIENT_SECRET'))->toBe('apps-secret')
        ->and($envs->get('OIDC_DISCOVERY_URL'))->toBe('https://id.apps.exemple.com/.well-known/openid-configuration')
        ->and($envs->get('AUTH_POCKET_ID_ISSUER'))->toBe('https://id.apps.exemple.com');
});

it('does not overwrite an app-defined oidc client id', function () {
    $settings = new InstanceSettings([
        'apps_wildcard_domain' => 'https://apps.exemple.com',
        'sso_apps_client_id' => 'apps-id',
        'sso_apps_client_secret' => 'apps-secret',
    ]);

    $envs = SsoProtection::mergeOidcEnvironment(collect([
        'OIDC_CLIENT_ID' => 'custom-app-client',
    ]), settings: $settings);

    expect($envs->get('OIDC_CLIENT_ID'))->toBe('custom-app-client')
        ->and($envs->get('OIDC_ISSUER'))->toBe('https://id.apps.exemple.com');
});

it('treats apps oidc as configured only when client id and secret are filled', function () {
    expect(SsoProtection::isAppsOidcConfigured(new InstanceSettings([
        'sso_apps_client_id' => 'apps-id',
        'sso_apps_client_secret' => null,
    ])))->toBeFalse();

    expect(SsoProtection::isAppsOidcConfigured(new InstanceSettings([
        'sso_apps_client_id' => 'apps-id',
        'sso_apps_client_secret' => 'apps-secret',
    ])))->toBeTrue();
});

it('does not treat apps protection as configured when the address is empty', function () {
    $settings = new InstanceSettings([
        'sso_forward_auth_address' => null,
        'sso_protect_apps_by_default' => true,
    ]);

    expect(SsoProtection::isAppsProtectionConfigured($settings))->toBeFalse()
        ->and(SsoProtection::shouldProtectApplicationsByDefault($settings))->toBeFalse();
});

it('enables default app protection only when the address is filled', function () {
    $settings = new InstanceSettings([
        'sso_forward_auth_address' => SsoProtection::DEFAULT_FORWARD_AUTH_ADDRESS,
        'sso_protect_apps_by_default' => true,
    ]);

    expect(SsoProtection::isAppsProtectionConfigured($settings))->toBeTrue()
        ->and(SsoProtection::shouldProtectApplicationsByDefault($settings))->toBeTrue();

    $settings->sso_protect_apps_by_default = false;
    expect(SsoProtection::shouldProtectApplicationsByDefault($settings))->toBeFalse();
});

it('builds the traefik forwardauth middleware from the stored address', function () {
    $settings = new InstanceSettings([
        'sso_forward_auth_address' => 'http://custom-proxy:4180/',
    ]);

    $middleware = SsoProtection::traefikForwardAuthMiddleware($settings);

    expect($middleware['forwardAuth']['address'])->toBe('http://custom-proxy:4180/')
        ->and($middleware['forwardAuth']['trustForwardHeader'])->toBeTrue()
        ->and($middleware['forwardAuth']['authResponseHeaders'])->toContain('X-Auth-Request-Email');
});

it('builds a dedicated traefik file with only the sso middleware', function () {
    $settings = new InstanceSettings([
        'sso_forward_auth_address' => 'http://devforge-sso-proxy:4180/',
    ]);

    $conf = SsoProtection::traefikDynamicConfiguration($settings);

    expect($conf['http']['middlewares'])->toHaveKey(SsoProtection::MIDDLEWARE_NAME)
        ->and($conf['http'])->not->toHaveKey('routers')
        ->and($conf['http'])->not->toHaveKey('services')
        ->and($conf['http']['middlewares'][SsoProtection::MIDDLEWARE_NAME]['forwardAuth']['address'])
        ->toBe('http://devforge-sso-proxy:4180/');
});

it('adds http and https routers for the localhost sso stack', function () {
    $server = Mockery::mock(Server::class);
    $server->shouldReceive('isLocalhost')->andReturn(true);

    $settings = new InstanceSettings([
        'apps_wildcard_domain' => 'https://apps.exemple.com',
        'sso_forward_auth_address' => 'http://devforge-sso-proxy:4180/',
    ]);

    $conf = SsoProtection::traefikDynamicConfiguration($settings, $server);

    expect($conf['http']['routers'])->toHaveKeys([
        'devforge-sso-pocket-id-http',
        'devforge-sso-pocket-id',
        'devforge-sso-proxy-http',
        'devforge-sso-proxy',
    ])
        ->and($conf['http']['routers']['devforge-sso-pocket-id-http']['entryPoints'])->toBe(['http'])
        ->and($conf['http']['routers']['devforge-sso-pocket-id-http'])->not->toHaveKey('middlewares')
        ->and($conf['http']['routers']['devforge-sso-pocket-id']['entryPoints'])->toBe(['https'])
        ->and($conf['http']['routers']['devforge-sso-pocket-id']['rule'])->toBe('Host(`id.apps.exemple.com`)')
        ->and($conf['http']['services']['devforge-sso-pocket-id']['loadBalancer']['servers'][0]['url'])
        ->toBe('http://devforge-sso-pocket-id:1411');
});

it('persists the encryption key without a trailing newline', function () {
    $commands = SsoProtection::persistEncryptionKeyCommands('abc+/=');

    expect($commands[0])->toContain('/sso/data')
        ->and($commands[2])->toContain('chown -R 1000:1000')
        ->and($commands[3])->toContain("echo '".base64_encode('abc+/=')."' | base64 -d")
        ->and($commands[3])->toContain('/sso/encryption.key');
});

it('requires client id secret and base url before pocketid can be enabled', function () {
    $oauth = new OauthSetting([
        'provider' => 'pocketid',
        'client_id' => 'id',
        'client_secret' => 'secret',
        'base_url' => null,
    ]);

    expect($oauth->couldBeEnabled())->toBeFalse();

    $oauth->base_url = 'https://id.example.com';
    expect($oauth->couldBeEnabled())->toBeTrue();
});

it('builds compose for the managed pocket id stack', function () {
    $dockers = Mockery::mock();
    $dockers->shouldReceive('value')->once()->with('network')->andReturn('devforge');
    $server = Mockery::mock(Server::class);
    $server->shouldReceive('standaloneDockers')->once()->andReturn($dockers);

    $settings = new InstanceSettings([
        'apps_wildcard_domain' => 'https://apps.exemple.com',
        'sso_encryption_key' => 'enc-key',
        'sso_static_api_key' => 'static-key',
        'sso_oauth2_cookie_secret' => 'cookie-secret',
        'sso_apps_client_id' => 'apps-id',
        'sso_apps_client_secret' => 'apps-secret',
    ]);

    $compose = (new SsoComposeGenerator)->generate($server, $settings);

    expect($compose['name'])->toBe('devforge-sso')
        ->and($compose['services']['pocket-id']['environment']['APP_URL'])->toBe('https://id.apps.exemple.com')
        ->and($compose['services']['pocket-id']['environment']['STATIC_API_KEY'])->toBe('static-key')
        ->and($compose['services']['oauth2-proxy']['image'])->toBe('quay.io/oauth2-proxy/oauth2-proxy:v7.8.2-alpine')
        ->and($compose['services']['oauth2-proxy']['environment']['OAUTH2_PROXY_CLIENT_ID'])->toBe('apps-id')
        ->and($compose['services']['oauth2-proxy']['environment']['OAUTH2_PROXY_OIDC_ISSUER_URL'])->toBe('http://devforge-sso-pocket-id:1411')
        ->and($compose['services']['pocket-id']['environment']['PUID'])->toBe('1000')
        ->and($compose['services']['pocket-id']['environment']['PGID'])->toBe('1000')
        ->and($compose['services']['pocket-id']['labels'])->toContain('traefik.enable=true')
        ->and($compose['services']['pocket-id']['labels'])->toContain('traefik.http.routers.devforge-sso-pocket-id.rule=Host(`id.apps.exemple.com`)')
        ->and($compose['networks'])->toHaveKey('devforge');
});
