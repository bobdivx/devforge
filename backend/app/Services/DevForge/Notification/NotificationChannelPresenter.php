<?php

namespace App\Services\DevForge\Notification;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Gate;

class NotificationChannelPresenter
{
    /**
     * @return array<string, mixed>
     */
    public function present(Model $settings, string $channel): array
    {
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
    }
}
