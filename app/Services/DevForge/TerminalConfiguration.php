<?php

namespace App\Services\DevForge;

use App\Models\Team;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;

class TerminalConfiguration
{
    /**
     * @return array<string, mixed>
     */
    public function build(User $user, Team $team): array
    {
        $protocol = config('constants.terminal.protocol') ?: (request()->isSecure() ? 'wss' : 'ws');
        $host = config('constants.terminal.host') ?: request()->getHost();
        $configuredPort = config('constants.terminal.port');
        $port = $configuredPort ?: (request()->getHttpHost() !== request()->getHost() ? 6002 : null);
        $websocketUrl = $protocol.'://'.$host.($port ? ':'.$port : '').'/terminal/ws';

        return [
            'enabled' => true,
            'websocket_url' => $websocketUrl,
            'connection' => [
                'protocol' => $protocol,
                'host' => $host,
                'port' => $port ? (int) $port : null,
                'path' => '/terminal/ws',
            ],
            'auth' => [
                'method' => 'POST',
                'endpoint' => '/terminal/auth',
                'allowed_ips_endpoint' => '/terminal/auth/ips',
                'credentials' => 'same-origin',
            ],
            'permissions' => [
                'access' => $user->can('canAccessTerminal'),
                'connect_server' => true,
                'connect_container' => true,
                'execute_commands' => true,
            ],
            'targets' => $team->servers()
                ->whereHas('settings', fn (Builder $query): Builder => $query
                    ->where('is_terminal_enabled', true)
                    ->where('is_reachable', true))
                ->orderBy('name')
                ->get(['uuid', 'name'])
                ->map(fn ($server): array => [
                    'uuid' => $server->uuid,
                    'name' => $server->name,
                    'type' => 'server',
                ])
                ->all(),
        ];
    }
}
