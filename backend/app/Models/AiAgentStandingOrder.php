<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AiAgentStandingOrder extends Model
{
    protected $fillable = [
        'team_id',
        'agent_id',
        'resource_uuid',
        'title',
        'scope',
        'triggers',
        'approval_gates',
        'escalation',
        'body',
        'priority',
        'is_active',
    ];

    protected function casts(): array
    {
        return [
            'triggers' => 'array',
            'is_active' => 'boolean',
            'priority' => 'integer',
        ];
    }

    public function team(): BelongsTo
    {
        return $this->belongsTo(Team::class);
    }

    public function agent(): BelongsTo
    {
        return $this->belongsTo(AiAgent::class, 'agent_id');
    }
}
