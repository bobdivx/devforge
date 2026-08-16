<?php

namespace App\Services\DevForge\Destination;

use App\Jobs\ConnectProxyToNetworksJob;
use App\Models\Server;
use App\Models\StandaloneDocker;
use App\Models\SwarmDocker;
use App\Models\Team;
use App\Models\User;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class DestinationWriter
{
    /**
     * @param  array{
     *     server_uuid: string,
     *     network: string,
     *     name?: string|null,
     *     type?: string|null,
     * }  $payload
     */
    public function create(Team $team, User $user, array $payload): StandaloneDocker|SwarmDocker
    {
        $server = Server::query()
            ->where('team_id', $team->id)
            ->where('uuid', $payload['server_uuid'])
            ->firstOrFail();

        $type = $payload['type'] ?? ($server->isSwarm() ? 'swarm' : 'standalone');
        $name = filled($payload['name'] ?? null)
            ? $payload['name']
            : (string) Str::of("{$server->name}-{$payload['network']}")->kebab();

        if ($type === 'swarm') {
            Gate::forUser($user)->authorize('create', SwarmDocker::class);
            $this->assertNetworkAvailable($server->swarmDockers(), $payload['network']);

            return SwarmDocker::query()->create([
                'name' => $name,
                'network' => $payload['network'],
                'server_id' => $server->id,
            ]);
        }

        Gate::forUser($user)->authorize('create', StandaloneDocker::class);
        $this->assertNetworkAvailable($server->standaloneDockers(), $payload['network']);

        return StandaloneDocker::query()->create([
            'name' => $name,
            'network' => $payload['network'],
            'server_id' => $server->id,
        ]);
    }

    /**
     * @param  array{name?: string, network?: string}  $payload
     */
    public function update(
        User $user,
        StandaloneDocker|SwarmDocker $destination,
        array $payload,
    ): StandaloneDocker|SwarmDocker {
        Gate::forUser($user)->authorize('update', $destination);

        if (array_key_exists('name', $payload)) {
            $destination->name = $payload['name'];
        }

        if (array_key_exists('network', $payload)) {
            $relation = $destination instanceof SwarmDocker
                ? $destination->server->swarmDockers()
                : $destination->server->standaloneDockers();

            $duplicate = $relation
                ->where('network', $payload['network'])
                ->where('id', '!=', $destination->id)
                ->exists();

            if ($duplicate) {
                throw ValidationException::withMessages([
                    'network' => ['This network is already added to the server.'],
                ]);
            }

            $destination->network = $payload['network'];
        }

        $destination->save();

        return $destination->refresh();
    }

    public function delete(User $user, StandaloneDocker|SwarmDocker $destination): void
    {
        Gate::forUser($user)->authorize('delete', $destination);

        if ($destination->attachedTo()) {
            throw ValidationException::withMessages([
                'destination' => ['Delete all resources attached to this destination before deleting it.'],
            ]);
        }

        if ($destination instanceof StandaloneDocker) {
            $safeNetwork = escapeshellarg($destination->network);
            instant_remote_process(
                devforge_proxy_network_disconnect_commands($destination->network),
                $destination->server,
                throwError: false,
            );
            instant_remote_process(
                ["docker network rm -f {$safeNetwork}"],
                $destination->server,
            );
            ConnectProxyToNetworksJob::dispatchSync($destination->server);
        }

        $destination->delete();
    }

    private function assertNetworkAvailable($relation, string $network): void
    {
        if ($relation->where('network', $network)->exists()) {
            throw ValidationException::withMessages([
                'network' => ['This network is already added to the server.'],
            ]);
        }
    }
}
