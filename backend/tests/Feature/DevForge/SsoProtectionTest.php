<?php

use App\Models\Application;
use App\Models\InstanceSettings;
use App\Models\OauthSetting;
use App\Models\ServiceApplication;
use App\Services\DevForge\Sso\SsoProtection;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Once;

uses(RefreshDatabase::class);

beforeEach(function () {
    InstanceSettings::unguarded(fn (): InstanceSettings => InstanceSettings::query()->create([
        'id' => 0,
        'instance_name' => 'DevForge',
        'instance_timezone' => 'UTC',
        'public_port_min' => 1025,
        'public_port_max' => 65535,
        'is_registration_enabled' => false,
        'disable_two_step_confirmation' => false,
        'is_auto_update_enabled' => false,
        'auto_update_frequency' => '0 0 * * *',
        'update_check_frequency' => '0 * * * *',
        'sso_protect_apps_by_default' => true,
        'sso_hide_local_login' => false,
    ]));
    Once::flush();
});

it('does not protect an application when the forward-auth address is empty', function () {
    $application = new Application(['is_sso_protected' => null]);

    expect(SsoProtection::shouldProtectApplication($application))->toBeFalse();
});

it('protects an application when the address is set and the flag is inherited', function () {
    InstanceSettings::get()->update([
        'sso_forward_auth_address' => SsoProtection::DEFAULT_FORWARD_AUTH_ADDRESS,
        'sso_protect_apps_by_default' => true,
    ]);
    Once::flush();

    $application = new Application(['is_sso_protected' => null]);

    expect(SsoProtection::shouldProtectApplication($application))->toBeTrue();
});

it('does not protect an application that opted out', function () {
    InstanceSettings::get()->update([
        'sso_forward_auth_address' => SsoProtection::DEFAULT_FORWARD_AUTH_ADDRESS,
        'sso_protect_apps_by_default' => true,
    ]);
    Once::flush();

    $application = new Application(['is_sso_protected' => false]);

    expect(SsoProtection::shouldProtectApplication($application))->toBeFalse();
});

it('hides local login only when pocket id oauth is enabled', function () {
    InstanceSettings::get()->update([
        'sso_hide_local_login' => true,
    ]);
    Once::flush();

    expect(SsoProtection::hideLocalLogin())->toBeFalse();

    OauthSetting::create([
        'provider' => 'pocketid',
        'enabled' => true,
        'client_id' => 'id',
        'client_secret' => 'secret',
        'base_url' => 'https://id.example.com',
    ]);
    Once::flush();

    expect(SsoProtection::hideLocalLogin())->toBeTrue()
        ->and(SsoProtection::pocketIdLoginEnabled())->toBeTrue();
});

it('excludes pocket id and oauth2-proxy service applications', function () {
    InstanceSettings::get()->update([
        'sso_forward_auth_address' => SsoProtection::DEFAULT_FORWARD_AUTH_ADDRESS,
        'sso_protect_apps_by_default' => true,
    ]);
    Once::flush();

    $pocket = new ServiceApplication(['name' => 'pocket-id', 'image' => 'ghcr.io/pocket-id/pocket-id:v2']);
    $proxy = new ServiceApplication(['name' => 'oauth2-proxy', 'image' => 'quay.io/oauth2-proxy/oauth2-proxy:v7.8.2']);
    $app = new ServiceApplication(['name' => 'web', 'image' => 'nginx:latest']);

    expect(SsoProtection::shouldProtectServiceApplication($pocket))->toBeFalse()
        ->and(SsoProtection::shouldProtectServiceApplication($proxy))->toBeFalse()
        ->and(SsoProtection::shouldProtectServiceApplication($app))->toBeTrue();
});
