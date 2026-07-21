<?php

namespace App\Services\DevForge\Server;

use App\Models\Server;
use App\Models\Team;

class ServerSettingsService
{
    public function findForTeam(Team $team, string $serverUuid): Server
    {
        $server = Server::query()
            ->where('team_id', $team->id)
            ->where('uuid', $serverUuid)
            ->with('settings')
            ->first();

        abort_if(is_null($server), 404, 'Server not found.');

        return $server;
    }

    /**
     * @return array<string, mixed>
     */
    public function show(Server $server): array
    {
        $server->loadMissing('settings');

        return $this->present($server);
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public function update(Server $server, array $input): array
    {
        $validated = validator($input, [
            'wildcard_domain' => ['sometimes', 'nullable', 'url', 'max:255'],
            'is_swarm_manager' => ['sometimes', 'boolean'],
            'is_swarm_worker' => ['sometimes', 'boolean'],
            'is_sentinel_enabled' => ['sometimes', 'boolean'],
            'is_metrics_enabled' => ['sometimes', 'boolean'],
            'sentinel_metrics_refresh_rate_seconds' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:86400'],
            'sentinel_metrics_history_days' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:365'],
            'sentinel_push_interval_seconds' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:86400'],
            'sentinel_custom_url' => ['sometimes', 'nullable', 'string', 'max:255'],
        ])->validate();

        $settings = $server->settings;
        abort_unless($settings !== null, 422, 'Server settings are missing.');

        if (array_key_exists('wildcard_domain', $validated)) {
            $wildcard = $validated['wildcard_domain'];
            $settings->wildcard_domain = filled($wildcard) ? rtrim((string) $wildcard, '/') : null;
        }

        if (array_key_exists('is_swarm_manager', $validated)) {
            $settings->is_swarm_manager = (bool) $validated['is_swarm_manager'];
        }

        if (array_key_exists('is_swarm_worker', $validated)) {
            $settings->is_swarm_worker = (bool) $validated['is_swarm_worker'];
        }

        if (array_key_exists('is_sentinel_enabled', $validated)) {
            $settings->is_sentinel_enabled = (bool) $validated['is_sentinel_enabled'];
        }

        if (array_key_exists('is_metrics_enabled', $validated)) {
            $settings->is_metrics_enabled = (bool) $validated['is_metrics_enabled'];
        }

        foreach ([
            'sentinel_metrics_refresh_rate_seconds',
            'sentinel_metrics_history_days',
            'sentinel_push_interval_seconds',
        ] as $intervalField) {
            if (array_key_exists($intervalField, $validated)) {
                $settings->{$intervalField} = $validated[$intervalField];
            }
        }

        if (array_key_exists('sentinel_custom_url', $validated)) {
            $customUrl = $validated['sentinel_custom_url'];
            $settings->sentinel_custom_url = filled($customUrl) ? (string) $customUrl : null;
        }

        $settings->save();
        $server->load('settings');

        return $this->present($server);
    }

    /**
     * @return array<string, mixed>
     */
    private function present(Server $server): array
    {
        $settings = $server->settings;
        $wildcard = $settings?->wildcard_domain;
        $proxy = $server->proxy;
        $lastSaved = data_get($proxy, 'last_saved_settings');
        $lastApplied = data_get($proxy, 'last_applied_settings');

        return [
            'uuid' => $server->uuid,
            'name' => $server->name,
            'wildcard_domain' => filled($wildcard) ? (string) $wildcard : null,
            'swarm' => [
                'is_swarm_manager' => (bool) $settings?->is_swarm_manager,
                'is_swarm_worker' => (bool) $settings?->is_swarm_worker,
                'deprecated' => true,
            ],
            'sentinel' => [
                'is_sentinel_enabled' => (bool) $settings?->is_sentinel_enabled,
                'is_metrics_enabled' => (bool) $settings?->is_metrics_enabled,
                'is_live' => filled($server->sentinel_updated_at) && (bool) $server->isSentinelLive(),
                'sentinel_token_set' => filled($settings?->sentinel_token),
                'sentinel_custom_url' => filled($settings?->sentinel_custom_url)
                    ? (string) $settings->sentinel_custom_url
                    : null,
                'sentinel_metrics_refresh_rate_seconds' => $settings?->sentinel_metrics_refresh_rate_seconds,
                'sentinel_metrics_history_days' => $settings?->sentinel_metrics_history_days,
                'sentinel_push_interval_seconds' => $settings?->sentinel_push_interval_seconds,
            ],
            'proxy' => [
                'type' => $server->proxyType(),
                'status' => data_get($proxy, 'status'),
                'redirect_enabled' => (bool) data_get($proxy, 'redirect_enabled', true),
                'redirect_url' => data_get($proxy, 'redirect_url'),
                'generate_exact_labels' => (bool) data_get($proxy, 'generate_exact_labels', false),
                'detected_traefik_version' => $server->detected_traefik_version,
                'config_out_of_sync' => filled($lastSaved) && filled($lastApplied) && $lastSaved !== $lastApplied,
            ],
        ];
    }
}
