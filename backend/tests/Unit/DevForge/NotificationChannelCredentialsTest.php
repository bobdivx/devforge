<?php

use App\Services\DevForge\Notification\NotificationChannelCredentials;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Validation\ValidationException;

it('presents plain credentials and secret set flags without leaking secrets', function () {
    $settings = new class extends Model
    {
        protected $guarded = [];

        public $discord_ping_enabled = true;

        public $discord_webhook_url = 'https://example.test/private-hook';
    };

    $credentials = (new NotificationChannelCredentials)->present($settings, 'discord');

    expect($credentials)
        ->toMatchArray([
            'discord_ping_enabled' => true,
            'discord_webhook_url_set' => true,
        ])
        ->not->toHaveKey('discord_webhook_url');
});

it('applies plain credential updates and skips blank secrets', function () {
    $settings = new class extends Model
    {
        protected $guarded = [];

        public $discord_ping_enabled = true;

        public $discord_webhook_url = 'https://example.test/old';
    };

    $service = new NotificationChannelCredentials;

    $updates = $service->resolveUpdates($settings, 'discord', [
        'discord_ping_enabled' => false,
        'discord_webhook_url' => '',
    ]);

    expect($updates)->toBe([
        'discord_ping_enabled' => false,
    ]);
});

it('updates webhook secrets when a safe url is provided', function () {
    $settings = new class extends Model
    {
        protected $guarded = [];

        public $discord_ping_enabled = true;

        public $discord_webhook_url = null;
    };

    $updates = (new NotificationChannelCredentials)->resolveUpdates($settings, 'discord', [
        'discord_webhook_url' => 'https://discord.com/api/webhooks/123/abc',
    ]);

    expect($updates)->toBe([
        'discord_webhook_url' => 'https://discord.com/api/webhooks/123/abc',
    ]);
});

it('rejects unknown credential keys and unsafe webhook urls', function () {
    $settings = new class extends Model
    {
        protected $guarded = [];
    };

    $service = new NotificationChannelCredentials;

    expect(fn () => $service->resolveUpdates($settings, 'discord', [
        'not_a_field' => true,
    ]))->toThrow(ValidationException::class);

    expect(fn () => $service->resolveUpdates($settings, 'discord', [
        'discord_webhook_url' => 'http://127.0.0.1/hook',
    ]))->toThrow(ValidationException::class);
});
