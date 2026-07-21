<?php

namespace App\Services\DevForge\Notification;

use App\Models\Team;
use Illuminate\Support\Facades\Gate;

class NotificationChannelUpdater
{
    public function __construct(
        private NotificationChannelRegistry $registry,
        private NotificationChannelPresenter $presenter,
        private NotificationChannelCredentials $credentials,
    ) {}

    /**
     * @param  array{events?: array<string, bool>, enabled?: bool, credentials?: array<string, mixed>}  $payload
     * @return array<string, mixed>
     */
    public function update(Team $team, string $channel, array $payload): array
    {
        $settings = $this->registry->settingsForTeam($team, $channel);
        Gate::authorize('update', $settings);

        $updates = [];

        if (array_key_exists('events', $payload)) {
            $events = $payload['events'];
            $this->registry->assertValidEvents($settings, $events);

            foreach ($events as $key => $value) {
                $updates[$key] = (bool) $value;
            }
        }

        if (array_key_exists('enabled', $payload)) {
            $enabledField = NotificationChannelRegistry::ENABLED_FIELDS[$channel] ?? null;

            if ($enabledField !== null) {
                $updates[$enabledField] = (bool) $payload['enabled'];
            }
        }

        if (array_key_exists('credentials', $payload)) {
            $updates = [
                ...$updates,
                ...$this->credentials->resolveUpdates($settings, $channel, $payload['credentials']),
            ];
        }

        if ($updates === []) {
            return $this->presenter->present($settings, $channel);
        }

        $settings->update($updates);

        if (function_exists('refreshSession')) {
            refreshSession();
        }

        return $this->presenter->present($settings->refresh(), $channel);
    }
}
