<?php

namespace App\Services\DevForge;

use App\Models\Team;
use App\Services\DevForge\Notification\NotificationChannelPresenter;
use App\Services\DevForge\Notification\NotificationChannelRegistry;
use Illuminate\Database\Eloquent\Model;

class NotificationData
{
    public function __construct(
        private NotificationChannelPresenter $presenter,
        private NotificationChannelRegistry $registry,
    ) {}

    /**
     * @return array<int, array<string, mixed>>
     */
    public function forTeam(Team $team): array
    {
        return collect(NotificationChannelRegistry::CHANNEL_RELATIONS)
            ->map(function (string $relation, string $channel) use ($team): ?array {
                /** @var Model|null $settings */
                $settings = $team->{$relation};

                if (! $settings) {
                    return null;
                }

                return $this->presenter->present($settings, $channel);
            })
            ->filter()
            ->values()
            ->all();
    }
}
