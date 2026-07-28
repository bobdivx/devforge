<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AiAgentMission extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'team_id',
        'agent_id',
        'assignee_agent_id',
        'resource_uuid',
        'kind',
        'status',
        'priority',
        'title',
        'description',
        'source',
        'dedupe_key',
        'metadata',
        'due_at',
        'completed_at',
    ];

    protected function casts(): array
    {
        return [
            'metadata' => 'array',
            'due_at' => 'datetime',
            'completed_at' => 'datetime',
        ];
    }

    /** @return string[] */
    public function uniqueIds(): array
    {
        return ['uuid'];
    }

    public function team(): BelongsTo
    {
        return $this->belongsTo(Team::class);
    }

    public function agent(): BelongsTo
    {
        return $this->belongsTo(AiAgent::class, 'agent_id');
    }

    public function assignee(): BelongsTo
    {
        return $this->belongsTo(AiAgent::class, 'assignee_agent_id');
    }
}
