<?php

namespace App\Services\DevForge\Notification;

use App\Models\Team;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Validation\ValidationException;

class NotificationChannelRegistry
{
    /**
     * @var array<string, string>
     */
    public const CHANNEL_RELATIONS = [
        'email' => 'emailNotificationSettings',
        'discord' => 'discordNotificationSettings',
        'slack' => 'slackNotificationSettings',
        'telegram' => 'telegramNotificationSettings',
        'pushover' => 'pushoverNotificationSettings',
        'webhook' => 'webhookNotificationSettings',
    ];

    /**
     * @var array<string, string>
     */
    public const ENABLED_FIELDS = [
        'discord' => 'discord_enabled',
        'slack' => 'slack_enabled',
        'telegram' => 'telegram_enabled',
        'pushover' => 'pushover_enabled',
        'webhook' => 'webhook_enabled',
    ];

    public function settingsForTeam(Team $team, string $channel): Model
    {
        $relation = self::CHANNEL_RELATIONS[$channel] ?? null;

        abort_unless(is_string($relation), 404, 'Unknown notification channel.');

        return $team->{$relation};
    }

    /**
     * @return array<int, string>
     */
    public function eventKeysFor(Model $settings): array
    {
        return collect($settings->getAttributes())
            ->keys()
            ->filter(fn (string $key): bool => str_ends_with($key, '_notifications'))
            ->values()
            ->all();
    }

    /**
     * @param  array<string, bool>  $events
     */
    public function assertValidEvents(Model $settings, array $events): void
    {
        $allowed = $this->eventKeysFor($settings);
        $unknown = array_diff(array_keys($events), $allowed);

        if ($unknown !== []) {
            throw ValidationException::withMessages([
                'events' => ['Unknown notification event keys: '.implode(', ', $unknown)],
            ]);
        }
    }
}
