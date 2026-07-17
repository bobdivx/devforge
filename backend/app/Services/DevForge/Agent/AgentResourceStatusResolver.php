<?php

namespace App\Services\DevForge\Agent;

use App\Models\Server;
use Illuminate\Database\Eloquent\Model;

class AgentResourceStatusResolver
{
    /**
     * @return array<string, bool>|string|null
     */
    public static function resolve(Model $resource, string $type): array|string|null
    {
        if ($type === 'servers' && $resource instanceof Server) {
            return [
                'reachable' => (bool) $resource->settings?->is_reachable,
                'usable' => (bool) $resource->settings?->is_usable,
                'validating' => (bool) $resource->is_validating,
            ];
        }

        return $resource->getAttributes()['status'] ?? null;
    }
}
