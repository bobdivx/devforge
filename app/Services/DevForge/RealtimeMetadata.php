<?php

namespace App\Services\DevForge;

use App\Models\Team;
use App\Models\User;

class RealtimeMetadata
{
    /**
     * @return array<string, mixed>
     */
    public function build(User $user, Team $team): array
    {
        return [
            'transport' => [
                'driver' => 'pusher',
                'key' => config('constants.pusher.app_key') ?: 'coolify',
                'host' => config('constants.pusher.host') ?: request()->getHost(),
                'port' => getRealtime(),
                'scheme' => request()->isSecure() ? 'wss' : 'ws',
                'auth_endpoint' => '/broadcasting/auth',
            ],
            'channels' => [
                'team' => [
                    'name' => 'private-team.'.$team->id,
                    'subscription' => 'team.'.$team->id,
                    'private' => true,
                ],
                'user' => [
                    'name' => 'private-user.'.$user->id,
                    'subscription' => 'user.'.$user->id,
                    'private' => true,
                ],
            ],
            'events' => [
                [
                    'name' => 'App\\Events\\ApplicationStatusChanged',
                    'channel' => 'team',
                    'refresh' => 'applications',
                ],
                [
                    'name' => 'App\\Events\\ServiceStatusChanged',
                    'channel' => 'team',
                    'refresh' => 'services',
                ],
                [
                    'name' => 'App\\Events\\DatabaseStatusChanged',
                    'channel' => 'user',
                    'refresh' => 'databases',
                ],
                [
                    'name' => 'App\\Events\\AgentRunUpdated',
                    'channel' => 'team',
                    'refresh' => 'agent_runs',
                ],
            ],
            'polling' => [
                'deployment_logs' => true,
                'resource_status' => true,
                'recommended_interval_ms' => 3000,
            ],
            'capabilities' => [
                'container_logs' => [
                    'available' => false,
                    'reason' => 'No controlled reusable container-log abstraction is available.',
                ],
            ],
        ];
    }
}
