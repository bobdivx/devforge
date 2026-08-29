<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;
use App\Models\AiAgentRun;

class AgentChatFleetMetadata
{
    /**
     * Backend-owned workspace/fleet pack. Do not rely on a frontend-sent pack.
     *
     * @param  array<string, mixed>  $metadata
     * @return array<string, mixed>
     */
    public static function enrich(array $metadata, ?AiAgent $agent): array
    {
        $uuid = trim((string) ($metadata['application_uuid'] ?? ''));

        try {
            $workspace = app(ApplicationWorkspaceChatContext::class);
            if ($uuid !== '') {
                $pack = $workspace->buildFromUuid($uuid);
                if (is_array($pack) && $pack !== []) {
                    return array_merge($metadata, $pack);
                }
            } elseif ($agent !== null && filled($agent->team_id)) {
                $fleet = $workspace->buildTeamFleet((int) $agent->team_id);
                if ($fleet !== []) {
                    return array_merge($metadata, $fleet);
                }
            }
        } catch (\Throwable $exception) {
            report($exception);
        }

        return $metadata;
    }

    public static function enrichRun(AiAgentRun $run): void
    {
        if ((string) ($run->trigger ?? '') !== 'chat') {
            return;
        }

        $metadata = is_array($run->metadata) ? $run->metadata : [];
        $agent = null;
        if (filled($run->agent_id)) {
            $agent = $run->relationLoaded('agent') ? $run->agent : AiAgent::query()->find($run->agent_id);
        }

        $run->metadata = self::enrich(
            $metadata,
            $agent instanceof AiAgent ? $agent : null,
        );
    }
}
