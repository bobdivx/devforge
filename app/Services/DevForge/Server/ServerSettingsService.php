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
     * @return array{
     *     uuid: string,
     *     name: string,
     *     wildcard_domain: string|null
     * }
     */
    public function show(Server $server): array
    {
        $server->loadMissing('settings');

        return $this->present($server);
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array{
     *     uuid: string,
     *     name: string,
     *     wildcard_domain: string|null
     * }
     */
    public function update(Server $server, array $input): array
    {
        $validated = validator($input, [
            'wildcard_domain' => ['nullable', 'url', 'max:255'],
        ])->validate();

        $settings = $server->settings;
        abort_unless($settings !== null, 422, 'Server settings are missing.');

        $wildcard = $validated['wildcard_domain'] ?? null;
        $settings->wildcard_domain = filled($wildcard) ? rtrim((string) $wildcard, '/') : null;
        $settings->save();

        $server->load('settings');

        return $this->present($server);
    }

    /**
     * @return array{
     *     uuid: string,
     *     name: string,
     *     wildcard_domain: string|null
     * }
     */
    private function present(Server $server): array
    {
        $wildcard = $server->settings?->wildcard_domain;

        return [
            'uuid' => $server->uuid,
            'name' => $server->name,
            'wildcard_domain' => filled($wildcard) ? (string) $wildcard : null,
        ];
    }
}
