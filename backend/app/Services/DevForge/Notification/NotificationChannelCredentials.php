<?php

namespace App\Services\DevForge\Notification;

use App\Rules\SafeWebhookUrl;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Validation\ValidationException;

class NotificationChannelCredentials
{
    /**
     * Plain credential fields returned decrypted for authorized viewers.
     *
     * @var array<string, list<string>>
     */
    public const PLAIN_FIELDS = [
        'email' => [
            'use_instance_email_settings',
            'smtp_enabled',
            'smtp_from_address',
            'smtp_from_name',
            'smtp_recipients',
            'smtp_host',
            'smtp_port',
            'smtp_encryption',
            'smtp_username',
            'smtp_timeout',
            'resend_enabled',
        ],
        'discord' => [
            'discord_ping_enabled',
        ],
        'slack' => [],
        'telegram' => [
            'telegram_notifications_deployment_success_thread_id',
            'telegram_notifications_deployment_failure_thread_id',
            'telegram_notifications_status_change_thread_id',
            'telegram_notifications_backup_success_thread_id',
            'telegram_notifications_backup_failure_thread_id',
            'telegram_notifications_scheduled_task_success_thread_id',
            'telegram_notifications_scheduled_task_failure_thread_id',
            'telegram_notifications_docker_cleanup_success_thread_id',
            'telegram_notifications_docker_cleanup_failure_thread_id',
            'telegram_notifications_server_disk_usage_thread_id',
            'telegram_notifications_server_reachable_thread_id',
            'telegram_notifications_server_unreachable_thread_id',
            'telegram_notifications_server_patch_thread_id',
            'telegram_notifications_traefik_outdated_thread_id',
        ],
        'pushover' => [],
        'webhook' => [],
    ];

    /**
     * Secret fields never returned in plaintext — only `{field}_set`.
     *
     * @var array<string, list<string>>
     */
    public const SECRET_FIELDS = [
        'email' => [
            'smtp_password',
            'resend_api_key',
        ],
        'discord' => [
            'discord_webhook_url',
        ],
        'slack' => [
            'slack_webhook_url',
        ],
        'telegram' => [
            'telegram_token',
            'telegram_chat_id',
        ],
        'pushover' => [
            'pushover_user_key',
            'pushover_api_token',
        ],
        'webhook' => [
            'webhook_url',
        ],
    ];

    /**
     * Secret fields that must pass SafeWebhookUrl when provided.
     *
     * @var array<string, list<string>>
     */
    public const WEBHOOK_FIELDS = [
        'discord' => ['discord_webhook_url'],
        'slack' => ['slack_webhook_url'],
        'webhook' => ['webhook_url'],
    ];

    /**
     * @return array<string, mixed>
     */
    public function present(Model $settings, string $channel): array
    {
        $credentials = [];

        foreach (self::PLAIN_FIELDS[$channel] ?? [] as $field) {
            $value = $settings->{$field};
            $credentials[$field] = $value;
        }

        foreach (self::SECRET_FIELDS[$channel] ?? [] as $field) {
            $credentials[$field.'_set'] = filled($settings->{$field});
        }

        return $credentials;
    }

    /**
     * @param  array<string, mixed>  $credentials
     * @return array<string, mixed>
     */
    public function resolveUpdates(Model $settings, string $channel, array $credentials): array
    {
        $allowedPlain = self::PLAIN_FIELDS[$channel] ?? [];
        $allowedSecret = self::SECRET_FIELDS[$channel] ?? [];
        $allowed = array_merge($allowedPlain, $allowedSecret);
        $unknown = array_diff(array_keys($credentials), $allowed);

        if ($unknown !== []) {
            throw ValidationException::withMessages([
                'credentials' => ['Unknown credential keys: '.implode(', ', $unknown)],
            ]);
        }

        $updates = [];

        foreach ($allowedPlain as $field) {
            if (! array_key_exists($field, $credentials)) {
                continue;
            }

            $updates[$field] = $this->normalizePlainValue($field, $credentials[$field]);
        }

        foreach ($allowedSecret as $field) {
            if (! array_key_exists($field, $credentials)) {
                continue;
            }

            $value = $credentials[$field];

            if (! is_string($value) || trim($value) === '' || $value === '********') {
                continue;
            }

            if (in_array($field, self::WEBHOOK_FIELDS[$channel] ?? [], true)) {
                $this->assertSafeWebhookUrl($field, $value);
            }

            $updates[$field] = $value;
        }

        return $updates;
    }

    private function normalizePlainValue(string $field, mixed $value): mixed
    {
        if (str_ends_with($field, '_enabled') || str_starts_with($field, 'use_')) {
            return (bool) $value;
        }

        if (str_ends_with($field, '_port') || str_ends_with($field, '_timeout')) {
            if ($value === null || $value === '') {
                return null;
            }

            return (int) $value;
        }

        if ($value === null) {
            return null;
        }

        return is_string($value) ? $value : (string) $value;
    }

    private function assertSafeWebhookUrl(string $field, string $value): void
    {
        $failed = null;
        (new SafeWebhookUrl)->validate($field, $value, function (string $message) use (&$failed): void {
            $failed = $message;
        });

        if ($failed !== null) {
            throw ValidationException::withMessages([
                "credentials.{$field}" => [str_replace(':attribute', $field, $failed)],
            ]);
        }
    }
}
