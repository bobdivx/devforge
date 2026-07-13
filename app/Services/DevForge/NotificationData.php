<?php

namespace App\Services\DevForge;

use App\Models\Team;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Gate;

class NotificationData
{
    /**
     * @return array<int, array<string, mixed>>
     */
    public function forTeam(Team $team): array
    {
        $channels = [
            'email' => $team->emailNotificationSettings,
            'discord' => $team->discordNotificationSettings,
            'slack' => $team->slackNotificationSettings,
            'telegram' => $team->telegramNotificationSettings,
            'pushover' => $team->pushoverNotificationSettings,
            'webhook' => $team->webhookNotificationSettings,
        ];

        return collect($channels)
            ->filter()
            ->map(function (Model $settings, string $channel): array {
                Gate::authorize('view', $settings);

                return [
                    'channel' => $channel,
                    'enabled' => (bool) $settings->isEnabled(),
                    'events' => collect($settings->getAttributes())
                        ->filter(
                            fn (mixed $value, string $key): bool => str_ends_with($key, '_notifications')
                        )
                        ->map(fn (mixed $value): bool => (bool) $value)
                        ->all(),
                ];
            })
            ->values()
            ->all();
    }
}
