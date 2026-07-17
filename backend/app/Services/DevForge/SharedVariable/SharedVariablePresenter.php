<?php

namespace App\Services\DevForge\SharedVariable;

use App\Models\SharedEnvironmentVariable;

class SharedVariablePresenter
{
    /**
     * @return array<string, mixed>
     */
    public function present(SharedEnvironmentVariable $variable): array
    {
        $variable->loadMissing(['project:id,uuid,name', 'environment:id,uuid,name', 'server:id,uuid,name']);

        return [
            'id' => $variable->id,
            'key' => $variable->key,
            'scope' => $variable->type,
            'project_id' => $variable->project_id,
            'environment_id' => $variable->environment_id,
            'server_id' => $variable->server_id,
            'project_uuid' => $variable->project?->uuid,
            'environment_uuid' => $variable->environment?->uuid,
            'server_uuid' => $variable->server?->uuid,
            'project_name' => $variable->project?->name,
            'environment_name' => $variable->environment?->name,
            'server_name' => $variable->server?->name,
            'comment' => $variable->comment,
            'is_multiline' => (bool) $variable->is_multiline,
            'is_literal' => (bool) $variable->is_literal,
            'is_shown_once' => (bool) $variable->is_shown_once,
            'value' => filled($variable->getRawOriginal('value')) ? '********' : null,
            'value_locked' => (bool) $variable->is_shown_once,
        ];
    }
}
