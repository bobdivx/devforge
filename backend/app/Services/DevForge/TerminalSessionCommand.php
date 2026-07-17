<?php

namespace App\Services\DevForge;

use App\Helpers\SshMultiplexingHelper;
use App\Models\Server;
use App\Models\Team;
use App\Models\User;
use InvalidArgumentException;

class TerminalSessionCommand
{
    /**
     * @return array{server_uuid: string, command: string}
     */
    public function forServer(User $user, Team $team, string $serverUuid): array
    {
        abort_unless($user->can('canAccessTerminal'), 403, 'Terminal access is forbidden.');

        $server = $team->servers()->where('uuid', $serverUuid)->firstOrFail();

        if (! $server->isTerminalEnabled() || $server->isForceDisabled()) {
            throw new InvalidArgumentException('Terminal access is disabled on this server.');
        }

        if (! $server->isReachable()) {
            throw new InvalidArgumentException('Server is not reachable.');
        }

        $shellCommand = 'PATH=$PATH:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin && '.
            'if [ -f ~/.profile ]; then . ~/.profile; fi && '.
            'if [ -n "$SHELL" ] && [ -x "$SHELL" ]; then exec $SHELL; else sh; fi';

        $command = SshMultiplexingHelper::generateSshCommand(
            $server,
            $shellCommand,
            commandTimeout: (int) config('constants.terminal.command_timeout')
        );

        return [
            'server_uuid' => $server->uuid,
            'command' => $command,
        ];
    }
}
