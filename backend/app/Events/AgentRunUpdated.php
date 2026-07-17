<?php

namespace App\Events;

use App\Models\AiAgent;
use App\Models\AiAgentRun;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class AgentRunUpdated implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public readonly AiAgent $agent,
        public readonly AiAgentRun $run,
        public readonly string $lastLog = '',
    ) {}

    public function broadcastOn(): array
    {
        return [
            new PrivateChannel("team.{$this->agent->team_id}"),
        ];
    }

    public function broadcastAs(): string
    {
        return 'AgentRunUpdated';
    }

    /** @return array<string, mixed> */
    public function broadcastWith(): array
    {
        return [
            'agent_uuid' => $this->agent->uuid,
            'agent_name' => $this->agent->name,
            'run_uuid' => $this->run->uuid,
            'status' => $this->run->status,
            'last_log' => $this->lastLog,
            'iterations' => $this->run->iterations,
            'tokens_used' => $this->run->tokens_used,
        ];
    }
}
